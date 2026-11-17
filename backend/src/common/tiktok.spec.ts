import { TIKTOK_FROM, tiktokLogOf, tiktokNeeded, tiktokOffRanges, tiktokOnAt, toggleTiktokLog } from './tiktok';

describe('нужен ли TikTok публикации', () => {
  it('по умолчанию нужен с дня запуска; у выключенного проекта и раньше — нет', () => {
    expect(TIKTOK_FROM).toBe('2026-11-15');
    expect(tiktokNeeded({}, '2026-11-15')).toBe(true);
    expect(tiktokNeeded({}, '2026-12-01')).toBe(true);
    expect(tiktokNeeded(null, '2026-12-01')).toBe(true);
    expect(tiktokNeeded({}, '2026-11-14')).toBe(false);
    expect(tiktokNeeded({ tiktokOff: true }, '2026-12-01')).toBe(false);
    expect(tiktokNeeded({}, null)).toBe(false);
  });

  it('сторис TikTok не ждут', () => {
    expect(tiktokNeeded({}, '2026-12-01', 'story')).toBe(false);
    expect(tiktokNeeded({}, '2026-12-01', 'reel')).toBe(true);
  });
});

// 17.11.2026: переключение действует с дня изменения (smmData.tiktokLog).
describe('TikTok по дате', () => {
  const META = { by: 's', byName: 'Сабрина', at: '2026-11-17T05:00:00.000Z' };

  it('пустой журнал — как раньше: !tiktokOff на всём периоде с TIKTOK_FROM', () => {
    expect(tiktokOffRanges({})).toEqual([]);
    expect(tiktokOffRanges({ tiktokOff: true })).toEqual([{ from: '2026-11-15', to: null }]);
    expect(tiktokOnAt({ tiktokOff: true }, '2026-11-20')).toBe(false);
    expect(tiktokOnAt({}, '2026-11-20')).toBe(true);
  });

  it('состояние на дату — последняя запись с from <= даты, до первой — включён', () => {
    const sd = {
      tiktokOff: false,
      tiktokLog: [
        { from: '2026-11-20', on: false, by: 's', byName: 'Сабрина', at: 'x' },
        { from: '2026-11-25', on: true, by: 's', byName: 'Сабрина', at: 'y' },
      ],
    };
    expect(tiktokOnAt(sd, '2026-11-19')).toBe(true);
    expect(tiktokOnAt(sd, '2026-11-20')).toBe(false);
    expect(tiktokOnAt(sd, '2026-11-24')).toBe(false);
    expect(tiktokOnAt(sd, '2026-11-25')).toBe(true);
    expect(tiktokNeeded(sd, '2026-11-22')).toBe(false);
    expect(tiktokNeeded(sd, '2026-11-26')).toBe(true);
    expect(tiktokOffRanges(sd)).toEqual([{ from: '2026-11-20', to: '2026-11-25' }]);
  });

  it('мусор в журнале отбрасывается, порядок — по дате, подряд одинаковые сливаются', () => {
    const sd = {
      tiktokLog: [
        { from: '2026-12-01', on: false },
        { from: '2026-11-16', on: false },
        null,
        { from: 'x', on: true },
        { from: '2026-11-18', on: 'yes' },
      ],
    };
    expect(tiktokLogOf(sd).map(e => e.from)).toEqual(['2026-11-16', '2026-12-01']);
    expect(tiktokOffRanges(sd)).toEqual([{ from: '2026-11-16', to: null }]);
  });

  it('выключили сегодня — вчерашние публикации TikTok по-прежнему ждут', () => {
    const log = toggleTiktokLog({}, false, '2026-11-17', META);
    expect(log).toEqual([{ from: '2026-11-17', on: false, by: 's', byName: 'Сабрина', at: META.at }]);
    expect(tiktokOnAt({ tiktokLog: log }, '2026-11-16')).toBe(true);
    expect(tiktokOnAt({ tiktokLog: log }, '2026-11-17')).toBe(false);
  });

  it('переключили обратно в тот же день — запись дня удаляется', () => {
    const first = toggleTiktokLog({}, false, '2026-11-17', META);
    expect(toggleTiktokLog({ tiktokLog: first, tiktokOff: true }, true, '2026-11-17', META)).toEqual([]);
  });

  it('был выключен без журнала — засеиваем с TIKTOK_FROM, прошлое остаётся выключенным', () => {
    const log = toggleTiktokLog({ tiktokOff: true }, true, '2026-11-17', META);
    expect(log).toEqual([
      { from: '2026-11-15', on: false, by: null, byName: null, at: META.at },
      { from: '2026-11-17', on: true, by: 's', byName: 'Сабрина', at: META.at },
    ]);
    expect(tiktokOnAt({ tiktokLog: log }, '2026-11-16')).toBe(false);
    expect(tiktokOnAt({ tiktokLog: log }, '2026-11-17')).toBe(true);
    expect(tiktokOffRanges({ tiktokLog: log })).toEqual([{ from: '2026-11-15', to: '2026-11-17' }]);
  });

  it('то же состояние повторно — журнал не меняется', () => {
    const sd = { tiktokLog: [{ from: '2026-11-20', on: false, by: 's', byName: 'Сабрина', at: 'x' }] };
    expect(toggleTiktokLog(sd, false, '2026-11-22', META)).toEqual([
      { from: '2026-11-20', on: false, by: 's', byName: 'Сабрина', at: 'x' },
    ]);
  });
});
