import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum ClientLeadStatus {
  NEW         = 'new',           // Новый
  WAITING     = 'waiting',       // Ожидание ответа
  NEGOTIATING = 'negotiating',   // В переговорах
  PROPOSAL    = 'proposal',      // Предложение отправлено
  WON         = 'won',           // Сделка закрыта / клиент
  LOST        = 'lost',          // Отказ
  ON_HOLD     = 'on_hold',       // На паузе
  /** Неизвестно — статус для направления разработки (просьба МП по dev).
   *  На проде значение добавляется в pg-enum идемпотентным ALTER TYPE
   *  в ClientsService.onModuleInit. */
  UNKNOWN     = 'unknown',       // Неизвестно
}

export enum ClientLeadInterest {
  COLD = 'cold',     // Холодный
  WARM = 'warm',     // Тёплый
  HOT  = 'hot',      // Горячий
}

/** Направление лида — определяет, какой менеджер продаж его ведёт. */
export enum ClientLeadDirection {
  SMM         = 'smm',          // СММ
  DEVELOPMENT = 'development',  // Разработка
}

/** Этап онбординга клиента — колонки канбан-доски «Онбординг». */
export enum ClientLeadOnboardingStage {
  NEGOTIATION    = 'negotiation',     // Переговор (используется МП по разработке)
  MEETING        = 'meeting',         // Встреча
  KP_CREATION    = 'kp_creation',     // Создание КП
  IMPLEMENTATION = 'implementation',  // Реализация
  CONTRACT       = 'contract',        // Договор
  CANCELLED      = 'cancelled',       // Отмена — клиент отказался / снят с воронки
}

@Entity('client_leads')
export class ClientLead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Название компании / бренда / клиента */
  @Column()
  name: string;

  /** Сфера (рестораны, клиники, блогеры, отели и т.д.) */
  @Column({ nullable: true })
  sphere: string;

  /** Какая проблема / какая услуга нужна (Разработка сайта, SMM, и т.д.) */
  @Column({ type: 'text', nullable: true })
  problem: string;

  @Column({ nullable: true })
  address: string;

  /** ЛПР — имя лица, принимающего решение */
  @Column({ nullable: true })
  contactPerson: string;

  /** Старое поле «контакты одной строкой» — остаётся для миграции/совместимости.
   *  Новый ввод заполняет contactPhone / contactInstagram / contactEmail. */
  @Column({ type: 'text', nullable: true })
  contactInfo: string;

  /** Телефон ЛПР (отдельное поле — для звонков/поиска/KPI). */
  @Column({ nullable: true })
  contactPhone: string;

  /** Instagram ЛПР (@handle или ссылка). */
  @Column({ nullable: true })
  contactInstagram: string;

  /** Email ЛПР. */
  @Column({ nullable: true })
  contactEmail: string;

  @Column({ type: 'enum', enum: ClientLeadStatus, default: ClientLeadStatus.NEW })
  status: ClientLeadStatus;

  @Column({ type: 'text', nullable: true })
  nextStep: string;

  /** Откуда пришёл лид: instagram, рекомендация, холодный обзвон и т.д. */
  @Column({ nullable: true })
  leadSource: string;

  /** Потенциал сделки в сомони */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  dealPotential: number;

  @Column({ type: 'enum', enum: ClientLeadInterest, nullable: true })
  interest: ClientLeadInterest;

  /** Направление лида (СММ / Разработка). Проставляется автоматически по
   *  сегменту менеджера-создателя. Старые лиды могут быть null. */
  @Column({ type: 'enum', enum: ClientLeadDirection, nullable: true })
  direction: ClientLeadDirection;

  /** Этап онбординга — позиция клиента на канбан-доске «Онбординг».
   *  null — клиент не на доске онбординга. */
  @Column({ type: 'enum', enum: ClientLeadOnboardingStage, nullable: true })
  onboardingStage: ClientLeadOnboardingStage;

  @Column({ type: 'date', nullable: true })
  lastContactAt: Date;

  /** Последняя активность менеджера с клиентом (создание / правка / звонок).
   *  Показывается в Базе клиентов: «5 часов назад» / «12 июн». Обновляется
   *  raw-запросом при «Позвонил», чтобы не двигать лид по сортировке updatedAt. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  lastActivityAt: Date | null;

  /** Дата+время следующей встречи / контакта (timestamp). На этот момент
   *  создаётся личная задача в Календаре и приходит напоминание. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  nextContactAt: Date;

  /** Дата+время ПОВТОРНОГО звонка клиенту — отдельно от встречи
   *  (nextContactAt). Показывается в календаре менеджера оранжевым
   *  событием «Повторно позвонить». На KPI встреч не влияет. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  repeatCallAt: Date | null;

  /** Канал общения: whatsapp, instagram, telegram, email, call, ... */
  @Column({ nullable: true })
  channel: string;

  /** Явный «тип звонка» — выбирается менеджером отдельным селектом в форме
   *  лида: 'cold' / 'neutral' / 'hot'. Используется для KPI «Холодные звонки»
   *  (раньше это была эвристика по channel — Звонок/WhatsApp/Telegram).
   *  Теперь — точная цифра по тем лидам, где менеджер сам пометил «холодный». */
  @Column({ nullable: true })
  callType: string;

  /** Статус персонального письма клиенту:
   *   'sent'     — Написал (засчитывается в KPI «Персональные письма»)
   *   'answered' — Клиент ответил
   *   'no_reply' — Не ответили
   *   'rejected' — Отказ
   *  Используется для KPI вместо старой эвристики (просто заполнен email). */
  @Column({ nullable: true })
  emailStatus: string;

  /** Причина отказа (если status = lost) */
  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  /** «Позвонить» — флаг от руководителя: основатель/сооснователь/админ
   *  отмечает лида в Базе клиентов → у менеджера-владельца появляется
   *  задача обзвонить. Менеджер снимает флаг после звонка. */
  @Column({ default: false })
  callRequested: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  callRequestedAt: Date | null;

  /** Имя руководителя, поставившего отметку (для подписи у менеджера). */
  @Column({ nullable: true })
  callRequestedByName: string | null;

  /** Кто создал / ведёт лид (обычно менеджер по продажам) */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({ nullable: true })
  ownerId: string;

  /** ID авто-сгенерированной личной задачи-встречи в tasks.
   *  При установке nextContactAt создаётся task (scope=personal) с дедлайном
   *  на эту дату — она отображается в календаре и в Задачах под фильтром «Мои».
   *  При обнулении nextContactAt — задача удаляется. */
  @Column({ type: 'uuid', nullable: true })
  meetingTaskId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
