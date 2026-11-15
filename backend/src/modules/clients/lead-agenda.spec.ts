import { ClientLeadStatus } from './client-lead.entity';
import { fetchLeadAgenda, leadAgendaItems, leadAgendaText, leadLink } from './lead-agenda';

// Сутки 14.11.2026 по Душанбе (UTC+5) в UTC.
const FROM = new Date('2026-11-13T19:00:00Z');
const TO = new Date('2026-11-14T18:59:59.999Z');

const lead = (over: Record<string, any>) => ({
  id: 'L1', name: 'Кафе «Сафо»', ownerId: 'U1', status: ClientLeadStatus.WAITING,
  nextContactAt: null, repeatCallAt: null, meetingTaskId: null, onHold: false, meetingResult: null, ...over,
}) as any;

describe('lead-agenda: встречи и звонки по лидам', () => {
  it('встреча и повторный звонок в окне — по времени, с текстом для человека', () => {
    const items = leadAgendaItems([
      lead({ id: 'L2', name: 'Школа «Ilm»', repeatCallAt: new Date('2026-11-14T10:30:00Z') }),
      lead({ nextContactAt: new Date('2026-11-14T10:00:00Z') }),
    ], new Set(), FROM, TO);
    expect(items.map(i => [i.leadId, i.kind])).toEqual([['L1', 'meeting'], ['L2', 'call']]);
    expect(leadAgendaText(items[0])).toBe('Встреча: Кафе «Сафо» — 15:00');
    expect(leadAgendaText(items[1])).toBe('Перезвонить: Школа «Ilm» — 15:30');
    expect(leadLink('L1')).toBe('/clients?id=L1');
  });

  it('отказ (lost), без владельца и вне окна — не напоминаем', () => {
    const items = leadAgendaItems([
      lead({ status: ClientLeadStatus.LOST, nextContactAt: new Date('2026-11-14T10:00:00Z') }),
      lead({ ownerId: null, nextContactAt: new Date('2026-11-14T10:00:00Z') }),
      lead({ nextContactAt: new Date('2026-11-15T05:00:00Z') }),
    ], new Set(), FROM, TO);
    expect(items).toEqual([]);
  });

  // 15.11.2026: выигранные, «на паузе» и встречи с отмеченным итогом — тоже нет.
  it('выигран, на паузе, встреча уже с итогом — не напоминаем (звонок по лиду с итогом встречи — да)', () => {
    const at = new Date('2026-11-14T10:00:00Z');
    const items = leadAgendaItems([
      lead({ id: 'W', status: ClientLeadStatus.WON, nextContactAt: at }),
      lead({ id: 'H', onHold: true, nextContactAt: at, repeatCallAt: at }),
      lead({ id: 'R', meetingResult: 'held', nextContactAt: at, repeatCallAt: new Date('2026-11-14T11:00:00Z') }),
    ], new Set(), FROM, TO);
    expect(items.map(i => [i.leadId, i.kind])).toEqual([['R', 'call']]);
  });

  it('встреча с живой задачей-двойником — напомнит задача, звонок остаётся', () => {
    const l = lead({ meetingTaskId: 'T1', nextContactAt: new Date('2026-11-14T10:00:00Z'), repeatCallAt: new Date('2026-11-14T12:00:00Z') });
    expect(leadAgendaItems([l], new Set(['T1']), FROM, TO).map(i => i.kind)).toEqual(['call']);
    // Задачу удалили, а id в лиде остался — встреча снова наша.
    expect(leadAgendaItems([l], new Set(), FROM, TO).map(i => i.kind)).toEqual(['meeting', 'call']);
  });

  it('fetchLeadAgenda: свои лиды, без won/lost и паузы; встречи без итога; живые двойники — из задач', async () => {
    const leadRepo = { find: jest.fn().mockResolvedValue([
      lead({ meetingTaskId: 'T1', nextContactAt: new Date('2026-11-14T10:00:00Z') }),
      lead({ id: 'L2', meetingTaskId: 'T2', nextContactAt: new Date('2026-11-14T11:00:00Z') }),
    ]) };
    const taskRepo = { find: jest.fn().mockResolvedValue([{ id: 'T1' }]) };
    const items = await fetchLeadAgenda(leadRepo as any, taskRepo as any, FROM, TO, 'U1');
    expect(items.map(i => i.leadId)).toEqual(['L2']);
    const where = leadRepo.find.mock.calls[0][0].where;
    expect(where).toHaveLength(2);
    for (const w of where) {
      expect(w.ownerId).toBe('U1');
      expect(w.onHold).toBe(false);
      expect(String(w.status.type)).toBe('not');
      const closed = w.status.child?.value ?? w.status.value;
      expect(closed).toEqual([ClientLeadStatus.WON, ClientLeadStatus.LOST]);
    }
    // Встреча — только без итога; перезвон от итога встречи не зависит.
    expect(String(where[0].meetingResult?.type)).toBe('isNull');
    expect(where[1].meetingResult).toBeUndefined();
  });
});
