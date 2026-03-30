import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role_enum" AS ENUM ('admin', 'employee');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "employee_status_enum" AS ENUM ('active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "project_status_enum" AS ENUM (
          'planning', 'in_progress', 'completed', 'archived', 'on_hold'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "task_priority_enum" AS ENUM ('low', 'medium', 'high', 'critical');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "task_status_enum" AS ENUM (
          'new', 'in_progress', 'review', 'done', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "notification_type_enum" AS ENUM (
          'new_task', 'task_comment', 'status_change', 'deadline_approaching',
          'new_report', 'project_assigned', 'task_completed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "activity_action_enum" AS ENUM (
          'LOGIN','LOGOUT','REGISTER','PASSWORD_CHANGE','PASSWORD_RESET',
          'TASK_CREATE','TASK_UPDATE','TASK_DELETE','TASK_STATUS','TASK_ASSIGN',
          'PROJECT_CREATE','PROJECT_UPDATE','PROJECT_DELETE','PROJECT_ARCHIVE','PROJECT_RESTORE',
          'MEMBER_ADD','MEMBER_REMOVE',
          'COMMENT_CREATE','COMMENT_UPDATE','COMMENT_DELETE',
          'EMPLOYEE_CREATE','EMPLOYEE_UPDATE','EMPLOYEE_DELETE','EMPLOYEE_SUB_ADMIN',
          'FILE_UPLOAD','FILE_DELETE',
          'REPORT_CREATE','REPORT_UPDATE','REPORT_DELETE',
          'TIMER_START','TIMER_STOP','TIME_LOG','TIME_DELETE',
          'STORY_UPDATE','PROFILE_UPDATE','AVATAR_UPDATE','USER_ACTIVATE','USER_DEACTIVATE'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // ── users ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name"                  VARCHAR NOT NULL,
        "email"                 VARCHAR NOT NULL UNIQUE,
        "password"              VARCHAR NOT NULL,
        "role"                  "user_role_enum" NOT NULL DEFAULT 'employee',
        "isActive"              BOOLEAN NOT NULL DEFAULT true,
        "avatar"                VARCHAR,
        "resetPasswordToken"    VARCHAR,
        "resetPasswordExpires"  TIMESTAMP,
        "createdAt"             TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── employees ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "employees" (
        "id"             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "fullName"       VARCHAR NOT NULL,
        "position"       VARCHAR NOT NULL,
        "department"     VARCHAR NOT NULL DEFAULT 'Общий',
        "email"          VARCHAR NOT NULL UNIQUE,
        "phone"          VARCHAR,
        "telegram"       VARCHAR,
        "telegramChatId" VARCHAR,
        "instagram"      VARCHAR,
        "hireDate"       DATE NOT NULL DEFAULT CURRENT_DATE,
        "status"         "employee_status_enum" NOT NULL DEFAULT 'active',
        "avatar"         VARCHAR,
        "bio"            TEXT,
        "salary"         INTEGER,
        "isSubAdmin"     BOOLEAN NOT NULL DEFAULT false,
        "userId"         UUID UNIQUE REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── projects ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "projects" (
        "id"          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name"        VARCHAR NOT NULL,
        "description" TEXT,
        "managerId"   UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "startDate"   DATE,
        "endDate"     DATE,
        "status"      "project_status_enum" NOT NULL DEFAULT 'planning',
        "color"       VARCHAR,
        "budget"      NUMERIC,
        "progress"    INTEGER NOT NULL DEFAULT 0,
        "projectType" VARCHAR,
        "smmData"     JSONB,
        "clientInfo"  JSONB,
        "isArchived"  BOOLEAN NOT NULL DEFAULT false,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── project_members (join table) ─────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "project_members" (
        "projectsId" UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "usersId"    UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        PRIMARY KEY ("projectsId", "usersId")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_project_members_project" ON "project_members" ("projectsId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_project_members_user" ON "project_members" ("usersId")`);

    // ── tasks ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tasks" (
        "id"             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "title"          VARCHAR NOT NULL,
        "description"    TEXT,
        "projectId"      UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "assigneeId"     UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "createdById"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "priority"       "task_priority_enum" NOT NULL DEFAULT 'medium',
        "status"         "task_status_enum" NOT NULL DEFAULT 'new',
        "deadline"       TIMESTAMP,
        "estimatedHours" INTEGER NOT NULL DEFAULT 0,
        "loggedHours"    NUMERIC NOT NULL DEFAULT 0,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_projectId" ON "tasks" ("projectId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_assigneeId" ON "tasks" ("assigneeId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_status" ON "tasks" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_deadline" ON "tasks" ("deadline")`);

    // ── comments ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "comments" (
        "id"        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "message"   TEXT NOT NULL,
        "taskId"    UUID NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
        "authorId"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── time_logs ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "time_logs" (
        "id"             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "taskId"         UUID NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
        "employeeId"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "timeSpent"      NUMERIC(10,2) NOT NULL DEFAULT 0,
        "date"           DATE NOT NULL,
        "description"    VARCHAR,
        "timerStartedAt" TIMESTAMP,
        "isRunning"      BOOLEAN NOT NULL DEFAULT false,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_time_logs_taskId" ON "time_logs" ("taskId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_time_logs_employeeId" ON "time_logs" ("employeeId")`);

    // ── file_attachments ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "file_attachments" (
        "id"            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "originalName"  VARCHAR NOT NULL,
        "filename"      VARCHAR NOT NULL,
        "path"          VARCHAR NOT NULL,
        "mimetype"      VARCHAR NOT NULL,
        "size"          INTEGER NOT NULL,
        "uploadedById"  UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "projectId"     UUID REFERENCES "projects"("id") ON DELETE CASCADE,
        "taskId"        UUID REFERENCES "tasks"("id") ON DELETE CASCADE,
        "createdAt"     TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── notifications ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id"        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId"    UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type"      "notification_type_enum" NOT NULL,
        "title"     VARCHAR NOT NULL,
        "message"   TEXT NOT NULL,
        "isRead"    BOOLEAN NOT NULL DEFAULT false,
        "link"      VARCHAR,
        "data"      JSONB,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_userId" ON "notifications" ("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_isRead" ON "notifications" ("isRead")`);

    // ── work_sessions ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "work_sessions" (
        "id"            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId"        UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "loginAt"       TIMESTAMPTZ NOT NULL,
        "logoutAt"      TIMESTAMPTZ,
        "durationHours" NUMERIC(10,2) NOT NULL DEFAULT 0,
        "date"          DATE NOT NULL
      )
    `);

    // ── daily_reports ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_reports" (
        "id"          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "employeeId"  UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "date"        DATE NOT NULL,
        "timeSpent"   NUMERIC(10,2) NOT NULL DEFAULT 0,
        "projectId"   UUID REFERENCES "projects"("id") ON DELETE SET NULL,
        "taskId"      UUID REFERENCES "tasks"("id") ON DELETE SET NULL,
        "description" TEXT NOT NULL,
        "comments"    TEXT,
        "files"       JSONB,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── activity_logs ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "activity_logs" (
        "id"         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId"     UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "userName"   VARCHAR,
        "action"     "activity_action_enum" NOT NULL,
        "entity"     VARCHAR,
        "entityId"   VARCHAR,
        "entityName" VARCHAR,
        "details"    JSONB,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_activity_logs_userId" ON "activity_logs" ("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_activity_logs_action" ON "activity_logs" ("action")`);

    // ── story_logs ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "story_logs" (
        "id"           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "employeeId"   UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "projectId"    UUID NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "date"         DATE NOT NULL,
        "storiesCount" INTEGER NOT NULL DEFAULT 0,
        "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE ("employeeId", "projectId", "date")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "story_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "work_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "file_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "time_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "projects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "activity_action_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "task_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "task_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "project_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "employee_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
