import { hasGrant } from '../../auth/permissions';
import { DEV_PROJECT_TYPES } from '../../../common/sales-segment';
import { ApiError } from '../internal-api';
import { checkDate, fmtDateRu, matchScore } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Раздел «Разработка»: доска карточек (dev-tracker) и этапы проектов.
 * Права — как на сайте: dev-tracker.view (manage его включает) видит доску и
 * двигает карточки, комментирует; dev-tracker.manage создаёт, правит,
 * назначает и удаляет. Этап проекта (1–6) — handler-level @Roles сайта.
 *
 * Два разных «этапа»: колонка доски (Бэклог … Готово) и этап проекта
 * (ТЗ … Внедрение). Колонка — у карточки, этап — у проекта.
 */

export const DEV_COLUMN_RU: Record<string, string> = {
  backlog: 'Бэклог', todo: 'К выполнению', in_progress: 'В работе', testing: 'Тестирование', done: 'Готово',
};
const PRIORITY_RU: Record<string, string> = { low: 'низкий', medium: 'средний', high: 'высокий', critical: 'критичный' };
const TYPE_RU: Record<string, string> = { feature: 'фича', bug: 'баг', improvement: 'улучшение', tech_debt: 'техдолг' };
export const DEV_PROJECT_STAGES: Array<{ num: number; pct: number; label: string }> = [
  { num: 1, pct: 10, label: 'Сбор требований и ТЗ' },
  { num: 2, pct: 25, label: 'Проектирование и концепт' },
  { num: 3, pct: 50, label: 'Активная фаза производства' },
  { num: 4, pct: 75, label: 'Внутренняя приёмка и QA' },
  { num: 5, pct: 90, label: 'Демонстрация и согласование' },
  { num: 6, pct: 100, label: 'Внедрение и передача' },
];
const STAGE_ROLES = ['admin', 'founder', 'dev_director', 'pm_dev', 'developer'];

const canView = (u: any) => hasGrant(u, 'dev-tracker.view');
const canManage = (u: any) => hasGrant(u, 'dev-tracker.manage');
const canSetStage = (u: any) => [u.role, u.secondaryRole].some((r) => r && STAGE_ROLES.includes(r));

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);

/** Срок карточки — дата без времени: доска показывает и шлёт именно её (нарезкой строки). */
const boardDay = (iso: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso ?? ''));
  return m ? m[1] : null;
};
const fmtBoardDay = (iso: unknown): string => {
  const d = boardDay(iso);
  return d ? fmtDateRu(d) : 'без срока';
};

function cardEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('D', ref);
  if (!e) throw new ToolError(`Нет карточки с меткой «${ref}». Сначала найдите её через find_dev_cards.`);
  return e;
}
function projectEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('P', ref);
  if (!e) throw new ToolError(`Нет проекта с меткой «${ref}». Найдите его через dev_projects.`);
  return e;
}
function personEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('E', ref);
  if (!e) throw new ToolError(`Нет сотрудника с меткой «${ref}». Найдите его через dev_team.`);
  return e;
}
function columnOf(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!DEV_COLUMN_RU[s]) throw new ToolError(`Неизвестная колонка доски «${s}». Есть: ${Object.keys(DEV_COLUMN_RU).join(', ')}.`);
  return s;
}
function priorityOf(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!PRIORITY_RU[s]) throw new ToolError(`Неизвестный приоритет «${s}».`);
  return s;
}
function typeOf(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!TYPE_RU[s]) throw new ToolError(`Неизвестный тип карточки «${s}».`);
  return s;
}
function titleOf(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new ToolError('Не понял название карточки.');
  if (s.length > 200) throw new ToolError('Название карточки длиннее 200 знаков — сократите.');
  return s;
}

function compactCard(ctx: ToolContext, c: any): Record<string, any> {
  const out: Record<string, any> = {
    ref: ctx.refs.add('D', c.id, c.title),
    title: c.title,
    column: DEV_COLUMN_RU[c.status] || c.status,
    priority: PRIORITY_RU[c.priority] || c.priority,
    type: TYPE_RU[c.taskType] || c.taskType,
  };
  if (c.assignee?.id) out.assignee = { ref: ctx.refs.add('E', c.assignee.id, String(c.assignee.name).trim()), name: String(c.assignee.name).trim() };
  else out.assignee = null;
  if (c.project?.id) out.project = { ref: ctx.refs.add('P', c.project.id, c.project.name), name: c.project.name };
  const day = boardDay(c.deadline);
  if (day) {
    out.deadline = fmtDateRu(day);
    if (c.status !== 'done' && day < ctx.today) out.overdue = true;
  }
  if (c.isBlocked) out.blocked = c.blockedReason ? String(c.blockedReason).slice(0, 200) : true;
  if (c.parentTaskId) out.isSubtask = true;
  if (c.subtasksCount) out.subtasks = `${c.subtasksDone ?? 0}/${c.subtasksCount}`;
  return out;
}

async function loadCard(ctx: ToolContext, id: string): Promise<any> {
  try { return await ctx.api.get(`/dev-tracker/${id}`); } catch (e) { throw apiErr(e); }
}

// ─── Чтение ──────────────────────────────────────────────────────────────

interface FindCardsArgs {
  project?: string; assignee?: string; assignee_name?: string; column?: string; text?: string;
  mine?: boolean; blocked?: boolean; overdue?: boolean; include_done?: boolean; limit?: number;
}

export const findDevCards: ToolDef<FindCardsArgs> = {
  name: 'find_dev_cards',
  kind: 'read',
  description:
    'Карточки доски «Разработка»: «что в работе у разработчиков», «карточки по проекту Архидея», «что на тестировании», '
    + '«что у Фируза на доске», «просроченные карточки», «заблокированные». Фильтры: проект (метка P из dev_projects), '
    + 'исполнитель (метка E из dev_team или имя), колонка доски, слова из названия. Возвращает метки D…, колонку, исполнителя, срок. '
    + 'Колонка доски — это Бэклог / К выполнению / В работе / Тестирование / Готово. Это НЕ задачи производства контента '
    + '(для них find_tasks) и НЕ этап проекта (его показывает dev_projects).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      assignee: { type: 'string', description: 'Метка исполнителя E…' },
      assignee_name: { type: 'string', description: 'Имя исполнителя, как прозвучало (если метки нет).' },
      column: { type: 'string', enum: Object.keys(DEV_COLUMN_RU), description: 'Колонка доски.' },
      text: { type: 'string', description: 'Слова из названия или описания.' },
      mine: { type: 'boolean', description: 'Только мои карточки.' },
      blocked: { type: 'boolean', description: 'true — только заблокированные.' },
      overdue: { type: 'boolean', description: 'true — только просроченные.' },
      include_done: { type: 'boolean', description: 'Показать и карточки из «Готово». По умолчанию скрыты, если колонка не названа.' },
      limit: { type: 'integer' },
    },
    additionalProperties: false,
  },
  available: canView,
  async run(args, ctx) {
    const query: Record<string, any> = {};
    if (args.project) query.projectId = projectEntry(ctx, args.project).id;
    if (args.assignee) query.assigneeId = personEntry(ctx, args.assignee).id;
    if (args.mine) query.assigneeId = ctx.user.id;
    if (args.column) query.status = columnOf(args.column);
    const text = String(args.text || '').trim();
    if (text) query.search = text.slice(0, 200);
    if (args.blocked) query.blocked = 'true';
    let list: any[];
    try { list = await ctx.api.get<any[]>('/dev-tracker', query); } catch (e) { throw apiErr(e); }
    if (!Array.isArray(list)) list = [];
    const byName = String(args.assignee_name || '').trim();
    if (byName) list = list.filter((c) => c.assignee?.name && matchScore(c.assignee.name, byName) >= 0.5);
    if (args.overdue) {
      list = list.filter((c) => c.status !== 'done' && !!boardDay(c.deadline) && (boardDay(c.deadline) as string) < ctx.today);
    }
    const byColumn: Record<string, number> = {};
    for (const c of list) byColumn[DEV_COLUMN_RU[c.status] || c.status] = (byColumn[DEV_COLUMN_RU[c.status] || c.status] || 0) + 1;
    const shown = args.column || args.include_done ? list : list.filter((c) => c.status !== 'done');
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 50);
    return { total: list.length, byColumn, shown: Math.min(shown.length, limit), cards: shown.slice(0, limit).map((c) => compactCard(ctx, c)) };
  },
};

export const devCardDetails: ToolDef<{ card: string }> = {
  name: 'dev_card_details',
  kind: 'read',
  description: 'Подробности карточки доски «Разработка»: описание, подзадачи, последние комментарии. «Что в карточке про оплату», «что писали в карточке».',
  parameters: {
    type: 'object',
    properties: { card: { type: 'string', description: 'Метка D…' } },
    required: ['card'],
    additionalProperties: false,
  },
  available: canView,
  async run(args, ctx) {
    const e = cardEntry(ctx, args.card);
    const c = await loadCard(ctx, e.id);
    const comments: any[] = Array.isArray(c.comments) ? c.comments : [];
    const subtasks: any[] = Array.isArray(c.subtasks) ? c.subtasks : [];
    return {
      ...compactCard(ctx, c),
      description: c.description ? String(c.description).slice(0, 1500) : null,
      subtasksList: subtasks.slice(0, 20).map((s) => compactCard(ctx, s)),
      commentsTotal: comments.length,
      lastComments: comments.slice(-8).map((m) => ({
        author: m.author?.name || 'Сотрудник',
        text: String(m.text || '').slice(0, 400),
      })),
    };
  },
};

export const devProjects: ToolDef<{ text?: string; include_archived?: boolean }> = {
  name: 'dev_projects',
  kind: 'read',
  description:
    'Проекты раздела «Разработка» (сайты, боты, CRM, магазины) с их ЭТАПОМ (1 ТЗ … 6 Внедрение) и числом карточек на доске. '
    + '«На каком этапе проект Архидея», «какие проекты разработки у нас». Метки P… нужны для карточек. '
    + 'Этап проекта — не колонка доски.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Слова из названия проекта.' },
      include_archived: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  available: canView,
  async run(args, ctx) {
    let list: any[];
    try { list = await ctx.api.get<any[]>('/projects', args.include_archived ? { archived: 'true' } : undefined); } catch (e) { throw apiErr(e); }
    let items = (Array.isArray(list) ? list : []).filter((p) => !!p?.id && DEV_PROJECT_TYPES.includes(p.projectType));
    const text = String(args.text || '').trim();
    if (text) {
      items = items
        .map((p) => ({ p, s: matchScore(p.name, text) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p);
    }
    let cards: any[] = [];
    try { cards = await ctx.api.get<any[]>('/dev-tracker'); } catch { cards = []; }
    const count = (pid: string) => {
      const own = (Array.isArray(cards) ? cards : []).filter((c) => c.projectId === pid);
      return { all: own.length, open: own.filter((c) => c.status !== 'done').length };
    };
    return {
      total: items.length,
      projects: items.slice(0, 40).map((p) => {
        const stage = DEV_PROJECT_STAGES.find((s) => s.num === Number(p.devStage));
        return {
          ref: ctx.refs.add('P', p.id, p.name),
          name: p.name,
          type: p.projectType,
          stage: stage ? `${stage.num}. ${stage.label} (${stage.pct}%)` : 'не задан',
          cards: count(p.id),
          ...(p.isArchived ? { archived: true } : {}),
        };
      }),
    };
  },
};

export const devTeam: ToolDef<{ name?: string }> = {
  name: 'dev_team',
  kind: 'read',
  description:
    'Исполнители доски «Разработка» (разработчики, проект-менеджер, руководство) с метками E…. '
    + 'Нужно перед «поставь на Фируза», «создай карточку для Алишера». Падежи учитываются.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Имя, как прозвучало. Без имени — вся команда.' } },
    additionalProperties: false,
  },
  available: canView,
  async run(args, ctx) {
    let list: any[];
    try { list = await ctx.api.get<any[]>('/dev-tracker/assignees'); } catch (e) { throw apiErr(e); }
    let people = (Array.isArray(list) ? list : []).filter((u) => !!u?.id);
    const q = String(args.name || '').trim();
    if (q) {
      people = people
        .map((u) => ({ u, s: matchScore(u.name, q) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.u);
    }
    return {
      total: people.length,
      people: people.slice(0, 30).map((u) => ({ ref: ctx.refs.add('E', u.id, String(u.name).trim()), name: String(u.name).trim(), role: u.role })),
    };
  },
};

// ─── Создание ────────────────────────────────────────────────────────────

interface CreateCardArgs {
  title: string; description?: string; column?: string; priority?: string; type?: string;
  assignee?: string; project?: string; deadline?: string; parent_card?: string;
}

function createBody(args: CreateCardArgs, ctx: ToolContext): { body: Record<string, any>; assigneeName?: string; projectName?: string; parentTitle?: string } {
  const body: Record<string, any> = { title: titleOf(args.title) };
  const description = String(args.description ?? '').trim();
  if (description) body.description = description.slice(0, 10000);
  if (args.column) body.status = columnOf(args.column);
  if (args.priority) body.priority = priorityOf(args.priority);
  if (args.type) body.taskType = typeOf(args.type);
  if (args.deadline) body.deadline = checkDate(args.deadline, 'дата срока');
  let assigneeName: string | undefined;
  let projectName: string | undefined;
  let parentTitle: string | undefined;
  if (args.assignee) { const p = personEntry(ctx, args.assignee); body.assigneeId = p.id; assigneeName = p.label; }
  if (args.project) { const p = projectEntry(ctx, args.project); body.projectId = p.id; projectName = p.label; }
  if (args.parent_card) { const p = cardEntry(ctx, args.parent_card); body.parentTaskId = p.id; parentTitle = p.label; }
  return { body, assigneeName, projectName, parentTitle };
}

export const createDevCard: ToolDef<CreateCardArgs> = {
  name: 'create_dev_card',
  kind: 'write',
  description:
    'Создать карточку на доске «Разработка»: «заведи карточку сделать оплату в проекте Архидея, на Фируза, срок пятница», '
    + '«добавь баг: не открывается корзина, высокий приоритет». Подзадача карточки — через parent_card. '
    + 'Колонка по умолчанию Бэклог. Это НЕ задача производства контента (для неё create_task).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Название карточки.' },
      description: { type: 'string' },
      column: { type: 'string', enum: Object.keys(DEV_COLUMN_RU), description: 'Колонка доски, если назвали.' },
      priority: { type: 'string', enum: Object.keys(PRIORITY_RU) },
      type: { type: 'string', enum: Object.keys(TYPE_RU), description: 'feature — фича, bug — баг, improvement — улучшение, tech_debt — техдолг.' },
      assignee: { type: 'string', description: 'Метка исполнителя E… (из dev_team).' },
      project: { type: 'string', description: 'Метка проекта P… (из dev_projects).' },
      deadline: { type: 'string', description: 'Срок ГГГГ-ММ-ДД.' },
      parent_card: { type: 'string', description: 'Метка D… родительской карточки — создаётся подзадача.' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  available: canManage,
  confirm: (args, ctx) => !!args.assignee && personEntryId(ctx, args.assignee) !== ctx.user.id,
  async preview(args, ctx) {
    const { body, assigneeName, projectName, parentTitle } = createBody(args, ctx);
    return [
      '➕ СОЗДАТЬ КАРТОЧКУ И НАЗНАЧИТЬ ИСПОЛНИТЕЛЯ',
      `«${body.title}»`,
      assigneeName ? `Исполнитель: ${assigneeName}` : null,
      projectName ? `Проект: ${projectName}` : null,
      parentTitle ? `Подзадача карточки: «${parentTitle}»` : null,
      body.status ? `Колонка: ${DEV_COLUMN_RU[body.status]}` : null,
      body.priority ? `Приоритет: ${PRIORITY_RU[body.priority]}` : null,
      body.deadline ? `Срок: ${fmtDateRu(body.deadline)}` : null,
    ].filter(Boolean).join('\n');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { body, assigneeName, projectName } = createBody(args, ctx);
    let created: any;
    try { created = await ctx.api.post('/dev-tracker', body); } catch (e) { throw apiErr(e); }
    if (created?.id) ctx.refs.add('D', created.id, body.title);
    const parts = [assigneeName ? `исполнитель ${assigneeName}` : null, projectName ? `проект ${projectName}` : null,
      body.deadline ? `срок ${fmtDateRu(body.deadline)}` : null].filter(Boolean);
    return {
      summary: `🧩 Карточка «${body.title}» создана${created?.status ? ` в «${DEV_COLUMN_RU[created.status] || created.status}»` : ''}${parts.length ? `, ${parts.join(', ')}` : ''}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/dev-tracker/${created.id}` }] : undefined,
    };
  },
};

function personEntryId(ctx: ToolContext, ref: unknown): string | null {
  return ctx.refs.resolve('E', ref)?.id ?? null;
}

// ─── Движение по доске ───────────────────────────────────────────────────

export const moveDevCard: ToolDef<{ card: string; column: string }> = {
  name: 'move_dev_card',
  kind: 'write',
  description:
    'Передвинуть карточку по колонкам доски: «карточку про оплату в работу», «перенеси на тестирование», «готово». '
    + 'Колонки: backlog Бэклог, todo К выполнению, in_progress В работе, testing Тестирование, done Готово. '
    + 'Это НЕ смена этапа проекта (для неё set_dev_project_stage).',
  parameters: {
    type: 'object',
    properties: {
      card: { type: 'string', description: 'Метка D…' },
      column: { type: 'string', enum: Object.keys(DEV_COLUMN_RU) },
    },
    required: ['card', 'column'],
    additionalProperties: false,
  },
  available: canView,
  async run(args, ctx): Promise<WriteOutcome> {
    const e = cardEntry(ctx, args.card);
    const target = columnOf(args.column);
    const old = await loadCard(ctx, e.id);
    if (old.status === target) throw new ToolError(`Карточка «${old.title}» уже в колонке «${DEV_COLUMN_RU[target]}».`);
    // Как на сайте: карточка встаёт в конец колонки.
    let position = 0;
    try {
      const column = await ctx.api.get<any[]>('/dev-tracker', { status: target });
      position = (Array.isArray(column) ? column : []).reduce((m, c) => Math.max(m, Number(c.position) || 0), -1) + 1;
    } catch (err) { throw apiErr(err); }
    try { await ctx.api.patch(`/dev-tracker/${e.id}/move`, { status: target, position }); } catch (err) { throw apiErr(err); }
    return {
      summary: `🧩 «${old.title}»: ${DEV_COLUMN_RU[old.status] || old.status} → ${DEV_COLUMN_RU[target]}`,
      undo: [{ method: 'PATCH', path: `/dev-tracker/${e.id}/move`, body: { status: old.status, position: Number(old.position) || 0 } }],
    };
  },
};

export const assignDevCard: ToolDef<{ card: string; assignee?: string; unassign?: boolean }> = {
  name: 'assign_dev_card',
  kind: 'write',
  description:
    'Назначить исполнителя карточки доски «Разработка»: «поставь карточку про оплату на Фируза», «передай Алишеру». '
    + 'Снять исполнителя — unassign=true («сними исполнителя»). Укажи ровно одно: assignee ИЛИ unassign.',
  parameters: {
    type: 'object',
    properties: {
      card: { type: 'string', description: 'Метка D…' },
      assignee: { type: 'string', description: 'Метка исполнителя E… (из dev_team).' },
      unassign: { type: 'boolean', description: 'true — снять исполнителя.' },
    },
    required: ['card'],
    additionalProperties: false,
  },
  available: canManage,
  confirm: () => true,
  async preview(args, ctx) {
    const e = cardEntry(ctx, args.card);
    const target = assignTarget(args, ctx);
    return target
      ? `👤 НАЗНАЧИТЬ ИСПОЛНИТЕЛЯ\nКарточка «${e.label}» → ${target.label}`
      : `👤 СНЯТЬ ИСПОЛНИТЕЛЯ\nКарточка «${e.label}» останется без исполнителя`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = cardEntry(ctx, args.card);
    const target = assignTarget(args, ctx);
    const old = await loadCard(ctx, e.id);
    const oldId: string | null = old.assignee?.id ?? old.assigneeId ?? null;
    if ((target?.id ?? null) === oldId) throw new ToolError(target ? `Карточка «${old.title}» уже на ${target.label}.` : `У карточки «${old.title}» и так нет исполнителя.`);
    try { await ctx.api.patch(`/dev-tracker/${e.id}`, { assigneeId: target?.id ?? null }); } catch (err) { throw apiErr(err); }
    return {
      summary: target ? `👤 «${old.title}»: исполнитель ${target.label}` : `👤 «${old.title}»: исполнитель снят`,
      undo: [{ method: 'PATCH', path: `/dev-tracker/${e.id}`, body: { assigneeId: oldId } }],
    };
  },
};

function assignTarget(args: { assignee?: string; unassign?: boolean }, ctx: ToolContext) {
  if (args.assignee && args.unassign) throw new ToolError('Нужно одно из двух: назначить исполнителя или снять его.');
  if (args.unassign) return null;
  if (!args.assignee) throw new ToolError('Не понял, кого назначить. Назовите исполнителя или скажите «снять исполнителя».');
  return personEntry(ctx, args.assignee);
}

interface UpdateCardArgs {
  card: string; title?: string; description?: string; priority?: string; type?: string; deadline?: string;
  clear_deadline?: boolean; blocked?: boolean; blocked_reason?: string; project?: string;
}

export const updateDevCard: ToolDef<UpdateCardArgs> = {
  name: 'update_dev_card',
  kind: 'write',
  description:
    'Изменить карточку доски «Разработка»: название, описание, приоритет, тип, срок («срок пятница»), блокировка '
    + '(«заблокируй: ждём доступы»), проект. НЕ двигает по колонкам (move_dev_card), НЕ меняет исполнителя (assign_dev_card).',
  parameters: {
    type: 'object',
    properties: {
      card: { type: 'string', description: 'Метка D…' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: Object.keys(PRIORITY_RU) },
      type: { type: 'string', enum: Object.keys(TYPE_RU) },
      deadline: { type: 'string', description: 'Новый срок ГГГГ-ММ-ДД.' },
      clear_deadline: { type: 'boolean', description: 'true — убрать срок.' },
      blocked: { type: 'boolean', description: 'true — заблокировать, false — снять блокировку.' },
      blocked_reason: { type: 'string', description: 'Причина блокировки.' },
      project: { type: 'string', description: 'Метка проекта P…' },
    },
    required: ['card'],
    additionalProperties: false,
  },
  available: canManage,
  async run(args, ctx): Promise<WriteOutcome> {
    const e = cardEntry(ctx, args.card);
    const old = await loadCard(ctx, e.id);
    const patch: Record<string, any> = {};
    const undo: Record<string, any> = {};
    const parts: string[] = [];
    if (args.title !== undefined) { patch.title = titleOf(args.title); undo.title = old.title; parts.push(`название → «${patch.title}»`); }
    if (args.description !== undefined) {
      patch.description = String(args.description).trim().slice(0, 10000);
      undo.description = old.description ?? '';
      parts.push('описание обновлено');
    }
    if (args.priority) { patch.priority = priorityOf(args.priority); undo.priority = old.priority; parts.push(`приоритет → ${PRIORITY_RU[patch.priority]}`); }
    if (args.type) { patch.taskType = typeOf(args.type); undo.taskType = old.taskType; parts.push(`тип → ${TYPE_RU[patch.taskType]}`); }
    if (args.deadline && args.clear_deadline) throw new ToolError('Нужно одно из двух: новый срок или убрать срок.');
    if (args.deadline) { patch.deadline = checkDate(args.deadline, 'дата срока'); undo.deadline = old.deadline ?? null; parts.push(`срок → ${fmtDateRu(patch.deadline)}`); }
    if (args.clear_deadline) { patch.deadline = null; undo.deadline = old.deadline ?? null; parts.push('срок убран'); }
    if (args.blocked !== undefined) {
      patch.isBlocked = !!args.blocked;
      undo.isBlocked = !!old.isBlocked;
      if (args.blocked) {
        const reason = String(args.blocked_reason ?? '').trim().slice(0, 500);
        if (reason) { patch.blockedReason = reason; undo.blockedReason = old.blockedReason ?? null; }
        parts.push(reason ? `заблокирована: ${reason}` : 'заблокирована');
      } else {
        patch.blockedReason = null;
        undo.blockedReason = old.blockedReason ?? null;
        parts.push('блокировка снята');
      }
    }
    if (args.project) { const p = projectEntry(ctx, args.project); patch.projectId = p.id; undo.projectId = old.projectId ?? null; parts.push(`проект → ${p.label}`); }
    if (!parts.length) throw new ToolError('Не понял, что изменить в карточке.');
    try { await ctx.api.patch(`/dev-tracker/${e.id}`, patch); } catch (err) { throw apiErr(err); }
    return {
      summary: `🧩 «${old.title}»: ${parts.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/dev-tracker/${e.id}`, body: undo }],
    };
  },
};

export const commentDevCard: ToolDef<{ card: string; text: string }> = {
  name: 'comment_dev_card',
  kind: 'write',
  description:
    'Написать комментарий в карточке доски «Разработка»: «напиши в карточке про оплату: ждём ключи от банка». '
    + 'Текст — как сказал человек. Исполнитель и автор карточки получат уведомление. НЕ для задач производства (comment_task).',
  parameters: {
    type: 'object',
    properties: {
      card: { type: 'string', description: 'Метка D…' },
      text: { type: 'string', description: 'Текст комментария дословно.' },
    },
    required: ['card', 'text'],
    additionalProperties: false,
  },
  available: canView,
  async run(args, ctx): Promise<WriteOutcome> {
    const e = cardEntry(ctx, args.card);
    const text = String(args.text ?? '').trim();
    if (!text) throw new ToolError('Не понял текст комментария.');
    if (text.length > 5000) throw new ToolError('Комментарий длиннее 5000 знаков.');
    try { await ctx.api.post(`/dev-tracker/${e.id}/comments`, { text }); } catch (err) { throw apiErr(err); }
    return { summary: `💬 Комментарий в «${e.label}»: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}` };
  },
};

export const deleteDevCard: ToolDef<{ card: string }> = {
  name: 'delete_dev_card',
  kind: 'write',
  description: 'Удалить карточку с доски «Разработка» — только если прямо сказали «удали карточку». Не путать с «готово» (move_dev_card).',
  parameters: {
    type: 'object',
    properties: { card: { type: 'string', description: 'Метка D…' } },
    required: ['card'],
    additionalProperties: false,
  },
  available: canManage,
  confirm: () => true,
  async preview(args, ctx) {
    const e = cardEntry(ctx, args.card);
    const c = await loadCard(ctx, e.id);
    const who = c.assignee?.name ? `, исполнитель ${c.assignee.name}` : '';
    const subs = Number(c.subtasksCount) ? `\nПодзадач: ${c.subtasksCount}` : '';
    return `🗑 УДАЛИТЬ КАРТОЧКУ\n«${c.title}» (${DEV_COLUMN_RU[c.status] || c.status}${who})${subs}\nВернуть будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = cardEntry(ctx, args.card);
    try { await ctx.api.delete(`/dev-tracker/${e.id}`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Карточка «${e.label}» удалена` };
  },
};

// ─── Этап проекта ────────────────────────────────────────────────────────

export const setDevProjectStage: ToolDef<{ project: string; stage: number }> = {
  name: 'set_dev_project_stage',
  kind: 'write',
  description:
    'Сменить ЭТАП проекта разработки (не колонку карточки): 1 Сбор требований и ТЗ, 2 Проектирование и концепт, '
    + '3 Активная фаза производства, 4 Внутренняя приёмка и QA, 5 Демонстрация и согласование, 6 Внедрение и передача. '
    + '«Переведи проект Архидея на этап приёмки» → 4. Карточки доски этим не двигаются.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P… (из dev_projects).' },
      stage: { type: 'integer', minimum: 1, maximum: 6 },
    },
    required: ['project', 'stage'],
    additionalProperties: false,
  },
  available: canSetStage,
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    const stage = DEV_PROJECT_STAGES.find((s) => s.num === Number(args.stage));
    if (!stage) throw new ToolError('Этап проекта — число от 1 до 6.');
    let project: any;
    try { project = await ctx.api.get(`/projects/${p.id}`); } catch (err) { throw apiErr(err); }
    const oldNum = project?.devStage == null ? null : Number(project.devStage);
    if (oldNum === stage.num) throw new ToolError(`Проект «${p.label}» уже на этапе ${stage.num}.`);
    try { await ctx.api.patch(`/projects/${p.id}/dev-stage`, { devStage: stage.num }); } catch (err) { throw apiErr(err); }
    return {
      summary: `🧩 «${p.label}»: этап → ${stage.num}. ${stage.label} (${stage.pct}%)`,
      // У проекта без этапа вернуть «пусто» API не умеет — отмену даём только когда этап был.
      undo: oldNum ? [{ method: 'PATCH', path: `/projects/${p.id}/dev-stage`, body: { devStage: oldNum } }] : undefined,
    };
  },
};

export const DEV_TOOLS: ToolDef[] = [
  findDevCards, devCardDetails, devProjects, devTeam,
  createDevCard, moveDevCard, assignDevCard, updateDevCard, commentDevCard, deleteDevCard, setDevProjectStage,
];
