import { ATTENTION_LIMIT, AgendaLead, buildAgenda, lastTouchOf } from './sales-agenda.logic';

// «Сегодня» менеджера (15.11.2026): ленты по дню Душанбе (UTC+5).
// Сейчас — 15.11.2026 15:00 по Душанбе.
const NOW = new Date('2026-11-15T10:00:00Z');
const DAY = 86_400_000;

const lead = (over: Partial<AgendaLead>): AgendaLead => ({
  id: 'L', name: 'Кафе «Сафо»', status: 'waiting', onHold: false,
  nextContactAt: null, meetingResult: null, repeatCallAt: null, nextStepAt: null, nextStep: null,
  contactPhone: '+992 900 00 00 00', dealPotential: null,
  lastActivityAt: new Date(NOW.getTime() - DAY), lastContactAt: null, createdAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const ids = (items: Array<{ id: string }>) => items.map(i => i.id);

describe('buildAgenda — ленты «Просрочено / Сегодня / Завтра»', () => {
  it('прошедшее время — просрочено, даже сегодняшнее утро; будущее — по дню Душанбе', () => {
    const a = buildAgenda([
      lead({ id: 'L1', nextContactAt: new Date('2026-11-15T12:00:00Z') }),          // 17:00 сегодня
      lead({ id: 'L2', nextContactAt: new Date('2026-11-15T05:00:00Z') }),          // 10:00 сегодня, прошло
      lead({ id: 'L3', repeatCallAt: new Date('2026-11-16T04:00:00Z') }),           // 09:00 завтра
      lead({ id: 'L4', nextStepAt: new Date('2026-11-15T18:59:00Z'), nextStep: 'Отправить КП' }), // 23:59 сегодня
      lead({ id: 'L5', nextStepAt: new Date('2026-11-15T19:30:00Z'), nextStep: 'Позвонить ЛПР' }), // 00:30 завтра по Душанбе
    ], NOW);
    expect(ids(a.overdue)).toEqual(['meeting:L2']);
    expect(ids(a.today)).toEqual(['meeting:L1', 'next_step:L4']);
    // 19:30 UTC 15-го — уже 00:30 16-го по Душанбе: завтра, и раньше 09:00.
    expect(ids(a.tomorrow)).toEqual(['next_step:L5', 'callback:L3']);
    expect(a.attention).toEqual([]);
  });

  it('пункт ленты — в форме договора: id, at ISO, заметка шага, телефон, потенциал числом', () => {
    const a = buildAgenda([
      lead({ id: 'L4', status: 'proposal', nextStepAt: new Date('2026-11-15T13:00:00Z'), nextStep: ' Отправить КП ', dealPotential: '15000.00' }),
    ], NOW);
    expect(a.today[0]).toEqual({
      id: 'next_step:L4', kind: 'next_step', at: '2026-11-15T13:00:00.000Z',
      leadId: 'L4', leadName: 'Кафе «Сафо»', status: 'proposal', onHold: false,
      note: 'Отправить КП', phone: '+992 900 00 00 00', potential: 15000,
    });
  });

  it('у одного лида может быть несколько действий — каждое в своей ленте', () => {
    const a = buildAgenda([lead({
      id: 'L1',
      nextContactAt: new Date('2026-11-16T06:00:00Z'),
      repeatCallAt: new Date('2026-11-14T06:00:00Z'),
    })], NOW);
    expect(ids(a.overdue)).toEqual(['callback:L1']);
    expect(ids(a.tomorrow)).toEqual(['meeting:L1']);
  });

  it('встреча с итогом не висит; дальше завтра — не в лентах', () => {
    const a = buildAgenda([
      lead({ id: 'L1', nextContactAt: new Date('2026-11-15T05:00:00Z'), meetingResult: 'held', nextStepAt: new Date('2026-11-20T05:00:00Z') }),
    ], NOW);
    expect(a.overdue).toEqual([]);
    expect(a.today).toEqual([]);
    expect(a.tomorrow).toEqual([]);
    expect(a.attention).toEqual([]);
  });

  it('только активные этапы; «На паузе», выигранные и проигранные пропускаем; устаревшие — как активные', () => {
    const at = new Date('2026-11-15T12:00:00Z');
    const a = buildAgenda([
      lead({ id: 'W', status: 'won', nextContactAt: at }),
      lead({ id: 'X', status: 'lost', repeatCallAt: at }),
      lead({ id: 'H', onHold: true, repeatCallAt: at }),
      lead({ id: 'O', status: 'on_hold', repeatCallAt: at }),
      lead({ id: 'N', status: 'negotiating', repeatCallAt: at }),
      lead({ id: 'U', status: 'unknown', repeatCallAt: at }),
      lead({ id: 'C', status: 'contract', repeatCallAt: at }),
    ], NOW);
    expect(ids(a.today)).toEqual(['callback:N', 'callback:U', 'callback:C']);
    expect(a.attention).toEqual([]);
  });
});

describe('buildAgenda — «Требует внимания»', () => {
  it('без единого действия — no_step; действие дальше завтра и тишина 7+ дней — stale', () => {
    const a = buildAgenda([
      lead({ id: 'A' }),
      lead({ id: 'B', nextStepAt: new Date('2026-11-20T05:00:00Z'), lastActivityAt: new Date(NOW.getTime() - 10 * DAY) }),
      lead({ id: 'C', nextStepAt: new Date('2026-11-20T05:00:00Z'), lastActivityAt: new Date(NOW.getTime() - 2 * DAY) }),
    ], NOW);
    expect(a.attention.map(i => [i.id, i.kind, i.at])).toEqual([
      ['no_step:A', 'no_step', null],
      ['stale:B', 'stale', null],
    ]);
  });

  it('лид с просроченным действием — уже в «Просрочено», второй строкой не дублируем', () => {
    const a = buildAgenda([
      lead({ id: 'A', repeatCallAt: new Date('2026-11-10T05:00:00Z'), lastActivityAt: new Date(NOW.getTime() - 30 * DAY) }),
    ], NOW);
    expect(ids(a.overdue)).toEqual(['callback:A']);
    expect(a.attention).toEqual([]);
  });

  it('каждый вид — не больше 20, самые забытые первыми', () => {
    const many = Array.from({ length: 25 }, (_, i) => lead({
      id: `N${i}`, lastActivityAt: new Date(NOW.getTime() - (i + 1) * DAY),
    }));
    const a = buildAgenda(many, NOW);
    expect(a.attention).toHaveLength(ATTENTION_LIMIT);
    expect(a.attention[0].id).toBe('no_step:N24');
    expect(a.attention.every(i => i.kind === 'no_step')).toBe(true);
  });

  it('последнее касание — максимум из активности, контакта (дата по Душанбе) и создания', () => {
    expect(lastTouchOf(lead({ lastActivityAt: null, lastContactAt: '2026-11-14', createdAt: new Date('2026-01-01T00:00:00Z') })))
      .toBe(new Date('2026-11-14T00:00:00+05:00').getTime());
    expect(lastTouchOf(lead({ lastActivityAt: null, lastContactAt: null, createdAt: null }))).toBeNull();
  });
});
