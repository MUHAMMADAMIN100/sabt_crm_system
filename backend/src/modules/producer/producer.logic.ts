import { createHmac, timingSafeEqual } from 'crypto';

/** Продюсер (29.10.2026): один на команду, отвечает за съёмки и почти не
 *  заходит в CRM. Всё нужное приходит в Telegram — в 18:00 накануне съёмки
 *  на завтра, в субботу в 18:00 съёмки на следующую неделю. Под каждой
 *  съёмкой — ссылка на сценарий: простая страница без входа, живёт, пока
 *  рилс не вышел. Видеограф получает то же самое, но только свои съёмки.
 *  Здесь — то, что не зависит от базы: тексты и ссылки. */

export interface ProducerShoot {
  id: string;
  date: string;              // 'YYYY-MM-DD' — день съёмки
  time: string | null;       // 'HH:MM'
  projectName: string;
  title: string | null;      // название рилса
  videographer: string | null;
  /** Кто снимает — ему уходят «Ваши съёмки». */
  assigneeId?: string | null;
  /** Чей сценарий открывает ссылка: рилс, под который съёмка (или сама съёмка). */
  scriptItemId: string;
  hasScript: boolean;
  done: boolean;
  /** Где снимать (07.11.2026): «Другое место» съёмки или адрес проекта. */
  address?: string | null;
  /** true — адрес взят из «Другого места» съёмки, а не из проекта. */
  otherPlace?: boolean;
  /** Ссылка на карту из карточки проекта. */
  mapUrl?: string | null;
  /** Кто встретит на месте: «Фирдавс, +992 90 555 12 12». */
  contact?: string | null;
  /** СММ-специалисты проекта — у них уточнять детали. */
  smm?: string | null;
  projectId?: string;
  /** id СММ-специалистов проекта: им — напоминание указать время. */
  smmIds?: string[];
  /** Где снимаем (09.11.2026): студия, у клиента или другое место. */
  placeKind?: 'studio' | 'client' | 'other';
  /** Монтаж этого рилса уже готов — значит, снят он раньше сегодняшнего дня. */
  edited?: boolean;
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
const attr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/** Ссылка на карту: из карточки проекта, а для «Другого места» и проекта
 *  без ссылки — поиск адреса в Google Картах. */
export function mapLink(s: Pick<ProducerShoot, 'address' | 'otherPlace' | 'mapUrl'>): string | null {
  const addr = s.address?.trim();
  if (!s.otherPlace && s.mapUrl?.trim()) return s.mapUrl.trim();
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}

/** Телефон из строки контакта — для кнопки «Позвонить». */
export function phoneOf(contact: string | null | undefined): string | null {
  const m = /\+?\d[\d\s()-]{5,}\d/.exec(contact || '');
  if (!m) return null;
  const digits = m[0].replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? digits : null;
}

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

/** own — сообщение видеографу о его съёмках: «Ваши съёмки», без «снимает …». */
export interface MessageOpts { own?: boolean }

const byTime = (a: ProducerShoot, b: ProducerShoot) =>
  a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99');

const quoted = (s: ProducerShoot) => (s.title?.trim() ? `«${escapeHtml(s.title.trim())}»` : 'без названия');
const who = (s: ProducerShoot) => (s.videographer ? escapeHtml(s.videographer) : 'видеограф не назначен');

/** «📍 ул. Айни, 61 · карта» или null, если адреса нет. Студия — без
 *  карты: дорогу туда знают; у клиента без адреса — так и пишем. */
const placeLine = (s: ProducerShoot) => {
  if (s.placeKind === 'studio') return '📍 Студия';
  const addr = s.address?.trim();
  if (!addr) return s.placeKind === 'client' ? '📍 У клиента — адрес не указан' : null;
  const map = mapLink(s);
  return `📍 ${escapeHtml(addr)}${map ? ` · <a href="${attr(map)}">карта</a>` : ''}`;
};

/** Под съёмкой — ссылка на страницу съёмки: там проект, адрес и сценарий.
 *  Без сценария ссылка всё равно нужна — ради адреса и контактов. */
const scriptLine = (s: ProducerShoot, link: (s: ProducerShoot) => string) =>
  s.hasScript
    ? `<a href="${attr(link(s))}">📄 Сценарий и всё о съёмке</a>`
    : `<a href="${attr(link(s))}">📄 Всё о съёмке</a> · сценария пока нет`;

/** Что сказать о съёмке, кроме ссылки: время, место, кто встретит, СММ.
 *  Время и место с 09.11.2026 ставит продюсер — у него и уточнять. */
function shootDetails(s: ProducerShoot, opts: MessageOpts): string[] {
  const smm = s.smm?.trim() ? escapeHtml(s.smm.trim()) : null;
  return [
    s.time ? null : (opts.own ? '🕑 время не указано — уточните у продюсера' : '🕑 время не указано'),
    placeLine(s),
    s.contact?.trim() ? `👤 На месте: ${escapeHtml(s.contact.trim())}` : null,
    smm ? `💬 СММ: ${smm}` : null,
    opts.own ? null : `снимает ${who(s)}`,
  ].filter((x): x is string => !!x);
}

/** Блок одной съёмки в сообщении «на завтра» и в «время изменилось». */
function shootBlock(s: ProducerShoot, link: (s: ProducerShoot) => string, opts: MessageOpts): string[] {
  return [...shootDetails(s, opts), scriptLine(s, link)];
}

function plural(n: number, one: string, few: string, many: string) {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few;
  return many;
}
const reels = (n: number) => `${n} ${plural(n, 'рилс', 'рилса', 'рилсов')}`;

/** Съёмки одного проекта в один день, в одно время, в одном месте и у
 *  одного видеографа — один выезд (09.11.2026): в сообщении это один блок
 *  «Chrono — 4 рилса», а не четыре одинаковых. Порядок — как во входе. */
export function groupShoots(list: ProducerShoot[]): ProducerShoot[][] {
  const groups = new Map<string, ProducerShoot[]>();
  for (const s of list) {
    const key = [s.date, s.projectId || s.projectName, s.time || '', s.placeKind || '', (s.address || '').trim(), s.assigneeId || ''].join('|');
    const g = groups.get(key);
    if (g) g.push(s); else groups.set(key, [s]);
  }
  return [...groups.values()];
}

/** Ссылки на страницы съёмки — по одной на рилс выезда. */
function groupLinks(g: ProducerShoot[], link: (s: ProducerShoot) => string): string {
  const withScript = g.filter(x => x.hasScript).length;
  const note = withScript === g.length ? '' : withScript === 0 ? ' · сценариев пока нет' : ` · без сценария: ${g.length - withScript}`;
  return `📄 ${g.map(x => `<a href="${attr(link(x))}">${quoted(x)}</a>`).join(' · ')}${note}`;
}

/** 18:00 накануне: съёмки на завтра. Нет съёмок — null, пустых сообщений не шлём. */
export function dailyMessage(
  dateIso: string, shoots: ProducerShoot[], appUrl: string, link: (s: ProducerShoot) => string, opts: MessageOpts = {},
): string | null {
  const list = shoots.filter(s => s.date === dateIso && !s.done).sort(byTime);
  if (!list.length) return null;
  const groups = groupShoots(list);
  const blocks = groups.map(g => {
    const s = g[0];
    const at = s.time ? `${s.time} · ` : 'Время не указано · ';
    if (g.length === 1) return [`<b>${at}${escapeHtml(s.projectName)}</b>`, quoted(s), ...shootBlock(s, link, opts)].join('\n');
    return [`<b>${at}${escapeHtml(s.projectName)} — ${reels(g.length)}</b>`, groupLinks(g, link), ...shootDetails(s, opts)].join('\n');
  });
  const head = opts.own ? 'Ваши съёмки на завтра' : 'Съёмки на завтра';
  return `🎬 <b>${head} — ${groups.length}</b>\n${ruLongDay(dateIso)}\n\n${blocks.join('\n\n')}\n\n👉 ${appUrl}/`;
}

/** Суббота, 18:00: съёмки на следующую неделю по дням. Время здесь
 *  необязательно — его ставят накануне, оно придёт в 18:00 вместе с адресом. */
export function weeklyMessage(
  from: string, to: string, shoots: ProducerShoot[], appUrl: string, link: (s: ProducerShoot) => string, opts: MessageOpts = {},
): string | null {
  const list = shoots.filter(s => s.date >= from && s.date <= to && !s.done).sort(byTime);
  if (!list.length) return null;
  // Неделя у нас пн–сб; воскресенье упоминаем, только если в него есть съёмка.
  const last = list.some(s => s.date === to) ? to : addDays(to, -1);
  const days: string[] = [];
  let total = 0;
  for (const day of [...new Set(list.map(s => s.date))]) {
    const groups = groupShoots(list.filter(s => s.date === day));
    total += groups.length;
    const lines = groups.map(g => {
      const s = g[0];
      const head = `${s.time ? `<b>${s.time}</b> · ` : ''}${escapeHtml(s.projectName)}`;
      if (g.length === 1) {
        return [head, `${quoted(s)}${opts.own ? '' : ` · ${who(s)}`}`, placeLine(s), scriptLine(s, link)].filter(Boolean).join('\n');
      }
      return [`${head} — ${reels(g.length)}${opts.own ? '' : ` · ${who(s)}`}`, placeLine(s), groupLinks(g, link)].filter(Boolean).join('\n');
    });
    days.push(`<b>${ruShortDay(day)}</b>\n${lines.join('\n\n')}`);
  }
  const head = opts.own ? 'Ваши съёмки на неделю' : 'Съёмки на неделю';
  return `📅 <b>${head} — ${total}</b>\n${ruRange(from, last)}\n\n${days.join('\n\n')}\n\nНакануне в 18:00 придёт напоминание со временем и адресом.\n👉 ${appUrl}/`;
}

/** Накануне в 12:00 — СММ-специалисту: у завтрашних съёмок нет времени. */
export function missingTimeMessage(dateIso: string, shoots: ProducerShoot[], appUrl: string): string | null {
  const list = shoots.filter(s => s.date === dateIso && !s.done && !s.time)
    .sort((a, b) => a.projectName.localeCompare(b.projectName, 'ru'));
  if (!list.length) return null;
  const blocks = list.map(s => `<b>${escapeHtml(s.projectName)}</b> · ${quoted(s)}\nснимает ${who(s)}`);
  const n = list.length;
  const head = n === 1 ? 'Завтра съёмка без времени' : `Завтра съёмки без времени — ${n}`;
  return `⏰ <b>${head}</b>\n${ruLongDay(dateIso)}\n\n${blocks.join('\n\n')}\n\n`
    + `Укажите время до 18:00 — в 18:00 видеограф получит сообщение.\n👉 <a href="${attr(`${appUrl}/`)}">Указать время</a>`;
}

/** Рилс скоро выходит, а съёмки у него нет (отменили или не ставили). */
export interface NeedShoot {
  projectName: string;
  title: string | null;
  date: string;            // день выхода рилса
  cancelled: boolean;      // съёмка была, но её отменили
}

/** 12:00 — продюсеру (09.11.2026): что назначить. Рилсы ближайших дней без
 *  съёмки и завтрашние съёмки без времени. Нечего назначать — null. */
export function producerNoonMessage(
  tomorrow: string, shoots: ProducerShoot[], need: NeedShoot[], appUrl: string,
): string | null {
  const noTime = groupShoots(shoots.filter(s => s.date === tomorrow && !s.done && !s.time)
    .sort((a, b) => a.projectName.localeCompare(b.projectName, 'ru')));
  if (!noTime.length && !need.length) return null;
  const parts = [`⏰ <b>Нужно назначить — ${need.length + noTime.length}</b>`];
  if (need.length) {
    parts.push(need.map(r => `<b>${escapeHtml(r.projectName)}</b> · ${r.title?.trim() ? `«${escapeHtml(r.title.trim())}»` : 'без названия'}\n`
      + `выход: ${ruLongDay(r.date)} — ${r.cancelled ? 'съёмку отменили' : 'съёмки нет'}`).join('\n\n'));
  }
  if (noTime.length) {
    parts.push(`<b>Завтра без времени</b> · ${ruLongDay(tomorrow)}\n`
      + noTime.map(g => `${escapeHtml(g[0].projectName)} · ${g.length > 1 ? reels(g.length) : quoted(g[0])}`).join('\n')
      + `\nВремя — до 18:00: в 18:00 видеограф получит сообщение.`);
  }
  parts.push(`👉 <a href="${attr(`${appUrl}/smm`)}">Открыть умный календарь</a>`);
  return parts.join('\n\n');
}

/** 18:00 — продюсеру: как прошли сегодняшние съёмки. Съёмки рилсов, которые
 *  уже смонтированы, не считаем: их сняли раньше, а закрылись они сегодня
 *  вместе с монтажом. Съёмок сегодня не было — null. */
export function todaySummary(today: string, shoots: ProducerShoot[]): string | null {
  const list = shoots.filter(s => s.date === today && !s.edited);
  if (!list.length) return null;
  const byProject = new Map<string, ProducerShoot[]>();
  for (const s of [...list].sort(byTime)) byProject.set(s.projectName, [...(byProject.get(s.projectName) || []), s]);
  const lines = [...byProject].map(([name, g]) => {
    const done = g.filter(s => s.done).length;
    return `${done === g.length ? '✅' : '⏳'} ${escapeHtml(name)} — снято ${done} из ${g.length}`;
  });
  return `📋 <b>Сегодня</b>\n${lines.join('\n')}`;
}

// ── Съёмка изменилась после рассылки ──────────────────────────────────

export interface ShootSnapshot {
  date: string | null;
  time: string | null;
  place: string | null;
  assigneeId: string | null;
  status: string;
}

const isOff = (x: ShootSnapshot) => !x.date || x.status === 'cancelled';

/** Видеограф уже знает о съёмке: сегодня или завтра после 18:00. */
export function isAnnounced(date: string | null, today: string, hour: number): boolean {
  if (!date) return false;
  return date === today || (date === addDays(today, 1) && hour >= 18);
}

/** Что изменилось — заголовок сообщения; null — сообщать нечего. */
export function changeHead(before: ShootSnapshot, after: ShootSnapshot): string | null {
  // Съёмки не было (без даты или отменена), а теперь есть — например,
  // её поставили на завтра уже после рассылки в 18:00.
  if (isOff(before)) return isOff(after) ? null : 'Добавили съёмку';
  if (isOff(after)) return after.status === 'cancelled' ? 'Съёмку отменили' : 'Съёмку убрали из плана';
  if (before.date !== after.date) return 'Съёмку перенесли';
  if (before.time !== after.time) return before.time ? (after.time ? 'Время съёмки изменилось' : 'Время съёмки сняли') : 'Время съёмки назначено';
  if ((before.place || '') !== (after.place || '')) return 'Место съёмки изменилось';
  return null;
}

const when = (date: string | null, time: string | null) => (date ? `${ruLongDay(date)}${time ? `, ${time}` : ''}` : 'без даты');

/** «🔁 Время съёмки изменилось» — видеографу и продюсеру. */
export function changeMessage(
  head: string, before: ShootSnapshot, s: ProducerShoot, link: (s: ProducerShoot) => string, opts: MessageOpts = {},
): string {
  const off = head === 'Съёмку отменили' || head === 'Съёмку убрали из плана';
  const lines = [`🔁 <b>${head}</b>`, `${escapeHtml(s.projectName)} · ${quoted(s)}`];
  if (off) {
    lines.push(`была: ${when(before.date, before.time)}`);
    return lines.join('\n');
  }
  const moved = !isOff(before) && (before.date !== s.date || (!!before.time && before.time !== s.time));
  if (moved) lines.push(`было: ${when(before.date, before.time)}`);
  lines.push(`${moved ? 'стало: ' : ''}${s.date ? ruLongDay(s.date) : 'без даты'}${s.time ? `, <b>${s.time}</b>` : ''}`);
  lines.push(...shootBlock(s, link, opts));
  return lines.join('\n');
}

/** Исполнителя сменили: новому — вся съёмка, прежнему — короткое «передали». */
export function handedOverMessage(s: ProducerShoot, link: (s: ProducerShoot) => string): string {
  return [`🔁 <b>Вам передали съёмку</b>`, `${escapeHtml(s.projectName)} · ${quoted(s)}`,
    `${s.date ? ruLongDay(s.date) : 'без даты'}${s.time ? `, <b>${s.time}</b>` : ''}`,
    ...shootBlock(s, link, { own: true })].join('\n');
}
export function takenAwayMessage(s: ProducerShoot): string {
  return [`🔁 <b>Съёмку передали другому видеографу</b>`, `${escapeHtml(s.projectName)} · ${quoted(s)}`,
    `${s.date ? ruLongDay(s.date) : 'без даты'}${s.time ? `, ${s.time}` : ''}`,
    `теперь снимает ${who(s)}`].join('\n');
}
