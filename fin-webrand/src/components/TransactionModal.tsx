import { useState } from 'react';
import type { Transaction, TxType } from '../db/types';
import {
  useAccounts, useCategories, useClients, useEmployees, useDebts,
  addTransaction, updateTransaction,
} from '../state/data';
import { TYPE_LABEL, categoryGroup } from '../lib/constants';
import { todayISO } from '../lib/format';
import { db, uid } from '../db/db';
import Icon from './Icon';

const TYPES: TxType[] = ['income', 'expense', 'transfer', 'saving'];

export default function TransactionModal({ initial, initialType, onClose }: { initial?: Transaction; initialType?: TxType; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const clients = useClients();
  const employees = useEmployees();
  const debts = useDebts();

  const [type, setType] = useState<TxType>(initial?.type ?? initialType ?? 'expense');
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [accountFrom, setAccountFrom] = useState(initial?.accountFrom ?? '');
  const [accountTo, setAccountTo] = useState(initial?.accountTo ?? '');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? '');
  const [debtId, setDebtId] = useState(initial?.debtId ?? '');
  const [comment, setComment] = useState(initial?.comment ?? '');

  const needFrom = type === 'expense' || type === 'transfer';
  const needTo = type === 'income' || type === 'transfer' || type === 'saving';
  const needCategory = type !== 'transfer';
  const catKind = type;
  const cats = categories.filter((c) => c.kind === catKind && !c.archived);

  const amt = parseFloat(amount.replace(',', '.'));
  const valid = amt > 0 && (!needFrom || accountFrom) && (!needTo || accountTo) &&
    (type !== 'transfer' || accountFrom !== accountTo);

  async function createCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const id = uid();
    const icon = type === 'income' ? 'income' : type === 'expense' ? 'expense' : type === 'transfer' ? 'transactions' : 'income';
    await db.categories.add({ id, name, kind: type, icon, color: '#64748b', order: categories.length });
    setCategoryId(id);
    setAddingCat(false);
    setNewCatName('');
  }

  async function save() {
    if (!valid) return;
    const payload = {
      date, type, amount: amt,
      categoryId: needCategory ? categoryId || undefined : undefined,
      group: needCategory ? categoryGroup(categoryId) : undefined,
      accountFrom: needFrom ? accountFrom : undefined,
      accountTo: needTo ? accountTo : undefined,
      clientId: type === 'income' ? clientId || undefined : undefined,
      employeeId: type === 'expense' ? employeeId || undefined : undefined,
      debtId: type === 'expense' ? debtId || undefined : undefined,
      comment: comment.trim() || undefined,
    };
    if (initial) await updateTransaction(initial.id, payload);
    else await addTransaction(payload);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{initial ? 'Изменить операцию' : 'Новая операция'}</h3>
          <button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="type-tabs">
            {TYPES.map((t) => (
              <button key={t} className={`type-tab t-${t}` + (type === t ? ' active' : '')}
                onClick={() => { setType(t); setCategoryId(''); }}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label>
              <input autoFocus inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>

          {needCategory && (
            <div className="field"><label>Категория</label>
              <select value={categoryId} onChange={(e) => { if (e.target.value === '__new__') setAddingCat(true); else setCategoryId(e.target.value); }}>
                <option value="">— выбрать —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">＋ Новая категория…</option>
              </select>
              {addingCat && (
                <div className="flex" style={{ marginTop: 6 }}>
                  <input autoFocus placeholder="Название категории" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); }} />
                  <button className="btn primary sm" disabled={!newCatName.trim()} onClick={createCategory}>Создать</button>
                  <button className="btn ghost sm" onClick={() => { setAddingCat(false); setNewCatName(''); }}><Icon name="close" size={14} /></button>
                </div>
              )}
              {type === 'expense' && <p className="mini muted" style={{ margin: '4px 0 0' }}>Новые категории (кроме ЗП/Аренды/Долгов) суммируются в «Прочее».</p>}
            </div>
          )}

          <div className="form-grid">
            {needFrom && (
              <div className="field"><label>{type === 'transfer' ? 'Со счёта' : 'Списать со счёта'}</label>
                <select value={accountFrom} onChange={(e) => setAccountFrom(e.target.value)}>
                  <option value="">— выбрать —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            {needTo && (
              <div className="field"><label>{type === 'transfer' ? 'На счёт' : 'Зачислить на счёт'}</label>
                <select value={accountTo} onChange={(e) => setAccountTo(e.target.value)}>
                  <option value="">— выбрать —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {type === 'income' && (
            <div className="field"><label>Проект / клиент (необязательно)</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— не привязан —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {type === 'expense' && (
            <div className="form-grid">
              <div className="field"><label>Сотрудник</label>
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">— не привязан —</option>
                  {employees.map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Долг</label>
                <select value={debtId} onChange={(e) => setDebtId(e.target.value)}>
                  <option value="">— не привязан —</option>
                  {debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="field"><label>Комментарий</label>
            <input placeholder="Например: половина суммы контракта" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid} onClick={save}>{initial ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  );
}
