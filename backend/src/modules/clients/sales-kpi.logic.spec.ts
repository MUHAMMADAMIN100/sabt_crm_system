import {
  COLD_CALL_EVENTS_SINCE, FUNNEL_ORDER, SALES_DAILY_TARGETS, buildSalesKpi, currentVacationRange, emailBecameSent,
  expandRanges, funnelStepIsForward, isWorkday, milestoneEquivalents, salesPeriod, workingDays,
} from './sales-kpi.logic';

// Честный KPI менеджера продаж (решения владельца 14.11.2026): пн–сб,
// без будущего и отпуска, встречи — событиями, пункт не больше 100 %.

const zero = { funnel_progress: 0, new_companies: 0, cold_calls: 0, personal_emails: 0, meetings: 0 };

describe('workingDays — рабочие дни пн–сб', () => {
  it('неделя пн 09.11 — вс 15.11: шесть дней, воскресенье — выходной', () => {
    expect(isWorkday('2026-11-14')).toBe(true);   // суббота
    expect(isWorkday('2026-11-15')).toBe(false);  // воскресенье
    expect(workingDays('2026-11-09', '2026-11-15', '2026-11-20')).toHaveLength(6);
  });

  it('октябрь 2026 — 27 рабочих дней пн–сб', () => {
    expect(workingDays('2026-10-01', '2026-10-31', '2026-11-14')).toHaveLength(27);
  });

  it('будущее обрезается сегодняшним днём', () => {
    // Месяц целиком, сегодня — среда 11.11: пн 02 … ср 11 без вс 08 = 9 дней.
    const days = workingDays('2026-11-01', '2026-11-30', '2026-11-11');
    expect(days).toHaveLength(9);
    expect(days[days.length - 1]).toBe('2026-11-11');
  });

  it('дни отпуска и отметок табеля в норму не идут', () => {
    const off = expandRanges([{ from: '2026-11-10', until: '2026-11-12' }], '2026-11-09', '2026-11-14');
    expect(off).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(workingDays('2026-11-09', '2026-11-14', '2026-11-14', new Set([...off, '2026-11-14']))).toEqual(['2026-11-09', '2026-11-13']);
  });

  it('отпуск без даты «с» уже шёл, без «по» — ещё идёт', () => {
    expect(expandRanges([{ from: null, until: '2026-11-03' }], '2026-11-01', '2026-11-05'))
      .toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(expandRanges([{ from: '2026-11-04', until: null }], '2026-11-01', '2026-11-05'))
      .toEqual(['2026-11-04', '2026-11-05']);
  });

  it('сегодня воскресенье или весь период в отпуске — ноль дней', () => {
    expect(workingDays('2026-11-15', '2026-11-15', '2026-11-15')).toEqual([]);
    expect(workingDays('2026-11-09', '2026-11-14', '2026-11-20',
      expandRanges([{ from: '2026-11-01', until: '2026-11-30' }], '2026-11-09', '2026-11-14'))).toEqual([]);
  });

  it('период целиком в будущем — ноль дней', () => {
    expect(workingDays('2026-11-20', '2026-11-25', '2026-11-14')).toEqual([]);
  });
});

// 15.11.2026: статус «В отпуске» без дат не превращает прошлое в выходные.
describe('currentVacationRange — текущий отпуск из карточки', () => {
  it('без даты «с» — отпуск с сегодняшнего дня, а не «всегда»', () => {
    const r = currentVacationRange({ from: null, until: null }, '2026-11-14');
    expect(r).toEqual({ from: '2026-11-14', until: null });
    expect(expandRanges([r], '2026-11-01', '2026-11-14')).toEqual(['2026-11-14']);
    // Октябрь целиком остаётся рабочим.
    expect(expandRanges([currentVacationRange({}, '2026-11-14')], '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('даты есть — берём их', () => {
    expect(currentVacationRange({ from: '2026-11-10', until: '2026-11-20' }, '2026-11-14'))
      .toEqual({ from: '2026-11-10', until: '2026-11-20' });
    expect(currentVacationRange({ from: null, until: '2026-11-20' }, '2026-11-14'))
      .toEqual({ from: '2026-11-14', until: '2026-11-20' });
  });
});

describe('salesPeriod — границы по Душанбе', () => {
  it('в 01:30 по Душанбе (20:30 UTC накануне) «сегодня» — уже новый день', () => {
    const now = new Date('2026-11-14T20:30:00Z');
    const p = salesPeriod(undefined, undefined, now);
    expect(p.todayIso).toBe('2026-11-15');
    expect(p.start.toISOString()).toBe('2026-11-14T19:00:00.000Z');
    // Сегодняшний день считаем до «сейчас», не до полуночи.
    expect(p.until).toBe(now);
  });

  it('прошлый период не обрезается, будущие дни — обрезаются', () => {
    const now = new Date('2026-11-14T10:00:00Z');
    const past = salesPeriod('2026-10-01', '2026-10-31', now);
    expect(past.until.toISOString()).toBe('2026-10-31T18:59:59.999Z');
    expect(past.countedToIso).toBe('2026-10-31');
    const month = salesPeriod('2026-11-01', '2026-11-30', now);
    expect(month.countedToIso).toBe('2026-11-14');
    expect(month.until).toBe(now);
    expect(month.end.toISOString()).toBe('2026-11-30T18:59:59.999Z');
  });

  it('мусор вместо даты — сегодня', () => {
    const p = salesPeriod('bad', '2026-13', new Date('2026-11-14T10:00:00Z'));
    expect([p.fromIso, p.toIso]).toEqual(['2026-11-14', '2026-11-14']);
  });

  it('события холодных звонков — с 16.06.2026', () => {
    expect(COLD_CALL_EVENTS_SINCE).toBe('2026-06-16');
  });
});

describe('buildSalesKpi — нормы и общий процент', () => {
  it('норма = дневная × рабочие дни', () => {
    const r = buildSalesKpi(zero, 6);
    expect(r.items.map(i => i.target)).toEqual([
      SALES_DAILY_TARGETS.funnel_progress * 6, SALES_DAILY_TARGETS.new_companies * 6,
      SALES_DAILY_TARGETS.cold_calls * 6, SALES_DAILY_TARGETS.personal_emails * 6, SALES_DAILY_TARGETS.meetings * 6,
    ]);
    expect(r.restDay).toBe(false);
    expect(r.workDays).toBe(6);
  });

  it('выполнил дневные нормы все 27 рабочих дней октября — 100 %', () => {
    const facts = {
      funnel_progress: 20 * 27, new_companies: 15 * 27, cold_calls: 20 * 27, personal_emails: 10 * 27, meetings: 2 * 27,
    };
    const r = buildSalesKpi(facts, 27);
    expect(r.overallPercent).toBe(100);
    expect(r.items.every(i => i.done)).toBe(true);
  });

  it('каждый пункт в среднем не больше 100 %: 60 звонков и ничего больше — не 60 %', () => {
    const r = buildSalesKpi({ ...zero, cold_calls: 60 }, 1);
    expect(r.items.find(i => i.key === 'cold_calls')!.percent).toBe(100);
    expect(r.overallPercent).toBe(20);
  });

  it('перевыполнение одного пункта не закрывает недобор другого', () => {
    const r = buildSalesKpi({ funnel_progress: 40, new_companies: 15, cold_calls: 20, personal_emails: 10, meetings: 0 }, 1);
    expect(r.overallPercent).toBe(80);
  });

  // 15.11.2026: нормы — из настроек продаж по направлению.
  it('свои дневные нормы направления: норма = норма направления × дни', () => {
    const norms = { funnel_progress: 5, new_companies: 4, cold_calls: 30, personal_emails: 0, meetings: 3 };
    const r = buildSalesKpi({ ...zero, meetings: 6, cold_calls: 30 }, 2, norms);
    expect(r.items.map(i => i.target)).toEqual([10, 8, 60, 0, 6]);
    expect(r.items.find(i => i.key === 'meetings')).toMatchObject({ value: 6, percent: 100, done: true });
    // Пункт с нормой 0 в общий процент не входит (не делим на ноль и не «100 % даром»).
    expect(r.overallPercent).toBe(Math.round((0 + 0 + 50 + 100) / 4));
  });

  it('подпись cold_calls — «Звонки», ключи метрик прежние', () => {
    const r = buildSalesKpi(zero, 1);
    expect(r.items.map(i => i.key)).toEqual(['funnel_progress', 'new_companies', 'cold_calls', 'personal_emails', 'meetings']);
    expect(r.items.find(i => i.key === 'cold_calls')!.label).toBe('Звонки');
  });

  it('выходной: нормы 0, ничего не «выполнено», процента нет', () => {
    const r = buildSalesKpi({ ...zero, cold_calls: 5 }, 0);
    expect(r.restDay).toBe(true);
    expect(r.overallPercent).toBe(0);
    expect(r.items.every(i => i.target === 0 && !i.done)).toBe(true);
    // Работа в воскресенье остаётся в факте.
    expect(r.items.find(i => i.key === 'cold_calls')!.value).toBe(5);
  });
});

describe('funnelStepIsForward — шаг воронки вперёд (15.11.2026)', () => {
  it('вперёд к реальному статусу/этапу', () => {
    expect(funnelStepIsForward(1, 0)).toBe(true);    // new → waiting
    expect(funnelStepIsForward(4, 3)).toBe(true);    // proposal → won
    expect(funnelStepIsForward(2, undefined)).toBe(true); // создание сразу с этапом
  });
  it('назад, на месте и в терминальные — нет', () => {
    expect(funnelStepIsForward(0, 1)).toBe(false);   // waiting → new
    expect(funnelStepIsForward(1, 3)).toBe(false);   // proposal → waiting
    expect(funnelStepIsForward(2, 2)).toBe(false);
    expect(funnelStepIsForward(-1, 4)).toBe(false);  // won → lost
  });
  it('из терминального — как из нулевого (повтор вершины отсекают вехи)', () => {
    expect(funnelStepIsForward(1, -1)).toBe(true);   // lost → waiting
    expect(funnelStepIsForward(0, -1)).toBe(false);  // lost → new
  });
});

describe('единая воронка — порядок этапов и вехи (15.11.2026)', () => {
  const fwd = (to: string, from: string) => funnelStepIsForward(FUNNEL_ORDER[to], FUNNEL_ORDER[from]);

  it('new → waiting → meeting → proposal → contract → won — каждый шаг вперёд', () => {
    const path = ['new', 'waiting', 'meeting', 'proposal', 'contract', 'won'];
    for (let i = 1; i < path.length; i++) expect(fwd(path[i], path[i - 1])).toBe(true);
    expect(fwd('contract', 'new')).toBe(true);
  });

  it('назад, в проигрыш и из устаревших «равных» — нет', () => {
    expect(fwd('meeting', 'proposal')).toBe(false);
    expect(fwd('lost', 'contract')).toBe(false);
    expect(fwd('waiting', 'negotiating')).toBe(false); // negotiating ≡ waiting
    expect(fwd('meeting', 'negotiating')).toBe(true);
    expect(fwd('meeting', 'lost')).toBe(true);           // вернули из проигрыша — вершины отсекают вехи
  });

  it('вехи этапов онбординга эквивалентны новым этапам', () => {
    expect(milestoneEquivalents('meeting')).toEqual({ statuses: ['meeting'], stages: ['meeting'] });
    expect(milestoneEquivalents('proposal')).toEqual({ statuses: ['proposal'], stages: ['kp_creation'] });
    expect(milestoneEquivalents('contract')).toEqual({ statuses: ['contract'], stages: ['contract'] });
    expect(milestoneEquivalents('won')).toEqual({ statuses: ['won'], stages: ['implementation'] });
    expect(milestoneEquivalents('waiting')).toEqual({ statuses: ['waiting', 'negotiating'], stages: ['negotiation'] });
  });
});

describe('emailBecameSent — письмо при отметке «Написал»', () => {
  it('считается переход в sent, в том числе при создании', () => {
    expect(emailBecameSent(null, { emailStatus: 'sent' })).toBe(true);
    expect(emailBecameSent({ emailStatus: null }, { emailStatus: 'sent' })).toBe(true);
    expect(emailBecameSent({ emailStatus: 'answered' }, { emailStatus: 'sent' })).toBe(true);
  });
  it('правка лида с уже отправленным письмом — не новое письмо', () => {
    expect(emailBecameSent({ emailStatus: 'sent' }, { emailStatus: 'sent' })).toBe(false);
    expect(emailBecameSent({ emailStatus: 'sent' }, { emailStatus: 'answered' })).toBe(false);
  });
});
