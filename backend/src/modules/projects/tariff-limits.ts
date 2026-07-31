/**
 * Действующие лимиты и цена проекта.
 *
 * «Индивидуальный» тариф в справочнике один на всю компанию и хранит нули —
 * он лишь помечает, что условия у проекта свои. Настоящие цифры лежат в
 * projects.customTariff. Всё, что считает лимиты (генерация контент-плана на
 * доске, перерасход, подписи), обязано ходить сюда, иначе индивидуальный
 * проект снова окажется с нулями.
 */
export interface TariffLimits {
  storiesPerMonth: number;
  reelsPerMonth: number;
  postsPerMonth: number;
  reportsPerMonth: number;
  revisionLimit: number;
  adsIncluded: boolean;
  monthlyPrice: number;
}

/** Потолки. Без них Number(1e308) проходит как «конечное число», а дальше
 *  цена улетает в Infinity → перерасход становится NaN → numeric overflow в
 *  decimal(15,2), и проект перестаёт сохраняться вообще у кого бы то ни было. */
const MAX_COUNT = 10_000;      // штук в месяц
const MAX_PRICE = 100_000_000; // сомони в месяц

const num = (v: any, max = MAX_COUNT): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, max) * 100) / 100;
};

/** Ключи, которые сотрудник может задать у индивидуального тарифа. */
export const CUSTOM_TARIFF_KEYS = [
  'storiesPerMonth', 'reelsPerMonth', 'postsPerMonth',
  'reportsPerMonth', 'revisionLimit', 'adsIncluded', 'monthlyPrice',
] as const;

/** Цена задаётся в сомони и потолок у неё свой, у остальных — штуки. */
const maxOf = (key: string) => (key === 'monthlyPrice' ? MAX_PRICE : MAX_COUNT);

/** Очистка входящего объекта: только известные ключи, только валидные числа.
 *  Возвращает null, если задавать нечего — тогда в БД не копится пустой мусор. */
export function sanitizeCustomTariff(input: any): Record<string, any> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, any> = {};
  for (const k of CUSTOM_TARIFF_KEYS) {
    if (!(k in input)) continue;
    out[k] = k === 'adsIncluded' ? !!input[k] : num(input[k], maxOf(k));
  }
  const meaningful = Object.entries(out).some(([k, v]) => (k === 'adsIncluded' ? v === true : Number(v) > 0));
  return meaningful ? out : null;
}

/** Что реально действует у проекта: у индивидуального тарифа — цифры проекта,
 *  у обычного — цифры справочника. */
export function effectiveLimits(
  tariff: Partial<TariffLimits> & { isCustom?: boolean } | null | undefined,
  customTariff: Record<string, any> | null | undefined,
): TariffLimits {
  const src: any = tariff?.isCustom ? (customTariff || {}) : (tariff || {});
  return {
    storiesPerMonth: num(src.storiesPerMonth),
    reelsPerMonth: num(src.reelsPerMonth),
    postsPerMonth: num(src.postsPerMonth),
    reportsPerMonth: num(src.reportsPerMonth),
    revisionLimit: num(src.revisionLimit),
    adsIncluded: !!src.adsIncluded,
    monthlyPrice: num(src.monthlyPrice, MAX_PRICE),
  };
}
