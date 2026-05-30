import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Безопасность: добавляем refresh-токены и журнал событий безопасности.
 *
 *  - refresh_tokens: хранение хешей refresh-токенов с rotation/revocation.
 *  - security_events: журнал логинов, неудачных попыток, 403, смены ролей,
 *    включения/выключения 2FA.
 *
 *  Также готовим колонки в users для будущего 2FA: twoFactorSecret,
 *  twoFactorEnabled (не активны до выкатки UI).
 */
export class AddSecurityHardening1748400000000 implements MigrationInterface {
  name = 'AddSecurityHardening1748400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // refresh_tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenHash" varchar NOT NULL,
        "revokedAt" timestamptz,
        "replacedBy" uuid,
        "expiresAt" timestamptz NOT NULL,
        "ip" varchar,
        "userAgent" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_rt_userId" ON "refresh_tokens"("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_rt_tokenHash" ON "refresh_tokens"("tokenHash")`);

    // security_events
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "security_event_type_enum" AS ENUM (
          'login_success','login_fail','login_blocked','logout','password_change',
          'password_reset_req','password_reset_done','token_refresh','refresh_reuse',
          'forbidden_access','role_changed','user_blocked','user_unblocked',
          'two_factor_enabled','two_factor_disabled','two_factor_fail'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "type" "security_event_type_enum" NOT NULL,
        "userId" uuid,
        "email" varchar,
        "ip" varchar,
        "userAgent" text,
        "details" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_se_type" ON "security_events"("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_se_userId" ON "security_events"("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_se_ip" ON "security_events"("ip")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_se_createdAt" ON "security_events"("createdAt")`);

    // users: 2FA поля
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "twoFactorSecret" varchar,
      ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "twoFactorSecret"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "twoFactorEnabled"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_events"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "security_event_type_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
