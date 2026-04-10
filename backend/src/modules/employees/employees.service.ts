import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, DataSource, FindOptionsWhere } from 'typeorm';
import { Employee, EmployeeStatus } from './employee.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { AppGateway } from '../gateway/app.gateway';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private activityLog: ActivityLogService,
    private dataSource: DataSource,
    private gateway: AppGateway,
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
    // Проверяем дубликат email в employees
    const existing = await this.repo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Сотрудник с таким email уже существует');

    // Resolve role: explicit > position-derived > default EMPLOYEE
    const explicitRole = (dto as any).role as UserRole | undefined;
    const derivedRole = this.positionToRole(dto.position);
    const newRole = explicitRole || derivedRole || UserRole.EMPLOYEE;

    // Ищем существующего User по email, если нет — создаём
    let savedUser = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!savedUser) {
      const user = this.userRepo.create({
        name: dto.fullName,
        email: dto.email,
        password: 'Sabt@2024',
        role: newRole,
      });
      savedUser = await this.userRepo.save(user);
    } else if (savedUser.role !== newRole) {
      // Update existing user's role to match
      await this.userRepo.update(savedUser.id, { role: newRole });
    }

    const { role: _r, ...empDto } = dto as any;
    const emp = this.repo.create({ ...empDto, userId: savedUser.id } as Partial<Employee>);
    const saved = await this.repo.save(emp as Employee);

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_CREATE,
      entity: 'employee',
      entityId: saved.id,
      entityName: saved.fullName,
      details: { email: saved.email, position: saved.position, department: saved.department },
    });

    this.gateway.broadcast('employees:changed', {});
    return saved;
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const emp = await this.findOne(id);

    // Strip role from dto before updating employee (role belongs to User)
    const { role: newRole, ...empDto } = dto as any;
    await this.repo.update(id, empDto);

    // Синхронизируем User: обновляем все общие поля + role
    if (emp.userId) {
      const userUpdate: Partial<User> = {};
      if (dto.fullName) userUpdate.name = dto.fullName;
      if (dto.email) userUpdate.email = dto.email;
      if ((dto as any).avatar !== undefined) userUpdate.avatar = (dto as any).avatar;
      if (dto.status !== undefined) userUpdate.isActive = dto.status === 'active';

      // Determine new role: explicit role param > position-derived
      let resolvedRole: UserRole | undefined;
      if (newRole) {
        resolvedRole = newRole as UserRole;
      } else if (dto.position) {
        resolvedRole = this.positionToRole(dto.position);
      }
      if (resolvedRole) userUpdate.role = resolvedRole;

      if (Object.keys(userUpdate).length > 0) {
        await this.userRepo.update(emp.userId, userUpdate);
        // Notify the affected user that their profile/role changed
        this.gateway.notifyUser(emp.userId, 'me:changed', userUpdate);
      }
    }

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_UPDATE,
      entity: 'employee',
      entityId: id,
      entityName: emp.fullName,
      details: dto,
    });

    this.gateway.broadcast('employees:changed', {});
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

    this.gateway.broadcast('employees:changed', {});
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

  /** Maps a Russian position string to a UserRole enum value */
  private positionToRole(position: string): UserRole | undefined {
    if (!position) return undefined;
    const map: Record<string, UserRole> = {
      'SMM специалист':       UserRole.SMM_SPECIALIST,
      'SMM-специалист':       UserRole.SMM_SPECIALIST,
      'Дизайнер':             UserRole.DESIGNER,
      'Таргетолог':           UserRole.TARGETOLOGIST,
      'Менеджер по продажам': UserRole.SALES_MANAGER,
      'Маркетолог':           UserRole.MARKETER,
      'Проект-менеджер':      UserRole.PROJECT_MANAGER,
      'Project Manager':      UserRole.PROJECT_MANAGER,
      'Разработчик':          UserRole.DEVELOPER,
      'Developer':            UserRole.DEVELOPER,
      'Основатель':           UserRole.FOUNDER,
      'Founder':              UserRole.FOUNDER,
      'Сотрудник':            UserRole.EMPLOYEE,
      'Администратор':        UserRole.ADMIN,
    };
    return map[position.trim()];
  }
}
