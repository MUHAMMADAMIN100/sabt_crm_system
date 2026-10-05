import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Заявки на возврат денег за транспорт по работе (05.10.2026): SMM-специалисты
 * и видеографы подают, владелец оплачивает в Финансах. Всё IF NOT EXISTS —
 * повторный прогон не роняет сервер.
 */
export class TransportRequests1813000000000 implements MigrationInterface {
  name = 'TransportRequests1813000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transport_requests (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "employeeId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "projectId" uuid REFERENCES projects(id) ON DELETE SET NULL,
        "projectName" varchar(200),
        amount decimal(12,2) NOT NULL,
        date date NOT NULL,
        note text,
        "receiptKey" uuid,
        "receiptImage" text,
        status varchar(12) NOT NULL DEFAULT 'pending',
        "rejectReason" text,
        "decidedById" uuid,
        "decidedAt" timestamptz,
        "financeTxId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transport_requests_status" ON transport_requests (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_transport_requests_employee" ON transport_requests ("employeeId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transport_requests`);
  }
}
