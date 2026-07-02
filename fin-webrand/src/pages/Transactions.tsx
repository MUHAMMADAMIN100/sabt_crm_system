import { useMemo, useState } from 'react';
import {
  useTransactions, useCategories, useAccounts,
  updateTransaction, deleteTransaction,
} from '../state/data';
import type { Transaction, TxType, Account, Category } from '../db/types';
import { TYPE_LABEL, categoryGroup } from '../lib/constants';
import Icon from '../components/Icon';
import TransactionModal from '../components/TransactionModal';

const TYPES: TxType[] = ['income', 'expense', 'transfer', 'saving'];

export default function Transactions() {
  const txns = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TxType | ''>('');
  const [addType, setAddType] = useState<TxType | null>(null);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtered = txns.filter((t) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (q) {
      const hay = [t.comment, catMap.get(t.categoryId ?? '')?.name].join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div><h1>Транзакции</h1><p>Журнал операций — добавляйте через кнопки или правьте прямо в таблице</p></div>
        <div className="flex">
          <button className="btn" style={{ color: 'var(--green)' }} onClick={() => setAddType('income')}><Icon name="plus" size={15} /> Доход</button>
          <button className="btn" style={{ color: 'var(--red)' }} onClick={() => setAddType('expense')}><Icon name="plus" size={15} /> Расход</button>
          <button className="btn" style={{ color: 'var(--accent)' }} onClick={() => setAddType('transfer')}><Icon name="plus" size={15} /> Перевод</button>
        </div>
      </div>
      {addType && <TransactionModal initialType={addType} onClose={() => setAddType(null)} />}

      <div className="toolbar">
        <input className="grow" style={{ maxWidth: 300 }} placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TxType | '')} style={{ width: 150 }}>
          <option value="">Все типы</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <span className="muted mini">{filtered.length} операций</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big"><Icon name="wallet" size={30} /></div>Нет операций — добавьте кнопками сверху</div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 132 }}>Дата</th>
                <th style={{ width: 110 }}>Тип</th>
                <th style={{ width: 160 }}>Категория</th>
                <th>Описание</th>
                <th className="num" style={{ width: 110 }}>Сумма</th>
                <th style={{ width: 120 }}>Со счёта</th>
                <th style={{ width: 120 }}>На счёт</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <TxRow key={t.id} t={t} accounts={accounts} categories={categories} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AccountSelect({ value, accounts, onChange }: { value?: string; accounts: Account[]; onChange: (v: string | undefined) => void }) {
  return (
    <select className="cell-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">—</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function TxRow({ t, accounts, categories }: { t: Transaction; accounts: Account[]; categories: Category[] }) {
  const cats = categories.filter((c) => c.kind === t.type && !c.archived);
  const fromActive = t.type === 'expense' || t.type === 'transfer';
  const toActive = t.type === 'income' || t.type === 'transfer' || t.type === 'saving';

  function changeType(nt: TxType) {
    const patch: Partial<Transaction> = { type: nt, categoryId: undefined, group: undefined };
    if (nt === 'income' || nt === 'saving') patch.accountFrom = undefined;
    if (nt === 'expense') patch.accountTo = undefined;
    updateTransaction(t.id, patch);
  }

  return (
    <tr>
      <td><input type="date" className="cell-input" value={t.date} onChange={(e) => updateTransaction(t.id, { date: e.target.value })} /></td>
      <td>
        <select className={'cell-input badge-select ' + t.type} value={t.type} onChange={(e) => changeType(e.target.value as TxType)}>
          {TYPES.map((x) => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
        </select>
      </td>
      <td>
        {t.type === 'transfer'
          ? <span className="muted mini">—</span>
          : (
            <select className="cell-input" value={t.categoryId ?? ''}
              onChange={(e) => updateTransaction(t.id, { categoryId: e.target.value || undefined, group: categoryGroup(e.target.value || undefined) })}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
      </td>
      <td>
        <input className="cell-input" defaultValue={t.comment ?? ''} placeholder="описание"
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.comment ?? '')) updateTransaction(t.id, { comment: v || undefined }); }} />
      </td>
      <td className="num">
        <input className="cell-input" inputMode="decimal" defaultValue={t.amount || ''} placeholder="0" style={{ textAlign: 'right' }}
          onBlur={(e) => { const v = parseFloat(e.target.value.replace(',', '.')) || 0; if (v !== t.amount) updateTransaction(t.id, { amount: v }); }} />
      </td>
      <td>{fromActive ? <AccountSelect value={t.accountFrom} accounts={accounts} onChange={(v) => updateTransaction(t.id, { accountFrom: v })} /> : <span className="muted mini">—</span>}</td>
      <td>{toActive ? <AccountSelect value={t.accountTo} accounts={accounts} onChange={(v) => updateTransaction(t.id, { accountTo: v })} /> : <span className="muted mini">—</span>}</td>
      <td className="num">
        <button className="btn ghost sm row-actions" title="Удалить" onClick={() => confirm('Удалить операцию?') && deleteTransaction(t.id)}><Icon name="trash" size={14} /></button>
      </td>
    </tr>
  );
}
