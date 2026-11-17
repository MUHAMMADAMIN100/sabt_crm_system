/**
 * Источники цифр «Компаса компании» (16.11.2026, docs/GOALS_SPEC.md §4).
 *
 * Файл без DI Nest: функции принимают то, у чего есть query (DataSource /
 * EntityManager), окно { from, to } — календарные дни по Душанбе — и
 * параметры. Каждый источник отдаёт { value, detail }; value = null — данных
 * нет. Ошибка запроса не роняет страницу: value = null и warn в лог.
 *
 * Ими же считаются измеримые цели месяца сотрудников (profile-stats) —
 * с userId / ownerId сотрудника.
 */
import { Logger } from '@nestjs/common';
import { DEV_PROJECT_TYPES } from '../../common/sales-segment';
import type { Queryable } from './departments';
import type { KrKind, KrUnit, SourceKey, SourceMeta, SourceParamKey } from './goals.types';
import { DayWindow, addDays, fmtNum, plural, round1, shiftYm, monthEnd, monthStart, ymOf } from './goals.logic';

const logger = new Logger('GoalSources');

export interface SourceResult {
  value: number | null;
  detail: string | null;
}

export interface SourceParams {
  /** revenue: smm | development | design | maintenance; продажи: smm | development. */
  direction?: string | null;
  /** tasks_ontime: dev | smm; kpi_efficiency: ключ отдела. */
  department?: string | null;
  /** kpi_efficiency: одна метрика KPI вместо общего процента. */
  kpiKey?: string | null;
  /** Исполнитель / специалист (цели месяца сотрудника). */
  userId?: string | null;
  /** Ответственный за лид (цели месяца менеджера продаж). */
  ownerId?: string | null;
}

/** Нужное от KpiService (структурно — без импорта сервиса). */
export interface KpiLike {
  getAllKpi(from?: string, to?: string): Promise<Array<{
    userId: string;
    overallPercent: number;
    noData?: boolean;
    items: Array<{ key: string; percent: number }>;
  }>>;
}

/** Каталог источников — то, что видит автор результата. */
export const SOURCE_CATALOG: SourceMeta[] = [
  {
    key: 'revenue', label: 'Финансы — полученные оплаты',
    hint: 'Доход месяца по «Финансам»: полученные оплаты, без отменённых и переводов',
    unit: 'money', kind: 'sum', params: ['direction'],
  },
  {
    key: 'overdue_share', label: 'Финансы — просроченные оплаты',
    hint: 'Какая доля оплат клиентов со сроком в этом месяце не пришла к сроку',
    unit: 'percent', kind: 'lower', params: [],
  },
  {
    key: 'smm_retention', label: 'Финансы — удержание SMM-клиентов',
    hint: 'Из SMM-клиентов, плативших в прошлом месяце, — доля тех, кто остался',
    unit: 'percent', kind: 'rate', params: [],
  },
  {
    key: 'won_deals', label: 'Продажи — выигранные сделки',
    hint: 'Лиды, которые за месяц перешли в «Выигран»',
    unit: 'count', kind: 'sum', params: ['direction'],
  },
  {
    key: 'new_leads', label: 'Продажи — новые лиды',
    hint: 'Лиды, добавленные в базу клиентов за месяц',
    unit: 'count', kind: 'sum', params: ['direction'],
  },
  {
    key: 'content_ontime', label: 'Контент-план — публикации в срок',
    hint: 'Публикации SMM-проектов с датой в этом месяце, выложенные не позже своей даты',
    unit: 'percent', kind: 'rate', params: [],
  },
  {
    key: 'tasks_ontime', label: 'Задачи — выполнено в срок',
    hint: 'Задачи со сроком в этом месяце, сданные к сроку',
    unit: 'percent', kind: 'rate', params: ['department'],
  },
  {
    key: 'stories_norm', label: 'Сторис — дни по норме',
    hint: 'Доля дней, когда по активным SMM-проектам выложены сторис',
    unit: 'percent', kind: 'rate', params: [],
  },
  {
    key: 'kpi_efficiency', label: 'KPI — средняя эффективность',
    hint: 'Средний процент KPI сотрудников отдела за месяц',
    unit: 'percent', kind: 'rate', params: ['department', 'kpiKey'],
  },
  {
    key: 'rollup', label: 'По результатам отделов',
    hint: 'Среднее выполнение результатов отделов, которые работают на этот результат',
    unit: 'percent', kind: 'rate', params: [], companyOnly: true,
  },
  {
    key: 'manual', label: 'Вручную',
    hint: 'Цифру вносит ответственный',
    unit: null, kind: 'sum', params: [],
  },
];

export const SOURCE_KEYS = SOURCE_CATALOG.map(s => s.key);

export function sourceMeta(key: string): SourceMeta | null {
  return SOURCE_CATALOG.find(s => s.key === key) || null;
}

export function isSourceKey(v: unknown): v is SourceKey {
  return typeof v === 'string' && (SOURCE_KEYS as string[]).includes(v);
}

/** Единица и правило статуса источника; у manual единицу выбирает автор. */
export function unitOf(source: string, manualUnit?: string | null): KrUnit {
  const meta = sourceMeta(source);
  if (meta?.unit) return meta.unit;
  return manualUnit === 'money' || manualUnit === 'percent' ? manualUnit : 'count';
}

export function kindOf(source: string): KrKind {
  return sourceMeta(source)?.kind || 'sum';
}

/** Метрики KPI — для параметра kpiKey. */
export const KPI_KEYS: Array<{ key: string; label: string }> = [
  { key: 'task_delivery', label: 'Задачи сдано в срок' },
  { key: 'content_on_time', label: 'Публикации и карточки в срок' },
  { key: 'stories_plan', label: 'План сторис' },
  { key: 'activity_days', label: 'Активных дней' },
  { key: 'deadline_rate', label: 'Соблюдено дедлайнов' },
  { key: 'sales_funnel_progress', label: 'Продажи: продвижения по воронке' },
  { key: 'sales_new_companies', label: 'Продажи: новые компании в базе' },
  { key: 'sales_cold_calls', label: 'Продажи: звонки' },
  { key: 'sales_personal_emails', label: 'Продажи: персональные письма' },
  { key: 'sales_meetings', label: 'Продажи: встречи / созвоны' },
];

/** Допустимые значения параметров. */
const FINANCE_DIRECTIONS = ['smm', 'development', 'design', 'maintenance'];
const LEAD_DIRECTIONS = ['smm', 'development'];
const TASK_DEPARTMENTS = ['dev', 'smm'];
const DEPARTMENTS = ['sales', 'smm', 'dev', 'management'];

/** Оставить только параметры, которые источник принимает, и с допустимыми
 *  значениями. Неизвестное молча отбрасываем. */
export function cleanSourceParams(source: string, raw: unknown): Partial<Record<SourceParamKey, string>> {
  const meta = sourceMeta(source);
  const out: Partial<Record<SourceParamKey, string>> = {};
  if (!meta || !raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (meta.params.includes('direction')) {
    const d = str(r.direction);
    const allowed = source === 'revenue' ? FINANCE_DIRECTIONS : LEAD_DIRECTIONS;
    if (allowed.includes(d)) out.direction = d;
  }
  if (meta.params.includes('department')) {
    const d = str(r.department);
    const allowed = source === 'tasks_ontime' ? TASK_DEPARTMENTS : DEPARTMENTS;
    if (allowed.includes(d)) out.department = d;
  }
  if (meta.params.includes('kpiKey')) {
    const k = str(r.kpiKey);
    if (/^[a-z_]{1,40}$/.test(k)) out.kpiKey = k;
  }
  return out;
}

// ─── Выборки ─────────────────────────────────────────────────────────────

/** Границы суток по Душанбе (UTC+5 круглый год) — строкой для ::timestamptz. */
const dayStart = (iso: string) => `${iso}T00:00:00+05:00`;
const dayEnd = (iso: string) => `${iso}T23:59:59.999+05:00`;

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
const pct = (part: number, total: number) => (total > 0 ? round1((part / total) * 100) : null);
const empty = (): SourceResult => ({ value: null, detail: null });

async function rows(db: Queryable, sql: string, params: unknown[], what: string): Promise<any[] | null> {
  try {
    const r = await db.query(sql, params as any[]);
    return Array.isArray(r) ? r : [];
  } catch (e: any) {
    logger.warn(`${what} failed: ${String(e?.message || e).slice(0, 200)}`);
    return null;
  }
}

/** Проект «Финансов» приносит доход (как isEarningFinanceProject). */
const EARNING_SQL = `COALESCE(fp.archived, false) = false
  AND COALESCE(fp.status, 'active') NOT IN ('lead', 'paused', 'done', 'archived')`;

/** Проведённая операция (как isPostedFinanceTransaction). */
const POSTED_SQL = (t: string) => `(${t}.status IS NULL OR ${t}.status = 'completed')`;

/**
 * Доход за период по правилам «Финансов» (FinanceService.overview): операции
 * income, проведённые (status completed/пусто), по дате. Направление — как
 * directionOf: направление финансового проекта, без проекта — по ключу
 * категории (smm/smm1/smm2 → smm).
 */
export async function revenue(db: Queryable, win: DayWindow, p: SourceParams = {}): Promise<SourceResult> {
  const r = await rows(db,
    `SELECT COALESCE(SUM(t.amount), 0)::float AS total, COUNT(*)::int AS n
       FROM finance_transactions t
       LEFT JOIN finance_projects fp ON fp.id = t."projectId"
       LEFT JOIN finance_categories fc ON fc.id = t."categoryId"
      WHERE t.type = 'income'
        AND ${POSTED_SQL('t')}
        AND t.date BETWEEN $1::date AND $2::date
        AND ($3::text IS NULL OR COALESCE(fp.direction,
              CASE WHEN fc.key IN ('smm', 'smm1', 'smm2') THEN 'smm'
                   WHEN fc.key IN ('development', 'design', 'maintenance') THEN fc.key END) = $3::text)`,
    [win.from, win.to, p.direction || null], 'revenue');
  if (!r) return empty();
  const n = num(r[0]?.n);
  return { value: round1(num(r[0]?.total)), detail: n ? `${n} ${plural(n, 'оплата', 'оплаты', 'оплат')}` : 'оплат пока нет' };
}

/** Неоплаченные просрочки клиентов прямо сейчас: ожидаемые плановые оплаты
 *  действующих клиентов со сроком раньше before. */
export async function overdueClients(db: Queryable, before: string): Promise<{ clients: number; amount: number } | null> {
  const r = await rows(db,
    `SELECT COUNT(DISTINCT pp."projectId")::int AS clients, COALESCE(SUM(pp.amount), 0)::float AS amount
       FROM finance_planned_payments pp
       JOIN finance_projects fp ON fp.id = pp."projectId"
      WHERE pp.status = 'expected' AND pp."debtId" IS NULL
        AND pp."dueDate" IS NOT NULL AND pp."dueDate" < $1::date
        AND ${EARNING_SQL}`,
    [before], 'overdue clients');
  if (!r) return null;
  return { clients: num(r[0]?.clients), amount: round1(num(r[0]?.amount)) };
}

/**
 * Доля просроченных оплат: из плановых оплат клиентов со сроком в
 * [from, min(to, вчера)] — доля суммы, не полученной к сроку (сейчас не
 * получена или получена операцией позже срока). Ожидаемые — только у
 * клиентов, которые приносят доход (как «Просрочено» в «Финансах»);
 * полученные с отменённой операцией не считаем (денег нет).
 */
export async function overdueShare(db: Queryable, win: DayWindow, today: string): Promise<SourceResult> {
  const yesterday = addDays(today, -1);
  const to = win.to < yesterday ? win.to : yesterday;
  const [share, now] = await Promise.all([
    to < win.from ? Promise.resolve([] as any[]) : rows(db,
      `SELECT COALESCE(SUM(pp.amount), 0)::float AS due,
              COALESCE(SUM(pp.amount) FILTER (
                WHERE pp.status = 'expected' OR (tx.date IS NOT NULL AND tx.date > pp."dueDate")), 0)::float AS late
         FROM finance_planned_payments pp
         JOIN finance_projects fp ON fp.id = pp."projectId"
         LEFT JOIN finance_transactions tx ON tx.id = pp."receivedTxId"
        WHERE pp."debtId" IS NULL
          AND pp."dueDate" BETWEEN $1::date AND $2::date
          AND ((pp.status = 'expected' AND ${EARNING_SQL})
            OR (pp.status = 'received' AND (pp."receivedTxId" IS NULL OR (tx.id IS NOT NULL AND ${POSTED_SQL('tx')}))))`,
      [win.from, to], 'overdue share'),
    overdueClients(db, today),
  ]);
  if (!share) return empty();
  const due = num(share[0]?.due);
  const detail = now && now.clients > 0
    ? `${now.clients} ${plural(now.clients, 'клиент', 'клиента', 'клиентов')}, сумма ${fmtNum(now.amount)} с.`
    : now ? 'просрочек сейчас нет' : null;
  return { value: due > 0 ? pct(num(share[0]?.late), due) : null, detail };
}

/**
 * Удержание SMM-клиентов: из клиентов «Финансов» направления SMM, у которых
 * была оплата в прошлом месяце, — доля тех, кто платит в этом или по-прежнему
 * в работе (не в архиве, не на паузе, не завершён).
 */
export async function smmRetention(db: Queryable, win: DayWindow): Promise<SourceResult> {
  const prev = shiftYm(ymOf(win.from), -1);
  const r = await rows(db,
    `WITH prev AS (
       SELECT DISTINCT t."projectId" AS pid
         FROM finance_transactions t
         JOIN finance_projects p ON p.id = t."projectId" AND p.direction = 'smm'
        WHERE t.type = 'income' AND ${POSTED_SQL('t')}
          AND t.date BETWEEN $1::date AND $2::date
     ), cur AS (
       SELECT DISTINCT t."projectId" AS pid
         FROM finance_transactions t
        WHERE t.type = 'income' AND ${POSTED_SQL('t')} AND t."projectId" IS NOT NULL
          AND t.date BETWEEN $3::date AND $4::date
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE prev.pid IN (SELECT pid FROM cur) OR (${EARNING_SQL}))::int AS kept
       FROM prev JOIN finance_projects fp ON fp.id = prev.pid`,
    [monthStart(prev), monthEnd(prev), win.from, win.to], 'smm retention');
  if (!r) return empty();
  const total = num(r[0]?.total);
  const kept = num(r[0]?.kept);
  return { value: pct(kept, total), detail: total ? `${kept} из ${total} ${plural(total, 'клиента', 'клиентов', 'клиентов')}` : null };
}

/**
 * Выигранные сделки: лиды в статусе won, выигранные в периоде. Дата выигрыша —
 * как wonRows в sales-analytics: первая веха won / «Реализация» в
 * lead_progress, иначе передача в работу, иначе последняя правка.
 */
export async function wonDeals(db: Queryable, win: DayWindow, p: SourceParams = {}): Promise<SourceResult> {
  const params = [dayStart(win.from), dayEnd(win.to), p.direction || null, p.ownerId || null];
  const filter = `c.status::text = 'won'
          AND ($3::text IS NULL OR c.direction::text = $3::text)
          AND ($4::text IS NULL OR c."ownerId"::text = $4::text)`;
  let r = await rows(db,
    `SELECT COUNT(*)::int AS n FROM (
       SELECT COALESCE(
                (SELECT MIN(lp.created_at) FROM lead_progress lp
                  WHERE lp.lead_id = c.id AND lp.delta > 0
                    AND (lp.status_to = 'won' OR lp.stage_to = 'implementation')),
                c."handoffAt", c."updatedAt") AS won_at
         FROM client_leads c
        WHERE ${filter}
     ) x WHERE x.won_at BETWEEN $1::timestamptz AND $2::timestamptz`,
    params, 'won deals');
  if (!r) {
    // Без журнала вех (старая база) — как запасной путь wonRows.
    r = await rows(db,
      `SELECT COUNT(*)::int AS n FROM client_leads c
        WHERE ${filter}
          AND COALESCE(c."handoffAt", c."updatedAt") BETWEEN $1::timestamptz AND $2::timestamptz`,
      params, 'won deals (fallback)');
  }
  if (!r) return empty();
  return { value: num(r[0]?.n), detail: null };
}

/** Новые лиды: добавлены в базу в периоде (сутки по Душанбе). */
export async function newLeads(db: Queryable, win: DayWindow, p: SourceParams = {}): Promise<SourceResult> {
  const r = await rows(db,
    `SELECT COUNT(*)::int AS n FROM client_leads c
      WHERE c."createdAt" BETWEEN $1::timestamptz AND $2::timestamptz
        AND ($3::text IS NULL OR c.direction::text = $3::text)
        AND ($4::text IS NULL OR c."ownerId"::text = $4::text)`,
    [dayStart(win.from), dayEnd(win.to), p.direction || null, p.ownerId || null], 'new leads');
  if (!r) return empty();
  return { value: num(r[0]?.n), detail: null };
}

/**
 * Публикации в срок — как deliveries (kind=content, smm) в profile-stats:
 * карточки SMM-проектов (не сторис, не карточки подготовки) с датой в
 * периоде, не отменённые; в срок — опубликовано не позже своей даты (день
 * публикации по Душанбе; у старых без publishedAt — последняя правка).
 * userId — только проекты специалиста (назначен или участник).
 */
export async function contentOntime(db: Queryable, win: DayWindow, p: SourceParams = {}): Promise<SourceResult> {
  const r = await rows(db,
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ci.status::text = 'published'
              AND (COALESCE(ci."publishedAt", ci."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dushanbe')::date
                  <= ci."publishDate"::date)::int AS ontime
       FROM content_plan_items ci
       JOIN projects p ON p.id = ci."projectId" AND p."projectType" = 'SMM'
      WHERE ci.status::text <> 'cancelled'
        AND ci."publishDate" IS NOT NULL
        AND ci."publishDate"::date BETWEEN $1::date AND $2::date
        AND ci."shootForItemId" IS NULL
        AND ci."contentType"::text <> 'story'
        AND ($3::text IS NULL
          OR jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), $3::text)
          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm."projectsId" = p.id AND pm."usersId"::text = $3::text))`,
    [win.from, win.to, p.userId || null], 'content on time');
  if (!r) return empty();
  const total = num(r[0]?.total);
  const ontime = num(r[0]?.ontime);
  return { value: pct(ontime, total), detail: total ? `${ontime} из ${total} в срок` : null };
}

/**
 * Задачи в срок: задачи с дедлайном в периоде, который уже наступил, не
 * отменённые; в срок — сданы (done) не позже дедлайна (момент сдачи как в
 * profile-stats: completedAt → reviewedAt → updatedAt). department=dev —
 * задачи dev-проектов, smm — SMM-проектов. userId — исполнитель (основной
 * или в очереди исполнителей).
 */
export async function tasksOntime(db: Queryable, win: DayWindow, p: SourceParams = {}): Promise<SourceResult> {
  const dept = p.department === 'dev' || p.department === 'smm' ? p.department : null;
  const r = await rows(db,
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE t.status::text = 'done'
              AND COALESCE(t."completedAt", t."reviewedAt", t."updatedAt") <= t.deadline)::int AS ontime
       FROM tasks t
       LEFT JOIN projects p ON p.id = t."projectId"
      WHERE t.status::text <> 'cancelled'
        AND t.deadline IS NOT NULL
        AND t.deadline >= $1::timestamptz
        AND t.deadline <= LEAST($2::timestamptz, now())
        AND ($3::text IS NULL
          OR ($3::text = 'dev' AND p."projectType" = ANY($5::text[]))
          OR ($3::text = 'smm' AND p."projectType" = 'SMM'))
        AND ($4::text IS NULL
          OR t."assigneeId"::text = $4::text
          OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = t.id AND ta."userId"::text = $4::text))`,
    [dayStart(win.from), dayEnd(win.to), dept, p.userId || null, DEV_PROJECT_TYPES], 'tasks on time');
  if (!r) return empty();
  const total = num(r[0]?.total);
  const ontime = num(r[0]?.ontime);
  return { value: pct(ontime, total), detail: total ? `${ontime} из ${total} в срок` : null };
}

/**
 * Сторис по норме — по всей компании: пары (проект, день) периода по
 * активным SMM-проектам со сторис (правило storyDays в profile-stats), из
 * них — где сторис отмечены. Сегодняшний день ещё идёт — считаем по вчера
 * (если окно не из одного сегодняшнего дня).
 */
export async function storiesNorm(db: Queryable, win: DayWindow, today: string): Promise<SourceResult> {
  let to = win.to;
  if (to >= today) {
    const y = addDays(today, -1);
    to = y >= win.from ? y : today;
  }
  const r = await rows(db,
    `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day),
     proj AS (
       SELECT p.id, COALESCE(p."startDate"::date, p."createdAt"::date) AS since
         FROM projects p
        WHERE p."isArchived" = false
          AND COALESCE(p."storiesArchived", false) = false
          AND p."projectType" = 'SMM'
          AND CASE
                WHEN p."smmData"->>'storiesPerMonth' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerMonth')::int
                WHEN p."smmData"->>'storiesPerDay' ~ '^[0-9]+$' THEN (p."smmData"->>'storiesPerDay')::int
                ELSE 3
              END > 0
     ),
     grid AS (SELECT proj.id AS pid, days.day FROM proj CROSS JOIN days WHERE days.day >= proj.since),
     logs AS (
       SELECT sl."projectId" AS pid, sl.date::date AS day, SUM(sl."storiesCount") AS total
         FROM story_logs sl
        WHERE sl.date::date BETWEEN $1::date AND $2::date
        GROUP BY 1, 2
     )
     SELECT COUNT(*)::int AS pairs,
            COUNT(*) FILTER (WHERE COALESCE(l.total, 0) > 0)::int AS covered
       FROM grid g
       LEFT JOIN logs l ON l.pid = g.pid AND l.day = g.day`,
    [win.from, to], 'stories norm');
  if (!r) return empty();
  const pairs = num(r[0]?.pairs);
  const covered = num(r[0]?.covered);
  return { value: pct(covered, pairs), detail: pairs ? `${covered} из ${pairs} проекто-дней` : null };
}

/**
 * Средняя эффективность KPI: среднее overallPercent (или процента одной
 * метрики kpiKey) за период по сотрудникам memberIds; без memberIds — по
 * всем, у кого есть KPI. Без оценки (noData) не считаем.
 */
export async function kpiEfficiency(
  kpi: KpiLike | null | undefined, win: DayWindow, p: SourceParams & { memberIds?: string[] | null } = {},
): Promise<SourceResult> {
  if (!kpi) return empty();
  try {
    const all = await kpi.getAllKpi(win.from, win.to);
    const ids = p.memberIds ? new Set(p.memberIds) : null;
    const values: number[] = [];
    for (const k of all || []) {
      if (ids && !ids.has(k.userId)) continue;
      if (p.kpiKey) {
        const it = (k.items || []).find(x => x.key === p.kpiKey);
        if (it && Number.isFinite(Number(it.percent))) values.push(Number(it.percent));
      } else if (!k.noData && Number.isFinite(Number(k.overallPercent))) {
        values.push(Number(k.overallPercent));
      }
    }
    if (!values.length) return { value: null, detail: 'нет оценок KPI' };
    const avg = round1(values.reduce((s, v) => s + v, 0) / values.length);
    return { value: avg, detail: `по ${values.length} ${plural(values.length, 'сотруднику', 'сотрудникам', 'сотрудникам')}` };
  } catch (e: any) {
    logger.warn(`kpi efficiency failed: ${String(e?.message || e).slice(0, 200)}`);
    return empty();
  }
}

export interface SourceDeps {
  kpi?: KpiLike | null;
  /** Члены отдела — для kpi_efficiency с department. */
  memberIds?: string[] | null;
  /** Сегодня по Душанбе (для просрочек и сторис). */
  today: string;
}

/** Цифра источника за окно. rollup и manual считает сервис (здесь — null). */
export async function runSource(
  db: Queryable, source: string, win: DayWindow, params: SourceParams, deps: SourceDeps,
): Promise<SourceResult> {
  switch (source) {
    case 'revenue': return revenue(db, win, params);
    case 'overdue_share': return overdueShare(db, win, deps.today);
    case 'smm_retention': return smmRetention(db, win);
    case 'won_deals': return wonDeals(db, win, params);
    case 'new_leads': return newLeads(db, win, params);
    case 'content_ontime': return contentOntime(db, win, params);
    case 'tasks_ontime': return tasksOntime(db, win, params);
    case 'stories_norm': return storiesNorm(db, win, deps.today);
    case 'kpi_efficiency': return kpiEfficiency(deps.kpi, win, { ...params, memberIds: deps.memberIds ?? null });
    default: return empty();
  }
}
