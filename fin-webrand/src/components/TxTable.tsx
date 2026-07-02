import { useMemo } from 'react';
import type { Transaction } from '../db/types';
import { useAccounts, useClients, useEmployees, useCategories } from '../state/data';
import { TYPE_LABEL } from '../lib/constants';
import { money, formatDate } from '../lib/format';
import Icon from './Icon';

export default function TxTable({ txns, onEdit, onDelete }: {
  txns: Transaction[];
  onEdit?: (t: Transaction) => void;
  onDelete?: (id: string) => void;
}) {
  const accounts = useAccounts();
  const clients = useClients();
  const employees = useEmployees();
  const categories = useCategories();

  const accMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const cliMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  if (txns.length === 0) {
    return <div className="card empty"><div className="big"><Icon name="wallet" size={30} /></div>Нет операций за период</div>;
  }

  const sign = (t: Transaction) =>
    t.type === 'income' || t.type === 'saving' ? { s: '+', cls: 'pos' } : t.type === 'expense' ? { s: '−', cls: 'neg' } : { s: '', cls: 'muted' };

  const accountCell = (t: Transaction) => {
    const from = accMap.get(t.accountFrom ?? '');
    const to = accMap.get(t.accountTo ?? '');
    if (t.type === 'transfer') return `${from ?? '—'} → ${to ?? '—'}`;
    return from ?? to ?? '—';
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 104 }}>Дата</th>
            <th style={{ width: 88 }}>Тип</th>
            <th>Статья / описание</th>
            <th>Счёт</th>
            <th>Клиент</th>
            <th className="num" style={{ width: 120 }}>Сумма</th>
            {(onEdit || onDelete) && <th style={{ width: 64 }} />}
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => {
            const cat = catMap.get(t.categoryId ?? '');
            const sg = sign(t);
            return (
              <tr key={t.id} onDoubleClick={() => onEdit?.(t)}>
                <td className="muted">{formatDate(t.date)}</td>
                <td><span className={'badge ' + t.type}>{TYPE_LABEL[t.type]}</span></td>
                <td>
                  <div className="flex">
                    {cat && <span style={{ color: cat.color, display: 'inline-flex' }}><Icon name={cat.icon} size={16} /></span>}
                    <div>
                      <div>{cat?.name ?? (t.type === 'transfer' ? 'Перевод' : '—')}</div>
                      {t.comment && <div className="mini muted">{t.comment}</div>}
                    </div>
                  </div>
                </td>
                <td className="muted">{accountCell(t)}</td>
                <td className="muted">{cliMap.get(t.clientId ?? '') ?? empMap.get(t.employeeId ?? '') ?? '—'}</td>
                <td className={'num ' + sg.cls} style={{ fontWeight: 600 }}>{sg.s} {money(t.amount).replace('+', '')}</td>
                {(onEdit || onDelete) && (
                  <td className="num">
                    <span className="row-actions">
                      {onEdit && <button className="btn ghost sm" onClick={() => onEdit(t)}><Icon name="edit" size={15} /></button>}
                      {onDelete && <button className="btn ghost sm danger" onClick={() => confirm('Удалить операцию?') && onDelete(t.id)}><Icon name="trash" size={15} /></button>}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
