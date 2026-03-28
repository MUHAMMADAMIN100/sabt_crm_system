import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
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
    await this.repo.update(id, dto);
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
    // Sync employee status
    const employee = await this.employeeRepo.findOne({ where: { userId: id } });
    if (employee) {
      employee.status = user.isActive ? EmployeeStatus.ACTIVE : EmployeeStatus.INACTIVE;
      await this.employeeRepo.save(employee);
    }
    return user;
  }

  async updateAvatar(id: string, avatar: string) {
    await this.repo.update(id, { avatar });
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
