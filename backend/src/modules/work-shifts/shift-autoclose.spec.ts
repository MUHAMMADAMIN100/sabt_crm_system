import { dayEndDushanbe, forgottenShiftEnd, staleOpenShifts } from './shift-autoclose';

// Забытая смена закрывается ровно в 23:59 по Душанбе того дня, когда она
// началась (решение владельца 24.10.2026). Раньше брали последнюю
// активность в CRM, а она обновляется только пока вкладка на экране:
// нажал «Начать», ушёл работать в Figma — и смена «08:57 — 08:57».

describe('dayEndDushanbe — конец дня смены', () => {
  it('23:59 по Душанбе — это 18:59 по Гринвичу того же дня', () => {
    expect(dayEndDushanbe('2026-10-17').toISOString()).toBe('2026-10-17T18:59:00.000Z');
  });
  it('не зависит от часового пояса сервера: прод живёт в UTC', () => {
    // Строка с явным смещением +05:00 не читается в поясе процесса.
    const end = dayEndDushanbe('2026-10-31');
    expect(new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Dushanbe', hour: '2-digit', minute: '2-digit',
    }).format(end)).toBe('23:59');
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(end)).toBe('2026-10-31');
  });
});

describe('forgottenShiftEnd — когда закрыть забытую смену', () => {
  it('начал в 08:57 и забыл — смена идёт до 23:59 своего дня, а не до 08:57', () => {
    const end = forgottenShiftEnd({ startedAt: new Date('2026-10-17T03:57:00Z'), date: '2026-10-17' });
    expect(end.toISOString()).toBe('2026-10-17T18:59:00.000Z');
  });
  it('смена прошлого дня, которую ночной крон пропустил, закрывается своим днём', () => {
    // Сервер перезапускался в 23:59 — закрываем вчерашним 23:59, а не сегодняшним.
    const end = forgottenShiftEnd({ startedAt: new Date('2026-10-22T04:07:00Z'), date: '2026-10-22' });
    expect(end.toISOString()).toBe('2026-10-22T18:59:00.000Z');
  });
  it('начал уже после 23:59 — конец равен началу, минус часов не бывает', () => {
    const started = new Date('2026-10-17T18:59:30Z'); // 23:59:30 по Душанбе
    expect(forgottenShiftEnd({ startedAt: started, date: '2026-10-17' }).getTime()).toBe(started.getTime());
  });
  it('дата из базы может прийти с хвостом времени — берём только день', () => {
    const end = forgottenShiftEnd({ startedAt: '2026-10-17T03:57:00Z', date: '2026-10-17T00:00:00.000Z' as any });
    expect(end.toISOString()).toBe('2026-10-17T18:59:00.000Z');
  });
  it('нет даты — день берём из начала смены по Душанбе', () => {
    // 02:00 по Душанбе 18-го = 21:00 UTC 17-го: день — 18-е, а не 17-е.
    const end = forgottenShiftEnd({ startedAt: new Date('2026-10-17T21:00:00Z'), date: '' });
    expect(end.toISOString()).toBe('2026-10-18T18:59:00.000Z');
  });
});

describe('staleOpenShifts — что закрыть при запуске сервера', () => {
  const rows = [
    { id: 'yesterday', date: '2026-10-23' },
    { id: 'today', date: '2026-10-24' },
    { id: 'week-ago', date: '2026-10-17' },
  ];
  it('только смены прошлых дней: сегодняшние ещё идут', () => {
    expect(staleOpenShifts(rows, '2026-10-24').map(r => r.id)).toEqual(['yesterday', 'week-ago']);
  });
  it('если всё сегодняшнее — закрывать нечего', () => {
    expect(staleOpenShifts([{ id: 'today', date: '2026-10-24' }], '2026-10-24')).toEqual([]);
  });
});
