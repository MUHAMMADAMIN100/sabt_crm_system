import { Injectable, NotFoundException, ForbiddenException, OnModuleInit, Logger } from '@nestjs/common';
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
export class ProjectAdsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectAdsService.name);

  constructor(
    @InjectRepository(ProjectAd) private repo: Repository<ProjectAd>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private gateway: AppGateway,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private telegramService: TelegramService,
  ) {}

  /** Идемпотентно — новые колонки кампании (ТЗ §9.9 M7). */
  async onModuleInit() {
    const cols = [
      `ADD COLUMN IF NOT EXISTS "dailyBudget" numeric(15,2)`,
      `ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'planned'`,
      `ADD COLUMN IF NOT EXISTS "targetologistId" uuid`,
      `ADD COLUMN IF NOT EXISTS "cardId" uuid`,
    ];
    for (const c of cols) {
      try { await this.repo.manager.query(`ALTER TABLE project_ads ${c}`); }
      catch (e: any) { this.logger.warn(`project_ads ${c} failed: ${e?.message || e}`); }
    }
  }

  /** B3: доступ к рекламе проекта — привилегированная роль, менеджер проекта
   *  или участник проекта. Иначе 403 (кросс-проектный доступ закрыт). */
  private async assertProjectAccess(projectId: string, user?: { id: string; role: string }) {
    if (!user) throw new ForbiddenException('Нет доступа');
    const PRIVILEGED = ['admin', 'founder', 'co_founder', 'smm_director', 'video_director'];
    if (PRIVILEGED.includes(user.role)) return;
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Проект не найден');
    if (project.managerId === user.id) return;
    const rows = await this.repo.manager.query(
      `SELECT 1 FROM project_members WHERE "projectsId" = $1 AND "usersId" = $2 LIMIT 1`,
      [projectId, user.id],
    );
    if (rows.length > 0) return;
    throw new ForbiddenException('Нет доступа к рекламе этого проекта');
  }

  async findByProject(projectId: string, user?: { id: string; role: string }) {
    await this.assertProjectAccess(projectId, user);
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

  async create(projectId: string, dto: Partial<ProjectAd>, user?: { id: string; role: string }) {
    await this.assertProjectAccess(projectId, user);
    const createdById = user?.id;
    const ad = this.repo.create({ ...dto, projectId, createdById });
    const saved = await this.repo.save(ad);

    // Company-paid ad → add budget to project so we can bill the client
    if (saved.budgetSource === BudgetSource.COMPANY && saved.budget) {
      await this.adjustProjectBudget(projectId, Number(saved.budget));
    }

    // Notify the project manager (if not the creator themselves)
    await this.notifyManagerAboutNewAd(saved, createdById);
    // B7: уведомляем назначенного таргетолога о новой PLANNED-кампании.
    await this.notifyTargetologist(saved, createdById);

    this.gateway.broadcast('projects:changed', {});
    return saved;
  }

  /** Уведомление таргетолога о назначенной рекламной кампании (in-app + Telegram). */
  private async notifyTargetologist(ad: ProjectAd, createdById?: string) {
    try {
      const targetId = (ad as any).targetologistId;
      if (!targetId || targetId === createdById) return;
      const project = await this.projectRepo.findOne({ where: { id: ad.projectId } });
      const channel = CHANNEL_LABELS[ad.channel] || ad.channel;
      const total = ad.budget ? `${Number(ad.budget).toLocaleString('ru-RU')} сомони` : '—';
      const daily = (ad as any).dailyBudget ? `${Number((ad as any).dailyBudget).toLocaleString('ru-RU')}/день` : '';
      const period = `${new Date(ad.startDate).toLocaleDateString('ru-RU')} → ${new Date(ad.endDate).toLocaleDateString('ru-RU')}`;
      const msg = `Кампания «${ad.title}» · ${channel} · ${total}${daily ? ` (${daily})` : ''} · ${period}`;
      await this.notificationsService.create({
        userId: targetId,
        type: NotificationType.NEW_TASK,
        title: `🎯 Реклама назначена${project ? `: ${project.name}` : ''}`,
        message: msg,
        link: `/projects/${ad.projectId}`,
      }).catch(() => {});
      await this.telegramService.sendToUser(targetId, `🎯 <b>Реклама назначена</b>\n${msg}`).catch(() => {});
    } catch { /* best-effort */ }
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

  async update(id: string, dto: Partial<ProjectAd>, user?: { id: string; role: string }) {
    const old = await this.findOne(id);
    await this.assertProjectAccess(old.projectId, user);
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

  async remove(id: string, user?: { id: string; role: string }) {
    const ad = await this.findOne(id);
    await this.assertProjectAccess(ad.projectId, user);

    // If company-paid, subtract budget from project
    if (ad.budgetSource === BudgetSource.COMPANY && ad.budget) {
      await this.adjustProjectBudget(ad.projectId, -Number(ad.budget));
    }

    await this.repo.remove(ad);
    this.gateway.broadcast('projects:changed', {});
    return { message: 'Ad deleted' };
  }
}
