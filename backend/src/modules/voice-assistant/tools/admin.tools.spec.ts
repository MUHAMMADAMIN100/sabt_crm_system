import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import { ToolContext, ToolError } from './types';
import {
  ADMIN_TOOLS, blockEmployee, checklistSet, checklistAdd, employeeCard, markNotificationsRead, myCalendar,
  noteDelete, noteUpdate, setEmployeeAccess, unblockEmployee, updateEmployeeCard, createEmployee, editMyReport,
} from './admin.tools';

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
const ALI = '22222222-2222-2222-2222-222222222222';
const ALI_EMP = '33333333-3333-3333-3333-333333333333';
const TASK = '44444444-4444-4444-4444-444444444444';

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  return {
    user: {
      id: ME, name: 'Тест', role: 'founder', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], ...user,
    } as any,
    api,
    refs: new RefTable(),
    today: '2026-11-10',
    nowTime: '10:00',
    utterance: '',
  };
}

const aliRow = (over: Record<string, any> = {}) => ({
  id: ALI_EMP, userId: ALI, fullName: 'Али Рахимов', position: 'Дизайнер', department: 'Общий',
  email: 'ali@x.tj', phone: '900', status: 'active', salary: 5000,
  user: { id: ALI, role: 'designer', isBlocked: false }, ...over,
});

describe('доступность по ролям', () => {
  const smm = { id: ME, role: 'smm_specialist', secondaryRole: null, extraPermissions: [], deniedPermissions: [] } as any;
  const founder = { ...smm, role: 'founder' };
  const names = (u: any) => ADMIN_TOOLS.filter((t) => !t.available || t.available(u)).map((t) => t.name);

  it('обычному сотруднику недоступны карточки, блокировка и доступы, но доступны заметки и чек-листы', () => {
    const n = names(smm);
    expect(n).toEqual(expect.arrayContaining(['my_notes', 'checklist_add', 'my_notifications', 'edit_my_report']));
    expect(n).not.toEqual(expect.arrayContaining(['employee_card', 'block_employee', 'set_employee_access', 'update_employee_card', 'my_calendar']));
  });

  it('основателю доступно управление, календарь — только с грантом', () => {
    const n = names(founder);
    expect(n).toEqual(expect.arrayContaining(['employee_card', 'block_employee', 'unblock_employee', 'set_employee_access', 'create_employee']));
    expect(n).not.toContain('my_calendar');
    expect(names({ ...smm, extraPermissions: ['calendar.view'] })).toContain('my_calendar');
  });

  it('вторая роль admin даёт доступ к блокировке', () => {
    expect(names({ ...smm, secondaryRole: 'admin' })).toContain('block_employee');
  });

  it('запрет заметок снимает инструменты заметок', () => {
    expect(names({ ...smm, deniedPermissions: ['notes.use'] })).not.toContain('note_create');
  });

  it('имена инструментов уникальны', () => {
    const all = ADMIN_TOOLS.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('карточка и изменение сотрудника', () => {
  it('зарплата показывается только при праве', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow()] });
    const founder = await employeeCard.run({ employee: 'Али' }, ctxWith(api));
    expect(founder.salary).toBe(5000);
    const hr = await employeeCard.run({ employee: 'Али' }, ctxWith(api, { role: 'smm_director', extraPermissions: ['employees.view'] }));
    expect(hr.salary).toBeUndefined();
  });

  it('точное совпадение имени выигрывает у похожих', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow(), aliRow({ id: 'x', userId: 'y', fullName: 'Али Рахимов Второй' })] });
    const r = await employeeCard.run({ employee: 'Али Рахимов' }, ctxWith(api));
    expect(r.name).toBe('Али Рахимов');
  });

  it('два одинаково подходящих — просит уточнить', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow(), aliRow({ id: 'x', userId: 'y', fullName: 'Али Саидов' })] });
    await expect(employeeCard.run({ employee: 'Али' }, ctxWith(api))).rejects.toThrow(/несколько/);
  });

  it('правка телефона: тело — только поля DTO, undo возвращает прежнее', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow()], [`PATCH /employees/${ALI_EMP}`]: () => ({}) });
    const out = await updateEmployeeCard.run({ employee: 'Али', phone: '911', telegram: 'ali_tg' }, ctxWith(api));
    expect(api.calls[1].body).toEqual({ phone: '911', telegram: '@ali_tg' });
    expect((out as any).undo[0].body).toEqual({ phone: '900', telegram: null });
  });

  it('смена должности — без undo; то же значение — ошибка', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow()], [`PATCH /employees/${ALI_EMP}`]: () => ({}) });
    const out: any = await updateEmployeeCard.run({ employee: 'Али', position: 'Видеограф' }, ctxWith(api));
    expect(out.undo).toBeUndefined();
    await expect(updateEmployeeCard.run({ employee: 'Али', phone: '900' }, ctxWith(api))).rejects.toThrow(/Нечего менять/);
    await expect(updateEmployeeCard.run({ employee: 'Али', position: 'Основатель' }, ctxWith(api))).rejects.toThrow(/Должность/);
  });

  it('зарплату без права менять нельзя', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow()] });
    const c = ctxWith(api, { role: 'smm_director', extraPermissions: ['employees.edit'] });
    await expect(updateEmployeeCard.run({ employee: 'Али', salary: 9999 }, c)).rejects.toThrow(/зарплат/);
  });

  it('создание требует email и должность из списка; роль берётся из должности', async () => {
    const api = fakeApi({ 'POST /employees': (b) => ({ id: 'new', ...b }) });
    const c = ctxWith(api);
    await expect(createEmployee.preview!({ full_name: 'Нов', position: 'Дизайнер', email: 'не-почта' }, c)).rejects.toThrow(/email/i);
    await expect(createEmployee.preview!({ full_name: 'Нов', position: 'Директор', email: 'a@b.tj' }, c)).rejects.toThrow(/должность/);
    const out: any = await createEmployee.run({ full_name: 'Нов', position: 'Дизайнер', email: 'A@B.tj', telegram: 'nov' }, c);
    expect(api.calls[0].body).toMatchObject({ fullName: 'Нов', email: 'a@b.tj', role: 'designer', department: 'Общий', hireDate: '2026-11-10', telegram: '@nov' });
    expect(out.undo[0]).toEqual({ method: 'DELETE', path: '/employees/new' });
  });
});

describe('блокировка', () => {
  it('блок: причина уходит в запрос, undo — разблокировка; требует подтверждения', async () => {
    const api = fakeApi({ 'GET /employees': () => [aliRow()], [`PATCH /users/${ALI}/block`]: () => ({}) });
    const c = ctxWith(api);
    expect(blockEmployee.confirm!({ employee: 'Али' }, c)).toBe(true);
    const out: any = await blockEmployee.run({ employee: 'Али', reason: 'ушёл' }, c);
    expect(api.calls[1].body).toEqual({ reason: 'ушёл' });
    expect(out.undo[0].path).toBe(`/users/${ALI}/unblock`);
  });

  it('уже заблокированного и себя блокировать нельзя, разблокировать незаблокированного — тоже', async () => {
    const blocked = fakeApi({ 'GET /employees': () => [aliRow({ user: { role: 'designer', isBlocked: true, blockReason: 'ушёл' } })] });
    await expect(blockEmployee.preview!({ employee: 'Али' }, ctxWith(blocked))).rejects.toThrow(/уже заблокирован/);
    const free = fakeApi({ 'GET /employees': () => [aliRow()] });
    await expect(unblockEmployee.preview!({ employee: 'Али' }, ctxWith(free))).rejects.toThrow(/не заблокирован/);
    const me = fakeApi({ 'GET /employees': () => [aliRow({ userId: ME })] });
    await expect(blockEmployee.preview!({ employee: 'Али' }, ctxWith(me))).rejects.toThrow(/Себя/);
  });

  it('отказ сервера превращается в текст человеку', async () => {
    const api = fakeApi({
      'GET /employees': () => [aliRow()],
      [`PATCH /users/${ALI}/block`]: () => { throw new ApiError(403, 'Заблокировать администратора может только основатель'); },
    });
    await expect(blockEmployee.run({ employee: 'Али' }, ctxWith(api))).rejects.toBeInstanceOf(ToolError);
  });

  it('разблокировка: undo блокирует обратно с прежней причиной', async () => {
    const api = fakeApi({
      'GET /employees': () => [aliRow({ user: { role: 'designer', isBlocked: true, blockReason: 'ушёл' } })],
      [`PATCH /users/${ALI}/unblock`]: () => ({}),
    });
    const out: any = await unblockEmployee.run({ employee: 'Али' }, ctxWith(api));
    expect(out.undo[0]).toEqual({ method: 'PATCH', path: `/users/${ALI}/block`, body: { reason: 'ушёл' } });
  });
});

describe('доступы', () => {
  const catalog = [
    { key: 'clients.view', label: 'Клиенты — просмотр', category: 'Клиенты', roles: ['admin', 'founder'], danger: false },
    { key: 'tasks.delete', label: 'Задачи — удаление', category: 'Задачи', roles: ['designer'], danger: true },
  ];
  const access = (over: Record<string, any> = {}) => [
    { id: ALI, name: 'Али Рахимов', role: 'designer', secondaryRole: null, extraPermissions: [], deniedPermissions: [], isActive: true, ...over },
    { id: ME, name: 'Тест Основатель', role: 'founder', secondaryRole: null, extraPermissions: [], deniedPermissions: [], isActive: true },
  ];

  it('выдать: добавляется в extra, undo возвращает прежние списки', async () => {
    const api = fakeApi({
      'GET /users/access/catalog': () => catalog, 'GET /users/access': () => access(), [`PATCH /users/${ALI}/access`]: () => ({}),
    });
    const out: any = await setEmployeeAccess.run({ employee: 'Али', grant: 'clients.view', action: 'give' }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ permissions: ['clients.view'], denied: [] });
    expect(out.undo[0].body).toEqual({ permissions: [], denied: [] });
  });

  it('забрать право роли — через запрет; забрать лишнее — только убрать из extra', async () => {
    const api = fakeApi({
      'GET /users/access/catalog': () => catalog, 'GET /users/access': () => access(), [`PATCH /users/${ALI}/access`]: () => ({}),
    });
    await setEmployeeAccess.run({ employee: 'Али', grant: 'tasks.delete', action: 'take' }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ permissions: [], denied: ['tasks.delete'] });

    const api2 = fakeApi({
      'GET /users/access/catalog': () => catalog,
      'GET /users/access': () => access({ extraPermissions: ['clients.view'] }),
      [`PATCH /users/${ALI}/access`]: () => ({}),
    });
    await setEmployeeAccess.run({ employee: 'Али', grant: 'clients.view', action: 'take' }, ctxWith(api2));
    expect(api2.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ permissions: [], denied: [] });
  });

  it('отнятое ранее право возвращается снятием запрета', async () => {
    const api = fakeApi({
      'GET /users/access/catalog': () => catalog,
      'GET /users/access': () => access({ deniedPermissions: ['tasks.delete'] }),
      [`PATCH /users/${ALI}/access`]: () => ({}),
    });
    await setEmployeeAccess.run({ employee: 'Али', grant: 'tasks.delete', action: 'give' }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ permissions: [], denied: [] });
  });

  it('ошибки: уже есть, и так нет, себе нельзя, выдуманный ключ', async () => {
    const api = fakeApi({ 'GET /users/access/catalog': () => catalog, 'GET /users/access': () => access() });
    const c = ctxWith(api);
    await expect(setEmployeeAccess.preview!({ employee: 'Али', grant: 'tasks.delete', action: 'give' }, c)).rejects.toThrow(/уже есть/);
    await expect(setEmployeeAccess.preview!({ employee: 'Али', grant: 'clients.view', action: 'take' }, c)).rejects.toThrow(/и так нет/);
    await expect(setEmployeeAccess.preview!({ employee: 'Тест Основатель', grant: 'clients.view', action: 'give' }, c)).rejects.toThrow(/собственные/);
    await expect(setEmployeeAccess.preview!({ employee: 'Али', grant: 'выдумка', action: 'give' }, c)).rejects.toThrow(/нет/);
  });

  it('подтверждение обязательно', () => {
    expect(setEmployeeAccess.confirm!({} as any, ctxWith(fakeApi({})))).toBe(true);
  });
});

describe('чек-листы', () => {
  const items = [{ id: 'i1', text: 'макет', isDone: false }, { id: 'i2', text: 'тексты', isDone: true }];

  it('добавление нескольких пунктов, undo удаляет каждый', async () => {
    let n = 0;
    const api = fakeApi({ [`POST /tasks/${TASK}/checklist`]: () => ({ id: `new${++n}` }) });
    const c = ctxWith(api);
    c.refs.add('T', TASK, 'Задача');
    const out: any = await checklistAdd.run({ task: 'T1', texts: ['а', 'б', ' '] }, c);
    expect(api.calls.map((x) => x.body)).toEqual([{ text: 'а' }, { text: 'б' }]);
    expect(out.undo.map((u: any) => u.path)).toEqual([`/tasks/${TASK}/checklist/new1`, `/tasks/${TASK}/checklist/new2`]);
  });

  it('отметка переключает только если состояние отличается', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}/checklist`]: () => items,
      [`PATCH /tasks/${TASK}/checklist/i1/toggle`]: () => ({}),
    });
    const c = ctxWith(api);
    const ref = c.refs.add('K', `${TASK}:i1`, 'макет');
    const done: any = await checklistSet.run({ item: ref, done: true }, c);
    expect(done.undo[0].path).toBe(`/tasks/${TASK}/checklist/i1/toggle`);
    const ref2 = c.refs.add('K', `${TASK}:i2`, 'тексты');
    const same: any = await checklistSet.run({ item: ref2, done: true }, c);
    expect(same.undo).toBeUndefined();
    expect(api.calls.filter((x) => x.method === 'PATCH')).toHaveLength(1);
  });

  it('неизвестная метка — понятная ошибка', async () => {
    await expect(checklistSet.run({ item: 'K9', done: true }, ctxWith(fakeApi({})))).rejects.toThrow(/Нет пункта/);
  });
});

describe('заметки', () => {
  it('изменение: undo хранит прежние значения; без полей — ошибка; плохая дата — ошибка', async () => {
    const api = fakeApi({
      'GET /my-notes': () => [{ id: 'n1', text: 'позвонить', date: '2026-11-12', done: false }],
      'PATCH /my-notes/n1': () => ({}),
    });
    const c = ctxWith(api);
    const ref = c.refs.add('N', 'n1', 'позвонить');
    const out: any = await noteUpdate.run({ note: ref, done: true, clear_date: true }, c);
    expect(api.calls[1].body).toEqual({ date: null, done: true });
    expect(out.undo[0].body).toEqual({ date: '2026-11-12', done: false });
    await expect(noteUpdate.run({ note: ref }, c)).rejects.toThrow(/Что изменить/);
    await expect(noteUpdate.run({ note: ref, date: '2026-02-31' }, c)).rejects.toThrow(/дата/i);
  });

  it('удаление требует подтверждения', () => {
    expect(noteDelete.confirm!({ note: 'N1' }, ctxWith(fakeApi({})))).toBe(true);
  });
});

describe('уведомления, календарь, отчёты', () => {
  it('отметка одного уведомления и «все»', async () => {
    const api = fakeApi({ 'PATCH /notifications/n1/read': () => ({}), 'PATCH /notifications/read-all': () => ({}) });
    const c = ctxWith(api);
    await markNotificationsRead.run({ notification: c.refs.add('X', 'n1', 'Новая задача') }, c);
    await markNotificationsRead.run({ all: true }, c);
    expect(api.calls.map((x) => x.path)).toEqual(['/notifications/n1/read', '/notifications/read-all']);
    await expect(markNotificationsRead.run({}, c)).rejects.toThrow(/Какое уведомление/);
  });

  it('календарь переводит время в Душанбе и не двигает события «на весь день»', async () => {
    const api = fakeApi({
      'GET /calendar/events': () => [
        { type: 'task', taskId: 't1', title: 'Макет', date: '2026-11-10T10:00:00.000Z', status: 'new' },
        { type: 'client_payment', title: 'Оплата: А', date: '2026-11-10T00:00:00' },
        { type: 'shoot', title: 'Съёмка', date: '2026-11-11T12:00:00' },
        { type: 'task', taskId: 't2', title: 'Вне периода', date: '2026-11-20T10:00:00.000Z' },
      ],
    });
    const r = await myCalendar.run({ from: '2026-11-10', to: '2026-11-11' }, ctxWith(api));
    expect(r.total).toBe(3);
    expect(r.events[0]).toMatchObject({ date: '2026-11-10', time: '15:00', task: 'T1' });
    expect(r.events[1].time).toBeUndefined();
    expect(r.events[2]).toMatchObject({ date: '2026-11-11' });
    await expect(myCalendar.run({ from: '2026-11-12', to: '2026-11-10' }, ctxWith(api))).rejects.toThrow(/раньше/);
  });

  it('правка отчёта: только свой, часы в пределах суток, undo с прежними значениями', async () => {
    const api = fakeApi({
      'GET /reports/my': () => [{ id: 'r1', date: '2026-11-09', description: 'делал', timeSpent: '2.00' }],
      'PATCH /reports/r1': () => ({}),
    });
    const c = ctxWith(api);
    const ref = c.refs.add('X', 'r1', 'Отчёт');
    const out: any = await editMyReport.run({ report: ref, hours: 6 }, c);
    expect(api.calls[1].body).toEqual({ timeSpent: 6 });
    expect(out.undo[0].body).toEqual({ timeSpent: 2 });
    await expect(editMyReport.run({ report: ref, hours: 25 }, c)).rejects.toThrow(/Часы/);
    const foreign = c.refs.add('X', 'other', 'Чужой');
    await expect(editMyReport.run({ report: foreign, hours: 1 }, c)).rejects.toThrow(/не ваш/);
  });
});
