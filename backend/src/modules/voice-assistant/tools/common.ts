import { User } from '../../users/user.entity';
import { ToolError } from './types';

export const TZ = 'Asia/Dushanbe';

/** Сегодня по Душанбе (на Railway сервер в UTC — вечером даты съезжали бы). */
export function todayDushanbe(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

export function nowTimeDushanbe(now = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

/** Сдвиг даты YYYY-MM-DD на n дней (без часовых поясов — чистая дата). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export function weekdayRu(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** Названное время — душанбинское; у Таджикистана нет перевода часов. */
export function dushanbeISO(date: string, time: string): string {
  return `${date}T${time}:00+05:00`;
}

/** Дата и время из ISO по Душанбе. */
export function splitDushanbe(iso: string | Date | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso as any);
  if (Number.isNaN(d.getTime())) return null;
  return { date: todayDushanbe(d), time: nowTimeDushanbe(d) };
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function fmtDateRu(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** «12 ноября, 15:00» или «12 ноября» для конца дня. */
export function fmtDeadline(iso: string | Date | null | undefined): string {
  const p = splitDushanbe(iso);
  if (!p) return 'без срока';
  return p.time === '23:59' ? fmtDateRu(p.date) : `${fmtDateRu(p.date)}, ${p.time}`;
}

export function checkDate(value: unknown, field = 'дата'): string {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new ToolError(`Неверная ${field}: «${s}». Нужен формат ГГГГ-ММ-ДД.`);
  }
  return s;
}

export function checkTime(value: unknown): string {
  const s = String(value ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new ToolError(`Неверное время: «${s}». Нужно ЧЧ:ММ.`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MANAGER_PLUS = ['admin', 'founder', 'smm_director', 'dev_director'];

export function roles(user: Pick<User, 'role' | 'secondaryRole'>): string[] {
  return [user.role, user.secondaryRole].filter(Boolean) as string[];
}

/** Руководство — как MANAGER_PLUS_ROLES на сайте (роль или вторая роль). */
export function isManagerPlus(user: Pick<User, 'role' | 'secondaryRole'>): boolean {
  return roles(user).some((r) => MANAGER_PLUS.includes(r));
}

/** Менеджер продаж — на сайте только по основной роли (TasksPage.tsx:64). */
export function isSalesManager(user: Pick<User, 'role'>): boolean {
  return user.role === 'sales_manager_smm' || user.role === 'sales_manager_dev';
}

/** Видит ли человек общий список задач компании — как вкладка «Задачи»:
 *  руководство и МП берут GET /tasks, остальные — только /tasks/my. */
export function seesAllTasks(user: Pick<User, 'role' | 'secondaryRole'>): boolean {
  return isManagerPlus(user) || isSalesManager(user);
}

/** Нормализация для нечёткого поиска по названиям. */
export function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`.,!?;:()\-–—_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Насколько название похоже на запрос: доля слов запроса, найденных по
 *  основе (первые 4 буквы) — падежи «Архидеи/Архидея» совпадают. */
export function matchScore(title: string, query: string): number {
  const t = norm(title);
  const words = norm(query).split(' ').filter((w) => w.length >= 2);
  if (!words.length) return 0;
  let hit = 0;
  for (const w of words) {
    const stem = w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w;
    if (t.includes(stem)) hit++;
  }
  return hit / words.length;
}
