import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from '../tasks/task.entity';
import { Project, ProjectStatus } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Employee } from '../employees/employee.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(TimeLog) private timeRepo: Repository<TimeLog>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {}

  async getDashboardOverview() {
    const [
      totalProjects,
      activeProjects,
      totalTasks,
      doneTasks,
      totalEmployees,
      totalUsers,
    ] = await Promise.all([
      this.projectRepo.count({ where: { isArchived: false } }),
      this.projectRepo.count({ where: { status: ProjectStatus.IN_PROGRESS, isArchived: false } }),
      this.taskRepo.count(),
      this.taskRepo.count({ where: { status: TaskStatus.DONE } }),
      this.employeeRepo.count(),
      this.userRepo.count({ where: { isActive: true } }),
    ]);

    const overdueTasks = await this.taskRepo
      .createQueryBuilder('t')
      .where('t.deadline < NOW()')
      .andWhere('t.status NOT IN (:...statuses)', { statuses: [TaskStatus.DONE, TaskStatus.CANCELLED] })
      .getCount();

    const hoursThisMonth = await this.timeRepo
      .createQueryBuilder('tl')
      .select('SUM(tl.timeSpent)', 'total')
      .where("DATE_TRUNC('month', tl.date) = DATE_TRUNC('month', NOW())")
      .getRawOne();

    return {
      totalProjects,
      activeProjects,
      totalTasks,
      doneTasks,
      completionRate: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
      totalEmployees,
      totalUsers,
      overdueTasks,
      hoursThisMonth: parseFloat(hoursThisMonth?.total || '0'),
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
    const qb = this.timeRepo
      .createQueryBuilder('tl')
      .leftJoin('tl.employee', 'emp')
      .select('emp.name', 'name')
      .addSelect('emp.id', 'id')
      .addSelect('SUM(tl.timeSpent)', 'totalHours')
      .addSelect('COUNT(DISTINCT tl.taskId)', 'taskCount')
      .groupBy('emp.id, emp.name')
      .orderBy('"totalHours"', 'DESC')
      .limit(10);

    if (from) qb.andWhere('tl.date >= :from', { from });
    if (to) qb.andWhere('tl.date <= :to', { to });

    const data = await qb.getRawMany();
    return data.map(d => ({ ...d, totalHours: parseFloat(d.totalHours || '0') }));
  }

  async getHoursPerDay(employeeId?: string, days = 30) {
    const qb = this.timeRepo
      .createQueryBuilder('tl')
      .select('tl.date::date', 'date')
      .addSelect('SUM(tl.timeSpent)', 'hours')
      .where("tl.date >= NOW() - INTERVAL ':days days'", { days })
      .groupBy('tl.date::date')
      .orderBy('tl.date::date', 'ASC');

    if (employeeId) qb.andWhere('tl.employeeId = :employeeId', { employeeId });

    const data = await qb.getRawMany();
    return data.map(d => ({ ...d, hours: parseFloat(d.hours || '0') }));
  }

  async getProjectsPerformance() {
    return this.projectRepo
      .createQueryBuilder('p')
      .leftJoin('p.tasks', 't')
      .select('p.id', 'id')
      .addSelect('p.name', 'name')
      .addSelect('p.status', 'status')
      .addSelect('p.progress', 'progress')
      .addSelect('COUNT(t.id)', 'taskCount')
      .addSelect("SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)", 'doneTasks')
      .where('p.isArchived = false')
      .groupBy('p.id, p.name, p.status, p.progress')
      .orderBy('p.createdAt', 'DESC')
      .limit(10)
      .getRawMany();
  }

  async getEmployeeEfficiency() {
    return this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.tasks', 't')
      .leftJoin('u.timeLogs', 'tl')
      .select('u.id', 'id')
      .addSelect('u.name', 'name')
      .addSelect('COUNT(DISTINCT t.id)', 'totalTasks')
      .addSelect("SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)", 'doneTasks')
      .addSelect('SUM(tl.timeSpent)', 'totalHours')
      .where('u.isActive = true')
      .groupBy('u.id, u.name')
      .orderBy('"doneTasks"', 'DESC')
      .limit(10)
      .getRawMany();
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
