import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TransactionDetailsModal from './TransactionDetailsModal';

describe('TransactionDetailsModal', () => {
  it('shows who received an advance and its payroll period', () => {
    render(<div className="fin-root"><TransactionDetailsModal
      transaction={{
        id: 'tx-advance', type: 'expense', amount: 500, date: '2026-08-05', status: 'completed',
        comment: 'Аванс', categoryName: 'Зарплата', categoryIcon: 'banknote', employeeId: 'emp-1',
        employeeName: 'Сабрина', employeeRole: 'SMM-специалист', employeeCategory: 'SMM', salaryYm: '2026-07',
        accountName: 'Cash', affectsBalance: true,
      }}
      onClose={() => {}}
      onEdit={() => {}}
    /></div>);

    expect(screen.getByText('Кому выплачено')).toBeInTheDocument();
    expect(screen.getAllByText('Сабрина').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SMM-специалист · SMM').length).toBeGreaterThan(0);
    expect(screen.getByText('июль 2026')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });

  it('moves from read view to editing when requested', async () => {
    const onEdit = vi.fn();
    const tx = { id: 'tx-income', type: 'income', amount: 2000, date: '2026-08-05', projectId: 'p-1', projectName: 'Американский', accountName: 'Alif' };
    render(<div className="fin-root"><TransactionDetailsModal transaction={tx} onClose={() => {}} onEdit={onEdit} /></div>);
    await userEvent.click(screen.getByRole('button', { name: /Изменить/ }));
    expect(onEdit).toHaveBeenCalledWith(tx);
  });
});
