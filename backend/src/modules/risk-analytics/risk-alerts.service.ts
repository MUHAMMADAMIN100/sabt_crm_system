import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from '../projects/project.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { RiskAnalyticsService } from './risk-analytics.service';
import { ProjectsService } from '../projects/projects.service';
import { isSalesManager } from '../../common/sales-segment';

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
      this.checkWeekNoContent(),
      // checkTooManyPmReviews убран (15.11.2026) — см. раздел 6 ниже.
      this.checkLaunchIncomplete(),
    ]);
  }

  /** Получатели операционных алертов. Основатель исключён по требованию —
   *  алёрты идут руководителю СММ и админу. */
  private async getTopAdmins(): Promise<User[]> {
    return this.userRepo.find({
      where: [
        { role: UserRole.ADMIN, isActive: true, isBlocked: false },
        { role: UserRole.SMM_DIRECTOR, isActive: true, isBlocked: false },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 1. Сотрудник неактивен 2 дня (ни задач, ни контент-плана, ни смен)
  // ─────────────────────────────────────────────────────────────────────
  async checkInactiveEmployees() {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    // Менеджеров продаж (роль или вторая роль) не проверяем вовсе
    // (14.11.2026): их работа — клиенты, Директ и звонки, а здесь считаются
    // только задачи, и «неактивен» приходил при полной загрузке.
    const users = (await this.userRepo.find({
      where: { isActive: true, isBlocked: false },
    })).filter(u => !isSalesManager(u.role) && !isSalesManager(u.secondaryRole));
    if (users.length === 0) return;

    // Кто хоть что-то сделал за 2 дня (любая активность по задачам)
    const activeRows: Array<{ assigneeId: string }> = await this.taskRepo
      .createQueryBuilder('t')
      .select('DISTINCT t.assigneeId', 'assigneeId')
      .where('t.assigneeId IN (:...ids)', { ids: users.map(u => u.id) })
      .andWhere('t.updatedAt > :since', { since: cutoff })
      .getRawMany();
    const activeSet = new Set(activeRows.map(r => r.assigneeId));

    // Активность — не только задачи (15.11.2026): SMM-команда работает в
    // контент-плане (исполнитель или PM позиции), а рабочая смена
    // («Начать работу») — сама по себе признак работы. Без этого «неактивен»
    // приходил людям, которые весь день вели контент-план.
    let otherRows: Array<{ userId: string }>;
    try {
      otherRows = await this.userRepo.manager.query(
        `SELECT DISTINCT a."userId" FROM (
           SELECT "assigneeId"::text AS "userId" FROM content_plan_items
            WHERE "assigneeId" IS NOT NULL AND "updatedAt" > $2
           UNION
           SELECT "pmId"::text FROM content_plan_items
            WHERE "pmId" IS NOT NULL AND "updatedAt" > $2
           UNION
           SELECT "employeeId"::text FROM work_shifts
            -- Незакрытая смена считается, только если начата после порога:
            -- забытая старая смена не должна навсегда глушить алерт (15.11.2026).
            WHERE "startedAt" > $2 OR "endedAt" > $2
         ) a
         WHERE a."userId" = ANY($1::text[])`,
        [users.map(u => u.id), cutoff],
      );
    } catch (e: any) {
      // Не смогли проверить контент-план и смены — лучше промолчать, чем
      // разослать ложное «неактивен» всей SMM-команде.
      this.logger.warn(`inactive-2d: активность по контент-плану/сменам не прочитана: ${e?.message || e}`);
      return;
    }
    for (const r of otherRows || []) activeSet.add(r.userId);

    // /employees/:id ждёт id сотрудника, а не аккаунта — иначе ссылка
    // уводила на «не найден».
    const empRows: Array<{ id: string; userId: string }> = await this.userRepo.manager.query(
      `SELECT id, "userId" AS "userId" FROM employees WHERE "userId"::text = ANY($1::text[])`,
      [users.map(u => u.id)],
    ).catch(() => []);
    const employeeOf = new Map((empRows || []).map(r => [r.userId, r.id]));

    const admins = await this.getTopAdmins();
    for (const u of users) {
      // Не алертим админов о самих себе
      if ([UserRole.FOUNDER, UserRole.ADMIN].includes(u.role as UserRole)) continue;
      if (activeSet.has(u.id)) continue;

      // Шлём админам и самому сотруднику
      const recipients = [...admins.map(a => a.id), u.id];
      for (const rid of new Set(recipients)) {
        await this.notificationsService.createIfNotRecent({
          userId: rid,
          type: NotificationType.EMPLOYEE_INACTIVE_2D,
          title: '😴 Сотрудник неактивен 2 дня',
          message: `${u.name}: 2 дня нет активности — ни задач, ни контент-плана, ни рабочих смен.`,
          link: employeeOf.has(u.id) ? `/employees/${employeeOf.get(u.id)}` : '/employees',
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
          // «На проверке/доработке» в 4-статусной модели нет: tasksOnReview —
          // это задачи в работе (см. getPmWorkload), 15.11.2026.
          message: `${pm.pmName}: проектов ${pm.projectCount}, задач в работе ${pm.tasksOnReview}.`,
          link: `/employees/${pm.pmId}`,
          data: { alertKey: `pm-overload:${pm.pmId}`, pmId: pm.pmId },
        }, 24).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. Месячный лимит тарифа превышен публикациями текущего месяца по
  //    Душанбе (по любому типу контента; раньше — за всё время, 15.11.2026)
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
        .map(r => `${r.contentType}: +${r.overuse} сверх месячного лимита`)
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
  // 4, 4b. «Скоро срок оплаты» и «2 недели после оплаты» — УДАЛЕНЫ 14.11.2026.
  // Читали старые поля проекта: nextPaymentDate (никто не пишет с 17.10.2026),
  // project_payments и projects.salesManagerId; рассылались всем менеджерам
  // продаж обоих направлений — МП-СММ ловил 403 на ссылке dev-проекта.
  // Оплаты клиентов теперь из «Финансов» (ответственному менеджеру).

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
  // 6. «Слишком много задач на проверке у PM» — УДАЛЁН 15.11.2026.
  // Искал статусы review/on_pm_review, которых в 4-статусной модели задач
  // (new / in_progress / done / cancelled, см. task.entity) больше нет:
  // запрос всегда возвращал пусто. Аналога «на проверке» у задач сейчас нет.
}
