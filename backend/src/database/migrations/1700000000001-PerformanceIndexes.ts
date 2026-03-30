import { MigrationInterface, QueryRunner } from 'typeorm';

export class PerformanceIndexes1700000000001 implements MigrationInterface {
  name = 'PerformanceIndexes1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable trigram extension (needed for gin_trgm_ops indexes)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // ── Tasks ─────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_project_status"
       ON "tasks" ("projectId", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_assignee_status"
       ON "tasks" ("assigneeId", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_deadline_status"
       ON "tasks" ("deadline", "status")
       WHERE deadline IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_title_trgm"
       ON "tasks" USING gin (title gin_trgm_ops)`
    );

    // ── Projects ──────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_projects_archived_status"
       ON "projects" ("isArchived", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_projects_managerId"
       ON "projects" ("managerId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_projects_name_trgm"
       ON "projects" USING gin (name gin_trgm_ops)`
    );

    // ── Notifications ─────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notifications_user_unread"
       ON "notifications" ("userId", "isRead", "createdAt" DESC)
       WHERE "isRead" = false`
    );

    // ── Time logs ─────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_time_logs_employee_date"
       ON "time_logs" ("employeeId", "date" DESC)`
    );

    // ── Work sessions ─────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_sessions_user_date"
       ON "work_sessions" ("userId", "date" DESC)`
    );

    // ── Activity logs ─────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_activity_logs_created"
       ON "activity_logs" ("createdAt" DESC)`
    );

    // ── Daily reports ─────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_daily_reports_employee_date"
       ON "daily_reports" ("employeeId", "date" DESC)`
    );

    // ── Employees ─────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employees_status_dept"
       ON "employees" ("status", "department")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_employees_userId"
       ON "employees" ("userId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_employees_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_employees_status_dept"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_daily_reports_employee_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_activity_logs_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_work_sessions_user_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_time_logs_employee_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_user_unread"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_projects_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_projects_managerId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_projects_archived_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_title_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_deadline_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_assignee_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_project_status"`);
  }
}
