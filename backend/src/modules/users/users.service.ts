import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    private activityLog: ActivityLogService,
  ) {}

  findAll(role?: UserRole) {
    const where = role ? { role } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Защита: основателем/сооснователем может управлять только основатель
   *  или сооснователь. Админ — НЕТ. Бросает ForbiddenException. */
  private assertCanManage(target: User, actorRole?: string) {
    const isTargetTop = target.role === UserRole.FOUNDER || target.role === UserRole.CO_FOUNDER;
    const isActorTop = actorRole === 'founder' || actorRole === 'co_founder';
    if (isTargetTop && !isActorTop) {
      throw new ForbiddenException(
        'Управлять учётной записью основателя или сооснователя может только сам основатель/сооснователь',
      );
    }
  }

  async update(id: string, dto: Partial<User>, actorRole?: string) {
    const user = await this.findOne(id);
    this.assertCanManage(user, actorRole);

    // Enforce single founder / co-founder in the system when role is changed.
    if (dto.role && dto.role !== user.role) {
      // Only founder can grant the co_founder role — not admin, not co_founder.
      if (dto.role === UserRole.CO_FOUNDER && actorRole !== 'founder') {
        throw new ForbiddenException('Назначить сооснователя может только основатель');
      }
      if (dto.role === UserRole.FOUNDER) {
        const [{ count }] = await this.repo.manager.query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'founder'`,
        );
        if (count > 0) throw new ConflictException('В системе уже зарегистрирован основатель');
      }
      if (dto.role === UserRole.CO_FOUNDER) {
        const [{ count }] = await this.repo.manager.query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'co_founder'`,
        );
        if (count > 0) throw new ConflictException('В системе уже зарегистрирован сооснователь');
      }
    }

    // Use save (not update) so BeforeUpdate hooks fire (e.g., password hashing)
    Object.assign(user, dto);
    await this.repo.save(user);

    await this.activityLog.log({
      userId: id,
      userName: user.name,
      action: ActivityAction.PROFILE_UPDATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
      details: { fields: Object.keys(dto).filter(k => k !== 'password') },
    });

    return this.findOne(id);
  }

  async remove(id: string, actorRole?: string) {
    const user = await this.findOne(id);
    this.assertCanManage(user, actorRole);
    // Delete linked employee record first (FK references user)
    const employee = await this.employeeRepo.findOne({ where: { userId: id } });
    if (employee) await this.employeeRepo.remove(employee);
    await this.repo.remove(user);
    return { message: 'User deleted' };
  }

  async toggleActive(id: string, actorRole?: string) {
    const user = await this.findOne(id);
    this.assertCanManage(user, actorRole);
    user.isActive = !user.isActive;
    await this.repo.save(user);

    await this.activityLog.log({
      action: user.isActive ? ActivityAction.USER_ACTIVATE : ActivityAction.USER_DEACTIVATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
    });

    // Sync employee status
    const employee = await this.employeeRepo.findOne({ where: { userId: id } });
    if (employee) {
      employee.status = user.isActive ? EmployeeStatus.ACTIVE : EmployeeStatus.INACTIVE;
      await this.employeeRepo.save(employee);
    }
    return user;
  }

  /**
   * Admin/founder resets a user's password to a new value.
   * If newPassword is not provided, generates a random one.
   * Returns the plain new password so admin can share it with the user.
   */
  async resetPassword(id: string, resetBy: { id: string; name?: string; role: string }, newPassword?: string) {
    const user = await this.findOne(id);
    this.assertCanManage(user, resetBy.role);
    // Дополнительно: даже founder не может сбросить пароль другому admin
    // (только тот сам себе и founder/co_founder себе или другому top-tier).
    if (['admin', 'founder', 'co_founder'].includes(user.role) && user.id !== resetBy.id
        && !['founder', 'co_founder'].includes(resetBy.role)) {
      throw new ForbiddenException('Нельзя сбросить пароль другого администратора');
    }
    // Validate custom password length (auto-generated is always 10 chars)
    const trimmed = newPassword?.trim();
    if (trimmed && trimmed.length < 8) {
      throw new Error('Пароль должен содержать минимум 8 символов');
    }
    // Generate random password if not provided
    const finalPassword = trimmed || this.generateRandomPassword(10);
    user.password = finalPassword; // BeforeUpdate hook will hash it
    await this.repo.save(user);

    await this.activityLog.log({
      userId: resetBy.id,
      userName: resetBy.name,
      action: ActivityAction.PASSWORD_CHANGE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
      details: { resetBy: resetBy.role, target: user.email },
    });

    return { newPassword: finalPassword, user: { id: user.id, name: user.name, email: user.email } };
  }

  private generateRandomPassword(length: number): string {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < length; i++) {
      pwd += charset[Math.floor(Math.random() * charset.length)];
    }
    return pwd;
  }

  async block(id: string, blockedBy: { id: string; name?: string; role: string }, reason?: string) {
    const user = await this.findOne(id);
    if (user.id === blockedBy.id) {
      throw new ForbiddenException('Нельзя заблокировать самого себя');
    }
    // Основателя/сооснователя может блокировать только основатель/сооснователь.
    this.assertCanManage(user, blockedBy.role);
    // Админа никто не блокирует автоматом — только основатель/сооснователь
    // (защита от перехвата системы при компрометации одного админа).
    if (user.role === UserRole.ADMIN && !['founder', 'co_founder'].includes(blockedBy.role)) {
      throw new ForbiddenException('Заблокировать администратора может только основатель/сооснователь');
    }

    user.isBlocked = true;
    user.blockedAt = new Date();
    user.blockedById = blockedBy.id;
    user.blockedByName = blockedBy.name || null;
    user.blockedByRole = blockedBy.role;
    user.blockReason = reason || null;
    await this.repo.save(user);

    await this.activityLog.log({
      userId: blockedBy.id,
      userName: blockedBy.name,
      action: ActivityAction.USER_DEACTIVATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
      details: { blocked: true, reason },
    });

    return this.findOne(id);
  }

  async unblock(id: string, unblockedBy: { id: string; name?: string; role: string }) {
    const user = await this.findOne(id);
    this.assertCanManage(user, unblockedBy.role);
    user.isBlocked = false;
    user.blockedAt = null;
    user.blockedById = null;
    user.blockedByName = null;
    user.blockedByRole = null;
    user.blockReason = null;
    await this.repo.save(user);

    await this.activityLog.log({
      userId: unblockedBy.id,
      userName: unblockedBy.name,
      action: ActivityAction.USER_ACTIVATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
      details: { unblocked: true },
    });

    return this.findOne(id);
  }

  async updateAvatar(id: string, avatar: string) {
    const user = await this.findOne(id);
    await this.repo.update(id, { avatar });

    await this.activityLog.log({
      userId: id,
      userName: user.name,
      action: ActivityAction.AVATAR_UPDATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
    });

    return this.findOne(id);
  }

  /** Deletes all users who have no linked employee record and are not admins */
  async cleanupOrphanedUsers() {
    const allUsers = await this.repo.find({ where: { role: UserRole.EMPLOYEE } });
    const deleted: string[] = [];
    for (const user of allUsers) {
      const emp = await this.employeeRepo.findOne({ where: { userId: user.id } });
      if (!emp) {
        await this.repo.remove(user);
        deleted.push(user.email);
      }
    }
    return { deleted, count: deleted.length };
  }

}
