import { hasGrant } from '../../auth/permissions';
import { canReply, canTransfer, isTop } from '../../direct/direct-access';
import { MAX_COMPOSE_CHARS, splitText } from '../../direct/direct-text';
import { ApiError } from '../internal-api';
import { fmtDateRu, matchScore, splitDushanbe } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * «Директ» — переписка с клиентами в Instagram. Доступ — clients.view; пишет в
 * закреплённый чат только тот, кто его ведёт, и руководство (direct-access.ts,
 * те же функции, что на сервере). Клиенту уходит только текст и только после
 * подтверждения, слово в слово. Файлы и голосовые клиенту бот не отправляет.
 */

const can = (key: string) => (u: any) => hasGrant(u, key);
const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);

const FAILURE_RU: Record<string, string> = {
  TOKEN_INVALID: 'ключ Instagram недействителен — нужно переподключить Instagram в CRM',
  WINDOW_CLOSED: 'прошло больше 24 часов после последнего сообщения клиента',
  UNAVAILABLE: 'клиент заблокировал аккаунт или удалил его',
  NETWORK: 'сбой связи с Instagram — можно повторить',
  REJECTED: 'Instagram отказал в отправке',
};

const DIRECTION_RU: Record<string, string> = { in: 'клиент', out: 'мы', note: 'заметка команды', event: 'отметка CRM' };
const KIND_RU: Record<string, string> = { image: 'фото', audio: 'голосовое', file: 'файл', video: 'видео', share: 'публикация' };

function chatEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('M', ref);
  if (!e) throw new ToolError(`Нет чата с меткой «${ref}». Сначала найдите его через find_direct_chats.`);
  return e;
}

async function loadChat(ctx: ToolContext, id: string): Promise<any> {
  try { return await ctx.api.get(`/direct/conversations/${id}`); } catch (e) { throw apiErr(e); }
}

const chatLabel = (c: any): string => c?.contact?.label || 'Клиент Instagram';

function waitingText(since: unknown): string | null {
  if (!since) return null;
  const ms = Date.now() - new Date(since as any).getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.max(Math.floor(ms / 60_000), 0);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч ${min % 60} мин`;
  return `${Math.floor(h / 24)} дн ${h % 24} ч`;
}

function compactChat(ctx: ToolContext, c: any): Record<string, any> {
  const out: Record<string, any> = {
    ref: ctx.refs.add('M', c.id, chatLabel(c)),
    client: chatLabel(c),
  };
  if (c.contact?.username) out.instagram = `@${c.contact.username}`;
  if (c.lastMessage) {
    const dir = c.lastMessage.direction === 'in' ? 'клиент' : c.lastMessage.direction === 'out' ? 'мы' : c.lastMessage.direction;
    out.last = `${dir}: ${String(c.lastMessage.preview || '').slice(0, 160)}`;
  }
  const waiting = waitingText(c.waitingSince);
  if (waiting) out.waiting = waiting;
  if (c.unreadCount) out.unread = c.unreadCount;
  out.assignee = c.assignee?.name || 'свободный';
  if (c.lead) out.lead = { status: c.lead.status, name: c.lead.name };
  out.youCanReply = canReply(ctx.user, c.assignee?.id);
  out.replyWindowOpen = !!c.replyUntil && new Date(c.replyUntil).getTime() > Date.now();
  return out;
}

// ─── Чтение ──────────────────────────────────────────────────────────────

interface FindChatsArgs { view?: 'waiting' | 'unread' | 'mine' | 'free' | 'all'; search?: string; limit?: number }

export const findDirectChats: ToolDef<FindChatsArgs> = {
  name: 'find_direct_chats',
  kind: 'read',
  description:
    'Чаты «Директа» Instagram. «Кто ждёт ответа в Директе» (view=waiting, по умолчанию), «непрочитанные» (unread), '
    + '«мои чаты» (mine), «свободные чаты» (free), «найди чат с Алишером» (search = имя или @ник). '
    + 'Возвращает метки M…, сколько клиент ждёт, кто ведёт чат и можно ли мне ответить. '
    + 'Это НЕ клиенты из базы (для них find_clients) и не чат сотрудников.',
  parameters: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['waiting', 'unread', 'mine', 'free', 'all'] },
      search: { type: 'string', description: 'Имя клиента или @ник.' },
      limit: { type: 'integer' },
    },
    additionalProperties: false,
  },
  available: can('clients.view'),
  async run(args, ctx) {
    const view = args.view || (args.search ? 'all' : 'waiting');
    const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 40);
    const query: Record<string, any> = { view, limit };
    const search = String(args.search || '').trim();
    if (search) query.search = search.slice(0, 100);
    let res: any;
    let counts: any = null;
    try {
      res = await ctx.api.get('/direct/conversations', query);
      counts = await ctx.api.get('/direct/counts', search ? { search: search.slice(0, 100) } : undefined);
    } catch (e) { throw apiErr(e); }
    const items: any[] = Array.isArray(res?.items) ? res.items : [];
    return {
      view,
      total: Number(res?.total) || 0,
      counts: counts ? { all: counts.all, mine: counts.mine, free: counts.free, unread: counts.unread, waiting: counts.waiting } : undefined,
      chats: items.map((c) => compactChat(ctx, c)),
    };
  },
};

export const directMessages: ToolDef<{ chat: string; limit?: number }> = {
  name: 'direct_messages',
  kind: 'read',
  description:
    'Прочитать последние сообщения чата «Директа»: «что написал клиент Алишер», «прочитай переписку». '
    + 'Показывает, кто написал (клиент / мы / заметка команды), текст и вложения. Чат отмеченным прочитанным не становится.',
  parameters: {
    type: 'object',
    properties: {
      chat: { type: 'string', description: 'Метка M…' },
      limit: { type: 'integer', description: 'Сколько последних сообщений, по умолчанию 10, максимум 30.' },
    },
    required: ['chat'],
    additionalProperties: false,
  },
  available: can('clients.view'),
  async run(args, ctx) {
    const e = chatEntry(ctx, args.chat);
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);
    let res: any;
    try { res = await ctx.api.get(`/direct/conversations/${e.id}/messages`, { limit }); } catch (err) { throw apiErr(err); }
    const items: any[] = Array.isArray(res?.items) ? res.items : [];
    return {
      chat: e.label,
      messages: items.map((m) => {
        const at = splitDushanbe(m.sentAt);
        return {
          from: DIRECTION_RU[m.direction] || m.direction,
          ...(m.author?.name && m.direction !== 'in' ? { author: m.author.name } : {}),
          ...(m.direction === 'out' && m.fromApp ? { author: 'из приложения Instagram' } : {}),
          at: at ? `${fmtDateRu(at.date)}, ${at.time}` : null,
          text: m.deleted ? '(удалено)' : String(m.text || '').slice(0, 700),
          ...(m.attachments?.length ? { attachments: m.attachments.map((a: any) => KIND_RU[a.kind] || a.kind) } : {}),
          ...(m.status === 'failed' ? { notDelivered: true } : {}),
        };
      }),
      hasMore: !!res?.hasMore,
    };
  },
};

export const directManagers: ToolDef<{ name?: string }> = {
  name: 'direct_managers',
  kind: 'read',
  description: 'Менеджеры продаж, которым можно передать чат Директа, с метками E…. Нужно перед «передай чат Мадине».',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Имя, как прозвучало.' } },
    additionalProperties: false,
  },
  available: can('clients.view'),
  async run(args, ctx) {
    let list: any[];
    try { list = await ctx.api.get<any[]>('/direct/managers'); } catch (e) { throw apiErr(e); }
    let people = (Array.isArray(list) ? list : []).filter((u) => !!u?.id);
    const q = String(args.name || '').trim();
    if (q) {
      people = people.map((u) => ({ u, s: matchScore(u.name, q) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s).map((x) => x.u);
    }
    return { total: people.length, managers: people.map((u) => ({ ref: ctx.refs.add('E', u.id, String(u.name).trim()), name: String(u.name).trim(), role: u.role })) };
  },
};

// ─── Передача чата ───────────────────────────────────────────────────────

interface TransferArgs { chat: string; manager?: string; release?: boolean }

function transferTarget(args: TransferArgs, ctx: ToolContext) {
  if (args.manager && args.release) throw new ToolError('Нужно одно из двух: передать менеджеру или освободить чат.');
  if (args.release) return null;
  if (!args.manager) throw new ToolError('Не понял, кому передать чат. Назовите менеджера или скажите «освободи чат».');
  const m = ctx.refs.resolve('E', args.manager);
  if (!m) throw new ToolError(`Нет менеджера с меткой «${args.manager}». Найдите его через direct_managers.`);
  return m;
}

function assertCanTransfer(ctx: ToolContext, chat: any): void {
  if (!canTransfer(ctx.user, chat.assignee?.id)) {
    throw new ToolError('Передать чат может только тот, кто его ведёт, или руководство.');
  }
}

export const transferDirectChat: ToolDef<TransferArgs> = {
  name: 'transfer_direct_chat',
  kind: 'write',
  description:
    'Передать чат Директа другому менеджеру продаж («передай чат Алишера Мадине») или освободить его (release=true, «освободи чат»). '
    + 'Руководство передаёт любой чат, менеджер — только свой. Укажи ровно одно: manager ИЛИ release. '
    + 'Это НЕ ответ клиенту (reply_direct_chat) и не смена владельца лида в базе клиентов.',
  parameters: {
    type: 'object',
    properties: {
      chat: { type: 'string', description: 'Метка M…' },
      manager: { type: 'string', description: 'Метка менеджера E… (из direct_managers).' },
      release: { type: 'boolean', description: 'true — освободить чат, он станет свободным.' },
    },
    required: ['chat'],
    additionalProperties: false,
  },
  available: can('clients.view'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = chatEntry(ctx, args.chat);
    const target = transferTarget(args, ctx);
    const chat = await loadChat(ctx, e.id);
    assertCanTransfer(ctx, chat);
    const was = chat.assignee?.name ? `сейчас ведёт ${chat.assignee.name}` : 'сейчас свободный';
    return target
      ? `🔁 ПЕРЕДАТЬ ЧАТ ДИРЕКТА\n«${chatLabel(chat)}» → ${target.label} (${was})`
      : `🔓 ОСВОБОДИТЬ ЧАТ ДИРЕКТА\n«${chatLabel(chat)}» (${was}) станет свободным`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = chatEntry(ctx, args.chat);
    const target = transferTarget(args, ctx);
    const chat = await loadChat(ctx, e.id);
    assertCanTransfer(ctx, chat);
    const prevId: string | null = chat.assignee?.id ?? null;
    if ((target?.id ?? null) === prevId) {
      throw new ToolError(target ? `Чат «${chatLabel(chat)}» уже ведёт ${target.label}.` : `Чат «${chatLabel(chat)}» и так свободный.`);
    }
    try { await ctx.api.post(`/direct/conversations/${e.id}/assign`, { userId: target?.id ?? null }); } catch (err) { throw apiErr(err); }
    return {
      summary: target ? `🔁 Чат «${chatLabel(chat)}» передан: ${target.label}` : `🔓 Чат «${chatLabel(chat)}» освобождён`,
      // Вернуть может только руководство: менеджер, отдав чат, права на него теряет.
      undo: isTop(ctx.user) ? [{ method: 'POST', path: `/direct/conversations/${e.id}/assign`, body: { userId: prevId } }] : undefined,
    };
  },
};

// ─── Заметка ─────────────────────────────────────────────────────────────

export const noteDirectChat: ToolDef<{ chat: string; text: string }> = {
  name: 'note_direct_chat',
  kind: 'write',
  description:
    'Оставить заметку в чате Директа для команды: «напиши заметку в чате Алишера: просил скидку, перезвонить в пятницу». '
    + 'Клиент заметку НЕ видит и она ему не уходит. Это не ответ клиенту (reply_direct_chat).',
  parameters: {
    type: 'object',
    properties: {
      chat: { type: 'string', description: 'Метка M…' },
      text: { type: 'string', description: 'Текст заметки (до 2000 знаков).' },
    },
    required: ['chat', 'text'],
    additionalProperties: false,
  },
  available: can('clients.view'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = chatEntry(ctx, args.chat);
    const text = String(args.text ?? '').trim();
    if (!text) throw new ToolError('Не понял текст заметки.');
    if (text.length > 2000) throw new ToolError('Заметка длиннее 2000 знаков — сократите.');
    let note: any;
    try { note = await ctx.api.post(`/direct/conversations/${e.id}/notes`, { text }); } catch (err) { throw apiErr(err); }
    return {
      summary: `📝 Заметка в чате «${e.label}» (клиент её не увидит): ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`,
      undo: note?.id ? [{ method: 'DELETE', path: `/direct/notes/${note.id}` }] : undefined,
    };
  },
};

// ─── Лид из чата ─────────────────────────────────────────────────────────

interface LeadFromChatArgs {
  chat: string; name?: string; phone?: string; sphere?: string; problem?: string;
  interest?: 'cold' | 'warm' | 'hot'; next_step?: string;
}

export const leadFromDirectChat: ToolDef<LeadFromChatArgs> = {
  name: 'lead_from_direct_chat',
  kind: 'write',
  description:
    'Создать лид в базе клиентов из чата Директа — как кнопка «Создать лид» на сайте: «создай лид из чата Алишера». '
    + 'Имя, @ник и источник «Instagram» берутся из чата, «что нужно клиенту» — из его последних сообщений. '
    + 'Можно дополнить телефоном, сферой, интересом. Если лид из чата уже есть — будет отказ. '
    + 'Не путать с create_lead (лид без чата).',
  parameters: {
    type: 'object',
    properties: {
      chat: { type: 'string', description: 'Метка M…' },
      name: { type: 'string', description: 'Название/имя лида, если надо не как в Instagram.' },
      phone: { type: 'string' },
      sphere: { type: 'string', description: 'Сфера бизнеса.' },
      problem: { type: 'string', description: 'Что нужно клиенту (по умолчанию — его последние сообщения).' },
      interest: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      next_step: { type: 'string' },
    },
    required: ['chat'],
    additionalProperties: false,
  },
  available: can('clients.create'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = chatEntry(ctx, args.chat);
    const chat = await loadChat(ctx, e.id);
    if (chat.lead) throw new ToolError(`Лид из чата «${chatLabel(chat)}» уже создан: «${chat.lead.name}».`);
    if (!canReply(ctx.user, chat.assignee?.id)) {
      throw new ToolError(`Клиента ведёт ${chat.assignee?.name || 'другой менеджер'} — лид заводит закреплённый менеджер или руководство.`);
    }
    const body: Record<string, any> = {
      name: String(args.name || '').trim().slice(0, 200) || (chat.contact?.name || (chat.contact?.username ? `@${chat.contact.username}` : 'Клиент Instagram')),
      leadSource: 'Instagram',
      channel: 'Instagram',
    };
    if (chat.contact?.name) body.contactPerson = String(chat.contact.name).slice(0, 200);
    if (chat.contact?.username) body.contactInstagram = `@${chat.contact.username}`.slice(0, 200);

    const problem = String(args.problem || '').trim();
    if (problem) body.problem = problem.slice(0, 2000);
    else {
      let res: any;
      try { res = await ctx.api.get(`/direct/conversations/${e.id}/messages`, { limit: 30 }); } catch (err) { throw apiErr(err); }
      const said = (Array.isArray(res?.items) ? res.items : [])
        .filter((m: any) => m.direction === 'in' && m.text)
        .slice(-3).map((m: any) => m.text).join('\n').slice(0, 1500);
      if (said) body.problem = said;
    }
    const phone = String(args.phone || '').trim();
    if (phone) body.contactPhone = phone.slice(0, 100);
    const sphere = String(args.sphere || '').trim();
    if (sphere) body.sphere = sphere.slice(0, 120);
    if (args.interest && ['cold', 'warm', 'hot'].includes(args.interest)) body.interest = args.interest;
    const next = String(args.next_step || '').trim();
    if (next) body.nextStep = next.slice(0, 2000);
    // Сайт пишет контакты ещё и в старое поле contactInfo.
    const info = [body.contactPhone, body.contactInstagram].filter(Boolean).join('\n');
    if (info) body.contactInfo = info;

    let created: any;
    try { created = await ctx.api.post(`/direct/conversations/${e.id}/lead`, body); } catch (err) { throw apiErr(err); }
    if (created?.leadId) ctx.refs.add('C', created.leadId, body.name);
    return {
      summary: `🧾 Лид «${body.name}» создан из чата Директа${body.contactPhone ? `, тел. ${body.contactPhone}` : ''}`,
      undo: created?.leadId && hasGrant(ctx.user, 'clients.delete') ? [{ method: 'DELETE', path: `/clients/${created.leadId}` }] : undefined,
    };
  },
};

// ─── Ответ клиенту ───────────────────────────────────────────────────────

/** Проверки до отправки — те же, что у поля ответа на сайте. Возвращает чат. */
async function checkReplyAllowed(ctx: ToolContext, id: string): Promise<any> {
  const chat = await loadChat(ctx, id);
  if (!canReply(ctx.user, chat.assignee?.id)) {
    throw new ToolError(`Чат ведёт ${chat.assignee?.name || 'другой менеджер'} — клиенту отвечает закреплённый менеджер или руководство. Можно оставить заметку для команды (note_direct_chat).`);
  }
  let status: any;
  try { status = await ctx.api.get('/direct/status'); } catch (e) { throw apiErr(e); }
  if (!status?.connected) throw new ToolError('Instagram ещё не подключён к CRM — отвечайте из приложения Instagram.');
  if (!chat.replyUntil) throw new ToolError('Клиент ещё не писал — Instagram не даёт написать первым.');
  if (new Date(chat.replyUntil).getTime() <= Date.now()) {
    throw new ToolError('Прошло больше 24 часов после последнего сообщения клиента — ответьте из приложения Instagram.');
  }
  return chat;
}

function replyText(args: { text: string }): string {
  const text = String(args.text ?? '');
  if (!text.trim()) throw new ToolError('Не понял, что написать клиенту.');
  if (text.length > MAX_COMPOSE_CHARS) throw new ToolError(`Текст длиннее ${MAX_COMPOSE_CHARS} знаков — сократите.`);
  return text;
}

export const replyDirectChat: ToolDef<{ chat: string; text: string }> = {
  name: 'reply_direct_chat',
  kind: 'write',
  description:
    'Ответить КЛИЕНТУ в Instagram из чата Директа текстом: «ответь Алишеру: добрый день, КП пришлём сегодня». '
    + 'Сообщение уходит клиенту сразу после подтверждения СЛОВО В СЛОВО — в text пиши ровно то, что продиктовал человек, '
    + 'ничего не перефразируй, не дополняй, не исправляй и не добавляй приветствие. Если человек не продиктовал текст, а попросил '
    + '«придумай ответ» — сначала покажи ему вариант словами и спроси, не вызывая инструмент. '
    + 'НЕ для заметок команде (note_direct_chat). Файлы и голосовые клиенту отсюда не отправляются.',
  parameters: {
    type: 'object',
    properties: {
      chat: { type: 'string', description: 'Метка M…' },
      text: { type: 'string', description: 'Текст сообщения клиенту дословно, как сказал человек.' },
    },
    required: ['chat', 'text'],
    additionalProperties: false,
  },
  available: can('clients.view'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = chatEntry(ctx, args.chat);
    const text = replyText(args);
    const chat = await checkReplyAllowed(ctx, e.id);
    const parts = splitText(text).length;
    return [
      '✉️ ОТПРАВИТЬ КЛИЕНТУ В INSTAGRAM',
      `Кому: ${chatLabel(chat)}${chat.contact?.username ? ` (@${chat.contact.username})` : ''}`,
      parts > 1 ? `Текст длинный — уйдёт ${parts} сообщениями подряд.` : null,
      'Текст уйдёт именно так:',
      text,
    ].filter((x) => x !== null).join('\n');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = chatEntry(ctx, args.chat);
    const text = replyText(args);
    const chat = await checkReplyAllowed(ctx, e.id);
    let sent: any;
    try { sent = await ctx.api.post(`/direct/conversations/${e.id}/messages`, { text }); } catch (err) { throw apiErr(err); }
    const messages: any[] = Array.isArray(sent) ? sent : [];
    const failed = messages.find((m) => m?.status === 'failed');
    if (failed) {
      const why = FAILURE_RU[failed.error] || 'Instagram не принял сообщение';
      throw new ToolError(`Клиенту «${chatLabel(chat)}» не ушло: ${why}. Сообщение осталось в чате со значком ошибки — его можно повторить на сайте.`);
    }
    return {
      summary: `✉️ Клиенту «${chatLabel(chat)}» отправлено в Instagram: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`,
    };
  },
};

export const DIRECT_TOOLS: ToolDef[] = [
  findDirectChats, directMessages, directManagers, transferDirectChat, noteDirectChat, leadFromDirectChat, replyDirectChat,
];
