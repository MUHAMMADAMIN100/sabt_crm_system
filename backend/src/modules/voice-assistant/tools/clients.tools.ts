import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { addDays, checkDate, checkTime, dushanbeISO, fmtDateRu, fmtDeadline, isSalesManager, matchScore, splitDushanbe } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Клиенты и лиды (страница «Клиенты»). Права — гранты
 * clients.view/create/edit/delete, как на сайте. Заметок у клиента в CRM
 * нет: «добавь заметку перезвонить в пятницу» — это «Следующий шаг»,
 * «Повторный звонок» или «Дата встречи / след. контакта».
 *
 * Единая воронка (15.11.2026, docs/SALES_SPEC.md): этап — только status
 * (Новый → Контакт → Встреча → КП → Договор → Выиграно | Проиграно),
 * «этапа онбординга» больше нет, «На паузе» — флаг onHold, а не этап.
 */

/** Подписи этапов. Устаревшие значения (если миграция где-то не прошла) —
 *  так, как их показывает сайт: negotiating/on_hold → «Контакт», unknown → «Новый». */
export const LEAD_STATUS_RU: Record<string, string> = {
  new: 'Новый', waiting: 'Контакт', meeting: 'Встреча', proposal: 'КП', contract: 'Договор',
  won: 'Выиграно', lost: 'Проиграно',
  negotiating: 'Контакт', on_hold: 'Контакт', unknown: 'Новый',
};
/** Этапы, которые можно поставить (без устаревших — сервер их не примет). */
export const LEAD_STATUSES = ['new', 'waiting', 'meeting', 'proposal', 'contract', 'won', 'lost'];
/** Причина проигрыша — обязательна для lost (сервер без неё ответит 400). */
export const LOST_REASON_RU: Record<string, string> = {
  price: 'Дорого', competitor: 'Есть подрядчик', not_lpr: 'Говорили не с ЛПР',
  no_response: 'Пропал, не отвечает', not_needed: 'Не нужно сейчас', other: 'Другое',
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
  if (c.onHold) out.onHold = true;
  if (c.status === 'lost' && c.lostReason) out.lostReason = LOST_REASON_RU[c.lostReason] || c.lostReason;
  if (c.interest) out.interest = INTEREST_RU[c.interest] || c.interest;
  if (c.contactPerson) out.contact = c.contactPerson;
  if (c.contactPhone) out.phone = c.contactPhone;
  if (c.sphere) out.sphere = c.sphere;
  if (c.nextStep) out.nextStep = String(c.nextStep).slice(0, 200);
  if (c.nextStepAt) out.nextStepAt = fmtDeadline(c.nextStepAt);
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
    'Найти клиентов/лидов: по имени, телефону, сфере; по этапу воронки; только мои; созданные за период '
    + '(«сколько у меня новых лидов на этой неделе»). Возвращает метки C…',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Имя клиента, контакт, сфера или телефон.' },
      status: {
        type: 'string', enum: LEAD_STATUSES,
        description: 'Этап: new — новый, waiting — контакт, meeting — встреча, proposal — КП, contract — договор, won — выиграно, lost — проиграно.',
      },
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
    if (args.status && LEAD_STATUSES.includes(args.status)) query.status = args.status;
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
  /** Создать, хотя похожий лид уже есть, — только после явного «да». */
  force?: boolean;
}

/** «Кафе Сафо» (Контакт, ведёт Алишер) — для ответа о дублях. */
function duplicateLine(d: any): string {
  const parts = [LEAD_STATUS_RU[d?.status] || d?.status, d?.ownerName ? `ведёт ${d.ownerName}` : 'без владельца']
    .filter(Boolean).join(', ');
  return `«${d?.name || 'Без названия'}» (${parts})`;
}

export const createLead: ToolDef<LeadArgs> = {
  name: 'create_lead',
  kind: 'write',
  description:
    'Создать лида/клиента в базе: «создай лид Алишер, кофейня, телефон 900112233, интересует СММ». '
    + 'Сначала проверь find_clients, нет ли уже такого (по имени или телефону). Если сервер нашёл похожий лид, '
    + 'инструмент вернёт их список — скажи человеку и спроси; force=true — только после явного «да, создай новый».',
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
      force: {
        type: 'boolean',
        description: 'true — создать, хотя похожий лид уже есть. Только если человек прямо подтвердил после предупреждения о дубле.',
      },
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
    if (args.force === true) body.force = true;

    let created: any;
    try {
      created = await ctx.api.post('/clients', body);
    } catch (e) {
      // Дубль (15.11.2026): сервер нашёл похожий лид того же направления —
      // 409 { message: 'duplicate', duplicates }. Не создаём молча второй:
      // называем найденных и ждём явного подтверждения (force).
      const dups = e instanceof ApiError && e.status === 409 && Array.isArray(e.body?.duplicates) ? e.body.duplicates : null;
      if (dups && dups.length) {
        const list = dups.slice(0, 5).map(duplicateLine).join('; ');
        throw new ToolError(
          `Похожий лид уже есть: ${list}. Скажите, создать новый всё равно или обновить существующий `
          + '(create_lead с force=true — только после явного «да, создай новый»).',
        );
      }
      throw apiErr(e);
    }
    if (created?.id) ctx.refs.add('C', created.id, name);
    return {
      summary: `🧾 Лид «${name}» создан${body.contactPhone ? `, тел. ${body.contactPhone}` : ''}${body.sphere ? `, ${body.sphere}` : ''}`,
      undo: created?.id ? [{ method: 'DELETE', path: `/clients/${created.id}` }] : undefined,
    };
  },
};

interface UpdateClientArgs {
  client: string; status?: string; lost_reason?: string; on_hold?: boolean; interest?: string; next_step?: string;
  next_step_date?: string; next_step_time?: string;
  next_contact_date?: string; next_contact_time?: string; repeat_call_date?: string; repeat_call_time?: string;
  phone?: string; contact_person?: string; rejection_reason?: string; deal_potential?: number;
}

const DATE_FIELDS = ['nextContactAt', 'repeatCallAt', 'nextStepAt'];

export const updateClient: ToolDef<UpdateClientArgs> = {
  name: 'update_client',
  kind: 'write',
  description:
    'Изменить клиента: этап воронки («связались» → waiting, «назначили встречу» → meeting, «отправили КП» → proposal, '
    + '«на договор» → contract, «стал клиентом» → won, «клиент отказался» → lost с lost_reason), пауза (on_hold), интерес, '
    + 'следующий шаг и его срок («запиши: перезвонить в пятницу» → next_step и/или repeat_call), дату встречи, телефон, причину отказа.',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Метка C…' },
      status: {
        type: 'string', enum: LEAD_STATUSES,
        description: 'Этап: new — новый, waiting — контакт, meeting — встреча, proposal — КП, contract — договор, won — выиграно, lost — проиграно.',
      },
      lost_reason: {
        type: 'string', enum: Object.keys(LOST_REASON_RU),
        description: 'Причина проигрыша (обязательна для lost): price — дорого, competitor — есть подрядчик, not_lpr — говорили не с ЛПР, '
          + 'no_response — пропал, not_needed — не нужно сейчас, other — другое (тогда и rejection_reason текстом).',
      },
      on_hold: { type: 'boolean', description: 'true — поставить на паузу, false — снять с паузы.' },
      interest: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      next_step: { type: 'string' },
      next_step_date: { type: 'string', description: 'Срок следующего шага ГГГГ-ММ-ДД.' },
      next_step_time: { type: 'string' },
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
      if (!LEAD_STATUSES.includes(args.status)) throw new ToolError(`Неизвестный этап «${args.status}».`);
      patch.status = args.status; parts.push(`этап → ${LEAD_STATUS_RU[args.status]}`);
    }
    if (args.lost_reason) {
      if (!LOST_REASON_RU[args.lost_reason]) throw new ToolError(`Неизвестная причина проигрыша «${args.lost_reason}».`);
      patch.lostReason = args.lost_reason; parts.push(`причина: ${LOST_REASON_RU[args.lost_reason]}`);
    }
    // «Проиграно» без причины сервер не примет (400) — спросим сразу.
    if (patch.status === 'lost' && !patch.lostReason && !(old?.status === 'lost' && old?.lostReason)) {
      throw new ToolError(
        'Укажите причину проигрыша: дорого, есть подрядчик, говорили не с ЛПР, пропал, не нужно сейчас или другое (с пояснением).',
      );
    }
    if (patch.lostReason === 'other' && !String(args.rejection_reason ?? old?.rejectionReason ?? '').trim()) {
      throw new ToolError('Причина «Другое» — скажите, в чём именно причина отказа.');
    }
    if (typeof args.on_hold === 'boolean') {
      patch.onHold = args.on_hold; parts.push(args.on_hold ? 'на паузе' : 'снят с паузы');
    }
    if (args.interest && INTEREST_RU[args.interest]) { patch.interest = args.interest; parts.push(`интерес → ${INTEREST_RU[args.interest]}`); }
    if (args.next_step) { patch.nextStep = String(args.next_step).slice(0, 2000); parts.push(`следующий шаг: «${patch.nextStep}»`); }
    if (args.next_step_date) {
      const d = checkDate(args.next_step_date);
      const t = args.next_step_time ? checkTime(args.next_step_time) : '10:00';
      patch.nextStepAt = dushanbeISO(d, t); parts.push(`срок шага → ${fmtDateRu(d)} ${t}`);
    }
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
    // Вернуть «Проиграно» можно только с прежней причиной — её тоже в отмену.
    const undoKeys = Object.keys(patch);
    if (patch.status && old?.status === 'lost') undoKeys.push('lostReason', 'rejectionReason');
    for (const k of [...new Set(undoKeys)]) {
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
    // День оплаты в календаре — поле date (CalendarPayItem), не dueDate:
    // раньше ответы приходили без дат.
    const pick = (x: any) => ({
      name: x.name, due: x.date ? fmtDateRu(x.date) : null, part: x.partNo === 2 ? 2 : undefined,
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
