import { ToolContext, ToolDef, ToolError } from './types';

/**
 * Чтение базы напрямую — только основателю и только на чтение (решение
 * владельца 09.11.2026: «полный доступ к базе» для вопросов, менять данные
 * ИИ может лишь через действия сайта).
 *
 * Защита в несколько слоёв:
 *  • запрос видит только схему voice_ro (15.11.2026): по представлению на
 *    каждую нужную ему таблицу, БЕЗ колонок с паролями, токенами и
 *    секретами. Раньше `SELECT to_jsonb(u) FROM users u` отдавал хэши
 *    паролей и секреты 2FA — проверка текста такое не ловит, а
 *    представление ловит всегда. Представления создаются в той же
 *    транзакции, что и запрос, и исчезают с её ROLLBACK: постоянные
 *    представления держали бы колонки таблиц, и миграции (ALTER COLUMN
 *    TYPE, DROP COLUMN) при выкладке падали бы;
 *  • только один SELECT / WITH, без «;» внутри;
 *  • транзакция READ ONLY + statement_timeout — запись невозможна на уровне БД;
 *  • текст разбираем как PostgreSQL (строки, "идентификаторы", комментарии)
 *    и запрещаем служебные функции (файлы, сон, настройки, dblink, pg_*),
 *    обращения к другим схемам, $$-строки, E'…' и U&'…';
 *  • пароли, токены, секреты: запрещены в тексте запроса и вырезаются из
 *    результата (в том числе внутри JSON); таблицы сессий и журнала
 *    безопасности недоступны;
 *  • не больше 200 строк.
 */

/** prelude — доверенные команды (создание voice_ro) до перевода транзакции
 *  в READ ONLY; sql — запрос, который выполняется уже только на чтение. */
export type DbRunner = (sql: string, prelude?: string[]) => Promise<any[]>;

/** Представления voice_ro создать не удалось (нет прав и т.п.). */
export class ViewsUnavailable extends Error {}

// client_?access — доступы к аккаунтам клиентов в projects (15.11.2026).
const SENSITIVE_COLUMN = /password|token|secret|fcm|two_?factor|reset_?password|hash|api_?key|credential|cookie|encrypted|cipher|refresh|client_?access/i;
// direct_settings — маркеры Instagram (15.11.2026).
const BLOCKED_TABLES = /\b(refresh_tokens|security_events|typeorm_metadata|migrations|query-result-cache|direct_settings)\b/i;
// \w+_to_xml, ts_stat, ts_rewrite, crosstab, connectby — выполняют SQL из
// строки (её содержимое проверка не видит), поэтому запрещены (15.11.2026).
const BLOCKED_FUNCS = /\b(pg_read\w*|pg_ls\w*|pg_stat_file|lo_\w+|dblink\w*|pg_sleep\w*|set_config|current_setting|pg_terminate\w*|pg_cancel\w*|pg_reload_conf|pg_rotate\w*|copy|txid_\w+|pg_advisory\w*|\w+_to_xml\w*|ts_stat|ts_rewrite|crosstab\w*|connectby)\s*\(/i;
const WRITE_WORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|cluster|reindex|refresh|comment|lock|listen|notify|prepare|execute|call|do|merge|set|reset|discard|security|owner)\b/i;

/** Схема с безопасными представлениями — единственное, что видит db_query. */
export const VOICE_RO_SCHEMA = 'voice_ro';
/** Системные схемы: обращаться к ним по имени нельзя. */
// + служебные схемы Supabase (auth.users там — с хешами паролей): запрещены
// сразу, даже если список схем из pg_namespace не прочитался (15.11.2026).
const SYSTEM_SCHEMAS = [
  'public', 'pg_catalog', 'information_schema', 'pg_toast', 'pg_temp',
  'auth', 'storage', 'extensions', 'realtime', 'vault', 'graphql', 'graphql_public',
  'supabase_functions', 'supabase_migrations', 'net', 'pgsodium', 'pgsodium_masks', 'cron',
];

/** Схемы базы (pg_namespace) — для запрета «схема.таблица»; пополняется при чтении структуры. */
const knownSchemas = new Set<string>(SYSTEM_SCHEMAS);

export function rememberSchemas(schemas: string[]): void {
  for (const s of schemas) {
    const name = String(s || '').toLowerCase();
    if (name && name !== VOICE_RO_SCHEMA) knownSchemas.add(name);
  }
}

const quoteIdent = (name: string): string => `"${String(name).replace(/"/g, '""')}"`;

type ColumnRow = { table_name: string; column_name: string; data_type?: string };

/** Таблица → открытые колонки: без закрытых таблиц и колонок с секретами. */
export function safeColumns(rows: ColumnRow[]): Map<string, ColumnRow[]> {
  const tables = new Map<string, ColumnRow[]>();
  for (const r of rows) {
    const table = String(r.table_name);
    if (BLOCKED_TABLES.test(table) || SENSITIVE_COLUMN.test(table)) continue;
    const list = tables.get(table) || [];
    if (!SENSITIVE_COLUMN.test(String(r.column_name))) list.push(r);
    tables.set(table, list);
  }
  for (const [table, list] of tables) if (!list.length) tables.delete(table);
  return tables;
}

/**
 * Команды создания voice_ro — в начале транзакции запроса, до READ ONLY.
 * По представлению на таблицу public (только открытые колонки).
 * rows — information_schema.columns схемы public; only — какие таблицы
 * нужны запросу (нет — все). DROP IF EXISTS — на случай, если схему
 * когда-то создали вручную: в транзакции её заменит наша.
 */
export function voiceRoDdl(rows: ColumnRow[], only?: Iterable<string>): string[] {
  const want = only ? new Set([...only].map((t) => String(t))) : null;
  const out = [`DROP SCHEMA IF EXISTS ${VOICE_RO_SCHEMA} CASCADE`, `CREATE SCHEMA ${VOICE_RO_SCHEMA}`];
  for (const [table, columns] of safeColumns(rows)) {
    if (want && !want.has(table)) continue;
    out.push(`CREATE VIEW ${VOICE_RO_SCHEMA}.${quoteIdent(table)} AS SELECT ${columns.map((c) => quoteIdent(c.column_name)).join(', ')} FROM public.${quoteIdent(table)}`);
  }
  return out;
}

/** Таблицы, имена которых встречаются в тексте запроса (без строк и комментариев). */
export function mentionedTables(code: string, tables: Iterable<string>): string[] {
  const words = new Set((String(code).toLowerCase().match(/[a-z_][\w$]*/g) || []));
  return [...tables].filter((t) => words.has(t.toLowerCase()));
}

/**
 * Разбор текста как у PostgreSQL. run — запрос без комментариев (его и
 * выполняем); code — для проверок: строки заменены на '', с "идентификаторов"
 * сняты кавычки ("pg_sleep" — та же функция pg_sleep), комментарии убраны.
 * Порядок важен: сначала строки, потом комментарии — иначе '--' внутри
 * строки съедал бы остаток запроса.
 */
function lexSql(sql: string): { run: string; code: string } {
  let run = '';
  let code = '';
  let afterSemicolon = false;
  const n = sql.length;
  let i = 0;
  const token = (raw: string, forCode: string) => {
    if (afterSemicolon && raw.trim()) throw new ToolError('Только один запрос, без «;».');
    run += raw;
    code += forCode;
  };
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      // E'…' понимает \' как кавычку, U&'…' — свои escape: проверка их не
      // разберёт, поэтому такие строки не принимаем совсем.
      if (/(^|[^\w$])[eE]$/.test(run)) throw new ToolError('Строки вида E\'…\' не поддерживаются — используйте обычные \'…\'.');
      if (/[uU]&$/.test(run)) throw new ToolError('Экранирование U&\'…\' не поддерживается.');
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new ToolError('Незакрытая строка в запросе.');
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      token(sql.slice(i, j + 1), "''");
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      if (/[uU]&$/.test(run)) throw new ToolError('Экранирование U&"…" не поддерживается.');
      let j = i + 1;
      let name = '';
      for (;;) {
        if (j >= n) throw new ToolError('Незакрытые кавычки в запросе.');
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { name += '"'; j += 2; continue; }
          break;
        }
        name += sql[j];
        j++;
      }
      token(sql.slice(i, j + 1), name);
      i = j + 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      run += ' ';
      code += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      // Блочные комментарии в PostgreSQL вкладываются друг в друга.
      let depth = 1;
      i += 2;
      while (depth > 0) {
        if (i >= n) throw new ToolError('Незакрытый комментарий в запросе.');
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; } else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; } else i++;
      }
      run += ' ';
      code += ' ';
      continue;
    }
    if (ch === '$') throw new ToolError('Знак $ ($$-строки, параметры) в запросе не поддерживается.');
    if (ch === ';') {
      afterSemicolon = true;
      i++;
      continue;
    }
    token(ch, ch);
    i++;
  }
  return { run: run.trim(), code: code.trim() };
}

export function checkReadOnlySql(sqlRaw: string): string {
  return analyzeSql(sqlRaw).run;
}

/** Все проверки запроса; run — что выполнять, code — текст для проверок. */
export function analyzeSql(sqlRaw: string): { run: string; code: string } {
  const raw = String(sqlRaw || '').trim();
  if (!raw) throw new ToolError('Пустой запрос.');
  if (raw.length > 6000) throw new ToolError('Запрос слишком длинный.');
  const { run, code } = lexSql(raw);
  if (!code) throw new ToolError('Пустой запрос.');
  if (!/^(select|with)\b/i.test(code)) throw new ToolError('Разрешены только запросы на чтение (SELECT / WITH).');
  // Строковые литералы не проверяем на слова-команды: «'Создать лид'» — это данные.
  if (WRITE_WORDS.test(code.replace(/\b(created|updated|deleted|setting\w*|reset\w*|comment\w*|lock\w*)\b/gi, ''))) {
    throw new ToolError('В запросе есть команды изменения данных — разрешено только чтение.');
  }
  if (BLOCKED_FUNCS.test(code)) throw new ToolError('Служебные функции базы недоступны.');
  // Служебные таблицы и функции pg_* (кроме pg_typeof) — не для вопросов о CRM.
  if (/\bpg_(?!typeof\b)\w+/i.test(code)) throw new ToolError('Служебные таблицы и функции базы (pg_…) недоступны.');
  if (BLOCKED_TABLES.test(code)) throw new ToolError('Эта таблица недоступна.');
  if (SENSITIVE_COLUMN.test(code)) throw new ToolError('Пароли, токены и секреты недоступны.');
  // «схема.таблица» — только voice_ro: public.users обошёл бы представления.
  // Просмотр назад, а не захват символа: иначе в «db.public.users» вторая
  // часть не проверялась бы.
  const qualified = /(?<![\w$])([a-z_][\w$]*)\s*\.(?!\d)/gi;
  for (let m = qualified.exec(code); m; m = qualified.exec(code)) {
    const name = m[1].toLowerCase();
    if (name === VOICE_RO_SCHEMA) continue;
    if (knownSchemas.has(name) || name.startsWith('pg_')) {
      throw new ToolError(`Схема «${name}» недоступна — пишите имена таблиц без схемы (users, tasks…).`);
    }
  }
  return { run, code };
}

const MAX_SCRUB_DEPTH = 8;

/** Значение без закрытых полей: вложенные объекты, массивы и JSON-строки тоже. */
function scrubValue(v: any, depth: number): any {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v;
  if (Buffer.isBuffer(v)) return `[двоичные данные, ${v.length} байт]`;
  if (Array.isArray(v)) return depth > MAX_SCRUB_DEPTH ? '…' : v.map((x) => scrubValue(x, depth + 1));
  if (typeof v === 'object') {
    if (depth > MAX_SCRUB_DEPTH) return '…';
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) {
      if (SENSITIVE_COLUMN.test(k)) continue;
      out[k] = scrubValue(x, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string') {
    // Хэш bcrypt узнаём и без имени колонки.
    if (/^\$2[aby]\$\d\d\$/.test(v)) return '[скрыто]';
    let s = v;
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        s = JSON.stringify(scrubValue(JSON.parse(t), depth + 1));
      } catch {
        /* не JSON — оставляем как есть */
      }
    }
    return s.length > 400 ? `${s.slice(0, 400)}…` : s;
  }
  return v;
}

/** Вырезаем чувствительные колонки, даже если они пришли через «*» или
 *  внутри to_jsonb(...) / JSON-строки (15.11.2026). */
export function scrubRows(rows: any[]): any[] {
  return rows.map((r) => {
    const out = scrubValue(r || {}, 0);
    return out && typeof out === 'object' && !Array.isArray(out) ? out : { value: out };
  });
}

const founderOnly = (u: any) => u.role === 'founder' || u.secondaryRole === 'founder';

function runner(ctx: ToolContext): DbRunner {
  const db = (ctx as any).db as DbRunner | undefined;
  if (!db) throw new ToolError('Чтение базы недоступно.');
  return db;
}

/** Колонки таблиц public (information_schema) — кэш на 10 минут. */
let columnsCache: { at: number; rows: ColumnRow[] } | null = null;

async function publicColumns(db: DbRunner): Promise<ColumnRow[]> {
  if (!columnsCache || Date.now() - columnsCache.at > 10 * 60_000) {
    const rows = await db(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const schemas = await db('SELECT nspname FROM pg_namespace').catch(() => [] as any[]);
    rememberSchemas(schemas.map((r: any) => r.nspname));
    columnsCache = { at: Date.now(), rows };
  }
  return columnsCache.rows;
}

const shortType = (t: unknown) => String(t)
  .replace('timestamp with time zone', 'timestamptz').replace('timestamp without time zone', 'timestamp').replace('character varying', 'text');

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
    // Ровно те таблицы и колонки, что будут в представлениях voice_ro.
    const all = [...safeColumns(await publicColumns(runner(ctx)))]
      .map(([table, cols]) => ({ table, columns: cols.map((c) => `${c.column_name}:${shortType(c.data_type)}`) }));
    const q = String(args.search || '').toLowerCase().trim();
    const tables = q
      ? all.filter((t) => t.table.includes(q) || t.columns.some((c) => c.toLowerCase().includes(q)))
      : all.map((t) => ({ table: t.table, columns: [`${t.columns.length} колонок — уточните search`] }));
    return {
      note: 'Имена таблиц — без схемы (users, tasks; не public.users). Колонки в "кавычках" (camelCase): t."assigneeId". Время в базе — по Гринвичу (UTC), Душанбе = UTC+5. Колонка timestamptz → col AT TIME ZONE \'Asia/Dushanbe\'; колонка timestamp (без пояса, таких большинство: createdAt, startedAt) → (col AT TIME ZONE \'UTC\') AT TIME ZONE \'Asia/Dushanbe\' — одно AT TIME ZONE у timestamp сдвигает время в обратную сторону. Деньги — сомони. '
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
    + 'Сначала db_schema. Имена таблиц без схемы. Изменять данные этим нельзя.',
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
    const db = runner(ctx);
    // Сначала — структура и список схем базы (pg_namespace), и только потом
    // проверка запроса (15.11.2026): иначе в первом запросе после старта
    // «auth.users» и другие нестандартные схемы ещё не были бы известны
    // проверке «схема.таблица» и прочитались бы в обход представлений.
    let columns: ColumnRow[];
    try {
      columns = await publicColumns(db);
    } catch (e: any) {
      throw new ToolError(`Ошибка запроса: ${String(e?.message || e).slice(0, 300)}`);
    }
    const { run: sql, code } = analyzeSql(args.sql);
    let rows: any[];
    try {
      // Представления — только для таблиц, названных в запросе: их немного,
      // и транзакция не создаёт лишнего.
      const prelude = voiceRoDdl(columns, mentionedTables(code, safeColumns(columns).keys()));
      rows = await db(`SELECT * FROM (${sql}) AS voice_q LIMIT 200`, prelude);
    } catch (e: any) {
      if (e instanceof ToolError) throw e;
      // Без безопасных представлений к таблицам не идём вовсе (15.11.2026).
      if (e instanceof ViewsUnavailable) {
        throw new ToolError('Чтение базы сейчас недоступно: не удалось подготовить защищённые представления (схема voice_ro). Сообщите администратору — нужны права на создание схемы.');
      }
      throw new ToolError(`Ошибка запроса: ${String(e?.message || e).slice(0, 300)}`);
    }
    return { rowCount: rows.length, rows: scrubRows(rows) };
  },
};

export const DB_TOOLS: ToolDef[] = [dbSchema, dbQuery];
