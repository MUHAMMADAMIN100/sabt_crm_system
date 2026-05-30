import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * Refresh-токен в БД. Хранится только HASH (sha256), чтобы из дампа БД
 * нельзя было восстановить рабочий токен. revokedAt отмечает, что токен
 * больше нельзя использовать — logout / rotation / админская блокировка.
 *
 * Срок жизни: 30 дней (контролируется в auth.service).
 * Контракт безопасности:
 *  - access-токен живёт 15 минут — стоимость кражи минимальна;
 *  - refresh-токен 30 дней, но он httpOnly + secure cookie, недоступен JS;
 *  - на каждом /auth/refresh старый refresh помечается revokedAt и
 *    выдаётся новый (rotation), что обнаруживает кражу: если кто-то
 *    использует уже отозванный токен — это сигнал, можно
 *    инвалидировать все refresh'ы пользователя.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  /** SHA-256 от сырого refresh-токена. Сравнение через timing-safe equal. */
  @Index()
  @Column()
  tokenHash: string;

  /** Когда токен помечен использованным/отозванным. NULL — активен. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  revokedAt: Date | null;

  /** Цепочка ротаций — кто заменил этот токен. Если используется
   *  уже-отозванный токен с непустым replacedBy — потенциальная кража. */
  @Column({ type: 'uuid', nullable: true })
  replacedBy: string | null;

  /** Истечение по факту (для cleanup-крон). */
  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  /** IP и UserAgent при создании — для security log. */
  @Column({ nullable: true })
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
