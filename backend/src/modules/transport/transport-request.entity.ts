import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Заявка на возврат денег за транспорт по работе (05.10.2026, решение
 * владельца): SMM-специалист или видеограф съездил на съёмку или к клиенту
 * за свой счёт, подаёт заявку из своей панели, владелец в Финансах
 * «Оплачивает» — и система записывает расход «Транспорт».
 */
@Entity('transport_requests')
export class TransportRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Кто ездил (users.id). */
  @Column({ type: 'uuid' })
  employeeId: string;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  /** Название проекта на момент заявки — если проект потом переименуют или удалят. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  projectName: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  /** Дата поездки 'YYYY-MM-DD'. */
  @Column({ type: 'date' })
  date: string;

  /** Куда и зачем. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Ключ фото чека: картинку отдаёт /api/transport-receipts/<ключ>.
   *  Случайный uuid — по нему нельзя перебрать чужие чеки. */
  @Column({ type: 'uuid', nullable: true })
  receiptKey: string | null;

  /** Фото чека или скриншот поездки как data URI. В БД, а не на диске:
   *  диск на Railway эфемерный, файлы пропадали бы при каждом редеплое.
   *  select:false — картинка не ездит в списках, её забирают по ключу. */
  @Column({ type: 'text', nullable: true, select: false })
  receiptImage: string | null;

  /** pending — ждёт оплаты, paying — оплачивается прямо сейчас, paid, rejected. */
  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: 'pending' | 'paying' | 'paid' | 'rejected';

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** Расход «Транспорт» в Финансах, созданный при оплате. */
  @Column({ type: 'uuid', nullable: true })
  financeTxId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
