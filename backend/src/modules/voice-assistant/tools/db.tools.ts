import { ToolContext, ToolDef, ToolError } from './types';

/**
 * Чтение базы напрямую — только основателю и только на чтение (решение
 * владельца 09.11.2026: «полный доступ к базе» для вопросов, менять данные
 * ИИ может лишь через действия сайта).
 *
 * Защита в несколько слоёв:
 *  • только один SELECT / WITH, без «;» внутри;
 *  • транзакция READ ONLY + statement_timeout — запись невозможна на уровне БД;
 *  • запрет служебных функций (файлы, сон, настройки, dblink);
 *  • пароли, токены, секреты: запрещены в тексте запроса и вырезаются из
 *    результата; таблицы сессий и журнала безопасности недоступны;
 *  • не больше 200 строк.
 */

export type DbRunner = (sql: string) => Promise<any[]>;

const SENSITIVE_COLUMN = /password|token|secret|fcm|two_?factor|reset_?password|hash|api_?key|credential|cookie|encrypted|cipher|refresh/i;
const BLOCKED_TABLES = /\b(refresh_tokens|security_events|typeorm_metadata|migrations|query-result-cache)\b/i;
const BLOCKED_FUNCS = /\b(pg_read\w*|pg_ls\w*|pg_stat_file|lo_\w+|dblink\w*|pg_sleep\w*|set_config|current_setting|pg_terminate\w*|pg_cancel\w*|pg_reload_conf|pg_rotate\w*|copy|txid_\w+|pg_advisory\w*)\s*\(/i;
const WRITE_WORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|cluster|reindex|refresh|comment|lock|listen|notify|prepare|execute|call|do|merge|set|reset|discard|security|owner)\b/i;

export function checkReadOnlySql(sqlRaw: string): string {
  let sql = String(sqlRaw || '').trim().replace(/;+\s*$/, '');
  if (!sql) throw new ToolError('Пустой запрос.');
  if (sql.length > 6000) throw new ToolError('Запрос слишком длинный.');
  // Комментарии убираем — за ними прячут вторую команду.
  sql = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  if (!/^(select|with)\b/i.test(sql)) throw new ToolError('Разрешены только запросы на чтение (SELECT / WITH).');
  if (sql.includes(';')) throw new ToolError('Только один запрос, без «;».');
  // Строковые литералы не проверяем на слова-команды: «'Создать лид'» — это данные.
  const code = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (WRITE_WORDS.test(code.replace(/\b(created|updated|deleted|setting\w*|reset\w*|comment\w*|lock\w*)\b/gi, ''))) {
    throw new ToolError('В запросе есть команды изменения данных — разрешено только чтение.');
  }
  if (BLOCKED_FUNCS.test(code)) throw new ToolError('Служебные функции базы недоступны.');
  if (BLOCKED_TABLES.test(code)) throw new ToolError('Эта таблица недоступна.');
  if (SENSITIVE_COLUMN.test(code)) throw new ToolError('Пароли, токены и секреты недоступны.');
  return sql;
}

/** Вырезаем чувствительные колонки, даже если они пришли через «*». */
export function scrubRows(rows: any[]): any[] {
  return rows.map((r) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(r || {})) {
      if (SENSITIVE_COLUMN.test(k)) continue;
      out[k] = typeof v === 'string' && v.length > 400 ? `${v.slice(0, 400)}…` : v;
    }
    return out;
  });
}

const founderOnly = (u: any) => u.role === 'founder' || u.secondaryRole === 'founder';

function runner(ctx: ToolContext): DbRunner {
  const db = (ctx as any).db as DbRunner | undefined;
  if (!db) throw new ToolError('Чтение базы недоступно.');
  return db;
}

let schemaCache: { at: number; tables: Array<{ table: string; columns: string[] }> } | null = null;

export const dbSchema: ToolDef<{ search?: string }> = {
  name: 'db_schema',
  kind: 'read',
  description:
    'Структура базы CRM: таблицы и колонки (типы). Вызывай перед db_query, чтобы знать точные имена. '
    + 'search — часть имени таблицы или колонки («fine», «task», «client», «shift»).',
  parameters: {
    type: 'object',
    properties: { search: { type: 'string' } },
    additionalProperties: false,
  },
  available: founderOnly,
  async run(args, ctx) {
    if (!schemaCache || Date.now() - schemaCache.at > 10 * 60_000) {
      const rows = await runner(ctx)(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
      );
      const map = new Map<string, string[]>();
      for (const r of rows) {
        if (BLOCKED_TABLES.test(r.table_name) || SENSITIVE_COLUMN.test(r.column_name)) continue;
        const list = map.get(r.table_name) || [];
        list.push(`${r.column_name}:${String(r.data_type).replace('timestamp with time zone', 'timestamptz').replace('character varying', 'text')}`);
        map.set(r.table_name, list);
      }
      schemaCache = { at: Date.now(), tables: [...map.entries()].map(([table, columns]) => ({ table, columns })) };
    }
    const q = String(args.search || '').toLowerCase().trim();
    const tables = q
      ? schemaCache.tables.filter((t) => t.table.includes(q) || t.columns.some((c) => c.toLowerCase().includes(q)))
      : schemaCache.tables.map((t) => ({ table: t.table, columns: [`${t.columns.length} колонок — уточните search`] }));
    return {
      note: 'Колонки в "кавычках" (camelCase): t."assigneeId". Время в timestamptz (UTC); Душанбе = UTC+5: AT TIME ZONE \'Asia/Dushanbe\'. Деньги — сомони. '
        + 'СВЯЗИ: люди — users (id, name, role); tasks."assigneeId"/"createdById" → users.id; task_assignees."userId" → users.id; '
        + 'employees."userId" → users.id (employees.id — НЕ то же, что users.id); projects."managerId" → users.id; tasks."projectId" → projects.id; '
        + 'client_leads."ownerId" → users.id; work_shifts."employeeId" → users.id; story_logs."employeeId" → users.id; '
        + 'finance_employees."userId" → users.id (зарплата: JSON по месяцам «ГГГГ-ММ»: "fineEntries", "bonusEntries", "advances"…); '
        + 'finance_transactions: учитывай COALESCE(status,\'completed\') <> \'cancelled\'. Статусы задач: new (Новая), in_progress (В работе), done, cancelled; «в работе» = in_progress, «открытые» = new + in_progress.',
      tables: tables.slice(0, 40),
    };
  },
};

export const dbQuery: ToolDef<{ sql: string; purpose?: string }> = {
  name: 'db_query',
  kind: 'read',
  description:
    'Прочитать данные прямо из базы (только SELECT, до 200 строк) — для вопросов основателя, на которые нет готового инструмента: '
    + '«сколько штрафов в октябре и у кого», «кто чаще опаздывает», «сколько лидов пришло из Instagram за месяц». '
    + 'Сначала db_schema. Изменять данные этим нельзя.',
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'Один запрос SELECT/WITH на PostgreSQL.' },
      purpose: { type: 'string', description: 'Что хотим узнать — для журнала.' },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  available: founderOnly,
  async run(args, ctx) {
    const sql = checkReadOnlySql(args.sql);
    let rows: any[];
    try {
      rows = await runner(ctx)(`SELECT * FROM (${sql}) AS voice_q LIMIT 200`);
    } catch (e: any) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(`Ошибка запроса: ${String(e?.message || e).slice(0, 300)}`);
    }
    return { rowCount: rows.length, rows: scrubRows(rows) };
  },
};

export const DB_TOOLS: ToolDef[] = [dbSchema, dbQuery];
