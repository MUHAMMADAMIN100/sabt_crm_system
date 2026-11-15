import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAnnouncement, AnnouncementPriority } from './project-announcement.entity';
import { Project } from '../projects/project.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../../common/html-escape';
import { AccessUser, assertCanViewProject } from '../projects/project-access';

@Injectable()
export class ProjectAnnouncementsService {
  constructor(
    @InjectRepository(ProjectAnnouncement) private repo: Repository<ProjectAnnouncement>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private telegramService: TelegramService,
  ) {}

  /** Объявления проекта — только тем, кто видит проект (15.11.2026). */
  async findByProject(projectId: string, user?: AccessUser | null) {
    if (user) await assertCanViewProject(this.repo.manager, user, projectId);
    return this.repo.find({
      where: { projectId },
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    projectId: string,
    dto: { title: string; description?: string; priority?: AnnouncementPriority },
    createdById: string,
    creatorName: string,
  ) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      relations: ['members', 'manager'],
    });
    if (!project) throw new NotFoundException('Project not found');

    const announcement = this.repo.create({
      ...dto,
      projectId,
      createdById,
    });
    const saved = await this.repo.save(announcement);

    // Notify all project members + manager
    const recipientIds = new Set<string>();
    project.members?.forEach(m => recipientIds.add(m.id));
    if (project.managerId) recipientIds.add(project.managerId);
    recipientIds.delete(createdById); // Don't notify the author

    const isUrgent = dto.priority === 'urgent';
    const icon = isUrgent ? '🚨' : '📢';

    for (const userId of recipientIds) {
      // In-app notification
      try {
        await this.notificationsService.create({
          userId,
          type: NotificationType.NEW_TASK,
          title: `${icon} ${isUrgent ? 'СРОЧНО' : 'Важное'}: ${project.name}`,
          message: dto.title + (dto.description ? `\n${dto.description}` : ''),
          link: `/projects/${projectId}`,
        });
      } catch {}

      // Email
      try {
        const member = project.members?.find(m => m.id === userId) || project.manager;
        if (member?.email) {
          await this.mailService.sendGenericNotification(
            member.email,
            member.name,
            `${icon} ${isUrgent ? 'СРОЧНО' : 'Важное объявление'} — ${project.name}`,
            // Текст объявления — от людей: через escapeHtml (15.11.2026).
            `<b>${escapeHtml(dto.title)}</b>${dto.description ? `<br/><br/>${escapeHtml(dto.description)}` : ''}<br/><br/>От: ${escapeHtml(creatorName)}`,
          );
        }
      } catch {}

      // Telegram
      try {
        await this.telegramService.sendToUser(
          userId,
          `${icon} <b>${isUrgent ? 'СРОЧНО' : 'Важное'}</b> — ${escapeHtml(project.name)}\n\n` +
          `${escapeHtml(dto.title)}` +
          (dto.description ? `\n${escapeHtml(dto.description)}` : '') +
          `\n\n👤 ${escapeHtml(creatorName)}` +
          `\n👉 ${this.telegramService.appUrl}/projects/${projectId}`,
        );
      } catch {}
    }

    return saved;
  }

  async remove(id: string) {
    const ann = await this.repo.findOne({ where: { id } });
    if (!ann) throw new NotFoundException('Announcement not found');
    await this.repo.remove(ann);
    return { message: 'Deleted' };
  }
}
