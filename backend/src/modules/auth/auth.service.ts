import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, UserRole } from '../users/user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      role: dto.role || UserRole.EMPLOYEE,
    });
    await this.userRepo.save(user);

    // Auto-create employee record
    const existingEmployee = await this.employeeRepo.findOne({ where: { email: dto.email } });
    if (!existingEmployee) {
      const employee = this.employeeRepo.create({
        fullName: dto.name,
        email: dto.email,
        position: dto.position || 'Сотрудник',
        department: 'Общий',
        phone: dto.phone || null,
        telegram: dto.telegram || null,
        instagram: dto.instagram || null,
        hireDate: new Date(),
        status: EmployeeStatus.ACTIVE,
        userId: user.id,
      });
      await this.employeeRepo.save(employee);
    } else {
      existingEmployee.userId = user.id;
      if (dto.telegram) existingEmployee.telegram = dto.telegram;
      if (dto.instagram) existingEmployee.instagram = dto.instagram;
      if (dto.phone) existingEmployee.phone = dto.phone;
      await this.employeeRepo.save(existingEmployee);
    }

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !(await user.validatePassword(dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');
    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: this.sanitize(user) };
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user && (await user.validatePassword(password))) return user;
    return null;
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !(await user.validatePassword(oldPassword))) {
      throw new UnauthorizedException('Wrong current password');
    }
    user.password = newPassword;
    await this.userRepo.save(user);
    return { message: 'Password changed' };
  }

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { message: 'If email exists, reset link was sent' };

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 3600000);
    await this.userRepo.save(user);

    return { message: 'Reset link sent', token };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.userRepo.findOne({
      where: { resetPasswordToken: token },
    });
    if (!user || user.resetPasswordExpires < new Date()) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await this.userRepo.save(user);
    return { message: 'Password updated' };
  }

  private sanitize(user: User) {
    const { password, resetPasswordToken, resetPasswordExpires, ...rest } = user as any;
    return rest;
  }
}
