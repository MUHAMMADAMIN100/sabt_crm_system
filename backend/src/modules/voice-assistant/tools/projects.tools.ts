import { hasGrant } from '../../auth/permissions';
import { DEV_PROJECT_TYPES } from '../../../common/sales-segment';
import { LAUNCH_LABELS, MANUAL_LAUNCH_KEYS } from '../../projects/launch-checklist.helper';
import { ApiError } from '../internal-api';
import { checkDate, fmtDateRu, fmtDeadline, isSalesManager, roles, splitDushanbe } from './common';
import { ensureEmployee } from './people.tools';
import { compactTask } from './tasks.tools';
import { NeedChoice, ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Раздел «Проекты»: карточка, создание, правка, состав, архив, удаление,
 * оплаты проекта, объявления, чек-лист запуска, бриф, СММ-настройки.
 * Список проектов (list_projects) живёт в people.tools.ts.
 * Права — как на сайте: гранты projects.* и роли из @Roles обработчиков
 * (роль ИЛИ вторая роль). Остальное проверяет сам API.
 */

export const PROJECT_STATUS_RU: Record<string, string> = {
  planning: 'Планирование', in_progress: 'В работе', on_hold: 'На паузе', completed: 'Завершён', archived: 'В архиве',
};
/** Статусы, которые можно выставить вручную (архив — отдельным действием). */
const SETTABLE_STATUSES = ['planning', 'in_progress', 'on_hold', 'completed'];

const DEV_STAGE_RU: Record<number, string> = {
  1: '[10%] Сбор требований и ТЗ', 2: '[25%] Проектирование и концепт', 3: '[50%] Активная фаза производства',
  4: '[75%] Внутренняя приёмка и QA', 5: '[90%] Демонстрация и согласование', 6: '[100%] Внедрение и передача',
};

const DEV_KINDS = ['Лендинг', 'Телеграм бот', 'CRM система', 'Интернет магазин', 'Web сайт'];

const typeLabel = (t: unknown): string => (t === 'Web сайт' ? 'Разработка' : String(t || 'без типа'));
const has = (key: string) => (u: any) => hasGrant(u, key);
const hasRole = (user: Parameters<typeof roles>[0], ...allowed: string[]): boolean =>
  roles(user).some((r) => allowed.includes(r));

function apiErr(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  if (e.status === 403 && /^not allowed$/i.test(e.message.trim())) {
    return new ToolError('У вас нет прав на это действие с проектом.');
  }
  if (e.status === 404 && /not found/i.test(e.message)) return new ToolError('Проект не найден или уже удалён.');
  return new ToolError(e.message);
}

function projectEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('P', ref);
  if (!e) throw new ToolError(`Нет проекта с меткой «${ref}». Сначала найдите его через list_projects.`);
  return e;
}

async function loadProject(ctx: ToolContext, id: string): Promise<any> {
  try {
    return await ctx.api.get(`/projects/${id}`);
  } catch (e) {
    throw apiErr(e);
  }
}

const dateOf = (v: unknown): string | null => splitDushanbe(v as any)?.date ?? null;

function memberIds(p: any): string[] {
  return (Array.isArray(p?.members) ? p.members : []).map((m: any) => m?.id).filter(Boolean);
}

function registerPeople(ctx: ToolContext, p: any): void {
  if (p.manager?.id && p.manager?.name) ctx.refs.add('E', p.manager.id, p.manager.name);
  for (const m of p.members || []) if (m?.id && m?.name) ctx.refs.add('E', m.id, m.name);
}

/** Имена людей по меткам E…; человек должен быть известен боту. */
function people(ctx: ToolContext, refs: unknown, field: string): Array<{ id: string; label: string }> {
  if (refs == null) return [];
  if (!Array.isArray(refs)) throw new ToolError(`Поле «${field}» должно быть списком меток сотрудников.`);
  const seen = new Set<string>();
  const out: Array<{ id: string; label: string }> = [];
  for (const r of refs) {
    const e = ensureEmployee(ctx, r);
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, label: e.label });
  }
  return out;
}

// ─── Чтение ─────────────────────────────────────────────────────────────

export const projectDetails: ToolDef<{ project: string }> = {
  name: 'project_details',
  kind: 'read',
  description:
    'Карточка проекта: статус, прогресс, менеджер, команда, срок, открытые задачи, клиент, этап разработки или СММ-настройки. '
    + 'Деньги (оплачено, договор, остаток) приходят ТОЛЬКО если сайт показывает их этому человеку — иначе поля нет, '
    + 'и называть суммы нельзя. «Расскажи про проект Архидея», «какой прогресс по проекту», «кто в команде проекта». '
    + 'Список проектов — list_projects; платежи по проекту — project_payments.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    registerPeople(ctx, p);
    const now = Date.now();
    const tasks: any[] = Array.isArray(p.tasks) ? p.tasks : [];
    const open = tasks.filter((t) => t.status === 'new' || t.status === 'in_progress');
    const overdue = open.filter((t) => t.deadline && new Date(t.deadline).getTime() < now);
    const out: Record<string, any> = {
      ref: ctx.refs.add('P', p.id, p.name),
      name: p.name,
      type: typeLabel(p.projectType),
      status: PROJECT_STATUS_RU[p.status] || p.status,
      ...(p.isArchived ? { archived: true } : {}),
      progress: `${Number(p.progress) || 0}%`,
      tasks: { total: tasks.length, open: open.length, done: tasks.filter((t) => t.status === 'done').length, overdue: overdue.length },
    };
    if (p.description) out.description = String(p.description).slice(0, 400);
    if (p.manager?.name) out.manager = { ref: ctx.refs.add('E', p.manager.id, p.manager.name), name: p.manager.name };
    const members = (Array.isArray(p.members) ? p.members : []).filter((m: any) => m?.id && m?.name);
    if (members.length) {
      out.members = members.slice(0, 20).map((m: any) => ({ ref: ctx.refs.add('E', m.id, m.name), name: m.name, role: m.role }));
    }
    const start = dateOf(p.startDate);
    const end = dateOf(p.endDate);
    if (start) out.startDate = start;
    if (end) {
      out.deadline = fmtDateRu(end);
      if (end < ctx.today && p.status !== 'completed' && !p.isArchived) out.deadlineOverdue = true;
    }
    if (typeof p.devStage === 'number') out.devStage = DEV_STAGE_RU[p.devStage] || p.devStage;
    const client = p.clientInfo || {};
    const clientOut: Record<string, string> = {};
    if (client.companyName || client.name) clientOut.company = String(client.companyName || client.name);
    if (client.contactPerson) clientOut.contact = String(client.contactPerson);
    if (client.phone) clientOut.phone = String(client.phone);
    if (Object.keys(clientOut).length) out.client = clientOut;
    if (p.projectType === 'SMM') {
      const sd = p.smmData || {};
      out.smm = {
        ...(p.tariffNameSnapshot ? { tariff: p.tariffNameSnapshot } : {}),
        ...(sd.cycleStartDay ? { cycleStartDay: sd.cycleStartDay } : {}),
        normReels: sd.normReels ?? null,
        normPosts: sd.normPosts ?? null,
        storiesPerMonth: sd.storiesPerMonth ?? null,
        ...(sd.ownerName ? { owner: sd.ownerName } : {}),
      };
    }
    const money: Record<string, any> = {};
    for (const [k, label] of [['budget', 'budget'], ['totalContractValue', 'contract'], ['paidAmount', 'paid'], ['outstandingAmount', 'outstanding'], ['monthlyFee', 'monthlyFee']] as const) {
      if (p[k] != null) money[label] = Number(p[k]);
    }
    if (Object.keys(money).length) {
      out.money = { ...money, currency: 'сомони', ...(p.paymentStatus ? { paymentStatus: p.paymentStatus } : {}) };
    }
    if (open.length) {
      out.openTasks = open
        .sort((a, b) => new Date(a.deadline || 8.64e15).getTime() - new Date(b.deadline || 8.64e15).getTime())
        .slice(0, 8)
        .map((t) => compactTask(ctx, t));
    }
    return out;
  },
};

export const projectPayments: ToolDef<{ project: string }> = {
  name: 'project_payments',
  kind: 'read',
  description:
    'Платежи, уже полученные по проекту (транши): суммы, даты, заметки. «Какие оплаты по проекту Архидея», '
    + '«сколько клиент уже заплатил по проекту». Не для записи оплаты и не для письма клиенту.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  available: has('projects.payments.view'),
  async run(args, ctx) {
    const e = projectEntry(ctx, args.project);
    let rows: any[];
    try { rows = await ctx.api.get<any[]>(`/projects/${e.id}/payments`); } catch (err) { throw apiErr(err); }
    const list = Array.isArray(rows) ? rows : [];
    return {
      project: e.label,
      total: list.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      currency: 'сомони',
      count: list.length,
      payments: list.slice(-30).map((r) => ({ amount: Number(r.amount) || 0, date: dateOf(r.paidAt), note: r.note || undefined })),
    };
  },
};

export const projectAnnouncements: ToolDef<{ project: string }> = {
  name: 'project_announcements',
  kind: 'read',
  description: 'Объявления проекта («важное для команды»): заголовок, текст, срочность, кто написал. Возвращает метки X… для удаления.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const e = projectEntry(ctx, args.project);
    let rows: any[];
    try { rows = await ctx.api.get<any[]>(`/projects/${e.id}/announcements`); } catch (err) { throw apiErr(err); }
    const list = Array.isArray(rows) ? rows : [];
    return {
      project: e.label,
      total: list.length,
      announcements: list.slice(0, 20).map((a) => ({
        ref: ctx.refs.add('X', `${e.id}/${a.id}`, a.title),
        title: a.title,
        text: a.description ? String(a.description).slice(0, 300) : undefined,
        urgent: a.priority === 'urgent',
        from: a.createdBy?.name,
        date: dateOf(a.createdAt),
      })),
    };
  },
};

export const projectLaunchChecklist: ToolDef<{ project: string }> = {
  name: 'project_launch_checklist',
  kind: 'read',
  description:
    'Чек-лист запуска проекта (10 пунктов: клиент, тариф, менеджер, команда, материалы, доступы, план, задачи, оплата): что закрыто, что нет. '
    + 'Нужен, когда проект не переводится «в работу» из-за незакрытых пунктов.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const e = projectEntry(ctx, args.project);
    let st: any;
    try { st = await ctx.api.get(`/projects/${e.id}/launch-checklist`); } catch (err) { throw apiErr(err); }
    return {
      project: e.label,
      percent: st?.percent,
      complete: !!st?.isComplete,
      items: (st?.items || []).map((i: any) => ({
        key: i.key, title: i.label, done: !!i.done, ...(i.manual ? { manual: true } : {}),
      })),
    };
  },
};

export const projectBrief: ToolDef<{ project: string }> = {
  name: 'project_brief',
  kind: 'read',
  description: 'Бриф СММ-проекта: кто и когда заполнил, сколько ответов и сами ответы (коротко). Только для СММ-проектов.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    if (p.projectType !== 'SMM') throw new ToolError('Бриф есть только у СММ-проектов.');
    const brief = p.brief && typeof p.brief === 'object' ? p.brief : null;
    if (!brief) return { project: e.label, filled: false };
    const answers: Record<string, unknown> = brief.answers && typeof brief.answers === 'object' ? brief.answers : {};
    const filled = Object.entries(answers).filter(([, v]) => typeof v === 'string' && v.trim());
    return {
      project: e.label,
      filled: true,
      filledBy: brief.filledByName || undefined,
      filledAt: dateOf(brief.filledAt),
      fromClient: brief.source === 'client',
      answersCount: filled.length,
      answers: filled.slice(0, 40).map(([k, v]) => ({ question: k, answer: String(v).slice(0, 200) })),
    };
  },
};

// ─── Создание и правка ──────────────────────────────────────────────────

interface CreateArgs {
  name: string;
  type: 'smm' | 'dev' | 'design';
  dev_kind?: string;
  manager?: string;
  end_date?: string;
  description?: string;
  client_company?: string;
  client_contact?: string;
  client_phone?: string;
  norm_reels?: number;
  norm_posts?: number;
  stories_per_month?: number;
  cycle_day?: number;
  owner_name?: string;
}

function resolveProjectType(args: CreateArgs): string {
  if (args.type === 'smm') return 'SMM';
  if (args.type === 'design') return 'Дизайн';
  if (args.type === 'dev') {
    if (!args.dev_kind) {
      throw new NeedChoice('Какой это проект разработки?', DEV_KINDS);
    }
    if (!DEV_KINDS.includes(args.dev_kind)) throw new ToolError(`Неизвестный вид разработки «${args.dev_kind}».`);
    return args.dev_kind;
  }
  throw new ToolError('Не понял тип проекта: СММ, разработка или дизайн.');
}

function intInRange(v: unknown, lo: number, hi: number, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ToolError(`«${label}» — целое число от ${lo} до ${hi}.`);
  return n;
}

const daysInMonthOf = (today: string): number => {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const createProject: ToolDef<CreateArgs> = {
  name: 'create_project',
  kind: 'write',
  description:
    'Создать НОВЫЙ проект, как кнопки «Новый проект» на сайте. «Создай СММ-проект Кофеин с нормой 12 рилсов и 8 постов», '
    + '«заведи проект разработки: лендинг для клиники, менеджер Фируз, срок 1 декабря», «новый дизайн-проект». '
    + 'СММ: можно норму за цикл (рилсы, посты, сторис в месяц, день старта цикла) — тарифа при создании нет, как на сайте. '
    + 'Разработка: нужен вид (лендинг, телеграм-бот, CRM, интернет-магазин, сайт), менеджер — проект-менеджер, '
    + 'клиент — компания, контакт, телефон. Сначала проверь list_projects — нет ли уже такого. '
    + 'НЕ для задач (create_task), клиентов/лидов (create_lead), правки существующего проекта (update_project).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Название проекта.' },
      type: { type: 'string', enum: ['smm', 'dev', 'design'], description: 'smm — СММ, dev — разработка, design — дизайн.' },
      dev_kind: { type: 'string', enum: DEV_KINDS, description: 'Только для dev: вид проекта. Не угадывай — если не сказали, не заполняй.' },
      manager: { type: 'string', description: 'Метка E… менеджера проекта. Не назвали — менеджером станет тот, кто создаёт.' },
      end_date: { type: 'string', description: 'Срок сдачи ГГГГ-ММ-ДД.' },
      description: { type: 'string' },
      client_company: { type: 'string', description: 'dev: компания клиента.' },
      client_contact: { type: 'string', description: 'dev: контактное лицо клиента.' },
      client_phone: { type: 'string', description: 'dev: телефон клиента.' },
      norm_reels: { type: 'integer', description: 'smm: рилсов за цикл.' },
      norm_posts: { type: 'integer', description: 'smm: постов за цикл.' },
      stories_per_month: { type: 'integer', description: 'smm: сторис в месяц (0–100).' },
      cycle_day: { type: 'integer', description: 'smm: день старта цикла (1–31).' },
      owner_name: { type: 'string', description: 'smm: владелец бизнеса клиента.' },
    },
    required: ['name', 'type'],
    additionalProperties: false,
  },
  available: has('projects.create'),
  confirm: () => true,
  async preview(args, ctx) {
    const type = resolveProjectType(args);
    const manager = args.manager ? ensureEmployee(ctx, args.manager) : null;
    const end = args.end_date ? checkDate(args.end_date) : null;
    if (end && end < ctx.today) throw new ToolError(`Срок ${fmtDateRu(end)} уже прошёл.`);
    return `📁 СОЗДАТЬ ПРОЕКТ «${String(args.name || '').trim()}»`
      + `\n🏷 Тип: ${typeLabel(type)}${type !== 'SMM' && type !== 'Дизайн' ? ` (${type})` : ''}`
      + `\n👤 Менеджер: ${manager ? manager.label : 'вы'}`
      + (end ? `\n📅 Срок: ${fmtDateRu(end)}` : '')
      + (args.type === 'smm' && (args.norm_reels != null || args.norm_posts != null)
        ? `\n🎬 Норма за цикл: рилсов ${args.norm_reels ?? 0}, постов ${args.norm_posts ?? 0}` : '')
      + (args.client_company ? `\n🏢 Клиент: ${args.client_company}` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const name = String(args.name || '').trim();
    if (!name) throw new ToolError('Не понял название проекта.');
    const projectType = resolveProjectType(args);
    const body: Record<string, any> = { name: name.slice(0, 200), projectType };
    if (args.description && String(args.description).trim()) body.description = String(args.description).trim().slice(0, 2000);
    if (args.manager) body.managerId = ensureEmployee(ctx, args.manager).id;
    if (args.end_date) {
      const end = checkDate(args.end_date);
      if (end < ctx.today) throw new ToolError(`Срок ${fmtDateRu(end)} уже прошёл. Назовите дату в будущем.`);
      body.endDate = end;
    }

    let reels = 0;
    let posts = 0;
    if (args.type === 'smm') {
      const smmData: Record<string, any> = {};
      reels = args.norm_reels != null ? intInRange(args.norm_reels, 0, 999, 'рилсов за цикл') : 0;
      posts = args.norm_posts != null ? intInRange(args.norm_posts, 0, 999, 'постов за цикл') : 0;
      smmData.normReels = reels;
      smmData.normPosts = posts;
      if (args.cycle_day != null) smmData.cycleStartDay = intInRange(args.cycle_day, 1, 31, 'день старта цикла');
      if (args.stories_per_month != null) {
        const m = intInRange(args.stories_per_month, 0, 100, 'сторис в месяц');
        smmData.storiesPerMonth = m;
        smmData.storiesPerDay = m > 0 ? Math.max(1, Math.round(m / daysInMonthOf(ctx.today))) : 0;
      }
      if (args.owner_name && String(args.owner_name).trim()) smmData.ownerName = String(args.owner_name).trim().slice(0, 200);
      body.smmData = smmData;
      body.allowNoTariff = true;
    } else {
      body.startDate = ctx.today;
      const client: Record<string, string> = {};
      if (args.client_company && String(args.client_company).trim()) client.companyName = String(args.client_company).trim();
      if (args.client_contact && String(args.client_contact).trim()) client.contactPerson = String(args.client_contact).trim();
      if (args.client_phone && String(args.client_phone).trim()) client.phone = String(args.client_phone).trim();
      if (Object.keys(client).length) body.clientInfo = client;
    }

    let created: any;
    try { created = await ctx.api.post('/projects', body); } catch (e) { throw apiErr(e); }
    if (!created?.id) throw new ToolError('Сайт не вернул созданный проект — проверьте список проектов.');
    ctx.refs.add('P', created.id, name);

    const notes: string[] = [];
    if (DEV_PROJECT_TYPES.includes(projectType)) {
      // Как на сайте: новый проект разработки начинается с этапа 1. Нет права двигать этап — не страшно.
      try {
        await ctx.api.patch(`/projects/${created.id}/dev-stage`, { devStage: 1 });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 403)) throw apiErr(e);
      }
    }
    if (args.type === 'smm' && reels + posts > 0) {
      try {
        await ctx.api.post('/content-plan/smart-generate', { projectId: created.id, reels, posts });
      } catch (e) {
        notes.push(`контент-план не сформирован (${e instanceof ApiError ? e.message : 'ошибка'})`);
      }
    }
    return {
      summary: `📁 Проект «${name}» создан (${typeLabel(projectType)})${notes.length ? `; ${notes.join('; ')}` : ''}`,
    };
  },
};

interface UpdateArgs {
  project: string;
  name?: string;
  status?: string;
  manager?: string;
  end_date?: string;
  description?: string;
}

export const updateProject: ToolDef<UpdateArgs> = {
  name: 'update_project',
  kind: 'write',
  description:
    'Изменить проект: название, статус (planning — планирование, in_progress — в работе, on_hold — на паузе, completed — завершён), '
    + 'менеджер проекта, срок сдачи, описание. «Переименуй проект», «поставь проект на паузу», «срок проекта 20 декабря», '
    + '«назначь Фируза менеджером проекта». «В работу» может не пройти, пока не закрыт чек-лист запуска (project_launch_checklist). '
    + 'НЕ для архива (archive_project), НЕ для состава команды (set_project_members), НЕ для денег и тарифа, НЕ для задач проекта.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      name: { type: 'string' },
      status: { type: 'string', enum: SETTABLE_STATUSES },
      manager: { type: 'string', description: 'Метка E… нового менеджера проекта.' },
      end_date: { type: 'string', description: 'Новый срок ГГГГ-ММ-ДД; "none" — убрать срок.' },
      description: { type: 'string' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  // Править может и назначенный менеджер без гранта — решает сервер.
  confirm: (args, ctx) => !!args.manager && ctx.refs.resolve('E', args.manager)?.id !== ctx.user.id,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const manager = args.manager ? ensureEmployee(ctx, args.manager) : null;
    return `👤 НАЗНАЧИТЬ МЕНЕДЖЕРА ПРОЕКТА\n📁 ${e.label}\n👤 Новый менеджер: ${manager?.label}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const old = await loadProject(ctx, e.id);
    const patch: Record<string, any> = {};
    const undo: Record<string, any> = {};
    const parts: string[] = [];

    if (args.name != null) {
      const n = String(args.name).trim();
      if (!n) throw new ToolError('Название не может быть пустым.');
      if (n !== old.name) { patch.name = n.slice(0, 200); undo.name = old.name; parts.push(`название → «${patch.name}»`); }
    }
    if (args.description != null) {
      const d = String(args.description).trim().slice(0, 2000);
      if (d !== String(old.description || '')) { patch.description = d; undo.description = old.description ?? ''; parts.push('описание обновлено'); }
    }
    if (args.status) {
      if (!SETTABLE_STATUSES.includes(args.status)) throw new ToolError(`Статус «${args.status}» так не выставить. Архив — через archive_project.`);
      if (old.isArchived) throw new ToolError('Проект в архиве. Сначала верните его из архива.');
      if (args.status !== old.status) { patch.status = args.status; undo.status = old.status; parts.push(`статус → ${PROJECT_STATUS_RU[args.status]}`); }
    }
    if (args.manager) {
      const m = ensureEmployee(ctx, args.manager);
      if (m.id !== old.manager?.id) { patch.managerId = m.id; undo.managerId = old.manager?.id ?? null; parts.push(`менеджер → ${m.label}`); }
    }
    if (args.end_date != null) {
      const raw = String(args.end_date).trim();
      if (raw.toLowerCase() === 'none') {
        if (dateOf(old.endDate)) { patch.endDate = null; undo.endDate = dateOf(old.endDate); parts.push('срок убран'); }
      } else {
        const d = checkDate(raw);
        if (d < ctx.today) throw new ToolError(`Срок ${fmtDateRu(d)} уже прошёл.`);
        if (d !== dateOf(old.endDate)) { patch.endDate = d; undo.endDate = dateOf(old.endDate); parts.push(`срок → ${fmtDateRu(d)}`); }
      }
    }
    if (!Object.keys(patch).length) {
      if (!parts.length && (args.name != null || args.status || args.manager || args.end_date != null || args.description != null)) {
        return { summary: `ℹ️ В проекте «${old.name}» уже так — менять нечего` };
      }
      throw new ToolError('Не понял, что изменить в проекте.');
    }
    try { await ctx.api.patch(`/projects/${e.id}`, patch); } catch (err) { throw apiErr(err); }
    return {
      summary: `✏️ Проект «${old.name}»: ${parts.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/projects/${e.id}`, body: undo }],
    };
  },
};

interface MembersArgs { project: string; add?: string[]; remove?: string[] }

export const setProjectMembers: ToolDef<MembersArgs> = {
  name: 'set_project_members',
  kind: 'write',
  description:
    'Добавить в проект участников или убрать их: «добавь Сабрину в проект Архидея», «убери Фируза из проекта». '
    + 'Добавленным приходит уведомление. Менеджера проекта убрать нельзя — сначала смени его (update_project). '
    + 'НЕ для задач и НЕ для СММ-команды (специалисты, видеографы — set_project_crew).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      add: { type: 'array', items: { type: 'string' }, description: 'Метки E… кого добавить.' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Метки E… кого убрать.' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const add = people(ctx, args.add, 'add');
    const remove = people(ctx, args.remove, 'remove');
    if (!add.length && !remove.length) throw new ToolError('Не понял, кого добавить или убрать.');
    return `👥 СОСТАВ ПРОЕКТА «${e.label}»`
      + (add.length ? `\n➕ Добавить: ${add.map((a) => a.label).join(', ')}` : '')
      + (remove.length ? `\n➖ Убрать: ${remove.map((a) => a.label).join(', ')}` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const add = people(ctx, args.add, 'add');
    const remove = people(ctx, args.remove, 'remove');
    if (!add.length && !remove.length) throw new ToolError('Не понял, кого добавить или убрать.');
    const p = await loadProject(ctx, e.id);
    const current = memberIds(p);
    if (remove.some((r) => r.id === p.manager?.id)) {
      throw new ToolError('Менеджера проекта из состава не убрать. Сначала назначьте другого менеджера.');
    }
    const next = new Set(current);
    for (const a of add) next.add(a.id);
    for (const r of remove) next.delete(r.id);
    const added = add.filter((a) => !current.includes(a.id));
    const removed = remove.filter((r) => current.includes(r.id));
    if (!added.length && !removed.length) return { summary: `ℹ️ В проекте «${p.name}» состав уже такой` };
    if (next.size > 30) throw new ToolError('В проекте не может быть больше 30 участников.');
    try { await ctx.api.patch(`/projects/${e.id}`, { memberIds: [...next] }); } catch (err) { throw apiErr(err); }
    return {
      summary: `👥 «${p.name}»`
        + (added.length ? `: добавлены ${added.map((a) => a.label).join(', ')}` : '')
        + (removed.length ? `${added.length ? ';' : ':'} убраны ${removed.map((a) => a.label).join(', ')}` : ''),
      undo: [{ method: 'PATCH', path: `/projects/${e.id}`, body: { memberIds: current } }],
    };
  },
};

// ─── Архив и удаление ───────────────────────────────────────────────────

/** Личное скрытие (менеджер продаж) — не настоящий архив; у второй роли dev_director архив общий. */
function archiveIsPersonal(user: Parameters<typeof roles>[0] & { role: string; secondaryRole?: string | null }): boolean {
  return isSalesManager(user) && user.secondaryRole !== 'dev_director';
}

export const archiveProject: ToolDef<{ project: string }> = {
  name: 'archive_project',
  kind: 'write',
  description:
    'Отправить проект в архив: «архивируй проект», «убери проект в архив». У менеджера продаж это личное скрытие из своего списка '
    + '(проект у команды остаётся активным). НЕ удаление — удалить проект: delete_project. Вернуть из архива: restore_project.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  available: has('projects.archive'),
  confirm: (_a, ctx) => !archiveIsPersonal(ctx.user),
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    return `📦 В АРХИВ ВСЕЙ КОМПАНИИ\n📁 ${e.label}\nПроект пропадёт из активных у всей команды.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    const personal = archiveIsPersonal(ctx.user);
    if (!personal && p.isArchived) return { summary: `ℹ️ «${p.name}» уже в архиве` };
    try { await ctx.api.patch(`/projects/${e.id}/archive`); } catch (err) { throw apiErr(err); }
    const undo: NonNullable<WriteOutcome['undo']> = [{ method: 'PATCH', path: `/projects/${e.id}/restore` }];
    if (!personal && p.status && p.status !== 'in_progress' && p.status !== 'archived') {
      undo.push({ method: 'PATCH', path: `/projects/${e.id}`, body: { status: p.status } });
    }
    return {
      summary: personal ? `📦 «${p.name}» скрыт из вашего списка (у команды проект активен)` : `📦 «${p.name}» отправлен в архив`,
      undo,
    };
  },
};

export const restoreProject: ToolDef<{ project: string }> = {
  name: 'restore_project',
  kind: 'write',
  description:
    'Вернуть проект из архива: «верни проект из архива», «восстанови проект». Метку берёт из list_projects с archived=true. '
    + 'Общий архив возвращает проект в статус «В работе»; у менеджера продаж — возвращает в личный список.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  available: has('projects.archive'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    const personal = archiveIsPersonal(ctx.user);
    if (!personal && !p.isArchived) return { summary: `ℹ️ «${p.name}» и так не в архиве` };
    try { await ctx.api.patch(`/projects/${e.id}/restore`); } catch (err) { throw apiErr(err); }
    return {
      summary: personal ? `↩️ «${p.name}» возвращён в ваш список` : `↩️ «${p.name}» возвращён из архива (статус «В работе»)`,
      undo: [{ method: 'PATCH', path: `/projects/${e.id}/archive` }],
    };
  },
};

export const deleteProject: ToolDef<{ project: string }> = {
  name: 'delete_project',
  kind: 'write',
  description:
    'УДАЛИТЬ проект совсем, без возврата. Только если прямо сказано «удали проект». '
    + '«Заверши / закрой проект» — это update_project со статусом completed, «убери в архив» — archive_project.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  available: has('projects.delete'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    const tasks = Array.isArray(p.tasks) ? p.tasks.length : 0;
    return `🗑 УДАЛИТЬ ПРОЕКТ «${p.name || e.label}»\n🏷 ${typeLabel(p.projectType)}, задач в проекте: ${tasks}\nВернуть проект будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    try { await ctx.api.delete(`/projects/${e.id}`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Проект «${e.label}» удалён` };
  },
};

// ─── Этап разработки ────────────────────────────────────────────────────

export const setDevStage: ToolDef<{ project: string; stage: number }> = {
  name: 'set_dev_stage',
  kind: 'write',
  description:
    'Этап проекта разработки: 1 — [10%] ТЗ, 2 — [25%] концепт, 3 — [50%] производство, 4 — [75%] приёмка и QA, '
    + '5 — [90%] согласование, 6 — [100%] внедрение. «Переведи проект на этап QA». Только для проектов разработки. '
    + 'Не путать со статусом проекта (update_project) и статусом карточки доски.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      stage: { type: 'integer', enum: [1, 2, 3, 4, 5, 6] },
    },
    required: ['project', 'stage'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, 'admin', 'founder', 'dev_director', 'pm_dev', 'developer'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const stage = Number(args.stage);
    if (!DEV_STAGE_RU[stage]) throw new ToolError('Этап — число от 1 до 6.');
    const p = await loadProject(ctx, e.id);
    if (p.devStage === stage) return { summary: `ℹ️ «${p.name}» уже на этапе ${DEV_STAGE_RU[stage]}` };
    try { await ctx.api.patch(`/projects/${e.id}/dev-stage`, { devStage: stage }); } catch (err) { throw apiErr(err); }
    const prev = typeof p.devStage === 'number' ? p.devStage : null;
    return {
      summary: `🚦 «${p.name}» → этап ${DEV_STAGE_RU[stage]}`,
      undo: prev ? [{ method: 'PATCH', path: `/projects/${e.id}/dev-stage`, body: { devStage: prev } }] : undefined,
    };
  },
};

// ─── Оплаты ─────────────────────────────────────────────────────────────

export const requestProjectPayment: ToolDef<{ project: string; message?: string }> = {
  name: 'request_project_payment',
  kind: 'write',
  description:
    'Отправить КЛИЕНТУ проекта письмо-запрос оплаты на его email (остаток по договору): «запроси оплату у клиента проекта Архидея». '
    + 'Письмо уходит наружу и не отзывается. НЕ записывает полученную оплату (для этого — финансовые инструменты) '
    + 'и не показывает платежи (project_payments).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      message: { type: 'string', description: 'Свой текст в письме — только если человек его продиктовал.' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: has('projects.payments.request'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    const email = p.clientInfo?.email;
    if (!email) throw new ToolError('У проекта не указан email клиента. Добавьте его в карточке проекта, во вкладке «О клиенте».');
    const total = Number(p.totalContractValue || p.budget || 0);
    const rest = p.totalContractValue != null || p.budget != null ? Math.max(0, total - Number(p.paidAmount || 0)) : null;
    return `✉️ ЗАПРОС ОПЛАТЫ КЛИЕНТУ\n📁 ${p.name || e.label}\n📧 ${email}`
      + (rest != null ? `\n💰 Остаток к оплате: ${rest} сомони` : '')
      + (args.message ? `\n📝 ${String(args.message).slice(0, 300)}` : '')
      + '\nПисьмо уйдёт клиенту сразу.';
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const body = args.message && String(args.message).trim() ? { message: String(args.message).trim().slice(0, 2000) } : {};
    let res: any;
    try { res = await ctx.api.post(`/projects/${e.id}/send-payment-request`, body); } catch (err) { throw apiErr(err); }
    if (!res?.sent) throw new ToolError(`Письмо клиенту (${res?.to || 'email'}) не отправилось — почта сейчас не отвечает. Попробуйте позже.`);
    return { summary: `✉️ Запрос оплаты отправлен клиенту проекта «${e.label}» (${res.to}), остаток ${Number(res.remaining) || 0} сомони` };
  },
};

// ─── Объявления ─────────────────────────────────────────────────────────

const canAnnounce = (u: Parameters<typeof roles>[0]) => hasRole(u, 'admin', 'founder', 'smm_director');

export const postProjectAnnouncement: ToolDef<{ project: string; title: string; text?: string; urgent?: boolean }> = {
  name: 'post_project_announcement',
  kind: 'write',
  description:
    'Опубликовать объявление в проекте — оно сразу уходит всей команде проекта уведомлением, письмом и в Telegram: '
    + '«напиши в проект Архидея объявление: съёмка переносится на пятницу». urgent — срочное. '
    + 'НЕ для личных сообщений и не для комментариев к задаче.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      title: { type: 'string', description: 'Заголовок объявления, до 300 символов.' },
      text: { type: 'string', description: 'Подробности, если есть.' },
      urgent: { type: 'boolean', description: 'true — срочное. По умолчанию обычное.' },
    },
    required: ['project', 'title'],
    additionalProperties: false,
  },
  available: canAnnounce,
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    if (!String(args.title || '').trim()) throw new ToolError('Не понял заголовок объявления.');
    return `${args.urgent ? '🚨' : '📢'} ОБЪЯВЛЕНИЕ КОМАНДЕ ПРОЕКТА «${e.label}»${args.urgent ? ' (СРОЧНО)' : ''}`
      + `\n${String(args.title).trim()}${args.text ? `\n${String(args.text).trim().slice(0, 500)}` : ''}\nУведомление получит вся команда.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const title = String(args.title || '').trim();
    if (!title) throw new ToolError('Не понял заголовок объявления.');
    const body: Record<string, any> = { title: title.slice(0, 300), priority: args.urgent ? 'urgent' : 'normal' };
    if (args.text && String(args.text).trim()) body.description = String(args.text).trim().slice(0, 5000);
    let created: any;
    try { created = await ctx.api.post(`/projects/${e.id}/announcements`, body); } catch (err) { throw apiErr(err); }
    return {
      summary: `${args.urgent ? '🚨' : '📢'} Объявление в проекте «${e.label}»: ${body.title}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/projects/${e.id}/announcements/${created.id}` }] : undefined,
    };
  },
};

export const deleteProjectAnnouncement: ToolDef<{ announcement: string }> = {
  name: 'delete_project_announcement',
  kind: 'write',
  description: 'Удалить объявление проекта. Метку X… берёт из project_announcements. «Удали объявление про съёмку».',
  parameters: {
    type: 'object',
    properties: { announcement: { type: 'string', description: 'Метка объявления X…' } },
    required: ['announcement'],
    additionalProperties: false,
  },
  available: canAnnounce,
  confirm: () => true,
  async preview(args, ctx) {
    const a = announcementEntry(ctx, args.announcement);
    return `🗑 УДАЛИТЬ ОБЪЯВЛЕНИЕ «${a.label}»\nВернуть его будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const a = announcementEntry(ctx, args.announcement);
    try { await ctx.api.delete(`/projects/${a.projectId}/announcements/${a.id}`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Объявление «${a.label}» удалено` };
  },
};

function announcementEntry(ctx: ToolContext, ref: unknown): { projectId: string; id: string; label: string } {
  const e = ctx.refs.resolve('X', ref);
  const [projectId, id] = String(e?.id || '').split('/');
  if (!e || !projectId || !id) {
    throw new ToolError(`Нет объявления с меткой «${ref}». Сначала откройте список через project_announcements.`);
  }
  return { projectId, id, label: e.label };
}

// ─── Чек-лист запуска и бриф ────────────────────────────────────────────

export const setLaunchItem: ToolDef<{ project: string; item: string; done: boolean }> = {
  name: 'set_launch_item',
  kind: 'write',
  description:
    'Отметить ручной пункт чек-листа запуска проекта: materials_received — «материалы получены», accesses_received — «доступы получены». '
    + 'Остальные пункты считаются сами и вручную не ставятся.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      item: { type: 'string', enum: MANUAL_LAUNCH_KEYS },
      done: { type: 'boolean', description: 'true — отметить, false — снять.' },
    },
    required: ['project', 'item', 'done'],
    additionalProperties: false,
  },
  available: has('projects.launch.manage'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    if (!MANUAL_LAUNCH_KEYS.includes(args.item)) {
      throw new ToolError(`Пункт «${args.item}» считается автоматически. Вручную можно: ${MANUAL_LAUNCH_KEYS.join(', ')}.`);
    }
    const value = args.done === true;
    let before: any;
    try { before = await ctx.api.get(`/projects/${e.id}/launch-checklist`); } catch (err) { throw apiErr(err); }
    const was = !!(before?.items || []).find((i: any) => i.key === args.item)?.done;
    const title = LAUNCH_LABELS[args.item] || args.item;
    if (was === value) return { summary: `ℹ️ «${title}» в проекте «${e.label}» уже ${value ? 'отмечено' : 'снято'}` };
    try { await ctx.api.patch(`/projects/${e.id}/launch-checklist`, { item: args.item, value }); } catch (err) { throw apiErr(err); }
    return {
      summary: `${value ? '✅' : '⬜'} «${e.label}»: ${title} — ${value ? 'отмечено' : 'снято'}`,
      undo: [{ method: 'PATCH', path: `/projects/${e.id}/launch-checklist`, body: { item: args.item, value: was } }],
    };
  },
};

export const briefShareLink: ToolDef<{ project: string }> = {
  name: 'brief_share_link',
  kind: 'write',
  description:
    'Получить публичную ссылку, по которой КЛИЕНТ сам заполнит бриф СММ-проекта (без входа). «Дай ссылку на бриф для Кофеина». '
    + 'Бот ссылку клиенту не отправляет — её передаёт человек. Только СММ-проекты.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, 'admin', 'founder', 'smm_director', 'smm_specialist', 'sales_manager_smm', 'sales_manager_dev'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    let res: any;
    try { res = await ctx.api.post(`/projects/${e.id}/brief/share-link`, {}); } catch (err) { throw apiErr(err); }
    if (!res?.url) throw new ToolError('Не удалось получить ссылку на бриф.');
    return { summary: `🔗 Ссылка на бриф «${e.label}» (для клиента):\n${res.url}` };
  },
};

export const clearProjectBrief: ToolDef<{ project: string }> = {
  name: 'clear_project_brief',
  kind: 'write',
  description: 'Стереть заполненный бриф СММ-проекта целиком. Только если прямо сказано «очисти / удали бриф». Вернуть нельзя.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  available: has('projects.brief.clear'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    return `🗑 СТЕРЕТЬ БРИФ ПРОЕКТА «${e.label}»\nВсе ответы клиента пропадут, вернуть нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    try { await ctx.api.delete(`/projects/${e.id}/brief`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Бриф проекта «${e.label}» стёрт` };
  },
};

// ─── СММ-настройки проекта ──────────────────────────────────────────────

interface CycleArgs { project: string; cycle_day?: number | 'none'; norm_reels?: number; norm_posts?: number; stories_per_month?: number }

export const setSmmCycle: ToolDef<CycleArgs> = {
  name: 'set_smm_cycle',
  kind: 'write',
  description:
    'Настройки месячного цикла СММ-проекта (Умный календарь): день старта цикла (1–31), норма за цикл — рилсы, посты, сторис в месяц. '
    + '«Поставь Кофеину норму 12 рилсов и 8 постов», «цикл с 5 числа». Только СММ-проекты. '
    + 'НЕ для публикаций контент-плана (set_content_status, move_content).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      cycle_day: { type: 'integer', description: 'День старта цикла 1–31.' },
      norm_reels: { type: 'integer', description: 'Рилсов за цикл, 0–999.' },
      norm_posts: { type: 'integer', description: 'Постов за цикл, 0–999.' },
      stories_per_month: { type: 'integer', description: 'Сторис в месяц, 0–100.' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, 'admin', 'founder', 'smm_director', 'smm_specialist'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    if (p.projectType !== 'SMM') throw new ToolError('Цикл и норма бывают только у СММ-проектов.');
    const sd = p.smmData || {};
    const patch: Record<string, number> = {};
    const undo: Record<string, number | null> = {};
    const parts: string[] = [];
    if (args.cycle_day != null) {
      patch.day = intInRange(args.cycle_day, 1, 31, 'день старта цикла');
      undo.day = sd.cycleStartDay ?? null;
      parts.push(`цикл с ${patch.day} числа`);
    }
    if (args.norm_reels != null) {
      patch.normReels = intInRange(args.norm_reels, 0, 999, 'рилсов за цикл');
      undo.normReels = sd.normReels ?? null;
      parts.push(`рилсов ${patch.normReels}`);
    }
    if (args.norm_posts != null) {
      patch.normPosts = intInRange(args.norm_posts, 0, 999, 'постов за цикл');
      undo.normPosts = sd.normPosts ?? null;
      parts.push(`постов ${patch.normPosts}`);
    }
    if (args.stories_per_month != null) {
      patch.storiesPerMonth = intInRange(args.stories_per_month, 0, 100, 'сторис в месяц');
      undo.storiesPerMonth = sd.storiesPerMonth ?? null;
      parts.push(`сторис в месяц ${patch.storiesPerMonth}`);
    }
    if (!parts.length) throw new ToolError('Не понял, что менять: день цикла, рилсы, посты или сторис.');
    try { await ctx.api.patch(`/projects/${e.id}/smm-cycle`, patch); } catch (err) { throw apiErr(err); }
    return {
      summary: `🗓 «${p.name}»: ${parts.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/projects/${e.id}/smm-cycle`, body: undo }],
    };
  },
};

export const setSmmProjectManager: ToolDef<{ project: string; manager?: string }> = {
  name: 'set_smm_project_manager',
  kind: 'write',
  description:
    'Назначить ОТВЕТСТВЕННОГО менеджера по продажам за СММ-проект (поле «Ответственный менеджер»; только основатель). '
    + 'Без manager — снять ответственного. Это не «менеджер проекта» (update_project) и не специалист проекта.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      manager: { type: 'string', description: 'Метка E… менеджера по продажам. Не указывай, чтобы снять.' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, 'founder'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const m = args.manager ? ensureEmployee(ctx, args.manager) : null;
    return m
      ? `👤 НАЗНАЧИТЬ ОТВЕТСТВЕННОГО МЕНЕДЖЕРА\n📁 ${e.label}\n👤 ${m.label}`
      : `👤 СНЯТЬ ОТВЕТСТВЕННОГО МЕНЕДЖЕРА\n📁 ${e.label}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const p = await loadProject(ctx, e.id);
    const m = args.manager ? ensureEmployee(ctx, args.manager) : null;
    const prev: string | null = p.smmData?.salesManagerId ?? null;
    try { await ctx.api.patch(`/projects/${e.id}/smm-manager`, { managerId: m ? m.id : null }); } catch (err) { throw apiErr(err); }
    return {
      summary: m ? `👤 «${p.name}»: ответственный менеджер — ${m.label}` : `👤 «${p.name}»: ответственный менеджер снят`,
      undo: [{ method: 'PATCH', path: `/projects/${e.id}/smm-manager`, body: { managerId: prev } }],
    };
  },
};

const CREW: Record<string, { key: string; label: string; role: string[] }> = {
  smm_specialist: { key: 'smmSpecialistIds', label: 'СММ-специалисты', role: ['smm_specialist', 'smm_director'] },
  videographer: { key: 'videographerIds', label: 'видеографы', role: ['videographer'] },
  video_editor: { key: 'videoEditorIds', label: 'монтажёры', role: ['video_editor'] },
  designer: { key: 'designerIds', label: 'дизайнеры', role: ['designer'] },
};

interface CrewArgs { project: string; kind: string; add?: string[]; remove?: string[] }

export const setProjectCrew: ToolDef<CrewArgs> = {
  name: 'set_project_crew',
  kind: 'write',
  description:
    'Команда СММ-проекта: назначить или снять СММ-специалиста, видеографа, монтажёра, дизайнера. '
    + '«Назначь Фирузу СММ-специалистом на Кофеин», «видеограф на проект — Рустам». Только СММ-проекты; человек должен иметь подходящую роль. '
    + 'СММ-специалистов переставляют руководство и руководитель СММ (сам специалист и продюсер — нет). '
    + 'НЕ для общего состава проекта (set_project_members).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      kind: { type: 'string', enum: Object.keys(CREW), description: 'smm_specialist, videographer, video_editor или designer.' },
      add: { type: 'array', items: { type: 'string' }, description: 'Метки E… кого назначить.' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Метки E… кого снять.' },
    },
    required: ['project', 'kind'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, 'admin', 'founder', 'smm_director', 'smm_specialist', 'producer'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = projectEntry(ctx, args.project);
    const crew = CREW[args.kind];
    if (!crew) throw new ToolError('Не понял, кого назначать: специалиста, видеографа, монтажёра или дизайнера.');
    const add = people(ctx, args.add, 'add');
    const remove = people(ctx, args.remove, 'remove');
    if (!add.length && !remove.length) throw new ToolError('Не понял, кого назначить или снять.');
    return `👥 КОМАНДА ПРОЕКТА «${e.label}» — ${crew.label}`
      + (add.length ? `\n➕ Назначить: ${add.map((a) => a.label).join(', ')}` : '')
      + (remove.length ? `\n➖ Снять: ${remove.map((a) => a.label).join(', ')}` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = projectEntry(ctx, args.project);
    const crew = CREW[args.kind];
    if (!crew) throw new ToolError('Не понял, кого назначать: специалиста, видеографа, монтажёра или дизайнера.');
    if (args.kind === 'smm_specialist' && (ctx.user.role === 'smm_specialist' || ctx.user.role === 'producer')) {
      throw new ToolError('СММ-специалистов на проекты назначают руководство и руководитель СММ — у вас такого права нет.');
    }
    const add = people(ctx, args.add, 'add');
    const remove = people(ctx, args.remove, 'remove');
    if (!add.length && !remove.length) throw new ToolError('Не понял, кого назначить или снять.');
    const p = await loadProject(ctx, e.id);
    if (p.projectType !== 'SMM') throw new ToolError('Такая команда бывает только у СММ-проектов.');
    const current: string[] = Array.isArray(p.smmData?.[crew.key]) ? p.smmData[crew.key] : [];
    const next = new Set(current);
    for (const a of add) next.add(a.id);
    for (const r of remove) next.delete(r.id);
    const added = add.filter((a) => !current.includes(a.id));
    const removed = remove.filter((r) => current.includes(r.id));
    if (!added.length && !removed.length) return { summary: `ℹ️ В проекте «${p.name}» эта команда уже такая` };
    if (next.size > 10) throw new ToolError('В команде не может быть больше 10 человек.');
    try { await ctx.api.patch(`/projects/${e.id}/smm-profile`, { [crew.key]: [...next] }); } catch (err) { throw apiErr(err); }
    // Сервер молча отбрасывает людей с неподходящей ролью — проверяем результат, а не верим ответу.
    const after = await loadProject(ctx, e.id);
    const saved: string[] = Array.isArray(after.smmData?.[crew.key]) ? after.smmData[crew.key] : [];
    const rejected = added.filter((a) => !saved.includes(a.id));
    if (rejected.length) {
      throw new ToolError(`Не назначены: ${rejected.map((r) => r.label).join(', ')} — у них нет подходящей роли (${crew.label}).`);
    }
    return {
      summary: `👥 «${p.name}», ${crew.label}`
        + (added.length ? `: назначены ${added.map((a) => a.label).join(', ')}` : '')
        + (removed.length ? `${added.length ? ';' : ':'} сняты ${removed.map((a) => a.label).join(', ')}` : ''),
      undo: [{ method: 'PATCH', path: `/projects/${e.id}/smm-profile`, body: { [crew.key]: current } }],
    };
  },
};

export const PROJECTS_TOOLS: ToolDef[] = [
  projectDetails, projectPayments, projectAnnouncements, projectLaunchChecklist, projectBrief,
  createProject, updateProject, setProjectMembers, archiveProject, restoreProject, deleteProject,
  setDevStage, requestProjectPayment, postProjectAnnouncement, deleteProjectAnnouncement,
  setLaunchItem, briefShareLink, clearProjectBrief, setSmmCycle, setSmmProjectManager, setProjectCrew,
];
