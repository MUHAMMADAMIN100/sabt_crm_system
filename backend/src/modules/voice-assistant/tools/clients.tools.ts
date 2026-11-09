import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { addDays, checkDate, checkTime, dushanbeISO, fmtDateRu, fmtDeadline, isSalesManager, matchScore, splitDushanbe } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Клиенты и лиды (страница «Клиенты», онбординг). Права — гранты
 * clients.view/create/edit/delete, как на сайте. Заметок у клиента в CRM
 * нет: «добавь заметку перезвонить в пятницу» — это «Следующий шаг»,
 * «Повторный звонок» или «Дата встречи / след. контакта».
 */

export const LEAD_STATUS_RU: Record<string, string> = {
  new: 'Новый', waiting: 'Ожидание ответа', negotiating: 'В переговорах', proposal: 'Предложение',
  won: 'Клиент ✓', lost: 'Отказ', on_hold: 'На паузе', unknown: 'Неизвестно',
};
export const STAGE_RU: Record<string, string> = {
  negotiation: 'Переговор', meeting: 'Встреча', kp_creation: 'КП', contract: 'Договор',
  implementation: 'Реализация', cancelled: 'Отмена',
};
const INTEREST_RU: Record<string, string> = { cold: 'холодный', warm: 'тёплый', hot: 'горячий' };

const can = (key: string) => (u: any) => hasGrant(u, key);
const digits = (s: unknown) => String(s ?? '').replace(/\D+/g, '');

function compactClient(ctx: ToolContext, c: any): Record<string, any> {
  const out: Record<string, any> = {
    ref: ctx.refs.add('C', c.id, c.name),
    name: c.name,
    status: LEAD_STATUS_RU[c.status] || c.status,
  };
  if (c.onboardingStage) out.stage = STAGE_RU[c.onboardingStage] || c.onboardingStage;
  if (c.interest) out.interest = INTEREST_RU[c.interest] || c.interest;
  if (c.contactPerson) out.contact = c.contactPerson;
  if (c.contactPhone) out.phone = c.contactPhone;
  if (c.sphere) out.sphere = c.sphere;
  if (c.nextStep) out.nextStep = String(c.nextStep).slice(0, 200);
  if (c.nextContactAt) out.nextContact = fmtDeadline(c.nextContactAt);
  if (c.repeatCallAt) out.repeatCall = fmtDeadline(c.repeatCallAt);
  if (c.owner?.name) out.owner = c.owner.name;
  if (c.createdAt) out.created = splitDushanbe(c.createdAt)?.date;
  return out;
}

function clientEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('C', ref);
  if (!e) throw new ToolError(`Нет клиента с меткой «${ref}». Сначала найдите его через find_clients.`);
  return e;
}

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);

interface FindClientsArgs {
  text?: string; status?: string; mine?: boolean; created_from?: string; created_to?: string; limit?: number;
}

export const findClients: ToolDef<FindClientsArgs> = {
  name: 'find_clients',
  kind: 'read',
  description:
    'Найти клиентов/лидов: по имени, телефону, сфере; по статусу; только мои; созданные за период '
    + '(«сколько у меня новых лидов на этой неделе»). Возвращает метки C…',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Имя клиента, контакт, сфера или телефон.' },
      status: { type: 'string', enum: Object.keys(LEAD_STATUS_RU) },
      mine: { type: 'boolean', description: 'Только лиды, где я владелец.' },
      created_from: { type: 'string', description: 'Создан не раньше, ГГГГ-ММ-ДД.' },
      created_to: { type: 'string', description: 'Создан не позже, ГГГГ-ММ-ДД.' },
      limit: { type: 'integer' },
    },
    additionalProperties: false,
  },
  available: can('clients.view'),
  async run(args, ctx) {
    const query: Record<string, any> = {};
    if (args.status && LEAD_STATUS_RU[args.status]) query.status = args.status;
    if (args.mine) query.ownerId = ctx.user.id;
    const text = String(args.text || '').trim();
    const phone = digits(text);
    const byPhone = phone.length >= 5 && phone.length >= text.replace(/\s+/g, '').length - 3;
    let list: any[];
    try { list = await ctx.api.get<any[]>('/clients', query); } catch (e) { throw apiErr(e); }
    if (!Array.isArray(list)) list = [];
    if (text) {
      list = byPhone
        ? list.filter((c) => digits(`${c.contactPhone} ${c.contactInfo}`).includes(phone.slice(-9)))
        : list
          .map((c) => ({ c, s: Math.max(matchScore(c.name, text), matchScore(`${c.contactPerson || ''} ${c.sphere || ''}`, text)) }))
          .filter((x) => x.s >= 0.5)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.c);
    }
    const from = args.created_from ? checkDate(args.created_from) : null;
    const to = args.created_to ? checkDate(args.created_to) : null;
    if (from || to) {
      list = list.filter((c) => {
        const d = splitDushanbe(c.createdAt)?.date;
        return !!d && (!from || d >= from) && (!to || d <= to);
      });
    }
    const byStatus: Record<string, number> = {};
    for (const c of list) byStatus[LEAD_STATUS_RU[c.status] || c.status] = (byStatus[LEAD_STATUS_RU[c.status] || c.status] || 0) + 1;
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40);
    return { total: list.length, byStatus, clients: list.slice(0, limit).map((c) => compactClient(ctx, c)) };
  },
};

interface LeadArgs {
  name: string; contact_person?: string; phone?: string; instagram?: string; email?: string;
  sphere?: string; problem?: string; source?: string; interest?: 'cold' | 'warm' | 'hot';
  next_step?: string; next_contact_date?: string; next_contact_time?: string;
}

export const createLead: ToolDef<LeadArgs> = {
  name: 'create_lead',
  kind: 'write',
  description:
    'Создать лида/клиента в базе: «создай лид Алишер, кофейня, телефон 900112233, интересует СММ». '
    + 'Сначала проверь find_clients, нет ли уже такого (по имени или телефону).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Название компании или имя клиента.' },
      contact_person: { type: 'string' },
      phone: { type: 'string', description: 'Телефон как продиктован, например +992 900 11 22 33.' },
      instagram: { type: 'string' },
      email: { type: 'string' },
      sphere: { type: 'string', description: 'Сфера бизнеса: кофейня, клиника…' },
      problem: { type: 'string', description: 'Что нужно клиенту.' },
      source: { type: 'string', description: 'Источник: Instagram, Рекомендация, Холодный обзвон, Сайт, Реклама, Другое.' },
      interest: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      next_step: { type: 'string', description: 'Следующий шаг.' },
      next_contact_date: { type: 'string', description: 'Дата встречи/след. контакта ГГГГ-ММ-ДД.' },
      next_contact_time: { type: 'string', description: 'ЧЧ:ММ' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  available: can('clients.create'),
  async run(args, ctx): Promise<WriteOutcome> {
    const name = String(args.name || '').trim();
    if (!name) throw new ToolError('Не понял имя клиента.');
    const body: Record<string, any> = { name: name.slice(0, 200) };
    const put = (k: string, v: unknown, max: number) => { const s = String(v ?? '').trim(); if (s) body[k] = s.slice(0, max); };
    put('contactPerson', args.contact_person, 200);
    put('contactPhone', args.phone, 100);
    put('contactInstagram', args.instagram, 200);
    put('contactEmail', args.email, 200);
    put('sphere', args.sphere, 120);
    put('problem', args.problem, 2000);
    put('leadSource', args.source, 120);
    put('nextStep', args.next_step, 2000);
    if (args.interest && INTEREST_RU[args.interest]) body.interest = args.interest;
    if (args.next_contact_date) {
      body.nextContactAt = dushanbeISO(checkDate(args.next_contact_date), args.next_contact_time ? checkTime(args.next_contact_time) : '10:00');
    }
    // Сайт пишет телефон/инсту/почту ещё и в старое поле contactInfo.
    const info = [body.contactPhone, body.contactInstagram, body.contactEmail].filter(Boolean).join('\n');
    if (info) body.contactInfo = info;
    // Менеджер продаж — владелец своего лида (как форма на сайте).
    if (isSalesManager(ctx.user)) body.ownerId = ctx.user.id;

    let created: any;
    try { created = await ctx.api.post('/clients', body); } catch (e) { throw apiErr(e); }
    if (created?.id) ctx.refs.add('C', created.id, name);
    return {
      summary: `🧾 Лид «${name}» создан${body.contactPhone ? `, тел. ${body.contactPhone}` : ''}${body.sphere ? `, ${body.sphere}` : ''}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/clients/${created.id}` }] : undefined,
    };
  },
};

interface UpdateClientArgs {
  client: string; status?: string; stage?: string; interest?: string; next_step?: string;
  next_contact_date?: string; next_contact_time?: string; repeat_call_date?: string; repeat_call_time?: string;
  phone?: string; contact_person?: string; rejection_reason?: string; deal_potential?: number;
}

const DATE_FIELDS = ['nextContactAt', 'repeatCallAt'];

export const updateClient: ToolDef<UpdateClientArgs> = {
  name: 'update_client',
  kind: 'write',
  description:
    'Изменить клиента: статус («переведи в переговоры», «клиент отказался» → lost, «стал клиентом» → won), '
    + 'этап онбординга («на этап договор» → contract), интерес, следующий шаг («запиши: перезвонить в пятницу» → next_step и/или '
    + 'repeat_call), дату встречи, телефон, причину отказа.',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Метка C…' },
      status: { type: 'string', enum: Object.keys(LEAD_STATUS_RU) },
      stage: { type: 'string', enum: Object.keys(STAGE_RU) },
      interest: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      next_step: { type: 'string' },
      next_contact_date: { type: 'string', description: 'Встреча/след. контакт ГГГГ-ММ-ДД.' },
      next_contact_time: { type: 'string' },
      repeat_call_date: { type: 'string', description: 'Повторный звонок ГГГГ-ММ-ДД.' },
      repeat_call_time: { type: 'string' },
      phone: { type: 'string' },
      contact_person: { type: 'string' },
      rejection_reason: { type: 'string' },
      deal_potential: { type: 'number', description: 'Потенциал сделки, сомони.' },
    },
    required: ['client'],
    additionalProperties: false,
  },
  available: can('clients.edit'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = clientEntry(ctx, args.client);
    let old: any;
    try { old = await ctx.api.get(`/clients/${e.id}`); } catch (err) { throw apiErr(err); }
    const patch: Record<string, any> = {};
    const parts: string[] = [];
    if (args.status) {
      if (!LEAD_STATUS_RU[args.status]) throw new ToolError(`Неизвестный статус «${args.status}».`);
      patch.status = args.status; parts.push(`статус → ${LEAD_STATUS_RU[args.status]}`);
    }
    if (args.stage) {
      if (!STAGE_RU[args.stage]) throw new ToolError(`Неизвестный этап «${args.stage}».`);
      patch.onboardingStage = args.stage; parts.push(`этап → ${STAGE_RU[args.stage]}`);
    }
    if (args.interest && INTEREST_RU[args.interest]) { patch.interest = args.interest; parts.push(`интерес → ${INTEREST_RU[args.interest]}`); }
    if (args.next_step) { patch.nextStep = String(args.next_step).slice(0, 2000); parts.push(`следующий шаг: «${patch.nextStep}»`); }
    if (args.next_contact_date) {
      const d = checkDate(args.next_contact_date);
      const t = args.next_contact_time ? checkTime(args.next_contact_time) : '10:00';
      patch.nextContactAt = dushanbeISO(d, t); parts.push(`встреча/контакт → ${fmtDateRu(d)} ${t}`);
    }
    if (args.repeat_call_date) {
      const d = checkDate(args.repeat_call_date);
      const t = args.repeat_call_time ? checkTime(args.repeat_call_time) : '10:00';
      patch.repeatCallAt = dushanbeISO(d, t); parts.push(`повторный звонок → ${fmtDateRu(d)} ${t}`);
    }
    if (args.phone) { patch.contactPhone = String(args.phone).slice(0, 100); parts.push(`телефон → ${patch.contactPhone}`); }
    if (args.contact_person) { patch.contactPerson = String(args.contact_person).slice(0, 200); parts.push(`контакт → ${patch.contactPerson}`); }
    if (args.rejection_reason) { patch.rejectionReason = String(args.rejection_reason).slice(0, 2000); parts.push('причина отказа записана'); }
    if (args.deal_potential != null && Number(args.deal_potential) >= 0) { patch.dealPotential = Number(args.deal_potential); parts.push(`потенциал → ${patch.dealPotential}`); }
    if (!parts.length) throw new ToolError('Не понял, что изменить у клиента.');

    const undo: Record<string, any> = {};
    for (const k of Object.keys(patch)) {
      const v = old?.[k];
      undo[k] = v === undefined ? null : v;
      // Пустые строки DTO не примет — null для дат, '' для текста не шлём.
      if (undo[k] === '' && DATE_FIELDS.includes(k)) undo[k] = null;
    }
    try { await ctx.api.patch(`/clients/${e.id}`, patch); } catch (err) { throw apiErr(err); }
    return {
      summary: `🧾 ${old?.name || e.label}: ${parts.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/clients/${e.id}`, body: cleanUndo(undo) }],
    };
  },
};

/** Значения «как было». null проходит DTO (@IsOptional пропускает null) и
 *  очищает поле — так отменяется и заполнение пустого поля. */
function cleanUndo(u: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(u)) out[k] = v === undefined || v === '' ? null : v;
  return out;
}

export const deleteClient: ToolDef<{ client: string }> = {
  name: 'delete_client',
  kind: 'write',
  description: 'Удалить клиента из базы — только если прямо сказали «удали клиента».',
  parameters: {
    type: 'object',
    properties: { client: { type: 'string', description: 'Метка C…' } },
    required: ['client'],
    additionalProperties: false,
  },
  available: can('clients.delete'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = clientEntry(ctx, args.client);
    return `🗑 Удалить клиента «${e.label}» из базы?\nВернуть будет нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = clientEntry(ctx, args.client);
    try { await ctx.api.delete(`/clients/${e.id}`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Клиент «${e.label}» удалён` };
  },
};

export const unpaidClients: ToolDef<{ include_upcoming_days?: number }> = {
  name: 'unpaid_clients',
  kind: 'read',
  description: '«Кто не оплатил», «кто просрочил оплату», «у кого оплата на этой неделе» — календарь оплат клиентов.',
  parameters: {
    type: 'object',
    properties: { include_upcoming_days: { type: 'integer', description: 'Показать и ближайшие оплаты на N дней вперёд (0–31).' } },
    additionalProperties: false,
  },
  available: (u: any) => ['admin', 'founder', 'sales_manager_smm', 'sales_manager_dev'].some((r) => r === u.role || r === u.secondaryRole),
  async run(args, ctx) {
    const days = Math.min(Math.max(Number(args.include_upcoming_days) || 0, 0), 31);
    let res: any;
    try {
      res = await ctx.api.get('/smm-payments/calendar', { from: ctx.today, to: addDays(ctx.today, Math.max(days, 1)) });
    } catch (e) { throw apiErr(e); }
    const items: any[] = Array.isArray(res?.items) ? res.items : [];
    const pick = (x: any) => ({
      name: x.name, due: x.dueDate ? fmtDateRu(x.dueDate) : null, part: x.partNo === 2 ? 2 : undefined,
      ...(x.amount ? { amount: Number(x.amount) } : {}),
    });
    return {
      late: items.filter((x) => x.state === 'late').map(pick),
      today: items.filter((x) => x.state === 'today').map(pick),
      upcoming: days ? items.filter((x) => x.state === 'wait').map(pick) : undefined,
    };
  },
};

export const CLIENT_TOOLS: ToolDef[] = [findClients, createLead, updateClient, deleteClient, unpaidClients];
