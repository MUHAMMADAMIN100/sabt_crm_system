import { Injectable, Logger, OnModuleInit, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User, UserRole } from './user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { AppGateway } from '../gateway/app.gateway';
import { SecurityAuditService } from '../auth/security-audit.service';
import { SecurityEventType } from '../auth/security-event.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { sanitizeGrants, hasGrant, GRANTABLE } from '../auth/permissions';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  /** Максимум на фотографию ПОСЛЕ кодирования в base64. Фронт сжимает
   *  картинку примерно до 200 КБ, так что запас десятикратный: у
   *  сотрудника может быть открыта вкладка со старой версией сайта,
   *  и его фото должно загрузиться даже без сжатия в браузере. */
  private static readonly MAX_AVATAR_BYTES = 2 * 1024 * 1024;
  private static readonly AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(RefreshToken) private refreshRepo: Repository<RefreshToken>,
    private activityLog: ActivityLogService,
    private gateway: AppGateway,
    private securityAudit: SecurityAuditService,
  ) {}

  /** В проде synchronize выключён — колонку под фотографию заводим сами.
   *  IF NOT EXISTS: метод выполняется при каждом старте. */
  async onModuleInit(): Promise<void> {
    try {
      await this.repo.manager.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "avatarImage" text');
    } catch (e: any) {
      this.logger.warn(`avatarImage column check failed: ${e?.message || e}`);
    }
  }

  /** Отзываем все ещё-активные refresh-токены пользователя.
   *  Используется при блокировке / сбросе пароля админом / похожих операциях,
   *  чтобы украденная refresh-cookie сразу перестала работать. */
  private async revokeAllRefresh(userId: string): Promise<void> {
    await this.refreshRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  findAll(role?: UserRole) {
    const where = role ? { role } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ─── Доступы сотрудников (персональные гранты поверх роли) ─────────────

  /** Список сотрудников с их ролью и персональными доступами — для страницы
   *  «Доступы сотрудников». */
  async listAccess() {
    const users = await this.repo.find({ order: { createdAt: 'ASC' } });
    const emps = await this.employeeRepo.find();
    const posByUser = new Map(emps.filter(e => e.userId).map(e => [e.userId, e.position]));
    return users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      secondaryRole: u.secondaryRole || null,
      position: posByUser.get(u.id) || null,
      extraPermissions: Array.isArray(u.extraPermissions) ? u.extraPermissions : [],
      deniedPermissions: Array.isArray(u.deniedPermissions) ? u.deniedPermissions : [],
      isActive: u.isActive,
    }));
  }

  /** Выдать/снять персональные доступы сотруднику. Мгновенно уведомляет его
   *  клиент (socket access:changed) — тот сам перечитает /auth/me.
   *
   *  permissions — что ДОБАВИТЬ поверх роли, denied — что ОТНЯТЬ из того,
   *  что есть по роли. Ключ, попавший в оба списка, оставляем только в
   *  запретах: запрет сильнее (см. hasGrant). */
  async setAccess(id: string, permissions: any, actor?: { id?: string; role?: string }, denied?: any) {
    const user = await this.findOne(id);
    this.assertCanManage(user, actor?.role);
    // Себе доступы не правят: иначе админ выдавал бы себе то, что по замыслу
    // доступно только основателю (финансы, ФОТ, зарплаты).
    if (actor?.id && actor.id === id) {
      throw new ForbiddenException('Свои собственные доступы менять нельзя — попросите основателя');
    }
    const cleanDenied = sanitizeGrants(denied);
    const clean = sanitizeGrants(permissions).filter(k => !cleanDenied.includes(k));
    // Выдать можно только то, что есть у самого выдающего. Иначе админ, у
    // которого нет финансов, выдал бы их другому — и получил бы доступ через
    // подставное лицо.
    const actorUser = actor?.id ? await this.repo.findOne({ where: { id: actor.id } }) : null;
    const notMine = clean.filter(k => !hasGrant(actorUser, k));
    if (notMine.length > 0) {
      const labels = notMine.map(k => GRANTABLE[k]?.label || k).join(', ');
      throw new ForbiddenException(`Нельзя выдать доступ, которого нет у вас самих: ${labels}`);
    }
    await this.repo.update(id, {
      extraPermissions: clean.length ? clean : null,
      deniedPermissions: cleanDenied.length ? cleanDenied : null,
    });
    await this.activityLog.log({
      action: ActivityAction.EMPLOYEE_UPDATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
      details: { extraPermissions: clean, deniedPermissions: cleanDenied },
    }).catch(() => {});
    try { this.gateway.broadcast('access:changed', { userId: id }); } catch { /* best-effort */ }
    return { id, extraPermissions: clean, deniedPermissions: cleanDenied };
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
    const oldRole = user.role;

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

    // Аудит-лог в security_events: смена роли — событие повышенной важности.
    if (dto.role && dto.role !== oldRole) {
      await this.securityAudit.log({
        type: SecurityEventType.ROLE_CHANGED,
        userId: id,
        email: user.email,
        details: { oldRole, newRole: dto.role, actorRole },
      });
    }

    return this.findOne(id);
  }

  async remove(id: string, actorRole?: string, actorId?: string) {
    const user = await this.findOne(id);
    // Защита от самоудаления — admin/founder не должен случайно стереть
    // собственный аккаунт и потерять доступ к системе.
    if (actorId && user.id === actorId) {
      throw new ForbiddenException('Нельзя удалить самого себя');
    }
    this.assertCanManage(user, actorRole);
    // Delete linked employee record first (FK references user)
    const employee = await this.employeeRepo.findOne({ where: { userId: id } });
    if (employee) await this.employeeRepo.remove(employee);
    await this.repo.remove(user);
    return { message: 'User deleted' };
  }

  async toggleActive(id: string, actorRole?: string, actorId?: string) {
    const user = await this.findOne(id);
    // Защита от само-деактивации — иначе admin может выключить себя
    // и потерять доступ.
    if (actorId && user.id === actorId) {
      throw new ForbiddenException('Нельзя деактивировать самого себя');
    }
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
    // Отзываем и бессрочные рабочие токены: всё выданное до этой метки
    // перестаёт действовать (см. jwt.strategy).
    user.passwordChangedAt = new Date();
    await this.repo.save(user);

    // Security: админский сброс пароля — это обычно ответ на инцидент
    // (юзер потерял доступ, утечка, увольнение). Без отзыва refresh-токенов
    // атакующий, у которого уже есть украденная refresh-cookie, продолжит
    // получать access-токены ещё 30 дней. Отзываем всё.
    await this.revokeAllRefresh(id);

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

    // Defense-in-depth: refresh() уже проверяет user.isBlocked и отдаёт 401,
    // но если эта проверка где-то когда-то даст сбой (баг рефактора, race,
    // вернули admin-а к жизни через прямой UPDATE в БД) — пустые refresh-
    // токены гарантируют что атакующий не сможет восстановить сессию.
    await this.revokeAllRefresh(id);

    await this.activityLog.log({
      userId: blockedBy.id,
      userName: blockedBy.name,
      action: ActivityAction.USER_DEACTIVATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
      details: { blocked: true, reason },
    });
    await this.securityAudit.log({
      type: SecurityEventType.USER_BLOCKED,
      userId: id,
      email: user.email,
      details: { blockedBy: blockedBy.role, reason: reason ?? null },
    });

    // Мгновенно сообщаем заблокированному клиенту через WebSocket — фронт
    // слушает 'auth:blocked' и сразу выкидывает пользователя из системы,
    // не дожидаясь ручного refresh страницы.
    try {
      this.gateway.notifyUser(id, 'auth:blocked', {
        reason: reason || null,
        blockedByName: blockedBy.name || null,
        blockedByRole: blockedBy.role,
        blockedAt: user.blockedAt,
      });
    } catch (e) {
      // socket-фейл не должен ломать саму операцию блокировки
    }

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
    await this.securityAudit.log({
      type: SecurityEventType.USER_UNBLOCKED,
      userId: id,
      email: user.email,
      details: { unblockedBy: unblockedBy.role },
    });

    return this.findOne(id);
  }

  /** Регистрация FCM-токена устройства (мобильное приложение). Мульти-девайс:
   *  до 5 токенов на пользователя, старые вытесняются. */
  // warn-уровень: прод-логгер показывает только warn+ — это операционные
  // статус-строки для отладки пушей по поиску «FCM» в Railway-логах.
  private readonly fcmLogger = new Logger('FCM');

  async registerFcmToken(userId: string, token: string) {
    // Колонка select:false — читаем явно.
    const user = await this.repo.findOne({ where: { id: userId }, select: ['id', 'fcmTokens'] as any });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const tokens = (user.fcmTokens || []).filter(t => t !== token);
    tokens.push(token);
    while (tokens.length > 5) tokens.shift();
    await this.repo.update(userId, { fcmTokens: tokens });
    this.fcmLogger.warn(`FCM: токен устройства зарегистрирован (user ${userId}, устройств: ${tokens.length})`);
    return { success: true };
  }

  /** Удаление FCM-токена при выходе из аккаунта — пуши на устройство
   *  перестают приходить. */
  async unregisterFcmToken(userId: string, token: string) {
    const user = await this.repo.findOne({ where: { id: userId }, select: ['id', 'fcmTokens'] as any });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const tokens = (user.fcmTokens || []).filter(t => t !== token);
    await this.repo.update(userId, { fcmTokens: tokens.length ? tokens : null });
    this.fcmLogger.warn(`FCM: токен устройства удалён (user ${userId}, осталось: ${tokens.length})`);
    return { success: true };
  }

  // ─── Персональные обои интерфейса ────────────────────────────────────
  // Картинка живёт в БД, а не на диске: диск на Railway эфемерный, при
  // редеплое файлы стираются. Все методы работают строго со «своим»
  // пользователем — чужие обои недоступны никому, включая основателя.

  /** 700 КБ на data URI. Фронт сжимает картинку до ~300 КБ, потолок нужен на
   *  случай запроса в обход интерфейса: колонка тянется на каждый вход. */
  private static readonly MAX_BACKGROUND_BYTES = 700 * 1024;

  /** Белый список типов картинки-фона. Дублирует fileFilter контроллера
   *  намеренно: значение уходит в CSS, одного барьера мало. */
  private static readonly BACKGROUND_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

  /** Затемнение держим в разумных рамках: 100 % — сплошная заливка, при
   *  которой картинки просто не видно, а отрицательное значение сломало бы
   *  CSS-градиент. */
  private clampDim(value: unknown, fallback = 40): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(90, Math.max(0, Math.round(n)));
  }

  /** Масштаб обоев. Ниже 30 % картинка превращается в точку, выше 200 % —
   *  видно один пиксель, поэтому границы жёсткие. */
  private clampScale(value: unknown, fallback = 100): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(200, Math.max(30, Math.round(n)));
  }

  /** Соотношение сторон картинки. Приходит из браузера, поэтому проверяем:
   *  значение уходит в CSS-выражение размера фона. */
  private clampRatio(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    // 0.1..10 покрывает и панорамы, и вертикальные экраны телефона.
    return Math.min(10, Math.max(0.1, Math.round(n * 1000) / 1000));
  }

  async getBackground(userId: string): Promise<{
    image: string | null; dim: number; scale: number; ratio: number | null;
  }> {
    // backgroundImage помечена select:false — читаем явно.
    const row = await this.repo
      .createQueryBuilder('u')
      .select(['u.id', 'u.backgroundDim', 'u.backgroundScale', 'u.backgroundRatio'])
      .addSelect('u.backgroundImage')
      .where('u.id = :id', { id: userId })
      .getOne();
    return {
      image: row?.backgroundImage ?? null,
      dim: this.clampDim(row?.backgroundDim),
      scale: this.clampScale(row?.backgroundScale),
      ratio: this.clampRatio(row?.backgroundRatio),
    };
  }

  async setBackground(
    userId: string,
    file: Express.Multer.File,
    dim?: unknown,
    scale?: unknown,
    ratio?: unknown,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл пустой');
    // Размер считаем ДО кодирования: base64 раздувает данные на треть, и
    // гонять эту строку в памяти только чтобы её отвергнуть — незачем.
    const encodedSize = Math.ceil(file.buffer.length / 3) * 4;
    if (encodedSize > UsersService.MAX_BACKGROUND_BYTES) {
      const kb = Math.round(encodedSize / 1024);
      throw new BadRequestException(
        `Картинка слишком большая (${kb} КБ после кодирования). Максимум 700 КБ — выберите изображение поменьше.`,
      );
    }
    // Тип берём из белого списка, а не из присланного заголовка: значение
    // подставляется в CSS внутрь url("…"), и произвольная строка оттуда
    // означала бы инъекцию стилей.
    const mime = UsersService.BACKGROUND_MIME.has(file.mimetype) ? file.mimetype : 'image/jpeg';
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;
    const nextDim = dim === undefined ? undefined : this.clampDim(dim);
    const nextScale = scale === undefined ? undefined : this.clampScale(scale);
    // Пропорции новой картинки — всегда: иначе масштаб считался бы от
    // размеров предыдущей.
    const nextRatio = this.clampRatio(ratio);
    await this.repo.update(userId, {
      backgroundImage: dataUri,
      backgroundRatio: nextRatio === null ? null : (String(nextRatio) as any),
      ...(nextDim === undefined ? {} : { backgroundDim: nextDim }),
      ...(nextScale === undefined ? {} : { backgroundScale: nextScale }),
    });
    return this.getBackground(userId);
  }

  /** Затемнение и масштаб — двигаются ползунками, картинку заново не гоняем. */
  async setBackgroundView(userId: string, dim?: unknown, scale?: unknown) {
    const patch: Record<string, number> = {};
    if (dim !== undefined) patch.backgroundDim = this.clampDim(dim);
    if (scale !== undefined) patch.backgroundScale = this.clampScale(scale);
    if (Object.keys(patch).length) await this.repo.update(userId, patch);
    return this.getBackground(userId);
  }

  async clearBackground(userId: string) {
    // Пропорции — свойство картинки, а не настройка сотрудника: без неё они
    // становятся мусором и исказили бы масштаб следующей загрузки, если та
    // почему-то придёт без ratio. Затемнение и масштаб оставляем — это
    // предпочтения, к ним человек вернётся со следующими обоями.
    await this.repo.update(userId, { backgroundImage: null, backgroundRatio: null });
    return this.getBackground(userId);
  }

  /** Фотография по ключу «db:<uuid>» — для публичной отдачи картинки.
   *  avatarImage помечена select:false, читаем явно. */
  async getAvatarImage(key: string): Promise<{ mime: string; data: Buffer } | null> {
    // Ключ приходит из URL — пускаем только формат uuid, чтобы в LIKE
    // или сравнение не уехало ничего постороннего.
    if (!/^[0-9a-f-]{36}$/i.test(key)) return null;
    const row = await this.repo
      .createQueryBuilder('u')
      .select(['u.id'])
      .addSelect('u.avatarImage')
      .where('u.avatar = :key', { key: `db:${key}` })
      .getOne()
      .catch(() => null);
    const uri = row?.avatarImage;
    if (!uri) return null;
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
    if (!m) return null;
    const mime = UsersService.AVATAR_MIME.has(m[1]) ? m[1] : 'image/jpeg';
    return { mime, data: Buffer.from(m[2], 'base64') };
  }

  /** Сохранение фотографии сотрудника. Кладём в БД: диск на Railway
   *  эфемерный, файлы исчезали при каждом редеплое. */
  async updateAvatarFile(
    id: string,
    file: Express.Multer.File,
    actor?: { id: string; role?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл пустой');
    // Размер считаем до кодирования: base64 раздувает данные на треть.
    const encoded = Math.ceil(file.buffer.length / 3) * 4;
    if (encoded > UsersService.MAX_AVATAR_BYTES) {
      const kb = Math.round(encoded / 1024);
      throw new BadRequestException(
        `Фотография слишком тяжёлая (${kb} КБ). Выберите изображение поменьше.`,
      );
    }
    const mime = UsersService.AVATAR_MIME.has(file.mimetype) ? file.mimetype : 'image/jpeg';
    const key = uuidv4();
    // Ключ меняется при каждой загрузке — браузер сам берёт новое фото,
    // и картинку можно отдавать с «вечным» кэшем.
    return this.updateAvatar(id, `db:${key}`, actor, `data:${mime};base64,${file.buffer.toString('base64')}`);
  }

  async updateAvatar(
    id: string,
    avatar: string,
    actor?: { id: string; role?: string },
    avatarImage?: string,
  ) {
    const user = await this.findOne(id);
    // Security: смена аватарки другого пользователя должна проходить через
    // ту же policy-проверку assertCanManage, что и остальные mutator'ы
    // (block/unblock/update/remove/toggleActive/resetPassword). Self-edit
    // (юзер меняет аватарку САМ СЕБЕ) разрешён всегда — пропускаем проверку
    // когда actor.id совпадает с id целевого юзера. Без этого admin мог
    // менять аватарку founder/co_founder в обход документированной политики.
    if (actor && actor.id !== id) {
      this.assertCanManage(user, actor.role);
    }
    await this.repo.update(id, avatarImage ? { avatar, avatarImage } : { avatar });

    // У Employee своя колонка avatar — синхронизируем, иначе на странице
    // сотрудников и в карточках задач (где avatar тянется из employee)
    // останутся инициалы вместо загруженной картинки.
    const employee = await this.employeeRepo.findOne({ where: { userId: id } });
    if (employee) {
      await this.employeeRepo.update(employee.id, { avatar });
    }

    await this.activityLog.log({
      userId: id,
      userName: user.name,
      action: ActivityAction.AVATAR_UPDATE,
      entity: 'user',
      entityId: id,
      entityName: user.name,
    });

    // Broadcast чтобы списки сотрудников и проектов обновились без F5.
    try {
      this.gateway.broadcast('employees:changed', {});
    } catch {}

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
