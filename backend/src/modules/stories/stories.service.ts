import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async upsert(employeeId: string, projectId: string, date: string, storiesCount: number) {
    let log = await this.repo.findOne({ where: { employeeId, projectId, date } });
    const isUpdate = !!log;

    if (log) {
      log.storiesCount = storiesCount;
    } else {
      log = this.repo.create({ employeeId, projectId, date, storiesCount });
    }
    const saved = await this.repo.save(log);

    await this.activityLog.log({
      userId: employeeId,
      action: ActivityAction.STORY_UPDATE,
      entity: 'project',
      entityId: projectId,
      details: { date, storiesCount, isUpdate },
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
      .andWhere('p.managerId IS NOT NULL')
      .getMany();

    for (const project of projects) {
      if (!project.manager || !project.members?.length) continue;

      // План на день для этого проекта
      const target = Number((project.smmData as any)?.storiesPerDay) || 3;

      // Истории за сегодня по проекту → суммируем по сотрудникам
      const todayLogs = await this.repo.find({ where: { projectId: project.id, date: today } });
      const countByUser: Record<string, number> = {};
      for (const log of todayLogs) {
        countByUser[log.employeeId] = (countByUser[log.employeeId] || 0) + (log.storiesCount || 0);
      }

      const memberStats = project.members.map(m => ({
        id: m.id,
        name: m.name,
        count: countByUser[m.id] || 0,
        done: (countByUser[m.id] || 0) >= target,
        partial: (countByUser[m.id] || 0) > 0 && (countByUser[m.id] || 0) < target,
        missed: (countByUser[m.id] || 0) === 0,
      }));

      const doneCount = memberStats.filter(s => s.done).length;
      const partialCount = memberStats.filter(s => s.partial).length;
      const missedCount = memberStats.filter(s => s.missed).length;
      const totalActual = memberStats.reduce((s, m) => s + m.count, 0);
      const totalExpected = target * project.members.length;
      const pct = totalExpected > 0 ? Math.round((totalActual / totalExpected) * 100) : 0;

      // Skip silent days when EVERYONE met the target — no need to ping PM.
      if (missedCount === 0 && partialCount === 0) continue;

      // Build per-member lines (cap to first 25 to stay within TG 4096 char limit)
      const sortedStats = [...memberStats].sort((a, b) => a.count - b.count);
      const visible = sortedStats.slice(0, 25);
      const overflow = sortedStats.length - visible.length;
      const memberLines = visible.map(s => {
        const icon = s.done ? '✅' : s.partial ? '🟡' : '❌';
        return `${icon} <b>${s.name}</b> — ${s.count}/${target}`;
      }).join('\n');
      const overflowLine = overflow > 0 ? `\n…и ещё ${overflow} участников` : '';

      const tgMsg =
        `📊 <b>Сводка по сторис — ${project.name}</b>\n\n` +
        `📅 Дата: ${today}\n` +
        `🎯 План: <b>${target}</b> сторис/день · ${project.members.length} участников\n` +
        `📈 Факт: <b>${totalActual}/${totalExpected}</b> (${pct}%)\n\n` +
        `✅ Полностью: ${doneCount}\n` +
        `🟡 Частично: ${partialCount}\n` +
        `❌ Не делали: ${missedCount}\n\n` +
        `<b>По участникам:</b>\n${memberLines}${overflowLine}\n\n` +
        `👉 ${this.telegramService.appUrl}/projects/${project.id}`;

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
          message: `${totalActual}/${totalExpected} сторис · ✅${doneCount} 🟡${partialCount} ❌${missedCount}`,
          link: `/projects/${project.id}`,
          data: { projectId: project.id, target, totalActual, totalExpected, doneCount, partialCount, missedCount },
        });
      } catch (e) {
        this.logger.warn(`Failed to create notification: ${e.message}`);
      }

      this.logger.log(`Stories summary sent for ${project.name}: ${pct}% (${totalActual}/${totalExpected})`);
    }
  }
}
