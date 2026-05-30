import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** Тип события безопасности. */
export enum SecurityEventType {
  LOGIN_SUCCESS         = 'login_success',
  LOGIN_FAIL            = 'login_fail',           // неверный пароль / неизвестный email
  LOGIN_BLOCKED         = 'login_blocked',        // пользователь заблокирован
  LOGOUT                = 'logout',
  PASSWORD_CHANGE       = 'password_change',
  PASSWORD_RESET_REQ    = 'password_reset_req',
  PASSWORD_RESET_DONE   = 'password_reset_done',
  TOKEN_REFRESH         = 'token_refresh',
  REFRESH_REUSE         = 'refresh_reuse',        // отозванный refresh использован повторно — потенциальная кража
  FORBIDDEN_ACCESS      = 'forbidden_access',     // 403 на endpoint — попытка доступа выше своей роли
  ROLE_CHANGED          = 'role_changed',         // админ сменил роль
  USER_BLOCKED          = 'user_blocked',
  USER_UNBLOCKED        = 'user_unblocked',
  TWO_FACTOR_ENABLED    = 'two_factor_enabled',
  TWO_FACTOR_DISABLED   = 'two_factor_disabled',
  TWO_FACTOR_FAIL       = 'two_factor_fail',
}

/** Запись в журнале безопасности. Для админа: вижу что происходит,
 *  кто пытался залогиниться 50 раз подряд, кто подменяет роль. */
@Entity('security_events')
export class SecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: SecurityEventType })
  type: SecurityEventType;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** Email из попытки логина — даже если такого юзера нет в системе. */
  @Column({ nullable: true })
  email: string | null;

  @Index()
  @Column({ nullable: true })
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  /** Произвольные детали в JSON: какой endpoint, какая роль и т.п. */
  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any> | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
