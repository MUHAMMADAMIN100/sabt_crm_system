import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeLog } from './time-log.entity';

@Injectable()
export class TimeTrackerService {
  constructor(@InjectRepository(TimeLog) private repo: Repository<TimeLog>) {}

  findByTask(taskId: string) {
    return this.repo.find({
      where: { taskId },
      relations: ['employee'],
      order: { date: 'DESC' },
    });
  }

  findByEmployee(employeeId: string, from?: string, to?: string) {
    const qb = this.repo.createQueryBuilder('tl')
      .leftJoinAndSelect('tl.task', 'task')
      .leftJoinAndSelect('task.project', 'project')
      .where('tl.employeeId = :employeeId', { employeeId });
    if (from) qb.andWhere('tl.date >= :from', { from });
    if (to) qb.andWhere('tl.date <= :to', { to });
    return qb.orderBy('tl.date', 'DESC').getMany();
  }

  async startTimer(taskId: string, employeeId: string) {
    // Stop any running timers
    await this.repo.update(
      { employeeId, isRunning: true },
      { isRunning: false, timeSpent: () => 'EXTRACT(EPOCH FROM (NOW() - "timerStartedAt")) / 3600' },
    );

    const log = this.repo.create({
      taskId,
      employeeId,
      timeSpent: 0,
      date: new Date(),
      isRunning: true,
      timerStartedAt: new Date(),
    });
    return this.repo.save(log);
  }

  async stopTimer(employeeId: string) {
    const running = await this.repo.findOne({ where: { employeeId, isRunning: true } });
    if (!running) throw new NotFoundException('No running timer');

    const elapsed = (Date.now() - new Date(running.timerStartedAt).getTime()) / 3600000;
    running.timeSpent = Math.round(elapsed * 100) / 100;
    running.isRunning = false;
    return this.repo.save(running);
  }

  getRunningTimer(employeeId: string) {
    return this.repo.findOne({
      where: { employeeId, isRunning: true },
      relations: ['task'],
    });
  }

  async logTime(taskId: string, employeeId: string, timeSpent: number, date: string, description?: string) {
    if (timeSpent <= 0) throw new BadRequestException('Time must be positive');
    const log = this.repo.create({ taskId, employeeId, timeSpent, date: new Date(date), description });
    return this.repo.save(log);
  }

  async remove(id: string) {
    await this.repo.delete(id);
    return { message: 'Time log deleted' };
  }

  async getTotalByTask(taskId: string) {
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
