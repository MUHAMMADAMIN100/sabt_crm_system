import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from '../tasks/task.entity';
import { Project, ProjectStatus } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Employee } from '../employees/employee.entity';
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
  ) {}

  async getDashboardOverview() {
    const [counts, hoursRow] = await Promise.all([
      this.taskRepo.manager.query(`
        SELECT
          (SELECT COUNT(*)::int FROM projects WHERE is_archived = false)                                        AS "totalProjects",
          (SELECT COUNT(*)::int FROM projects WHERE status = 'in_progress' AND is_archived = false)            AS "activeProjects",
          (SELECT COUNT(*)::int FROM tasks)                                                                     AS "totalTasks",
          (SELECT COUNT(*)::int FROM tasks WHERE status = 'done')                                              AS "doneTasks",
          (SELECT COUNT(*)::int FROM employees)                                                                 AS "totalEmployees",
          (SELECT COUNT(*)::int FROM users WHERE is_active = true)                                             AS "totalUsers",
          (SELECT COUNT(*)::int FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled'))      AS "overdueTasks"
      `),
      this.timeRepo
        .createQueryBuilder('tl')
        .select('SUM(tl.timeSpent)', 'total')
        .where("DATE_TRUNC('month', tl.date) = DATE_TRUNC('month', NOW())")
        .getRawOne(),
    ]);

    const c = counts[0];
    return {
      totalProjects: c.totalProjects,
      activeProjects: c.activeProjects,
      totalTasks: c.totalTasks,
      doneTasks: c.doneTasks,
      completionRate: c.totalTasks ? Math.round((c.doneTasks / c.totalTasks) * 100) : 0,
      totalEmployees: c.totalEmployees,
      totalUsers: c.totalUsers,
      overdueTasks: c.overdueTasks,
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
    const qb = this.sessionRepo
      .createQueryBuilder('ws')
      .leftJoin('ws.user', 'u')
      .leftJoin(Employee, 'emp', 'emp.userId = u.id')
      .select('COALESCE(emp.fullName, u.name)', 'name')
      .addSelect('u.id', 'id')
      .addSelect('SUM(ws.durationHours)', 'totalHours')
      .where('ws.logoutAt IS NOT NULL')
      .groupBy('u.id, u.name, emp.fullName')
      .orderBy('"totalHours"', 'DESC')
      .limit(10);

    if (from) qb.andWhere('ws.date >= :from', { from });
    if (to) qb.andWhere('ws.date <= :to', { to });

    const data = await qb.getRawMany();
    return data.map(d => ({ ...d, totalHours: parseFloat(d.totalHours || '0') }));
  }

  async getHoursPerDay(employeeId?: string, days = 30) {
    const qb = this.timeRepo
      .createQueryBuilder('tl')
      .select('tl.date::date', 'date')
      .addSelect('SUM(tl.timeSpent)', 'hours')
      .where("tl.date >= NOW() - (:days || ' days')::interval", { days })
      .groupBy('tl.date::date')
      .orderBy('tl.date::date', 'ASC');

    if (employeeId) qb.andWhere('tl.employeeId = :employeeId', { employeeId });

    const data = await qb.getRawMany();
    return data.map(d => ({ ...d, hours: parseFloat(d.hours || '0') }));
  }

  async getProjectsPerformance(page = 1, limit = 9) {
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

  async getEmployeeEfficiency(page = 1, limit = 9) {
    const offset = (page - 1) * limit;
    const data = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin(Employee, 'e', 'e.userId = u.id AND e.status = :empStatus', { empStatus: 'active' })
      .leftJoin('u.tasks', 't')
      .leftJoin('u.timeLogs', 'tl')
      .select('u.id', 'id')
      .addSelect('u.name', 'name')
      .addSelect('e.fullName', 'fullName')
      .addSelect('e.position', 'position')
      .addSelect('COUNT(DISTINCT t.id)', 'totalTasks')
      .addSelect("SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)", 'doneTasks')
      .addSelect('SUM(tl.timeSpent)', 'totalHours')
      .where('u.isActive = true')
      .andWhere('u.role = :role', { role: 'employee' })
      .groupBy('u.id, u.name, e.fullName, e.position')
      .orderBy('"doneTasks"', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany();

    const totalCount = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin(Employee, 'e', 'e.userId = u.id AND e.status = :empStatus', { empStatus: 'active' })
      .where('u.isActive = true')
      .andWhere('u.role = :role', { role: 'employee' })
      .getCount();

    const mapped = data.map(d => ({
      ...d,
      name: d.fullName || d.name,
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
      .andWhere('u.role = :role', { role: 'employee' })
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
}
