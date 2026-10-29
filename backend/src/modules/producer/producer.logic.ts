import { createHmac, timingSafeEqual } from 'crypto';

/** Продюсер (29.10.2026): один на команду, отвечает за съёмки и почти не
 *  заходит в CRM. Всё нужное приходит в Telegram — в 18:00 накануне съёмки
 *  на завтра, в субботу в 18:00 съёмки на следующую неделю. Под каждой
 *  съёмкой — ссылка на сценарий: простая страница без входа, живёт, пока
 *  рилс не вышел. Здесь — то, что не зависит от базы: тексты и ссылки. */

export interface ProducerShoot {
  id: string;
  date: string;              // 'YYYY-MM-DD' — день съёмки
  time: string | null;       // 'HH:MM'
  projectName: string;
  title: string | null;      // название рилса
  videographer: string | null;
  /** Чей сценарий открывает ссылка: рилс, под который съёмка (или сама съёмка). */
  scriptItemId: string;
  hasScript: boolean;
  done: boolean;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayMonth = (iso: string) => `${dayOf(iso).getUTCDate()} ${MONTHS_GEN[dayOf(iso).getUTCMonth()]}`;

export function addDays(iso: string, n: number): string {
  const d = dayOf(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** «пятница, 30 октября» */
export const ruLongDay = (iso: string) => `${WEEKDAYS[dayOf(iso).getUTCDay()]}, ${dayMonth(iso)}`;
/** «Пн, 2 ноября» */
export const ruShortDay = (iso: string) => `${WEEKDAYS_SHORT[dayOf(iso).getUTCDay()]}, ${dayMonth(iso)}`;

/** «2–7 ноября», «30 ноября – 5 декабря» */
export function ruRange(from: string, to: string): string {
  const a = dayOf(from), b = dayOf(to);
  if (from === to) return dayMonth(from);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${dayMonth(to)}`;
  return `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** Неделя, о которой пишем в субботу: со следующего понедельника по воскресенье. */
export function nextWeek(todayIso: string): { from: string; to: string } {
  const dow = dayOf(todayIso).getUTCDay();            // 0 — вс … 6 — сб
  const toMonday = ((8 - dow) % 7) || 7;
  const from = addDays(todayIso, toMonday);
  return { from, to: addDays(from, 6) };
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Ссылка на сценарий ────────────────────────────────────────────────
// Хранить ничего не нужно: ссылка — id рилса и подпись к нему. Подобрать
// подпись без секрета сервера нельзя, а «устареть» ссылка может только
// вместе с рилсом (вышел или отменён) — это проверяется при открытии.

const SIG_LEN = 24;

const sign = (hexId: string, secret: string) =>
  createHmac('sha256', `producer-script:${secret}`).update(hexId).digest('hex').slice(0, SIG_LEN);

export function scriptToken(itemId: string, secret: string): string {
  const hexId = itemId.replace(/-/g, '').toLowerCase();
  return `${hexId}${sign(hexId, secret)}`;
}

/** id рилса из ссылки или null, если ссылка чужая или битая. */
export function readScriptToken(token: string, secret: string): string | null {
  if (typeof token !== 'string' || !/^[0-9a-f]+$/i.test(token) || token.length !== 32 + SIG_LEN) return null;
  const hexId = token.slice(0, 32).toLowerCase();
  const got = Buffer.from(token.slice(32).toLowerCase());
  const want = Buffer.from(sign(hexId, secret));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return `${hexId.slice(0, 8)}-${hexId.slice(8, 12)}-${hexId.slice(12, 16)}-${hexId.slice(16, 20)}-${hexId.slice(20)}`;
}

// ── Сообщения ─────────────────────────────────────────────────────────

const byTime = (a: ProducerShoot, b: ProducerShoot) =>
  a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99');

const quoted = (s: ProducerShoot) => (s.title?.trim() ? `«${escapeHtml(s.title.trim())}»` : 'без названия');
const who = (s: ProducerShoot) => (s.videographer ? escapeHtml(s.videographer) : 'видеограф не назначен');

/** Под съёмкой: ссылка на сценарий или честное «сценария пока нет». */
const scriptLine = (s: ProducerShoot, link: (s: ProducerShoot) => string) =>
  s.hasScript ? `<a href="${link(s)}">📄 Сценарий</a>` : 'сценария пока нет';

/** 18:00 накануне: съёмки на завтра. Нет съёмок — null, пустых сообщений не шлём. */
export function dailyMessage(dateIso: string, shoots: ProducerShoot[], appUrl: string, link: (s: ProducerShoot) => string): string | null {
  const list = shoots.filter(s => s.date === dateIso && !s.done).sort(byTime);
  if (!list.length) return null;
  const blocks = list.map(s => [
    `<b>${s.time ? `${s.time} · ` : ''}${escapeHtml(s.projectName)}</b>`,
    quoted(s),
    `снимает ${who(s)}`,
    scriptLine(s, link),
  ].join('\n'));
  return `🎬 <b>Съёмки на завтра — ${list.length}</b>\n${ruLongDay(dateIso)}\n\n${blocks.join('\n\n')}\n\n👉 ${appUrl}/`;
}

/** Суббота, 18:00: съёмки на следующую неделю по дням. */
export function weeklyMessage(from: string, to: string, shoots: ProducerShoot[], appUrl: string, link: (s: ProducerShoot) => string): string | null {
  const list = shoots.filter(s => s.date >= from && s.date <= to && !s.done).sort(byTime);
  if (!list.length) return null;
  // Неделя у нас пн–сб; воскресенье упоминаем, только если в него есть съёмка.
  const last = list.some(s => s.date === to) ? to : addDays(to, -1);
  const days: string[] = [];
  for (const day of [...new Set(list.map(s => s.date))]) {
    const lines = list.filter(s => s.date === day).map(s =>
      `${s.time ? `<b>${s.time}</b> · ` : ''}${escapeHtml(s.projectName)}\n${quoted(s)} · ${who(s)}\n${scriptLine(s, link)}`);
    days.push(`<b>${ruShortDay(day)}</b>\n${lines.join('\n\n')}`);
  }
  return `📅 <b>Съёмки на неделю — ${list.length}</b>\n${ruRange(from, last)}\n\n${days.join('\n\n')}\n\nНакануне каждой съёмки придёт напоминание.\n👉 ${appUrl}/`;
}
