import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import { ToolContext, ToolError } from './types';
import {
  MISC_TOOLS, analyticsReport, clientCallRequest, employeeKpi, goalSet, mySalary, organizerSave, repeatWeekTasks,
  salesPlanSet, setStoryMaker, sprintComplete, sprintCreate, tariffToggle, tariffUpdate, taskResultAdd,
} from './misc.tools';

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

const ME = '11111111-1111-1111-1111-111111111111';

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  return {
    user: { id: ME, name: 'Тест', role: 'founder', secondaryRole: null, extraPermissions: [], deniedPermissions: [], ...user } as any,
    api,
    refs: new RefTable(),
    today: '2026-11-10',
    nowTime: '10:00',
    utterance: '',
  };
}

describe('доступность по ролям', () => {
  const base = { id: ME, secondaryRole: null, extraPermissions: [], deniedPermissions: [] } as any;
  const names = (role: string) => MISC_TOOLS.filter((t) => !t.available || t.available({ ...base, role })).map((t) => t.name);

  it('рядовой сотрудник не видит управляющие инструменты', () => {
    const n = names('designer');
    expect(n).toEqual(expect.arrayContaining(['my_salary', 'my_profile_stats', 'employee_kpi']));
    for (const hidden of ['activity_feed', 'tariff_create', 'sales_plan_set', 'set_sub_admin', 'repeat_week_tasks', 'sprint_create']) {
      expect(n).not.toContain(hidden);
    }
  });

  it('основатель видит всё, имена уникальны', () => {
    expect(names('founder')).toEqual(expect.arrayContaining(['activity_feed', 'sales_plan_set', 'set_story_maker']));
    const all = MISC_TOOLS.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it('всё рискованное — с подтверждением, чтение — без записи', () => {
    for (const t of MISC_TOOLS) if (t.kind === 'write' && t.confirm) expect(t.preview).toBeDefined();
  });
});

describe('чтение', () => {
  it('my_salary отдаёт ответ API как есть', async () => {
    const api = fakeApi({ 'GET /me/salary': () => ({ linked: true, ym: '2026-11' }) });
    expect(await mySalary.run({}, ctxWith(api))).toEqual({ linked: true, ym: '2026-11' });
  });

  it('аналитика: неизвестный вид и нет прав', async () => {
    const api = fakeApi({});
    await expect(analyticsReport.run({ kind: 'zzz' }, ctxWith(api))).rejects.toThrow(/Не знаю такую аналитику/);
    await expect(analyticsReport.run({ kind: 'sales' }, ctxWith(api, { role: 'designer' }))).rejects.toThrow(/недоступен/);
    expect(api.calls).toHaveLength(0);
  });

  it('сторис по проектам просит период', async () => {
    await expect(analyticsReport.run({ kind: 'stories_global' }, ctxWith(fakeApi({})))).rejects.toThrow(/период/);
  });

  it('KPI всей команды закрыт для сотрудника', async () => {
    await expect(employeeKpi.run({ everyone: true }, ctxWith(fakeApi({}), { role: 'designer' }))).rejects.toThrow(/руководство/);
  });

  it('свой KPI: пустой ответ API — честное объяснение', async () => {
    const api = fakeApi({ [`GET /kpi/user/${ME}`]: () => null });
    await expect(employeeKpi.run({}, ctxWith(api))).rejects.toThrow(/личный KPI не считается/);
  });
});

describe('звонок лидам', () => {
  const lead = '55555555-5555-5555-5555-555555555555';

  it('ставит отметку, undo снимает ту же', async () => {
    const api = fakeApi({ 'POST /clients/call-request': () => ({ ok: true, updated: 1 }) });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('C', lead, 'Азиз');
    const out = await clientCallRequest.run({ clients: [ref] }, ctx);
    expect(api.calls[0].body).toEqual({ ids: [lead], flag: true });
    expect(out.undo).toEqual([{ method: 'POST', path: '/clients/call-request', body: { ids: [lead], flag: false } }]);
    expect(clientCallRequest.confirm!({ clients: [ref] }, ctx)).toBe(true);
    expect(clientCallRequest.confirm!({ clients: [ref], call: false }, ctx)).toBe(false);
  });

  it('не руководитель не ставит отметку и не ходит в API', async () => {
    const api = fakeApi({});
    const ctx = ctxWith(api, { role: 'sales_manager_smm' });
    ctx.refs.add('C', lead, 'Азиз');
    await expect(clientCallRequest.run({ clients: ['C1'] }, ctx)).rejects.toThrow(/только руководитель/);
    expect(api.calls).toHaveLength(0);
  });

  it('если API ничего не обновил — ошибка, а не «готово»', async () => {
    const api = fakeApi({ 'POST /clients/call-request': () => ({ ok: true, updated: 0 }) });
    const ctx = ctxWith(api);
    ctx.refs.add('C', lead, 'Азиз');
    await expect(clientCallRequest.run({ clients: ['C1'] }, ctx)).rejects.toThrow(/Ни одного/);
  });
});

describe('тарифы', () => {
  const T1 = '66666666-6666-6666-6666-666666666666';
  const tariff = { id: T1, name: 'Start', monthlyPrice: '3499.00', isActive: true, isCustom: false, storiesPerMonth: 30 };

  it('update шлёт только названное и откатывает прежним', async () => {
    const api = fakeApi({ 'GET /smm-tariffs': () => [tariff], [`PATCH /smm-tariffs/${T1}`]: () => ({}) });
    const out = await tariffUpdate.run({ tariff: 'Start', monthly_price: 4000, stories: 40 }, ctxWith(api));
    expect(api.calls[1].body).toEqual({ monthlyPrice: 4000, storiesPerMonth: 40 });
    expect(out.undo![0].body).toEqual({ monthlyPrice: 3499, storiesPerMonth: 30 });
  });

  it('отрицательное и дробное количество отклоняются', async () => {
    const api = fakeApi({ 'GET /smm-tariffs': () => [tariff] });
    await expect(tariffUpdate.run({ tariff: 'Start', stories: -1 }, ctxWith(api))).rejects.toThrow(ToolError);
    await expect(tariffUpdate.run({ tariff: 'Start', reels: 1.5 }, ctxWith(api))).rejects.toThrow(/Неверное значение/);
  });

  it('toggle: уже в нужном состоянии — без вызова API', async () => {
    const api = fakeApi({ 'GET /smm-tariffs': () => [tariff] });
    const out = await tariffToggle.run({ tariff: 'Start', active: true }, ctxWith(api));
    expect(out.summary).toMatch(/и так включён/);
    expect(api.calls).toHaveLength(1);
  });

  it('несуществующий тариф — понятная ошибка', async () => {
    const api = fakeApi({ 'GET /smm-tariffs': () => [tariff] });
    await expect(tariffToggle.run({ tariff: 'Платинум', active: false }, ctxWith(api))).rejects.toThrow(/не нашла/);
  });
});

describe('справочник организатора', () => {
  it('создание: undo удаляет запись; без названия — ошибка', async () => {
    const api = fakeApi({ 'POST /organizer-directory/models': () => ({ id: 'm1' }) });
    const out = await organizerSave.run({ kind: 'models', name: 'Мадина', rate: '400-600' }, ctxWith(api));
    expect(api.calls[0].body).toEqual({ name: 'Мадина', rate: '400-600' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/organizer-directory/models/m1' }]);
    await expect(organizerSave.run({ kind: 'models', rate: '1' }, ctxWith(api))).rejects.toThrow(/Как назвать/);
  });

  it('изменение: undo возвращает прежние значения', async () => {
    const api = fakeApi({
      'GET /organizer-directory/places': () => [{ id: 'p1', name: 'Студия', price: '800.00' }],
      'PATCH /organizer-directory/places/p1': () => ({}),
    });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('X', 'p1', 'Студия');
    const out = await organizerSave.run({ kind: 'places', record: ref, price: 900 }, ctx);
    expect(out.undo![0].body).toEqual({ price: '800.00' });
  });

  it('неизвестный справочник и неверный пол', async () => {
    const ctx = ctxWith(fakeApi({}));
    await expect(organizerSave.run({ kind: 'foo', name: 'x' }, ctx)).rejects.toThrow(/Какой справочник/);
    await expect(organizerSave.run({ kind: 'models', name: 'x', gender: 'robot' }, ctx)).rejects.toThrow(/Пол/);
  });
});

describe('план продаж', () => {
  const MP = '77777777-7777-7777-7777-777777777777';
  const plans = { ym: '2026-11', managers: [{ id: MP, name: 'Бахтиёр', plan: 5000, received: 100 }] };

  it('ставит сумму и откатывает прежней', async () => {
    const api = fakeApi({ 'GET /sales-plans': () => plans, [`PUT /sales-plans/${MP}`]: () => ({}) });
    const out = await salesPlanSet.run({ manager: 'Бахтиёр', amount: 9000 }, ctxWith(api));
    expect(api.calls[1].body).toEqual({ ym: '2026-11', amount: 9000 });
    expect(out.undo![0].body).toEqual({ ym: '2026-11', amount: 5000 });
  });

  it('отрицательная сумма и неизвестный менеджер', async () => {
    const api = fakeApi({ 'GET /sales-plans': () => plans });
    await expect(salesPlanSet.run({ manager: 'Бахтиёр', amount: -1 }, ctxWith(api))).rejects.toThrow(/от 0/);
    await expect(salesPlanSet.run({ manager: 'Зулфия', amount: 1 }, ctxWith(api))).rejects.toThrow(/не нашла/);
  });
});

describe('цели, спринты, повтор недели, флаги', () => {
  it('goal_set находит созданную цель и даёт undo', async () => {
    const EMP = '88888888-8888-8888-8888-888888888888';
    const api = fakeApi({
      'GET /employees': () => [{ id: 'e1', userId: EMP, fullName: 'Фируза' }],
      [`GET /goals/user/${EMP}`]: () => ({ goals: [{ id: 'old' }] }),
      'POST /goals': () => ({ goals: [{ id: 'old' }, { id: 'new1' }] }),
    });
    const out = await goalSet.run({ employee: 'Фируза', title: 'Закрыть 10 смен' }, ctxWith(api));
    expect(api.calls.find((c) => c.path === '/goals')!.body).toEqual({ userId: EMP, title: 'Закрыть 10 смен' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/goals/new1' }]);
  });

  it('спринт: конец раньше начала и несуществующая дата отклоняются', async () => {
    const ctx = ctxWith(fakeApi({}));
    await expect(sprintCreate.run({ name: 'S', start: '2026-11-12', end: '2026-11-10' }, ctx)).rejects.toThrow(/раньше/);
    await expect(sprintCreate.run({ name: 'S', start: '2026-02-30', end: '2026-03-10' }, ctx)).rejects.toThrow(/такого дня нет/);
  });

  it('sprint_complete по умолчанию отправляет в backlog', async () => {
    const api = fakeApi({ 'POST /dev-tracker/sprints/s1/complete': () => ({}) });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('X', 's1', 'Ноябрь-1');
    await sprintComplete.run({ sprint: ref }, ctx);
    expect(api.calls[0].body).toEqual({ moveTo: 'backlog' });
  });

  it('повтор недели: берёт понедельник и просит подтверждение', async () => {
    const api = fakeApi({ 'POST /tasks/repeat-week': (b) => ({ week: b.weekStart, created: 3, skipped: 1 }) });
    const ctx = ctxWith(api);
    expect(repeatWeekTasks.confirm!({}, ctx)).toBe(true);
    const out = await repeatWeekTasks.run({ week_start: '2026-11-12' }, ctx);
    expect(api.calls[0].body).toEqual({ weekStart: '2026-11-09' });
    expect(out.summary).toMatch(/создано задач 3/);
    expect(out.undo).toBeUndefined();
  });

  it('флаг сторисмейкера переключается только при отличии состояния', async () => {
    const api = fakeApi({
      'GET /employees': () => [{ id: 'e1', userId: 'u1', fullName: 'Фируза', isStoryMaker: false }],
      'PATCH /employees/e1/toggle-story-maker': () => ({}),
    });
    const noop = await setStoryMaker.run({ employee: 'Фируза', enabled: false }, ctxWith(api));
    expect(noop.undo).toBeUndefined();
    expect(api.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    const on = await setStoryMaker.run({ employee: 'Фируза', enabled: true }, ctxWith(api));
    expect(on.undo).toEqual([{ method: 'PATCH', path: '/employees/e1/toggle-story-maker' }]);
  });

  it('результат задачи: только http-ссылка; undo удаляет', async () => {
    const T = '99999999-9999-9999-9999-999999999999';
    const api = fakeApi({ [`POST /tasks/${T}/results`]: () => ({ id: 'r1' }) });
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('T', T, 'Съёмка');
    await expect(taskResultAdd.run({ task: ref, link: 'foo' }, ctx)).rejects.toThrow(/http/);
    const out = await taskResultAdd.run({ task: ref, link: 'https://x.tj/a' }, ctx);
    expect(api.calls[0].body).toEqual({ type: 'link', content: 'https://x.tj/a' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: `/tasks/${T}/results/r1` }]);
  });
});
