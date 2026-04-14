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
}

export enum ClientLeadInterest {
  COLD = 'cold',     // Холодный
  WARM = 'warm',     // Тёплый
  HOT  = 'hot',      // Горячий
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

  /** Контакты ЛПР: телефон / email / instagram / telegram — свободный текст */
  @Column({ type: 'text', nullable: true })
  contactInfo: string;

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

  @Column({ type: 'date', nullable: true })
  lastContactAt: Date;

  @Column({ type: 'date', nullable: true })
  nextContactAt: Date;

  /** Канал общения: whatsapp, instagram, telegram, email, call, ... */
  @Column({ nullable: true })
  channel: string;

  /** Причина отказа (если status = lost) */
  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  /** Кто создал / ведёт лид (обычно менеджер по продажам) */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({ nullable: true })
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
