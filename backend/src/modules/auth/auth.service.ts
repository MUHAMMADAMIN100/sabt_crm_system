import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authenticator } = require('otplib');
import * as QRCode from 'qrcode';
import { User, UserRole } from '../users/user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { WorkSession } from './work-session.entity';
import { RefreshToken } from './refresh-token.entity';
import { SecurityEventType } from './security-event.entity';
import { SecurityAuditService } from './security-audit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { MailService } from '../mail/mail.service';
import { AppGateway } from '../gateway/app.gateway';
import type { Request } from 'express';

/** Время жизни refresh-токена. */
const REFRESH_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(WorkSession) private sessionRepo: Repository<WorkSession>,
    @InjectRepository(RefreshToken) private refreshRepo: Repository<RefreshToken>,
    private jwtService: JwtService,
    private activityLog: ActivityLogService,
    private mailService: MailService,
    private gateway: AppGateway,
    private audit: SecurityAuditService,
  ) {}

  // ─── Refresh tokens ──────────────────────────────────────────────────

  /** Хешируем сырой токен sha256 — в БД храним только hash. */
  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /** Выпустить новый refresh: сгенерировать 256-битный random, сохранить hash. */
  async issueRefreshToken(userId: string, req?: Request | null): Promise<string> {
    const raw = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
    const ip = req ? this.extractIp(req) : null;
    const ua = req?.headers?.['user-agent']?.toString().slice(0, 500) || null;
    await this.refreshRepo.save(this.refreshRepo.create({
      userId,
      tokenHash: this.hashToken(raw),
      revokedAt: null,
      replacedBy: null,
      expiresAt,
      ip,
      userAgent: ua,
    }));
    return raw;
  }

  /** Использовать refresh: проверить, отозвать старый, выпустить новый.
   *  Возвращает {accessToken, refreshToken, user}. Если предъявлен
   *  уже-отозванный токен — это сигнал кражи: отзываем ВСЕ refresh'ы
   *  пользователя и логируем. */
  async refresh(rawRefreshToken: string, req?: Request | null) {
    if (!rawRefreshToken) throw new UnauthorizedException('No refresh token');
    const hash = this.hashToken(rawRefreshToken);
    const found = await this.refreshRepo.findOne({ where: { tokenHash: hash } });
    if (!found) {
      await this.audit.log({ type: SecurityEventType.REFRESH_REUSE, req, details: { reason: 'unknown_hash' } });
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (found.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh expired');
    }
    if (found.revokedAt) {
      // Этот токен УЖЕ был использован для ротации — кто-то применил повторно.
      // Отзываем все активные токены этого пользователя на всякий случай.
      await this.refreshRepo.update({ userId: found.userId, revokedAt: IsNull() }, { revokedAt: new Date() });
      await this.audit.log({
        type: SecurityEventType.REFRESH_REUSE,
        userId: found.userId,
        req,
        details: { reason: 'reuse_of_revoked' },
      });
      throw new UnauthorizedException('Refresh token reused — all sessions revoked');
    }
    const user = await this.userRepo.findOne({ where: { id: found.userId } });
    if (!user || !user.isActive || user.isBlocked) throw new UnauthorizedException('User inactive');

    // Rotation: помечаем старый, выпускаем новый.
    const newRaw = await this.issueRefreshToken(user.id, req);
    const newHash = this.hashToken(newRaw);
    const newRow = await this.refreshRepo.findOne({ where: { tokenHash: newHash } });
    await this.refreshRepo.update({ id: found.id }, { revokedAt: new Date(), replacedBy: newRow?.id || null });

    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    await this.audit.log({ type: SecurityEventType.TOKEN_REFRESH, userId: user.id, req });
    return { accessToken, refreshToken: newRaw, user: this.sanitize(user) };
  }

  /** Отозвать все refresh'ы пользователя — на logout / при смене пароля. */
  async revokeAllRefresh(userId: string): Promise<void> {
    await this.refreshRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private extractIp(req: Request): string | null {
    const xff = (req.headers['x-forwarded-for'] as string) || '';
    if (xff) return xff.split(',')[0].trim();
    return req.socket?.remoteAddress || null;
  }

  async getSecurityLog(opts: { type?: SecurityEventType; limit?: number } = {}) {
    const events = await this.audit.list(opts);
    return { events };
  }

  async register(dto: RegisterDto, req?: Request | null) {
    // Открытая регистрация ОТКЛЮЧЕНА. Новых сотрудников добавляет
    // администратор / основатель / сооснователь через раздел
    // «Сотрудники». Единственное исключение — bootstrap самого первого
    // основателя: пока в системе нет ни одного founder, register
    // доступен чтобы создать первого владельца.
    const founderAlreadyExists = await this.founderExists();
    if (founderAlreadyExists) {
      throw new ForbiddenException(
        'Регистрация закрыта. Обратитесь к администратору для создания учётной записи.',
      );
    }

    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    // SECURITY: запрещаем self-register на привилегированные роли.
    // ADMIN, SMM_DIRECTOR, VIDEO_DIRECTOR, менеджеры продаж —
    // назначаются администратором/основателем через /users, а не
    // выдаются открытой формой регистрации.
    const PRIVILEGED_ROLES_BLOCKED_FROM_REGISTER = [
      UserRole.ADMIN,
      UserRole.SMM_DIRECTOR,
      UserRole.VIDEO_DIRECTOR,
      UserRole.SALES_MANAGER_SMM,
      UserRole.SALES_MANAGER_DEV,
    ];
    if (dto.role && PRIVILEGED_ROLES_BLOCKED_FROM_REGISTER.includes(dto.role)) {
      throw new ForbiddenException(
        'Эта роль назначается администратором. Зарегистрируйтесь как сотрудник, затем дождитесь назначения роли.',
      );
    }

    // Enforce single founder per system (::text cast avoids enum resolution errors)
    if (dto.role === UserRole.FOUNDER) {
      const [{ count }] = await this.userRepo.manager.query(
        `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'founder'`,
      );
      if (count > 0) throw new ConflictException('В системе уже зарегистрирован основатель');
    }

    // Enforce single co-founder per system
    if (dto.role === UserRole.CO_FOUNDER) {
      const [{ count }] = await this.userRepo.manager.query(
        `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'co_founder'`,
      );
      if (count > 0) throw new ConflictException('В системе уже зарегистрирован сооснователь');
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
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
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
    const refreshToken = await this.issueRefreshToken(user.id, req);
    await this.audit.log({ type: SecurityEventType.LOGIN_SUCCESS, userId: user.id, email: user.email, req, details: { via: 'register' } });
    const emp = await this.employeeRepo.findOne({ where: { userId: user.id } });
    return {
      token,
      refreshToken,
      user: {
        ...this.sanitize(user),
        position: emp?.position || null,
        department: emp?.department || null,
      },
    };
  }

  async login(dto: LoginDto, req?: Request | null) {
    // ─── Account lockout: проверяем ДО валидации пароля ────────────────
    // 5 неудач по email или 20 с одного IP за 15 минут → блок на 15 мин.
    // Это защищает и от bruteforce конкретного аккаунта, и от перебора
    // паролей по списку email с одного IP.
    const ip = req ? this.extractIp(req) : null;
    const lock = await this.audit.checkLoginLockout(dto.email || null, ip);
    if (lock.locked) {
      await this.audit.log({
        type: SecurityEventType.LOGIN_BLOCKED,
        email: dto.email,
        req,
        details: { reason: `lockout_by_${lock.by}`, count: lock.count },
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: lock.by === 'email'
            ? 'Слишком много неудачных попыток входа. Попробуйте через 15 минут.'
            : 'Слишком много неудачных попыток с вашего IP. Попробуйте через 15 минут.',
          retryAfterSec: lock.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !(await user.validatePassword(dto.password))) {
      await this.audit.log({
        type: SecurityEventType.LOGIN_FAIL,
        email: dto.email,
        userId: user?.id ?? null,
        req,
        details: { reason: user ? 'bad_password' : 'unknown_email' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.isBlocked) {
      await this.audit.log({ type: SecurityEventType.LOGIN_BLOCKED, userId: user.id, email: user.email, req });
      const blockedByLabel = user.blockedByRole === 'founder'
        ? 'основатель компании'
        : user.blockedByRole === 'co_founder'
          ? 'сооснователь компании'
          : user.blockedByRole === 'admin'
            ? 'администратор'
            : (user.blockedByName || 'администрация');
      const reasonText = user.blockReason ? `\nПричина: ${user.blockReason}` : '';
      throw new UnauthorizedException(`Вас заблокировал ${blockedByLabel}${user.blockedByName ? ` (${user.blockedByName})` : ''}.${reasonText}`);
    }
    if (!user.isActive) throw new UnauthorizedException('Account is deactivated');

    // 2FA: если включена, требуем поле twoFactorCode в DTO.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const code = (dto as any).twoFactorCode as string | undefined;
      if (!code) throw new UnauthorizedException('2FA_REQUIRED');
      const ok = authenticator.check(code, user.twoFactorSecret);
      if (!ok) {
        await this.audit.log({ type: SecurityEventType.TWO_FACTOR_FAIL, userId: user.id, req });
        throw new UnauthorizedException('Invalid 2FA code');
      }
    }

    // Check if employee is sub-admin — grant admin access (but don't downgrade founder/co_founder)
    const employee = await this.employeeRepo.findOne({ where: { userId: user.id } });
    const topRoles = [UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN];
    const effectiveRole = employee?.isSubAdmin && !topRoles.includes(user.role) ? UserRole.ADMIN : user.role;

    const token = this.jwtService.sign({ sub: user.id, email: user.email, role: effectiveRole });
    const sanitized = this.sanitize(user);

    // Закрываем все «висящие» сессии пользователя (если в прошлый раз он
    // не вышел явно). logoutAt = lastSeenAt (реальное время последней
    // активности по heartbeat), либо loginAt если heartbeat'ов не было.
    const open = await this.sessionRepo.find({ where: { userId: user.id, logoutAt: IsNull() } });
    for (const s of open) {
      const end = s.lastSeenAt ? new Date(s.lastSeenAt) : new Date(s.loginAt);
      s.logoutAt = end;
      const ms = Math.max(0, end.getTime() - new Date(s.loginAt).getTime());
      s.durationHours = parseFloat((ms / 3600000).toFixed(4));
    }
    if (open.length > 0) await this.sessionRepo.save(open);

    // Start work session
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const session = this.sessionRepo.create({
      userId: user.id,
      loginAt: now,
      lastSeenAt: now,
      date: today,
    });
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
    await this.audit.log({ type: SecurityEventType.LOGIN_SUCCESS, userId: user.id, email: user.email, req });

    const refreshToken = await this.issueRefreshToken(user.id, req);

    return {
      token,
      refreshToken,
      user: {
        ...sanitized,
        role: effectiveRole,
        position: employee?.position || null,
        department: employee?.department || null,
        isSubAdmin: employee?.isSubAdmin || false,
        isStoryMaker: employee?.isStoryMaker || false,
      },
    };
  }

  // ─── 2FA (TOTP) ──────────────────────────────────────────────────────

  /** Сгенерировать новый secret и QR-картинку. 2FA НЕ включается до
   *  успешной проверки первого кода в enable2FA(). */
  async setup2FA(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'sabt CRM', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    // Сохраняем секрет, но enabled остаётся false — пользователь должен
    // подтвердить кодом из приложения, что QR действительно отсканирован.
    await this.userRepo.update(userId, { twoFactorSecret: secret, twoFactorEnabled: false });
    return { secret, otpauthUrl, qrDataUrl };
  }

  async enable2FA(userId: string, code: string, req?: Request | null) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new BadRequestException('2FA setup not started');
    if (!authenticator.check(code, user.twoFactorSecret)) {
      await this.audit.log({ type: SecurityEventType.TWO_FACTOR_FAIL, userId, req });
      throw new BadRequestException('Invalid 2FA code');
    }
    await this.userRepo.update(userId, { twoFactorEnabled: true });
    await this.audit.log({ type: SecurityEventType.TWO_FACTOR_ENABLED, userId, req });
    return { ok: true };
  }

  async disable2FA(userId: string, code: string, req?: Request | null) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!authenticator.check(code, user.twoFactorSecret)) {
        await this.audit.log({ type: SecurityEventType.TWO_FACTOR_FAIL, userId, req });
        throw new BadRequestException('Invalid 2FA code');
      }
    }
    await this.userRepo.update(userId, { twoFactorEnabled: false, twoFactorSecret: null });
    await this.audit.log({ type: SecurityEventType.TWO_FACTOR_DISABLED, userId, req });
    return { ok: true };
  }

  /** Heartbeat от активной вкладки — обновляет lastSeenAt текущей
   *  открытой сессии. Если открытой сессии нет (редкий race), молча игнорируем. */
  async heartbeat(userId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { userId, logoutAt: IsNull() },
      order: { loginAt: 'DESC' },
    });
    if (session) {
      session.lastSeenAt = new Date();
      await this.sessionRepo.save(session);
    }
  }

  async logout(userId: string, req?: Request | null) {
    const session = await this.sessionRepo.findOne({
      where: { userId, logoutAt: IsNull() },
      order: { loginAt: 'DESC' },
    });
    if (session) {
      const now = new Date();
      session.logoutAt = now;
      session.lastSeenAt = now;
      const ms = now.getTime() - new Date(session.loginAt).getTime();
      session.durationHours = parseFloat((ms / 3600000).toFixed(4));
      await this.sessionRepo.save(session);
    }

    // Отзываем все активные refresh-токены этого пользователя — украденный
    // refresh теперь бесполезен сразу после logout, а не через 30 дней.
    await this.revokeAllRefresh(userId);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    await this.activityLog.log({
      userId,
      userName: user?.name,
      action: ActivityAction.LOGOUT,
      entity: 'user',
      entityId: userId,
    });
    await this.audit.log({ type: SecurityEventType.LOGOUT, userId, email: user?.email, req });

    return { message: 'Logged out' };
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user && (await user.validatePassword(password))) return user;
    return null;
  }

  async founderExists(): Promise<boolean> {
    const [{ count }] = await this.userRepo.manager.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'founder'`,
    );
    return count > 0;
  }

  async coFounderExists(): Promise<boolean> {
    const [{ count }] = await this.userRepo.manager.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role::text = 'co_founder'`,
    );
    return count > 0;
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const employee = await this.employeeRepo.findOne({ where: { userId } });
    const topRoles = [UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN];
    const effectiveRole = employee?.isSubAdmin && !topRoles.includes(user.role) ? UserRole.ADMIN : user.role;
    const sanitized = this.sanitize(user);
    return {
      ...sanitized,
      role: effectiveRole,
      position: employee?.position || null,
      department: employee?.department || null,
      isSubAdmin: employee?.isSubAdmin || false,
      isStoryMaker: employee?.isStoryMaker || false,
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Новый пароль должен содержать минимум 8 символов');
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !(await user.validatePassword(oldPassword))) {
      throw new UnauthorizedException('Wrong current password');
    }
    user.password = newPassword;
    await this.userRepo.save(user);

    // Security: при смене пароля отзываем ВСЕ refresh-токены этого юзера.
    // Без этого украденный refresh-cookie продолжал бы выдавать access-токены
    // ещё 30 дней даже после того как жертва сменила пароль чтобы заблокировать
    // атакующего. Помечаем как closed_loop для аудит-трейла.
    await this.revokeAllRefresh(userId);

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

    // Security: forgot-password flow часто запускается ИМЕННО потому, что
    // юзер подозревает компрометацию. Отзываем все refresh-токены, чтобы
    // украденная cookie сразу перестала работать (а не жила 30 дней).
    await this.revokeAllRefresh(user.id);

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
