import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Директ»: инструменты чата (13.11.2026) — закреп, архив, «непрочитанное»,
 * метки, шаблоны быстрых ответов, напоминания, реакция агентства и типы
 * уведомлений «упоминание» и «напоминание». Поля повторяют direct.entity.ts —
 * локально их создаёт synchronize.
 */
export class DirectChatTools1828000000000 implements MigrationInterface {
  name = 'DirectChatTools1828000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "pinnedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "pinnedById" uuid`);
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "archivedById" uuid`);
    await queryRunner.query(`ALTER TABLE direct_conversations ADD COLUMN IF NOT EXISTS "markedUnread" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS "ourReaction" varchar(16)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_labels (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name varchar(40) NOT NULL,
        color varchar(16) NOT NULL DEFAULT 'sky',
        "sortOrder" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_direct_labels_name" UNIQUE (name)
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_conversation_labels (
        "conversationId" uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
        "labelId" uuid NOT NULL REFERENCES direct_labels(id) ON DELETE CASCADE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("conversationId", "labelId")
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_conversation_labels_label" ON direct_conversation_labels ("labelId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_templates (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ownerId" uuid REFERENCES users(id) ON DELETE CASCADE,
        title varchar(80) NOT NULL,
        text text NOT NULL,
        "createdById" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_templates_owner" ON direct_templates ("ownerId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_reminders (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "remindAt" timestamptz NOT NULL,
        note varchar(300),
        "firedAt" timestamptz,
        "doneAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_reminders_conversation" ON direct_reminders ("conversationId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_reminders_user" ON direct_reminders ("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_reminders_due" ON direct_reminders ("doneAt", "remindAt")`);

    // Типы уведомлений — как в 1822000000000: проверка заранее, а не
    // try/catch, — ошибка оборвала бы транзакцию миграции.
    for (const value of ['direct_mention', 'direct_reminder']) {
      await queryRunner.query(`
        DO $$
        DECLARE t text;
        BEGIN
          FOREACH t IN ARRAY ARRAY['notifications_type_enum', 'notification_type_enum'] LOOP
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = t)
               AND NOT EXISTS (
                 SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
                 WHERE ty.typname = t AND e.enumlabel = '${value}'
               ) THEN
              EXECUTE format('ALTER TYPE %I ADD VALUE %L', t, '${value}');
            END IF;
          END LOOP;
        END
        $$;`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS direct_reminders`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_templates`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_conversation_labels`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_labels`);
    await queryRunner.query(`ALTER TABLE direct_messages DROP COLUMN IF EXISTS "ourReaction"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "markedUnread"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "archivedById"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "archivedAt"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "pinnedById"`);
    await queryRunner.query(`ALTER TABLE direct_conversations DROP COLUMN IF EXISTS "pinnedAt"`);
    // Значения enum в Postgres не удаляются — оставляем, они безвредны.
  }
}
