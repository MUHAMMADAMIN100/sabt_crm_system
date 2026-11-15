import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Единая воронка (15.11.2026, миграции 1834–1835): этап лида — только
 * status. Порядок: new → waiting → meeting → proposal → contract → won;
 * lost — проигрыш. «На паузе» — флаг onHold, не этап.
 * NEGOTIATING, ON_HOLD, UNKNOWN — устаревшие значения pg-enum: данные
 * перенесены, новые записи их не получают (DTO не принимает).
 */
export enum ClientLeadStatus {
  NEW         = 'new',           // Новый
  WAITING     = 'waiting',       // Контакт (связались, идёт разговор)
  MEETING     = 'meeting',       // Встреча
  PROPOSAL    = 'proposal',      // КП
  CONTRACT    = 'contract',      // Договор
  WON         = 'won',           // Выиграно
  LOST        = 'lost',          // Проиграно
  /** @deprecated перенесено в waiting (миграция 1835) */
  NEGOTIATING = 'negotiating',
  /** @deprecated теперь флаг onHold (миграция 1835) */
  ON_HOLD     = 'on_hold',
  /** @deprecated перенесено в new (миграция 1835) */
  UNKNOWN     = 'unknown',
}

/** Этапы единой воронки по порядку (без проигрыша). */
export const LEAD_FUNNEL: readonly ClientLeadStatus[] = [
  ClientLeadStatus.NEW, ClientLeadStatus.WAITING, ClientLeadStatus.MEETING,
  ClientLeadStatus.PROPOSAL, ClientLeadStatus.CONTRACT, ClientLeadStatus.WON,
];

/** Статусы, которые можно ставить (устаревшие — нельзя). */
export const LEAD_STATUSES_SETTABLE: readonly ClientLeadStatus[] = [...LEAD_FUNNEL, ClientLeadStatus.LOST];

/** Вероятность сделки по этапу, %, если менеджер не указал свою. */
export const STAGE_PROBABILITY: Record<string, number> = {
  new: 10, waiting: 25, meeting: 40, proposal: 60, contract: 80, won: 100, lost: 0,
  negotiating: 25, on_hold: 25, unknown: 10,
};

/** Причина проигрыша — код (текст «Другое» — в rejectionReason). */
export const LOST_REASONS = ['price', 'competitor', 'not_lpr', 'no_response', 'not_needed', 'other'] as const;
export type LostReason = typeof LOST_REASONS[number];

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

  // ─── Продажи, этап 2 (15.11.2026, миграция 1834) ──────────────────────

  /** На паузе — флаг поверх этапа (раньше был статусом on_hold). */
  @Column({ default: false })
  onHold: boolean;

  /** Срок следующего шага (текст шага — nextStep). */
  @Column({ type: 'timestamp with time zone', nullable: true })
  nextStepAt: Date | null;

  /** Вероятность сделки, % (null — по этапу, STAGE_PROBABILITY). */
  @Column({ type: 'int', nullable: true })
  probability: number | null;

  /** Ожидаемая дата закрытия сделки. */
  @Column({ type: 'date', nullable: true })
  expectedCloseAt: string | null;

  /** Причина проигрыша — код из LOST_REASONS. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  lostReason: LostReason | null;

  /** Итог текущей встречи (nextContactAt): held — состоялась, missed — нет.
   *  Сбрасывается, когда встречу переносят. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  meetingResult: 'held' | 'missed' | null;

  /** «Передать в работу»: когда, кто и что передано (см. SalesService). */
  @Column({ type: 'timestamp with time zone', nullable: true })
  handoffAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  handoffById: string | null;

  @Column({ type: 'jsonb', nullable: true })
  handoffData: Record<string, any> | null;

  /** Проект, созданный по этому лиду. */
  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
