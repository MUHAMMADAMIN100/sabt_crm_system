import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import {
  DIRECT_TOOLS, leadFromDirectChat, noteDirectChat, replyDirectChat, transferDirectChat,
} from './direct.tools';
import { ToolContext, ToolError } from './types';

type Handler = (body?: any, query?: any) => any;

function fakeApi(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; body?: any; query?: any }> = [];
  const hit = (method: string, path: string, body?: any, query?: any) => {
    calls.push({ method, path, body, query });
    const h = routes[`${method} ${path}`];
    if (!h) throw new ApiError(404, `нет маршрута ${method} ${path}`);
    return Promise.resolve().then(() => h(body, query));
  };
  return {
    calls,
    get: (p: string, q?: any) => hit('GET', p, undefined, q),
    post: (p: string, b?: any) => hit('POST', p, b),
    patch: (p: string, b?: any) => hit('PATCH', p, b),
    delete: (p: string, b?: any) => hit('DELETE', p, b),
    request: (m: string, p: string, b?: any) => hit(m, p, b),
  };
}

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();
const chat = (extra: Record<string, any> = {}) => ({
  id: CHAT, contact: { name: 'Алишер', username: 'alisher', label: 'Алишер' }, assignee: null, lead: null,
  replyUntil: inOneHour(), ...extra,
});

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  const ctx: ToolContext = {
    user: { id: ME, name: 'Саври', role: 'sales_manager_smm', secondaryRole: null, extraPermissions: [], deniedPermissions: [], ...user } as any,
    api, refs: new RefTable(), today: '2026-11-10', nowTime: '10:00', utterance: 'тест',
  };
  ctx.refs.add('M', CHAT, 'Алишер');
  return ctx;
}

describe('direct tools: права', () => {
  const names = (user: any) => DIRECT_TOOLS.filter((t) => !t.available || t.available(user)).map((t) => t.name);
  it('менеджер продаж и основатель видят Директ, PM/разработчик — нет', () => {
    expect(names({ role: 'sales_manager_dev', extraPermissions: [], deniedPermissions: [] })).toHaveLength(DIRECT_TOOLS.length);
    expect(names({ role: 'founder', extraPermissions: [], deniedPermissions: [] })).toHaveLength(DIRECT_TOOLS.length);
    expect(names({ role: 'pm_dev', extraPermissions: [], deniedPermissions: [] })).toEqual([]);
  });
  it('запрет clients.create убирает «лид из чата», остальное остаётся', () => {
    const list = names({ role: 'sales_manager_smm', extraPermissions: [], deniedPermissions: ['clients.create'] });
    expect(list).not.toContain('lead_from_direct_chat');
    expect(list).toContain('reply_direct_chat');
  });
});

describe('reply_direct_chat', () => {
  const connected = { connected: true };

  it('всегда с подтверждением; в preview крупный заголовок и точный текст', async () => {
    const api = fakeApi({ [`GET /direct/conversations/${CHAT}`]: () => chat(), 'GET /direct/status': () => connected });
    const ctx = ctxWith(api);
    expect(replyDirectChat.confirm!({ chat: 'M1', text: 'x' }, ctx)).toBe(true);
    const text = 'Добрый день!  Цена — 3000.\nЖдём вас.';
    const preview = await replyDirectChat.preview!({ chat: 'M1', text }, ctx);
    expect(preview.split('\n')[0]).toBe('✉️ ОТПРАВИТЬ КЛИЕНТУ В INSTAGRAM');
    expect(preview).toContain(text);
    expect(preview).toContain('@alisher');
  });

  it('отправляет текст без изменений ровно в API сайта', async () => {
    let sent: any;
    const api = fakeApi({
      [`GET /direct/conversations/${CHAT}`]: () => chat(),
      'GET /direct/status': () => connected,
      [`POST /direct/conversations/${CHAT}/messages`]: (b) => { sent = b; return [{ status: 'sent' }]; },
    });
    const text = '  Добрый день,  Алишер!  ';
    const out = await replyDirectChat.run({ chat: 'M1', text }, ctxWith(api));
    expect(sent).toEqual({ text });
    expect(out.summary).toContain('отправлено');
    expect(out.undo).toBeUndefined();
  });

  it('если Instagram не принял — честная ошибка, а не «отправлено»', async () => {
    const api = fakeApi({
      [`GET /direct/conversations/${CHAT}`]: () => chat(),
      'GET /direct/status': () => connected,
      [`POST /direct/conversations/${CHAT}/messages`]: () => [{ status: 'failed', error: 'WINDOW_CLOSED' }],
    });
    await expect(replyDirectChat.run({ chat: 'M1', text: 'Привет' }, ctxWith(api))).rejects.toThrow(/не ушло.*24 часов/);
  });

  it('чужой закреплённый чат: менеджеру нельзя, руководству можно', async () => {
    const mk = () => fakeApi({
      [`GET /direct/conversations/${CHAT}`]: () => chat({ assignee: { id: OTHER, name: 'Мадина' } }),
      'GET /direct/status': () => connected,
    });
    await expect(replyDirectChat.preview!({ chat: 'M1', text: 'Привет' }, ctxWith(mk()))).rejects.toThrow(/Чат ведёт Мадина/);
    await expect(replyDirectChat.preview!({ chat: 'M1', text: 'Привет' }, ctxWith(mk(), { role: 'founder' }))).resolves.toContain('Привет');
  });

  it('окно 24 часов закрыто, клиент не писал, Instagram не подключён, пустой текст', async () => {
    const route = (c: any, st: any = connected) => fakeApi({ [`GET /direct/conversations/${CHAT}`]: () => c, 'GET /direct/status': () => st });
    await expect(replyDirectChat.run({ chat: 'M1', text: 'a' }, ctxWith(route(chat({ replyUntil: '2020-01-01T00:00:00Z' }))))).rejects.toThrow(/24 часов/);
    await expect(replyDirectChat.run({ chat: 'M1', text: 'a' }, ctxWith(route(chat({ replyUntil: null }))))).rejects.toThrow(/ещё не писал/);
    await expect(replyDirectChat.run({ chat: 'M1', text: 'a' }, ctxWith(route(chat(), { connected: false })))).rejects.toThrow(/не подключён/);
    await expect(replyDirectChat.run({ chat: 'M1', text: '   ' }, ctxWith(route(chat())))).rejects.toBeInstanceOf(ToolError);
  });

  it('выдуманная метка чата не принимается', async () => {
    await expect(replyDirectChat.run({ chat: 'M9', text: 'a' }, ctxWith(fakeApi({})))).rejects.toBeInstanceOf(ToolError);
  });
});

describe('transfer_direct_chat', () => {
  it('менеджер передаёт только свой чат; руководство — любой и может отменить', async () => {
    let body: any;
    const mk = (assignee: any) => fakeApi({
      [`GET /direct/conversations/${CHAT}`]: () => chat({ assignee }),
      [`POST /direct/conversations/${CHAT}/assign`]: (b) => { body = b; return {}; },
    });
    const own = ctxWith(mk({ id: ME, name: 'Саври' }));
    own.refs.add('E', OTHER, 'Мадина');
    expect(transferDirectChat.confirm!({ chat: 'M1' }, own)).toBe(true);
    const out = await transferDirectChat.run({ chat: 'M1', manager: 'E1' }, own);
    expect(body).toEqual({ userId: OTHER });
    expect(out.undo).toBeUndefined();

    const foreign = ctxWith(mk({ id: OTHER, name: 'Мадина' }));
    foreign.refs.add('E', OTHER, 'Мадина');
    await expect(transferDirectChat.run({ chat: 'M1', release: true }, foreign)).rejects.toBeInstanceOf(ToolError);

    const top = ctxWith(mk({ id: OTHER, name: 'Мадина' }), { role: 'founder' });
    const freed = await transferDirectChat.run({ chat: 'M1', release: true }, top);
    expect(body).toEqual({ userId: null });
    expect(freed.undo?.[0].body).toEqual({ userId: OTHER });
  });

  it('и менеджер, и «освободить» одновременно — не угадывает', async () => {
    const ctx = ctxWith(fakeApi({}));
    ctx.refs.add('E', OTHER, 'Мадина');
    await expect(transferDirectChat.preview!({ chat: 'M1', manager: 'E1', release: true }, ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('note_direct_chat и lead_from_direct_chat', () => {
  it('заметка уходит как заметка и отменяется удалением', async () => {
    let sent: any;
    const api = fakeApi({ [`POST /direct/conversations/${CHAT}/notes`]: (b) => { sent = b; return { id: 'n1' }; } });
    const out = await noteDirectChat.run({ chat: 'M1', text: ' Просил скидку ' }, ctxWith(api));
    expect(sent).toEqual({ text: 'Просил скидку' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/direct/notes/n1' }]);
  });

  it('лид: поля как у формы сайта, текст клиента в «проблему», отмена удаляет лид', async () => {
    let sent: any;
    const api = fakeApi({
      [`GET /direct/conversations/${CHAT}`]: () => chat(),
      [`GET /direct/conversations/${CHAT}/messages`]: () => ({ items: [{ direction: 'in', text: 'Нужен сайт' }, { direction: 'out', text: 'Какой?' }] }),
      [`POST /direct/conversations/${CHAT}/lead`]: (b) => { sent = b; return { leadId: 'L1' }; },
    });
    const out = await leadFromDirectChat.run({ chat: 'M1', phone: '+992900112233' }, ctxWith(api));
    expect(sent).toEqual({
      name: 'Алишер', leadSource: 'Instagram', channel: 'Instagram', contactPerson: 'Алишер', contactInstagram: '@alisher',
      problem: 'Нужен сайт', contactPhone: '+992900112233', contactInfo: '+992900112233\n@alisher',
    });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/clients/L1' }]);
  });

  it('лид уже есть или чат чужой — отказ без запроса', async () => {
    const api = fakeApi({ [`GET /direct/conversations/${CHAT}`]: () => chat({ lead: { name: 'Алишер', status: 'new' } }) });
    await expect(leadFromDirectChat.run({ chat: 'M1' }, ctxWith(api))).rejects.toThrow(/уже создан/);
    const api2 = fakeApi({ [`GET /direct/conversations/${CHAT}`]: () => chat({ assignee: { id: OTHER, name: 'Мадина' } }) });
    await expect(leadFromDirectChat.run({ chat: 'M1' }, ctxWith(api2))).rejects.toThrow(/Мадина/);
    expect(api2.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
