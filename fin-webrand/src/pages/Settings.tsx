import { useRef, useState } from 'react';
import {
  useAccounts, useTransactions, useClients, useEmployees, useSubscriptions, useDebts, useCategories,
} from '../state/data';
import { accountBalance } from '../lib/calc';
import { INCOME_GROUPS, TYPE_LABEL } from '../lib/constants';
import { db, uid } from '../db/db';
import type { Account, Category, Client, Employee, Subscription, Debt, IncomeGroup, TxType } from '../db/types';
import { money } from '../lib/format';
import Icon from '../components/Icon';

const TABLES = ['accounts', 'categories', 'transactions', 'clients', 'plannedPayments', 'employees', 'subscriptions', 'debts', 'meta'] as const;
const PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#6366f1'];

export default function Settings() {
  const accounts = useAccounts();
  const txns = useTransactions();
  const clients = useClients();
  const employees = useEmployees();
  const subs = useSubscriptions();
  const debts = useDebts();
  const categories = useCategories();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<React.ReactNode>(null);

  async function exportData() {
    const dump: Record<string, unknown> = {};
    for (const t of TABLES) dump[t] = await (db as never as Record<string, { toArray(): Promise<unknown> }>)[t].toArray();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fin-system-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  async function importData(file: File) {
    const data = JSON.parse(await file.text());
    await db.transaction('rw', db.tables, async () => {
      for (const t of TABLES) {
        if (!data[t]) continue;
        await (db as never as Record<string, { clear(): Promise<void>; bulkAdd(x: unknown[]): Promise<unknown> }>)[t].clear();
        await (db as never as Record<string, { bulkAdd(x: unknown[]): Promise<unknown> }>)[t].bulkAdd(data[t]);
      }
    });
    setMsg('Импортировано ✓');
  }

  async function resetAll() {
    if (!confirm('Удалить ВСЕ данные и пересоздать справочники? Необратимо.')) return;
    await db.delete();
    location.reload();
  }

  return (
    <>
      <div className="page-head"><div><h1>Настройки</h1><p>Счета, справочники, резервные копии</p></div></div>

      <div className="section-title">Счета и стартовые балансы</div>
      <div className="card">
        <p className="mini muted" style={{ marginTop: 0 }}>Стартовый баланс = сколько было на счёте на момент запуска. Текущий = старт + операции.</p>
        <table>
          <thead><tr><th>Счёт</th><th className="num">Стартовый</th><th className="num">Текущий</th><th /></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td><span className="dot" style={{ background: a.color }} /> <b style={{ marginLeft: 8 }}>{a.name}</b></td>
                <td className="num"><input style={{ width: 140, textAlign: 'right' }} inputMode="decimal" defaultValue={a.openingBalance}
                  onBlur={(e) => db.accounts.update(a.id, { openingBalance: parseFloat(e.target.value) || 0 })} /></td>
                <td className="num"><b>{money(accountBalance(a, txns))}</b></td>
                <td className="num"><span className="row-actions">
                  <button className="btn ghost sm" onClick={() => setModal(<AccountModal account={a} order={accounts.length} onClose={() => setModal(null)} />)}><Icon name="edit" size={15} /></button>
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setModal(<AccountModal order={accounts.length} onClose={() => setModal(null)} />)}><Icon name="plus" size={14} /> Счёт</button>
      </div>

      <Directory title="Категории" items={categories}
        cols={(c: Category) => [c.name, TYPE_LABEL[c.kind]]}
        head={['Название', 'Тип']}
        onAdd={() => setModal(<CategoryModal order={categories.length} onClose={() => setModal(null)} />)}
        onEdit={(c) => setModal(<CategoryModal category={c as Category} order={categories.length} onClose={() => setModal(null)} />)}
        onDel={(c) => db.categories.delete((c as Category).id)} />

      <Directory title="Проекты / клиенты" items={clients}
        cols={(c: Client) => [c.name, INCOME_GROUPS.find((g) => g.key === c.group)?.label ?? c.group, money(c.tariff)]}
        head={['Название', 'Направление', 'Тариф']}
        onAdd={() => setModal(<ClientModal onClose={() => setModal(null)} />)}
        onEdit={(c) => setModal(<ClientModal client={c as Client} onClose={() => setModal(null)} />)}
        onDel={(c) => db.clients.delete((c as Client).id)} />

      <Directory title="Сотрудники" items={employees}
        cols={(e: Employee) => [e.name, e.role ?? '—', money(e.salary), e.status === 'active' ? 'активный' : 'уволен']}
        head={['Имя', 'Роль', 'Оклад', 'Статус']}
        onAdd={() => setModal(<EmployeeModal onClose={() => setModal(null)} />)}
        onEdit={(e) => setModal(<EmployeeModal employee={e as Employee} onClose={() => setModal(null)} />)}
        onDel={(e) => db.employees.delete((e as Employee).id)} />

      <Directory title="Аренда и подписки" items={subs}
        cols={(s: Subscription) => [s.name, s.kind === 'rent' ? 'Аренда' : 'Подписка', money(s.amount)]}
        head={['Название', 'Тип', 'Сумма/мес']}
        onAdd={() => setModal(<SubModal onClose={() => setModal(null)} />)}
        onEdit={(s) => setModal(<SubModal sub={s as Subscription} onClose={() => setModal(null)} />)}
        onDel={(s) => db.subscriptions.delete((s as Subscription).id)} />

      <Directory title="Долги" items={debts}
        cols={(d: Debt) => [d.name, money(d.totalAmount), d.monthlyPayment ? money(d.monthlyPayment) : '—']}
        head={['Название', 'Сумма', 'Платёж/мес']}
        onAdd={() => setModal(<DebtModal onClose={() => setModal(null)} />)}
        onEdit={(d) => setModal(<DebtModal debt={d as Debt} onClose={() => setModal(null)} />)}
        onDel={(d) => db.debts.delete((d as Debt).id)} />

      <div className="section-title">Резервная копия</div>
      <div className="card flex" style={{ gap: 12 }}>
        <button className="btn" onClick={exportData}><Icon name="download" size={16} /> Экспорт JSON</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> Импорт JSON</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
        {msg && <span className="pos mini">{msg}</span>}
      </div>

      <div className="section-title">Опасная зона</div>
      <div className="card"><button className="btn danger" onClick={resetAll}>Сбросить все данные</button></div>

      {modal}
    </>
  );
}

function Directory<T extends { id: string }>({ title, items, head, cols, onAdd, onEdit, onDel }: {
  title: string; items: T[]; head: string[]; cols: (x: T) => (string | number)[];
  onAdd: () => void; onEdit: (x: T) => void; onDel: (x: T) => void;
}) {
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="table-wrap">
        <table>
          <thead><tr>{head.map((h, i) => <th key={i} className={i > 0 ? 'num' : ''}>{h}</th>)}<th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={head.length + 1} className="empty">Пусто</td></tr>}
            {items.map((it) => (
              <tr key={it.id} onDoubleClick={() => onEdit(it)}>
                {cols(it).map((c, i) => <td key={i} className={i > 0 ? 'num' : ''}>{i === 0 ? <b>{c}</b> : c}</td>)}
                <td className="num"><span className="row-actions">
                  <button className="btn ghost sm" onClick={() => onEdit(it)}><Icon name="edit" size={15} /></button>
                  <button className="btn ghost sm danger" onClick={() => confirm('Удалить?') && onDel(it)}><Icon name="trash" size={15} /></button>
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn sm" style={{ marginTop: 12, marginBottom: 4 }} onClick={onAdd}><Icon name="plus" size={14} /> Добавить</button>
    </>
  );
}

function Modal({ title, onClose, onSave, canSave, children }: {
  title: string; onClose: () => void; onSave: () => void; canSave: boolean; children: React.ReactNode;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!canSave} onClick={onSave}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function CategoryModal({ category, order, onClose }: { category?: Category; order: number; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<TxType>(category?.kind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? PALETTE[4]);
  const defaultIcon = (k: TxType) => (k === 'income' ? 'income' : k === 'expense' ? 'expense' : k === 'transfer' ? 'transactions' : 'income');
  async function save() {
    const p = { name: name.trim(), kind, color, icon: category?.icon ?? defaultIcon(kind) };
    if (category) await db.categories.update(category.id, p);
    else await db.categories.add({ id: uid(), order, ...p });
    onClose();
  }
  return (
    <Modal title={category ? 'Категория' : 'Новая категория'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Реклама, Транспорт, Налоги…" /></div>
      <div className="field"><label>Тип</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as TxType)}>
          <option value="income">Доход</option><option value="expense">Расход</option>
          <option value="transfer">Перевод</option><option value="saving">Накопление</option>
        </select>
      </div>
      <div className="field"><label>Цвет</label>
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          {PALETTE.map((c) => <button key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: 7, background: c, border: color === c ? '2px solid #16191d' : '2px solid transparent' }} />)}
        </div>
      </div>
    </Modal>
  );
}

function AccountModal({ account, order, onClose }: { account?: Account; order: number; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<Account['kind']>(account?.kind ?? 'bank');
  const [color, setColor] = useState(account?.color ?? PALETTE[0]);
  async function save() {
    const p = { name: name.trim(), kind, color, openingBalance: account?.openingBalance ?? 0 };
    if (account) await db.accounts.update(account.id, p); else await db.accounts.add({ id: uid(), order, ...p });
    onClose();
  }
  return (
    <Modal title={account ? 'Счёт' : 'Новый счёт'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Тип</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as Account['kind'])}>
          <option value="bank">Банк</option><option value="cash">Наличные</option><option value="savings">Накопления</option>
        </select>
      </div>
      <div className="field"><label>Цвет</label>
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          {PALETTE.map((c) => <button key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: 7, background: c, border: color === c ? '2px solid #16191d' : '2px solid transparent' }} />)}
        </div>
      </div>
    </Modal>
  );
}

function ClientModal({ client, onClose }: { client?: Client; onClose: () => void }) {
  const [name, setName] = useState(client?.name ?? '');
  const [group, setGroup] = useState<IncomeGroup>(client?.group ?? 'smm');
  const [tariff, setTariff] = useState(String(client?.tariff ?? ''));
  const [contractDate, setContractDate] = useState(client?.contractDate ?? '');
  const [multiMonth, setMultiMonth] = useState(client?.multiMonth ?? false);
  const [status, setStatus] = useState<Client['status']>(client?.status ?? 'active');
  async function save() {
    const p = { name: name.trim(), group, tariff: parseFloat(tariff) || 0, contractDate: contractDate || undefined, multiMonth: group === 'design' ? multiMonth : undefined, status };
    if (client) await db.clients.update(client.id, p); else await db.clients.add({ id: uid(), ...p });
    onClose();
  }
  return (
    <Modal title={client ? 'Проект' : 'Новый проект'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Направление</label>
          <select value={group} onChange={(e) => setGroup(e.target.value as IncomeGroup)}>
            {INCOME_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Тариф / сумма</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Дата контракта</label><input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></div>
        <div className="field"><label>Статус</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Client['status'])}>
            <option value="lead">Лид</option><option value="active">Активный</option><option value="done">Завершён</option>
          </select>
        </div>
      </div>
      {group === 'design' && (
        <label className="flex" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={multiMonth} onChange={(e) => setMultiMonth(e.target.checked)} style={{ width: 'auto' }} />
          Брендбук / логобук — оплата по месяцам
        </label>
      )}
    </Modal>
  );
}

function EmployeeModal({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const [name, setName] = useState(employee?.name ?? '');
  const [salary, setSalary] = useState(String(employee?.salary ?? ''));
  const [advance, setAdvance] = useState(String(employee?.advance ?? 0));
  const [role, setRole] = useState(employee?.role ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '');
  const [status, setStatus] = useState<Employee['status']>(employee?.status ?? 'active');
  async function save() {
    const p = { name: name.trim(), salary: parseFloat(salary) || 0, advance: parseFloat(advance) || 0, role: role.trim() || undefined, hireDate: hireDate || undefined, status };
    if (employee) await db.employees.update(employee.id, p); else await db.employees.add({ id: uid(), ...p });
    onClose();
  }
  return (
    <Modal title={employee ? 'Сотрудник' : 'Новый сотрудник'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>ФИО</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Должность</label><input value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div className="field"><label>Дата приёма</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Оклад / мес</label><input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
        <div className="field"><label>Аванс</label><input inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} /></div>
      </div>
      <div className="field"><label>Статус</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as Employee['status'])}>
          <option value="active">Активный</option><option value="fired">Уволен</option>
        </select>
      </div>
    </Modal>
  );
}

function SubModal({ sub, onClose }: { sub?: Subscription; onClose: () => void }) {
  const [name, setName] = useState(sub?.name ?? '');
  const [amount, setAmount] = useState(String(sub?.amount ?? ''));
  const [kind, setKind] = useState<Subscription['kind']>(sub?.kind ?? 'subscription');
  async function save() {
    const p = { name: name.trim(), amount: parseFloat(amount) || 0, kind, active: sub?.active ?? true, accountId: sub?.accountId };
    if (sub) await db.subscriptions.update(sub.id, p); else await db.subscriptions.add({ id: uid(), ...p });
    onClose();
  }
  return (
    <Modal title={sub ? 'Позиция' : 'Новая позиция'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Тип</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as Subscription['kind'])}>
            <option value="rent">Аренда</option><option value="subscription">Подписка</option>
          </select>
        </div>
        <div className="field"><label>Сумма / мес</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function DebtModal({ debt, onClose }: { debt?: Debt; onClose: () => void }) {
  const [name, setName] = useState(debt?.name ?? '');
  const [total, setTotal] = useState(String(debt?.totalAmount ?? ''));
  const [paidBefore, setPaidBefore] = useState(String(debt?.paidBefore ?? 0));
  const [monthly, setMonthly] = useState(String(debt?.monthlyPayment ?? ''));
  async function save() {
    const p = { name: name.trim(), totalAmount: parseFloat(total) || 0, paidBefore: parseFloat(paidBefore) || 0, monthlyPayment: parseFloat(monthly) || undefined };
    if (debt) await db.debts.update(debt.id, p); else await db.debts.add({ id: uid(), ...p });
    onClose();
  }
  return (
    <Modal title={debt ? 'Долг' : 'Новый долг'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Сумма долга</label><input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
        <div className="field"><label>Погашено до старта</label><input inputMode="decimal" value={paidBefore} onChange={(e) => setPaidBefore(e.target.value)} /></div>
      </div>
      <div className="field"><label>Платёж / мес</label><input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></div>
    </Modal>
  );
}
