import { Injectable, NotFoundException } from '@nestjs/common';
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

  async update(id: string, dto: Partial<User>) {
    const user = await this.findOne(id);
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

  async remove(id: string) {
    const user = await this.findOne(id);
    // Delete linked employee record first (FK references user)
    const employee = await this.employeeRepo.findOne({ where: { userId: id } });
    if (employee) await this.employeeRepo.remove(employee);
    await this.repo.remove(user);
    return { message: 'User deleted' };
  }

  async toggleActive(id: string) {
    const user = await this.findOne(id);
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
