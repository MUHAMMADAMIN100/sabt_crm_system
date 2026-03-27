import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyReport } from './daily-report.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(DailyReport) private repo: Repository<DailyReport>,
    private notificationsService: NotificationsService,
  ) {}

  findAll(filters: { employeeId?: string; projectId?: string; from?: string; to?: string }) {
    const qb = this.repo.createQueryBuilder('r')
      .leftJoinAndSelect('r.employee', 'employee')
      .leftJoinAndSelect('r.project', 'project')
      .leftJoinAndSelect('r.task', 'task');

    if (filters.employeeId) qb.andWhere('r.employeeId = :employeeId', { employeeId: filters.employeeId });
    if (filters.projectId) qb.andWhere('r.projectId = :projectId', { projectId: filters.projectId });
    if (filters.from) qb.andWhere('r.date >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('r.date <= :to', { to: filters.to });

    return qb.orderBy('r.date', 'DESC').getMany();
  }

  async findOne(id: string) {
    const report = await this.repo.findOne({
      where: { id },
      relations: ['employee', 'project', 'task'],
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async create(dto: any, userId: string) {
    const report = this.repo.create({ ...dto, employeeId: userId });
    const savedReport = await this.repo.save(report);
    
    // TypeORM save может вернуть массив или объект, обрабатываем оба случая
    const result = Array.isArray(savedReport) ? savedReport[0] : savedReport;

    // Notify managers
    await this.notificationsService.create({
      userId: userId,
      type: NotificationType.NEW_REPORT,
      title: 'Отчёт отправлен',
      message: `Ваш отчёт за ${dto.date} принят`,
      link: `/reports/${result.id}`,
    });

    return this.findOne(result.id);
  }

  async update(id: string, dto: any, userId: string) {
    const report = await this.findOne(id);
    if (report.employeeId !== userId) throw new NotFoundException('Not your report');
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.repo.delete(id);
    return { message: 'Report deleted' };
  }

  getMyReports(userId: string) {
    return this.repo.find({
      where: { employeeId: userId },
      relations: ['project', 'task'],
      order: { date: 'DESC' },
    });
  }
}
