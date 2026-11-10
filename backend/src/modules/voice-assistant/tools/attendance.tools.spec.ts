import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import {
  ATTENDANCE_TOOLS, absenceRemove, lateArrivals, lateCancel, lateFine, lateForgive, shiftAutoFineSet, shiftRequestDecide,
  shiftRequestsPending, vacationEnd, vacationPaidFromSpeech, vacationPayDecide, vacationSet, workScheduleSet,
} from './attendance.tools';
import { ToolContext } from './types';

const FIRUZ = '11111111-1111-1111-1111-111111111111';
const SABRINA = '22222222-2222-2222-2222-222222222222';
const EMP = '33333333-3333-3333-3333-333333333333';
const FIN = '44444444-4444-4444-4444-444444444444';
const VAC = '55555555-5555-5555-5555-555555555555';

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

function ctxWith(api: any, user: Partial<any> = {}, utterance = 'тест'): ToolContext {
  const refs = new RefTable();
  refs.add('E', FIRUZ, 'Фируз');
  refs.add('E', SABRINA, 'Сабрина');
  return {
    user: {
      id: 'founder-id', name: 'Основатель', role: 'founder', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user,
    } as any,
    api, refs, today: '2026-11-10', nowTime: '10:00', utterance,
  };
}

const lateItem = (userId: string, name: string, extra: Partial<any> = {}) => ({
  userId, name, role: 'designer', arrivedAt: '09:50', startsAt: '09:00', lateMinutes: 50, employeeId: 'e-' + name,
  linked: true, decision: null, amount: 100, ...extra,
});

const lateRoute = (pending: any[], fined: any[] = [], forgiven: any[] = []) => ({
  'GET /finance/late-fines': () => ({ date: '2026-11-10', amountPerLate: 100, pending, fined, forgiven }),
});

describe('права', () => {
  const names = (u: any) => ATTENDANCE_TOOLS.filter((t) => !t.available || t.available(u)).map((t) => t.name);
  it('обычному сотруднику недоступно ничего', () => {
    expect(names({ role: 'smm_specialist', secondaryRole: null, extraPermissions: [], deniedPermissions: [] })).toEqual([]);
  });
  it('админ без финансов: смены и отпуск, но не штрафы и не общий авто-штраф', () => {
    const n = names({ role: 'admin', secondaryRole: null, extraPermissions: ['employees.edit'], deniedPermissions: [] });
    expect(n).toContain('shift_request_decide');
    expect(n).toContain('vacation_set');
    expect(n).not.toContain('late_fine');
    expect(n).not.toContain('shift_auto_fine_set');
  });
  it('основатель видит всё', () => {
    expect(names({ role: 'founder', secondaryRole: null, extraPermissions: [], deniedPermissions: [] })).toHaveLength(ATTENDANCE_TOOLS.length);
  });
});

describe('late_arrivals', () => {
  it('отдаёт метки E и решения', async () => {
    const api = fakeApi(lateRoute([lateItem(FIRUZ, 'Фируз')], [lateItem(SABRINA, 'Сабрина', { decision: 'fined', amount: 150 })]));
    const out = await lateArrivals.run({}, ctxWith(api));
    expect(out.pending[0]).toMatchObject({ ref: 'E1', name: 'Фируз', lateMinutes: 50 });
    expect(out.fined[0].fine).toContain('150');
    expect(api.calls[0].query).toEqual({ date: '2026-11-10' });
  });
});

describe('late_fine', () => {
  it('шлёт ровно выбранных людей и сумму, сообщает сотруднику, даёт отмену', async () => {
    const api = fakeApi({
      ...lateRoute([lateItem(FIRUZ, 'Фируз'), lateItem(SABRINA, 'Сабрина')]),
      'POST /finance/late-fines': () => ({ ok: true, created: 1, date: '2026-11-10' }),
    });
    const ctx = ctxWith(api);
    const out = await lateFine.run({ employees: ['E1'], amount: 200 }, ctx);
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ date: '2026-11-10', amount: 200, userIds: [FIRUZ] });
    expect(out.notify).toHaveLength(1);
    expect(out.notify?.[0].userId).toBe(FIRUZ);
    expect(out.undo).toEqual([{ method: 'DELETE', path: `/finance/late-fines?date=2026-11-10&userId=${FIRUZ}` }]);
    expect(lateFine.confirm?.({}, ctx)).toBe(true);
  });

  it('без имён и без all не шлёт запрос (пустой список сервер понял бы как «всех»)', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(FIRUZ, 'Фируз')]) });
    await expect(lateFine.preview!({ employees: [] }, ctxWith(api))).rejects.toThrow(/Кого штрафовать/);
    await expect(lateFine.run({}, ctxWith(api))).rejects.toThrow(/Кого штрафовать/);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('по имени находит опоздавшего, а не опоздавшему отказывает', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(FIRUZ, 'Самадов Фируз')]) });
    const pv = await lateFine.preview!({ employees: ['Фирузу'] }, ctxWith(api));
    expect(pv).toContain('ШТРАФ ЗА ОПОЗДАНИЕ');
    expect(pv).toContain('100');
    await expect(lateFine.preview!({ employees: ['Анвар'] }, ctxWith(api))).rejects.toThrow(/не опаздывал/);
  });

  it('уже оштрафованному повторно не штрафует', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(SABRINA, 'Сабрина')], [lateItem(FIRUZ, 'Фируз', { decision: 'fined' })]) });
    await expect(lateFine.preview!({ employees: ['E1'] }, ctxWith(api))).rejects.toThrow(/уже принято решение/);
  });

  it('без строки в ведомости штраф не проводит', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(FIRUZ, 'Фируз', { linked: false })]) });
    await expect(lateFine.preview!({ employees: ['E1'] }, ctxWith(api))).rejects.toThrow(/нет строки в зарплатной ведомости/);
  });

  it('all=true штрафует всех неразобранных', async () => {
    const api = fakeApi({
      ...lateRoute([lateItem(FIRUZ, 'Фируз'), lateItem(SABRINA, 'Сабрина')]),
      'POST /finance/late-fines': () => ({ created: 2 }),
    });
    const out = await lateFine.run({ all: true }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'POST')?.body.userIds).toEqual([FIRUZ, SABRINA]);
    expect(out.undo).toHaveLength(2);
  });

  it('сервер ничего не провёл — честная ошибка, а не «готово»', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(FIRUZ, 'Фируз')]), 'POST /finance/late-fines': () => ({ created: 0 }) });
    await expect(lateFine.run({ employees: ['E1'] }, ctxWith(api))).rejects.toThrow(/не проведён/);
  });
});

describe('late_forgive и late_cancel', () => {
  it('прощает выбранного и отменяет прощение через DELETE', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(SABRINA, 'Сабрина'), lateItem(FIRUZ, 'Фируз')]), 'POST /finance/late-fines/forgive': () => ({ forgiven: 1 }) });
    const out = await lateForgive.run({ employees: ['E2'] }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ date: '2026-11-10', userIds: [SABRINA] });
    expect(out.undo?.[0].method).toBe('DELETE');
  });

  it('отмена штрафа: сообщение сотруднику и возврат штрафа при отмене', async () => {
    const api = fakeApi({
      ...lateRoute([], [lateItem(FIRUZ, 'Фируз', { decision: 'fined', amount: 150 })]),
      [`DELETE /finance/late-fines?date=2026-11-10&userId=${FIRUZ}`]: () => ({ ok: true }),
    });
    const out = await lateCancel.run({ employee: 'E1' }, ctxWith(api));
    expect(out.notify?.[0].userId).toBe(FIRUZ);
    expect(out.undo).toEqual([{ method: 'POST', path: '/finance/late-fines', body: { date: '2026-11-10', amount: 150, userIds: [FIRUZ] } }]);
  });

  it('нет решения — ошибка', async () => {
    const api = fakeApi({ ...lateRoute([lateItem(FIRUZ, 'Фируз')]) });
    await expect(lateCancel.preview!({ employee: 'E1' }, ctxWith(api))).rejects.toThrow(/решений по опозданиям нет/);
  });
});

describe('просьбы и правки', () => {
  const routes = (noticeStatus = 'pending') => ({
    'GET /work-shifts/notices': () => ({ items: [{ id: 'n1', userId: FIRUZ, name: 'Фируз', date: '2026-11-12', plannedTime: '11:00', startTime: '09:00', reason: 'врач', status: noticeStatus }] }),
    'GET /work-shifts/edits': () => ({ items: [{ id: 'ed1', employeeId: SABRINA, name: 'Сабрина', date: '2026-11-09', field: 'end', requestedTime: '18:30', currentTime: '17:00', note: null }] }),
    'PATCH /work-shifts/notices/n1': () => ({ ok: true }),
    'PATCH /work-shifts/edits/ed1': () => ({ ok: true }),
  });

  it('список даёт метки L и решает по правильному эндпоинту', async () => {
    const api = fakeApi(routes());
    const ctx = ctxWith(api);
    const list = await shiftRequestsPending.run({}, ctx);
    expect(list.notices[0].ref).toBe('L1');
    expect(list.edits[0].ref).toBe('L2');
    await shiftRequestDecide.run({ request: 'L1', approve: true }, ctx);
    await shiftRequestDecide.run({ request: 'L2', approve: false }, ctx);
    expect(api.calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body])).toEqual([
      ['/work-shifts/notices/n1', { approve: true }],
      ['/work-shifts/edits/ed1', { approve: false }],
    ]);
  });

  it('уже решённую просьбу не трогает; approve обязателен', async () => {
    const api = fakeApi(routes('approved'));
    const ctx = ctxWith(api);
    ctx.refs.add('L', 'n1', 'x');
    await expect(shiftRequestDecide.preview!({ request: 'L1', approve: true }, ctx)).rejects.toThrow(/уже одобрена/);
    await expect(shiftRequestDecide.run({ request: 'L1' } as any, ctx)).rejects.toThrow(/Одобрить или отклонить/);
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('выдуманную метку не принимает', async () => {
    const api = fakeApi(routes());
    await expect(shiftRequestDecide.preview!({ request: 'L7', approve: true }, ctxWith(api))).rejects.toThrow(/Нет заявки/);
  });
});

describe('absence_remove', () => {
  const month = (kind?: string) => ({ 'GET /work-shifts/month': () => ({ ym: '2026-11', daysInMonth: 30, items: [{ id: FIRUZ, name: 'Фируз', absences: kind ? { 12: kind } : {} }] }) });

  it('снимает отметку и умеет вернуть прежний вид', async () => {
    const api = fakeApi({ ...month('sick'), [`DELETE /work-shifts/absence?employeeId=${FIRUZ}&date=2026-11-12`]: () => ({ ok: true }) });
    const out = await absenceRemove.run({ employee: 'E1', date: '2026-11-12' }, ctxWith(api));
    expect(out.undo).toEqual([{ method: 'POST', path: '/work-shifts/absence', body: { employeeId: FIRUZ, date: '2026-11-12', kind: 'sick' } }]);
  });

  it('нет отметки — ошибка без вызова DELETE', async () => {
    const api = fakeApi(month());
    await expect(absenceRemove.run({ employee: 'E1', date: '2026-11-12' }, ctxWith(api))).rejects.toThrow(/нет отметки/);
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('графики и авто-штраф', () => {
  const schedules = {
    'GET /work-shifts/schedules': () => ({
      today: '2026-11-10',
      company: { startTime: '09:00', endTime: '18:00', graceMinutes: 30, workdays: '1,2,3,4,5,6', floating: false, normMinutes: 480, validFrom: null, upcoming: [] },
      settings: { autoFine: false, fineAmount: '100.00', graceMinutes: 30, runHour: 21, noticeDaysBefore: 1 },
      items: [
        { id: FIRUZ, name: 'Фируз', custom: false, since: null, startTime: '09:00', endTime: '18:00', graceMinutes: 30, workdays: '1,2,3,4,5,6', floating: false, normMinutes: 480 },
        { id: SABRINA, name: 'Сабрина', custom: false, since: null, startTime: '09:00', endTime: '18:00', graceMinutes: 30, workdays: '1,2,3,4,5,6', floating: false, normMinutes: 480 },
      ],
    }),
  };

  it('личный график: тело — только названные поля, остальным alsoUserIds, отмена возвращает «как у всех»', async () => {
    const api = fakeApi({ ...schedules, [`PATCH /work-shifts/schedules/${FIRUZ}`]: () => ({ ok: true }) });
    const out = await workScheduleSet.run({ employees: ['E1', 'E2'], startTime: '10:00', workdays: [1, 2, 3, 4, 5] }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ startTime: '10:00', workdays: '1,2,3,4,5', alsoUserIds: [SABRINA] });
    expect(out.undo).toEqual([
      { method: 'DELETE', path: `/work-shifts/schedules/${FIRUZ}`, body: { validFrom: '2026-11-10' } },
      { method: 'DELETE', path: `/work-shifts/schedules/${SABRINA}`, body: { validFrom: '2026-11-10' } },
    ]);
  });

  it('общий график — только основателю; задним числом и пустое изменение нельзя', async () => {
    const api = fakeApi(schedules);
    await expect(workScheduleSet.preview!({ company: true, startTime: '09:00' }, ctxWith(api, { role: 'admin' }))).rejects.toThrow(/только основатель/);
    await expect(workScheduleSet.preview!({ employees: ['E1'], startTime: '10:00', validFrom: '2026-11-01' }, ctxWith(api))).rejects.toThrow(/Задним числом/);
    await expect(workScheduleSet.preview!({ employees: ['E1'] }, ctxWith(api))).rejects.toThrow(/Что поменять/);
    await expect(workScheduleSet.preview!({ employees: ['E1'], workdays: [8] }, ctxWith(api))).rejects.toThrow(/от 1/);
  });

  it('авто-штраф: меняет названное и откатывает к прежнему', async () => {
    const api = fakeApi({ ...schedules, 'PATCH /work-shifts/settings': () => ({ ok: true }) });
    const out = await shiftAutoFineSet.run({ autoFine: true, fineAmount: 200 }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ autoFine: true, fineAmount: 200 });
    expect(out.undo).toEqual([{ method: 'PATCH', path: '/work-shifts/settings', body: { autoFine: false, fineAmount: 100 } }]);
    await expect(shiftAutoFineSet.preview!({ runHour: 25 }, ctxWith(api))).rejects.toThrow(/0 до 23/);
    expect(shiftAutoFineSet.available!({ role: 'admin', secondaryRole: null } as any)).toBe(false);
  });
});

describe('отпуск', () => {
  it('оплачиваемость определяется только по словам человека', () => {
    expect(vacationPaidFromSpeech('отправь Фарзона в отпуск с 1 по 10 декабря')).toBeNull();
    expect(vacationPaidFromSpeech('отпуск за свой счёт')).toBe(false);
    expect(vacationPaidFromSpeech('неоплачиваемый отпуск')).toBe(false);
    expect(vacationPaidFromSpeech('оплачиваемый отпуск')).toBe(true);
    expect(vacationPaidFromSpeech('отпуск с сохранением зарплаты')).toBe(true);
  });

  const employees = (extra: Partial<any> = {}) => ({
    'GET /employees': () => [{ id: EMP, userId: FIRUZ, fullName: 'Самадов Фируз', status: 'active', vacationFrom: null, vacationUntil: null, vacationPaid: false, ...extra }],
  });

  it('без слов про оплату не ставит и просит спросить', async () => {
    const api = fakeApi(employees());
    const ctx = ctxWith(api, {}, 'отправь Фируза в отпуск с 1 по 10 декабря');
    await expect(vacationSet.preview!({ employee: 'E1', from: '2026-12-01', until: '2026-12-10', paid: true }, ctx)).rejects.toThrow(/ask_choice/);
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('ставит отпуск через PATCH /employees и умеет вернуть как было', async () => {
    const api = fakeApi({ ...employees(), [`PATCH /employees/${EMP}`]: () => ({}) });
    const ctx = ctxWith(api, {}, 'отправь Фируза в отпуск с 1 по 10 декабря за свой счёт');
    const out = await vacationSet.run({ employee: 'E1', from: '2026-12-01', until: '2026-12-10' }, ctx);
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'vacation', vacationFrom: '2026-12-01', vacationUntil: '2026-12-10', vacationPaid: false });
    expect(out.undo).toEqual([{ method: 'PATCH', path: `/employees/${EMP}`, body: { status: 'active' } }]);
    expect(vacationSet.confirm?.({} as any, ctx)).toBe(true);
  });

  it('замена идущего отпуска: отмена возвращает прежние даты', async () => {
    const api = fakeApi({ ...employees({ status: 'vacation', vacationFrom: '2026-11-01', vacationUntil: '2026-11-20', vacationPaid: true }), [`PATCH /employees/${EMP}`]: () => ({}) });
    const ctx = ctxWith(api, {}, 'продли отпуск Фируза до 25 ноября оплачиваемый');
    const out = await vacationSet.run({ employee: 'E1', from: '2026-11-01', until: '2026-11-25' }, ctx);
    expect(out.undo?.[0].body).toEqual({ status: 'vacation', vacationFrom: '2026-11-01', vacationUntil: '2026-11-20', vacationPaid: true });
  });

  it('ошибки: конец раньше начала, уже закончился, неактивный', async () => {
    const ctx = ctxWith(fakeApi(employees()), {}, 'за свой счёт');
    await expect(vacationSet.preview!({ employee: 'E1', from: '2026-12-10', until: '2026-12-01' }, ctx)).rejects.toThrow(/раньше начала/);
    await expect(vacationSet.preview!({ employee: 'E1', from: '2026-10-01', until: '2026-10-05' }, ctx)).rejects.toThrow(/уже закончился/);
    const off = ctxWith(fakeApi(employees({ status: 'inactive' })), {}, 'за свой счёт');
    await expect(vacationSet.preview!({ employee: 'E1', until: '2026-12-01' }, off)).rejects.toThrow(/неактивный/);
  });

  it('vacation_end: только если сотрудник в отпуске', async () => {
    const api = fakeApi(employees());
    await expect(vacationEnd.preview!({ employee: 'E1' }, ctxWith(api))).rejects.toThrow(/не в отпуске/);
    const on = fakeApi({ ...employees({ status: 'vacation', vacationFrom: '2026-12-01', vacationUntil: '2026-12-10', vacationPaid: false }), [`PATCH /employees/${EMP}`]: () => ({}) });
    const out = await vacationEnd.run({ employee: 'E1' }, ctxWith(on));
    expect(on.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'active' });
    expect(out.undo?.[0].body).toMatchObject({ status: 'vacation', vacationUntil: '2026-12-10' });
  });
});

describe('vacation_pay_decide', () => {
  const salary = (entries: any[] = []) => ({
    'GET /finance/expense/detail/salary': () => ({
      rows: [{
        id: FIN, name: 'Fyruz', userId: FIRUZ, vacationEntries: entries,
        vacationHints: [{ vacationId: VAC, from: '2026-12-01', until: '2026-12-10', monthFrom: '2026-12-01', monthUntil: '2026-12-10', paid: false, days: 9, monthWorkdays: 27, salary: 3500, amount: 1167, state: 'pending' }],
      }],
    }),
  });

  it('удерживает подсказанную сумму; отмена удаляет созданную запись', async () => {
    let calls = 0;
    const api = fakeApi({
      'GET /finance/expense/detail/salary': () => {
        calls++;
        const rows: any = (salary(calls > 1 ? [{ id: 'new-entry' }] : []) as any)['GET /finance/expense/detail/salary']().rows;
        return { rows };
      },
      [`POST /finance/employees/${FIN}/vacation-hint`]: () => ({ ok: true }),
    });
    const out = await vacationPayDecide.run({ employee: 'E1', month: '2026-12', action: 'withhold' }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ vacationId: VAC, ym: '2026-12', action: 'withhold', amount: 1167 });
    expect(out.undo).toEqual([{ method: 'DELETE', path: `/finance/employees/${FIN}/deduction/new-entry?kind=vacation&ym=2026-12` }]);
  });

  it('«не удерживать» — без суммы и без отмены; нулевая своя сумма отклоняется', async () => {
    const api = fakeApi({ ...salary(), [`POST /finance/employees/${FIN}/vacation-hint`]: () => ({ ok: true }) });
    const out = await vacationPayDecide.run({ employee: 'E1', month: '2026-12', action: 'dismiss' }, ctxWith(api));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ vacationId: VAC, ym: '2026-12', action: 'dismiss' });
    expect(out.undo).toBeUndefined();
    await expect(vacationPayDecide.preview!({ employee: 'E1', month: '2026-12', action: 'withhold', amount: 0 }, ctxWith(api))).rejects.toThrow(/больше нуля/);
  });

  it('ошибка сайта доходит как текст', async () => {
    const api = fakeApi({ ...salary(), [`POST /finance/employees/${FIN}/vacation-hint`]: () => { throw new ApiError(400, 'Отпуск оплачиваемый'); } });
    await expect(vacationPayDecide.run({ employee: 'E1', month: '2026-12', action: 'withhold' }, ctxWith(api))).rejects.toThrow('Отпуск оплачиваемый');
  });
});
