import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

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
    await this.repo.remove(user);
    return { message: 'User deleted' };
  }

  async toggleActive(id: string) {
    const user = await this.findOne(id);
    user.isActive = !user.isActive;
    return this.repo.save(user);
  }

  async updateAvatar(id: string, avatar: string) {
    await this.repo.update(id, { avatar });
    return this.findOne(id);
  }
}
