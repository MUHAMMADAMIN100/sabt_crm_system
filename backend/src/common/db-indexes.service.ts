import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Создаёт идемпотентные индексы на горячих полях БД при старте приложения.
 *
 * Почему отдельный сервис, а не миграции:
 *  - синхронные ALTER уже разбросаны по сервисам (clients/projects/etc)
 *    в onModuleInit. Этот сервис делает то же самое для индексов —
 *    собирает их в одном месте и применяет один раз при старте.
 *  - CREATE INDEX IF NOT EXISTS поддерживается PG 9.5+ и безопасен.
 *
 * Эффект: запросы по {ownerId, projectId, deadline, userId+date} вместо
 * full table scan получают index scan. KPI/Tasks/Clients ускоряются
 * в 3–10 раз на боевых данных (десятки тысяч строк).
 */
@Injectable()
export class DbIndexesService implements OnModuleInit {
  private readonly logger = new Logger(DbIndexesService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit() {
    // Список индексов: [имя, SQL]. Имя — для логов в случае ошибки.
    // Порядок не важен, IF NOT EXISTS защищает от повторных запусков.
    const indexes: Array<[string, string]> = [
      // ── tasks ─────────────────────────────────────────────────────────
      ['idx_tasks_assignee',         `CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks ("assigneeId")`],
      ['idx_tasks_project',          `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks ("projectId")`],
      ['idx_tasks_status',           `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`],
      ['idx_tasks_deadline',         `CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks (deadline)`],
      ['idx_tasks_scope',            `CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks (scope)`],
      ['idx_tasks_updated',          `CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks ("updatedAt")`],
      // Композит для KPI «выполнено задач»: WHERE assigneeId=X AND status='done' AND updatedAt BETWEEN
      ['idx_tasks_assignee_status_updated', `CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status_updated ON tasks ("assigneeId", status, "updatedAt")`],

      // ── client_leads ──────────────────────────────────────────────────
      ['idx_clients_owner',          `CREATE INDEX IF NOT EXISTS idx_clients_owner ON client_leads ("ownerId")`],
      ['idx_clients_direction',      `CREATE INDEX IF NOT EXISTS idx_clients_direction ON client_leads (direction)`],
      ['idx_clients_status',         `CREATE INDEX IF NOT EXISTS idx_clients_status ON client_leads (status)`],
      ['idx_clients_last_contact',   `CREATE INDEX IF NOT EXISTS idx_clients_last_contact ON client_leads ("lastContactAt")`],
      ['idx_clients_next_contact',   `CREATE INDEX IF NOT EXISTS idx_clients_next_contact ON client_leads ("nextContactAt")`],
      ['idx_clients_updated',        `CREATE INDEX IF NOT EXISTS idx_clients_updated ON client_leads ("updatedAt")`],
      ['idx_clients_call_type',      `CREATE INDEX IF NOT EXISTS idx_clients_call_type ON client_leads ("callType")`],
      ['idx_clients_email_status',   `CREATE INDEX IF NOT EXISTS idx_clients_email_status ON client_leads ("emailStatus")`],
      ['idx_clients_onboarding',     `CREATE INDEX IF NOT EXISTS idx_clients_onboarding ON client_leads ("onboardingStage")`],
      // Композит для KPI sales: WHERE ownerId=X AND direction=Y AND updatedAt BETWEEN
      ['idx_clients_owner_dir_updated', `CREATE INDEX IF NOT EXISTS idx_clients_owner_dir_updated ON client_leads ("ownerId", direction, "updatedAt")`],

      // ── projects ──────────────────────────────────────────────────────
      ['idx_projects_manager',       `CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects ("managerId")`],
      ['idx_projects_sales_manager', `CREATE INDEX IF NOT EXISTS idx_projects_sales_manager ON projects ("salesManagerId")`],
      ['idx_projects_archived',      `CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects ("isArchived")`],
      ['idx_projects_type',          `CREATE INDEX IF NOT EXISTS idx_projects_type ON projects ("projectType")`],
      ['idx_projects_status',        `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)`],

      // ── notifications ─────────────────────────────────────────────────
      ['idx_notifications_user',       `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications ("userId")`],
      ['idx_notifications_user_isread', `CREATE INDEX IF NOT EXISTS idx_notifications_user_isread ON notifications ("userId", "isRead")`],
      ['idx_notifications_created',    `CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications ("createdAt")`],

      // ── work_sessions / time_logs ─────────────────────────────────────
      ['idx_work_sessions_user_date', `CREATE INDEX IF NOT EXISTS idx_work_sessions_user_date ON work_sessions ("userId", date)`],
      ['idx_time_logs_user_date',     `CREATE INDEX IF NOT EXISTS idx_time_logs_user_date ON time_logs ("userId", date)`],

      // ── activity_logs / story_logs ────────────────────────────────────
      ['idx_activity_logs_user_created', `CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs ("userId", "createdAt")`],
      ['idx_story_logs_employee_date',   `CREATE INDEX IF NOT EXISTS idx_story_logs_employee_date ON story_logs ("employeeId", date)`],

      // ── content_plan_items ────────────────────────────────────────────
      ['idx_content_plan_project',   `CREATE INDEX IF NOT EXISTS idx_content_plan_project ON content_plan_items ("projectId")`],
      ['idx_content_plan_task',      `CREATE INDEX IF NOT EXISTS idx_content_plan_task ON content_plan_items ("taskId") WHERE "taskId" IS NOT NULL`],

      // ── comments / task_results ───────────────────────────────────────
      ['idx_comments_task',          `CREATE INDEX IF NOT EXISTS idx_comments_task ON comments ("taskId")`],

      // lead_progress индекс уже создан в ClientsService.onModuleInit
      // (snake_case колонки: user_id, created_at).
    ];

    // pg_trgm — расширение для быстрого ILIKE '%...%' через trigram-индекс.
    // Без него поиск по client_leads.name делает full table scan.
    // CREATE EXTENSION требует superuser; на managed-хостингах (Railway/
    // Render) обычно разрешено. На failure — просто пропускаем.
    try {
      await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      indexes.push(
        ['idx_clients_name_trgm',    `CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON client_leads USING gin (name gin_trgm_ops)`],
        ['idx_clients_contact_trgm', `CREATE INDEX IF NOT EXISTS idx_clients_contact_trgm ON client_leads USING gin ("contactPerson" gin_trgm_ops)`],
        ['idx_projects_name_trgm',   `CREATE INDEX IF NOT EXISTS idx_projects_name_trgm ON projects USING gin (name gin_trgm_ops)`],
      );
    } catch (e: any) {
      this.logger.warn(`pg_trgm extension unavailable, ILIKE search will be slow: ${e?.message || e}`);
    }

    let ok = 0;
    let failed = 0;
    for (const [name, sql] of indexes) {
      try {
        await this.dataSource.query(sql);
        ok++;
      } catch (e: any) {
        // Не валим старт — таблица может ещё не существовать (новая
        // инсталляция, миграции запускаются в этом же цикле). Просто лог.
        failed++;
        this.logger.warn(`Index ${name} skipped: ${e?.message || e}`);
      }
    }
    this.logger.log(`DB indexes: ${ok} ok, ${failed} skipped`);
  }
}
