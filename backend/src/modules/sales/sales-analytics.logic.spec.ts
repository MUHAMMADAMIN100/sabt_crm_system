import {
  NO_SOURCE, buildFunnel, bySource, cycleDaysMedian, dushanbeDaysBetween, expectedInPeriod, groupMilestones,
  lostReasonCounts, median, pct, reachedRank, sumOrNull, wholeMonths,
} from './sales-analytics.logic';
import { analyticsPeriod } from './sales-analytics.service';

// Аналитика продаж (15.11.2026): математика без базы.

describe('воронка периода', () => {
  it('ранг: текущий этап или веха; устаревшие этапы и этапы онбординга — по SALES_SPEC §1', () => {
    expect(reachedRank('new')).toBe(0);
    expect(reachedRank('negotiating')).toBe(1);
    expect(reachedRank('unknown')).toBe(0);
    expect(reachedRank('contract')).toBe(4);
    // Проигранный — до чего дошёл, знают только вехи; «Новый» — всегда.
    expect(reachedRank('lost')).toBe(0);
    expect(reachedRank('lost', [{ leadId: 'x', statusTo: 'proposal' }])).toBe(3);
    expect(reachedRank('lost', [{ leadId: 'x', stageTo: 'kp_creation' }])).toBe(3);
    expect(reachedRank('waiting', [{ leadId: 'x', stageTo: 'implementation' }])).toBe(5);
    expect(reachedRank('waiting', [{ leadId: 'x', statusTo: 'negotiating' }, { leadId: 'x', stageTo: 'negotiation' }])).toBe(1);
    // Откаты и мусор в вехах ранг не снижают и не ломают.
    expect(reachedRank('proposal', [{ leadId: 'x', statusTo: 'new' }, { leadId: 'x', stageTo: 'cancelled' }])).toBe(3);
  });

  it('дошедший до этапа дошёл и до предыдущих; переход — от предыдущего этапа', () => {
    const leads = [
      { id: 'a', status: 'new' },
      { id: 'b', status: 'waiting' },
      { id: 'c', status: 'meeting' },
      { id: 'd', status: 'won' },
      { id: 'e', status: 'lost' },
    ];
    const ms = groupMilestones([{ leadId: 'e', stageTo: 'meeting' }, { leadId: 'zzz', statusTo: 'won' }]);
    expect(buildFunnel(leads, ms)).toEqual([
      { status: 'new', count: 5, conversionFromPrev: null },
      { status: 'waiting', count: 4, conversionFromPrev: 80 },
      { status: 'meeting', count: 3, conversionFromPrev: 75 },
      { status: 'proposal', count: 1, conversionFromPrev: 33.3 },
      { status: 'contract', count: 1, conversionFromPrev: 100 },
      { status: 'won', count: 1, conversionFromPrev: 100 },
    ]);
  });

  it('пустой период — нули, переход null (делить не на что)', () => {
    const f = buildFunnel([], new Map());
    expect(f.map(r => r.count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(f.every(r => r.conversionFromPrev === null)).toBe(true);
  });
});

describe('источники, проценты, суммы', () => {
  it('pct — один знак, от нуля — 0', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(5, 0)).toBe(0);
  });

  it('bySource: пусто — «Не указан», регистр и пробелы — один источник, больше лидов — выше', () => {
    const rows = bySource([
      { id: '1', status: 'won', leadSource: 'Instagram' },
      { id: '2', status: 'new', leadSource: ' instagram ' },
      { id: '3', status: 'lost', leadSource: null },
      { id: '4', status: 'won', leadSource: '' },
      { id: '5', status: 'won', leadSource: 'Рекомендация' },
      { id: '6', status: 'new', leadSource: 'INSTAGRAM' },
    ]);
    expect(rows).toEqual([
      { source: 'Instagram', leads: 3, won: 1, conversion: 33.3 },
      { source: NO_SOURCE, leads: 2, won: 1, conversion: 50 },
      { source: 'Рекомендация', leads: 1, won: 1, conversion: 100 },
    ]);
  });

  it('sumOrNull: все null — null, иначе сумма известных', () => {
    expect(sumOrNull([null, undefined])).toBeNull();
    expect(sumOrNull([100.25, null, 200])).toBe(300.25);
  });

  it('причины проигрыша: неизвестное и пустое — «Другое», частые выше', () => {
    expect(lostReasonCounts([
      { lostReason: 'price' }, { lostReason: 'price' }, { lostReason: null },
      { lostReason: 'weird' }, { lostReason: 'competitor' }, { lostReason: 'other' },
    ])).toEqual([
      { reason: 'other', count: 3 },
      { reason: 'price', count: 2 },
      { reason: 'competitor', count: 1 },
    ]);
  });
});

describe('цикл сделки', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('дни — по календарю Душанбе: 23:00 и 01:00 следующего дня — 1 день', () => {
    expect(dushanbeDaysBetween('2026-11-01T18:00:00Z', '2026-11-01T20:00:00Z')).toBe(1);
    expect(dushanbeDaysBetween('2026-11-01T05:00:00Z', '2026-11-01T10:00:00Z')).toBe(0);
  });

  it('только выигранные в периоде (по Душанбе), создание — любое', () => {
    const rows = [
      { createdAt: '2026-10-01T05:00:00Z', wonAt: '2026-11-11T05:00:00Z' },  // 41
      { createdAt: '2026-11-05T05:00:00Z', wonAt: '2026-11-10T05:00:00Z' },  // 5
      { createdAt: '2026-11-05T05:00:00Z', wonAt: '2026-10-31T19:30:00Z' },  // 1 ноября 00:30 по Душанбе — в периоде; 0 (раньше создания)
      { createdAt: '2026-11-01T05:00:00Z', wonAt: '2026-10-31T18:00:00Z' },  // 31 октября 23:00 — вне
      { createdAt: '2026-11-01T05:00:00Z', wonAt: null },
    ];
    expect(cycleDaysMedian(rows, '2026-11-01', '2026-11-30')).toBe(5);
    expect(cycleDaysMedian([], '2026-11-01', '2026-11-30')).toBeNull();
  });
});

describe('«Ожидается»', () => {
  it('активные с датой закрытия в периоде: потенциал × вероятность (своя или по этапу)', () => {
    expect(expectedInPeriod([
      { status: 'proposal', dealPotential: '10000.00', probability: null, expectedCloseAt: '2026-11-20' }, // 60 %
      { status: 'contract', dealPotential: 5000, probability: 50, expectedCloseAt: '2026-11-25' },
      { status: 'won', dealPotential: 9000, probability: null, expectedCloseAt: '2026-11-20' },            // не активный
      { status: 'meeting', dealPotential: 9000, probability: null, expectedCloseAt: '2026-12-02' },        // вне периода
      { status: 'meeting', dealPotential: null, probability: null, expectedCloseAt: '2026-11-20' },        // без суммы
    ], '2026-11-01', '2026-11-30')).toBe(8500);
    expect(expectedInPeriod([{ status: 'new', dealPotential: 100, expectedCloseAt: null }], '2026-11-01', '2026-11-30')).toBeNull();
  });
});

describe('месяцы для «План / Получено»', () => {
  it('целые месяцы — список; текущий месяц можно до сегодня; иначе null', () => {
    expect(wholeMonths('2026-11-01', '2026-11-30', '2026-11-15')).toEqual(['2026-11']);
    expect(wholeMonths('2026-11-01', '2026-11-15', '2026-11-15')).toEqual(['2026-11']);
    expect(wholeMonths('2026-09-01', '2026-11-30', '2026-11-15')).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(wholeMonths('2026-12-01', '2027-01-31', '2026-11-15')).toEqual(['2026-12', '2027-01']);
    // Неделя, середина месяца, прошлый месяц не до конца — не показываем.
    expect(wholeMonths('2026-11-09', '2026-11-15', '2026-11-15')).toBeNull();
    expect(wholeMonths('2026-10-01', '2026-10-20', '2026-11-15')).toBeNull();
    expect(wholeMonths('2026-11-01', '2026-11-10', '2026-11-15')).toBeNull();
    // Февраль високосного года.
    expect(wholeMonths('2028-02-01', '2028-02-29', '2026-11-15')).toEqual(['2028-02']);
    // Больше 12 месяцев — не считаем.
    expect(wholeMonths('2025-01-01', '2026-10-31', '2026-11-15')).toBeNull();
  });
});

describe('analyticsPeriod', () => {
  const NOW = new Date('2026-11-15T10:00:00Z');
  it('по умолчанию — с 1-го числа по сегодня (Душанбе)', () => {
    expect(analyticsPeriod(undefined, undefined, NOW)).toEqual({ from: '2026-11-01', to: '2026-11-15' });
  });
  it('мусор, перевёрнутый и слишком длинный период — 400', () => {
    expect(() => analyticsPeriod('2026-13-01', '2026-11-15', NOW)).toThrow();
    expect(() => analyticsPeriod('2026-02-30', '2026-03-15', NOW)).toThrow();
    expect(() => analyticsPeriod('2026-11-15', '2026-11-01', NOW)).toThrow();
    expect(() => analyticsPeriod('2020-01-01', '2026-11-01', NOW)).toThrow();
  });
});
