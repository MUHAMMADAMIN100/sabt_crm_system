import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, UserRole } from '../users/user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { WorkSession } from './work-session.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { MailService } from '../mail/mail.service';
import { AppGateway } from '../gateway/app.gateway';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(WorkSession) private sessionRepo: Repository<WorkSession>,
    private jwtService: JwtService,
    private activityLog: ActivityLogService,
    private mailService: MailService,
    private gateway: AppGateway,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    // Enforce single founder per system
    if (dto.role === UserRole.FOUNDER) {
      const founderCount = await this.userRepo.count({ where: { role: UserRole.FOUNDER } });
      if (founderCount > 0) {
        throw new ConflictException('В системе уже зарегистрирован основатель');
      }
    }

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

    this.gateway.broadcast('employees:changed', {});

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.REGISTER,
      entity: 'user',
      entityId: user.id,
      entityName: user.name,
      details: { email: user.email, role: user.role },
    });

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !(await user.validatePassword(dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');

    // Check if employee is sub-admin — grant admin access
    const employee = await this.employeeRepo.findOne({ where: { userId: user.id } });
    const effectiveRole = employee?.isSubAdmin ? UserRole.ADMIN : user.role;

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: effectiveRole });
    const sanitized = this.sanitize(user);

    // Start work session
    const today = new Date().toISOString().split('T')[0];
    const session = this.sessionRepo.create({ userId: user.id, loginAt: new Date(), date: today });
    await this.sessionRepo.save(session);

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.LOGIN,
      entity: 'user',
      entityId: user.id,
      entityName: user.name,
      details: { role: effectiveRole },
    });

    return { token, user: { ...sanitized, role: effectiveRole, isSubAdmin: employee?.isSubAdmin || false } };
  }

  async logout(userId: string) {
    const session = await this.sessionRepo.findOne({
      where: { userId, logoutAt: IsNull() },
      order: { loginAt: 'DESC' },
    });
    if (session) {
      session.logoutAt = new Date();
      const ms = session.logoutAt.getTime() - new Date(session.loginAt).getTime();
      session.durationHours = parseFloat((ms / 3600000).toFixed(2));
      await this.sessionRepo.save(session);
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    await this.activityLog.log({
      userId,
      userName: user?.name,
      action: ActivityAction.LOGOUT,
      entity: 'user',
      entityId: userId,
    });

    return { message: 'Logged out' };
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user && (await user.validatePassword(password))) return user;
    return null;
  }

  async founderExists(): Promise<boolean> {
    const count = await this.userRepo.count({ where: { role: UserRole.FOUNDER } });
    return count > 0;
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const employee = await this.employeeRepo.findOne({ where: { userId } });
    const effectiveRole = employee?.isSubAdmin ? UserRole.ADMIN : user.role;
    const sanitized = this.sanitize(user);
    return { ...sanitized, role: effectiveRole, isSubAdmin: employee?.isSubAdmin || false };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !(await user.validatePassword(oldPassword))) {
      throw new UnauthorizedException('Wrong current password');
    }
    user.password = newPassword;
    await this.userRepo.save(user);

    await this.activityLog.log({
      userId,
      userName: user.name,
      action: ActivityAction.PASSWORD_CHANGE,
      entity: 'user',
      entityId: userId,
    });

    return { message: 'Password changed' };
  }

  async forgotPassword(email: string) {
    // Always return the same message to prevent user enumeration
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { message: 'If email exists, reset link was sent' };

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 3600000);
    await this.userRepo.save(user);

    // Send token only via email — never return it in the response
    await this.mailService.sendPasswordReset(user.email, user.name, token);

    return { message: 'If email exists, reset link was sent' };
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

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.PASSWORD_RESET,
      entity: 'user',
      entityId: user.id,
    });

    return { message: 'Password updated' };
  }

  async getSessions(userId: string, days = 7) {
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    from.setHours(0, 0, 0, 0);
    const sessions = await this.sessionRepo.find({
      where: { userId },
      order: { loginAt: 'DESC' },
      take: 30,
    });
    return sessions.filter(s => new Date(s.loginAt) >= from);
  }

  private sanitize(user: User) {
    const { password, resetPasswordToken, resetPasswordExpires, ...rest } = user as User;
    return rest;
  }
}
