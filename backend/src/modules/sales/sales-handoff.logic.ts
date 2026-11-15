import { leadLink } from '../clients/lead-agenda';
import type { HandoffDto } from './dto/sales.dto';

/**
 * «Передать в работу» (15.11.2026, SALES_SPEC §5): что хранится в
 * client_leads.handoffData, текст задачи руководителю и строка списка
 * «Заявки от продаж». Чистые функции.
 */

export interface HandoffData {
  direction: 'smm' | 'development';
  product: string;
  amount: number;
  firstPaymentAt: string;
  note: string | null;
  sendBrief: boolean;
  /** Задача «Создать проект» — дописывается после создания. */
  taskId?: string;
}

export interface HandoffView {
  leadId: string;
  leadName: string;
  direction: string | null;
  product: string;
  amount: number;
  firstPaymentAt: string | null;
  note: string | null;
  sendBrief: boolean;
  handoffAt: string | null;
  manager: { id: string; name: string } | null;
  projectId: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactInstagram: string | null;
}

const DIRECTION_LABEL: Record<string, string> = { smm: 'SMM', development: 'Разработка' };

export function handoffDataOf(dto: HandoffDto): HandoffData {
  const note = typeof dto.note === 'string' ? dto.note.trim() : '';
  return {
    direction: dto.direction,
    product: String(dto.product || '').trim(),
    amount: Math.round(Number(dto.amount) * 100) / 100,
    firstPaymentAt: dto.firstPaymentAt,
    note: note || null,
    sendBrief: !!dto.sendBrief,
  };
}

/** «12 000 с.» */
export function fmtSomoni(n: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n) || 0)} с.`;
}

/** «20 ноября 2026» — дата YYYY-MM-DD как есть, без сдвига поясом. */
export function fmtDayRu(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function directionLabel(direction?: string | null): string {
  return DIRECTION_LABEL[String(direction)] || String(direction || '—');
}

type LeadForText = {
  id: string; name: string; sphere?: string | null; contactPerson?: string | null;
  contactPhone?: string | null; contactInstagram?: string | null; contactEmail?: string | null;
};

/** Описание задачи «Создать проект: …» — всё, что нужно руководителю,
 *  чтобы завести проект, не открывая карточку лида. */
export function handoffTaskDescription(lead: LeadForText, data: HandoffData, managerName: string): string {
  const lines = [
    `Клиента передал в работу: ${managerName || 'менеджер продаж'}.`,
    `Направление: ${directionLabel(data.direction)}`,
    `Продукт: ${data.product}`,
    `Сумма: ${fmtSomoni(data.amount)}`,
    `Первая оплата: ${fmtDayRu(data.firstPaymentAt)}`,
    `Бриф клиенту: ${data.sendBrief ? 'отправить' : 'не нужен'}`,
  ];
  if (data.note) lines.push(`Комментарий: ${data.note}`);
  if (lead.sphere) lines.push(`Сфера: ${lead.sphere}`);
  if (lead.contactPerson) lines.push(`ЛПР: ${lead.contactPerson}`);
  if (lead.contactPhone) lines.push(`Телефон: ${lead.contactPhone}`);
  if (lead.contactInstagram) lines.push(`Instagram: ${lead.contactInstagram}`);
  if (lead.contactEmail) lines.push(`Email: ${lead.contactEmail}`);
  lines.push(`Карточка клиента: ${leadLink(lead.id)}`);
  return lines.join('\n');
}

/** Строка из SQL списка передач → ответ API. */
export function handoffViewOf(row: Record<string, any>): HandoffView {
  const data = row?.handoffData && typeof row.handoffData === 'object' ? row.handoffData : {};
  const at = row?.handoffAt ? new Date(row.handoffAt) : null;
  const amount = Number(data.amount);
  return {
    leadId: row.id,
    leadName: row.name,
    direction: data.direction ?? row.direction ?? null,
    product: typeof data.product === 'string' ? data.product : '',
    amount: Number.isFinite(amount) ? amount : 0,
    firstPaymentAt: typeof data.firstPaymentAt === 'string' ? data.firstPaymentAt : null,
    note: typeof data.note === 'string' && data.note ? data.note : null,
    sendBrief: !!data.sendBrief,
    handoffAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null,
    manager: row.managerId ? { id: String(row.managerId), name: row.managerName || '' } : null,
    projectId: row.projectId || null,
    contactPerson: row.contactPerson || null,
    contactPhone: row.contactPhone || null,
    contactInstagram: row.contactInstagram || null,
  };
}

/** Проект в момент связи с лидом — поля, где хранится ответственный МП. */
export interface LinkProjectRow {
  projectType?: string | null;
  /** Колонка projects.salesManagerId (её же ставит создание проекта МП). */
  salesManagerId?: string | null;
  smmData?: Record<string, any> | null;
}

/**
 * Ответственный менеджер проекта при связи с лидом (15.11.2026, просьба
 * фронта «Заявки от продаж»): проект без менеджера получает того, кто продал.
 * Иначе по правилу «Деньги только своих» МП не увидел бы оплат собственного
 * клиента. У SMM ответственный живёт в smmData.salesManagerId (его читают
 * «Свои клиенты» SmmPaymentsService) — пишем туда же и историю назначений,
 * как PATCH /projects/:id/smm-manager; колонку salesManagerId — у любого
 * типа, как при создании проекта менеджером. Уже назначенного не трогаем.
 */
export function salesManagerPatch(
  project: LinkProjectRow,
  managerId: string | null,
  todayIso: string,
  withChange: (raw: unknown, prev: string | null, next: string | null, day: string) => unknown[],
): { column: boolean; smm: { salesManagerId: string; salesManagerHistory: unknown[] } | null } {
  if (!managerId) return { column: false, smm: null };
  const column = !project.salesManagerId;
  let smm: { salesManagerId: string; salesManagerHistory: unknown[] } | null = null;
  if (project.projectType === 'SMM') {
    const sd: Record<string, any> = project.smmData && typeof project.smmData === 'object' ? project.smmData : {};
    const current = typeof sd.salesManagerId === 'string' && sd.salesManagerId ? sd.salesManagerId : null;
    if (!current) {
      smm = { salesManagerId: managerId, salesManagerHistory: withChange(sd.salesManagerHistory, null, managerId, todayIso) };
    }
  }
  return { column, smm };
}
