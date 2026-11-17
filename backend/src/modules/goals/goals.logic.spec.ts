import {
  addDays, countStatuses, dayName, dayOfWeek, daysInMonth, daysLeft, elapsed, fmtNum, fmtValue, isYm, monthEnd,
  monthName, monthWeeks, monthWindow, paceOf, plural, progressOf, rollupValue, shiftYm, statusOf, trendWindow,
  weekStart, worstStatus,
} from './goals.logic';

describe('goals.logic — календарь', () => {
  it('месяц: длина, конец, сдвиг, проверка', () => {
    expect(daysInMonth('2026-11')).toBe(30);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(shiftYm('2026-01', -1)).toBe('2025-12');
    expect(shiftYm('2026-12', 1)).toBe('2027-01');
    expect(isYm('2026-11')).toBe(true);
    expect(isYm('2026-13')).toBe(false);
    expect(isYm('2026-1')).toBe(false);
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('неделя начинается с понедельника', () => {
    expect(dayOfWeek('2026-11-16')).toBe(1);
    expect(dayOfWeek('2026-11-22')).toBe(7);
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-12-01')).toBe('2026-11-30');
  });

  it('elapsed: прошедший — 1, будущий — 0, текущий — день/дней', () => {
    expect(elapsed('2026-10', '2026-11-16')).toBe(1);
    expect(elapsed('2026-12', '2026-11-16')).toBe(0);
    expect(elapsed('2026-11', '2026-11-16')).toBeCloseTo(16 / 30, 6);
  });

  it('дней до конца месяца', () => {
    expect(daysLeft('2026-11', '2026-11-16')).toBe(14);
    expect(daysLeft('2026-10', '2026-11-16')).toBe(0);
    expect(daysLeft('2026-12', '2026-11-16')).toBe(45);
  });

  it('окно месяца и окно тренда', () => {
    expect(monthWindow('2026-11', '2026-11-16')).toEqual({ from: '2026-11-01', to: '2026-11-16' });
    expect(monthWindow('2026-10', '2026-11-16')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthWindow('2026-12', '2026-11-16')).toBeNull();
    expect(trendWindow({ from: '2026-11-01', to: '2026-11-16' })).toEqual({ from: '2026-11-01', to: '2026-11-09' });
    expect(trendWindow({ from: '2026-11-01', to: '2026-11-05' })).toBeNull();
    expect(trendWindow(null)).toBeNull();
  });

  it('недели месяца для истории отметок', () => {
    expect(monthWeeks('2026-11', '2026-11-16')).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(monthWeeks('2026-10', '2026-11-16')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(monthWeeks('2026-12', '2026-11-16')).toEqual([]);
    expect(monthWeeks('2026-11', '2026-11-30', 5)).toHaveLength(5);
  });
});

describe('goals.logic — прогресс и темп', () => {
  it('sum/rate — доля цели', () => {
    expect(progressOf('sum', 50, 200)).toBe(25);
    expect(progressOf('rate', 93, 90)).toBe(103.3);
  });
  it('lower — в норме 100, иначе target/value', () => {
    expect(progressOf('lower', 4, 5)).toBe(100);
    expect(progressOf('lower', 0, 5)).toBe(100);
    expect(progressOf('lower', 10, 5)).toBe(50);
  });
  it('нет данных или цели — null', () => {
    expect(progressOf('sum', null, 100)).toBeNull();
    expect(progressOf('sum', 10, 0)).toBeNull();
  });
  it('темп — только sum текущего месяца', () => {
    expect(paceOf('sum', '2026-11', '2026-11-16')).toBe(53.3);
    expect(paceOf('rate', '2026-11', '2026-11-16')).toBeNull();
    expect(paceOf('sum', '2026-10', '2026-11-16')).toBeNull();
  });
});

describe('goals.logic — статус', () => {
  const base = { unit: 'money' as const, source: 'revenue', target: 300000, ym: '2026-11', today: '2026-11-16' };

  it('нет данных — none', () => {
    expect(statusOf({ ...base, kind: 'sum', value: null })).toBe('none');
  });

  it('sum: по темпу месяца', () => {
    expect(statusOf({ ...base, kind: 'sum', value: 300000 })).toBe('on_track');
    expect(statusOf({ ...base, kind: 'sum', value: 150000 })).toBe('on_track'); // 0,94 темпа
    expect(statusOf({ ...base, kind: 'sum', value: 120000 })).toBe('at_risk'); // 0,75
    expect(statusOf({ ...base, kind: 'sum', value: 90000 })).toBe('off_track'); // 0,56
  });

  it('sum: первые 5 дней — в графике', () => {
    expect(statusOf({ ...base, kind: 'sum', value: 0, today: '2026-11-05' })).toBe('on_track');
    expect(statusOf({ ...base, kind: 'sum', value: 0, today: '2026-11-06' })).toBe('off_track');
  });

  it('sum: прошедший месяц — выполнено или нет', () => {
    expect(statusOf({ ...base, kind: 'sum', value: 300000, ym: '2026-10' })).toBe('done');
    expect(statusOf({ ...base, kind: 'sum', value: 299999, ym: '2026-10' })).toBe('missed');
  });

  it('rate: допуск 3 п. у процентов и 5 % у остального', () => {
    const r = { ...base, kind: 'rate' as const, unit: 'percent' as const, source: 'content_ontime', target: 90 };
    expect(statusOf({ ...r, value: 91 })).toBe('on_track');
    expect(statusOf({ ...r, value: 88 })).toBe('at_risk');
    expect(statusOf({ ...r, value: 86 })).toBe('off_track');
    expect(statusOf({ ...r, value: 90, ym: '2026-10' })).toBe('done');
    expect(statusOf({ ...r, value: 89, ym: '2026-10' })).toBe('missed');
    const c = { ...r, unit: 'count' as const, target: 100 };
    expect(statusOf({ ...c, value: 96 })).toBe('at_risk');
    expect(statusOf({ ...c, value: 94 })).toBe('off_track');
  });

  it('lower: меньше — лучше', () => {
    const l = { ...base, kind: 'lower' as const, unit: 'percent' as const, source: 'overdue_share', target: 5 };
    expect(statusOf({ ...l, value: 4 })).toBe('on_track');
    expect(statusOf({ ...l, value: 7.5 })).toBe('at_risk');
    expect(statusOf({ ...l, value: 9 })).toBe('off_track');
    expect(statusOf({ ...l, value: 5, ym: '2026-10' })).toBe('done');
    expect(statusOf({ ...l, value: 6, ym: '2026-10' })).toBe('missed');
  });

  it('manual: выполнено по цифре, иначе — отметка недели', () => {
    const m = { ...base, kind: 'sum' as const, unit: 'count' as const, source: 'manual', target: 10 };
    expect(statusOf({ ...m, value: 10 })).toBe('done');
    expect(statusOf({ ...m, value: 4, lastCheckin: 'at_risk' })).toBe('at_risk');
    expect(statusOf({ ...m, value: 4 })).toBe('none');
    expect(statusOf({ ...m, value: 4, ym: '2026-10' })).toBe('missed');
    expect(statusOf({ ...m, value: null, lastCheckin: 'on_track' })).toBe('none');
  });

  it('сводный статус — худший', () => {
    expect(worstStatus(['on_track', 'at_risk', 'done'])).toBe('at_risk');
    expect(worstStatus(['missed', 'at_risk'])).toBe('missed');
    expect(worstStatus(['none', 'done'])).toBe('done');
    expect(worstStatus([])).toBe('none');
  });

  it('счётчики статусов', () => {
    expect(countStatuses(['on_track', 'on_track', 'off_track'])).toEqual({ on_track: 2, off_track: 1 });
    expect(countStatuses([])).toEqual({});
  });

  it('rollup — среднее прогресса с потолком 100', () => {
    expect(rollupValue([50, 120, null])).toBe(75);
    expect(rollupValue([null])).toBeNull();
    expect(rollupValue([])).toBeNull();
  });
});

describe('goals.logic — тексты', () => {
  it('склонение', () => {
    expect(plural(1, 'клиент', 'клиента', 'клиентов')).toBe('клиент');
    expect(plural(3, 'клиент', 'клиента', 'клиентов')).toBe('клиента');
    expect(plural(11, 'клиент', 'клиента', 'клиентов')).toBe('клиентов');
    expect(plural(21, 'клиент', 'клиента', 'клиентов')).toBe('клиент');
    expect(plural(25, 'клиент', 'клиента', 'клиентов')).toBe('клиентов');
  });

  it('цифры: деньги, проценты, штуки', () => {
    expect(fmtNum(1234567)).toBe('1 234 567');
    expect(fmtValue(141000, 'money')).toBe('141 000 с.');
    expect(fmtValue(93, 'percent')).toBe('93 %');
    expect(fmtValue(93.5, 'percent')).toBe('93,5 %');
    expect(fmtValue(11, 'count')).toBe('11');
    expect(fmtValue(null, 'count')).toBe('—');
  });

  it('месяц и день по-русски', () => {
    expect(monthName('2026-11')).toBe('ноябрь 2026');
    expect(dayName('2026-11-25')).toBe('25 ноября');
  });
});
