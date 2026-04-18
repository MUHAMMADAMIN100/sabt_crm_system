import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAd, BudgetSource } from './project-ad.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { AppGateway } from '../gateway/app.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';

const CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
  telegram: 'Telegram',
  google: 'Google Ads',
  other: 'Другое',
};

@Injectable()
export class ProjectAdsService {
  constructor(
    @InjectRepository(ProjectAd) private repo: Repository<ProjectAd>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private gateway: AppGateway,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private telegramService: TelegramService,
  ) {}

  findByProject(projectId: string) {
    return this.repo.find({
      where: { projectId },
      relations: ['createdBy'],
      order: { startDate: 'DESC' },
    });
  }

  async findOne(id: string) {
    const ad = await this.repo.findOne({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
  }

  /** Adjust project budget by delta (positive = increase, negative = decrease) */
  private async adjustProjectBudget(projectId: string, delta: number) {
    if (!delta) return;
    await this.projectRepo
      .createQueryBuilder()
      .update(Project)
      .set({ budget: () => `COALESCE(budget, 0) + ${delta}` })
      .where('id = :id', { id: projectId })
      .execute();
  }

  async create(projectId: string, dto: Partial<ProjectAd>, createdById?: string) {
    const ad = this.repo.create({ ...dto, projectId, createdById });
    const saved = await this.repo.save(ad);

    // Company-paid ad → add budget to project so we can bill the client
    if (saved.budgetSource === BudgetSource.COMPANY && saved.budget) {
      await this.adjustProjectBudget(projectId, Number(saved.budget));
    }

    // Notify the project manager (if not the creator themselves)
    await this.notifyManagerAboutNewAd(saved, createdById);

    this.gateway.broadcast('projects:changed', {});
    return saved;
  }

  private async notifyManagerAboutNewAd(ad: ProjectAd, createdById?: string) {
    try {
      const project = await this.projectRepo.findOne({
        where: { id: ad.projectId },
        relations: ['manager'],
      });
      if (!project?.manager || !project.managerId) return;
      // Don't notify the creator themselves
      if (createdById && project.managerId === createdById) return;

      const creator = createdById ? await this.userRepo.findOne({ where: { id: createdById } }) : null;
      const creatorName = creator?.name || 'Сотрудник';

      const channel = CHANNEL_LABELS[ad.channel] || ad.channel;
      const startStr = new Date(ad.startDate).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const endStr = new Date(ad.endDate).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const budgetStr = ad.budget ? `${Number(ad.budget).toLocaleString('ru-RU')} сомони` : '—';
      const sourceLabel = ad.budgetSource === BudgetSource.COMPANY ? 'из компании' : 'от клиента';

      // In-app notification
      try {
        await this.notificationsService.create({
          userId: project.managerId,
          type: NotificationType.NEW_TASK,
          title: `📢 Новая реклама: ${project.name}`,
          message: `${creatorName} создал рекламу "${ad.title}" · ${channel} · ${budgetStr} (${sourceLabel})`,
          link: `/projects/${ad.projectId}`,
        });
      } catch {}

      // Email
      try {
        if (project.manager.email) {
          const html =
            `<b>Создал:</b> ${creatorName}<br/>` +
            `<b>Проект:</b> ${project.name}<br/><br/>` +
            `<b>Название:</b> ${ad.title}<br/>` +
            `<b>Канал:</b> ${channel}<br/>` +
            `<b>Бюджет:</b> ${budgetStr} (${sourceLabel})<br/>` +
            `<b>Период:</b> ${startStr} → ${endStr}<br/>` +
            (ad.note ? `<b>Заметка:</b> ${ad.note}<br/>` : '');
          await this.mailService.sendGenericNotification(
            project.manager.email,
            project.manager.name,
            `📢 Новая реклама в проекте «${project.name}»`,
            html,
          );
        }
      } catch {}

      // Telegram
      try {
        const tgMsg =
          `📢 <b>Новая реклама</b>\n\n` +
          `👤 Создал: <b>${creatorName}</b>\n` +
          `📁 Проект: <b>${project.name}</b>\n\n` +
          `📋 ${ad.title}\n` +
          `📺 Канал: ${channel}\n` +
          `💰 Бюджет: ${budgetStr} (${sourceLabel})\n` +
          `📅 ${startStr}\n` +
          `   → ${endStr}` +
          (ad.note ? `\n📝 ${ad.note}` : '') +
          `\n\n👉 ${this.telegramService.appUrl}/projects/${ad.projectId}`;
        await this.telegramService.sendToUser(project.managerId, tgMsg);
      } catch {}
    } catch {}
  }

  async update(id: string, dto: Partial<ProjectAd>) {
    const old = await this.findOne(id);
    const oldCompanyBudget = old.budgetSource === BudgetSource.COMPANY ? Number(old.budget || 0) : 0;

    await this.repo.update(id, dto);
    const updated = await this.findOne(id);
    const newCompanyBudget = updated.budgetSource === BudgetSource.COMPANY ? Number(updated.budget || 0) : 0;

    // Adjust project budget by the difference
    const delta = newCompanyBudget - oldCompanyBudget;
    if (delta !== 0) {
      await this.adjustProjectBudget(updated.projectId, delta);
    }

    this.gateway.broadcast('projects:changed', {});
    return updated;
  }

  async remove(id: string) {
    const ad = await this.findOne(id);

    // If company-paid, subtract budget from project
    if (ad.budgetSource === BudgetSource.COMPANY && ad.budget) {
      await this.adjustProjectBudget(ad.projectId, -Number(ad.budget));
    }

    await this.repo.remove(ad);
    this.gateway.broadcast('projects:changed', {});
    return { message: 'Ad deleted' };
  }
}
