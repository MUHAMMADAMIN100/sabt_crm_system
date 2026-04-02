import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, DataSource, FindOptionsWhere } from 'typeorm';
import { Employee, EmployeeStatus } from './employee.entity';
import { User } from '../users/user.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private activityLog: ActivityLogService,
    private dataSource: DataSource,
  ) {}

  findAll(search?: string, department?: string, status?: EmployeeStatus) {
    const where: FindOptionsWhere<Employee> = {};
    if (department) where.department = department;
    if (status) where.status = status;
    if (search) where.fullName = ILike(`%${search}%`);
    return this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['user'] });
  }

  async findOne(id: string) {
    const emp = await this.repo.findOne({ where: { id }, relations: ['user'] });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async create(dto: CreateEmployeeDto) {
    const emp = this.repo.create(dto);
    const saved = await this.repo.save(emp);

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_CREATE,
      entity: 'employee',
      entityId: saved.id,
      entityName: saved.fullName,
      details: { email: saved.email, position: saved.position, department: saved.department },
    });

    return saved;
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const emp = await this.findOne(id);
    await this.repo.update(id, dto);

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_UPDATE,
      entity: 'employee',
      entityId: id,
      entityName: emp.fullName,
      details: dto,
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    const emp = await this.findOne(id);
    const userId = emp.userId;

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_DELETE,
      entity: 'employee',
      entityId: id,
      entityName: emp.fullName,
      details: { email: emp.email },
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (userId) {
        // Снимаем назначение задач с этого пользователя
        await queryRunner.manager.query(
          `UPDATE tasks SET "assigneeId" = NULL WHERE "assigneeId" = $1`, [userId]
        );
        await queryRunner.manager.query(
          `UPDATE tasks SET "createdById" = NULL WHERE "createdById" = $1`, [userId]
        );
        // Удаляем связанные записи
        await queryRunner.manager.query(`DELETE FROM comments WHERE "authorId" = $1`, [userId]);
        await queryRunner.manager.query(`DELETE FROM time_logs WHERE "employeeId" = $1`, [userId]);
        await queryRunner.manager.query(`DELETE FROM daily_reports WHERE "employeeId" = $1`, [userId]);
        await queryRunner.manager.query(`DELETE FROM notifications WHERE "userId" = $1`, [userId]);
        await queryRunner.manager.query(`DELETE FROM work_sessions WHERE "userId" = $1`, [userId]);
        await queryRunner.manager.query(`DELETE FROM activity_logs WHERE "userId" = $1`, [userId]);
      }
      await queryRunner.manager.remove(Employee, emp);
      if (userId) {
        await queryRunner.manager.delete(User, userId);
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return { message: 'Employee deleted' };
  }

  async toggleSubAdmin(id: string) {
    const emp = await this.findOne(id);
    emp.isSubAdmin = !emp.isSubAdmin;
    const saved = await this.repo.save(emp);

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_SUB_ADMIN,
      entity: 'employee',
      entityId: id,
      entityName: emp.fullName,
      details: { isSubAdmin: saved.isSubAdmin },
    });

    return saved;
  }

  getDepartments() {
    return this.repo
      .createQueryBuilder('e')
      .select('DISTINCT e.department', 'department')
      .getRawMany();
  }

  getStats() {
    return this.repo
      .createQueryBuilder('e')
      .select('e.department', 'department')
      .addSelect('COUNT(*)', 'count')
      .addSelect('e.status', 'status')
      .groupBy('e.department, e.status')
      .getRawMany();
  }
}
