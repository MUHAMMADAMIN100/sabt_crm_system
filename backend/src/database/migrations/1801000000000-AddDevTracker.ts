import { MigrationInterface, QueryRunner } from 'typeorm';

/** Доска задач разработки «Dev-tracker» (Jira/Notion-style): канбан с
 *  колонками backlog→done, приоритетами, типами задач и комментариями.
 *
 *  Отдельные таблицы от tasks/comments: production-задачи живут со своим
 *  workflow и скоупами видимости, а это внутренняя доска команды разработки
 *  с канбан-порядком карточек (position) и story points.
 *
 *  Enum'ы — нативные postgres-типы, как принято в проекте (см. AddContentPlan). */
export class AddDevTracker1801000000000 implements MigrationInterface {
  name = 'AddDevTracker1801000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "dev_tasks_status_enum" AS ENUM (
          'backlog', 'todo', 'in_progress', 'in_review', 'testing', 'done'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "dev_tasks_priority_enum" AS ENUM (
          'low', 'medium', 'high', 'critical'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "dev_tasks_tasktype_enum" AS ENUM (
          'feature', 'bug', 'improvement', 'tech_debt'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // Задачи доски
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_tasks" (
        "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title"       varchar NOT NULL,
        "description" text NULL,
        "status"      "dev_tasks_status_enum" NOT NULL DEFAULT 'backlog',
        "priority"    "dev_tasks_priority_enum" NOT NULL DEFAULT 'medium',
        "taskType"    "dev_tasks_tasktype_enum" NOT NULL DEFAULT 'feature',
        "position"    integer NOT NULL DEFAULT 0,
        "storyPoints" integer NOT NULL DEFAULT 0,
        "tags"        text[] NULL,
        "deadline"    TIMESTAMP NULL,
        "completedAt" TIMESTAMP NULL,
        "assigneeId"  uuid NULL,
        "createdById" uuid NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dev_tasks_assignee" FOREIGN KEY ("assigneeId")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_dev_tasks_created_by" FOREIGN KEY ("createdById")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Комментарии к задачам доски
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dev_task_comments" (
        "id"        uuid NOT NULL DEFAULT uuid_generate_v4(),
        "taskId"    uuid NOT NULL,
        "authorId"  uuid NOT NULL,
        "text"      text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dev_task_comments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dev_task_comments_task" FOREIGN KEY ("taskId")
          REFERENCES "dev_tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dev_task_comments_author" FOREIGN KEY ("authorId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Индексы под основные запросы доски: фильтр по колонке и исполнителю.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dev_tasks_status" ON "dev_tasks" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dev_tasks_assignee" ON "dev_tasks" ("assigneeId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dev_task_comments_task" ON "dev_task_comments" ("taskId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_task_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dev_tasks"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dev_tasks_tasktype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dev_tasks_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dev_tasks_status_enum"`);
  }
}
