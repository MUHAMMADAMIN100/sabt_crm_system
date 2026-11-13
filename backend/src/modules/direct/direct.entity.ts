import {
  Entity, PrimaryGeneratedColumn, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index, Unique,
} from 'typeorm';
import { User } from '../users/user.entity';
import { ClientLead } from '../clients/client-lead.entity';

/**
 * «Директ» — переписка Instagram аккаунта агентства в CRM (04.11.2026).
 *
 * Чат видят все, у кого есть доступ к Базе клиентов. С 06.11.2026 клиент
 * закрепляется за менеджером продаж, который первым ответил ему из CRM
 * (правила — в direct-access.ts): чужой закреплённый чат менеджер только
 * читает. Ещё храним, кто ответил последним и с какого момента клиент ждёт.
 *
 * На проде таблицы создают миграции 1822000000000-AddDirectInstagram и
 * 1823000000000-DirectAssignee, локально — synchronize. Поля должны совпадать.
 */

/** Мессенджер переписки. Пока только Instagram; WhatsApp добавится позже. */
export type DirectChannel = 'instagram';

/** in — написал клиент; out — агентство (из CRM или из приложения Instagram);
 *  note — заметка для команды, клиенту не уходит; event — отметка в ленте
 *  о том, кто ведёт чат («закреплён за…», «передан…»). */
export type DirectDirection = 'in' | 'out' | 'note' | 'event';

/** Судьба исходящего: sending — ушло в Instagram, ответа ещё нет;
 *  sent — Instagram принял; read — клиент прочитал; failed — не ушло. */
export type DirectStatus = 'sending' | 'sent' | 'read' | 'failed';

export type DirectAttachmentKind =
  | 'image' | 'video' | 'audio' | 'file' | 'sticker'
  | 'share' | 'reel' | 'story' | 'unsupported';

@Entity('direct_conversations')
@Unique('UQ_direct_conversations_contact', ['channel', 'accountId', 'contactId'])
export class DirectConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, default: 'instagram' })
  channel: DirectChannel;

  /** Аккаунт агентства, через который идёт переписка (id в Instagram). */
  @Column({ type: 'varchar', length: 64 })
  accountId: string;

  /** Собеседник так, как его знает Instagram (IGSID — свой у каждого аккаунта). */
  @Column({ type: 'varchar', length: 64 })
  contactId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contactName: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  contactUsername: string | null;

  /** Фото собеседника, сохранённое CRM: ссылка Instagram живёт несколько дней. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  contactPicture: string | null;

  /** Когда в последний раз спрашивали имя и фото — раз в неделю обновляем. */
  @Column({ type: 'timestamptz', nullable: true })
  profileCheckedAt: Date | null;

  /** Последнее сообщение любой стороны — по нему сортируется список. */
  @Index('IDX_direct_conversations_last')
  @Column({ type: 'timestamptz' })
  lastMessageAt: Date;

  /** Последнее сообщение клиента: Instagram даёт ответить 24 часа после него. */
  @Column({ type: 'timestamptz', nullable: true })
  lastIncomingAt: Date | null;

  /** Сообщения клиента, которые ещё никто не открыл. */
  @Column({ type: 'int', default: 0 })
  unreadCount: number;

  /** С какого момента клиент ждёт ответа: первое сообщение после нашего
   *  последнего ответа. NULL — ответа никто не ждёт. */
  @Column({ type: 'timestamptz', nullable: true })
  waitingSince: Date | null;

  /** Кто ответил последним. NULL при lastReplyAt — ответ из приложения Instagram. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lastReplyById' })
  lastReplyBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  lastReplyById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastReplyAt: Date | null;

  /** Менеджер продаж, который ведёт клиента: первым ответил ему из CRM или
   *  получил чат от руководства/коллеги. NULL — чат свободный. */
  @Index('IDX_direct_conversations_assignee')
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigneeId' })
  assignee: User | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  /** Когда клиент закрепился за нынешним менеджером. */
  @Column({ type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  /** Лид, созданный из чата кнопкой «Создать лид». */
  @ManyToOne(() => ClientLead, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'leadId' })
  lead: ClientLead | null;

  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  /** Закреплён сверху списка — у всей команды (13.11.2026). */
  @Column({ type: 'timestamptz', nullable: true })
  pinnedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  pinnedById: string | null;

  /** В архиве — у всей команды. Новое сообщение клиента возвращает чат. */
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  archivedById: string | null;

  /** «Пометить непрочитанным»: вернуться к чату позже. Снимается, когда
   *  чат открыл тот, кто вправе снять непрочитанное (см. markRead). */
  @Column({ type: 'boolean', default: false })
  markedUnread: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('direct_messages')
@Index('IDX_direct_messages_conversation', ['conversationId', 'sentAt'])
export class DirectMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DirectConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: DirectConversation;

  @Column({ type: 'uuid' })
  conversationId: string;

  @Column({ type: 'varchar', length: 8 })
  direction: DirectDirection;

  /** id сообщения в Instagram (mid): повтор уведомления узнаётся по нему. */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  externalId: string | null;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  /** Только у исходящих. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  status: DirectStatus | null;

  /** Почему исходящее не ушло — код, который CRM переводит для людей. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  error: string | null;

  /** Сотрудник, написавший в CRM. NULL у клиента и у написанного в приложении Instagram. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'authorId' })
  author: User | null;

  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;

  /** Момент сообщения по Instagram (для своих — момент отправки). */
  @Column({ type: 'timestamptz' })
  sentAt: Date;

  /** На какое сообщение это ответ (mid Instagram). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  replyToExternalId: string | null;

  /** Реакция клиента на сообщение. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  contactReaction: string | null;

  /** Реакция агентства (из CRM или из приложения Instagram). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  ourReaction: string | null;

  /** Клиент удалил сообщение: текста и файлов больше нет. */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('direct_attachments')
export class DirectAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_direct_attachments_message')
  @ManyToOne(() => DirectMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message: DirectMessage;

  @Column({ type: 'uuid' })
  messageId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: DirectAttachmentKind;

  /** Файл, сохранённый CRM. NULL — есть только ссылка или скачать не вышло. */
  @Column({ type: 'varchar', length: 80, nullable: true, unique: true })
  storedName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mimeType: string | null;

  @Column({ type: 'int', nullable: true })
  size: number | null;

  /** Имя документа, как его назвал отправитель, или подпись к публикации. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  /** Где оригинал: ссылка Instagram на файл, публикацию, рилс или сторис. */
  @Column({ type: 'text', nullable: true })
  url: string | null;

  /** Файл, который отправляем мы: Instagram скачивает его сам, поэтому
   *  он отдаётся без входа — по случайному имени и только такие файлы. */
  @Column({ type: 'boolean', default: false })
  isPublic: boolean;

  /** Сколько раз не удалось скачать файл. После пяти — только ссылка. */
  @Column({ type: 'int', default: 0 })
  fetchAttempts: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Настройки «Директа» ключ → значение. Здесь живёт продлённый ключ Instagram. */
@Entity('direct_settings')
export class DirectSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'jsonb' })
  value: any;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Ответ на ожидание клиента — для «Скорости ответа». Пишется в момент,
 *  когда агентство ответило ждущему клиенту. */
@Entity('direct_replies')
export class DirectReply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DirectConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: DirectConversation;

  @Column({ type: 'uuid' })
  conversationId: string;

  /** Кто ответил. NULL — ответили из приложения Instagram. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'timestamptz' })
  waitedSince: Date;

  @Index('IDX_direct_replies_answered')
  @Column({ type: 'timestamptz' })
  answeredAt: Date;

  /** Сколько клиент ждал, в секундах. */
  @Column({ type: 'int' })
  seconds: number;
}

/** Метка чата («горячий», «SMM», «сайт»…). Справочник ведёт руководство.
 *  Уникальность без учёта регистра — индекс по lower(name) из миграции
 *  1829000000000 (synchronize его не трогает). */
@Entity('direct_labels')
@Index('UQ_direct_labels_name_ci', { synchronize: false })
export class DirectLabel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  name: string;

  /** Ключ цвета из палитры страницы (amber, sky, violet…). */
  @Column({ type: 'varchar', length: 16, default: 'sky' })
  color: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Какие метки стоят на чате. */
@Entity('direct_conversation_labels')
export class DirectConversationLabel {
  @PrimaryColumn({ type: 'uuid' })
  conversationId: string;

  @PrimaryColumn({ type: 'uuid' })
  labelId: string;

  @ManyToOne(() => DirectConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: DirectConversation;

  @Index('IDX_direct_conversation_labels_label')
  @ManyToOne(() => DirectLabel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'labelId' })
  label: DirectLabel;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Шаблон быстрого ответа. ownerId NULL — общий (ведёт руководство), иначе личный. */
@Entity('direct_templates')
export class DirectTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_direct_templates_owner')
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: User | null;

  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'varchar', length: 80 })
  title: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Напоминание «вернуться к клиенту» — личное: получает тот, кто поставил. */
@Entity('direct_reminders')
@Index('IDX_direct_reminders_due', ['doneAt', 'remindAt'])
export class DirectReminder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_direct_reminders_conversation')
  @ManyToOne(() => DirectConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: DirectConversation;

  @Column({ type: 'uuid' })
  conversationId: string;

  @Index('IDX_direct_reminders_user')
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'timestamptz' })
  remindAt: Date;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  /** Когда ушло уведомление. */
  @Column({ type: 'timestamptz', nullable: true })
  firedAt: Date | null;

  /** Снято: «Готово» или ответ клиенту после срока. */
  @Column({ type: 'timestamptz', nullable: true })
  doneAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
