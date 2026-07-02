// Формат сомони (TJS) и работа с месяцами для переключателя периода.

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function money(n: number, withSign = false): string {
  const sign = withSign && n > 0 ? '+' : '';
  const abs = Number.isInteger(n) ? nf.format(n) : nf2.format(n);
  return `${sign}${abs} с.`;
}

export function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentYm(): string {
  return ymOf(todayISO());
}

/** Сдвиг месяца yyyy-mm на delta месяцев. */
export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  // Убираем суффикс « г.» — и так понятно, что это год.
  return d.toLocaleDateString('ru-RU', long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' })
    .replace(/\s*г\.?$/i, '');
}

/** День месяца оплаты (1..31) по дате контракта, или null. */
export function contractDay(contractDate?: string): number | null {
  if (!contractDate || contractDate.length < 10) return null;
  const d = Number(contractDate.slice(8, 10));
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Дата оплаты в указанном месяце (ISO yyyy-mm-dd) с учётом длины месяца. */
export function dueDateForMonth(ym: string, day: number): string {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${ym}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  return `${day} ${month} ${d.getFullYear()}`;
}
