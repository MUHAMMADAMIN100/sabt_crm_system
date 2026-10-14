/** Клиент проекта разработки — чистая логика без базы.
 *
 *  До разделения СММ и разработки (решение владельца 14.10.2026) проекты
 *  разработки открывались страницей SMM-проекта и вели анкету SMM-клиента
 *  в smmData: владелец бизнеса, предпочтения, значимый день, начало
 *  сотрудничества. У разработки клиент — это контакты в clientInfo.
 *  Переносим то, что уже записали, чтобы ничего не потерялось:
 *  «Владелец бизнеса» → «Контактное лицо», остальное — в «Заметки». */

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 'YYYY-MM-DD…' → 'DD.MM.YYYY'; всё остальное — как есть. */
const ruDate = (v: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
};

/** Отметка в smmData: анкета уже перенесена. Без неё перенос повторялся
 *  бы при каждом запуске сервера и возвращал стёртые вручную заметки. */
export const CLIENT_MOVED_FLAG = 'clientMovedToInfo';

/** Контакты клиента после переноса или null, если переносить нечего.
 *  Уже заполненные контакты не перезаписывает, чужие поля сохраняет. */
export function devClientFromSmm(
  smmData: Record<string, any> | null | undefined,
  clientInfo: Record<string, any> | null | undefined,
): Record<string, any> | null {
  const sd = smmData || {};
  const next: Record<string, any> = { ...(clientInfo || {}) };
  let changed = false;

  const owner = text(sd.ownerName);
  if (owner && !text(next.contactPerson)) {
    next.contactPerson = owner;
    changed = true;
  }

  const lines: string[] = [];
  const prefs = text(sd.preferences);
  if (prefs) lines.push(prefs);
  const keyDate = text(sd.keyDate);
  if (keyDate) {
    const note = text(sd.keyDateNote);
    lines.push(`Значимый день: ${ruDate(keyDate)}${note ? ` — ${note}` : ''}`);
  }
  const since = text(sd.collabSince);
  if (since) lines.push(`Сотрудничаем с ${ruDate(since)}`);
  if (lines.length && !text(next.notes)) {
    next.notes = lines.join('\n');
    changed = true;
  }

  return changed ? next : null;
}
