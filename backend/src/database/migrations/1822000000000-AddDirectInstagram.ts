import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Директ» (04.11.2026): переписка Instagram аккаунта агентства в CRM.
 * Чаты, сообщения, вложения, ответы (для «Скорости ответа») и настройки,
 * где хранится продлённый ключ Instagram. Плюс два типа уведомлений.
 *
 * Поля повторяют direct.entity.ts — локально таблицы создаёт synchronize.
 */
export class AddDirectInstagram1822000000000 implements MigrationInterface {
  name = 'AddDirectInstagram1822000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_conversations (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        channel varchar(16) NOT NULL DEFAULT 'instagram',
        "accountId" varchar(64) NOT NULL,
        "contactId" varchar(64) NOT NULL,
        "contactName" varchar(200),
        "contactUsername" varchar(200),
        "contactPicture" varchar(80),
        "profileCheckedAt" timestamptz,
        "lastMessageAt" timestamptz NOT NULL,
        "lastIncomingAt" timestamptz,
        "unreadCount" int NOT NULL DEFAULT 0,
        "waitingSince" timestamptz,
        "lastReplyById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "lastReplyAt" timestamptz,
        "leadId" uuid REFERENCES client_leads(id) ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_direct_conversations_contact" UNIQUE (channel, "accountId", "contactId")
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_conversations_last" ON direct_conversations ("lastMessageAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
        direction varchar(8) NOT NULL,
        "externalId" varchar(255) UNIQUE,
        text text,
        status varchar(12),
        error varchar(32),
        "authorId" uuid REFERENCES users(id) ON DELETE SET NULL,
        "sentAt" timestamptz NOT NULL,
        "replyToExternalId" varchar(255),
        "contactReaction" varchar(16),
        "deletedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_messages_conversation" ON direct_messages ("conversationId", "sentAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_attachments (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "messageId" uuid NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
        kind varchar(16) NOT NULL,
        "storedName" varchar(80) UNIQUE,
        "mimeType" varchar(120),
        size int,
        name varchar(255),
        url text,
        "isPublic" boolean NOT NULL DEFAULT false,
        "fetchAttempts" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_attachments_message" ON direct_attachments ("messageId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_settings (
        key varchar(64) PRIMARY KEY,
        value jsonb NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS direct_replies (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL REFERENCES direct_conversations(id) ON DELETE CASCADE,
        "userId" uuid REFERENCES users(id) ON DELETE SET NULL,
        "waitedSince" timestamptz NOT NULL,
        "answeredAt" timestamptz NOT NULL,
        seconds int NOT NULL
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_direct_replies_answered" ON direct_replies ("answeredAt")`);

    // Типы уведомлений: новый чат и новое сообщение в «Директе». В старых
    // базах тип назывался по-разному — добавляем туда, где он есть. Проверка
    // заранее, а не try/catch: ошибка оборвала бы транзакцию миграции.
    for (const value of ['direct_new_chat', 'direct_message']) {
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
    // Значения enum в Postgres не удаляются — оставляем, они безвредны.
    await queryRunner.query(`DROP TABLE IF EXISTS direct_replies`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_settings`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_attachments`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS direct_conversations`);
  }
}
