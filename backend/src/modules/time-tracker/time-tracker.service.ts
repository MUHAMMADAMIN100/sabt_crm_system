import { projectListFields } from '../../common/project-list-fields';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeLog } from './time-log.entity';
import { Task } from '../tasks/task.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TaskViewer, assertTaskReadable, isPmForTask, loadTaskAccess } from '../tasks/task-access';

@Injectable()
export class TimeTrackerService {
  constructor(
    @InjectRepository(TimeLog) private repo: Repository<TimeLog>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private activityLog: ActivityLogService,
  ) {}

  /** Логировать время: исполнитель, со-исполнитель или руководитель своей
   *  сферы — в т.ч. dev_director и pm_dev, основной или второй ролью
   *  (15.11.2026: раньше PM-список был без руководителей разработки). */
  private async assertCanLogTo(taskId: string, userId: string, role: string, secondaryRole?: string | null) {
    const row = await loadTaskAccess(this.taskRepo.manager, taskId, userId);
    if (!row) throw new NotFoundException('Task not found');
    if (isPmForTask({ id: userId, role, secondaryRole }, row.projectType)) return;
    if (row.assigneeId !== userId && !row.co) {
      throw new ForbiddenException('Нельзя логировать время в чужую задачу');
    }
  }

  private async syncLoggedHours(taskId: string) {
    const result = await this.repo
      .createQueryBuilder('tl')
      .select('COALESCE(SUM(tl.timeSpent), 0)', 'total')
      .where('tl.taskId = :taskId AND tl.isRunning = false', { taskId })
      .getRawOne();
    const total = parseFloat(result?.total || '0');
    await this.taskRepo.update(taskId, { loggedHours: Math.round(total * 100) / 100 });
  }

  /** Время по задаче. С viewer — та же проверка доступа, что у карточки
   *  задачи (15.11.2026: раньше отдавали журнал любой задачи по id). */
  async findByTask(taskId: string, viewer?: TaskViewer) {
    if (viewer) await assertTaskReadable(this.taskRepo.manager, taskId, viewer);
    return this.repo.find({
      where: { taskId },
      relations: ['employee'],
      order: { date: 'DESC' },
    });
  }

  findByEmployee(employeeId: string, from?: string, to?: string) {
    const qb = this.repo.createQueryBuilder('tl')
      .leftJoinAndSelect('tl.task', 'task')
      .leftJoin('task.project', 'project').addSelect(projectListFields('project'))
      .where('tl.employeeId = :employeeId', { employeeId });
    if (from) qb.andWhere('tl.date >= :from', { from });
    if (to) qb.andWhere('tl.date <= :to', { to });
    return qb.orderBy('tl.date', 'DESC').getMany();
  }

  async startTimer(taskId: string, employeeId: string, role: string, secondaryRole?: string | null) {
    await this.assertCanLogTo(taskId, employeeId, role, secondaryRole);
    // Stop any running timers — и пересчитать часы задач, где они шли
    // (15.11.2026): раньше loggedHours прошлой задачи оставался без этого
    // отрезка, пока его не трогали снова.
    const running = await this.repo.find({ where: { employeeId, isRunning: true }, select: ['id', 'taskId'] as any });
    await this.repo.update(
      { employeeId, isRunning: true },
      { isRunning: false, timeSpent: () => 'EXTRACT(EPOCH FROM (NOW() - "timerStartedAt")) / 3600' },
    );
    for (const prevTaskId of new Set(running.map(r => r.taskId).filter(Boolean))) {
      await this.syncLoggedHours(prevTaskId);
    }

    const log = this.repo.create({
      taskId,
      employeeId,
      timeSpent: 0,
      date: new Date(),
      isRunning: true,
      timerStartedAt: new Date(),
    });
    const saved = await this.repo.save(log);

    await this.activityLog.log({
      userId: employeeId,
      action: ActivityAction.TIMER_START,
      entity: 'task',
      entityId: taskId,
      details: { timeLogId: saved.id },
    });

    return saved;
  }

  async stopTimer(employeeId: string) {
    const running = await this.repo.findOne({ where: { employeeId, isRunning: true } });
    if (!running) throw new NotFoundException('No running timer');

    const elapsed = (Date.now() - new Date(running.timerStartedAt).getTime()) / 3600000;
    running.timeSpent = Math.round(elapsed * 100) / 100;
    running.isRunning = false;
    const saved = await this.repo.save(running);
    await this.syncLoggedHours(running.taskId);

    await this.activityLog.log({
      userId: employeeId,
      action: ActivityAction.TIMER_STOP,
      entity: 'task',
      entityId: running.taskId,
      details: { timeSpent: saved.timeSpent },
    });

    return saved;
  }

  getRunningTimer(employeeId: string) {
    return this.repo.findOne({
      where: { employeeId, isRunning: true },
      relations: ['task'],
    });
  }

  async logTime(
    taskId: string, employeeId: string, role: string, timeSpent: number, date: string, description?: string,
    secondaryRole?: string | null,
  ) {
    await this.assertCanLogTo(taskId, employeeId, role, secondaryRole);
    if (timeSpent <= 0) throw new BadRequestException('Time must be positive');
    const log = this.repo.create({ taskId, employeeId, timeSpent, date: new Date(date), description });
    const saved = await this.repo.save(log);
    await this.syncLoggedHours(taskId);

    await this.activityLog.log({
      userId: employeeId,
      action: ActivityAction.TIME_LOG,
      entity: 'task',
      entityId: taskId,
      details: { timeSpent, date, description },
    });

    return saved;
  }

  async remove(id: string, userId: string, role: string, secondaryRole?: string | null) {
    const log = await this.repo.findOne({ where: { id } });
    if (!log) throw new NotFoundException('Time log not found');
    if (log.employeeId !== userId) {
      // Чужую запись удаляет только руководитель своей сферы.
      const row = log.taskId ? await loadTaskAccess(this.taskRepo.manager, log.taskId, userId) : null;
      if (!isPmForTask({ id: userId, role, secondaryRole }, row?.projectType)) {
        throw new ForbiddenException('Нельзя удалять чужие записи времени');
      }
    }
    await this.activityLog.log({
      userId: log.employeeId,
      action: ActivityAction.TIME_DELETE,
      entity: 'task',
      entityId: log.taskId,
      details: { timeLogId: id, timeSpent: log.timeSpent },
    });
    const taskId = log.taskId;
    await this.repo.delete(id);
    if (taskId) await this.syncLoggedHours(taskId);
    return { message: 'Time log deleted' };
  }

  async getTotalByTask(taskId: string, viewer?: TaskViewer) {
    // Проверка доступа к задаче (15.11.2026).
    if (viewer) await assertTaskReadable(this.taskRepo.manager, taskId, viewer);
    const result = await this.repo
      .createQueryBuilder('tl')
      .select('SUM(tl.timeSpent)', 'total')
      .where('tl.taskId = :taskId', { taskId })
      .getRawOne();
    return { total: parseFloat(result?.total || '0') };
  }

  async getSummaryByEmployee(employeeId: string, from: string, to: string) {
    return this.repo.createQueryBuilder('tl')
      .leftJoinAndSelect('tl.task', 'task')
      .leftJoinAndSelect('task.project', 'project')
      .select('project.name', 'projectName')
      .addSelect('task.title', 'taskTitle')
      .addSelect('SUM(tl.timeSpent)', 'totalHours')
      .where('tl.employeeId = :employeeId', { employeeId })
      .andWhere('tl.date BETWEEN :from AND :to', { from, to })
      .groupBy('project.name, task.title')
      .getRawMany();
  }
}
