import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import {
  checkDate as checkDateLoose, esc, fmtDateRu, matchScore, nameScore, norm, roles, splitDushanbe, addDays,
} from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * «Администрирование» голосом: карточки сотрудников и доступы, чек-листы задач,
 * личные заметки, уведомления, календарь и свои отчёты. Всё — через API сайта,
 * права повторяют сайт (employees.*, admin/founder для /users, notes.use, ...).
 *
 * Чего нет намеренно: удаление сотрудника (сносит учётку, комментарии и отчёты
 * без возврата — на сайте это «Удалить», а не «Уволить»; для отключения доступа
 * есть блокировка), сброс пароля, загрузка фото.
 */

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const isTop = (u: any) => roles(u).some((r) => r === 'admin' || r === 'founder');
const grant = (key: string) => (u: any) => hasGrant(u, key);

const ROLE_RU: Record<string, string> = {
  admin: 'админ', founder: 'основатель', smm_director: 'руководитель СММ', dev_director: 'руководитель разработки',
  smm_specialist: 'СММ-специалист', designer: 'дизайнер', sales_manager_smm: 'менеджер продаж СММ',
  sales_manager_dev: 'менеджер продаж разработки', pm_dev: 'проект-менеджер разработки', developer: 'разработчик',
  videographer: 'видеограф', video_editor: 'монтажёр', producer: 'продюсер', targetologist: 'таргетолог',
  stories_checker: 'проверяющий сторис', employee: 'сотрудник',
};

/** Должности из формы сайта (без «Основателя» и «Администратора» — их голосом не выдаём). */
const POSITION_ROLE: Record<string, string> = {
  'Руководитель SMM': 'smm_director',
  'SMM специалист': 'smm_specialist',
  'Дизайнер': 'designer',
  'Видеограф': 'videographer',
  'Монтажёр': 'video_editor',
  'Продюсер': 'producer',
  'Проверяющий сторис': 'stories_checker',
  'Таргетолог': 'targetologist',
  'Менеджер продаж (СММ)': 'sales_manager_smm',
  'Менеджер продаж (Разработка)': 'sales_manager_dev',
  'Проект-менеджер (Разработка)': 'pm_dev',
  'Разработчик': 'developer',
};
const POSITIONS = Object.keys(POSITION_ROLE);

/** Дата из поля типа date (строка) или из момента времени. */
function dayOf(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return splitDushanbe(s)?.date ?? null;
}

/** Как checkDate, но несуществующие дни (31 февраля) не пропускает. */
function checkDate(value: unknown, field = 'дата'): string {
  const s = checkDateLoose(value, field);
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new ToolError(`Неверная ${field}: «${s}» — такого дня нет.`);
  return s;
}

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

// ═══ Сотрудники ═════════════════════════════════════════════════════════

async function loadRows(ctx: ToolContext): Promise<any[]> {
  try {
    const list = await ctx.api.get<any[]>('/employees');
    return Array.isArray(list) ? list.filter((e) => e?.id) : [];
  } catch (e) { throw apiErr(e); }
}

/** Сотрудник по метке E… или по имени. Неоднозначность — ошибка со списком. */
async function pickEmployee(ctx: ToolContext, spoken: unknown): Promise<any> {
  const s = String(spoken ?? '').trim();
  if (!s) throw new ToolError('Какой сотрудник? Назовите имя.');
  const rows = await loadRows(ctx);
  const byRef = ctx.refs.resolve('E', s);
  let row: any = byRef ? rows.find((r) => r.userId === byRef.id) : undefined;
  if (!row) {
    if (/^E\d+$/i.test(s)) throw new ToolError(`Нет сотрудника с меткой «${s}». Найдите его через find_employees.`);
    const scored = rows
      .map((r) => ({ r, sc: Math.max(nameScore(String(r.fullName || ''), s), nameScore(s, String(r.fullName || ''))) }))
      .filter((x) => x.sc >= 0.5)
      .sort((a, b) => b.sc - a.sc);
    if (!scored.length) throw new ToolError(`Сотрудника «${s}» не нашла. Назовите имя точнее.`);
    const exact = scored.filter((x) => norm(x.r.fullName) === norm(s));
    if (exact.length === 1) {
      row = exact[0].r;
    } else if (scored.length > 1 && scored[0].sc === scored[1].sc) {
      const opts = scored.filter((x) => x.sc === scored[0].sc).slice(0, 6).map((x) => x.r.fullName);
      throw new ToolError(`Под «${s}» подходят несколько: ${opts.join(', ')}. Уточните через ask_choice.`);
    } else {
      row = scored[0].r;
    }
  }
  if (row.userId) ctx.refs.add('E', row.userId, String(row.fullName || ''));
  return row;
}

const employeeRef = (ctx: ToolContext, row: any) => (row.userId ? ctx.refs.add('E', row.userId, String(row.fullName || '')) : undefined);

export const employeeCard: ToolDef<{ employee: string }> = {
  name: 'employee_card',
  kind: 'read',
  description:
    'Карточка сотрудника: должность, телефон, Telegram, Instagram, дата рождения и найма, статус, заблокирован ли; '
    + 'зарплата — только тем, кому она положена. «Какой телефон у Фирузы», «когда нанят Мухаммадамин», «кто на должности дизайнера». '
    + 'Не для задач и смен сотрудника и не для списка всех (список — find_employees).',
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Метка E… или имя.' } },
    required: ['employee'],
    additionalProperties: false,
  },
  available: grant('employees.view'),
  async run(args, ctx) {
    const r = await pickEmployee(ctx, args.employee);
    const u = r.user || {};
    const vac = r.status === 'vacation' ? { from: dayOf(r.vacationFrom), until: dayOf(r.vacationUntil), paid: !!r.vacationPaid } : undefined;
    return {
      ref: employeeRef(ctx, r),
      name: r.fullName,
      position: r.position,
      department: r.department,
      role: u.role ? ROLE_RU[u.role] || u.role : undefined,
      secondaryRole: u.secondaryRole ? ROLE_RU[u.secondaryRole] || u.secondaryRole : undefined,
      status: r.status,
      ...(u.isBlocked ? { blocked: true, blockReason: u.blockReason || undefined } : {}),
      email: r.email,
      phone: r.phone || undefined,
      telegram: r.telegram || undefined,
      instagram: r.instagram || undefined,
      birthDate: dayOf(r.birthDate) || undefined,
      hireDate: dayOf(r.hireDate) || undefined,
      vacation: vac,
      bio: r.bio ? clip(r.bio, 300) : undefined,
      ...(hasGrant(ctx.user as any, 'employees.salary.view') && r.salary != null ? { salary: Number(r.salary) } : {}),
    };
  },
};

interface UpdateCardArgs {
  employee: string; full_name?: string; position?: string; phone?: string; telegram?: string;
  instagram?: string; birth_date?: string; bio?: string; salary?: number;
}

const normTelegram = (v: string) => { const t = v.trim().replace(/^@+/, ''); return t ? `@${t}` : ''; };

/** Что поменяется: поля DTO, прежние значения и строки для показа. */
async function prepareCardUpdate(args: UpdateCardArgs, ctx: ToolContext) {
  const row = await pickEmployee(ctx, args.employee);
  const body: Record<string, any> = {};
  const before: Record<string, any> = {};
  const lines: string[] = [];
  const change = (field: string, label: string, next: any, prev: any, show: (v: any) => string) => {
    if ((prev ?? null) === next) return;
    body[field] = next;
    before[field] = prev ?? null;
    lines.push(`• ${label}: ${prev == null || prev === '' ? '—' : show(prev)} → ${show(next)}`);
  };
  const txt = (v: any) => esc(String(v));

  if (args.full_name !== undefined) {
    const v = clip(args.full_name, 120);
    if (!v) throw new ToolError('Имя не может быть пустым.');
    change('fullName', 'Имя', v, row.fullName, txt);
  }
  if (args.position !== undefined) {
    if (!POSITIONS.includes(args.position)) throw new ToolError(`Должность — одна из: ${POSITIONS.join(', ')}.`);
    change('position', 'Должность', args.position, row.position, txt);
  }
  if (args.phone !== undefined) {
    const v = clip(args.phone, 40);
    if (!v) throw new ToolError('Какой номер телефона записать?');
    change('phone', 'Телефон', v, row.phone, txt);
  }
  if (args.telegram !== undefined) {
    const v = normTelegram(clip(args.telegram, 64));
    if (!v) throw new ToolError('Какой Telegram записать?');
    change('telegram', 'Telegram', v, row.telegram, txt);
  }
  if (args.instagram !== undefined) {
    const v = clip(args.instagram, 64);
    if (!v) throw new ToolError('Какой Instagram записать?');
    change('instagram', 'Instagram', v, row.instagram, txt);
  }
  if (args.birth_date !== undefined) {
    change('birthDate', 'Дата рождения', checkDate(args.birth_date, 'дата рождения'), dayOf(row.birthDate), (v) => fmtDateRu(String(v)));
  }
  if (args.bio !== undefined) {
    const v = clip(args.bio, 1000);
    if (!v) throw new ToolError('Что записать в «О себе»?');
    change('bio', 'О сотруднике', v, row.bio, txt);
  }
  if (args.salary !== undefined) {
    if (!hasGrant(ctx.user as any, 'employees.salary.view')) {
      throw new ToolError('Менять зарплату сотрудника могут только те, кому открыт доступ к зарплатам.');
    }
    const n = Math.round(Number(args.salary));
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new ToolError('Зарплата — число от 0 до 10 000 000.');
    change('salary', 'Зарплата', n, row.salary != null ? Number(row.salary) : null, (v) => `${Number(v).toLocaleString('ru-RU')} сом.`);
  }
  if (!lines.length) throw new ToolError('Нечего менять: значения уже такие, или не назвали, что изменить.');
  return { row, body, before, lines };
}

export const updateEmployeeCard: ToolDef<UpdateCardArgs> = {
  name: 'update_employee_card',
  kind: 'write',
  description:
    'Изменить данные карточки сотрудника: имя, должность, телефон, Telegram, Instagram, дату рождения, «о себе», зарплату. '
    + '«Запиши Фирузе новый телефон 900 11 22 33», «Telegram Фарзоны @farzona», «переведи Али на должность дизайнера». '
    + 'Смена должности меняет и роль в системе (как на сайте). НЕ для блокировки (block_employee), НЕ для доступов '
    + '(set_employee_access), НЕ для отпуска и статуса, НЕ для штрафов и премий.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… или имя.' },
      full_name: { type: 'string' },
      position: { type: 'string', enum: POSITIONS, description: 'Только из списка должностей сайта.' },
      phone: { type: 'string' },
      telegram: { type: 'string', description: 'Ник, с @ или без.' },
      instagram: { type: 'string' },
      birth_date: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
      bio: { type: 'string' },
      salary: { type: 'number', description: 'Оклад в сомони — только если сказано про зарплату/оклад.' },
    },
    required: ['employee'],
    additionalProperties: false,
  },
  available: grant('employees.edit'),
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareCardUpdate(args, ctx);
    return `✏️ ИЗМЕНИТЬ КАРТОЧКУ СОТРУДНИКА\n👤 ${esc(p.row.fullName)}\n${p.lines.join('\n')}`
      + (p.body.position ? '\n⚠️ Смена должности меняет роль в системе, сотрудник получит уведомление.' : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareCardUpdate(args, ctx);
    try { await ctx.api.patch(`/employees/${p.row.id}`, p.body); } catch (e) { throw apiErr(e); }
    return {
      summary: `✏️ Карточка «${p.row.fullName}» обновлена: ${Object.keys(p.body).length} поле(й)`,
      // Должность тянет за собой роль и письмо сотруднику — честно вернуть нельзя.
      undo: p.body.position ? undefined : [{ method: 'PATCH', path: `/employees/${p.row.id}`, body: p.before }],
    };
  },
};

interface CreateEmployeeArgs {
  full_name: string; position: string; email: string; phone?: string; telegram?: string;
  instagram?: string; birth_date?: string; hire_date?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function prepareCreate(args: CreateEmployeeArgs, ctx: ToolContext) {
  const fullName = clip(args.full_name, 120);
  if (!fullName) throw new ToolError('Как зовут нового сотрудника?');
  if (!POSITIONS.includes(args.position)) throw new ToolError(`На какую должность? Одна из: ${POSITIONS.join(', ')}.`);
  const email = clip(args.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ToolError('Нужен рабочий email сотрудника (по нему он входит в CRM). Назовите его.');
  const tg = args.telegram !== undefined ? normTelegram(clip(args.telegram, 64)) : '';
  const body: Record<string, any> = {
    fullName, position: args.position, department: 'Общий', email,
    hireDate: args.hire_date ? checkDate(args.hire_date, 'дата найма') : ctx.today,
    status: 'active', role: POSITION_ROLE[args.position],
    ...(clip(args.phone, 40) ? { phone: clip(args.phone, 40) } : {}),
    ...(tg ? { telegram: tg } : {}),
    ...(clip(args.instagram, 64) ? { instagram: clip(args.instagram, 64) } : {}),
    ...(args.birth_date ? { birthDate: checkDate(args.birth_date, 'дата рождения') } : {}),
  };
  return body;
}

export const createEmployee: ToolDef<CreateEmployeeArgs> = {
  name: 'create_employee',
  kind: 'write',
  description:
    'Завести нового сотрудника, как кнопка «Добавить» на сайте: имя, должность, email — обязательно. Учётка создаётся '
    + 'со стандартным паролем. «Добавь сотрудника Али, дизайнер, ali@gmail.com». Если email не назвали — спроси, не выдумывай. '
    + 'Админов и основателей так не заводят. НЕ для клиентов и лидов (create_lead).',
  parameters: {
    type: 'object',
    properties: {
      full_name: { type: 'string' },
      position: { type: 'string', enum: POSITIONS },
      email: { type: 'string' },
      phone: { type: 'string' },
      telegram: { type: 'string' },
      instagram: { type: 'string' },
      birth_date: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
      hire_date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
    },
    required: ['full_name', 'position', 'email'],
    additionalProperties: false,
  },
  available: grant('employees.create'),
  confirm: () => true,
  async preview(args, ctx) {
    const b = prepareCreate(args, ctx);
    return `🆕 ДОБАВИТЬ СОТРУДНИКА\n👤 ${esc(b.fullName)}\n🏷 ${esc(b.position)} (роль: ${ROLE_RU[b.role] || b.role})\n✉️ ${esc(b.email)}`
      + `${b.phone ? `\n📞 ${esc(b.phone)}` : ''}${b.telegram ? `\n💬 ${esc(b.telegram)}` : ''}\n📅 Принят ${fmtDateRu(b.hireDate)}`
      + '\n🔑 Войдёт со стандартным паролем — как при создании на сайте.';
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const b = prepareCreate(args, ctx);
    let created: any;
    try { created = await ctx.api.post('/employees', b); } catch (e) { throw apiErr(e); }
    return {
      summary: `🆕 Сотрудник «${b.fullName}» добавлен (${b.position})`,
      undo: created?.id && hasGrant(ctx.user as any, 'employees.delete')
        ? [{ method: 'DELETE', path: `/employees/${created.id}` }]
        : undefined,
    };
  },
};

export const blockEmployee: ToolDef<{ employee: string; reason?: string }> = {
  name: 'block_employee',
  kind: 'write',
  description:
    'Заблокировать учётку сотрудника: он сразу вылетает из CRM и не войдёт, пока не разблокируют. «Заблокируй Али, он ушёл». '
    + 'Причину записывай только ту, что назвали. Это НЕ удаление сотрудника и НЕ отпуск.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… или имя.' },
      reason: { type: 'string', description: 'Причина — только если человек её назвал.' },
    },
    required: ['employee'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const row = await blockTarget(args.employee, ctx, false);
    const reason = clip(args.reason, 500);
    return `🔒 ЗАБЛОКИРОВАТЬ СОТРУДНИКА\n👤 ${esc(row.fullName)}\n📝 ${reason ? esc(reason) : 'причина не указана'}\nОн сразу потеряет доступ к CRM.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const row = await blockTarget(args.employee, ctx, false);
    const reason = clip(args.reason, 500);
    try { await ctx.api.patch(`/users/${row.userId}/block`, reason ? { reason } : {}); } catch (e) { throw apiErr(e); }
    return {
      summary: `🔒 ${row.fullName} заблокирован${reason ? ` (${reason})` : ''}`,
      undo: [{ method: 'PATCH', path: `/users/${row.userId}/unblock` }],
    };
  },
};

export const unblockEmployee: ToolDef<{ employee: string }> = {
  name: 'unblock_employee',
  kind: 'write',
  description: 'Разблокировать учётку сотрудника: «разблокируй Али». Только для заблокированных.',
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Метка E… или имя.' } },
    required: ['employee'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const row = await blockTarget(args.employee, ctx, true);
    return `🔓 РАЗБЛОКИРОВАТЬ СОТРУДНИКА\n👤 ${esc(row.fullName)}\nОн снова сможет войти в CRM.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const row = await blockTarget(args.employee, ctx, true);
    try { await ctx.api.patch(`/users/${row.userId}/unblock`); } catch (e) { throw apiErr(e); }
    const reason = row.user?.blockReason;
    return {
      summary: `🔓 ${row.fullName} разблокирован`,
      undo: [{ method: 'PATCH', path: `/users/${row.userId}/block`, body: reason ? { reason: clip(reason, 500) } : {} }],
    };
  },
};

/** Сотрудник для блокировки/разблокировки: нужна учётка и подходящее состояние. */
async function blockTarget(spoken: string, ctx: ToolContext, wantBlocked: boolean): Promise<any> {
  const row = await pickEmployee(ctx, spoken);
  if (!row.userId) throw new ToolError(`У «${row.fullName}» нет учётки CRM.`);
  if (row.userId === ctx.user.id) throw new ToolError('Себя блокировать нельзя.');
  const blocked = !!row.user?.isBlocked;
  if (wantBlocked && !blocked) throw new ToolError(`«${row.fullName}» не заблокирован.`);
  if (!wantBlocked && blocked) throw new ToolError(`«${row.fullName}» уже заблокирован.`);
  return row;
}

// ─── Доступы сотрудников ────────────────────────────────────────────────

interface CatalogItem { key: string; label: string; category: string; roles: string[]; danger: boolean }
interface AccessRow {
  id: string; name: string; role: string; secondaryRole: string | null; position: string | null;
  extraPermissions: string[]; deniedPermissions: string[]; isActive: boolean;
}

async function loadCatalog(ctx: ToolContext): Promise<CatalogItem[]> {
  try { return (await ctx.api.get<CatalogItem[]>('/users/access/catalog')) || []; } catch (e) { throw apiErr(e); }
}

async function loadAccess(ctx: ToolContext): Promise<AccessRow[]> {
  try { return (await ctx.api.get<AccessRow[]>('/users/access')) || []; } catch (e) { throw apiErr(e); }
}

function pickAccessUser(ctx: ToolContext, list: AccessRow[], spoken: unknown): AccessRow {
  const s = String(spoken ?? '').trim();
  if (!s) throw new ToolError('Какому сотруднику? Назовите имя.');
  const byRef = ctx.refs.resolve('E', s);
  if (byRef) {
    const u = list.find((x) => x.id === byRef.id);
    if (u) return u;
  }
  if (/^E\d+$/i.test(s)) throw new ToolError(`Нет сотрудника с меткой «${s}». Найдите его через find_employees.`);
  const scored = list
    .map((u) => ({ u, sc: Math.max(nameScore(u.name, s), nameScore(s, u.name)) }))
    .filter((x) => x.sc >= 0.5)
    .sort((a, b) => b.sc - a.sc);
  if (!scored.length) throw new ToolError(`Сотрудника «${s}» не нашла.`);
  const exact = scored.filter((x) => norm(x.u.name) === norm(s));
  if (exact.length !== 1 && scored.length > 1 && scored[0].sc === scored[1].sc) {
    const opts = scored.filter((x) => x.sc === scored[0].sc).slice(0, 6).map((x) => x.u.name);
    throw new ToolError(`Под «${s}» подходят несколько: ${opts.join(', ')}. Уточните через ask_choice.`);
  }
  const chosen = exact.length === 1 ? exact[0].u : scored[0].u;
  ctx.refs.add('E', chosen.id, chosen.name);
  return chosen;
}

function pickGrant(catalog: CatalogItem[], spoken: unknown): CatalogItem {
  const s = String(spoken ?? '').trim();
  if (!s) throw new ToolError('Какой доступ? Посмотрите список через access_catalog.');
  const exact = catalog.find((c) => c.key === s.toLowerCase());
  if (exact) return exact;
  const scored = catalog
    .map((c) => ({ c, sc: matchScore(c.label, s) }))
    .filter((x) => x.sc >= 0.99)
    .sort((a, b) => a.c.label.length - b.c.label.length);
  if (scored.length === 1) return scored[0].c;
  const opts = (scored.length ? scored : catalog.map((c) => ({ c, sc: matchScore(c.label, s) })).filter((x) => x.sc >= 0.5))
    .slice(0, 6).map((x) => `${x.c.key} («${x.c.label}»)`);
  throw new ToolError(opts.length
    ? `Под «${s}» подходят несколько доступов: ${opts.join('; ')}. Уточните через ask_choice.`
    : `Доступа «${s}» нет. Список — access_catalog.`);
}

const canHave = (u: AccessRow, extra: string[], denied: string[], key: string) =>
  hasGrant({ role: u.role, secondaryRole: u.secondaryRole, extraPermissions: extra, deniedPermissions: denied }, key);

export const accessCatalog: ToolDef<{ category?: string }> = {
  name: 'access_catalog',
  kind: 'read',
  description:
    'Список доступов, которые можно выдавать сотрудникам (как на странице «Доступы сотрудников»): ключ, название, раздел, '
    + 'чувствительный ли. Вызывай перед set_employee_access, чтобы взять точный ключ.',
  parameters: {
    type: 'object',
    properties: { category: { type: 'string', description: 'Часть названия раздела, например «Сотрудники», «Финансы».' } },
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    let items = await loadCatalog(ctx);
    if (args.category) items = items.filter((c) => matchScore(c.category, args.category!) >= 0.5);
    return { total: items.length, grants: items.map((c) => ({ key: c.key, label: c.label, category: c.category, ...(c.danger ? { sensitive: true } : {}) })) };
  },
};

export const employeeAccess: ToolDef<{ employee: string }> = {
  name: 'employee_access',
  kind: 'read',
  description:
    'Какие персональные доступы выданы сотруднику поверх роли и что у него отнято: «какие доступы у Фирузы», '
    + '«что Али дополнительно разрешено».',
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Метка E… или имя.' } },
    required: ['employee'],
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    const [list, catalog] = await Promise.all([loadAccess(ctx), loadCatalog(ctx)]);
    const u = pickAccessUser(ctx, list, args.employee);
    const label = (k: string) => `${k} («${catalog.find((c) => c.key === k)?.label || k}»)`;
    return {
      ref: ctx.refs.add('E', u.id, u.name),
      name: u.name,
      role: ROLE_RU[u.role] || u.role,
      secondaryRole: u.secondaryRole ? ROLE_RU[u.secondaryRole] || u.secondaryRole : undefined,
      given: u.extraPermissions.map(label),
      taken: u.deniedPermissions.map(label),
      active: u.isActive,
    };
  },
};

interface AccessArgs { employee: string; grant: string; action: 'give' | 'take' }

async function prepareAccess(args: AccessArgs, ctx: ToolContext) {
  if (args.action !== 'give' && args.action !== 'take') throw new ToolError('Выдать или забрать доступ?');
  const [list, catalog] = await Promise.all([loadAccess(ctx), loadCatalog(ctx)]);
  const user = pickAccessUser(ctx, list, args.employee);
  if (user.id === ctx.user.id) throw new ToolError('Свои собственные доступы менять нельзя — попросите основателя.');
  const g = pickGrant(catalog, args.grant);
  const extra = user.extraPermissions;
  const denied = user.deniedPermissions;
  const hasNow = canHave(user, extra, denied, g.key);
  let nextExtra = extra;
  let nextDenied = denied;
  if (args.action === 'give') {
    if (hasNow) throw new ToolError(`У «${user.name}» доступ «${g.label}» уже есть.`);
    nextDenied = denied.filter((k) => k !== g.key);
    if (!canHave(user, extra, nextDenied, g.key)) nextExtra = [...extra, g.key];
  } else {
    if (!hasNow) throw new ToolError(`У «${user.name}» доступа «${g.label}» и так нет.`);
    nextExtra = extra.filter((k) => k !== g.key);
    if (canHave(user, nextExtra, denied, g.key)) nextDenied = [...denied, g.key];
  }
  return { user, g, nextExtra, nextDenied };
}

export const setEmployeeAccess: ToolDef<AccessArgs> = {
  name: 'set_employee_access',
  kind: 'write',
  description:
    'Выдать или забрать один персональный доступ сотруднику (страница «Доступы сотрудников»): «дай Фирузе доступ к клиентам — '
    + 'просмотр», «забери у Али удаление задач». Ключ доступа бери из access_catalog (не выдумывай). '
    + 'Только для ключа из каталога; НЕ меняет роль и должность (это update_employee_card).',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка E… или имя.' },
      grant: { type: 'string', description: 'Ключ из access_catalog, например clients.view.' },
      action: { type: 'string', enum: ['give', 'take'], description: 'give — выдать, take — забрать.' },
    },
    required: ['employee', 'grant', 'action'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const p = await prepareAccess(args, ctx);
    const head = args.action === 'give' ? '🔑 ВЫДАТЬ ДОСТУП' : '🚫 ЗАБРАТЬ ДОСТУП';
    return `${head}\n👤 ${esc(p.user.name)} (${ROLE_RU[p.user.role] || p.user.role})\n🔐 ${esc(p.g.label)} [${p.g.key}]`
      + (p.g.danger ? '\n⚠️ Чувствительный доступ.' : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareAccess(args, ctx);
    try {
      await ctx.api.patch(`/users/${p.user.id}/access`, { permissions: p.nextExtra, denied: p.nextDenied });
    } catch (e) { throw apiErr(e); }
    return {
      summary: `${args.action === 'give' ? '🔑 Доступ выдан' : '🚫 Доступ отнят'}: «${p.g.label}» — ${p.user.name}`,
      undo: [{
        method: 'PATCH', path: `/users/${p.user.id}/access`,
        body: { permissions: p.user.extraPermissions, denied: p.user.deniedPermissions },
      }],
    };
  },
};

// ═══ Чек-листы задач ════════════════════════════════════════════════════

interface ChecklistItem { id: string; text: string; isDone: boolean; doneBy?: { name?: string } | null }

function taskOf(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('T', ref);
  if (!e) throw new ToolError(`Нет задачи с меткой «${ref}». Сначала найдите её через find_tasks.`);
  return e;
}

/** Метка K хранит «задача:пункт» — для пути API нужны оба id. */
function itemOf(ctx: ToolContext, ref: unknown): { taskId: string; itemId: string; label: string } {
  const e = ctx.refs.resolve('K', ref);
  const [taskId, itemId] = (e?.id || '').split(':');
  if (!e || !taskId || !itemId) throw new ToolError(`Нет пункта с меткой «${ref}». Сначала откройте чек-лист через task_checklist.`);
  return { taskId, itemId, label: e.label };
}

async function loadChecklist(ctx: ToolContext, taskId: string): Promise<ChecklistItem[]> {
  try {
    const list = await ctx.api.get<ChecklistItem[]>(`/tasks/${taskId}/checklist`);
    return Array.isArray(list) ? list : [];
  } catch (e) { throw apiErr(e); }
}

export const taskChecklist: ToolDef<{ task: string }> = {
  name: 'task_checklist',
  kind: 'read',
  description:
    'Чек-лист задачи: пункты (метки K…), что отмечено, прогресс. «Что в чек-листе задачи», «сколько пунктов осталось». '
    + 'Это не подзадачи и не комментарии.',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string', description: 'Метка задачи T…' } },
    required: ['task'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const t = taskOf(ctx, args.task);
    const items = await loadChecklist(ctx, t.id);
    const done = items.filter((i) => i.isDone).length;
    return {
      task: t.label,
      progress: { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 0 },
      items: items.map((i) => ({
        ref: ctx.refs.add('K', `${t.id}:${i.id}`, i.text),
        text: i.text,
        done: !!i.isDone,
        ...(i.isDone && i.doneBy?.name ? { doneBy: i.doneBy.name } : {}),
      })),
    };
  },
};

export const checklistAdd: ToolDef<{ task: string; texts: string[] }> = {
  name: 'checklist_add',
  kind: 'write',
  description:
    'Добавить пункты в чек-лист задачи: «добавь в чек-лист задачи: макет, тексты, согласование». Каждый пункт — отдельной строкой в texts. '
    + 'НЕ для комментария к задаче (comment_task) и не для новой задачи (create_task).',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Метка задачи T…' },
      texts: { type: 'array', items: { type: 'string' }, description: 'Тексты пунктов, 1–20.' },
    },
    required: ['task', 'texts'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const t = taskOf(ctx, args.task);
    const texts = (Array.isArray(args.texts) ? args.texts : []).map((x) => clip(x, 500)).filter(Boolean);
    if (!texts.length || texts.length > 20) throw new ToolError('Назовите от 1 до 20 пунктов.');
    const ids: string[] = [];
    try {
      for (const text of texts) {
        const created = await ctx.api.post<{ id?: string }>(`/tasks/${t.id}/checklist`, { text });
        if (created?.id) ids.push(created.id);
      }
    } catch (e) {
      const err = apiErr(e);
      if (!ids.length) throw err;
      throw new ToolError(`Добавлено только ${ids.length} из ${texts.length}: ${err.message}`);
    }
    return {
      summary: `☑️ В чек-лист «${t.label}» добавлено: ${texts.length}`,
      undo: ids.map((id) => ({ method: 'DELETE' as const, path: `/tasks/${t.id}/checklist/${id}` })),
    };
  },
};

export const checklistSet: ToolDef<{ item: string; done: boolean }> = {
  name: 'checklist_set',
  kind: 'write',
  description:
    'Отметить пункт чек-листа выполненным или снять отметку: «отметь пункт макет», «сними галочку с согласования». '
    + 'Метку K… берёт из task_checklist. Если пункт уже в нужном состоянии — ничего не меняет. НЕ меняет статус самой задачи.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка пункта K…' },
      done: { type: 'boolean', description: 'true — выполнен, false — снять отметку.' },
    },
    required: ['item', 'done'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const it = itemOf(ctx, args.item);
    const want = args.done === true;
    const current = (await loadChecklist(ctx, it.taskId)).find((i) => i.id === it.itemId);
    if (!current) throw new ToolError('Такого пункта в чек-листе уже нет.');
    if (!!current.isDone === want) {
      return { summary: `ℹ️ Пункт «${it.label}» уже ${want ? 'отмечен' : 'без отметки'}` };
    }
    try { await ctx.api.patch(`/tasks/${it.taskId}/checklist/${it.itemId}/toggle`); } catch (e) { throw apiErr(e); }
    return {
      summary: `${want ? '✅ Отмечено' : '⬜ Отметка снята'}: «${it.label}»`,
      undo: [{ method: 'PATCH', path: `/tasks/${it.taskId}/checklist/${it.itemId}/toggle` }],
    };
  },
};

export const checklistEdit: ToolDef<{ item: string; text: string }> = {
  name: 'checklist_edit',
  kind: 'write',
  description: 'Переименовать пункт чек-листа: «поменяй пункт макет на макет баннера». Метка K… из task_checklist.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка пункта K…' },
      text: { type: 'string', description: 'Новый текст.' },
    },
    required: ['item', 'text'],
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const it = itemOf(ctx, args.item);
    const text = clip(args.text, 500);
    if (!text) throw new ToolError('Какой текст у пункта?');
    const current = (await loadChecklist(ctx, it.taskId)).find((i) => i.id === it.itemId);
    if (!current) throw new ToolError('Такого пункта в чек-листе уже нет.');
    try { await ctx.api.patch(`/tasks/${it.taskId}/checklist/${it.itemId}`, { text }); } catch (e) { throw apiErr(e); }
    return {
      summary: `✏️ Пункт «${current.text}» → «${text}»`,
      undo: [{ method: 'PATCH', path: `/tasks/${it.taskId}/checklist/${it.itemId}`, body: { text: current.text } }],
    };
  },
};

export const checklistDelete: ToolDef<{ item: string }> = {
  name: 'checklist_delete',
  kind: 'write',
  description: 'Удалить пункт из чек-листа задачи: «убери пункт согласование». Метка K… из task_checklist. Это не «отметить выполненным».',
  parameters: {
    type: 'object',
    properties: { item: { type: 'string', description: 'Метка пункта K…' } },
    required: ['item'],
    additionalProperties: false,
  },
  confirm: () => true,
  async preview(args, ctx) {
    const it = itemOf(ctx, args.item);
    return `🗑 УДАЛИТЬ ПУНКТ ЧЕК-ЛИСТА\n«${esc(it.label)}»`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const it = itemOf(ctx, args.item);
    try { await ctx.api.delete(`/tasks/${it.taskId}/checklist/${it.itemId}`); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 Пункт «${it.label}» удалён` };
  },
};

// ═══ Личные заметки ═════════════════════════════════════════════════════

const notesOn = grant('notes.use');

interface NoteRow { id: string; text: string; date: string | null; done: boolean }

async function loadNotes(ctx: ToolContext): Promise<NoteRow[]> {
  try {
    const list = await ctx.api.get<NoteRow[]>('/my-notes');
    return Array.isArray(list) ? list : [];
  } catch (e) { throw apiErr(e); }
}

function noteOf(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('N', ref);
  if (!e) throw new ToolError(`Нет заметки с меткой «${ref}». Сначала откройте список через my_notes.`);
  return e;
}

export const myNotes: ToolDef<{ text?: string; date?: string; open_only?: boolean }> = {
  name: 'my_notes',
  kind: 'read',
  description:
    'Мои личные заметки (видны только мне): «что в моих заметках», «заметки на завтра», «найди заметку про договор». '
    + 'Метки N… нужны для изменения и удаления. Это не задачи компании (find_tasks).',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Слова из заметки.' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД — заметки на этот день.' },
      open_only: { type: 'boolean', description: 'true — только невыполненные.' },
    },
    additionalProperties: false,
  },
  available: notesOn,
  async run(args, ctx) {
    let notes = await loadNotes(ctx);
    if (args.date) { const d = checkDate(args.date); notes = notes.filter((n) => dayOf(n.date) === d); }
    if (args.open_only) notes = notes.filter((n) => !n.done);
    if (args.text && norm(args.text)) {
      notes = notes
        .map((n) => ({ n, s: matchScore(n.text, args.text!) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.n);
    }
    return {
      total: notes.length,
      notes: notes.slice(0, 40).map((n) => ({
        ref: ctx.refs.add('N', n.id, clip(n.text, 60)),
        text: clip(n.text, 300),
        ...(dayOf(n.date) ? { date: dayOf(n.date) } : {}),
        done: !!n.done,
      })),
    };
  },
};

export const noteCreate: ToolDef<{ text: string; date?: string }> = {
  name: 'note_create',
  kind: 'write',
  description:
    'Записать личную заметку себе: «запиши заметку: позвонить в налоговую», «заметка на завтра — купить бумагу». '
    + 'Видна только мне. НЕ задача для коллеги (create_task) и не комментарий.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, если заметка к конкретному дню.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  available: notesOn,
  async run(args, ctx): Promise<WriteOutcome> {
    const text = clip(args.text, 2000);
    if (!text) throw new ToolError('Что записать в заметку?');
    const date = args.date ? checkDate(args.date) : undefined;
    let created: NoteRow;
    try { created = await ctx.api.post<NoteRow>('/my-notes', { text, ...(date ? { date } : {}) }); } catch (e) { throw apiErr(e); }
    return {
      summary: `📝 Заметка записана${date ? ` на ${fmtDateRu(date)}` : ''}: ${clip(text, 80)}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/my-notes/${created.id}` }] : undefined,
    };
  },
};

interface NoteUpdateArgs { note: string; text?: string; date?: string; clear_date?: boolean; done?: boolean }

export const noteUpdate: ToolDef<NoteUpdateArgs> = {
  name: 'note_update',
  kind: 'write',
  description:
    'Изменить свою заметку: текст, день, отметить выполненной или вернуть: «отметь заметку про налоговую выполненной», '
    + '«перенеси заметку на пятницу». Метка N… из my_notes.',
  parameters: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'Метка заметки N…' },
      text: { type: 'string' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
      clear_date: { type: 'boolean', description: 'true — убрать день.' },
      done: { type: 'boolean', description: 'true — выполнена, false — вернуть в работу.' },
    },
    required: ['note'],
    additionalProperties: false,
  },
  available: notesOn,
  async run(args, ctx): Promise<WriteOutcome> {
    const e = noteOf(ctx, args.note);
    const current = (await loadNotes(ctx)).find((n) => n.id === e.id);
    if (!current) throw new ToolError('Такой заметки уже нет.');
    const body: Record<string, any> = {};
    const before: Record<string, any> = {};
    if (args.text !== undefined) {
      const t = clip(args.text, 2000);
      if (!t) throw new ToolError('Текст заметки не может быть пустым.');
      body.text = t; before.text = current.text;
    }
    if (args.clear_date) { body.date = null; before.date = dayOf(current.date); }
    else if (args.date) { body.date = checkDate(args.date); before.date = dayOf(current.date); }
    if (args.done !== undefined) { body.done = args.done === true; before.done = !!current.done; }
    if (!Object.keys(body).length) throw new ToolError('Что изменить в заметке?');
    try { await ctx.api.patch(`/my-notes/${e.id}`, body); } catch (err) { throw apiErr(err); }
    return {
      summary: `📝 Заметка обновлена: ${clip(body.text ?? current.text, 80)}`,
      undo: [{ method: 'PATCH', path: `/my-notes/${e.id}`, body: before }],
    };
  },
};

export const noteDelete: ToolDef<{ note: string }> = {
  name: 'note_delete',
  kind: 'write',
  description: 'Удалить свою заметку: «удали заметку про налоговую». Метка N… из my_notes. Выполненной не отмечает.',
  parameters: {
    type: 'object',
    properties: { note: { type: 'string', description: 'Метка заметки N…' } },
    required: ['note'],
    additionalProperties: false,
  },
  available: notesOn,
  confirm: () => true,
  async preview(args, ctx) {
    const e = noteOf(ctx, args.note);
    return `🗑 УДАЛИТЬ ЗАМЕТКУ\n«${esc(e.label)}»`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = noteOf(ctx, args.note);
    try { await ctx.api.delete(`/my-notes/${e.id}`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Заметка удалена: ${e.label}` };
  },
};

// ═══ Уведомления ════════════════════════════════════════════════════════

export const myNotifications: ToolDef<{ include_read?: boolean }> = {
  name: 'my_notifications',
  kind: 'read',
  description:
    'Что у меня нового: уведомления с сайта (новые задачи, комментарии, сроки, отчёты). «Что нового», «есть уведомления», '
    + '«что я пропустил». По умолчанию только непрочитанные; include_read=true — и прочитанные. Метки X… — для mark_notifications_read.',
  parameters: {
    type: 'object',
    properties: { include_read: { type: 'boolean' } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    let list: any[];
    try {
      list = await ctx.api.get<any[]>('/notifications', args.include_read ? undefined : { unread: 'true' });
    } catch (e) { throw apiErr(e); }
    const items = Array.isArray(list) ? list : [];
    return {
      total: items.length,
      notifications: items.slice(0, 30).map((n) => {
        const at = splitDushanbe(n.createdAt);
        return {
          ref: ctx.refs.add('X', n.id, clip(n.title, 60)),
          title: clip(n.title, 120),
          message: clip(n.message, 240),
          ...(at ? { when: `${fmtDateRu(at.date)}, ${at.time}` } : {}),
          unread: !n.isRead,
        };
      }),
    };
  },
};

export const markNotificationsRead: ToolDef<{ notification?: string; all?: boolean }> = {
  name: 'mark_notifications_read',
  kind: 'write',
  description:
    'Отметить уведомления прочитанными: «отметь всё прочитанным» (all=true) или одно по метке X… из my_notifications. '
    + 'Ничего не удаляет.',
  parameters: {
    type: 'object',
    properties: {
      notification: { type: 'string', description: 'Метка X… одного уведомления.' },
      all: { type: 'boolean', description: 'true — все.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx): Promise<WriteOutcome> {
    if (args.all) {
      try { await ctx.api.patch('/notifications/read-all'); } catch (e) { throw apiErr(e); }
      return { summary: '✅ Все уведомления отмечены прочитанными' };
    }
    const e = ctx.refs.resolve('X', args.notification);
    if (!e) throw new ToolError('Какое уведомление? Откройте список через my_notifications или скажите «все».');
    try { await ctx.api.patch(`/notifications/${e.id}/read`); } catch (err) { throw apiErr(err); }
    return { summary: `✅ Прочитано: ${e.label}` };
  },
};

// ═══ Календарь ══════════════════════════════════════════════════════════

const EVENT_TYPE_RU: Record<string, string> = {
  task: 'задача', client_meeting: 'встреча с клиентом', client_repeat_call: 'повторный звонок',
  project_start: 'старт проекта', project_end: 'завершение проекта', shoot: 'съёмка', client_payment: 'оплата клиента',
};

/** Дата и время события: без пояса (полночь/полдень «на весь день») — как есть, с поясом — по Душанбе. */
function eventWhen(raw: unknown): { date: string; time?: string } | null {
  if (!raw) return null;
  const s = raw instanceof Date ? raw.toISOString() : String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s };
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s) && /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = s.slice(11, 16);
    return { date: s.slice(0, 10), ...(t === '00:00' || t === '12:00' ? {} : { time: t }) };
  }
  const p = splitDushanbe(s);
  return p ? { date: p.date, time: p.time === '23:59' || p.time === '00:00' ? undefined : p.time } : null;
}

export const myCalendar: ToolDef<{ from?: string; to?: string; scope?: 'personal' | 'business' | 'general' }> = {
  name: 'my_calendar',
  kind: 'read',
  description:
    'Календарь так, как его видит человек на сайте: задачи со сроками, встречи, съёмки, оплаты, вехи проектов. '
    + '«Что в календаре на завтра», «что на этой неделе», «какие встречи в пятницу». Без дат — сегодня. Для списка своих задач — my_work/find_tasks.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'ГГГГ-ММ-ДД, начало. По умолчанию сегодня.' },
      to: { type: 'string', description: 'ГГГГ-ММ-ДД, конец включительно. По умолчанию = from.' },
      scope: { type: 'string', enum: ['personal', 'business', 'general'], description: 'Личные / бизнес / общие.' },
    },
    additionalProperties: false,
  },
  available: grant('calendar.view'),
  async run(args, ctx) {
    const from = args.from ? checkDate(args.from, 'дата начала') : ctx.today;
    const to = args.to ? checkDate(args.to, 'дата конца') : from;
    if (to < from) throw new ToolError('Конец периода раньше начала.');
    if (to > addDays(from, 92)) throw new ToolError('Период слишком длинный — не больше трёх месяцев.');
    let events: any[];
    try {
      events = await ctx.api.get<any[]>('/calendar/events', { from, to, scope: args.scope });
    } catch (e) { throw apiErr(e); }
    const rows = (Array.isArray(events) ? events : []).map((ev) => ({ ev, when: eventWhen(ev.date) }))
      .filter((x) => x.when && x.when.date >= from && x.when.date <= to);
    return {
      period: from === to ? fmtDateRu(from) : `${fmtDateRu(from)} — ${fmtDateRu(to)}`,
      total: rows.length,
      events: rows.slice(0, 60).map(({ ev, when }) => ({
        date: when!.date,
        ...(when!.time ? { time: when!.time } : {}),
        kind: EVENT_TYPE_RU[ev.type] || ev.type,
        title: clip(ev.title, 120),
        ...(ev.type === 'task' && ev.taskId ? { task: ctx.refs.add('T', ev.taskId, clip(ev.title, 80)), status: ev.status } : {}),
        ...(ev.assigneeName ? { assignee: ev.assigneeName } : {}),
        ...(ev.projectName ? { project: ev.projectName } : {}),
        ...(ev.location ? { place: ev.location } : {}),
      })),
    };
  },
};

// ═══ Отчёты (свои) ══════════════════════════════════════════════════════

export const myReports: ToolDef<{ from?: string; to?: string }> = {
  name: 'my_reports',
  kind: 'read',
  description:
    'Мои отчёты за день: дата, часы, что сделано, проект. «Какие отчёты я сдавал на этой неделе», «последний мой отчёт». '
    + 'Метки X… нужны для edit_my_report. Сдать новый отчёт — daily_report. Чужие отчёты этот инструмент не показывает.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
      to: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const from = args.from ? checkDate(args.from) : null;
    const to = args.to ? checkDate(args.to) : null;
    let list: any[];
    try { list = await ctx.api.get<any[]>('/reports/my'); } catch (e) { throw apiErr(e); }
    const items = (Array.isArray(list) ? list : []).filter((r) => {
      const d = dayOf(r.date);
      return !!d && (!from || d >= from) && (!to || d <= to);
    });
    return {
      total: items.length,
      reports: items.slice(0, 20).map((r) => ({
        ref: ctx.refs.add('X', r.id, `Отчёт ${dayOf(r.date)}`),
        date: dayOf(r.date),
        hours: Number(r.timeSpent),
        description: clip(r.description, 300),
        ...(r.project?.name ? { project: r.project.name } : {}),
        ...(r.task?.title ? { task: r.task.title } : {}),
      })),
    };
  },
};

interface EditReportArgs { report: string; description?: string; hours?: number; date?: string }

export const editMyReport: ToolDef<EditReportArgs> = {
  name: 'edit_my_report',
  kind: 'write',
  description:
    'Поправить свой отчёт: описание, часы или дату. «Исправь в отчёте за вчера часы на 6». Метка X… из my_reports. '
    + 'Чужие отчёты править нельзя. Новый отчёт — daily_report, не этот инструмент.',
  parameters: {
    type: 'object',
    properties: {
      report: { type: 'string', description: 'Метка отчёта X…' },
      description: { type: 'string' },
      hours: { type: 'number', description: 'Часов, больше 0, не больше 24.' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД.' },
    },
    required: ['report'],
    additionalProperties: false,
  },
  available: grant('reports.edit'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = ctx.refs.resolve('X', args.report);
    if (!e) throw new ToolError('Какой отчёт? Откройте список через my_reports.');
    let mine: any[];
    try { mine = await ctx.api.get<any[]>('/reports/my'); } catch (err) { throw apiErr(err); }
    const current = (Array.isArray(mine) ? mine : []).find((r) => r.id === e.id);
    if (!current) throw new ToolError('Это не ваш отчёт или его уже нет — править можно только свои.');
    const body: Record<string, any> = {};
    const before: Record<string, any> = {};
    if (args.description !== undefined) {
      const d = clip(args.description, 4000);
      if (!d) throw new ToolError('Описание отчёта не может быть пустым.');
      body.description = d; before.description = current.description;
    }
    if (args.hours !== undefined) {
      const h = Number(args.hours);
      if (!(h > 0) || h > 24) throw new ToolError('Часы — число от 0 до 24.');
      body.timeSpent = h; before.timeSpent = Number(current.timeSpent);
    }
    if (args.date !== undefined) { body.date = checkDate(args.date); before.date = dayOf(current.date); }
    if (!Object.keys(body).length) throw new ToolError('Что изменить в отчёте?');
    try { await ctx.api.patch(`/reports/${e.id}`, body); } catch (err) { throw apiErr(err); }
    return {
      summary: `📝 Отчёт за ${fmtDateRu(body.date ?? dayOf(current.date) ?? ctx.today)} обновлён`,
      undo: [{ method: 'PATCH', path: `/reports/${e.id}`, body: before }],
    };
  },
};

export const ADMIN_TOOLS: ToolDef[] = [
  employeeCard, updateEmployeeCard, createEmployee, blockEmployee, unblockEmployee,
  accessCatalog, employeeAccess, setEmployeeAccess,
  taskChecklist, checklistAdd, checklistSet, checklistEdit, checklistDelete,
  myNotes, noteCreate, noteUpdate, noteDelete,
  myNotifications, markNotificationsRead,
  myCalendar,
  myReports, editMyReport,
];
