/**
 * Действующие лимиты и цена проекта — зеркало backend/src/modules/projects/
 * tariff-limits.ts.
 *
 * «Индивидуальный» тариф в справочнике один на всю компанию и хранит нули: он
 * лишь помечает, что условия у проекта свои. Настоящие цифры лежат в
 * project.customTariff. Всё, что показывает или считает лимиты, обязано
 * ходить сюда — иначе индивидуальный проект снова окажется с нулями.
 */
export interface TariffLimits {
  storiesPerMonth: number
  reelsPerMonth: number
  postsPerMonth: number
  reportsPerMonth: number
  revisionLimit: number
  adsIncluded: boolean
  monthlyPrice: number
}

// Округление и потолки — как на бэкенде (backend/src/modules/projects/
// tariff-limits.ts), иначе форма и сервер посчитали бы разные цифры.
const MAX_COUNT = 10_000
const MAX_PRICE = 100_000_000

const num = (v: any, max = MAX_COUNT): number => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(Math.min(n, max) * 100) / 100
}

export function tariffLimitsOf(
  tariff: any | null | undefined,
  customTariff: any | null | undefined,
): TariffLimits {
  const src = tariff?.isCustom ? (customTariff || {}) : (tariff || {})
  return {
    storiesPerMonth: num(src.storiesPerMonth),
    reelsPerMonth: num(src.reelsPerMonth),
    postsPerMonth: num(src.postsPerMonth),
    reportsPerMonth: num(src.reportsPerMonth),
    revisionLimit: num(src.revisionLimit),
    adsIncluded: !!src.adsIncluded,
    monthlyPrice: num(src.monthlyPrice, MAX_PRICE),
  }
}
