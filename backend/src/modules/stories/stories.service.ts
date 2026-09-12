import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoryLog } from './story.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { AppGateway } from '../gateway/app.gateway';

/** Роли, которым разрешено ОТМЕЧАТЬ сторис (решение владельца, сент. 2026). Остальные — только чтение. */
const STORY_WRITE_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'smm_specialist'];
const STORY_MGMT_ROLES = ['admin', 'founder', 'co_founder', 'smm_director'];
/** Число дней в месяце даты 'YYYY-MM-DD' — дневная норма = месячная / дни месяца. */
function daysInMonthOf(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    @InjectRepository(StoryLog) private repo: Repository<StoryLog>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private notificationsService: NotificationsService,
    private gateway: AppGateway,
  ) {}

  async getByEmployee(employeeId: string, from: string, to: string) {
    return this.repo.createQueryBuilder('s')
      .leftJoinAndSelect('s.project', 'project')
      .where('s.employeeId = :employeeId', { employeeId })
      .andWhere('s.date BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  async getAll(from: string, to: string) {
    return this.repo.createQueryBuilder('s')
      .leftJoinAndSelect('s.employee', 'employee')
      .leftJoinAndSelect('s.project', 'project')
      .where('s.date BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  async upsert(
    employeeId: string, projectId: string, date: string, storiesCount: number,
    actor?: { id: string; role?: string | null; secondaryRole?: string | null },
  ) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Некорректная дата (ожидается формат YYYY-MM-DD)');
    }
    // Кто может писать: только SMM-специалист и руководство. Специалист — только по
    // своим проектам (менеджер, участник или назначен через smmData.smmSpecialistIds).
    // Внутренние вызовы без actor не ограничиваем.
    if (actor) {
      const roles = [actor.role, actor.secondaryRole].filter(Boolean) as string[];
      if (!roles.some(r => STORY_WRITE_ROLES.includes(r))) {
        throw new ForbiddenException('Отмечать сторис могут SMM-специалисты и руководство');
      }
      if (!roles.some(r => STORY_MGMT_ROLES.includes(r))) {
        const project = await this.projectRepo.findOne({ where: { id: projectId }, relations: ['members'] });
        if (!project) throw new BadRequestException('Проект не найден');
        const ids = (project.smmData as any)?.smmSpecialistIds;
        const assigned = Array.isArray(ids) && ids.includes(employeeId);
        const isMember = project.managerId === employeeId || (project.members || []).some(m => m.id === employeeId);
        if (!assigned && !isMember) throw new ForbiddenException('Вы не назначены на этот проект');
      }
    }
    // UI-лимиты на количество сторис в день сняты для сторисмейкера — защитный
    // кламп на бэке, чтобы нельзя было записать мусор/отрицательные значения.
    const safeStoriesCount = Math.max(0, Math.min(30, Math.round(Number(storiesCount) || 0)));

    let log = await this.repo.findOne({ where: { employeeId, projectId, date } });
    const isUpdate = !!log;

    if (log) {
      log.storiesCount = safeStoriesCount;
    } else {
      log = this.repo.create({ employeeId, projectId, date, storiesCount: safeStoriesCount });
    }
    const saved = await this.repo.save(log);

    await this.activityLog.log({
      userId: employeeId,
      action: ActivityAction.STORY_UPDATE,
      entity: 'project',
      entityId: projectId,
      details: { date, storiesCount: safeStoriesCount, isUpdate },
    });

    this.gateway.broadcast('stories:changed', { projectId, employeeId, date });
    return saved;
  }

  /**
   * Каждый день в 18:00 (Душанбе) — подробная сводка PM по сторис
   * каждого SMM-проекта: кто сколько сделал, кто не сделал, общий процент.
   */
  @Cron('0 18 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyManagerAboutMissingStories() {
    this.logger.log('Running 18:00 stories check...');

    const today = new Date().toISOString().split('T')[0];

    // Берём все активные SMM-проекты с менеджером и участниками
    const projects = await this.projectRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manager', 'manager')
      .leftJoinAndSelect('p.members', 'members')
      .where('p.projectType = :type', { type: 'SMM' })
      .andWhere('p.isArchived = false')
      // Архив историй: проект больше не требует сторис — не напоминаем.
      .andWhere('p."storiesArchived" = false')
      .andWhere('p.managerId IS NOT NULL')
      .getMany();

    for (const project of projects) {
      if (!project.manager) continue;
      // Команда сторис = участники проекта + назначенные SMM-специалисты
      // (smmData.smmSpecialistIds) — назначение через «Схему»/поле проекта не
      // добавляет в project_members, но вклад такого специалиста учитываем.
      const assignedIds: string[] = Array.isArray((project.smmData as any)?.smmSpecialistIds)
        ? ((project.smmData as any).smmSpecialistIds as any[]).filter(x => typeof x === 'string') : [];
      const memberIds = new Set((project.members || []).map(m => m.id));
      const extraIds = assignedIds.filter(id => !memberIds.has(id));
      const extraUsers = extraIds.length
        ? await this.userRepo.find({ where: { id: In(extraIds) } }).catch(() => [] as User[])
        : [];
      const crew = [...(project.members || []), ...extraUsers];
      if (!crew.length) continue;

      // План на день для этого проекта (на проект, не на каждого участника).
      // Сторис — это командная работа: достаточно, чтобы любой участник
      // отметил план дня — день считается выполненным.
      // Дневная норма = месячная / дни месяца (сегодняшнего); фолбэк — сохранённый storiesPerDay.
      const sd: any = project.smmData || {};
      const mNorm = sd.storiesPerMonth;
      const target = (mNorm != null && Number.isFinite(Number(mNorm)))
        ? (Number(mNorm) > 0 ? Math.max(1, Math.round(Number(mNorm) / daysInMonthOf(today))) : 0)
        : (Number(sd.storiesPerDay) || 3);
      // Если проект явно настроен без stories (target=0) — пропускаем
      // его в cron, чтобы не слать бессмысленные "0/0" уведомления.
      if (target <= 0) continue;

      // Истории за сегодня по проекту → суммируем по сотрудникам
      const todayLogs = await this.repo.find({ where: { projectId: project.id, date: today } });
      const countByUser: Record<string, number> = {};
      for (const log of todayLogs) {
        countByUser[log.employeeId] = (countByUser[log.employeeId] || 0) + (log.storiesCount || 0);
      }

      const memberStats = crew.map(m => ({
        id: m.id,
        name: m.name,
        count: countByUser[m.id] || 0,
      }));

      // Факт = суммарно опубликовано всеми участниками
      const totalActual = memberStats.reduce((s, m) => s + m.count, 0);
      const pct = target > 0 ? Math.min(100, Math.round((totalActual / target) * 100)) : 0;

      // Статус дня:
      //  - выполнено   — суммарно >= плана (хоть кто-то один справился — день закрыт)
      //  - частично    — что-то опубликовано, но меньше плана
      //  - не отмечено — никто не отметил
      const dayStatus: 'done' | 'partial' | 'missed' =
        totalActual >= target ? 'done' :
        totalActual > 0 ? 'partial' : 'missed';

      // Если команда выполнила план — PM не дёргаем. Уведомляем только
      // когда что-то пошло не так (частично или нулевой день).
      if (dayStatus === 'done') continue;

      // Контрибьюторы — кто реально публиковал что-то сегодня.
      const contributors = memberStats
        .filter(s => s.count > 0)
        .sort((a, b) => b.count - a.count);
      const visible = contributors.slice(0, 25);
      const overflow = contributors.length - visible.length;
      const contributorLines = visible.map(s => `✅ <b>${s.name}</b> — ${s.count}`).join('\n');
      const overflowLine = overflow > 0 ? `\n…и ещё ${overflow}` : '';

      const statusLine =
        dayStatus === 'partial'
          ? '🟡 <b>Статус:</b> частично выполнено'
          : '❌ <b>Статус:</b> никто не отметил';

      const contributorsBlock = contributors.length > 0
        ? `\n\n<b>Опубликовали:</b>\n${contributorLines}${overflowLine}`
        : `\n\nНикто из команды (${project.members.length} чел.) не отмечал сторис сегодня.`;

      const tgMsg =
        `📊 <b>Сводка по сторис — ${project.name}</b>\n\n` +
        `📅 Дата: ${today}\n` +
        `🎯 План: <b>${target}</b> сторис/день на проект · команда из ${project.members.length} чел.\n` +
        `📈 Факт: <b>${totalActual}/${target}</b> (${pct}%)\n\n` +
        statusLine +
        contributorsBlock +
        `\n\n👉 ${this.telegramService.appUrl}/projects/${project.id}`;

      try {
        await this.telegramService.sendToUser(project.managerId, tgMsg);
      } catch (e) {
        this.logger.warn(`Failed to send Telegram to manager ${project.managerId}: ${e.message}`);
      }

      try {
        await this.notificationsService.create({
          userId: project.managerId,
          type: NotificationType.DEADLINE_APPROACHING,
          title: `📊 Сторис: ${project.name} — ${pct}%`,
          message: dayStatus === 'partial'
            ? `${totalActual}/${target} сторис · 🟡 частично`
            : `0/${target} сторис · ❌ никто не отметил`,
          link: `/projects/${project.id}`,
          data: { projectId: project.id, target, totalActual, dayStatus, contributors: contributors.length },
        });
      } catch (e) {
        this.logger.warn(`Failed to create notification: ${e.message}`);
      }

      this.logger.log(`Stories summary sent for ${project.name}: ${pct}% (${totalActual}/${target}, ${dayStatus})`);
    }
  }
}
