import { MigrationInterface, QueryRunner } from 'typeorm';

/** Outbox вебхуков доски (контракт E): подписки (dev_webhook_subscription,
 *  projectId null = все проекты, иначе скоуп одним проектом) и журнал
 *  доставок (dev_webhook_delivery, одна строка на событие-подписку, ретраи
 *  обновляют status/error). Удаление подписки сносит журнал (CASCADE),
 *  удаление проекта — отвязывает подписку (SET NULL). Идемпотентно. */
export class AddDevWebhooks1808000000000 implements MigrationInterface {
  name = 'AddDevWebhooks1808000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_webhook_subscription" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId"   uuid NULL
          REFERENCES "projects"("id") ON DELETE SET NULL,
        "url"         varchar(2000) NOT NULL,
        "secret"      varchar(500) NULL,
        "events"      text[] NOT NULL DEFAULT '{}',
        "isActive"    boolean NOT NULL DEFAULT true,
        "createdById" uuid NULL
          REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_webhook_subscription" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_webhook_delivery" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "subscriptionId" uuid NOT NULL
          REFERENCES "dev_webhook_subscription"("id") ON DELETE CASCADE,
        "event"          varchar(50) NOT NULL,
        "payload"        jsonb NOT NULL,
        "status"         integer NOT NULL DEFAULT 0,
        "error"          text NULL,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_webhook_delivery" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dev_webhook_sub_project"
        ON "dev_webhook_subscription" ("projectId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dev_webhook_delivery_sub"
        ON "dev_webhook_delivery" ("subscriptionId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_webhook_delivery_sub"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dev_webhook_sub_project"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_webhook_delivery"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_webhook_subscription"`);
  }
}
