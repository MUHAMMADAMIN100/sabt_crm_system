import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountLabel, AccountMark, accountBrand } from './AccountIdentity';

describe('finance account identity', () => {
  it.each([
    ['Alif', 'alif'],
    ['алиф банк', 'alif'],
    ['Dushanbe city', 'dushanbe-city'],
    ['Душанбе Сити', 'dushanbe-city'],
    ['Cash', 'cash'],
    ['Наличные', 'cash'],
    ['Другой счёт', 'generic'],
  ] as const)('maps %s to %s', (name, brand) => {
    expect(accountBrand(name)).toBe(brand);
  });

  it('renders the account name with its finance-scoped mark', () => {
    const { container } = render(<AccountLabel name="Alif" color="#00af66" />);
    expect(screen.getByText('Alif')).toBeInTheDocument();
    expect(container.querySelector('[data-account-brand="alif"] img')).toBeInTheDocument();
  });

  it('uses a banknote line icon for cash', () => {
    const { container } = render(<AccountMark name="Cash" compact />);
    expect(container.querySelector('[data-account-brand="cash"] [data-fin-icon="banknote"]')).toBeInTheDocument();
  });
});
