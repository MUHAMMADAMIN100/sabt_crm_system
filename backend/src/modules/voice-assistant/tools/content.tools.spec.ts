import { RefTable } from '../refs';
import { ApiError } from '../internal-api';
import { ToolContext } from './types';
import {
  CONTENT_TOOLS, contentAssign, contentAutoPlan, contentCreate, contentDelete, contentEdit, contentFillToNorm,
  cycleWindow, planDates, producerShoots, projectAdCreate, projectAdDelete, projectAdUpdate, setDefaultVideographer,
  smmControlMark,
} from './content.tools';

const ME = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
const ITEM = '33333333-3333-3333-3333-333333333333';
const PERSON = '44444444-4444-4444-4444-444444444444';
const AD = '55555555-5555-5555-5555-555555555555';

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

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  const refs = new RefTable();
  refs.add('P', PROJECT, 'Архидея');
  return {
    user: {
      id: ME, name: 'Тест', role: 'smm_director', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user,
    } as any,
    api, refs, today: '2026-11-10', nowTime: '10:00', utterance: 'тест',
  };
}

describe('имена и права инструментов контента', () => {
  it('имена уникальны, snake_case, описания по-русски', () => {
    const names = CONTENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of CONTENT_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description).toMatch(/[а-я]/i);
    }
  });

  it('продюсер: панель съёмок есть, правки публикаций нет (09.11.2026)', () => {
    const producer = ctxWith(fakeApi({}), { role: 'producer' }).user;
    expect(producerShoots.available!(producer)).toBe(true);
    expect(contentCreate.available!(producer)).toBe(false);
    expect(contentEdit.available!(producer)).toBe(false);
    expect(contentDelete.available!(producer)).toBe(false);
  });

  it('видеограф: только назначение своей съёмки; ни рекламы, ни контроля', () => {
    const v = ctxWith(fakeApi({}), { role: 'videographer' }).user;
    expect(contentAssign.available!(v)).toBe(true);
    expect(smmControlMark.available!(v)).toBe(false);
    expect(projectAdCreate.available!(v)).toBe(false);
    expect(setDefaultVideographer.available!(v)).toBe(false);
  });

  it('удаление — не у СММ-специалиста; таргетолог рекламу не правит (как на сайте)', () => {
    expect(contentDelete.available!(ctxWith(fakeApi({}), { role: 'smm_specialist' }).user)).toBe(false);
    expect(contentDelete.available!(ctxWith(fakeApi({}), { role: 'smm_director' }).user)).toBe(true);
    expect(projectAdCreate.available!(ctxWith(fakeApi({}), { role: 'targetologist' }).user)).toBe(false);
  });
});

describe('content_create', () => {
  it('шлёт только поля DTO, время — отдельно через smart-item, undo — удаление', async () => {
    const api = fakeApi({
      'POST /content-plan': () => ({ id: ITEM }),
      [`PATCH /content-plan/smart-item/${ITEM}`]: () => ({ ok: true }),
    });
    const out = await contentCreate.run(
      { project: 'P1', type: 'reel', topic: ' Осень ', date: '2026-11-15', time: '9:30', script_text: 'сц' }, ctxWith(api),
    );
    expect(api.calls[0].body).toEqual({ projectId: PROJECT, contentType: 'reel', topic: 'Осень', publishDate: '2026-11-15', scriptText: 'сц' });
    expect(api.calls[1].body).toEqual({ publishTime: '09:30' });
    expect(out.undo).toEqual([{ method: 'DELETE', path: `/content-plan/${ITEM}` }]);
  });

  it('отклоняет прошлую дату, время без даты, пустую тему', async () => {
    const c = ctxWith(fakeApi({}));
    await expect(contentCreate.run({ project: 'P1', type: 'reel', topic: 'x', date: '2026-11-01' }, c)).rejects.toThrow(/прошла/);
    await expect(contentCreate.run({ project: 'P1', type: 'reel', topic: 'x', time: '10:00' }, c)).rejects.toThrow(/без даты/);
    await expect(contentCreate.run({ project: 'P1', type: 'post', topic: '  ' }, c)).rejects.toThrow(/тему/);
  });
});

describe('content_edit и content_delete', () => {
  it('правка: undo возвращает прежние значения, пустая строка очищает', async () => {
    const api = fakeApi({
      [`GET /content-plan/${ITEM}`]: () => ({ id: ITEM, topic: 'Старая', caption: 'Было', scriptText: null }),
      [`PATCH /content-plan/${ITEM}`]: () => ({}),
    });
    const c = ctxWith(api);
    c.refs.add('I', ITEM, 'Архидея: рилс');
    const out = await contentEdit.run({ item: 'I1', topic: 'Новая', caption: '' }, c);
    expect(api.calls[1].body).toEqual({ topic: 'Новая', caption: null });
    expect(out.undo![0].body).toEqual({ topic: 'Старая', caption: 'Было' });
  });

  it('правка карточки подготовки и пустая тема отклоняются', async () => {
    const api = fakeApi({ [`GET /content-plan/${ITEM}`]: () => ({ id: ITEM, shootForItemId: PERSON }) });
    const c = ctxWith(api);
    c.refs.add('I', ITEM, 'Съёмка');
    await expect(contentEdit.run({ item: 'I1', topic: 'z' }, c)).rejects.toThrow(/подготовки/);
    await expect(contentEdit.run({ item: 'I1', topic: ' ' }, c)).rejects.toThrow(/Тема/);
    await expect(contentEdit.run({ item: 'I1' }, c)).rejects.toThrow(/Не понял/);
  });

  it('удаление — всегда с подтверждением и без undo', async () => {
    const api = fakeApi({
      [`GET /content-plan/${ITEM}`]: () => ({ id: ITEM, publishDate: '2026-11-14T19:00:00.000Z' }),
      [`DELETE /content-plan/${ITEM}`]: () => ({}),
    });
    const c = ctxWith(api);
    c.refs.add('I', ITEM, 'Архидея: рилс «Осень»');
    expect(contentDelete.confirm!({ item: 'I1' }, c)).toBe(true);
    const text = await contentDelete.preview!({ item: 'I1' }, c);
    expect(text.split('\n')[0]).toContain('УДАЛИТЬ');
    expect(text).toContain('15 ноября');
    const out = await contentDelete.run({ item: 'I1' }, c);
    expect(out.undo).toBeUndefined();
  });
});

describe('content_assign', () => {
  const item = { id: ITEM, shootForItemId: PROJECT, prepStage: 'shoot', assigneeId: ME };

  it('руководство идёт через prep/:id/assignee и получает undo', async () => {
    const api = fakeApi({
      [`GET /content-plan/${ITEM}`]: () => ({ ...item, assigneeId: null }),
      [`PATCH /content-plan/prep/${ITEM}/assignee`]: () => ({}),
    });
    const c = ctxWith(api, { role: 'founder' });
    c.refs.add('I', ITEM, 'Съёмка'); c.refs.add('E', PERSON, 'Ахмад');
    expect(contentAssign.confirm!({ item: 'I1', person: 'E1' }, c)).toBe(true);
    const out = await contentAssign.run({ item: 'I1', person: 'E1' }, c);
    expect(api.calls[1].body).toEqual({ userId: PERSON });
    expect(out.undo![0].body).toEqual({ userId: null });
  });

  it('видеограф передаёт свою съёмку через shoot/:id/assignee, без undo; чужую — отказ', async () => {
    const api = fakeApi({
      [`GET /content-plan/${ITEM}`]: () => item,
      [`PATCH /content-plan/shoot/${ITEM}/assignee`]: () => ({}),
    });
    const c = ctxWith(api, { role: 'videographer' });
    c.refs.add('I', ITEM, 'Съёмка'); c.refs.add('E', PERSON, 'Ахмад');
    const out = await contentAssign.run({ item: 'I1', person: 'E1' }, c);
    expect(api.calls[1].path).toBe(`/content-plan/shoot/${ITEM}/assignee`);
    expect(out.undo).toBeUndefined();

    const other = fakeApi({ [`GET /content-plan/${ITEM}`]: () => ({ ...item, assigneeId: PERSON }) });
    const c2 = ctxWith(other, { role: 'videographer' });
    c2.refs.add('I', ITEM, 'Съёмка'); c2.refs.add('E', PERSON, 'Ахмад');
    await expect(contentAssign.run({ item: 'I1', person: 'E1' }, c2)).rejects.toThrow(/руководство/);
  });

  it('публикацию (не карточку подготовки) назначать нельзя; ошибка сервера доходит текстом', async () => {
    const c = ctxWith(fakeApi({ [`GET /content-plan/${ITEM}`]: () => ({ id: ITEM }) }), { role: 'founder' });
    c.refs.add('I', ITEM, 'Рилс'); c.refs.add('E', PERSON, 'Ахмад');
    await expect(contentAssign.run({ item: 'I1', person: 'E1' }, c)).rejects.toThrow(/съёмки, монтажа или дизайна/);

    const api = fakeApi({
      [`GET /content-plan/${ITEM}`]: () => item,
      [`PATCH /content-plan/prep/${ITEM}/assignee`]: () => { throw new ApiError(400, 'Съёмку можно назначить только видеографу'); },
    });
    const c2 = ctxWith(api, { role: 'founder' });
    c2.refs.add('I', ITEM, 'Съёмка'); c2.refs.add('E', PERSON, 'Ахмад');
    await expect(contentAssign.run({ item: 'I1', person: 'E1' }, c2)).rejects.toThrow('Съёмку можно назначить только видеографу');
  });
});

describe('авто-план', () => {
  it('окно цикла: якорь 1-го числа, предстоящий цикл по cycleAnchor', () => {
    expect(cycleWindow(1, null, '2026-11-10')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(cycleWindow(15, null, '2026-11-10')).toEqual({ start: '2026-10-15', end: '2026-11-14' });
    expect(cycleWindow(1, '2026-12-01', '2026-11-10')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(cycleWindow(31, null, '2026-03-05')).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(cycleWindow(null, null, '2026-11-10')).toBeNull();
  });

  const rules = { reelDays: [0, 2, 4], postDays: [1, 3], reelTime: '19:00', postTime: '12:00', shootLead: 2, shootTime: '11:00', sep: true, spread: true, auto: false };

  it('раскладка: рилсы в свои дни недели не раньше «завтра+съёмка», посты — отдельно от рилсов', () => {
    const plan = planDates({
      window: { start: '2026-11-01', end: '2026-11-30' }, today: '2026-11-10', startFrom: '2026-11-11',
      rules, reels: 3, posts: 2, taken: new Set(), busy: new Set(),
    });
    const wd = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    expect(plan.reels).toHaveLength(3);
    expect(plan.posts).toHaveLength(2);
    for (const d of plan.reels) { expect(d >= '2026-11-13').toBe(true); expect([0, 2, 4]).toContain(wd(d)); }
    for (const d of plan.posts) { expect(d >= '2026-11-12').toBe(true); expect([1, 3]).toContain(wd(d)); expect(plan.reels).not.toContain(d); }
  });

  it('занятые дни обходятся, если хватает свободных', () => {
    const base = { window: { start: '2026-11-01', end: '2026-11-30' }, today: '2026-11-10', startFrom: '2026-11-11', rules, reels: 1, posts: 0, busy: new Set<string>() };
    const free = planDates({ ...base, taken: new Set() });
    const avoided = planDates({ ...base, taken: new Set(free.reels) });
    expect(avoided.reels[0]).not.toBe(free.reels[0]);
  });

  it('content_auto_plan: preview показывает даты, run отправляет правила и даты; всё по норме — отказ', async () => {
    const calendar = {
      events: [],
      projects: [{ id: PROJECT, name: 'Архидея', cycleStartDay: 1, cycleAnchor: null, normReels: 2, normPosts: 0, specialistIds: [], autoPlan: null }],
      backlog: [{ itemId: ITEM, projectId: PROJECT, kind: 'publication', contentType: 'reel', topic: 'Рилс 1' }],
    };
    const api = fakeApi({
      'GET /content-plan/smm-calendar': () => calendar,
      [`POST /content-plan/auto-plan/${PROJECT}`]: () => ({ ok: true, placed: 2, skipped: 0 }),
    });
    const c = ctxWith(api);
    expect(contentAutoPlan.confirm!({ project: 'P1' }, c)).toBe(true);
    const text = await contentAutoPlan.preview!({ project: 'P1' }, c);
    expect(text.split('\n')[0]).toContain('РАССТАВИТЬ');
    const out = await contentAutoPlan.run({ project: 'P1' }, c);
    const post = api.calls.find((x) => x.method === 'POST')!;
    expect(post.body.rules.auto).toBe(false);
    expect(post.body.reels).toHaveLength(2);
    expect(post.body.reels[0].itemId).toBe(ITEM);
    expect(post.body.reels[1].itemId).toBeNull();
    expect(post.body.posts).toEqual([]);
    expect(out.summary).toContain('2');

    const done = fakeApi({
      'GET /content-plan/smm-calendar': () => ({
        ...calendar,
        events: [
          { kind: 'publication', projectId: PROJECT, contentType: 'reel', date: '2026-11-20' },
          { kind: 'publication', projectId: PROJECT, contentType: 'reel', date: '2026-11-25' },
        ],
      }),
    });
    await expect(contentAutoPlan.preview!({ project: 'P1' }, ctxWith(done))).rejects.toThrow(/расставлять нечего/);
  });

  it('content_fill_to_norm: без чисел берёт норму проекта, всегда с подтверждением', async () => {
    const api = fakeApi({
      'GET /content-plan/smm-calendar': () => ({ projects: [{ id: PROJECT, normReels: 8, normPosts: 4 }] }),
      'POST /content-plan/smart-generate': () => ({ ok: true }),
    });
    const c = ctxWith(api);
    expect(contentFillToNorm.confirm!({ project: 'P1' }, c)).toBe(true);
    await contentFillToNorm.run({ project: 'P1' }, c);
    expect(api.calls.find((x) => x.method === 'POST')!.body).toEqual({ projectId: PROJECT, reels: 8, posts: 4 });
    await expect(contentFillToNorm.run({ project: 'P1', reels: 1000 }, ctxWith(fakeApi({
      'GET /content-plan/smm-calendar': () => ({ projects: [{ id: PROJECT, normReels: 8, normPosts: 4 }] }),
    })))).rejects.toThrow(/0 до 999/);
  });
});

describe('smm_control_mark', () => {
  const row = { id: PROJECT, mood: 'good', moodNote: 'ок', contact: false, report: true, ads: { running: false } };

  it('шлёт только названные поля, undo возвращает прежние', async () => {
    const api = fakeApi({
      'GET /smm-control': () => ({ projects: [row] }),
      [`PATCH /smm-control/${PROJECT}`]: () => ({}),
    });
    const out = await smmControlMark.run({ project: 'P1', mood: 'bad', mood_note: 'просит стиль', contact: true, ads: true }, ctxWith(api));
    expect(api.calls[1].body).toEqual({ ym: '2026-11', mood: 'bad', moodNote: 'просит стиль', contact: true, ads: true });
    expect(out.undo![0].body).toEqual({ ym: '2026-11', mood: 'good', moodNote: 'ок', contact: false, ads: false });
  });

  it('пояснение без оценки при пустой оценке — отказ; без полей — отказ; проект вне контроля — отказ', async () => {
    const api = fakeApi({ 'GET /smm-control': () => ({ projects: [{ ...row, mood: null }] }) });
    await expect(smmControlMark.run({ project: 'P1', mood_note: 'x' }, ctxWith(api))).rejects.toThrow(/без оценки/);
    await expect(smmControlMark.run({ project: 'P1' }, ctxWith(api))).rejects.toThrow(/Не понял/);
    await expect(smmControlMark.run({ project: 'P1', contact: true }, ctxWith(fakeApi({ 'GET /smm-control': () => ({ projects: [] }) })))).rejects.toThrow(/нет в СММ-контроле/);
    await expect(smmControlMark.run({ project: 'P1', ym: '2026-13', contact: true }, ctxWith(api))).rejects.toThrow(/месяц/);
  });
});

describe('реклама проекта', () => {
  const base = { project: 'P1', title: 'Промо', start_date: '2026-11-12', end_date: '2026-11-20' };

  it('создание: всегда подтверждение; бюджет без плательщика — вопрос, а не догадка', async () => {
    const c = ctxWith(fakeApi({}));
    expect(projectAdCreate.confirm!(base, c)).toBe(true);
    await expect(projectAdCreate.preview!({ ...base, budget: 500 }, c)).rejects.toThrow(/Кто платит/);
    const text = await projectAdCreate.preview!({ ...base, budget: 500, budget_source: 'company' }, c);
    expect(text.split('\n')[0]).toContain('СОЗДАТЬ РЕКЛАМУ');
    expect(text).toContain('КОМПАНИЯ');
  });

  it('создание: тело — поля DTO, undo — удаление кампании', async () => {
    const api = fakeApi({
      [`POST /projects/${PROJECT}/ads`]: () => ({ id: AD }),
    });
    const out = await projectAdCreate.run({ ...base, channel: 'tiktok', budget: 500, daily_budget: 50, budget_source: 'client' }, ctxWith(api));
    expect(api.calls[0].body).toEqual({
      title: 'Промо', channel: 'tiktok', budget: 500, dailyBudget: 50, budgetSource: 'client',
      startDate: '2026-11-12T09:00', endDate: '2026-11-20T18:00',
    });
    expect(out.undo).toEqual([{ method: 'DELETE', path: `/projects/${PROJECT}/ads/${AD}` }]);
    await expect(projectAdCreate.run({ ...base, end_date: '2026-11-01' }, ctxWith(fakeApi({})))).rejects.toThrow(/раньше/);
  });

  it('изменение: подтверждение только если трогаются деньги; undo возвращает прежнее', async () => {
    const c = ctxWith(fakeApi({}));
    expect(projectAdUpdate.confirm!({ ad: 'A1', status: 'running' }, c)).toBe(false);
    expect(projectAdUpdate.confirm!({ ad: 'A1', budget: 10 }, c)).toBe(true);
    expect(projectAdUpdate.confirm!({ ad: 'A1', budget_source: 'company' }, c)).toBe(true);

    const api = fakeApi({
      [`GET /projects/${PROJECT}/ads`]: () => [{ id: AD, title: 'Промо', status: 'planned', budget: '500.00', budgetSource: 'company', startDate: '2026-11-12T04:00:00.000Z', endDate: '2026-11-20T13:00:00.000Z' }],
      [`PATCH /projects/${PROJECT}/ads/${AD}`]: () => ({}),
    });
    const c2 = ctxWith(api);
    c2.refs.add('A', `${PROJECT}:${AD}`, 'Архидея: реклама «Промо»');
    const out = await projectAdUpdate.run({ ad: 'A1', status: 'running', budget: 700 }, c2);
    expect(api.calls[1].body).toEqual({ status: 'running', budget: 700 });
    expect(out.undo![0].body).toEqual({ status: 'planned', budget: 500 });
    await expect(projectAdUpdate.run({ ad: 'A1', end_date: '2026-11-01' }, c2)).rejects.toThrow(/раньше/);
  });

  it('удаление — с подтверждением, предупреждает о бюджете, без undo', async () => {
    const api = fakeApi({
      [`GET /projects/${PROJECT}/ads`]: () => [{ id: AD, title: 'Промо', channel: 'tiktok', budget: '500.00', budgetSource: 'company', startDate: '2026-11-12T04:00:00.000Z', endDate: '2026-11-20T13:00:00.000Z' }],
      [`DELETE /projects/${PROJECT}/ads/${AD}`]: () => ({}),
    });
    const c = ctxWith(api);
    c.refs.add('A', `${PROJECT}:${AD}`, 'Архидея: реклама «Промо»');
    expect(projectAdDelete.confirm!({ ad: 'A1' }, c)).toBe(true);
    const text = await projectAdDelete.preview!({ ad: 'A1' }, c);
    expect(text).toContain('УДАЛИТЬ РЕКЛАМУ');
    expect(text).toContain('уменьшится');
    expect((await projectAdDelete.run({ ad: 'A1' }, c)).undo).toBeUndefined();
  });
});
