// Модалка «Новая операция» / «Изменить операцию» (порт fin-webrand/src/components/TransactionModal.tsx, ТЗ «Этап 2»).
// initial — decorated-транзакция при редактировании; initialType — предвыбранный тип;
// initialDate — предвыбранная дата (клик по дню в календаре транзакций).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { TYPE_LABEL, todayISO, currentYm, apiErr } from './finlib';
import FinIcon from './FinIcon';
import { FinModal, finConfirm, invalidateFinance, invalidateFinanceAll } from './FinKit';
import { financeApi } from '@/services/api.service';
import { AccountMark } from './AccountIdentity';

const TYPES = ['income', 'expense', 'transfer', 'saving'];

export default function TransactionModal({ initial, initialType, initialDate, onClose }: { initial?: any; initialType?: string; initialDate?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: allAccounts = [] } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  const { data: categories = [] } = useQuery({ queryKey: ['finref', 'categories'], queryFn: () => financeApi.categories() });
  const { data: projects = [] } = useQuery({ queryKey: ['finref', 'projects'], queryFn: () => financeApi.projects() });
  const { data: employees = [] } = useQuery({ queryKey: ['finref', 'employees'], queryFn: () => financeApi.employees() });
  const { data: debts = [] } = useQuery({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() });
  // Архивные счета не предлагаем; счёт редактируемой операции оставляем видимым.
  const accounts = (allAccounts as any[]).filter((a: any) =>
    !a.archived || a.id === initial?.accountId || a.id === initial?.fromAccountId || a.id === initial?.toAccountId);

  const [type, setType] = useState<string>(initial?.type ?? initialType ?? 'expense');
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [date, setDate] = useState<string>((initial?.date ?? initialDate ?? todayISO()).slice(0, 10));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? '');
  const [accountFrom, setAccountFrom] = useState<string>(
    initial ? ((['transfer', 'saving'].includes(initial.type) ? initial.fromAccountId : initial.type === 'expense' ? initial.accountId : '') ?? '') : ''
  );
  const [accountTo, setAccountTo] = useState<string>(
    initial ? ((['transfer', 'saving'].includes(initial.type) ? (initial.toAccountId ?? initial.accountId) : initial.type !== 'expense' ? initial.accountId : '') ?? '') : ''
  );
  const [projectId, setProjectId] = useState<string>(initial?.projectId ?? '');
  const [employeeId, setEmployeeId] = useState<string>(initial?.employeeId ?? '');
  const [debtId, setDebtId] = useState<string>(initial?.debtId ?? '');
  const [salaryYm, setSalaryYm] = useState<string>(
    initial?.salaryYm || String(initial?.date ?? '').slice(0, 7) || currentYm(),
  );
  const [comment, setComment] = useState<string>(initial?.comment ?? '');
  const [busy, setBusy] = useState(false);

  const needFrom = type === 'expense' || type === 'transfer' || type === 'saving';
  const needTo = type === 'income' || type === 'transfer' || type === 'saving';
  const needCategory = type !== 'transfer';
  const cats = categories.filter((c: any) => c.type === type);
  const fromAccount = accounts.find((a: any) => a.id === accountFrom);
  const toAccount = accounts.find((a: any) => a.id === accountTo);
  const selectedCategory = categories.find((c: any) => c.id === categoryId) as any;
  const salaryExpense = type === 'expense'
    && (selectedCategory?.key === 'salary' || (!selectedCategory && !!initial?.employeeId));
  const debtExpense = type === 'expense'
    && (selectedCategory?.key === 'debt' || (!selectedCategory && !!initial?.debtId));
  // Привязка к проекту — для дохода и для ОБЫЧНОГО расхода (не ЗП/долг, у них
  // своя привязка к сотруднику/долгу). Чтобы видеть траты по проекту внутри него.
  const showProject = type === 'income' || (type === 'expense' && !salaryExpense && !debtExpense);

  const amt = parseFloat(amount.replace(',', '.'));
  const valid = amt > 0 && (!needFrom || accountFrom) && (!needTo || accountTo) &&
    (!['transfer', 'saving'].includes(type) || accountFrom !== accountTo) &&
    (!salaryExpense || (!!employeeId && /^\d{4}-(0[1-9]|1[0-2])$/.test(salaryYm))) &&
    (!debtExpense || !!debtId);
  const dirty = initial
    ? type !== initial.type || date !== String(initial.date || '').slice(0, 10) || amount !== String(initial.amount)
      || categoryId !== (initial.categoryId ?? '') || accountFrom !== ((['transfer', 'saving'].includes(initial.type) ? initial.fromAccountId : initial.type === 'expense' ? initial.accountId : '') ?? '')
      || accountTo !== ((['transfer', 'saving'].includes(initial.type) ? (initial.toAccountId ?? initial.accountId) : initial.type !== 'expense' ? initial.accountId : '') ?? '')
      || projectId !== (initial.projectId ?? '') || employeeId !== (initial.employeeId ?? '')
      || debtId !== (initial.debtId ?? '') || salaryYm !== (initial.salaryYm || String(initial.date ?? '').slice(0, 7) || currentYm())
      || comment !== (initial.comment ?? '')
    : !!(amount || categoryId || accountFrom || accountTo || projectId || employeeId || debtId || comment);

  async function requestClose() {
    if (!dirty || await finConfirm('Закрыть форму? Несохранённые изменения будут потеряны.', {
      title: 'Несохранённые изменения', danger: true, confirmLabel: 'Закрыть без сохранения',
    })) onClose();
  }

  function selectCategory(nextId: string) {
    if (nextId === '__new__') {
      setAddingCat(true);
      return;
    }
    setCategoryId(nextId);
    const next = categories.find((c: any) => c.id === nextId) as any;
    if (next?.key !== 'salary') setEmployeeId('');
    if (next?.key !== 'debt') setDebtId('');
  }

  async function createCategory() {
    const name = newCatName.trim();
    if (!name) return;
    try {
      const c = await financeApi.createCategory({ name, type });
      qc.setQueryData(['finref', 'categories'], (old: any) => (old ? [...old, c] : [c]));
      invalidateFinanceAll(qc);
      if (c?.id) setCategoryId(c.id);
      setAddingCat(false);
      setNewCatName('');
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function save() {
    if (!valid || busy) return;
    // При редактировании пустые значения шлём как null (очистка поля), при создании — не шлём вовсе.
    const empty = initial ? null : undefined;
    const payload: any = {
      type,
      amount: amt,
      date,
      comment: comment.trim() || empty,
      categoryId: needCategory ? categoryId || empty : empty,
      projectId: showProject ? projectId || empty : empty,
      employeeId: salaryExpense ? employeeId : empty,
      salaryYm: salaryExpense ? salaryYm : empty,
      debtId: debtExpense ? debtId : empty,
    };
    if (type === 'transfer' || type === 'saving') {
      payload.fromAccountId = accountFrom;
      payload.toAccountId = accountTo;
      if (initial) payload.accountId = null;
    } else {
      payload.accountId = type === 'expense' ? accountFrom : accountTo;
      if (initial) { payload.fromAccountId = null; payload.toAccountId = null; }
    }
    setBusy(true);
    try {
      if (initial) await financeApi.updateTransaction(initial.id, payload);
      else await financeApi.createOperation(payload);
      invalidateFinance(qc);
      onClose();
    } catch (e: any) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinModal
      title={initial ? 'Изменить операцию' : 'Новая операция'}
      onClose={() => { void requestClose(); }}
      footer={<>
        <button className="btn ghost" onClick={() => { void requestClose(); }}>Отмена</button>
        <button className="btn primary" disabled={!valid || busy} onClick={save}>{initial ? 'Сохранить' : 'Добавить'}</button>
      </>}
    >
          <div className="type-tabs" role="group" aria-label="Тип операции">
            {TYPES.map((t) => (
              <button key={t} className={`type-tab t-${t}` + (type === t ? ' active' : '')}
                aria-pressed={type === t}
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
              <select value={categoryId} onChange={(e) => selectCategory(e.target.value)}>
                <option value="">— выбрать —</option>
                {cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">＋ Новая категория…</option>
              </select>
              {addingCat && (
                <div className="flex" style={{ marginTop: 6 }}>
                  <input autoFocus placeholder="Название категории" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); }} />
                  <button className="btn primary sm" disabled={!newCatName.trim()} onClick={createCategory}>Создать</button>
                  <button className="btn ghost sm" onClick={() => { setAddingCat(false); setNewCatName(''); }}><FinIcon name="close" size={14} /></button>
                </div>
              )}
              {type === 'expense' && <p className="mini muted" style={{ margin: '4px 0 0' }}>Новые категории (кроме ЗП/Аренды/Долгов) суммируются в «Прочее».</p>}
            </div>
          )}

          <div className="form-grid">
            {needFrom && (
              <div className="field"><label>{type === 'transfer' ? 'Со счёта' : 'Списать со счёта'}</label>
                <div className="fin-account-select form-control">
                  <AccountMark name={fromAccount?.name} color={fromAccount?.color} compact />
                  <select value={accountFrom} onChange={(e) => setAccountFrom(e.target.value)}>
                    <option value="">— выбрать —</option>
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
            )}
            {needTo && (
              <div className="field"><label>{type === 'transfer' ? 'На счёт' : 'Зачислить на счёт'}</label>
                <div className="fin-account-select form-control">
                  <AccountMark name={toAccount?.name} color={toAccount?.color} compact />
                  <select value={accountTo} onChange={(e) => setAccountTo(e.target.value)}>
                    <option value="">— выбрать —</option>
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {showProject && (
            <div className="field"><label>Проект / клиент (необязательно)</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">— не привязан —</option>
                {projects.filter((p: any) => !p.archived || p.id === projectId).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {salaryExpense && (
            <div className="form-grid">
              <div className="field"><label>Сотрудник</label>
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">— выбрать сотрудника —</option>
                  {employees.map((em: any) => <option key={em.id} value={em.id}>{em.name}</option>)}
                </select>
              </div>
              <div className="field"><label>За какой месяц начисление</label>
                <input type="month" value={salaryYm} onChange={(e) => setSalaryYm(e.target.value)} />
              </div>
            </div>
          )}
          {debtExpense && (
            <div className="field"><label>Долг</label>
                <select value={debtId} onChange={(e) => setDebtId(e.target.value)}>
                  <option value="">— выбрать долг —</option>
                  {debts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
            </div>
          )}

          <div className="field"><label>Комментарий</label>
            <input placeholder="Например: половина суммы контракта" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
    </FinModal>
  );
}
