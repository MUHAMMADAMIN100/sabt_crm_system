/**
 * Настройки продаж (15.11.2026, таблица sales_settings, миграция 1834):
 * дневные нормы KPI по направлениям и комиссия менеджеров.
 *
 * Хранение: ключ → jsonb.
 *   'kpi_norms'  → { smm?: Partial<SalesNorms>, development?: Partial<SalesNorms> }
 *   'commission' → { [userId]: percent }   (0 < percent ≤ 100; нет ключа — комиссии нет)
 *
 * Читают: ClientsService.kpi (нормы), SalesService (GET/PUT /sales/settings),
 * SalesPlanService (комиссия в карточке плана). Таблицы может не быть
 * (база до миграции) — тогда действуют значения по умолчанию.
 */
import { SALES_DAILY_TARGETS, SalesKpiKey } from './sales-kpi.logic';
import type { SqlRunner } from './lead-events';

export type SalesNorms = Record<SalesKpiKey, number>;
export type SalesDirectionKey = 'smm' | 'development';

export interface SalesSettings {
  norms: Record<SalesDirectionKey, SalesNorms>;
  /** userId → процент от полученных оплат. */
  commission: Record<string, number>;
}

export const DEFAULT_SALES_NORMS: SalesNorms = { ...SALES_DAILY_TARGETS };

const NORM_KEYS = Object.keys(SALES_DAILY_TARGETS) as SalesKpiKey[];

/** Норма — целое 0..500; мусор → значение по умолчанию. */
export function sanitizeNorms(v: unknown, base: SalesNorms = DEFAULT_SALES_NORMS): SalesNorms {
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = { ...base };
  for (const k of NORM_KEYS) {
    const n = Number(src[k]);
    if (Number.isInteger(n) && n >= 0 && n <= 500) out[k] = n;
  }
  return out;
}

/** Процент комиссии: 0 < p ≤ 100, два знака; иначе — нет комиссии. */
export function sanitizeCommission(v: unknown): Record<string, number> {
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(src)) {
    const p = Math.round(Number(raw) * 100) / 100;
    if (/^[0-9a-f-]{36}$/i.test(id) && Number.isFinite(p) && p > 0 && p <= 100) out[id] = p;
  }
  return out;
}

export async function loadSalesSettings(m: SqlRunner): Promise<SalesSettings> {
  let rows: Array<{ key: string; value: any }> = [];
  try {
    rows = await m.query(`SELECT key, value FROM sales_settings WHERE key IN ('kpi_norms', 'commission')`);
  } catch {
    rows = [];
  }
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? null;
  const norms = get('kpi_norms') || {};
  return {
    norms: {
      smm: sanitizeNorms(norms.smm),
      development: sanitizeNorms(norms.development),
    },
    commission: sanitizeCommission(get('commission')),
  };
}

/** Нормы для направления менеджера (нет направления — по умолчанию). */
export function normsFor(s: SalesSettings, direction: string | null | undefined): SalesNorms {
  if (direction === 'smm' || direction === 'development') return s.norms[direction];
  return { ...DEFAULT_SALES_NORMS };
}

export async function saveSalesSetting(m: SqlRunner, key: 'kpi_norms' | 'commission', value: unknown, userId?: string | null): Promise<void> {
  await m.query(
    `INSERT INTO sales_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value ?? {}), userId ?? null],
  );
}
