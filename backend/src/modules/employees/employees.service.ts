import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, DataSource, FindOptionsWhere } from 'typeorm';
import { Employee, EmployeeStatus } from './employee.entity';
import { SalaryHistory } from './salary-history.entity';
import { User, UserRole } from '../users/user.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { AppGateway } from '../gateway/app.gateway';
import { MailService } from '../mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  founder: 'Основатель',
  project_manager: 'Проект-менеджер',
  head_smm: 'Главный SMM специалист',
  smm_specialist: 'SMM специалист',
  designer: 'Дизайнер',
  targetologist: 'Таргетолог',
  sales_manager: 'Менеджер по продажам',
  marketer: 'Маркетолог',
  developer: 'Разработчик',
  employee: 'Сотрудник',
};

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(SalaryHistory) private salaryHistoryRepo: Repository<SalaryHistory>,
    private activityLog: ActivityLogService,
    private dataSource: DataSource,
    private gateway: AppGateway,
    private mailService: MailService,
    private telegramService: TelegramService,
  ) {}

  /** Strip salary from employee(s) for non-founder users */
  private stripSalary<T extends Employee | Employee[]>(data: T, role?: string): T {
    if (role === 'founder') return data;
    const strip = (e: any) => { if (e) delete e.salary; return e; };
    return Array.isArray(data) ? (data.map(strip) as T) : (strip(data) as T);
  }

  async findAll(search?: string, department?: string, status?: EmployeeStatus, requestUserRole?: string) {
    const where: FindOptionsWhere<Employee> = {};
    if (department) where.department = department;
    if (status) where.status = status;
    if (search) where.fullName = ILike(`%${search}%`);
    const list = await this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['user'] });
    return this.stripSalary(list, requestUserRole);
  }

  async findOne(id: string, requestUserRole?: string) {
    const emp = await this.repo.findOne({ where: { id }, relations: ['user'] });
    if (!emp) throw new NotFoundException('Employee not found');
    return requestUserRole ? this.stripSalary(emp, requestUserRole) : emp;
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

  async update(id: string, dto: UpdateEmployeeDto, actor?: { id: string; name?: string; role?: string }) {
    const emp = await this.findOne(id);
    const oldPosition = emp.position;
    const oldSalary = Number(emp.salary || 0);
    const oldUser = emp.userId ? await this.userRepo.findOne({ where: { id: emp.userId } }) : null;
    const oldRole = oldUser?.role;

    // Strip role from dto before updating employee (role belongs to User)
    const { role: newRoleParam, ...empDto } = dto as any;
    await this.repo.update(id, empDto);

    // ── Record salary history if salary actually changed ──────────────
    if (dto.salary !== undefined && Number(dto.salary) !== oldSalary) {
      await this.salaryHistoryRepo.save(this.salaryHistoryRepo.create({
        employeeId: id,
        salary: Number(dto.salary),
        effectiveFrom: new Date(),
        changedById: actor?.id,
      }));
    }

    // Синхронизируем User: обновляем все общие поля + role
    let resolvedRole: UserRole | undefined;
    let positionDidntMatchRole = false;

    if (emp.userId) {
      const userUpdate: Partial<User> = {};
      if (dto.fullName) userUpdate.name = dto.fullName;
      if (dto.email) userUpdate.email = dto.email;
      if ((dto as any).avatar !== undefined) userUpdate.avatar = (dto as any).avatar;
      if (dto.status !== undefined) userUpdate.isActive = dto.status === 'active';

      // Determine new role: explicit role param > position-derived
      if (newRoleParam) {
        // Only founder can explicitly set admin/founder role
        if ([UserRole.ADMIN, UserRole.FOUNDER].includes(newRoleParam as UserRole) && actor?.role !== 'founder') {
          // Silently ignore escalation attempts from non-founder
        } else {
          resolvedRole = newRoleParam as UserRole;
        }
      } else if (dto.position && dto.position !== oldPosition) {
        const derived = this.positionToRole(dto.position);
        // Block escalation to admin/founder through position text — only explicit role
        // param from founder can grant these. Ignore silently, flag as unmatched.
        if (derived && ![UserRole.ADMIN, UserRole.FOUNDER].includes(derived)) {
          resolvedRole = derived;
        } else if (!derived) {
          positionDidntMatchRole = true;
        }
      }
      if (resolvedRole) userUpdate.role = resolvedRole;

      if (Object.keys(userUpdate).length > 0) {
        await this.userRepo.update(emp.userId, userUpdate);
        this.gateway.notifyUser(emp.userId, 'me:changed', userUpdate);
      }
    }

    await this.activityLog.log({
      userId: actor?.id,
      userName: actor?.name,
      action: ActivityAction.EMPLOYEE_UPDATE,
      entity: 'employee',
      entityId: id,
      entityName: emp.fullName,
      details: dto,
    });

    this.gateway.broadcast('employees:changed', {});

    // ── Notify the employee about position/role change via email + telegram ──
    const positionChanged = dto.position !== undefined && dto.position !== oldPosition;
    const roleChanged = !!resolvedRole && resolvedRole !== oldRole;
    if ((positionChanged || roleChanged) && emp.userId && oldUser) {
      const newPositionText = positionChanged ? dto.position! : emp.position;
      const newRoleText = roleChanged ? (ROLE_LABELS[resolvedRole!] || resolvedRole!) : undefined;
      const actorName = actor?.name;

      if (oldUser.email) {
        await this.mailService.sendPositionChanged(
          oldUser.email,
          oldUser.name,
          oldPosition || '—',
          newPositionText,
          newRoleText,
          actorName,
        ).catch(() => { /* logged inside */ });
      }

      const tg =
        `👤 <b>Изменены ваши данные</b>\n\n` +
        (positionChanged ? `🏷 Должность: <b>${newPositionText}</b>\n` : '') +
        (roleChanged ? `🎭 Роль: <b>${newRoleText}</b>\n` : '') +
        (actorName ? `\n👤 Изменил: ${actorName}` : '');
      await this.telegramService.sendToUser(emp.userId, tg).catch(() => {});
    }

    const updated = await this.findOne(id);
    // Attach warning to response so frontend can show a toast
    if (positionDidntMatchRole) {
      (updated as any)._warning = 'Должность не соответствует стандартной роли — роль осталась прежней';
    }
    return updated;
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

  /** Maps a Russian position string to a UserRole enum value (normalized).
   *  Never returns FOUNDER or ADMIN — those are privileged roles and can only
   *  be set explicitly via the `role` parameter by an actor with sufficient
   *  rights, never inferred from free-text position. */
  private positionToRole(position: string): UserRole | undefined {
    if (!position) return undefined;
    const norm = position.toLowerCase().replace(/[\s\-—_]+/g, '').trim();

    if (norm.includes('главныйsmm') || norm.includes('headsmm') || (norm.includes('smm') && (norm.includes('главн') || norm.includes('head')))) return UserRole.HEAD_SMM;
    if (norm.includes('smm')) return UserRole.SMM_SPECIALIST;
    if (norm.includes('дизайнер') || norm.includes('designer')) return UserRole.DESIGNER;
    if (norm.includes('таргетолог') || norm.includes('targetolog')) return UserRole.TARGETOLOGIST;
    if (norm.includes('продаж') || norm.includes('sales')) return UserRole.SALES_MANAGER;
    if (norm.includes('маркетолог') || norm.includes('marketer')) return UserRole.MARKETER;
    if (norm.includes('проектменеджер') || norm.includes('projectmanager') || norm.includes('пм')) return UserRole.PROJECT_MANAGER;
    if (norm.includes('разработчик') || norm.includes('developer') || norm.includes('программист')) return UserRole.DEVELOPER;
    if (norm.includes('сотрудник') || norm.includes('employee')) return UserRole.EMPLOYEE;
    // Explicitly NOT derived from position: FOUNDER, ADMIN
    return undefined;
  }
}
