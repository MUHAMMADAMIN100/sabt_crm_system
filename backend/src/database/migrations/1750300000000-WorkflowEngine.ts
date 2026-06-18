import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Workflow-движок SMM-доски (ТЗ §6): новые поля единицы контента
 * (тип маршрута, ссылки на материалы, флаги join-гейта, дедлайны этапов)
 * + таблицы shoot_sessions и unit_events (журнал). Идемпотентно —
 * дублирует ALTER из WorkflowService.onModuleInit для прод-деплоя.
 */
export class WorkflowEngine1750300000000 implements MigrationInterface {
  name = 'WorkflowEngine1750300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Базовая таблица доски (на чистой БД миграция идёт до onModuleInit).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_cards (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "projectId"   uuid NOT NULL,
        title         varchar NOT NULL,
        description   text,
        "contentType" varchar,
        deadline      date,
        "assigneeId"  uuid,
        stage         varchar NOT NULL DEFAULT 'content_plan',
        position      int NOT NULL DEFAULT 0,
        "createdById" uuid,
        "createdAt"   timestamp NOT NULL DEFAULT NOW(),
        "updatedAt"   timestamp NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_workflow_cards_project ON workflow_cards ("projectId", stage, position)`,
    );
    const cols = [
      `ADD COLUMN IF NOT EXISTS type varchar`,
      `ADD COLUMN IF NOT EXISTS "parentCardId" uuid`,
      `ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'active'`,
      `ADD COLUMN IF NOT EXISTS "needsCover" boolean NOT NULL DEFAULT true`,
      `ADD COLUMN IF NOT EXISTS "needsIntro" boolean NOT NULL DEFAULT true`,
      `ADD COLUMN IF NOT EXISTS "editingDone" boolean NOT NULL DEFAULT false`,
      `ADD COLUMN IF NOT EXISTS "designDone" boolean NOT NULL DEFAULT false`,
      `ADD COLUMN IF NOT EXISTS "rawFootageUrl" text`,
      `ADD COLUMN IF NOT EXISTS "finalCutUrl" text`,
      `ADD COLUMN IF NOT EXISTS "finalAssetUrl" text`,
      `ADD COLUMN IF NOT EXISTS "coverUrl" text`,
      `ADD COLUMN IF NOT EXISTS "introUrl" text`,
      `ADD COLUMN IF NOT EXISTS "publishedUrl" text`,
      `ADD COLUMN IF NOT EXISTS "publishDate" date`,
      `ADD COLUMN IF NOT EXISTS "publishedAt" timestamptz`,
      `ADD COLUMN IF NOT EXISTS "shootDate" date`,
      `ADD COLUMN IF NOT EXISTS "shootTime" varchar`,
      `ADD COLUMN IF NOT EXISTS "shootLocation" varchar`,
      `ADD COLUMN IF NOT EXISTS "shootSessionId" uuid`,
      `ADD COLUMN IF NOT EXISTS "reworkComment" text`,
      `ADD COLUMN IF NOT EXISTS "sentToClientAt" timestamptz`,
      `ADD COLUMN IF NOT EXISTS "clientComment" text`,
      `ADD COLUMN IF NOT EXISTS "stageDeadlines" jsonb`,
    ];
    for (const c of cols) {
      await queryRunner.query(`ALTER TABLE workflow_cards ${c}`);
    }
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS shoot_sessions (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "projectId"   uuid NOT NULL,
        title         varchar,
        date          date,
        time          varchar,
        location      varchar,
        note          text,
        "createdById" uuid,
        "createdAt"   timestamp NOT NULL DEFAULT NOW(),
        "updatedAt"   timestamp NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS unit_events (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "cardId"    uuid NOT NULL,
        action      varchar NOT NULL,
        "fromStage" varchar,
        "toStage"   varchar,
        "actorId"   uuid,
        "actorName" varchar,
        message     text,
        comment     text,
        meta        jsonb,
        "createdAt" timestamp NOT NULL DEFAULT NOW()
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_unit_events_card ON unit_events ("cardId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_settings (
        id          varchar PRIMARY KEY,
        data        jsonb,
        "updatedAt" timestamp NOT NULL DEFAULT NOW()
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS workflow_settings`);
    await queryRunner.query(`DROP TABLE IF EXISTS unit_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS shoot_sessions`);
    const drop = [
      'type', 'parentCardId', 'status', 'needsCover', 'needsIntro', 'editingDone',
      'designDone', 'rawFootageUrl', 'finalCutUrl', 'finalAssetUrl', 'coverUrl',
      'introUrl', 'publishedUrl', 'publishDate', 'publishedAt', 'shootDate',
      'shootTime', 'shootLocation', 'shootSessionId', 'reworkComment',
      'sentToClientAt', 'clientComment', 'stageDeadlines',
    ];
    for (const c of drop) {
      await queryRunner.query(`ALTER TABLE workflow_cards DROP COLUMN IF EXISTS "${c}"`);
    }
  }
}
