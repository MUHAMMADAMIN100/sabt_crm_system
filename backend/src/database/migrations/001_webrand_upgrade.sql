-- ============================================================
-- WeBrand CRM — Upgrade Migration
-- Run this in Railway PostgreSQL console BEFORE deploying new code
-- ============================================================

-- 1. Extend user role enum
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'founder';
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'project_manager';
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'smm_specialist';
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'designer';
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'sales_manager';
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'marketer';
ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'targetologist';

-- 2. Extend task status enum
ALTER TYPE "tasks_status_enum" ADD VALUE IF NOT EXISTS 'returned';

-- 3. Add new columns to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "totalCount"   integer       DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "doneCount"    integer       DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "returnReason" varchar       DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "reviewedById" uuid          DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "reviewedAt"   timestamptz   DEFAULT NULL;

-- 4. Add new columns to employees table
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "managerId"       varchar        DEFAULT NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "tasksCompleted"  integer        DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "tasksOverdue"    integer        DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "tasksReturned"   integer        DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "activityScore"   decimal(5,2)   DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "lastActiveAt"    timestamptz    DEFAULT NULL;

-- 5. Extend notification type enum
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'task_returned';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'task_overdue';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'review_needed';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'inactivity_24h';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'deadline_tomorrow';

-- 6. Extend activity_log action enum
ALTER TYPE "activity_logs_action_enum" ADD VALUE IF NOT EXISTS 'TASK_RESULT_SUBMIT';
ALTER TYPE "activity_logs_action_enum" ADD VALUE IF NOT EXISTS 'TASK_REVIEW_APPROVE';
ALTER TYPE "activity_logs_action_enum" ADD VALUE IF NOT EXISTS 'TASK_REVIEW_RETURN';
ALTER TYPE "activity_logs_action_enum" ADD VALUE IF NOT EXISTS 'TASK_PROGRESS_UPDATE';

-- 7. Create task_results table
CREATE TABLE IF NOT EXISTS "task_results" (
  "id"              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"          uuid          NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  "submittedById"   uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "type"            varchar       NOT NULL DEFAULT 'comment',
  "content"         text          NOT NULL,
  "fileName"        varchar       DEFAULT NULL,
  "filePath"        varchar       DEFAULT NULL,
  "createdAt"       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_results_taskId ON task_results("taskId");

-- Done
SELECT 'Migration 001_webrand_upgrade completed successfully' AS result;
