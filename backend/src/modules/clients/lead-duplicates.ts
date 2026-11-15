/**
 * Дубли лидов при создании (15.11.2026, SALES_SPEC §4).
 *
 * Два менеджера заводили одну и ту же кофейню: один — по звонку, другой —
 * из Директа, и клиенту звонили дважды. Теперь при создании ищем похожий
 * лид в том же направлении: телефон (последние 9 цифр — с +992 и без),
 * Instagram (без «@» и «instagram.com/», без регистра), название (без
 * регистра и пробелов по краям). Нашли — 409, создать можно только явно
 * (force: true).
 *
 * SQL в ClientsService.findDuplicates отбирает кандидатов грубо (с
 * запасом), точное сравнение — здесь.
 */

/** Последние 9 цифр телефона; короче 9 цифр — не сравниваем (null). */
export function phoneKey(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D+/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

/** Instagram: «@Cafe.Safo», «https://www.instagram.com/cafe.safo/?hl=ru» → «cafe.safo». */
export function instagramKey(v: unknown): string | null {
  let s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^instagram\.com\//, '').replace(/^@/, '');
  s = s.replace(/[/?#].*$/, '').trim();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}

/** Название без регистра и пробелов по краям (внутренние пробелы — один). */
export function nameKey(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return s || null;
}

export interface DuplicateProbe {
  name?: string | null;
  contactPhone?: string | null;
  contactInstagram?: string | null;
}

export interface DuplicateCandidate {
  name?: string | null;
  contactPhone?: string | null;
  contactInstagram?: string | null;
  /** Старое поле «контакты одной строкой»: телефоны и инста построчно. */
  contactInfo?: string | null;
}

export interface DuplicateKeys {
  name: string | null;
  phone: string | null;
  instagram: string | null;
}

export function duplicateKeys(p: DuplicateProbe): DuplicateKeys {
  return { name: nameKey(p.name), phone: phoneKey(p.contactPhone), instagram: instagramKey(p.contactInstagram) };
}

/** Похож ли существующий лид на новый — хотя бы по одному признаку. */
export function isDuplicate(keys: DuplicateKeys, c: DuplicateCandidate): boolean {
  if (keys.name && nameKey(c.name) === keys.name) return true;
  // Старое поле contactInfo: «+992 900 11 22 33\n@cafe» — построчно и по словам.
  const infoLines = String(c.contactInfo ?? '').split(/[\n,;]+/);
  if (keys.phone) {
    if (phoneKey(c.contactPhone) === keys.phone) return true;
    if (infoLines.some(line => phoneKey(line) === keys.phone)) return true;
  }
  if (keys.instagram) {
    if (instagramKey(c.contactInstagram) === keys.instagram) return true;
    // В старом поле — только то, что похоже на инсту («@…» или ссылка):
    // простое слово «cafe» в описании дублем не считаем.
    const words = infoLines.flatMap(line => line.split(/\s+/))
      .filter(w => w.startsWith('@') || /instagram\.com\//i.test(w));
    if (words.some(w => instagramKey(w) === keys.instagram)) return true;
  }
  return false;
}
