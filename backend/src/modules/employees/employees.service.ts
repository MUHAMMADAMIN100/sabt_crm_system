import { Injectable, NotFoundException, ConflictException, ForbiddenException, OnModuleInit, Logger } from '@nestjs/common';
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
import { hasGrant } from '../auth/permissions';
import { directionScopeOf, isInDirectory } from '../../common/direction-scope';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  founder: 'Основатель',
  co_founder: 'Сооснователь',
  smm_director: 'Руководитель SMM',
  video_director: 'Руководитель по видеографии',
  smm_specialist: 'SMM специалист',
  designer: 'Дизайнер',
  sales_manager_smm: 'Менеджер продаж (СММ)',
  sales_manager_dev: 'Менеджер продаж (Разработка)',
  developer: 'Разработчик',
  videographer: 'Видеограф',
  video_editor: 'Монтажёр',
  organizer: 'Организатор',
  storymaker: 'Сторисмейкер',
  scriptwriter: 'Сценарист / SMM-менеджер',
  qa: 'Контролёр качества',
  publisher: 'Публикатор',
  targetologist: 'Таргетолог',
  employee: 'Сотрудник',
};

@Injectable()
export class EmployeesService implements OnModuleInit {
  private readonly logger = new Logger(EmployeesService.name);

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

  /** Идемпотентно добавляем колонку isStoryMaker — это рантайм-замена
   *  миграции. Без неё entity знает о колонке, а БД нет → запросы падают.
   *  Плюс одноразовый seed флага для сотрудницы, которая переведена в роль
   *  сторисмейкера — чтобы не возиться руками в админке после деплоя. */
  async onModuleInit() {
    try {
      await this.repo.manager.query(
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS "isStoryMaker" boolean NOT NULL DEFAULT false`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE employees isStoryMaker failed: ${e?.message || e}`);
    }
    try {
      await this.repo.manager.query(
        `UPDATE employees SET "isStoryMaker" = true
         WHERE LOWER(email) = LOWER($1) AND "isStoryMaker" = false`,
        ['mayunusovaf@gmail.com'],
      );
    } catch (e: any) {
      this.logger.warn(`Seed isStoryMaker for mayunusovaf failed: ${e?.message || e}`);
    }
  }

  /** Убрать зарплату у тех, кому она не положена. Нативно её видят только
   *  основатель и со-основатель, но доступ можно выдать (или, наоборот,
   *  отнять) персонально в «Доступах сотрудников» — см. hasGrant. */
  private stripSalary<T extends Employee | Employee[]>(data: T, viewer?: any): T {
    if (hasGrant(viewer, 'employees.salary.view')) return data;
    const strip = (e: any) => { if (e) delete e.salary; return e; };
    return Array.isArray(data) ? (data.map(strip) as T) : (strip(data) as T);
  }

  async findAll(search?: string, department?: string, status?: EmployeeStatus, viewer?: any) {
    const where: FindOptionsWhere<Employee> = {};
    if (department) where.department = department;
    if (status) where.status = status;
    if (search) where.fullName = ILike(`%${search}%`);
    let list = await this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['user'] });
    // Руководитель направления видит только свою команду: SMM-сотрудники не
    // должны попадать ни в списки, ни в выбор исполнителя задачи. Сотрудники
    // без учётки (user = null) — служебные записи, их тоже скрываем.
    const scope = directionScopeOf(viewer);
    if (scope) {
      list = list.filter(emp => isInDirectory(scope, emp.user as any));
    }
    // Legacy data: employee.avatar мог не синхронизироваться с user.avatar
    // (старые загрузки до фикса). Coalesce: если у employee нет картинки —
    // подставляем из связанного user.
    for (const emp of list) {
      if (!emp.avatar && emp.user?.avatar) emp.avatar = emp.user.avatar;
    }
    return this.stripSalary(list, viewer);
  }

  async findOne(id: string, viewer?: any) {
    const emp = await this.repo.findOne({ where: { id }, relations: ['user'] });
    if (!emp) throw new NotFoundException('Employee not found');
    if (!emp.avatar && emp.user?.avatar) emp.avatar = emp.user.avatar;
    return viewer ? this.stripSalary(emp, viewer) : emp;
  }

  /** Привилегированные роли — их выдача равносильна передаче ключей от всей
   *  системы, поэтому назначать их может только руководство. */
  private static readonly ELEVATED_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER];

  /** Актор — руководство (admin/founder/co_founder), а не сотрудник, которому
   *  доступ к разделу «Сотрудники» выдали персональным грантом. */
  private isTopActor(actor?: { role?: string }): boolean {
    return EmployeesService.ELEVATED_ROLES.includes(actor?.role as UserRole);
  }

  /** Учётку основателя/со-основателя трогает только основатель/со-основатель.
   *  Раньше эти эндпоинты были закрыты ролью, и проверка была не нужна; теперь
   *  доступ к ним выдаётся галочкой в «Доступах сотрудников», поэтому защита
   *  обязана быть внутри сервиса. */
  private assertCanTouch(targetRole: string | undefined, actor?: { id?: string; role?: string }) {
    const targetIsTop = targetRole === UserRole.FOUNDER || targetRole === UserRole.CO_FOUNDER;
    const actorIsTop = actor?.role === 'founder' || actor?.role === 'co_founder';
    if (targetIsTop && !actorIsTop) {
      throw new ForbiddenException(
        'Изменять учётную запись основателя или сооснователя может только основатель/сооснователь',
      );
    }
  }

  async create(dto: CreateEmployeeDto, actor?: { id?: string; role?: string }) {
    // Проверяем дубликат email в employees
    const existing = await this.repo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Сотрудник с таким email уже существует');

    // Resolve role: explicit > position-derived > default EMPLOYEE
    const explicitRole = (dto as any).role as UserRole | undefined;
    const derivedRole = this.positionToRole(dto.position);
    let newRole = explicitRole || derivedRole || UserRole.EMPLOYEE;

    // Сотрудник с грантом «Сотрудники — добавление» не может завести админа
    // или основателя: иначе, зная пароль по умолчанию, он вошёл бы под новой
    // учёткой и получил бы полный доступ. Привилегированные роли — только у
    // руководства, остальным роль принудительно понижается.
    if (EmployeesService.ELEVATED_ROLES.includes(newRole) && !this.isTopActor(actor)) {
      newRole = derivedRole && !EmployeesService.ELEVATED_ROLES.includes(derivedRole)
        ? derivedRole
        : UserRole.EMPLOYEE;
    }

    // Вторая роль при создании — валидируем значение (привилегированные
    // вторые роли запрещены всем, см. forbiddenSecondary).
    const rawSecondary = (dto as any).secondaryRole as string | undefined;
    const forbiddenSecondary = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER];
    const newSecondary: UserRole | null =
      rawSecondary
      && Object.values(UserRole).includes(rawSecondary as UserRole)
      && !forbiddenSecondary.includes(rawSecondary as UserRole)
      && rawSecondary !== newRole
        ? (rawSecondary as UserRole)
        : null;

    // Ищем существующего User по email, если нет — создаём
    let savedUser = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!savedUser) {
      const user = this.userRepo.create({
        name: dto.fullName,
        email: dto.email,
        password: 'Sabt@2024',
        role: newRole,
        secondaryRole: newSecondary,
      });
      savedUser = await this.userRepo.save(user);
    } else if (savedUser.role !== newRole || (savedUser.secondaryRole || null) !== newSecondary) {
      // У email уже есть учётка — «создание» превращается в смену её роли.
      // Понижать основателя/со-основателя таким способом нельзя.
      this.assertCanTouch(savedUser.role, actor);
      await this.userRepo.update(savedUser.id, { role: newRole, secondaryRole: newSecondary });
    }

    const { role: _r, secondaryRole: _sr, ...empDto } = dto as any;
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
    // Учётку основателя/со-основателя правит только основатель/со-основатель.
    this.assertCanTouch(oldRole, actor);

    // Смена email и включение/отключение учётной записи — операции уровня
    // администратора: подменив email, можно запросить сброс пароля на свой
    // адрес и войти под чужой учёткой, а status=inactive мгновенно лишает
    // человека доступа. Тому, кто правит карточки по гранту, это недоступно.
    if (!this.isTopActor(actor)) {
      const changesEmail = !!dto.email && !!oldUser && dto.email !== oldUser.email;
      const changesStatus = dto.status !== undefined
        && !!oldUser && (dto.status === 'active') !== oldUser.isActive;
      if (changesEmail || changesStatus) {
        throw new ForbiddenException(
          'Менять email и статус учётной записи может только администратор или основатель',
        );
      }
      // Сменить себе роль через карточку сотрудника тоже нельзя.
      if ((dto as any).role && emp.userId && emp.userId === actor?.id) {
        throw new ForbiddenException('Нельзя менять собственную роль');
      }
    }

    // Strip role/secondaryRole from dto before updating employee
    // (обе роли принадлежат User, а не Employee)
    const { role: newRoleParam, secondaryRole: secondaryRoleParam, ...empDto } = dto as any;
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
      if (newRoleParam && !this.isTopActor(actor)) {
        // Роль сотрудника — это его права в системе. Раздача ролей остаётся
        // за руководством, даже если правку карточек выдали грантом.
        throw new ForbiddenException('Менять роль сотрудника может только администратор или основатель');
      }
      if (newRoleParam) {
        // Only founder can explicitly set co_founder role — admin/co_founder cannot.
        // Only founder/co_founder can set admin/founder roles.
        const isElevated = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER].includes(newRoleParam as UserRole);
        const isCoFounder = newRoleParam === UserRole.CO_FOUNDER;
        const actorIsFounder = actor?.role === 'founder';
        const actorCanElevate = actorIsFounder || actor?.role === 'co_founder';
        if (isCoFounder && !actorIsFounder) {
          // Only founder may grant co_founder — silently ignore
        } else if (isElevated && !actorCanElevate) {
          // Silently ignore escalation attempts from non-founder
        } else {
          resolvedRole = newRoleParam as UserRole;
        }
      } else if (dto.position && dto.position !== oldPosition) {
        const derived = this.positionToRole(dto.position);
        // Block escalation to admin/founder/co_founder through position text — only explicit role
        // param from founder can grant these. Ignore silently, flag as unmatched.
        if (derived && ![UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER].includes(derived)) {
          resolvedRole = derived;
        } else if (!derived) {
          positionDidntMatchRole = true;
        }
      }
      if (resolvedRole && resolvedRole !== oldRole) {
        // Enforce single founder / co-founder in the system.
        // Use ::text cast to avoid enum resolution errors if migration hasn't run.
        if (resolvedRole === UserRole.FOUNDER) {
          const [{ count }] = await this.userRepo.manager.query(
            `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'founder'`,
          );
          if (count > 0) throw new ConflictException('В системе уже зарегистрирован основатель');
        }
        if (resolvedRole === UserRole.CO_FOUNDER) {
          const [{ count }] = await this.userRepo.manager.query(
            `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'co_founder'`,
          );
          if (count > 0) throw new ConflictException('В системе уже зарегистрирован сооснователь');
        }
        userUpdate.role = resolvedRole;
        // Если новая основная роль совпала с текущей второй — снимаем
        // вторую, чтобы роли не дублировались.
        if (oldUser?.secondaryRole === resolvedRole) {
          userUpdate.secondaryRole = null;
        }
      }

      // ── Вторая (дополнительная) роль ───────────────────────────────
      // Назначать/снимать может только admin/founder/co_founder.
      // Привилегированные роли второй ролью не назначаются; вторая роль
      // не может совпадать с основной. Пустая строка/null — снять.
      if (secondaryRoleParam !== undefined) {
        const actorCanAssign = ['admin', 'founder', 'co_founder'].includes(actor?.role || '');
        if (actorCanAssign) {
          const value = (secondaryRoleParam || null) as UserRole | null;
          const forbidden = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER];
          const primary = resolvedRole || oldRole;
          if (value === null) {
            userUpdate.secondaryRole = null;
          } else if (
            Object.values(UserRole).includes(value)
            && !forbidden.includes(value)
            && value !== primary
          ) {
            userUpdate.secondaryRole = value;
          }
          // Невалидное значение — молча игнорируем (как эскалацию роли).
        }
      }

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

  async remove(id: string, actor?: { id?: string; role?: string }) {
    const emp = await this.findOne(id);
    const userId = emp.userId;

    // Удаление сотрудника сносит и его учётную запись. Основателя и
    // со-основателя защищаем отдельно, себя удалить нельзя — иначе один
    // выданный грант позволял обезглавить компанию.
    const targetUser = userId ? await this.userRepo.findOne({ where: { id: userId } }) : null;
    this.assertCanTouch(targetUser?.role, actor);
    if (userId && actor?.id && userId === actor.id) {
      throw new ForbiddenException('Нельзя удалить собственную учётную запись');
    }

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

  /** Переключает флаг «сторисмейкер». Открывает доступ к историям всех
   *  SMM-проектов без выдачи других прав роли. */
  async toggleStoryMaker(id: string) {
    const emp = await this.findOne(id);
    emp.isStoryMaker = !emp.isStoryMaker;
    const saved = await this.repo.save(emp);

    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_UPDATE,
      entity: 'employee',
      entityId: id,
      entityName: emp.fullName,
      details: { isStoryMaker: saved.isStoryMaker },
    });

    this.gateway.broadcast('employees:changed', {});
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

    // Руководители направлений. «Главный SMM» больше не роль —
    // руководящие SMM-должности теперь дают smm_director.
    if (norm.includes('руководительsmm') || norm.includes('главныйsmm') || norm.includes('headsmm')
      || (norm.includes('smm') && (norm.includes('главн') || norm.includes('head') || norm.includes('руковод')))) return UserRole.SMM_DIRECTOR;
    if (norm.includes('видео') && norm.includes('руковод')) return UserRole.VIDEO_DIRECTOR;
    if (norm.includes('сторисмейкер') || norm.includes('storymaker')) return UserRole.STORYMAKER;
    // Workflow-роли SMM-доски. Сценарист содержит «smm» в названии —
    // проверяем ДО общего smm-фолбэка ниже.
    if (norm.includes('сценарист') || norm.includes('scriptwriter')) return UserRole.SCRIPTWRITER;
    if (norm.includes('контролёр') || norm.includes('контролер') || norm.includes('качества') || norm === 'qa') return UserRole.QA;
    if (norm.includes('публикатор') || norm.includes('publisher')) return UserRole.PUBLISHER;
    if (norm.includes('таргетолог') || norm.includes('targetolog')) return UserRole.TARGETOLOGIST;
    if (norm.includes('smm')) return UserRole.SMM_SPECIALIST;
    if (norm.includes('дизайнер') || norm.includes('designer')) return UserRole.DESIGNER;
    if (norm.includes('монтаж') || norm.includes('editor')) return UserRole.VIDEO_EDITOR;
    if (norm.includes('видеограф') || norm.includes('videograph')) return UserRole.VIDEOGRAPHER;
    if (norm.includes('организатор') || norm.includes('organiz')) return UserRole.ORGANIZER;
    if (norm.includes('продаж') || norm.includes('sales'))
      return norm.includes('разработ') || norm.includes('dev')
        ? UserRole.SALES_MANAGER_DEV
        : UserRole.SALES_MANAGER_SMM;
    if (norm.includes('разработчик') || norm.includes('developer') || norm.includes('программист')) return UserRole.DEVELOPER;
    if (norm.includes('сотрудник') || norm.includes('employee')) return UserRole.EMPLOYEE;
    // Explicitly NOT derived from position: FOUNDER, ADMIN
    return undefined;
  }

  /** Ensure a role enum value exists in PostgreSQL before writing it */
}
