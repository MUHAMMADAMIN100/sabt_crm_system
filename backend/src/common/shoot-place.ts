/**
 * Где снимаем (09.11.2026). Половина и больше съёмок — в нашей студии, ещё
 * часть — рядом и у клиента, поэтому место выбирают одной кнопкой из трёх:
 *   - «Студия» — по умолчанию, в базе пусто (shootPlace = null);
 *   - «У клиента» — адрес с вкладки «Клиент» проекта (shootPlace = '@client');
 *   - «Другое» — место вписывают текстом (shootPlace = текст).
 * До 09.11.2026 пустое место значило «по адресу проекта», но адрес не был
 * заполнен ни у одного проекта, так что старые съёмки смысл не меняют.
 */
export const CLIENT_PLACE = '@client';
export const STUDIO_LABEL = 'Студия';
export const CLIENT_LABEL = 'У клиента';

export type ShootPlaceKind = 'studio' | 'client' | 'other';

export function shootPlaceKind(place: string | null | undefined): ShootPlaceKind {
  const v = typeof place === 'string' ? place.trim() : '';
  if (!v) return 'studio';
  return v === CLIENT_PLACE ? 'client' : 'other';
}

/** Подпись места для календаря: студия — без подписи (так почти всегда),
 *  у клиента — «У клиента», другое — сам текст. */
export function shootPlaceLabel(place: string | null | undefined): string | null {
  const kind = shootPlaceKind(place);
  if (kind === 'studio') return null;
  return kind === 'client' ? CLIENT_LABEL : String(place).trim();
}
