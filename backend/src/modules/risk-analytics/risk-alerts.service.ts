import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectPaymentStatus, ProjectStatus } from '../projects/project.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { RiskAnalyticsService } from './risk-analytics.service';
import { ProjectsService } from '../projects/projects.service';

/** Wave 6: оркестратор алертов по операционным рискам.
 *  Каждый чекер собирает данные → определяет триггеры → шлёт уведомления
 *  с дедупликацией, чтобы не спамить ежедневно одинаковыми сообщениями. */
@Injectable()
export class RiskAlertsService {
  private readonly logger = new Logger(RiskAlertsService.name);

  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(ContentPlanItem) private cpiRepo: Repository<ContentPlanItem>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notificationsService: NotificationsService,
    private riskAnalytics: RiskAnalyticsService,
    private projectsService: ProjectsService,
  ) {}

  /** Запустить все чекеры. Вызывается шедулером, но также можно дёрнуть руками. */
  async runAll() {
    await Promise.allSettled([
      this.checkInactiveEmployees(),
      this.checkPmOverload(),
      this.checkTariffOveruse(),
      this.checkPaymentApproaching(),
      this.checkWeekNoContent(),
      this.checkTooManyPmReviews(),
      this.checkLaunchIncomplete(),
    ]);
  }

  /** Список всех founder/co_founder/admin — для рассылки админских алертов. */
  private async getTopAdmins(): Promise<User[]> {
    return this.userRepo.find({
      where: [
        { role: UserRole.FOUNDER, isActive: true, isBlocked: false },
        { role: UserRole.CO_FOUNDER, isActive: true, isBlocked: false },
        { role: UserRole.ADMIN, isActive: true, isBlocked: false },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 1. Сотрудник неактивен 2 дня (нет завершённых задач или комментариев)
  // ─────────────────────────────────────────────────────────────────────
  async checkInactiveEmployees() {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const users = await this.userRepo.find({
      where: { isActive: true, isBlocked: false },
    });
    if (users.length === 0) return;

    // Кто хоть что-то сделал за 2 дня (любая активность по задачам)
    const activeRows: Array<{ assigneeId: string }> = await this.taskRepo
      .createQueryBuilder('t')
      .select('DISTINCT t.assigneeId', 'assigneeId')
      .where('t.assigneeId IN (:...ids)', { ids: users.map(u => u.id) })
      .andWhere('t.updatedAt > :since', { since: cutoff })
      .getRawMany();
    const activeSet = new Set(activeRows.map(r => r.assigneeId));

    const admins = await this.getTopAdmins();
    for (const u of users) {
      // Не алертим админов о самих себе
      if ([UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN].includes(u.role as UserRole)) continue;
      if (activeSet.has(u.id)) continue;

      // Шлём админам и самому сотруднику
      const recipients = [...admins.map(a => a.id), u.id];
      for (const rid of new Set(recipients)) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.EMPLOYEE_INACTIVE_2D,
          title: '😴 Сотрудник неактивен 2 дня',
          message: `${u.name} не обновлял задачи последние 2 дня.`,
          link: `/employees/${u.id}`,
          data: { alertKey: `inactive-2d:${u.id}`, userId: u.id },
        }, 48).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. PM перегружен (overload === 'red' по сводке workload)
  // ─────────────────────────────────────────────────────────────────────
  async checkPmOverload() {
    const pmWorkloads = await this.riskAnalytics.getPmWorkload();
    const employeeWorkloads = await this.riskAnalytics.getEmployeeWorkload();
    const overloadedPmIds = new Set(
      employeeWorkloads
        .filter(w => w.overload === 'red')
        .map(w => w.userId),
    );

    const admins = await this.getTopAdmins();
    for (const pm of pmWorkloads) {
      if (!overloadedPmIds.has(pm.pmId)) continue;
      // Шлём founder/admin и самому PM
      const recipients = [...admins.map(a => a.id), pm.pmId];
      for (const rid of new Set(recipients)) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.PM_OVERLOAD,
          title: '🔥 PM перегружен',
          message: `${pm.pmName}: проектов ${pm.projectCount}, на проверке ${pm.tasksOnReview}, на доработке ${pm.tasksOnRework}.`,
          link: `/employees/${pm.pmId}`,
          data: { alertKey: `pm-overload:${pm.pmId}`, pmId: pm.pmId },
        }, 24).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. Лимит тарифа превышен (по любому типу контента)
  // ─────────────────────────────────────────────────────────────────────
  async checkTariffOveruse() {
    const projects = await this.projectRepo.find({
      where: { isArchived: false, projectType: 'SMM' },
    });
    const admins = await this.getTopAdmins();

    for (const p of projects) {
      if (!p.tariffId) continue;
      const planFact = await this.riskAnalytics.getPlanFactRich(p.id).catch(() => []);
      const overusedTypes = planFact.filter(r => r.overuse > 0);
      if (overusedTypes.length === 0) continue;

      const summary = overusedTypes
        .map(r => `${r.contentType}: +${r.overuse} сверх лимита`)
        .join('; ');

      const recipients = new Set<string>();
      if (p.managerId) recipients.add(p.managerId);
      admins.forEach(a => recipients.add(a.id));

      for (const rid of recipients) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.TARIFF_LIMIT_EXCEEDED,
          title: '📊 Превышен лимит тарифа',
          message: `Проект "${p.name}": ${summary}`,
          link: `/projects/${p.id}`,
          data: { alertKey: `tariff-overuse:${p.id}`, projectId: p.id },
        }, 24).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. Приближается просрочка оплаты (nextPaymentDate в ближайшие 3 дня)
  // ─────────────────────────────────────────────────────────────────────
  async checkPaymentApproaching() {
    const now = new Date();
    const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const projects = await this.projectRepo
      .createQueryBuilder('p')
      .where('p.isArchived = false')
      .andWhere('p.nextPaymentDate IS NOT NULL')
      .andWhere('p.nextPaymentDate BETWEEN :now AND :soon', { now, soon: in3days })
      .andWhere('p.paymentStatus != :paid', { paid: ProjectPaymentStatus.PAID })
      .getMany();

    const salesManagers = await this.userRepo.find({
      where: { role: UserRole.SALES_MANAGER, isActive: true, isBlocked: false },
    });
    const admins = await this.getTopAdmins();

    for (const p of projects) {
      const recipients = new Set<string>();
      if (p.salesManagerId) recipients.add(p.salesManagerId);
      if (p.managerId) recipients.add(p.managerId);
      salesManagers.forEach(s => recipients.add(s.id));
      admins.forEach(a => recipients.add(a.id));

      const dateStr = new Date(p.nextPaymentDate).toLocaleDateString('ru-RU');
      for (const rid of recipients) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.PAYMENT_OVERDUE_SOON,
          title: '💰 Скоро срок оплаты',
          message: `Проект "${p.name}" — следующая оплата ${dateStr}.`,
          link: `/projects/${p.id}`,
          data: { alertKey: `payment-soon:${p.id}:${dateStr}`, projectId: p.id },
        }, 24).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. На неделю не запланирован контент (SMM-проект, в плане нет позиций
  //    с publishDate в ближайшие 7 дней)
  // ─────────────────────────────────────────────────────────────────────
  async checkWeekNoContent() {
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const projects = await this.projectRepo.find({
      where: { isArchived: false, projectType: 'SMM' },
    });

    for (const p of projects) {
      if (!p.tariffId) continue;
      const cnt = await this.cpiRepo
        .createQueryBuilder('c')
        .where('c.projectId = :pid', { pid: p.id })
        .andWhere('c.publishDate BETWEEN :now AND :soon', { now, soon: in7days })
        .andWhere('c.status != :cancel', { cancel: 'cancelled' })
        .getCount();
      if (cnt > 0) continue;

      if (!p.managerId) continue;
      await this.notificationsService.createIfNotRecent({
        userId: p.managerId,
        type: NotificationType.WEEK_NO_CONTENT,
        title: '📅 Нет контента на неделю',
        message: `Проект "${p.name}" — на ближайшие 7 дней нет запланированных публикаций.`,
        link: `/projects/${p.id}`,
        data: { alertKey: `week-no-content:${p.id}`, projectId: p.id },
      }, 48).catch(() => {});
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 7. Launch-чеклист не завершён (проект > 7 дней в planning)
  // ─────────────────────────────────────────────────────────────────────
  async checkLaunchIncomplete() {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const projects = await this.projectRepo.find({
      where: { isArchived: false, status: ProjectStatus.PLANNING },
    });
    const stale = projects.filter(p => p.createdAt && new Date(p.createdAt) < cutoff);
    if (stale.length === 0) return;

    const admins = await this.getTopAdmins();
    for (const p of stale) {
      const state = await this.projectsService.getLaunchChecklist(p.id).catch(() => null);
      if (!state || state.isComplete) continue;

      const missing = state.items.filter(i => !i.done).map(i => i.label).join(', ');
      const recipients = new Set<string>();
      if (p.managerId) recipients.add(p.managerId);
      admins.forEach(a => recipients.add(a.id));

      for (const rid of recipients) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.LAUNCH_INCOMPLETE,
          title: '🚧 Launch-чеклист не завершён',
          message: `Проект "${p.name}" в подготовке более 7 дней. Не закрыто: ${missing}`,
          link: `/projects/${p.id}`,
          data: { alertKey: `launch-incomplete:${p.id}`, projectId: p.id },
        }, 72).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. Слишком много задач в статусе on_pm_review (> 10) у одного PM
  // ─────────────────────────────────────────────────────────────────────
  async checkTooManyPmReviews() {
    const THRESHOLD = 10;
    const rows: Array<{ managerId: string; cnt: string }> = await this.projectRepo.manager.query(
      `SELECT p."managerId" AS "managerId", COUNT(*) AS cnt
       FROM tasks t
       JOIN projects p ON p.id = t."projectId"
       WHERE t.status IN ('review', 'on_pm_review')
         AND p."isArchived" = false
       GROUP BY p."managerId"
       HAVING COUNT(*) > $1`,
      [THRESHOLD],
    );

    const admins = await this.getTopAdmins();
    for (const row of rows) {
      if (!row.managerId) continue;
      const cnt = Number(row.cnt);
      const recipients = new Set<string>([row.managerId, ...admins.map(a => a.id)]);
      for (const rid of recipients) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.TOO_MANY_PM_REVIEWS,
          title: '🚦 Очередь на проверке растёт',
          message: `У PM в очереди ${cnt} задач на проверке (порог ${THRESHOLD}).`,
          link: `/tasks?status=review`,
          data: { alertKey: `pm-reviews:${row.managerId}:${cnt}`, pmId: row.managerId, count: cnt },
        }, 12).catch(() => {});
      }
    }
  }
}
