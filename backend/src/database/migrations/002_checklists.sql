-- ============================================================
-- WeBrand CRM — Migration 002: Task Checklists
-- Run this in Railway PostgreSQL console BEFORE deploying new code
-- ============================================================

CREATE TABLE IF NOT EXISTS "task_checklist_items" (
  "id"          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"      uuid          NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  "text"        varchar       NOT NULL,
  "isDone"      boolean       NOT NULL DEFAULT false,
  "doneById"    uuid          DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  "doneAt"      timestamptz   DEFAULT NULL,
  "createdAt"   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_taskId ON task_checklist_items("taskId");

SELECT 'Migration 002_checklists completed successfully' AS result;
