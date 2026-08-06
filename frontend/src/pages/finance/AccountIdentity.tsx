import type { CSSProperties, ReactNode } from 'react';
import alifLogo from '@/assets/finance/alif.svg';
import dushanbeCityLogo from '@/assets/finance/dushanbe-city.svg';
import FinIcon from './FinIcon';

export type AccountBrand = 'alif' | 'dushanbe-city' | 'cash' | 'generic';

export function accountBrand(name?: string | null): AccountBrand {
  const normalized = String(name || '').trim().toLocaleLowerCase('ru-RU');
  if (normalized.includes('alif') || normalized.includes('алиф')) return 'alif';
  if (normalized.includes('dushanbe city') || normalized.includes('душанбе сити') || normalized === 'dc' || normalized === 'дс') return 'dushanbe-city';
  if (normalized.includes('cash') || normalized.includes('налич')) return 'cash';
  return 'generic';
}

export function AccountMark({ name, color, compact = false }: {
  name?: string | null;
  color?: string | null;
  compact?: boolean;
}) {
  const brand = accountBrand(name);
  const content: ReactNode = brand === 'alif'
    ? <img src={alifLogo} alt="" aria-hidden="true" />
    : brand === 'dushanbe-city'
      ? <img src={dushanbeCityLogo} alt="" aria-hidden="true" />
      : <FinIcon name={brand === 'cash' ? 'banknote' : 'wallet'} size={compact ? 14 : 16} />;

  return (
    <span
      className={`fin-account-mark ${brand}${compact ? ' compact' : ''}`}
      data-account-brand={brand}
      style={{ '--account-color': color || '#7c8494' } as CSSProperties}
      aria-hidden="true"
    >
      {content}
    </span>
  );
}

export function AccountLabel({ name, color, compact = false, prefix }: {
  name?: string | null;
  color?: string | null;
  compact?: boolean;
  prefix?: ReactNode;
}) {
  const visibleName = name || 'Счёт не указан';
  return (
    <span className={`fin-account-label${compact ? ' compact' : ''}`}>
      {prefix}
      <AccountMark name={visibleName} color={color} compact={compact} />
      <span className="fin-account-name">{visibleName}</span>
    </span>
  );
}
