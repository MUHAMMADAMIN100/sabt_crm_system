import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectPaymentStatus } from '../projects/project.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { ContentPlanItem, ContentItemType, ContentPlanStatus } from '../content-plan/content-plan-item.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { User, UserRole } from '../users/user.entity';
import {
  PlanFactRow,
  EmployeeWorkload,
  PmWorkload,
  ProjectRisk,
  EmployeeRisk,
  RiskFactor,
  RiskLevel,
} from './risk-analytics.types';

/** Статусы задач, которые считаются «активными» (ещё в работе). */
const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.NEW,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVIEW,
  TaskStatus.RETURNED,
  TaskStatus.ACCEPTED,
  TaskStatus.ON_PM_REVIEW,
  TaskStatus.ON_REWORK,
  TaskStatus.ON_CLIENT_APPROVAL,
];

/** Статусы задач, считающиеся «завершёнными». */
const FINISHED_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.DONE,
  TaskStatus.CANCELLED,
  TaskStatus.APPROVED,
  TaskStatus.PUBLISHED,
];

/** Маппинг типа контента к лимиту в тарифе. */
const TARIFF_LIMIT_BY_TYPE: Partial<Record<ContentItemType, keyof SmmTariff>> = {
  [ContentItemType.STORY]:  'storiesPerMonth',
  [ContentItemType.REEL]:   'reelsPerMonth',
  [ContentItemType.POST]:   'postsPerMonth',
  [ContentItemType.DESIGN]: 'designsPerMonth',
};

@Injectable()
export class RiskAnalyticsService {
  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(ContentPlanItem) private cpiRepo: Repository<ContentPlanItem>,
    @InjectRepository(SmmTariff) private tariffRepo: Repository<SmmTariff>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // 1. PLAN-FACT
  // ─────────────────────────────────────────────────────────────────────

  /** План-факт по проекту с учётом лимита тарифа.
   *  Возвращает строку на каждый тип контента из тарифа + любые типы,
   *  которые есть в плане, но не покрыты тарифом. */
  async getPlanFactRich(projectId: string): Promise<PlanFactRow[]> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const tariff = project.tariffId
      ? await this.tariffRepo.findOne({ where: { id: project.tariffId } })
      : null;

    const rows = await this.cpiRepo
      .createQueryBuilder('c')
      .select('c.contentType', 'contentType')
      .addSelect(`SUM(CASE WHEN c.status != 'cancelled' THEN 1 ELSE 0 END)`, 'planned')
      .addSelect(`SUM(CASE WHEN c.status = 'published' THEN 1 ELSE 0 END)`, 'actual')
      .addSelect(`SUM(CASE WHEN c.status = 'cancelled' THEN 1 ELSE 0 END)`, 'cancelled')
      .where('c.projectId = :pid', { pid: projectId })
      .groupBy('c.contentType')
      .getRawMany();

    const byType = new Map<string, { planned: number; actual: number; cancelled: number }>();
    for (const r of rows) {
      byType.set(r.contentType, {
        planned: Number(r.planned),
        actual: Number(r.actual),
        cancelled: Number(r.cancelled),
      });
    }

    // Гарантируем, что строки из тарифа всегда присутствуют (даже если в плане 0).
    const tariffTypes: ContentItemType[] = tariff
      ? (Object.keys(TARIFF_LIMIT_BY_TYPE) as ContentItemType[]).filter(t => {
          const field = TARIFF_LIMIT_BY_TYPE[t]!;
          return Number((tariff as any)[field]) > 0;
        })
      : [];
    for (const t of tariffTypes) {
      if (!byType.has(t)) byType.set(t, { planned: 0, actual: 0, cancelled: 0 });
    }

    const result: PlanFactRow[] = [];
    for (const [contentType, agg] of byType.entries()) {
      const limitField = TARIFF_LIMIT_BY_TYPE[contentType as ContentItemType];
      const tariffLimit = tariff && limitField ? Number((tariff as any)[limitField]) : null;
      const denominator = tariffLimit && tariffLimit > 0 ? tariffLimit : agg.planned;
      const percent = denominator > 0 ? Math.round((agg.actual / denominator) * 100) : 0;
      const overuse = tariffLimit != null ? Math.max(0, agg.actual - tariffLimit) : 0;
      const underuse = tariffLimit != null ? Math.max(0, tariffLimit - agg.actual) : 0;
      result.push({
        contentType,
        planned: agg.planned,
        actual: agg.actual,
        cancelled: agg.cancelled,
        remaining: Math.max(0, agg.planned - agg.actual - agg.cancelled),
        tariffLimit,
        percent,
        overuse,
        underuse,
      });
    }

    return result.sort((a, b) => a.contentType.localeCompare(b.contentType));
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. WORKLOAD
  // ─────────────────────────────────────────────────────────────────────

  /** Нагрузка одного или всех сотрудников. */
  async getEmployeeWorkload(employeeId?: string): Promise<EmployeeWorkload[]> {
    const usersQb = this.userRepo
      .createQueryBuilder('u')
      .where('u.isActive = true')
      .andWhere('u.isBlocked = false');
    if (employeeId) usersQb.andWhere('u.id = :id', { id: employeeId });
    const users = await usersQb.getMany();
    if (users.length === 0) return [];

    const userIds = users.map(u => u.id);

    // 1) Активные задачи: считаем по статусам
    const taskAggRows: Array<{ assigneeId: string; status: string; cnt: string; planned: string; logged: string }> =
      await this.taskRepo.createQueryBuilder('t')
        .select('t.assigneeId', 'assigneeId')
        .addSelect('t.status', 'status')
        .addSelect('COUNT(*)', 'cnt')
        .addSelect('COALESCE(SUM(t.estimatedHours), 0)', 'planned')
        .addSelect('COALESCE(SUM(t.loggedHours), 0)', 'logged')
        .where('t.assigneeId IN (:...ids)', { ids: userIds })
        .groupBy('t.assigneeId')
        .addGroupBy('t.status')
        .getRawMany();

    // 2) Залогированные часы за 30 дней — по time_logs (если таблица есть)
    let loggedRows: Array<{ employeeId: string; total: string }> = [];
    try {
      loggedRows = await this.taskRepo.manager.query(
        `SELECT "employeeId", COALESCE(SUM("timeSpent"), 0) AS total
         FROM time_logs
         WHERE "employeeId" = ANY($1::uuid[])
           AND date >= NOW() - INTERVAL '30 days'
         GROUP BY "employeeId"`,
        [userIds],
      );
    } catch {
      // table missing — пропускаем
    }
    const logged30 = new Map<string, number>(
      loggedRows.map(r => [r.employeeId, Number(r.total)]),
    );

    // 3) Количество проектов где user — member или manager
    const projectRows: Array<{ userId: string; cnt: string }> = await this.projectRepo.manager.query(
      `SELECT u.id AS "userId", COUNT(DISTINCT p.id) AS cnt
       FROM users u
       LEFT JOIN projects p
         ON p."isArchived" = false
        AND (p."managerId" = u.id OR EXISTS (
              SELECT 1 FROM project_members pm
              WHERE pm."projectsId" = p.id AND pm."usersId" = u.id
            ))
       WHERE u.id = ANY($1::uuid[])
       GROUP BY u.id`,
      [userIds],
    );
    const projectCount = new Map<string, number>(
      projectRows.map(r => [r.userId, Number(r.cnt)]),
    );

    // Свести по пользователю
    const result: EmployeeWorkload[] = [];
    for (const u of users) {
      let inProgress = 0;
      let inQueue = 0;
      let plannedHours = 0;
      for (const row of taskAggRows) {
        if (row.assigneeId !== u.id) continue;
        const cnt = Number(row.cnt);
        const planned = Number(row.planned);
        if ((ACTIVE_TASK_STATUSES as string[]).includes(row.status)) {
          plannedHours += planned;
          if (row.status === TaskStatus.NEW) inQueue += cnt;
          else inProgress += cnt;
        }
      }
      const loggedHoursLast30d = logged30.get(u.id) ?? 0;
      const overload = this.computeOverload(inProgress + inQueue, loggedHoursLast30d);

      result.push({
        userId: u.id,
        userName: u.name,
        role: u.role,
        projectCount: projectCount.get(u.id) ?? 0,
        tasksInProgress: inProgress,
        tasksInQueue: inQueue,
        plannedHours: Math.round(plannedHours * 100) / 100,
        loggedHoursLast30d: Math.round(loggedHoursLast30d * 100) / 100,
        overload,
      });
    }

    return result;
  }

  /** Эвристика перегруза: green/yellow/red. */
  private computeOverload(activeTasks: number, hoursLast30d: number): RiskLevel {
    let score = 0;
    if (activeTasks > 8) score += 2;
    else if (activeTasks > 5) score += 1;
    if (hoursLast30d > 160) score += 2;       // > рабочий месяц
    else if (hoursLast30d > 120) score += 1;  // > 75% месяца
    if (score >= 3) return 'red';
    if (score >= 1) return 'yellow';
    return 'green';
  }

  /** Нагрузка PM-ов (опционально по конкретному pmId). */
  async getPmWorkload(pmId?: string): Promise<PmWorkload[]> {
    const pmRoles: UserRole[] = [
      UserRole.PROJECT_MANAGER,
      UserRole.HEAD_SMM,
      UserRole.ADMIN,
      UserRole.FOUNDER,
      UserRole.CO_FOUNDER,
    ];
    const qb = this.userRepo.createQueryBuilder('u')
      .where('u.role IN (:...roles)', { roles: pmRoles })
      .andWhere('u.isActive = true')
      .andWhere('u.isBlocked = false');
    if (pmId) qb.andWhere('u.id = :id', { id: pmId });
    const pms = await qb.getMany();
    if (pms.length === 0) return [];

    const pmIds = pms.map(p => p.id);

    // Проекты под управлением каждого PM (не архивные)
    const projRows: Array<{ managerId: string; cnt: string; ids: string[] }> = await this.projectRepo.manager.query(
      `SELECT "managerId", COUNT(*) AS cnt, ARRAY_AGG(id) AS ids
       FROM projects
       WHERE "isArchived" = false AND "managerId" = ANY($1::uuid[])
       GROUP BY "managerId"`,
      [pmIds],
    );
    const byPm = new Map<string, { cnt: number; ids: string[] }>(
      projRows.map(r => [r.managerId, { cnt: Number(r.cnt), ids: r.ids }]),
    );

    // Все project_ids под управлением PM-ов
    const allProjectIds = projRows.flatMap(r => r.ids);

    // Задачи на проверке / доработке по проектам
    let taskByPm: Array<{ projectId: string; status: string; cnt: string }> = [];
    if (allProjectIds.length > 0) {
      taskByPm = await this.taskRepo
        .createQueryBuilder('t')
        .select('t.projectId', 'projectId')
        .addSelect('t.status', 'status')
        .addSelect('COUNT(*)', 'cnt')
        .where('t.projectId IN (:...ids)', { ids: allProjectIds })
        .andWhere('t.status IN (:...statuses)', {
          statuses: [
            TaskStatus.REVIEW,
            TaskStatus.ON_PM_REVIEW,
            TaskStatus.RETURNED,
            TaskStatus.ON_REWORK,
          ],
        })
        .groupBy('t.projectId')
        .addGroupBy('t.status')
        .getRawMany();
    }

    // SMM-специалистов в проектах PM-а
    let smmRows: Array<{ managerId: string; cnt: string }> = [];
    if (pmIds.length > 0) {
      smmRows = await this.projectRepo.manager.query(
        `SELECT p."managerId" AS "managerId", COUNT(DISTINCT u.id) AS cnt
         FROM projects p
         JOIN project_members pm ON pm."projectsId" = p.id
         JOIN users u ON u.id = pm."usersId"
         WHERE p."isArchived" = false
           AND p."managerId" = ANY($1::uuid[])
           AND u.role IN ('smm_specialist','head_smm')
         GROUP BY p."managerId"`,
        [pmIds],
      );
    }
    const smmByPm = new Map<string, number>(smmRows.map(r => [r.managerId, Number(r.cnt)]));

    // projectsAtRisk: считаем дёшево — просрочки по nextPaymentDate ИЛИ paymentStatus=overdue
    const overdueRows: Array<{ managerId: string; cnt: string }> = await this.projectRepo.manager.query(
      `SELECT "managerId", COUNT(*) AS cnt
       FROM projects
       WHERE "isArchived" = false
         AND "managerId" = ANY($1::uuid[])
         AND ("paymentStatus" = 'overdue' OR ("nextPaymentDate" IS NOT NULL AND "nextPaymentDate" < NOW()))
       GROUP BY "managerId"`,
      [pmIds],
    );
    const overdueByPm = new Map<string, number>(overdueRows.map(r => [r.managerId, Number(r.cnt)]));

    // Свести в результат
    return pms.map(pm => {
      const projInfo = byPm.get(pm.id) ?? { cnt: 0, ids: [] };
      let onReview = 0;
      let onRework = 0;
      for (const row of taskByPm) {
        if (!projInfo.ids.includes(row.projectId)) continue;
        const cnt = Number(row.cnt);
        if (row.status === TaskStatus.REVIEW || row.status === TaskStatus.ON_PM_REVIEW) onReview += cnt;
        if (row.status === TaskStatus.RETURNED || row.status === TaskStatus.ON_REWORK) onRework += cnt;
      }
      return {
        pmId: pm.id,
        pmName: pm.name,
        projectCount: projInfo.cnt,
        smmSpecialistCount: smmByPm.get(pm.id) ?? 0,
        tasksOnReview: onReview,
        tasksOnRework: onRework,
        projectsAtRisk: overdueByPm.get(pm.id) ?? 0,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. RISK SCORING — PROJECTS
  // ─────────────────────────────────────────────────────────────────────

  /** Список рисков по всем активным проектам. */
  async getProjectRisks(): Promise<ProjectRisk[]> {
    const projects = await this.projectRepo.find({
      where: { isArchived: false },
      relations: ['manager'],
    });
    const out: ProjectRisk[] = [];
    for (const p of projects) {
      out.push(await this.computeProjectRisk(p));
    }
    // Сортируем: красные → жёлтые → зелёные
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /** Детальный риск-скор одного проекта (сразу с факторами и пояснениями). */
  async getProjectRiskDetail(projectId: string): Promise<ProjectRisk> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      relations: ['manager'],
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.computeProjectRisk(project);
  }

  private async computeProjectRisk(project: Project): Promise<ProjectRisk> {
    const factors: RiskFactor[] = [];

    // Факт. 1 — просрочка оплаты
    const isPaymentOverdue =
      project.paymentStatus === ProjectPaymentStatus.OVERDUE ||
      (project.nextPaymentDate && new Date(project.nextPaymentDate) < new Date() &&
       project.paymentStatus !== ProjectPaymentStatus.PAID);
    factors.push({
      key: 'payment_overdue',
      label: 'Просрочка оплаты',
      triggered: !!isPaymentOverdue,
      weight: 2,
    });

    // Подгрузка задач для следующих факторов
    const tasks = await this.taskRepo.find({ where: { projectId: project.id } });

    // Факт. 2 — много правок (avg reworkCount > 2)
    const tasksWithRework = tasks.filter(t => (t.reworkCount ?? 0) > 0);
    const avgRework = tasks.length > 0
      ? tasksWithRework.reduce((s, t) => s + (t.reworkCount ?? 0), 0) / tasks.length
      : 0;
    factors.push({
      key: 'many_revisions',
      label: 'Много правок',
      triggered: avgRework > 2,
      weight: 1,
      detail: `avg rework=${avgRework.toFixed(1)}`,
    });

    // Факт. 3 — отсутствие активности (нет updatedAt у задач за 7 дней)
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentTasks = tasks.filter(t => t.updatedAt && new Date(t.updatedAt) > cutoff7d);
    factors.push({
      key: 'no_activity_7d',
      label: 'Нет активности за неделю',
      triggered: recentTasks.length === 0 && tasks.length > 0,
      weight: 1,
    });

    // Факт. 4 — нет задач созданных за неделю
    const recentlyCreated = tasks.filter(t => t.createdAt && new Date(t.createdAt) > cutoff7d);
    factors.push({
      key: 'no_week_tasks',
      label: 'На неделю нет новых задач',
      triggered: recentlyCreated.length === 0,
      weight: 1,
    });

    // Факт. 5 — превышение лимита тарифа
    let tariffOveruse = false;
    if (project.tariffId && project.projectType === 'SMM') {
      const planFact = await this.getPlanFactRich(project.id);
      tariffOveruse = planFact.some(r => r.overuse > 0);
    }
    factors.push({
      key: 'tariff_overuse',
      label: 'Превышение лимита тарифа',
      triggered: tariffOveruse,
      weight: 2,
    });

    // Факт. 6 — перегруз команды (хотя бы один member с red)
    const memberIds = await this.projectRepo.manager.query(
      `SELECT "usersId" FROM project_members WHERE "projectsId" = $1`,
      [project.id],
    );
    const memberIdList = (memberIds as Array<{ usersId: string }>).map(r => r.usersId);
    let teamOverloaded = false;
    if (memberIdList.length > 0) {
      const workloads = await this.getEmployeeWorkload();
      teamOverloaded = workloads.some(w => memberIdList.includes(w.userId) && w.overload === 'red');
    }
    factors.push({
      key: 'team_overload',
      label: 'Перегружена команда',
      triggered: teamOverloaded,
      weight: 1,
    });

    // Факт. 7 — нет контент-плана для SMM-проекта с тарифом
    let noContentPlan = false;
    if (project.projectType === 'SMM' && project.tariffId) {
      const cnt = await this.cpiRepo.count({ where: { projectId: project.id } });
      noContentPlan = cnt === 0;
    }
    factors.push({
      key: 'no_content_plan',
      label: 'Нет контент-плана',
      triggered: noContentPlan,
      weight: 1,
    });

    const score = factors.reduce((s, f) => s + (f.triggered ? f.weight : 0), 0);
    const level: RiskLevel = score >= 5 ? 'red' : score >= 3 ? 'yellow' : 'green';

    return {
      projectId: project.id,
      projectName: project.name,
      managerId: project.managerId ?? null,
      managerName: project.manager?.name ?? null,
      level,
      score,
      factors,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. RISK SCORING — EMPLOYEES
  // ─────────────────────────────────────────────────────────────────────

  async getEmployeeRisks(): Promise<EmployeeRisk[]> {
    const users = await this.userRepo.find({
      where: { isActive: true, isBlocked: false },
    });
    const out: EmployeeRisk[] = [];
    for (const u of users) {
      out.push(await this.computeEmployeeRisk(u));
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  async getEmployeeRiskDetail(userId: string): Promise<EmployeeRisk> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    return this.computeEmployeeRisk(u);
  }

  private async computeEmployeeRisk(user: User): Promise<EmployeeRisk> {
    const factors: RiskFactor[] = [];
    const cutoff14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const tasks = await this.taskRepo.find({ where: { assigneeId: user.id } });
    const finished = tasks.filter(t => (FINISHED_TASK_STATUSES as string[]).includes(t.status));

    // Факт. 1 — низкая активность (0 завершено за 14 дней)
    const finishedRecent = finished.filter(t => t.updatedAt && new Date(t.updatedAt) > cutoff14d);
    factors.push({
      key: 'low_activity',
      label: 'Низкая активность (0 завершённых задач за 14 дней)',
      triggered: finishedRecent.length === 0 && tasks.length > 0,
      weight: 1,
    });

    // Факт. 2 — много возвратов (>30% задач имели rework > 0)
    const reworked = tasks.filter(t => (t.reworkCount ?? 0) > 0);
    const reworkRate = tasks.length > 0 ? reworked.length / tasks.length : 0;
    factors.push({
      key: 'high_rework_rate',
      label: 'Много возвратов на доработку',
      triggered: reworkRate > 0.3 && tasks.length >= 5,
      weight: 1,
      detail: `${Math.round(reworkRate * 100)}% задач возвращались`,
    });

    // Факт. 3 — частые переносы (rescheduled > 3 за 30 дней)
    const rescheduled = tasks.filter(
      t => t.status === TaskStatus.RESCHEDULED &&
        t.updatedAt && new Date(t.updatedAt) > cutoff30d,
    );
    factors.push({
      key: 'frequent_reschedules',
      label: 'Частые переносы дедлайнов',
      triggered: rescheduled.length > 3,
      weight: 1,
      detail: `${rescheduled.length} переносов за 30 дней`,
    });

    // Факт. 4 — низкая скорость (avg actualCompletionHours / estimatedHours > 1.5)
    const withBoth = finished.filter(t =>
      Number(t.actualCompletionHours) > 0 && Number(t.estimatedHours) > 0,
    );
    const avgRatio = withBoth.length > 0
      ? withBoth.reduce((s, t) => s + Number(t.actualCompletionHours) / Number(t.estimatedHours), 0) / withBoth.length
      : 1;
    factors.push({
      key: 'low_speed',
      label: 'Низкая скорость выполнения',
      triggered: avgRatio > 1.5 && withBoth.length >= 3,
      weight: 1,
      detail: `actual/estimated = ${avgRatio.toFixed(2)}`,
    });

    const score = factors.reduce((s, f) => s + (f.triggered ? f.weight : 0), 0);
    const level: RiskLevel = score >= 3 ? 'red' : score >= 1 ? 'yellow' : 'green';

    return {
      userId: user.id,
      userName: user.name,
      role: user.role,
      level,
      score,
      factors,
    };
  }
}
