import {
  Volume2, Code2, Palette, Users, Building2, Repeat, Receipt, Target, Car, Printer,
  Percent, MoreHorizontal, Plus, TrendingUp, TrendingDown, Wallet2, DollarSign,
  type LucideIcon,
} from 'lucide-react'

// Имена иконок из бэкенда (category.icon) → компоненты lucide.
const ICON_MAP: Record<string, LucideIcon> = {
  smm: Volume2,
  development: Code2,
  design: Palette,
  salary: Users,
  building: Building2,
  transactions: Repeat,
  subscription: Repeat,
  receipt: Receipt,
  debt: Receipt,
  target: Target,
  ads: Target,
  car: Car,
  printer: Printer,
  percent: Percent,
  dots: MoreHorizontal,
  plus: Plus,
  income: TrendingUp,
  expense: TrendingDown,
  wallet: Wallet2,
  currency: DollarSign,
}

/** Иконка категории по имени из бэкенда. Наследует цвет через currentColor. */
export function CatIcon({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
  const Ic = (name && ICON_MAP[name]) || MoreHorizontal
  return <Ic size={size} className={className} />
}

export { ICON_MAP }
