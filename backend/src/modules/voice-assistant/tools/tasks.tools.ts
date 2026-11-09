import { hasGrant } from '../../auth/permissions';
import { TASK_CLOSED_FOR_OVERDUE } from '../../tasks/task.entity';
import { ApiError } from '../internal-api';
import {
  addDays, checkDate, checkTime, dushanbeISO, fmtDateRu, fmtDeadline, matchScore,
  seesAllTasks, splitDushanbe,
} from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/** Метка в описании: по ней ночная проверка просрочки находит задачи,
 *  выданные голосом (VoiceTaskService.notifyOverdueVoiceTasks). */
export const VOICE_MARK = 'Создано голосом в Telegram.';

export const STATUS_RU: Record<string, string> = {
  new: 'Новая', in_progress: 'В работе', done: 'Готово', cancelled: 'Отмена',
};

const OPEN = ['new', 'in_progress'];

function isOverdue(t: any, now = Date.now()): boolean {
  if (!t?.deadline) return false;
  if ((TASK_CLOSED_FOR_OVERDUE as readonly string[]).includes(t.status)) return false;
  return new Date(t.deadline).getTime() < now;
}

function assigneeNames(t: any): string[] {
  const chain = Array.isArray(t.assignees) ? [...t.assignees].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  const names = chain.map((a: any) => a?.user?.name).filter(Boolean);
  if (names.length) return names;
  return t.assignee?.name ? [t.assignee.name] : [];
}

/** Задача → короткая запись для ИИ. Регистрирует метки задачи и людей. */
export function compactTask(ctx: ToolContext, t: any): Record<string, any> {
  const ref = ctx.refs.add('T', t.id, t.title);
  if (t.assignee?.id && t.assignee?.name) ctx.refs.add('E', t.assignee.id, t.assignee.name);
  for (const a of t.assignees || []) if (a?.user?.id && a.user.name) ctx.refs.add('E', a.user.id, a.user.name);
  if (t.project?.id && t.project?.name) ctx.refs.add('P', t.project.id, t.project.name);
  const out: Record<string, any> = {
    ref,
    title: t.title,
    status: STATUS_RU[t.status] || t.status,
    deadline: fmtDeadline(t.deadline),
  };
  if (isOverdue(t)) out.overdue = true;
  if (t.project?.name) out.project = t.project.name;
  const who = assigneeNames(t);
  if (who.length) out.assignees = who;
  if (t.createdBy?.name && t.createdBy?.id !== ctx.user.id) out.from = t.createdBy.name;
  if (t.kind === 'meeting') out.kind = 'встреча';
  if (t.scope === 'personal') out.personal = true;
  return out;
}

function taskEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('T', ref);
  if (!e) throw new ToolError(`Нет задачи с меткой «${ref}». Сначала найдите её через find_tasks.`);
  return e;
}

async function loadTask(ctx: ToolContext, id: string): Promise<any> {
  try {
    return await ctx.api.get(`/tasks/${id}`);
  } catch (e: any) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      throw new ToolError('Эта задача недоступна или уже удалена.');
    }
    throw e;
  }
}

function weekBounds(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 — воскресенье
  const back = (dow + 6) % 7;
  const from = addDays(today, -back);
  return { from, to: addDays(from, 6) };
}

// ─── Чтение ─────────────────────────────────────────────────────────────

interface FindArgs {
  who?: string;
  project?: string;
  status?: 'open' | 'new' | 'in_progress' | 'done' | 'cancelled' | 'any';
  when?: 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'overdue' | 'any';
  date_from?: string;
  date_to?: string;
  text?: string;
  limit?: number;
}

export const findTasks: ToolDef<FindArgs> = {
  name: 'find_tasks',
  kind: 'read',
  description:
    'Найти задачи и встречи: мои, конкретного сотрудника, по проекту, просроченные, на дату, по словам из названия. '
    + 'Используй для вопросов («какие задачи у Сабрины», «что у меня на завтра», «что просрочено») '
    + 'и чтобы найти задачу перед действием, если её нет в контексте. Возвращает метки T… для действий.',
  parameters: {
    type: 'object',
    properties: {
      who: { type: 'string', description: '"me" — мои (по умолчанию); метка сотрудника E…; "all" — все задачи компании (только руководству).' },
      project: { type: 'string', description: 'Метка проекта P…' },
      status: { type: 'string', enum: ['open', 'new', 'in_progress', 'done', 'cancelled', 'any'], description: 'open — новые и в работе (по умолчанию).' },
      when: { type: 'string', enum: ['today', 'tomorrow', 'this_week', 'next_week', 'overdue', 'any'], description: 'Срок задачи.' },
      date_from: { type: 'string', description: 'Срок не раньше, ГГГГ-ММ-ДД.' },
      date_to: { type: 'string', description: 'Срок не позже, ГГГГ-ММ-ДД.' },
      text: { type: 'string', description: 'Слова из названия задачи.' },
      limit: { type: 'integer', description: 'Сколько показать, до 50. По умолчанию 25.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const who = String(args.who || 'me').trim();
    const status = args.status || (args.when === 'overdue' ? 'open' : 'open');
    let list: any[];
    let scopeNote = '';

    if (who === 'me' || who === '') {
      list = await ctx.api.get<any[]>('/tasks/my');
    } else if (who.toLowerCase() === 'all') {
      if (!seesAllTasks(ctx.user)) throw new ToolError('Задачи всей компании на сайте видит только руководство и менеджеры продаж.');
      if (args.when === 'overdue' && hasGrant(ctx.user as any, 'tasks.overdue.view')) {
        list = await ctx.api.get<any[]>('/tasks/overdue');
      } else {
        const project = args.project ? ctx.refs.resolve('P', args.project) : null;
        list = await ctx.api.get<any[]>('/tasks', project ? { projectId: project.id } : undefined);
      }
    } else {
      const emp = ctx.refs.resolve('E', who);
      if (!emp) throw new ToolError(`Нет сотрудника с меткой «${who}». Найдите его через find_employees.`);
      if (emp.id === ctx.user.id) {
        list = await ctx.api.get<any[]>('/tasks/my');
      } else {
        if (!seesAllTasks(ctx.user)) {
          throw new ToolError('Задачи других сотрудников на сайте видит только руководство и менеджеры продаж — у вас такого доступа нет.');
        }
        list = await ctx.api.get<any[]>('/tasks', { assigneeId: emp.id });
        scopeNote = `Задачи сотрудника: ${emp.label}`;
      }
    }
    if (!Array.isArray(list)) list = [];

    const project = args.project ? ctx.refs.resolve('P', args.project) : null;
    if (args.project && !project) throw new ToolError(`Нет проекта с меткой «${args.project}».`);
    if (project) list = list.filter((t) => t.projectId === project.id || t.project?.id === project.id);

    if (status === 'open') list = list.filter((t) => OPEN.includes(t.status));
    else if (status !== 'any') list = list.filter((t) => t.status === status);

    const today = ctx.today;
    let from: string | null = args.date_from ? checkDate(args.date_from) : null;
    let to: string | null = args.date_to ? checkDate(args.date_to) : null;
    if (args.when === 'today') { from = today; to = today; }
    if (args.when === 'tomorrow') { from = addDays(today, 1); to = from; }
    if (args.when === 'this_week') ({ from, to } = weekBounds(today));
    if (args.when === 'next_week') { const w = weekBounds(addDays(today, 7)); from = w.from; to = w.to; }
    if (args.when === 'overdue') list = list.filter((t) => isOverdue(t));
    if (from || to) {
      list = list.filter((t) => {
        const d = splitDushanbe(t.deadline)?.date;
        if (!d) return false;
        return (!from || d >= from) && (!to || d <= to);
      });
    }

    if (args.text && String(args.text).trim()) {
      const scored = list
        .map((t) => ({ t, s: matchScore(t.title, String(args.text)) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s);
      list = scored.map((x) => x.t);
    } else {
      list.sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime());
    }

    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 50);
    return {
      ...(scopeNote ? { note: scopeNote } : {}),
      total: list.length,
      shown: Math.min(list.length, limit),
      tasks: list.slice(0, limit).map((t) => compactTask(ctx, t)),
    };
  },
};

export const taskDetails: ToolDef<{ task: string }> = {
  name: 'task_details',
  kind: 'read',
  description: 'Подробности задачи: описание, исполнители по очереди, кто поставил, последние комментарии.',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string', description: 'Метка задачи T…' } },
    required: ['task'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const e = taskEntry(ctx, args.task);
    const t = await loadTask(ctx, e.id);
    const chain = (t.assignees || [])
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .map((a: any) => ({ name: a.user?.name, done: !!a.isDone }));
    const comments = (t.comments || [])
      .slice(-3)
      .map((c: any) => ({ who: c.author?.name || c.user?.name || '', text: String(c.message || '').slice(0, 200) }));
    return {
      ...compactTask(ctx, t),
      description: String(t.description || '').slice(0, 500),
      chain: chain.length > 1 ? chain : undefined,
      createdBy: t.createdBy?.name,
      comments: comments.length ? comments : undefined,
    };
  },
};

// ─── Запись ─────────────────────────────────────────────────────────────

export const setTaskStatus: ToolDef<{ task: string; status: string; note?: string }> = {
  name: 'set_task_status',
  kind: 'write',
  description:
    'Сменить статус задачи: «начать работу над задачей / взять в работу» → in_progress, '
    + '«готово / сделал / выполнил / закрой» → done, «отмени задачу» → cancelled, «верни в новые» → new. '
    + 'Если задача с очередью исполнителей — «готово» отмечает вашу часть.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Метка задачи T…' },
      status: { type: 'string', enum: ['new', 'in_progress', 'done', 'cancelled'] },
      note: { type: 'string', description: 'Необязательная заметка при сдаче своей части.' },
    },
    required: ['task', 'status'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = taskEntry(ctx, args.task);
    const status = String(args.status);
    if (!STATUS_RU[status]) throw new ToolError(`Неизвестный статус «${status}».`);
    const t = await loadTask(ctx, e.id);
    const title = t.title || e.label;

    // Очередь исполнителей: «готово» = моя часть, как кнопка на сайте.
    const chain = [...(t.assignees || [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const myStep = chain.find((a: any) => a.userId === ctx.user.id && !a.isDone);
    if (status === 'done' && chain.length > 1 && myStep && t.status !== 'done') {
      try {
        const res: any = await ctx.api.post(`/tasks/${e.id}/my-part-done`, args.note ? { note: args.note } : {});
        const next = chain.find((a: any) => !a.isDone && a.userId !== ctx.user.id);
        return {
          summary: res?.allDone
            ? `✅ «${title}» — ваша часть сдана, задача завершена`
            : `✅ «${title}» — ваша часть сдана${next?.user?.name ? `, дальше ${next.user.name}` : ''}`,
        };
      } catch (err: any) {
        throw asToolError(err, e.id);
      }
    }

    if (t.status === status) {
      return { summary: `ℹ️ «${title}» уже в статусе «${STATUS_RU[status]}»` };
    }
    try {
      await ctx.api.patch(`/tasks/${e.id}`, { status });
    } catch (err: any) {
      throw asToolError(err, e.id);
    }
    return {
      summary: `${status === 'done' ? '✅' : status === 'cancelled' ? '✖️' : '▶️'} «${title}» → ${STATUS_RU[status]}`,
      undo: [{ method: 'PATCH', path: `/tasks/${e.id}`, body: { status: t.status } }],
    };
  },
};

/** Ошибка API → понятная ошибка; про результат — с кнопкой приложить файл. */
function asToolError(err: any, taskId: string): Error {
  if (err instanceof ApiError) {
    if (/результат/i.test(err.message)) {
      return new ToolError(
        `${err.message} Нажмите «📎 Приложить результат» и пришлите файл — потом задачу можно закрыть.`,
        [[{ text: '📎 Приложить результат', callback_data: `w:res:${taskId}` }]],
      );
    }
    return new ToolError(err.message);
  }
  return err;
}

interface CreateArgs {
  title: string;
  assignees?: string[];
  date?: string;
  time?: string;
  project?: string;
  description?: string;
  kind?: 'task' | 'meeting';
  location?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

function resolveAssignees(ctx: ToolContext, refs: string[] | undefined): { ids: string[]; names: string[] } {
  const list = (refs || []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length || (list.length === 1 && list[0].toLowerCase() === 'me')) {
    return { ids: [ctx.user.id], names: [] };
  }
  const ids: string[] = [];
  const names: string[] = [];
  for (const r of list) {
    if (r.toLowerCase() === 'me') { ids.push(ctx.user.id); continue; }
    const emp = ctx.refs.resolve('E', r);
    if (!emp) throw new ToolError(`Нет сотрудника с меткой «${r}». Найдите его через find_employees.`);
    if (!ids.includes(emp.id)) { ids.push(emp.id); if (emp.id !== ctx.user.id) names.push(emp.label); }
  }
  return { ids, names };
}

export const createTask: ToolDef<CreateArgs> = {
  name: 'create_task',
  kind: 'write',
  description:
    'Создать задачу или встречу. Себе — «добавь мне задачу…», «напомни…»; другому — «поставь Фирузу…», '
    + '«пусть Сабрина сделает…». Если срок не назван — сегодня. Встреча — kind=meeting.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Суть задачи как сказано, 2–8 слов, с большой буквы и с глаголом («Сделать три сторис», «Позвонить клиенту Сеченак»). Без имени исполнителя, без «добавь задачу»; проект — в поле project.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Метки E… исполнителей по порядку. Пусто или ["me"] — себе.' },
      date: { type: 'string', description: 'Срок, ГГГГ-ММ-ДД. По умолчанию сегодня.' },
      time: { type: 'string', description: 'Время ЧЧ:ММ, если названо.' },
      project: { type: 'string', description: 'Метка проекта P…, если назван.' },
      description: { type: 'string', description: 'Подробности, если сказаны.' },
      kind: { type: 'string', enum: ['task', 'meeting'] },
      location: { type: 'string', description: 'Место встречи.' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Только если сказано «срочно/важно» (high/critical).' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  confirm(args, ctx) {
    return resolveAssignees(ctx, args.assignees).ids.some((id) => id !== ctx.user.id);
  },
  async preview(args, ctx) {
    const { names } = resolveAssignees(ctx, args.assignees);
    const date = args.date ? checkDate(args.date) : ctx.today;
    const time = args.time ? checkTime(args.time) : null;
    const project = args.project ? ctx.refs.resolve('P', args.project) : null;
    return `📋 ${args.kind === 'meeting' ? 'Встреча' : 'Задача'}: «${String(args.title).trim()}»`
      + `\n👤 ${names.length ? names.join(' → ') : 'вы'}`
      + `\n📅 ${fmtDateRu(date)}${time ? `, ${time}` : ''}`
      + (project ? `\n📁 ${project.label}` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const title = String(args.title || '').trim();
    if (!title) throw new ToolError('Не понял, как назвать задачу.');
    const { ids, names } = resolveAssignees(ctx, args.assignees);
    const date = args.date ? checkDate(args.date) : ctx.today;
    const time = args.time ? checkTime(args.time) : null;
    if (date < ctx.today) throw new ToolError(`Срок ${fmtDateRu(date)} уже прошёл. Назовите дату в будущем.`);
    const project = args.project ? ctx.refs.resolve('P', args.project) : null;
    if (args.project && !project) throw new ToolError(`Нет проекта с меткой «${args.project}».`);
    const forOthers = ids.some((id) => id !== ctx.user.id);

    const body: Record<string, any> = {
      title: title.slice(0, 200),
      description: `${VOICE_MARK}\n\nСказано: «${ctx.utterance}»${args.description ? `\n\n${args.description}` : ''}`,
      assigneeIds: ids,
      deadline: dushanbeISO(date, time || '23:59'),
      // Себе без проекта — личная заметка (как раньше в голосовых); с
      // проектом или другому — рабочая задача, иначе исполнитель её не увидит.
      scope: !forOthers && !project ? 'personal' : 'business',
    };
    if (project) body.projectId = project.id;
    if (args.kind === 'meeting') body.kind = 'meeting';
    if (args.location) body.location = String(args.location).slice(0, 200);
    if (args.priority) body.priority = args.priority;

    let created: any;
    try {
      created = await ctx.api.post('/tasks', body);
    } catch (err: any) {
      throw err instanceof ApiError ? new ToolError(err.message) : err;
    }
    // Сайт молча ставит задачу себе, если поручать другим нельзя.
    const realAssignee = created?.assignee?.id || created?.assigneeId;
    const forcedToSelf = forOthers && realAssignee === ctx.user.id && !ids.includes(ctx.user.id);
    if (created?.id) ctx.refs.add('T', created.id, title);
    return {
      summary: `📋 ${args.kind === 'meeting' ? 'Встреча' : 'Задача'} «${title}» — `
        + `${forcedToSelf ? 'вам (поручать другим вам нельзя)' : names.length ? names.join(' → ') : 'вам'}`
        + `, срок ${fmtDateRu(date)}${time ? ` ${time}` : ''}`,
      undo: created?.id
        ? [{ method: 'DELETE', path: `/tasks/${created.id}`, body: { reason: 'Отменено в Telegram сразу после создания' } }]
        : undefined,
    };
  },
};

interface UpdateArgs { task: string; date?: string; time?: string; title?: string; assignees?: string[] }

export const updateTask: ToolDef<UpdateArgs> = {
  name: 'update_task',
  kind: 'write',
  description: 'Изменить задачу: перенести срок («перенеси на пятницу»), переименовать, сменить исполнителей.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Метка задачи T…' },
      date: { type: 'string', description: 'Новый срок, ГГГГ-ММ-ДД.' },
      time: { type: 'string', description: 'Новое время ЧЧ:ММ.' },
      title: { type: 'string', description: 'Новое название.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Новый список исполнителей (метки E… или "me").' },
    },
    required: ['task'],
    additionalProperties: false,
  },
  confirm(args, ctx) {
    return Array.isArray(args.assignees) && args.assignees.length > 0
      && resolveAssignees(ctx, args.assignees).ids.some((id) => id !== ctx.user.id);
  },
  async preview(args, ctx) {
    const e = taskEntry(ctx, args.task);
    const { names } = resolveAssignees(ctx, args.assignees);
    return `✏️ Задача «${e.label}»\n👤 Исполнители: ${names.length ? names.join(' → ') : 'вы'}`
      + (args.date ? `\n📅 Срок: ${fmtDateRu(checkDate(args.date))}${args.time ? `, ${checkTime(args.time)}` : ''}` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = taskEntry(ctx, args.task);
    const t = await loadTask(ctx, e.id);
    const patch: Record<string, any> = {};
    const undo: Record<string, any> = {};
    const parts: string[] = [];

    if (args.date || args.time) {
      const old = splitDushanbe(t.deadline);
      const date = args.date ? checkDate(args.date) : old?.date || ctx.today;
      const time = args.time ? checkTime(args.time) : old?.time || '23:59';
      if (date < ctx.today) throw new ToolError(`Дата ${fmtDateRu(date)} уже прошла.`);
      patch.deadline = dushanbeISO(date, time);
      undo.deadline = t.deadline;
      parts.push(`срок → ${fmtDateRu(date)}${time !== '23:59' ? ` ${time}` : ''}`);
    }
    if (args.title && String(args.title).trim() && String(args.title).trim() !== t.title) {
      patch.title = String(args.title).trim().slice(0, 200);
      undo.title = t.title;
      parts.push(`название → «${patch.title}»`);
    }
    if (Array.isArray(args.assignees) && args.assignees.length) {
      const { ids, names } = resolveAssignees(ctx, args.assignees);
      patch.assigneeIds = ids;
      const oldIds = (t.assignees?.length
        ? [...t.assignees].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((a: any) => a.userId)
        : [t.assigneeId]).filter(Boolean);
      if (oldIds.length) undo.assigneeIds = oldIds;
      parts.push(`исполнители → ${names.length ? names.join(' → ') : 'вы'}`);
    }
    if (!Object.keys(patch).length) throw new ToolError('Не понял, что изменить в задаче.');

    try {
      await ctx.api.patch(`/tasks/${e.id}`, patch);
    } catch (err: any) {
      throw asToolError(err, e.id);
    }
    if (patch.title) ctx.refs.add('T', e.id, patch.title);
    return {
      summary: `✏️ «${t.title}»: ${parts.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/tasks/${e.id}`, body: undo }],
    };
  },
};

export const commentTask: ToolDef<{ task: string; text: string }> = {
  name: 'comment_task',
  kind: 'write',
  description: 'Написать комментарий в задачу: «напиши в задаче…», «оставь комментарий…».',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Метка задачи T…' },
      text: { type: 'string', description: 'Текст комментария, как сказано.' },
    },
    required: ['task', 'text'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = taskEntry(ctx, args.task);
    const text = String(args.text || '').trim();
    if (!text) throw new ToolError('Пустой комментарий.');
    let c: any;
    try {
      c = await ctx.api.post(`/tasks/${e.id}/comments`, { message: text.slice(0, 4000) });
    } catch (err: any) {
      throw asToolError(err, e.id);
    }
    return {
      summary: `💬 Комментарий в «${e.label}»: «${text.length > 120 ? `${text.slice(0, 117)}…` : text}»`,
      undo: c?.id ? [{ method: 'DELETE', path: `/tasks/${e.id}/comments/${c.id}` }] : undefined,
    };
  },
};

export const approveTask: ToolDef<{ task: string }> = {
  name: 'approve_task',
  kind: 'write',
  description: 'Принять результат задачи (руководство): «прими задачу», «одобряю».',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string', description: 'Метка задачи T…' } },
    required: ['task'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'tasks.approve'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = taskEntry(ctx, args.task);
    const t = await loadTask(ctx, e.id);
    try {
      await ctx.api.post(`/tasks/${e.id}/approve`);
    } catch (err: any) {
      throw asToolError(err, e.id);
    }
    return {
      summary: `✅ «${t.title}» принята`,
      undo: [{ method: 'PATCH', path: `/tasks/${e.id}`, body: { status: t.status } }],
    };
  },
};

export const returnTask: ToolDef<{ task: string; reason: string }> = {
  name: 'return_task',
  kind: 'write',
  description: 'Вернуть задачу на доработку (руководство) с причиной.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Метка задачи T…' },
      reason: { type: 'string', description: 'Что доработать.' },
    },
    required: ['task', 'reason'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'tasks.return'),
  // Возврат сразу уходит исполнителю уведомлением — отменить его нельзя.
  confirm: () => true,
  async preview(args, ctx) {
    const e = taskEntry(ctx, args.task);
    return `↩️ Вернуть на доработку «${e.label}»\n📝 ${String(args.reason || 'Требует доработки')}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = taskEntry(ctx, args.task);
    try {
      await ctx.api.post(`/tasks/${e.id}/return`, { reason: String(args.reason || 'Требует доработки').slice(0, 1000) });
    } catch (err: any) {
      throw asToolError(err, e.id);
    }
    return { summary: `↩️ «${e.label}» возвращена на доработку` };
  },
};

export const deleteTask: ToolDef<{ task: string; reason?: string }> = {
  name: 'delete_task',
  kind: 'write',
  description: 'Удалить задачу совсем. Только если прямо сказано «удали задачу». «Отмени задачу» — это статус cancelled.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Метка задачи T…' },
      reason: { type: 'string', description: 'Причина удаления — только если человек её назвал. Не выдумывай.' },
    },
    required: ['task'],
    additionalProperties: false,
  },
  confirm: () => true,
  async preview(args, ctx) {
    const e = taskEntry(ctx, args.task);
    return `🗑 Удалить задачу «${e.label}»?${args.reason ? `\n📝 ${args.reason}` : ''}\nВернуть её будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = taskEntry(ctx, args.task);
    try {
      await ctx.api.delete(`/tasks/${e.id}`, { reason: String(args.reason || 'Удалено голосом в Telegram').slice(0, 500) });
    } catch (err: any) {
      throw asToolError(err, e.id);
    }
    return { summary: `🗑 Задача «${e.label}» удалена` };
  },
};

export const TASK_TOOLS: ToolDef[] = [
  findTasks, taskDetails, setTaskStatus, createTask, updateTask, commentTask, approveTask, returnTask, deleteTask,
];
