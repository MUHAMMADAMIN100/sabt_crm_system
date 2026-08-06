import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FinIcon, { CatIcon } from './FinIcon';

describe('finance icon system', () => {
  it('marks line icons for finance-scoped styling', () => {
    const { container } = render(<FinIcon name="activity" size={22} />);
    const icon = container.querySelector('svg');

    expect(icon).toHaveClass('fin-icon');
    expect(icon).toHaveAttribute('data-fin-icon', 'activity');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses category colour as a token instead of a saturated inline background', () => {
    const { container } = render(<CatIcon icon="salary" color="#e6535f" size={30} />);
    const tile = container.querySelector('.cat-ico') as HTMLElement;

    expect(tile).toHaveStyle({ width: '30px', height: '30px' });
    expect(tile.style.getPropertyValue('--cat-color')).toBe('#e6535f');
    expect(tile.style.background).toBe('');
  });
});
