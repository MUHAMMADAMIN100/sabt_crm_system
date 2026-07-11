// Транзакции /finance/transactions — журнал с Notion-инлайн-редактированием
// (порт fin-webrand/src/pages/Transactions.tsx, ТЗ «Этап 5»).
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { TYPE_LABEL } from './finlib';
import FinIcon from './FinIcon';
import TransactionModal from './TransactionModal';
import { financeApi } from '@/services/api.service';

const TYPES = ['income', 'expense', 'transfer', 'saving'];

export default function FinanceTransactionsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [addType, setAddType] = useState<string | null>(null);

  const { data: txData } = useQuery({
    queryKey: ['finance', 'transactions', 'all'],
    queryFn: () => financeApi.transactions({ pageSize: 1000 }),
  });
  const { data: categories = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: () => financeApi.categories() });
  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => financeApi.accounts() });

  const txns = useMemo(() => {
    const items: any[] = txData?.items ?? [];
    return [...items].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [txData]);

  const filtered = txns.filter((t: any) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (q) {
      const hay = [t.comment, t.categoryName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  async function patch(id: string, data: any) {
    try {
      await financeApi.updateTransaction(id, data);
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка');
    }
  }

  async function remove(id: string) {
    try {
      await financeApi.removeTransaction(id);
      qc.invalidateQueries({ queryKey: ['finance'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка');
    }
  }

  return (
    <div className="fin-root">
      <div className="page-head">
        <div><h1>Транзакции</h1><p>Журнал операций — добавляйте через кнопки или правьте прямо в таблице</p></div>
        <div className="flex">
          <button className="btn" style={{ color: 'var(--green)' }} onClick={() => setAddType('income')}><FinIcon name="plus" size={15} /> Доход</button>
          <button className="btn" style={{ color: 'var(--red)' }} onClick={() => setAddType('expense')}><FinIcon name="plus" size={15} /> Расход</button>
          <button className="btn" style={{ color: 'var(--accent)' }} onClick={() => setAddType('transfer')}><FinIcon name="plus" size={15} /> Трансфер</button>
        </div>
      </div>
      {addType && <TransactionModal initialType={addType} onClose={() => setAddType(null)} />}

      <div className="toolbar">
        <input className="grow" style={{ maxWidth: 300 }} placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 150 }}>
          <option value="">Все типы</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <span className="muted mini">{filtered.length} операций</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big"><FinIcon name="wallet" size={30} /></div>Нет операций — добавьте кнопками сверху</div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Дата</th>
                <th style={{ width: 120 }}>Тип</th>
                <th style={{ width: 170 }}>Категория</th>
                <th style={{ minWidth: 200 }}>Описание</th>
                <th className="num" style={{ width: 120 }}>Сумма</th>
                <th style={{ width: 130 }}>Со счёта</th>
                <th style={{ width: 130 }}>На счёт</th>
                <th style={{ width: 56 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t: any) => (
                <TxRow key={t.id} t={t} accounts={accounts} categories={categories} patch={patch} remove={remove} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountSelect({ value, accounts, onChange }: { value?: string; accounts: any[]; onChange: (v: string | null) => void }) {
  return (
    <select className="cell-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function TxRow({ t, accounts, categories, patch, remove }: {
  t: any; accounts: any[]; categories: any[];
  patch: (id: string, data: any) => void; remove: (id: string) => void;
}) {
  const cats = categories.filter((c: any) => c.type === t.type);
  const fromActive = t.type === 'expense' || t.type === 'transfer';
  const toActive = t.type === 'income' || t.type === 'transfer' || t.type === 'saving';
  // decorated tx: у перевода счета в fromAccountId/toAccountId, у остальных — в accountId
  const fromValue = t.type === 'transfer' ? t.fromAccountId : t.type === 'expense' ? t.accountId : undefined;
  const toValue = t.type === 'transfer' ? t.toAccountId : toActive ? t.accountId : undefined;

  function changeType(nt: string) {
    // Смена типа очищает категорию и неприменимые счета (применимые переносим).
    const data: any = { type: nt, categoryId: null };
    if (nt === 'transfer') {
      data.accountId = null;
      data.fromAccountId = fromValue ?? null;
      data.toAccountId = toValue ?? null;
    } else if (nt === 'expense') {
      data.accountId = fromValue ?? null;
      data.fromAccountId = null;
      data.toAccountId = null;
    } else {
      // income | saving
      data.accountId = toValue ?? null;
      data.fromAccountId = null;
      data.toAccountId = null;
    }
    patch(t.id, data);
  }

  return (
    <tr>
      <td><input type="date" className="cell-input" value={String(t.date || '').slice(0, 10)} onChange={(e) => patch(t.id, { date: e.target.value })} /></td>
      <td>
        <select className={'cell-input badge-select ' + t.type} value={t.type} onChange={(e) => changeType(e.target.value)}>
          {TYPES.map((x) => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
        </select>
      </td>
      <td>
        {t.type === 'transfer'
          ? <span className="muted mini">—</span>
          : (
            <select className="cell-input" value={t.categoryId ?? ''}
              onChange={(e) => patch(t.id, { categoryId: e.target.value || null })}>
              <option value="">—</option>
              {cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
      </td>
      <td>
        <input className="cell-input" defaultValue={t.comment ?? ''} placeholder="описание"
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.comment ?? '')) patch(t.id, { comment: v || null }); }} />
      </td>
      <td className="num">
        <input className="cell-input" inputMode="decimal" defaultValue={t.amount || ''} placeholder="0" style={{ textAlign: 'right' }}
          onBlur={(e) => { const v = parseFloat(e.target.value.replace(',', '.')) || 0; if (v !== t.amount) patch(t.id, { amount: v }); }} />
      </td>
      <td>{fromActive
        ? <AccountSelect value={fromValue} accounts={accounts} onChange={(v) => patch(t.id, t.type === 'transfer' ? { fromAccountId: v } : { accountId: v })} />
        : <span className="muted mini">—</span>}</td>
      <td>{toActive
        ? <AccountSelect value={toValue} accounts={accounts} onChange={(v) => patch(t.id, t.type === 'transfer' ? { toAccountId: v } : { accountId: v })} />
        : <span className="muted mini">—</span>}</td>
      <td className="num">
        <button className="btn ghost sm row-actions" title="Удалить" onClick={() => confirm('Удалить операцию?') && remove(t.id)}><FinIcon name="trash" size={14} /></button>
      </td>
    </tr>
  );
}
