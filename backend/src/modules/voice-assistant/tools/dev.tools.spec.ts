import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import { assignDevCard, createDevCard, deleteDevCard, DEV_TOOLS, findDevCards, moveDevCard, setDevProjectStage } from './dev.tools';
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
const FIRUZ = '22222222-2222-4222-8222-222222222222';
const CARD = '33333333-3333-4333-8333-333333333333';
const PROJ = '44444444-4444-4444-8444-444444444444';

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  return {
    user: { id: ME, name: 'Тест', role: 'pm_dev', secondaryRole: null, extraPermissions: [], deniedPermissions: [], ...user } as any,
    api, refs: new RefTable(), today: '2026-11-10', nowTime: '10:00', utterance: 'тест',
  };
}

describe('dev tools: права', () => {
  const names = (user: any) => DEV_TOOLS.filter((t) => !t.available || t.available(user)).map((t) => t.name);
  it('разработчик двигает и комментирует, но не создаёт/назначает/удаляет', () => {
    const list = names({ role: 'developer', extraPermissions: [], deniedPermissions: [] });
    expect(list).toEqual(expect.arrayContaining(['find_dev_cards', 'move_dev_card', 'comment_dev_card', 'set_dev_project_stage']));
    expect(list).not.toContain('create_dev_card');
    expect(list).not.toContain('delete_dev_card');
    expect(list).not.toContain('assign_dev_card');
  });
  it('менеджер продаж доски не видит; PM — всё', () => {
    expect(names({ role: 'sales_manager_smm', extraPermissions: [], deniedPermissions: [] })).toEqual([]);
    expect(names({ role: 'pm_dev', extraPermissions: [], deniedPermissions: [] })).toHaveLength(DEV_TOOLS.length);
  });
  it('личный запрет dev-tracker.manage убирает создание', () => {
    expect(names({ role: 'pm_dev', extraPermissions: [], deniedPermissions: ['dev-tracker.manage'] })).not.toContain('create_dev_card');
  });
});

describe('create_dev_card', () => {
  it('себе — без подтверждения, чужому — с подтверждением и крупным заголовком', async () => {
    const ctx = ctxWith(fakeApi({}));
    ctx.refs.add('E', FIRUZ, 'Фируз');
    ctx.refs.add('E', ME, 'Тест');
    expect(createDevCard.confirm!({ title: 'x' }, ctx)).toBe(false);
    expect(createDevCard.confirm!({ title: 'x', assignee: 'E2' }, ctx)).toBe(false);
    expect(createDevCard.confirm!({ title: 'x', assignee: 'E1' }, ctx)).toBe(true);
    const text = await createDevCard.preview!({ title: 'Оплата', assignee: 'E1' }, ctx);
    expect(text.split('\n')[0]).toContain('НАЗНАЧИТЬ ИСПОЛНИТЕЛЯ');
    expect(text).toContain('Фируз');
  });

  it('шлёт ровно поля DTO и даёт отмену удалением', async () => {
    let sent: any;
    const api = fakeApi({ 'POST /dev-tracker': (b) => { sent = b; return { id: CARD, status: 'backlog' }; } });
    const ctx = ctxWith(api);
    ctx.refs.add('E', FIRUZ, 'Фируз');
    ctx.refs.add('P', PROJ, 'Архидея');
    const out = await createDevCard.run({ title: ' Оплата ', assignee: 'E1', project: 'P1', deadline: '2026-11-14', priority: 'high', type: 'bug', column: 'todo' }, ctx);
    expect(sent).toEqual({ title: 'Оплата', assigneeId: FIRUZ, projectId: PROJ, deadline: '2026-11-14', priority: 'high', taskType: 'bug', status: 'todo' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: `/dev-tracker/${CARD}` }]);
  });

  it('выдуманные метки, пустое название и кривая дата отклоняются', async () => {
    const ctx = ctxWith(fakeApi({}));
    await expect(createDevCard.run({ title: 'x', assignee: 'E9' }, ctx)).rejects.toBeInstanceOf(ToolError);
    await expect(createDevCard.run({ title: '  ' }, ctx)).rejects.toBeInstanceOf(ToolError);
    await expect(createDevCard.run({ title: 'x', deadline: '14.11' }, ctx)).rejects.toBeInstanceOf(ToolError);
    await expect(createDevCard.run({ title: 'x', column: 'review' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('ошибка API превращается в текст для человека', async () => {
    const api = fakeApi({ 'POST /dev-tracker': () => { throw new ApiError(400, 'Проект не найден'); } });
    await expect(createDevCard.run({ title: 'x' }, ctxWith(api))).rejects.toMatchObject({ message: 'Проект не найден' });
  });
});

describe('move_dev_card', () => {
  it('ставит в конец колонки и помнит прежнее место для отмены', async () => {
    let moved: any;
    const api = fakeApi({
      [`GET /dev-tracker/${CARD}`]: () => ({ id: CARD, title: 'Оплата', status: 'todo', position: 2 }),
      'GET /dev-tracker': () => [{ position: 0 }, { position: 4 }],
      [`PATCH /dev-tracker/${CARD}/move`]: (b) => { moved = b; return {}; },
    });
    const ctx = ctxWith(api, { role: 'developer' });
    ctx.refs.add('D', CARD, 'Оплата');
    const out = await moveDevCard.run({ card: 'D1', column: 'in_progress' }, ctx);
    expect(moved).toEqual({ status: 'in_progress', position: 5 });
    expect(out.undo).toEqual([{ method: 'PATCH', path: `/dev-tracker/${CARD}/move`, body: { status: 'todo', position: 2 } }]);
  });

  it('в ту же колонку — отказ без запроса на перемещение', async () => {
    const api = fakeApi({ [`GET /dev-tracker/${CARD}`]: () => ({ id: CARD, title: 'Оплата', status: 'done', position: 0 }) });
    const ctx = ctxWith(api);
    ctx.refs.add('D', CARD, 'Оплата');
    await expect(moveDevCard.run({ card: 'D1', column: 'done' }, ctx)).rejects.toBeInstanceOf(ToolError);
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('assign_dev_card и delete_dev_card', () => {
  it('назначение — с подтверждением, отмена возвращает прежнего исполнителя (в т.ч. «никого»)', async () => {
    let patched: any;
    const api = fakeApi({
      [`GET /dev-tracker/${CARD}`]: () => ({ id: CARD, title: 'Оплата', assignee: null }),
      [`PATCH /dev-tracker/${CARD}`]: (b) => { patched = b; return {}; },
    });
    const ctx = ctxWith(api);
    ctx.refs.add('D', CARD, 'Оплата');
    ctx.refs.add('E', FIRUZ, 'Фируз');
    expect(assignDevCard.confirm!({ card: 'D1' }, ctx)).toBe(true);
    const out = await assignDevCard.run({ card: 'D1', assignee: 'E1' }, ctx);
    expect(patched).toEqual({ assigneeId: FIRUZ });
    expect(out.undo?.[0].body).toEqual({ assigneeId: null });
  });

  it('без исполнителя и без «снять» — не угадывает', async () => {
    const ctx = ctxWith(fakeApi({}));
    ctx.refs.add('D', CARD, 'Оплата');
    await expect(assignDevCard.run({ card: 'D1' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('удаление требует подтверждения, показывает название и не даёт отмены', async () => {
    const api = fakeApi({
      [`GET /dev-tracker/${CARD}`]: () => ({ id: CARD, title: 'Оплата', status: 'testing', assignee: { name: 'Фируз' }, subtasksCount: 2 }),
      [`DELETE /dev-tracker/${CARD}`]: () => ({ message: 'ok' }),
    });
    const ctx = ctxWith(api);
    ctx.refs.add('D', CARD, 'Оплата');
    expect(deleteDevCard.confirm!({ card: 'D1' }, ctx)).toBe(true);
    const text = await deleteDevCard.preview!({ card: 'D1' }, ctx);
    expect(text.split('\n')[0]).toContain('УДАЛИТЬ КАРТОЧКУ');
    expect(text).toContain('Подзадач: 2');
    const out = await deleteDevCard.run({ card: 'D1' }, ctx);
    expect(out.undo).toBeUndefined();
  });
});

describe('find_dev_cards', () => {
  it('фильтры уходят в API, «готово» скрыто по умолчанию, просрочка по Душанбе', async () => {
    const api = fakeApi({
      'GET /dev-tracker': () => [
        { id: CARD, title: 'Оплата', status: 'in_progress', priority: 'high', taskType: 'bug', deadline: '2026-11-09T00:00:00.000Z', assignee: { id: FIRUZ, name: 'Фируз' } },
        { id: 'x2', title: 'Старое', status: 'done', priority: 'low', taskType: 'feature', deadline: null },
      ],
    });
    const ctx = ctxWith(api);
    ctx.refs.add('P', PROJ, 'Архидея');
    const res = await findDevCards.run({ project: 'P1', mine: true }, ctx);
    expect(api.calls[0].query).toEqual({ projectId: PROJ, assigneeId: ME });
    expect(res.total).toBe(2);
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0]).toMatchObject({ column: 'В работе', overdue: true, deadline: '9 ноября' });
  });
});

describe('set_dev_project_stage', () => {
  it('меняет этап и даёт отмену на прежний; без прежнего этапа — без отмены', async () => {
    let body: any;
    let stage: number | null = 2;
    const api = fakeApi({
      [`GET /projects/${PROJ}`]: () => ({ id: PROJ, devStage: stage }),
      [`PATCH /projects/${PROJ}/dev-stage`]: (b) => { body = b; return {}; },
    });
    const ctx = ctxWith(api);
    ctx.refs.add('P', PROJ, 'Архидея');
    const out = await setDevProjectStage.run({ project: 'P1', stage: 4 }, ctx);
    expect(body).toEqual({ devStage: 4 });
    expect(out.undo?.[0].body).toEqual({ devStage: 2 });
    stage = null;
    expect((await setDevProjectStage.run({ project: 'P1', stage: 1 }, ctx)).undo).toBeUndefined();
    await expect(setDevProjectStage.run({ project: 'P1', stage: 7 }, ctx)).rejects.toBeInstanceOf(ToolError);
  });
  it('доступно по ролям сайта: PM да, менеджер продаж нет', () => {
    expect(setDevProjectStage.available!({ role: 'pm_dev' } as any)).toBe(true);
    expect(setDevProjectStage.available!({ role: 'sales_manager_dev' } as any)).toBe(false);
  });
});
