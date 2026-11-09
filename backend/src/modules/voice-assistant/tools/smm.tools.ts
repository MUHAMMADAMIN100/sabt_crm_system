import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { addDays, checkDate, checkTime, fmtDateRu, matchScore, roles, splitDushanbe } from './common';

/** День по Душанбе из даты API (строка YYYY-MM-DD или ISO в UTC). */
const dayOf = (v: unknown): string | null => {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return splitDushanbe(s)?.date ?? null;
};
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * СММ: сторис, контент-план («Умный календарь»), карточки подготовки
 * (съёмка/монтаж/дизайн) у исполнителей, отчёт за день.
 * Права — как у кнопок на сайте; сервер всё равно проверит сам.
 */

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const hasRole = (u: any, list: string[]) => roles(u).some((r) => list.includes(r));

const CALENDAR_ROLES = ['admin', 'founder', 'smm_director', 'smm_specialist', 'sales_manager_smm', 'sales_manager_dev'];
const CONTENT_EDIT_ROLES = ['admin', 'founder', 'smm_director', 'smm_specialist'];
const STORY_ROLES = ['admin', 'founder', 'smm_director', 'smm_specialist'];

const CONTENT_STATUS_RU: Record<string, string> = {
  planned: 'Запланировано', preparing: 'Подготовка', in_production: 'В производстве', on_review: 'На проверке',
  on_approval: 'На согласовании', approved: 'Утверждено', published: 'Опубликовано', cancelled: 'Отменено',
};
const STAGE_RU: Record<string, string> = { shoot: 'Съёмка', edit: 'Монтаж', design: 'Дизайн' };
const TYPE_RU: Record<string, string> = { reel: 'рилс', design: 'пост/дизайн', story: 'сторис' };

function itemEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('I', ref);
  if (!e) throw new ToolError(`Нет карточки с меткой «${ref}». Сначала найдите её через smm_plan или my_work.`);
  return e;
}

function projectEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('P', ref);
  if (!e) throw new ToolError(`Нет проекта с меткой «${ref}». Найдите его через list_projects.`);
  return e;
}

// ─── Контент-план ───────────────────────────────────────────────────────

interface PlanArgs { date_from?: string; date_to?: string; project?: string; mine_only?: boolean; text?: string }

export const smmPlan: ToolDef<PlanArgs> = {
  name: 'smm_plan',
  kind: 'read',
  description:
    'Контент-план / «Умный календарь»: публикации (рилсы, посты), съёмки и подготовка на даты. '
    + '«Что у меня сегодня по контент-плану», «когда съёмка Архидеи», «что выходит на этой неделе». Метки I…',
  parameters: {
    type: 'object',
    properties: {
      date_from: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      date_to: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию как date_from.' },
      project: { type: 'string', description: 'Метка проекта P…' },
      mine_only: { type: 'boolean', description: 'Только мои проекты (для СММ-специалиста по умолчанию да).' },
      text: { type: 'string', description: 'Слова из темы публикации.' },
    },
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CALENDAR_ROLES),
  async run(args, ctx) {
    const from = args.date_from ? checkDate(args.date_from) : ctx.today;
    const to = args.date_to ? checkDate(args.date_to) : from;
    if (to < from) throw new ToolError('Конец периода раньше начала.');
    const project = args.project ? projectEntry(ctx, args.project) : null;
    let res: any;
    try {
      res = await ctx.api.get('/content-plan/smm-calendar', { from, to, ...(project ? { projectId: project.id } : {}) });
    } catch (e) { throw apiErr(e); }
    const mineDefault = ctx.user.role === 'smm_specialist';
    const mineOnly = args.mine_only ?? mineDefault;
    const myProjects = new Set((res?.projects || []).filter((p: any) => p.mine).map((p: any) => p.id));
    let events: any[] = (res?.events || []).filter((e: any) => !mineOnly || myProjects.has(e.projectId));
    if (args.text && String(args.text).trim()) {
      events = events.filter((e) => matchScore(`${e.topic || ''} ${e.title || ''} ${e.projectName || ''}`, String(args.text)) >= 0.5);
    }
    events.sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
    return {
      period: from === to ? fmtDateRu(from) : `${fmtDateRu(from)} — ${fmtDateRu(to)}`,
      total: events.length,
      items: events.slice(0, 40).map((e) => {
        // У рилса есть своя карточка съёмки с тем же названием — в подписи
        // обязательно этап, иначе «перенёс Рилс X» непонятно, что именно.
        const label = e.kind === 'shoot'
          ? `${e.projectName}: ${STAGE_RU[e.prepStage] || 'Съёмка'} «${e.title || ''}»`
          : `${e.projectName}: ${TYPE_RU[e.contentType] || 'публикация'} «${e.topic || ''}»`;
        const out: Record<string, any> = {
          date: fmtDateRu(e.date), ...(e.time ? { time: e.time } : {}),
          project: e.projectName,
          what: e.kind === 'shoot'
            ? `${STAGE_RU[e.prepStage] || 'Съёмка'}: ${e.title || ''}`.trim()
            : `${TYPE_RU[e.contentType] || 'публикация'}: ${e.topic || ''}`.trim(),
        };
        if (e.status) out.status = CONTENT_STATUS_RU[e.status] || e.status;
        if (e.assigneeName) out.assignee = e.assigneeName;
        if (e.location) out.place = e.location;
        if (e.itemId) out.ref = ctx.refs.add('I', e.itemId, label);
        return out;
      }),
    };
  },
};

export const setContentStatus: ToolDef<{ item: string; status: 'published' | 'planned' | 'cancelled' }> = {
  name: 'set_content_status',
  kind: 'write',
  description: 'Отметить публикацию/карточку подготовки: «готово/опубликовано/снято» → published, «верни в план» → planned, «отмени» → cancelled.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка I…' },
      status: { type: 'string', enum: ['published', 'planned', 'cancelled'] },
    },
    required: ['item', 'status'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CONTENT_EDIT_ROLES),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = itemEntry(ctx, args.item);
    if (!['published', 'planned', 'cancelled'].includes(args.status)) throw new ToolError('Неизвестный статус.');
    let old: any;
    try { old = await ctx.api.get(`/content-plan/${e.id}`); } catch (err) { throw apiErr(err); }
    try { await ctx.api.patch(`/content-plan/smart-item/${e.id}`, { status: args.status }); } catch (err) { throw apiErr(err); }
    return {
      summary: `🎬 ${e.label} → ${CONTENT_STATUS_RU[args.status]}`,
      undo: old?.status ? [{ method: 'PATCH', path: `/content-plan/smart-item/${e.id}`, body: { status: old.status } }] : undefined,
    };
  },
};

export const moveContent: ToolDef<{ item: string; date: string; time?: string; place?: string }> = {
  name: 'move_content',
  kind: 'write',
  description: 'Перенести публикацию или съёмку на другой день/время («перенеси съёмку Архидеи на четверг в 11»), сменить место съёмки.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка I…' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      time: { type: 'string', description: 'ЧЧ:ММ' },
      place: { type: 'string', description: 'Место съёмки, если названо.' },
    },
    required: ['item', 'date'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CONTENT_EDIT_ROLES),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = itemEntry(ctx, args.item);
    const date = checkDate(args.date);
    if (date < ctx.today) throw new ToolError(`Дата ${fmtDateRu(date)} уже прошла.`);
    const time = args.time ? checkTime(args.time) : undefined;
    let old: any;
    try { old = await ctx.api.get(`/content-plan/${e.id}`); } catch (err) { throw apiErr(err); }
    const body: Record<string, any> = { publishDate: date, status: 'planned' };
    if (time) body.publishTime = time;
    if (args.place) body.shootPlace = String(args.place).slice(0, 300);
    try { await ctx.api.patch(`/content-plan/smart-item/${e.id}`, body); } catch (err) { throw apiErr(err); }
    // Дата приходит в UTC (полночь Душанбе = 19:00 накануне) — переводим, а не режем строку.
    const oldDate = old?.publishDate ? dayOf(old.publishDate) : null;
    const undoBody: Record<string, any> = { publishDate: oldDate, status: old?.status || 'planned' };
    if (time) undoBody.publishTime = old?.publishTime ?? null;
    if (args.place) undoBody.shootPlace = old?.shootPlace ?? null;
    return {
      summary: `📅 ${e.label} → ${fmtDateRu(date)}${time ? ` ${time}` : ''}${args.place ? `, ${args.place}` : ''}`,
      undo: [{ method: 'PATCH', path: `/content-plan/smart-item/${e.id}`, body: undoBody }],
    };
  },
};

// ─── Моя работа (видеограф, монтажёр, дизайнер) ────────────────────────

export const myWork: ToolDef<{ date_from?: string; date_to?: string }> = {
  name: 'my_work',
  kind: 'read',
  description: 'Мои карточки подготовки (съёмка, монтаж, дизайн) на даты — для видеографа, монтажёра, дизайнера. Метки I…',
  parameters: {
    type: 'object',
    properties: {
      date_from: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      date_to: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию +6 дней.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const from = args.date_from ? checkDate(args.date_from) : ctx.today;
    const to = args.date_to ? checkDate(args.date_to) : addDays(from, 6);
    let res: any;
    try { res = await ctx.api.get('/content-plan/my-work', { from, to }); } catch (e) { throw apiErr(e); }
    const items: any[] = res?.items || [];
    return {
      total: items.length,
      items: items.slice(0, 40).map((x) => {
        const label = `${x.projectName}: ${STAGE_RU[x.stage] || 'Подготовка'} «${x.parentTopic || x.topic || ''}»`;
        return {
          ref: ctx.refs.add('I', x.id, label),
          date: x.date ? fmtDateRu(x.date) : 'без даты', ...(x.time ? { time: x.time } : {}),
          project: x.projectName,
          what: `${STAGE_RU[x.stage] || 'Подготовка'}: ${x.parentTopic || x.topic || ''}`,
          done: x.status === 'published',
          ...(x.shoot && x.stage === 'edit' ? { shootDone: x.shoot.done } : {}),
        };
      }),
    };
  },
};

export const myWorkUpdate: ToolDef<{ item: string; done?: boolean; date?: string }> = {
  name: 'my_work_update',
  kind: 'write',
  description: 'Своя карточка подготовки: «снял», «смонтировал», «дизайн готов» → done=true; «не готово» → done=false; перенос на день — date.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка I…' },
      done: { type: 'boolean' },
      date: { type: 'string', description: 'Новая дата ГГГГ-ММ-ДД.' },
    },
    required: ['item'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = itemEntry(ctx, args.item);
    const body: Record<string, any> = {};
    if (typeof args.done === 'boolean') body.done = args.done;
    if (args.date) body.date = checkDate(args.date);
    if (!Object.keys(body).length) throw new ToolError('Не понял, что сделать с карточкой.');
    let before: any = null;
    if (body.date) {
      try { before = await ctx.api.get(`/content-plan/${e.id}`); } catch { /* без отмены даты */ }
    }
    try { await ctx.api.patch(`/content-plan/my-work/${e.id}`, body); } catch (err) { throw apiErr(err); }
    const undo: Record<string, any> = {};
    if (typeof args.done === 'boolean') undo.done = !args.done;
    if (body.date && before?.publishDate) undo.date = dayOf(before.publishDate);
    return {
      summary: `🎬 ${e.label}: ${typeof args.done === 'boolean' ? (args.done ? 'готово' : 'не готово') : ''}${body.date ? ` перенос на ${fmtDateRu(body.date)}` : ''}`.trim(),
      undo: Object.keys(undo).length ? [{ method: 'PATCH', path: `/content-plan/my-work/${e.id}`, body: undo }] : undefined,
    };
  },
};

// ─── Сторис ─────────────────────────────────────────────────────────────

export const storiesStatus: ToolDef<{ date?: string }> = {
  name: 'stories_status',
  kind: 'read',
  description: 'Сторис за день: по каким проектам выложено по норме, где меньше нормы, где ничего; кто выкладывал.',
  parameters: {
    type: 'object',
    properties: { date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' } },
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'stories.view'),
  async run(args, ctx) {
    const date = args.date ? checkDate(args.date) : ctx.today;
    let res: any;
    try { res = await ctx.api.get('/stories/check/day', { date }); } catch (e) { throw apiErr(e); }
    const ST: Record<string, string> = { done: 'по норме', partial: 'меньше нормы', none: 'ничего' };
    return {
      date: fmtDateRu(date),
      totals: res?.totals,
      projects: (res?.projects || []).map((p: any) => ({
        ref: ctx.refs.add('P', p.id, p.name),
        project: p.name,
        fact: `${p.actual}/${p.target}`,
        status: ST[p.status] || p.status,
        ...(p.posters?.length ? { posted: p.posters.map((x: any) => `${x.name} ${x.count}`) } : {}),
      })),
    };
  },
};

export const markStories: ToolDef<{ project: string; count?: number; fill_to_norm?: boolean; date?: string }> = {
  name: 'mark_stories',
  kind: 'write',
  description:
    'Отметить свои сторис по проекту за день. «Отметь сторис Архидеи / сторис по Архидее сделаны» → fill_to_norm=true '
    + '(дополнить до нормы дня). «Я выложил 3 сторис для Архидеи» → count=3 (сколько ВСЕГО вы выложили за день по проекту).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      count: { type: 'integer', description: 'Сколько всего сторис вы выложили за день по проекту (0–30).' },
      fill_to_norm: { type: 'boolean' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'stories.manage') && hasRole(u, STORY_ROLES),
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    const date = args.date ? checkDate(args.date) : ctx.today;
    if (date > ctx.today) throw new ToolError('Сторис за будущий день отметить нельзя.');
    let mine: any[] = [];
    try { mine = await ctx.api.get<any[]>('/stories/my', { from: date, to: date }); } catch (e) { throw apiErr(e); }
    const own = Number((mine || []).find((s: any) => s.projectId === p.id || s.project?.id === p.id)?.storiesCount) || 0;

    let next: number;
    if (typeof args.count === 'number') {
      next = Math.round(args.count);
    } else if (args.fill_to_norm !== false) {
      let day: any;
      try { day = await ctx.api.get('/stories/check/day', { date }); } catch (e) { throw apiErr(e); }
      const row = (day?.projects || []).find((x: any) => x.id === p.id);
      if (!row) throw new ToolError(`У проекта «${p.label}» нет нормы сторис на ${fmtDateRu(date)}.`);
      if (row.actual >= row.target) return { summary: `ℹ️ По «${p.label}» норма уже выполнена: ${row.actual}/${row.target}` };
      next = own + (row.target - row.actual);
    } else {
      throw new ToolError('Скажите, сколько сторис выложено.');
    }
    if (next < 0 || next > 30) throw new ToolError('Число сторис — от 0 до 30.');
    try { await ctx.api.post('/stories', { projectId: p.id, date, storiesCount: next }); } catch (e) { throw apiErr(e); }
    return {
      summary: `📸 Сторис «${p.label}» за ${fmtDateRu(date)}: ваших ${next}`,
      undo: [{ method: 'POST', path: '/stories', body: { projectId: p.id, date, storiesCount: own } }],
    };
  },
};

// ─── Отчёт за день ──────────────────────────────────────────────────────

export const dailyReport: ToolDef<{ description: string; hours: number; project?: string; date?: string }> = {
  name: 'daily_report',
  kind: 'write',
  description: '«Сдай отчёт за день: …» — что сделано и сколько часов.',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Выполненная работа.' },
      hours: { type: 'number', description: 'Затрачено часов (> 0).' },
      project: { type: 'string', description: 'Метка проекта P…' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    required: ['description', 'hours'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'reports.create'),
  async run(args, ctx): Promise<WriteOutcome> {
    const hours = Number(args.hours);
    if (!(hours > 0) || hours > 24) throw new ToolError('Сколько часов заняла работа? Нужно число от 0 до 24.');
    const text = String(args.description || '').trim();
    if (!text) throw new ToolError('Что сделано за день?');
    const date = args.date ? checkDate(args.date) : ctx.today;
    const p = args.project ? projectEntry(ctx, args.project) : null;
    let created: any;
    try {
      created = await ctx.api.post('/reports', { date, description: text.slice(0, 4000), timeSpent: hours, ...(p ? { projectId: p.id } : {}) });
    } catch (e) { throw apiErr(e); }
    return {
      summary: `📝 Отчёт за ${fmtDateRu(date)}: ${hours} ч${p ? `, ${p.label}` : ''}`,
      undo: created?.id && hasGrant(ctx.user as any, 'reports.delete')
        ? [{ method: 'DELETE', path: `/reports/${created.id}` }]
        : undefined,
    };
  },
};

export const SMM_TOOLS: ToolDef[] = [smmPlan, setContentStatus, moveContent, myWork, myWorkUpdate, storiesStatus, markStories, dailyReport];
