import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('finance_forecast_adjustments')
export class FinanceForecastAdjustment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'varchar', length: 12 }) type: 'income' | 'expense';
  @Column({ type: 'decimal', precision: 15, scale: 2 }) amount: number;
  @Column({ type: 'varchar', length: 7 }) startYm: string;
  @Column({ type: 'varchar', length: 7, nullable: true }) endYm: string | null;
  @Column({ type: 'varchar', length: 12, default: 'once' }) recurrence: 'once' | 'monthly';
  @Column({ type: 'varchar', length: 16, default: 'all' }) scenario: 'all' | 'base' | 'conservative' | 'optimistic';
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn() createdAt: Date;
}
