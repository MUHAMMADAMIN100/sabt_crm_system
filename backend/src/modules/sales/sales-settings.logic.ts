import { BadRequestException } from '@nestjs/common';
import { SALES_DAILY_TARGETS, SalesKpiKey } from '../clients/sales-kpi.logic';
import type { SalesDirectionKey, SalesNorms } from '../clients/sales-settings';

/**
 * PUT /sales/settings (15.11.2026): проверка и слияние присланного с тем,
 * что уже лежит в sales_settings. Хранение и чтение — clients/sales-settings.ts
 * (sanitize* там молча выкидывают мусор при ЧТЕНИИ; здесь, при ЗАПИСИ,
 * мусор — 400 с понятным текстом, чтобы основатель видел, что не сохранилось).
 */

const NORM_KEYS = Object.keys(SALES_DAILY_TARGETS) as SalesKpiKey[];
const DIRECTIONS: SalesDirectionKey[] = ['smm', 'development'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Нормы: можно прислать одно направление и часть ключей — остальное
 *  остаётся как было. Норма — целое 0..500. */
export function mergeNorms(
  current: Record<SalesDirectionKey, SalesNorms>,
  input: unknown,
): Record<SalesDirectionKey, SalesNorms> {
  if (!isPlainObject(input)) throw new BadRequestException('Нормы — объект { smm, development }');
  const out: Record<SalesDirectionKey, SalesNorms> = {
    smm: { ...current.smm },
    development: { ...current.development },
  };
  for (const [dir, raw] of Object.entries(input)) {
    if (!DIRECTIONS.includes(dir as SalesDirectionKey)) {
      throw new BadRequestException(`Неизвестное направление норм: ${dir}`);
    }
    if (raw === undefined || raw === null) continue;
    if (!isPlainObject(raw)) throw new BadRequestException('Нормы направления — объект');
    for (const [key, value] of Object.entries(raw)) {
      if (!NORM_KEYS.includes(key as SalesKpiKey)) throw new BadRequestException(`Неизвестная норма: ${key}`);
      const n = Number(value);
      if (value === '' || value === null || !Number.isInteger(n) || n < 0 || n > 500) {
        throw new BadRequestException('Норма — целое число от 0 до 500');
      }
      out[dir as SalesDirectionKey][key as SalesKpiKey] = n;
    }
  }
  return out;
}

/** Комиссия: { userId: процент }. null, '' или 0 — снять комиссию; иначе
 *  0 < p ≤ 100, два знака. Не присланные менеджеры остаются как были. */
export function mergeCommission(current: Record<string, number>, input: unknown): Record<string, number> {
  if (!isPlainObject(input)) throw new BadRequestException('Комиссия — объект { userId: процент }');
  const out: Record<string, number> = { ...current };
  for (const [id, raw] of Object.entries(input)) {
    if (!UUID_RE.test(id)) throw new BadRequestException('Неверный сотрудник в комиссии');
    if (raw === null || raw === undefined || raw === '' || Number(raw) === 0) {
      delete out[id];
      continue;
    }
    const p = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      throw new BadRequestException('Комиссия — процент больше 0 и не больше 100');
    }
    out[id] = p;
  }
  return out;
}

/** id, у кого процент ставят или меняют (снятые не в счёт). Их проверяет
 *  сервис: комиссия — только действующим менеджерам продаж; давно
 *  сохранённый процент уволенного не мешает править остальных. */
export function newCommissionIds(current: Record<string, number>, next: Record<string, number>): string[] {
  return Object.keys(next).filter(id => current[id] !== next[id]);
}
