import { matchesDue, nextActionAt, parseLeadListQuery, parseStatusList } from './lead-list';

// /clients/list (15.11.2026): «ближайшее действие» и чипы «Просрочено /
// Сегодня / Без шага». Время — по Душанбе (UTC+5), сервер в UTC.

const NOW = new Date('2026-11-14T10:00:00Z'); // 15:00 по Душанбе
const base = { status: 'waiting', onHold: false, nextContactAt: null, meetingResult: null, repeatCallAt: null, nextStepAt: null };

describe('nextActionAt — ближайшее из встречи без итога, перезвона, шага', () => {
  it('минимум из трёх', () => {
    expect(nextActionAt({
      ...base,
      nextContactAt: '2026-11-20T09:00:00Z', repeatCallAt: '2026-11-18T09:00:00Z', nextStepAt: '2026-11-19T09:00:00Z',
    })?.toISOString()).toBe('2026-11-18T09:00:00.000Z');
  });

  it('встреча с итогом («состоялась») — не действие; ничего нет — null', () => {
    expect(nextActionAt({ ...base, nextContactAt: '2026-11-10T09:00:00Z', meetingResult: 'held', nextStepAt: '2026-11-21T09:00:00Z' })
      ?.toISOString()).toBe('2026-11-21T09:00:00.000Z');
    expect(nextActionAt({ ...base, nextContactAt: '2026-11-10T09:00:00Z', meetingResult: 'missed' })).toBeNull();
    expect(nextActionAt(base)).toBeNull();
  });
});

describe('matchesDue — чипы списка', () => {
  it('overdue: ближайшее действие в прошлом', () => {
    const l = { ...base, repeatCallAt: '2026-11-14T09:00:00Z', nextStepAt: '2026-11-20T09:00:00Z' };
    expect(matchesDue(l, 'overdue', NOW)).toBe(true);
    expect(matchesDue(l, 'today', NOW)).toBe(false);
    // Есть шаг в будущем — не «без шага».
    expect(matchesDue(l, 'none', NOW)).toBe(false);
  });

  it('today: ещё не наступило, но сегодня по Душанбе', () => {
    expect(matchesDue({ ...base, nextContactAt: '2026-11-14T13:00:00Z' }, 'today', NOW)).toBe(true); // 18:00
    // 23:59 по Душанбе — ещё сегодня; 00:30 следующего дня (19:30 UTC сегодня) — уже нет.
    expect(matchesDue({ ...base, nextStepAt: '2026-11-14T18:59:00Z' }, 'today', NOW)).toBe(true);
    expect(matchesDue({ ...base, nextStepAt: '2026-11-14T19:30:00Z' }, 'today', NOW)).toBe(false);
  });

  it('none: ни одного действия в будущем (пусто или всё прошло)', () => {
    expect(matchesDue(base, 'none', NOW)).toBe(true);
    expect(matchesDue({ ...base, repeatCallAt: '2026-11-13T09:00:00Z' }, 'none', NOW)).toBe(true);
    // Будущая встреча, по которой уже стоит итог, — не действие.
    expect(matchesDue({ ...base, nextContactAt: '2026-11-20T09:00:00Z', meetingResult: 'held' }, 'none', NOW)).toBe(true);
    expect(matchesDue({ ...base, nextContactAt: '2026-11-20T09:00:00Z' }, 'none', NOW)).toBe(false);
  });

  it('выиграно / проиграно / на паузе — ни в один чип', () => {
    const past = { repeatCallAt: '2026-11-13T09:00:00Z' };
    for (const l of [{ ...base, ...past, status: 'won' }, { ...base, ...past, status: 'lost' }, { ...base, ...past, onHold: true }]) {
      expect(matchesDue(l, 'overdue', NOW)).toBe(false);
      expect(matchesDue(l, 'none', NOW)).toBe(false);
    }
    // Устаревший статус — как «Контакт», активный.
    expect(matchesDue({ ...base, ...past, status: 'negotiating' }, 'overdue', NOW)).toBe(true);
  });
});

describe('parseLeadListQuery — параметры /clients/list', () => {
  const mp = { id: 'MP', isSales: true };
  const boss = { id: 'B', isSales: false };

  it('по умолчанию: МП — свои, руководство — все; страница 1 по 20, сортировка next', () => {
    expect(parseLeadListQuery({}, mp)).toMatchObject({ owner: 'MP', page: 1, pageSize: 20, sort: 'next', due: null, hold: null });
    expect(parseLeadListQuery({}, boss).owner).toBe('all');
  });

  it('owner: me / all / none / uuid; мусор — как по умолчанию', () => {
    const id = '0a0a0a0a-0000-4000-8000-000000000001';
    expect(parseLeadListQuery({ owner: 'me' }, boss).owner).toBe('B');
    expect(parseLeadListQuery({ owner: 'all' }, mp).owner).toBe('all');
    expect(parseLeadListQuery({ owner: 'none' }, mp).owner).toBe('none');
    expect(parseLeadListQuery({ owner: id }, mp).owner).toBe(id);
    expect(parseLeadListQuery({ owner: "x' OR 1=1" }, mp).owner).toBe('MP');
  });

  it('pageSize 10..100, page ≥ 1, неизвестные due/sort — мимо', () => {
    expect(parseLeadListQuery({ pageSize: '5', page: '0' }, mp)).toMatchObject({ pageSize: 10, page: 1 });
    expect(parseLeadListQuery({ pageSize: 500, page: 3 }, mp)).toMatchObject({ pageSize: 100, page: 3 });
    expect(parseLeadListQuery({ due: 'later', sort: 'name' }, mp)).toMatchObject({ due: null, sort: 'next' });
    expect(parseLeadListQuery({ due: 'today', sort: 'potential', hold: '1' }, mp)).toMatchObject({ due: 'today', sort: 'potential', hold: true });
    expect(parseLeadListQuery({ hold: '0' }, mp).hold).toBe(false);
  });

  it('status через запятую; устаревшие входят в этап, которым их показываем', () => {
    expect(parseStatusList('waiting,new,bogus')).toEqual(['waiting', 'negotiating', 'on_hold', 'new', 'unknown']);
    expect(parseStatusList('meeting')).toEqual(['meeting']);
    expect(parseStatusList('')).toEqual([]);
  });
});
