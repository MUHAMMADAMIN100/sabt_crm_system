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

    return saved;
  }

  /**
   * Каждый день в 22:00 проверяем, кто из участников SMM-проектов
   * не добавил ни одной истории за сегодня — уведомляем менеджера.
   */
  @Cron('0 22 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyManagerAboutMissingStories() {
    this.logger.log('Running 22:00 stories check...');

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

      // Истории за сегодня по этому проекту
      const todayLogs = await this.repo.find({ where: { projectId: project.id, date: today } });
      const doneUserIds = new Set(todayLogs.map(l => l.employeeId));

      // Участники, которые не сделали ни одной истории
      const missed = project.members.filter(m => !doneUserIds.has(m.id));
      if (!missed.length) continue;

      const names = missed.map(m => m.name).join(', ');
      const msg = `📊 <b>Напоминание о сторис</b>\n\nПроект: <b>${project.name}</b>\nДата: ${today}\n\n❌ Не добавили истории сегодня:\n${missed.map(m => `• ${m.name}`).join('\n')}`;

      // Telegram менеджеру
      try {
        await this.telegramService.sendToUser(project.managerId, msg);
      } catch (e) {
        this.logger.warn(`Failed to send Telegram to manager ${project.managerId}: ${e.message}`);
      }

      // Внутреннее уведомление менеджеру
      try {
        await this.notificationsService.create({
          userId: project.managerId,
          type: NotificationType.DEADLINE_APPROACHING,
          title: `Не сделаны истории — ${project.name}`,
          message: `Сотрудники не добавили истории: ${names}`,
          link: `/projects/${project.id}`,
        });
      } catch (e) {
        this.logger.warn(`Failed to create notification: ${e.message}`);
      }

      this.logger.log(`Notified manager ${project.managerId} about ${missed.length} members in project ${project.name}`);
    }
  }
}
