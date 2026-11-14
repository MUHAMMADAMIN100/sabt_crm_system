import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { ClientLead, ClientLeadStatus } from './client-lead.entity';
import { Task } from '../tasks/task.entity';

/**
 * Встречи и повторные звонки по своим клиентам — для утреннего плана,
 * напоминания «через час» и /today в Telegram (14.11.2026).
 *
 * Форма клиента обещает: «Появится в Календаре на выбранный час и придёт
 * напоминание». Менеджеру продаж задачу под встречу не создаём (см.
 * ClientsService.syncMeetingTask), поэтому читаем лиды напрямую. Встречу,
 * у которой есть задача-двойник (владелец не МП), пропускаем — по ней
 * напомнит сама задача, иначе вышло бы два сообщения. Отказ (lost) не
 * напоминаем.
 */

export type LeadAgendaKind = 'meeting' | 'call';

export interface LeadAgendaItem {
  leadId: string;
  ownerId: string;
  name: string;
  kind: LeadAgendaKind;
  at: Date;
}

const TZ = 'Asia/Dushanbe';

export const LEAD_AGENDA_LABEL: Record<LeadAgendaKind, string> = {
  meeting: 'Встреча',
  call: 'Перезвонить',
};

export const LEAD_AGENDA_ICON: Record<LeadAgendaKind, string> = {
  meeting: '🤝',
  call: '📞',
};

/** Карточка клиента: /clients?id= открывает форму лида (как из Календаря). */
export const leadLink = (leadId: string) => `/clients?id=${leadId}`;

/** «15:00» по Душанбе. */
export const leadTime = (d: Date) =>
  new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

/** «Встреча: Кафе «Сафо» — 15:00» — без HTML. */
export const leadAgendaText = (it: LeadAgendaItem) =>
  `${LEAD_AGENDA_LABEL[it.kind]}: ${it.name} — ${leadTime(it.at)}`;

const inWindow = (d: Date | null | undefined, from: Date, to: Date) => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= from.getTime() && t <= to.getTime();
};

type LeadRow = Pick<ClientLead, 'id' | 'name' | 'ownerId' | 'status' | 'nextContactAt' | 'repeatCallAt' | 'meetingTaskId'>;

/** Чистая часть: из лидов — пункты окна [from, to]. liveTaskIds — задачи-
 *  двойники встреч, которые ещё есть в базе. */
export function leadAgendaItems(leads: LeadRow[], liveTaskIds: Set<string>, from: Date, to: Date): LeadAgendaItem[] {
  const out: LeadAgendaItem[] = [];
  for (const l of leads) {
    if (!l.ownerId || l.status === ClientLeadStatus.LOST) continue;
    const name = String(l.name || '').trim() || 'Клиент';
    if (inWindow(l.nextContactAt, from, to) && !(l.meetingTaskId && liveTaskIds.has(l.meetingTaskId))) {
      out.push({ leadId: l.id, ownerId: l.ownerId, name, kind: 'meeting', at: new Date(l.nextContactAt) });
    }
    if (inWindow(l.repeatCallAt, from, to)) {
      out.push({ leadId: l.id, ownerId: l.ownerId, name, kind: 'call', at: new Date(l.repeatCallAt as Date) });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Встречи и звонки по лидам в окне; ownerId — только свои. */
export async function fetchLeadAgenda(
  leadRepo: Repository<ClientLead>,
  taskRepo: Repository<Task>,
  from: Date,
  to: Date,
  ownerId?: string,
): Promise<LeadAgendaItem[]> {
  const base: Record<string, any> = {
    status: Not(ClientLeadStatus.LOST),
    ownerId: ownerId || Not(IsNull()),
  };
  const leads = await leadRepo.find({
    where: [
      { ...base, nextContactAt: Between(from, to) },
      { ...base, repeatCallAt: Between(from, to) },
    ] as any,
    select: ['id', 'name', 'ownerId', 'status', 'nextContactAt', 'repeatCallAt', 'meetingTaskId'],
  });
  if (!leads || leads.length === 0) return [];

  const twinIds = leads.map(l => l.meetingTaskId).filter((id): id is string => !!id);
  const live = twinIds.length
    ? await taskRepo.find({ where: { id: In(twinIds) } as any, select: ['id'] })
    : [];
  return leadAgendaItems(leads, new Set(live.map(t => t.id)), from, to);
}
