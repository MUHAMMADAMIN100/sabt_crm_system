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
/** Статус дня в сводке проверки: выполнено / частично / не отмечено. */
type CheckDay = 'done' | 'partial' | 'none';
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
   * Сводка «кто делал сторис, а кто нет» за период — для роли «Проверяющий
   * сторис» (только чтение) и руководства. Считает ровно по тем же правилам,
   * что и вечерний cron 18:00, чтобы цифры на странице и в Telegram сходились:
   *   • команда сторис проекта = участники + назначенные SMM-специалисты
   *     (smmData.smmSpecialistIds);
   *   • дневная норма проекта = месячная / дни месяца (фолбэк storiesPerDay);
   *   • день проекта закрыт, если команда СУММАРНО выполнила норму.
   * Срез по людям: норма человека на день = сумма норм его проектов, факт —
   * его собственные отметки. Будущие дни не считаются (там «не отмечено» нет).
   *
   * Всё считается на сервере: роли-проверяющему не нужен доступ ни к списку
   * проектов, ни к календарю — только этот эндпоинт.
   */
  async check(from: string, to: string) {
    const isIso = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isIso(from) || !isIso(to) || from > to) throw new BadRequestException('Некорректный период');

    const days: string[] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
      if (days.length > 70) throw new BadRequestException('Период не больше двух месяцев');
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
    const past = days.filter(d => d <= today);

    const projects = await this.projectRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.members', 'members')
      .where('p.projectType = :type', { type: 'SMM' })
      .andWhere('p.isArchived = false')
      .andWhere('p."storiesArchived" = false')
      .getMany();

    // Люди: участники проектов + назначенные специалисты, которых нет в участниках.
    const known = new Map<string, any>();
    for (const p of projects) for (const m of p.members || []) known.set(m.id, m);
    const assignedOf = (p: Project): string[] => {
      const ids = (p.smmData as any)?.smmSpecialistIds;
      return Array.isArray(ids) ? ids.filter((x: any) => typeof x === 'string') : [];
    };
    const unknownIds = new Set<string>();
    for (const p of projects) for (const id of assignedOf(p)) if (!known.has(id)) unknownIds.add(id);
    if (unknownIds.size) {
      const extra = await this.userRepo.find({ where: { id: In([...unknownIds]) } }).catch(() => [] as User[]);
      for (const u of extra) known.set(u.id, u);
    }

    // Команда каждого проекта — только действующие сотрудники.
    const crewOf = new Map<string, string[]>();
    for (const p of projects) {
      const ids = new Set<string>((p.members || []).map(m => m.id));
      for (const id of assignedOf(p)) ids.add(id);
      crewOf.set(p.id, [...ids].filter(id => {
        const u = known.get(id);           // неизвестный/удалённый id в smmSpecialistIds — пропускаем
        return !!u && u.isActive !== false;
      }));
    }

    // Дневная норма проекта в конкретном месяце (кешируем по projectId|YYYY-MM).
    const targetCache = new Map<string, number>();
    const targetOf = (p: Project, date: string): number => {
      const key = `${p.id}|${date.slice(0, 7)}`;
      const hit = targetCache.get(key);
      if (hit !== undefined) return hit;
      const sd: any = p.smmData || {};
      const mNorm = sd.storiesPerMonth;
      const val = (mNorm != null && Number.isFinite(Number(mNorm)))
        ? (Number(mNorm) > 0 ? Math.max(1, Math.round(Number(mNorm) / daysInMonthOf(date))) : 0)
        : (Number(sd.storiesPerDay) || 3);
      targetCache.set(key, val);
      return val;
    };

    // С какого дня с проекта вообще спрашивают сторис: начало работы с
    // клиентом, иначе дата появления записи в CRM. То же правило, что в KPI и
    // на странице «Сторисы».
    const dOnly = (v: any): string | null =>
      !v ? null : (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));
    const startsAt = (p: Project): string | null =>
      dOnly((p as any).startDate) || dOnly((p as any).createdAt);

    // Факт из story_logs: отдельно по человеку и суммарно по проекту за день.
    const logs = await this.repo.createQueryBuilder('s')
      .select(['s.id', 's.projectId', 's.employeeId', 's.date', 's.storiesCount'])
      .where('s.date BETWEEN :from AND :to', { from, to })
      .getMany();
    const byPerson = new Map<string, number>();   // projectId|date|employeeId
    const byProject = new Map<string, number>();  // projectId|date
    for (const l of logs) {
      const date = String(l.date).slice(0, 10);  // колонка date → строка 'YYYY-MM-DD'
      const n = Number(l.storiesCount) || 0;
      const pk = `${l.projectId}|${date}`;
      byPerson.set(`${pk}|${l.employeeId}`, (byPerson.get(`${pk}|${l.employeeId}`) || 0) + n);
      byProject.set(pk, (byProject.get(pk) || 0) + n);
    }

    const statusOf = (actual: number, target: number): CheckDay =>
      actual >= target ? 'done' : actual > 0 ? 'partial' : 'none';
    const tally = (byDay: Record<string, CheckDay>) => {
      const c = { done: 0, partial: 0, none: 0 };
      for (const v of Object.values(byDay)) c[v]++;
      return c;
    };

    // ── Срез по проектам ─────────────────────────────────────────────
    const projectRows = projects.map(p => {
      const byDay: Record<string, CheckDay> = {};
      let marked = 0, expected = 0;
      const from0 = startsAt(p);
      for (const d of past) {
        const target = targetOf(p, d);
        if (target <= 0) continue;                 // проект без сторис — дни не красим
        const actual = byProject.get(`${p.id}|${d}`) || 0;
        // До начала работы с клиентом спрашивать не с кого. Факт всё равно
        // показываем: если сторис в этот день были, день не прячем.
        if (from0 && d < from0 && actual === 0) continue;
        byDay[d] = statusOf(actual, target);
        marked += actual; expected += target;
      }
      return {
        id: p.id, name: p.name, crew: (crewOf.get(p.id) || []).length,
        target: targetOf(p, past[past.length - 1] || to),
        days: byDay, marked, expected, ...tally(byDay),
      };
    }).filter(r => Object.keys(r.days).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    // ── Срез по людям ────────────────────────────────────────────────
    const projectsOf = new Map<string, Project[]>();
    for (const p of projects) {
      for (const uid of crewOf.get(p.id) || []) {
        const list = projectsOf.get(uid) || [];
        list.push(p);
        projectsOf.set(uid, list);
      }
    }
    const peopleRows = [...projectsOf.entries()].map(([uid, list]) => {
      const u = known.get(uid) || {};
      const byDay: Record<string, CheckDay> = {};
      let marked = 0, expected = 0;
      for (const d of past) {
        let target = 0, actual = 0;
        for (const p of list) {
          const t = targetOf(p, d);
          if (t <= 0) continue;
          const mine = byPerson.get(`${p.id}|${d}|${uid}`) || 0;
          const s0 = startsAt(p);
          if (s0 && d < s0 && mine === 0) continue;   // проект ещё не начался
          target += t;
          actual += mine;
        }
        if (target <= 0) continue;
        byDay[d] = statusOf(actual, target);
        marked += actual; expected += target;
      }
      return {
        id: uid, name: u.name || 'Сотрудник', role: u.role ?? null, position: u.position ?? null,
        avatar: u.avatar ?? null,
        projects: list.map(p => ({ id: p.id, name: p.name })),
        days: byDay, marked, expected, ...tally(byDay),
      };
    }).filter(r => Object.keys(r.days).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    // ── Кто не закрыл сегодняшний день ───────────────────────────────
    const inRange = today >= from && today <= to;
    const missingToday = !inRange ? [] : peopleRows
      .filter(r => r.days[today] && r.days[today] !== 'done')
      .map(r => {
        const list = projectsOf.get(r.id) || [];
        return {
          id: r.id, name: r.name, status: r.days[today],
          projects: list.map(p => ({
            id: p.id, name: p.name,
            target: targetOf(p, today),
            actual: byPerson.get(`${p.id}|${today}|${r.id}`) || 0,
          })).filter(x => x.target > 0 && x.actual < x.target),
        };
      });

    const totals = {
      people: peopleRows.length,
      projects: projectRows.length,
      marked: projectRows.reduce((s, r) => s + r.marked, 0),
      expected: projectRows.reduce((s, r) => s + r.expected, 0),
      todayDone: inRange ? projectRows.filter(r => r.days[today] === 'done').length : 0,
      todayTotal: inRange ? projectRows.filter(r => r.days[today]).length : 0,
    };

    return { from, to, today, days, people: peopleRows, projects: projectRows, missingToday, totals };
  }

  /**
   * Каждый день в 18:00 (Душанбе) — подробная сводка PM по сторис
   * каждого SMM-проекта: кто сколько сделал, кто не сделал, общий процент.
   */
  @Cron('0 18 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyManagerAboutMissingStories() {
    this.logger.log('Running 18:00 stories check...');

    // Дата по Душанбе, как во всех остальных суточных сравнениях. По UTC в
    // 18:00 она пока совпадает, но сдвинь крон на вечер — и сводка ушла бы
    // за вчерашний день.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());

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
