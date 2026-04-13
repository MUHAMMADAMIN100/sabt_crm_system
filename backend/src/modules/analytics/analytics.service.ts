import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Task, TaskStatus } from '../tasks/task.entity';
import { Project, ProjectStatus } from '../projects/project.entity';
import { ProjectPayment } from '../projects/payment.entity';
import { User } from '../users/user.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { SalaryHistory } from '../employees/salary-history.entity';
import { WorkSession } from '../auth/work-session.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(TimeLog) private timeRepo: Repository<TimeLog>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(WorkSession) private sessionRepo: Repository<WorkSession>,
    @InjectRepository(SalaryHistory) private salaryHistoryRepo: Repository<SalaryHistory>,
    @InjectRepository(ProjectPayment) private paymentRepo: Repository<ProjectPayment>,
  ) {}

  async getDashboardOverview() {
    const [counts, hoursRow] = await Promise.all([
      this.taskRepo.manager.query(`
        SELECT
          (SELECT COUNT(*)::int FROM projects WHERE "isArchived" = false)                                        AS "totalProjects",
          (SELECT COUNT(*)::int FROM projects WHERE status = 'in_progress' AND "isArchived" = false)            AS "activeProjects",
          (SELECT COUNT(*)::int FROM tasks)                                                                     AS "totalTasks",
          (SELECT COUNT(*)::int FROM tasks WHERE status = 'done')                                              AS "doneTasks",
          (SELECT COUNT(*)::int FROM employees)                                                                 AS "totalEmployees",
          (SELECT COUNT(*)::int FROM users WHERE "isActive" = true)                                            AS "totalUsers",
          (SELECT COUNT(*)::int FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled'))      AS "overdueTasks"
      `),
      this.timeRepo
        .createQueryBuilder('tl')
        .select('SUM(tl.timeSpent)', 'total')
        .where("DATE_TRUNC('month', tl.date) = DATE_TRUNC('month', NOW())")
        .getRawOne(),
    ]);

    const c = counts?.[0] || {};
    return {
      totalProjects: c.totalProjects || 0,
      activeProjects: c.activeProjects || 0,
      totalTasks: c.totalTasks || 0,
      doneTasks: c.doneTasks || 0,
      completionRate: c.totalTasks ? Math.round((c.doneTasks / c.totalTasks) * 100) : 0,
      totalEmployees: c.totalEmployees || 0,
      totalUsers: c.totalUsers || 0,
      overdueTasks: c.overdueTasks || 0,
      hoursThisMonth: parseFloat(hoursRow?.total || '0'),
    };
  }

  async getProjectsByStatus() {
    return this.projectRepo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('p.isArchived = false')
      .groupBy('p.status')
      .getRawMany();
  }

  async getTasksByStatus() {
    return this.taskRepo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status')
      .getRawMany();
  }

  async getTasksByPriority() {
    return this.taskRepo
      .createQueryBuilder('t')
      .select('t.priority', 'priority')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.priority')
      .getRawMany();
  }

  async getEmployeeActivity(from?: string, to?: string) {
    // Default to TODAY only — chart resets daily
    const today = new Date().toISOString().split('T')[0];
    const fromDate = from || today;
    const toDate = to || today;

    const qb = this.sessionRepo
      .createQueryBuilder('ws')
      .leftJoin('ws.user', 'u')
      .leftJoin(Employee, 'emp', 'emp.userId = u.id')
      .select('COALESCE(emp.fullName, u.name)', 'name')
      .addSelect('u.id', 'id')
      .addSelect('SUM(ws.durationHours)', 'totalHours')
      .where('ws.logoutAt IS NOT NULL')
      .andWhere('ws.date >= :fromDate', { fromDate })
      .andWhere('ws.date <= :toDate', { toDate })
      .groupBy('u.id, u.name, emp.fullName')
      .orderBy('"totalHours"', 'DESC')
      .limit(10);

    const data = await qb.getRawMany();
    return data.map(d => ({ ...d, totalHours: parseFloat(d.totalHours || '0') }));
  }

  async getHoursPerDay(employeeId?: string, days = 30) {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const qb = this.timeRepo
      .createQueryBuilder('tl')
      .select('tl.date::date', 'date')
      .addSelect('SUM(tl.timeSpent)', 'hours')
      .where("tl.date >= NOW() - make_interval(days => :days)", { days: safeDays })
      .groupBy('tl.date::date')
      .orderBy('tl.date::date', 'ASC');

    if (employeeId) qb.andWhere('tl.employeeId = :employeeId', { employeeId });

    const data = await qb.getRawMany();
    return data.map(d => ({ ...d, hours: parseFloat(d.hours || '0') }));
  }

  async getProjectsPerformance(page = 1, limit = 10) {
    const [projects, total] = await this.projectRepo.findAndCount({
      where: { isArchived: false },
      relations: ['members', 'tasks'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    const data = projects.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      progress: p.progress,
      taskCount: p.tasks?.length || 0,
      doneTasks: p.tasks?.filter(t => t.status === TaskStatus.DONE).length || 0,
      members: p.members?.map(m => ({ id: m.id, name: m.name, avatar: m.avatar })) || [],
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getEmployeeEfficiency(page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const data = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin(Employee, 'e', 'e.userId = u.id AND e.status = :empStatus', { empStatus: 'active' })
      .leftJoin('u.tasks', 't')
      .leftJoin('u.timeLogs', 'tl')
      .select('u.id', 'id')
      .addSelect('e.id', 'employeeEntityId')
      .addSelect('u.name', 'name')
      .addSelect('e.fullName', 'fullName')
      .addSelect('e.position', 'position')
      .addSelect('COUNT(DISTINCT t.id)', 'totalTasks')
      .addSelect("SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)", 'doneTasks')
      .addSelect('SUM(tl.timeSpent)', 'totalHours')
      .where('u.isActive = true')
      .andWhere('u.role NOT IN (:...adminRoles)', { adminRoles: ['admin', 'founder'] })
      .groupBy('u.id, u.name, e.fullName, e.position, e.id')
      .orderBy('"doneTasks"', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany();

    const totalCount = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin(Employee, 'e', 'e.userId = u.id AND e.status = :empStatus', { empStatus: 'active' })
      .where('u.isActive = true')
      .andWhere('u.role NOT IN (:...adminRoles)', { adminRoles: ['admin', 'founder'] })
      .getCount();

    const mapped = data.map(d => ({
      ...d,
      name: d.fullName || d.name,
      employeeEntityId: d.employeeEntityId,
      totalHours: parseFloat(d.totalHours || '0'),
      doneTasks: parseInt(d.doneTasks || '0'),
      totalTasks: parseInt(d.totalTasks || '0'),
    }));

    return { data: mapped, total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) };
  }

  async getEmployeeWorkload() {
    const data = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin(Employee, 'e', 'e.userId = u.id AND e.status = :empStatus', { empStatus: 'active' })
      .leftJoin('u.tasks', 't', "t.status NOT IN ('done','cancelled')")
      .select('u.id', 'id')
      .addSelect('u.name', 'name')
      .addSelect('e.fullName', 'fullName')
      .addSelect('e.position', 'position')
      .addSelect('e.department', 'department')
      .addSelect('u.avatar', 'avatar')
      .addSelect('COUNT(DISTINCT t.id)', 'activeTasks')
      .addSelect("SUM(CASE WHEN t.priority = 'critical' THEN 1 ELSE 0 END)", 'criticalTasks')
      .addSelect("SUM(CASE WHEN t.deadline < NOW() AND t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END)", 'overdueTasks')
      .where('u.isActive = true')
      .andWhere('u.role NOT IN (:...adminRoles)', { adminRoles: ['admin', 'founder'] })
      .groupBy('u.id, u.name, e.fullName, e.position, e.department, u.avatar')
      .orderBy('"activeTasks"', 'DESC')
      .getRawMany();

    return data.map(d => ({
      id: d.id,
      name: d.fullName || d.name,
      position: d.position,
      department: d.department,
      avatar: d.avatar,
      activeTasks: parseInt(d.activeTasks || '0'),
      criticalTasks: parseInt(d.criticalTasks || '0'),
      overdueTasks: parseInt(d.overdueTasks || '0'),
    }));
  }

  async getMonthlyReport(year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = new Date(year, month, 0).toISOString().split('T')[0];

    const [projectsData, tasksData, hoursData] = await Promise.all([
      this.projectRepo
        .createQueryBuilder('p')
        .where('p.createdAt BETWEEN :from AND :to', { from, to })
        .getCount(),
      this.taskRepo
        .createQueryBuilder('t')
        .select('t.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('t.createdAt BETWEEN :from AND :to', { from, to })
        .groupBy('t.status')
        .getRawMany(),
      this.timeRepo
        .createQueryBuilder('tl')
        .select('SUM(tl.timeSpent)', 'total')
        .where('tl.date BETWEEN :from AND :to', { from, to })
        .getRawOne(),
    ]);

    return {
      period: { from, to, year, month },
      newProjects: projectsData,
      tasksByStatus: tasksData,
      totalHours: parseFloat(hoursData?.total || '0'),
    };
  }

  async getDepartmentStats() {
    return this.employeeRepo
      .createQueryBuilder('e')
      .select('e.department', 'department')
      .addSelect('COUNT(*)', 'count')
      .addSelect('e.status', 'status')
      .groupBy('e.department, e.status')
      .orderBy('count', 'DESC')
      .getRawMany();
  }

  /** Compute total payroll cost for a date range using salary history.
   *  For each employee, sum (effective monthly salary at month M) for every
   *  month that intersects [from, to]. Falls back to current employee.salary
   *  if the employee has no history records (legacy data before tracking). */
  private async computePayrollForPeriod(
    employees: Employee[],
    from: Date,
    to: Date,
  ): Promise<number> {
    if (!employees.length) return 0;

    // Compute the list of (year, month) buckets between from and to inclusive
    const months: { y: number; m: number }[] = [];
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cur <= end) {
      months.push({ y: cur.getFullYear(), m: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    if (months.length === 0) return 0;

    // Load all salary history rows for these employees, ordered by date desc
    const history = await this.salaryHistoryRepo.find({
      where: { employeeId: In(employees.map(e => e.id)) },
      order: { effectiveFrom: 'DESC' },
    });
    const byEmp: Record<string, SalaryHistory[]> = {};
    for (const h of history) {
      (byEmp[h.employeeId] ||= []).push(h);
    }

    let total = 0;
    for (const emp of employees) {
      const empHistory = byEmp[emp.id] || [];
      for (const { y, m } of months) {
        // Effective salary on the FIRST day of this month
        const monthStart = new Date(y, m, 1);
        // Find the most recent history record with effectiveFrom <= monthStart
        const effective = empHistory.find(h => new Date(h.effectiveFrom) <= monthStart);
        const salaryThatMonth = effective ? Number(effective.salary) : Number(emp.salary || 0);
        total += salaryThatMonth;
      }
    }
    return total;
  }

  /** Founder's payroll & revenue dashboard.
   *  - Without period: returns lifetime totals (legacy behavior).
   *  - With period (from/to ISO yyyy-MM-dd): revenue from project_payments
   *    in the window, payroll from salary_history per month in the window. */
  async getPayrollStats(fromStr?: string, toStr?: string) {
    const employees = await this.employeeRepo.find({
      where: { status: EmployeeStatus.ACTIVE },
      relations: ['user'],
    });

    // Include both active and archived projects when looking at history,
    // because completed projects should still show up in revenue reports.
    const projects = await this.projectRepo.find({
      select: ['id', 'name', 'budget', 'paidAmount', 'status', 'endDate', 'isArchived'],
    });

    const monthlyPayroll = employees.reduce((sum, e) => sum + Number(e.salary || 0), 0);
    const totalBudget = projects.reduce((sum, p) => sum + Number(p.budget || 0), 0);
    const lifetimePaid = projects.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);

    let from: Date | null = null;
    let to: Date | null = null;
    let revenueForPeriod = 0;
    let payrollForPeriod = 0;
    let projectsInPeriod = projects;
    let paymentsList: Array<{ id: string; projectId: string; projectName: string; amount: number; paidAt: string; note: string | null }> = [];

    if (fromStr && toStr) {
      from = new Date(fromStr + 'T00:00:00');
      to = new Date(toStr + 'T23:59:59');

      const periodPayments = await this.paymentRepo.find({
        where: { paidAt: Between(from, to) },
        relations: ['project'],
        order: { paidAt: 'DESC' },
      });
      revenueForPeriod = periodPayments.reduce((s, p) => s + Number(p.amount), 0);
      paymentsList = periodPayments.map(p => ({
        id: p.id,
        projectId: p.projectId,
        projectName: p.project?.name || '—',
        amount: Number(p.amount),
        paidAt: new Date(p.paidAt).toISOString().slice(0, 10),
        note: p.note,
      }));

      payrollForPeriod = await this.computePayrollForPeriod(employees, from, to);

      // Per-project totals: sum payments per project IN PERIOD
      const projectPaidInPeriod: Record<string, number> = {};
      for (const p of periodPayments) {
        projectPaidInPeriod[p.projectId] = (projectPaidInPeriod[p.projectId] || 0) + Number(p.amount);
      }
      projectsInPeriod = projects
        .filter(p => projectPaidInPeriod[p.id] !== undefined || (!p.isArchived))
        .map(p => ({
          ...p,
          paidAmount: projectPaidInPeriod[p.id] !== undefined ? projectPaidInPeriod[p.id] : Number(p.paidAmount || 0),
        }) as any);
    }

    const employeeList = employees.map(e => ({
      id: e.id,
      userId: e.userId,
      fullName: e.fullName,
      position: e.position,
      department: e.department,
      salary: Number(e.salary || 0),
      avatar: e.user?.avatar || null,
    }));

    return {
      // Period info
      from: fromStr || null,
      to: toStr || null,
      // Aggregates always present
      monthlyPayroll,
      totalPayroll: monthlyPayroll, // legacy alias
      totalBudget,
      lifetimePaid,
      // Period-specific (zeros if no period)
      revenueForPeriod,
      payrollForPeriod,
      profitForPeriod: revenueForPeriod - payrollForPeriod,
      // Lists
      employeeCount: employees.length,
      employeeList,
      projects: projectsInPeriod.map((p: any) => ({
        id: p.id,
        name: p.name,
        budget: Number(p.budget) || 0,
        status: p.status,
        paidAmount: Number(p.paidAmount) || 0,
        endDate: p.endDate,
        isArchived: p.isArchived,
      })),
      payments: paymentsList,
    };
  }

  async getAvgCompletionTime(): Promise<{ avgHours: number; avgDays: number; totalDone: number }> {
    const row = await this.taskRepo.manager.query(`
      SELECT
        COUNT(*)::int AS "totalDone",
        COALESCE(
          AVG(EXTRACT(EPOCH FROM ("reviewedAt" - "createdAt")) / 3600),
          0
        ) AS "avgHours"
      FROM tasks
      WHERE status = 'done'
        AND "reviewedAt" IS NOT NULL
        AND "createdAt" IS NOT NULL
    `);
    const avgHours = parseFloat(row[0]?.avgHours || '0');
    return {
      avgHours: Math.round(avgHours),
      avgDays: Math.round(avgHours / 24 * 10) / 10,
      totalDone: row[0]?.totalDone ?? 0,
    };
  }
}
