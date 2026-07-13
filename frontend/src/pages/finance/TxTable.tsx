// Журнал операций — общая таблица (порт fin-webrand/src/components/TxTable.tsx).
// txns — decorated-транзакции с бэка: имена счетов/категорий/проектов уже внутри.
import './finance.css';
import { money, formatDate, TYPE_LABEL } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import { finConfirm } from './FinKit';
import type { FinTx } from './types';

export default function TxTable({ txns, onEdit, onDelete }: {
  txns: FinTx[];
  onEdit?: (t: FinTx) => void;
  onDelete?: (id: string) => void;
}) {
  if (txns.length === 0) {
    return <div className="card empty"><div className="big"><FinIcon name="wallet" size={30} /></div>Нет операций за период</div>;
  }

  const sign = (t: any) =>
    t.type === 'income' || t.type === 'saving' ? { s: '+', cls: 'pos' } : t.type === 'expense' ? { s: '−', cls: 'neg' } : { s: '', cls: 'muted' };

  const accountCell = (t: any) => {
    if (t.type === 'transfer') return `${t.fromAccountName ?? '—'} → ${t.toAccountName ?? '—'}`;
    return t.accountName ?? t.fromAccountName ?? t.toAccountName ?? '—';
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 112 }}>Дата</th>
            <th style={{ width: 96 }}>Тип</th>
            <th style={{ minWidth: 220 }}>Статья / описание</th>
            <th style={{ minWidth: 130 }}>Счёт</th>
            <th style={{ minWidth: 130 }}>Клиент</th>
            <th className="num" style={{ width: 120 }}>Сумма</th>
            {(onEdit || onDelete) && <th style={{ width: 84 }} />}
          </tr>
        </thead>
        <tbody>
          {txns.map((t: any) => {
            const sg = sign(t);
            return (
              <tr key={t.id} onDoubleClick={() => onEdit?.(t)}>
                <td className="muted">{formatDate(t.date)}</td>
                <td><span className={'badge ' + t.type}>{TYPE_LABEL[t.type]}</span></td>
                <td>
                  <div className="flex">
                    {t.type === 'transfer'
                      ? <CatIcon icon="transactions" color="var(--accent)" size={26} />
                      : <CatIcon icon={t.categoryIcon} color={t.categoryColor} size={26} />}
                    <div>
                      <div>{t.categoryName ?? (t.type === 'transfer' ? 'Перевод' : '—')}</div>
                      {t.comment && <div className="mini muted">{t.comment}</div>}
                    </div>
                  </div>
                </td>
                <td className="muted">{accountCell(t)}</td>
                <td className="muted">{t.projectName ?? t.employeeName ?? t.debtName ?? '—'}</td>
                <td className={'num ' + sg.cls} style={{ fontWeight: 600 }}>{sg.s} {money(t.amount).replace('+', '')}</td>
                {(onEdit || onDelete) && (
                  <td className="num">
                    <span className="row-actions">
                      {onEdit && <button className="btn ghost sm" onClick={() => onEdit(t)}><FinIcon name="edit" size={15} /></button>}
                      {onDelete && <button className="btn ghost sm danger" onClick={async () => (await finConfirm('Удалить операцию? Балансы счетов пересчитаются.', { danger: true, confirmLabel: 'Удалить' })) && onDelete(t.id)}><FinIcon name="trash" size={15} /></button>}
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
