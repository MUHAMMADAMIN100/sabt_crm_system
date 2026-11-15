/**
 * Лента событий лида (15.11.2026, таблица lead_events, миграция 1834).
 *
 * Одна функция записи для всех модулей: ClientsService (создание, этап,
 * владелец, встреча, следующий шаг), SalesService (звонок, письмо, итог
 * встречи, комментарий, передача в работу), ProjectsService (проект создан
 * по лиду). Запись — сырой SQL, без сущности: таблица — журнал.
 *
 * Сбой записи события не должен ломать основное действие: ошибка
 * логируется вызывающим (функция бросает — оборачивайте в catch, если
 * событие второстепенно).
 */

export type LeadEventKind =
  | 'created'          // data: { source?, direction?, via?: 'form'|'direct'|'voice'|'site' }
  | 'stage'            // data: { from, to, lostReason?, comment? }
  | 'owner'            // data: { fromId, fromName, toId, toName }
  | 'call'             // data: { result, outcome?, comment?, next? }
  | 'email'            // data: { comment? }
  | 'meeting_set'      // data: { at }
  | 'meeting_done'     // data: { at, comment? }
  | 'meeting_missed'   // data: { at, comment? }
  | 'next_step'        // data: { text, at }
  | 'comment'          // data: { text }
  | 'hold'             // data: { onHold }
  | 'handoff'          // data: HandoffData
  | 'project_linked';  // data: { projectId, projectName }

export interface LeadEventInput {
  leadId: string;
  userId?: string | null;
  kind: LeadEventKind;
  data?: Record<string, any> | null;
}

/** Любой исполнитель SQL: EntityManager, DataSource, QueryRunner. */
export interface SqlRunner {
  query(sql: string, params?: any[]): Promise<any>;
}

export async function recordLeadEvent(m: SqlRunner, e: LeadEventInput): Promise<void> {
  await m.query(
    `INSERT INTO lead_events (lead_id, user_id, kind, data) VALUES ($1, $2, $3, $4::jsonb)`,
    [e.leadId, e.userId ?? null, e.kind, e.data == null ? null : JSON.stringify(e.data)],
  );
}
