// Настройки Fin System: счета, справочники, резервные копии.
// Порт fin-webrand/src/pages/Settings.tsx (Dexie → financeApi + react-query).
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { money, todayISO, INCOME_GROUPS, TYPE_LABEL, COLOR_PALETTE } from './finlib';
import FinIcon from './FinIcon';
import { financeApi } from '@/services/api.service';

function errMsg(e: any) {
  return e?.response?.data?.message || 'Ошибка';
}

export default function FinanceSettingsPage() {
  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery<any[]>({ queryKey: ['finance', 'accounts'], queryFn: () => financeApi.accounts() });
  const { data: balances } = useQuery<any>({ queryKey: ['finance', 'accounts-balances'], queryFn: () => financeApi.accountsBalances() });
  const { data: categories = [] } = useQuery<any[]>({ queryKey: ['finance', 'categories'], queryFn: () => financeApi.categories() });
  const { data: projects = [] } = useQuery<any[]>({ queryKey: ['finance', 'projects'], queryFn: () => financeApi.projects() });
  const { data: employees = [] } = useQuery<any[]>({ queryKey: ['finance', 'employees'], queryFn: () => financeApi.employees() });
  const { data: subs = [] } = useQuery<any[]>({ queryKey: ['finance', 'subscriptions'], queryFn: () => financeApi.subscriptions() });
  const { data: debts = [] } = useQuery<any[]>({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() });

  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<React.ReactNode>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['finance'] });

  function currentBalance(accountId: string): number {
    const row = balances?.perAccount?.find((p: any) => p.id === accountId);
    return row ? row.balance : 0;
  }

  async function saveStartBalance(a: any, raw: string) {
    const startBalance = parseFloat(raw) || 0;
    if (startBalance === Number(a.startBalance)) return;
    try {
      await financeApi.updateAccount(a.id, { startBalance });
      invalidate();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }

  async function exportData() {
    try {
      const dump = await financeApi.exportAll();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fin-system-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }

  async function importData(file: File) {
    let data: any;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast.error('Некорректный JSON-файл');
      return;
    }
    if (!confirm('Импорт полностью заменит все текущие данные. Продолжить?')) return;
    try {
      await financeApi.importAll(data);
      setMsg('Импортировано ✓');
      invalidate();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }

  async function resetAll() {
    if (!confirm('Удалить ВСЕ данные и пересоздать справочники? Необратимо.')) return;
    try {
      await financeApi.resetAll();
      invalidate();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }

  async function del(fn: () => Promise<any>) {
    try {
      await fn();
      invalidate();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }

  return (
    <div className="fin-root">
      <div className="page-head"><div><h1>Настройки</h1><p>Счета, справочники, резервные копии</p></div></div>

      <div className="section-title">Счета и стартовые балансы</div>
      <div className="card">
        <p className="mini muted" style={{ marginTop: 0 }}>Стартовый баланс = сколько было на счёте на момент запуска. Текущий = старт + операции.</p>
        <table>
          <thead><tr><th>Счёт</th><th className="num">Стартовый</th><th className="num">Текущий</th><th /></tr></thead>
          <tbody>
            {accounts.length === 0 && <tr><td colSpan={4} className="empty">Пусто</td></tr>}
            {accounts.map((a: any) => (
              <tr key={a.id}>
                <td><span className="dot" style={{ background: a.color }} /> <b style={{ marginLeft: 8 }}>{a.name}</b></td>
                <td className="num">
                  <input key={`${a.id}-${a.startBalance}`} className="cell-input" style={{ width: 140, textAlign: 'right' }}
                    type="number" inputMode="decimal" defaultValue={a.startBalance}
                    onBlur={(e) => saveStartBalance(a, e.target.value)} />
                </td>
                <td className="num"><b>{money(currentBalance(a.id))}</b></td>
                <td className="num"><span className="row-actions">
                  <button className="btn ghost sm" onClick={() => setModal(<AccountModal account={a} onClose={() => setModal(null)} />)}><FinIcon name="edit" size={15} /></button>
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setModal(<AccountModal onClose={() => setModal(null)} />)}><FinIcon name="plus" size={14} /> Счёт</button>
      </div>

      <Directory title="Категории" items={categories}
        head={['Название', 'Тип']}
        cols={(c: any) => [c.name, TYPE_LABEL[c.type] ?? c.type]}
        onAdd={() => setModal(<CategoryModal onClose={() => setModal(null)} />)}
        onEdit={(c: any) => setModal(<CategoryModal category={c} onClose={() => setModal(null)} />)}
        canDelete={(c: any) => !c.builtin}
        onDel={(c: any) => confirm('Удалить?') && del(() => financeApi.removeCategory(c.id))} />

      <Directory title="Проекты / клиенты" items={projects}
        head={['Название', 'Направление', 'Тариф']}
        cols={(p: any) => [p.name, INCOME_GROUPS.find((g) => g.key === p.direction)?.label ?? p.direction, money(p.tariff)]}
        onAdd={() => setModal(<ProjectModal onClose={() => setModal(null)} />)}
        onEdit={(p: any) => setModal(<ProjectModal project={p} onClose={() => setModal(null)} />)}
        onDel={(p: any) => confirm(`Удалить проект «${p.name}»? Удалятся его плановые оплаты и доходные операции.`) && del(() => financeApi.removeProject(p.id))} />

      <Directory title="Сотрудники" items={employees}
        head={['Имя', 'Роль', 'Оклад', 'Статус']}
        cols={(e: any) => [e.name, e.role || '—', money(e.salary), e.status === 'active' ? 'активный' : 'уволен']}
        onAdd={() => setModal(<EmployeeModal onClose={() => setModal(null)} />)}
        onEdit={(e: any) => setModal(<EmployeeModal employee={e} onClose={() => setModal(null)} />)}
        onDel={(e: any) => confirm('Удалить?') && del(() => financeApi.removeEmployee(e.id))} />

      <Directory title="Аренда и подписки" items={subs}
        head={['Название', 'Тип', 'Сумма/мес']}
        cols={(s: any) => [s.name, s.kind === 'rent' ? 'Аренда' : 'Подписка', money(s.amount)]}
        onAdd={() => setModal(<SubModal onClose={() => setModal(null)} />)}
        onEdit={(s: any) => setModal(<SubModal sub={s} onClose={() => setModal(null)} />)}
        onDel={(s: any) => confirm('Удалить?') && del(() => financeApi.removeSubscription(s.id))} />

      <Directory title="Долги" items={debts}
        head={['Название', 'Сумма', 'Платёж/мес']}
        cols={(d: any) => [d.name, money(d.totalAmount), d.monthlyPayment ? money(d.monthlyPayment) : '—']}
        onAdd={() => setModal(<DebtModal onClose={() => setModal(null)} />)}
        onEdit={(d: any) => setModal(<DebtModal debt={d} onClose={() => setModal(null)} />)}
        onDel={(d: any) => confirm('Удалить?') && del(() => financeApi.removeDebt(d.id))} />

      <div className="section-title">Резервная копия</div>
      <div className="card flex" style={{ gap: 12 }}>
        <button className="btn" onClick={exportData}><FinIcon name="download" size={16} /> Экспорт JSON</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><FinIcon name="upload" size={16} /> Импорт JSON</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ''; }} />
        {msg && <span className="pos mini">{msg}</span>}
      </div>

      <div className="section-title">Опасная зона</div>
      <div className="card"><button className="btn danger" onClick={resetAll}>Сбросить все данные</button></div>

      {modal}
    </div>
  );
}

function Directory({ title, items, head, cols, onAdd, onEdit, onDel, canDelete }: {
  title: string; items: any[]; head: string[]; cols: (x: any) => (string | number)[];
  onAdd: () => void; onEdit: (x: any) => void; onDel: (x: any) => void; canDelete?: (x: any) => boolean;
}) {
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="table-wrap">
        <table>
          <thead><tr>{head.map((h, i) => <th key={i} className={i > 0 ? 'num' : ''}>{h}</th>)}<th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={head.length + 1} className="empty">Пусто</td></tr>}
            {items.map((it: any) => (
              <tr key={it.id} onDoubleClick={() => onEdit(it)}>
                {cols(it).map((c, i) => <td key={i} className={i > 0 ? 'num' : ''}>{i === 0 ? <b>{c}</b> : c}</td>)}
                <td className="num"><span className="row-actions">
                  <button className="btn ghost sm" onClick={() => onEdit(it)}><FinIcon name="edit" size={15} /></button>
                  {(!canDelete || canDelete(it)) && (
                    <button className="btn ghost sm danger" onClick={() => onDel(it)}><FinIcon name="trash" size={15} /></button>
                  )}
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn sm" style={{ marginTop: 12, marginBottom: 4 }} onClick={onAdd}><FinIcon name="plus" size={14} /> Добавить</button>
    </>
  );
}

function Modal({ title, onClose, onSave, canSave, children }: {
  title: string; onClose: () => void; onSave: () => void; canSave: boolean; children: React.ReactNode;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!canSave} onClick={onSave}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function Palette({ color, setColor }: { color: string; setColor: (c: string) => void }) {
  return (
    <div className="field"><label>Цвет</label>
      <div className="flex" style={{ flexWrap: 'wrap' }}>
        {COLOR_PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)}
            style={{ width: 26, height: 26, borderRadius: 7, background: c, cursor: 'pointer', border: color === c ? '2px solid #16191d' : '2px solid transparent' }} />
        ))}
      </div>
    </div>
  );
}

function AccountModal({ account, onClose }: { account?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState(account?.kind ?? 'bank');
  const [color, setColor] = useState(account?.color ?? COLOR_PALETTE[0]);
  async function save() {
    try {
      const p = { name: name.trim(), kind, color };
      if (account) await financeApi.updateAccount(account.id, p);
      else await financeApi.createAccount({ ...p, startBalance: 0 });
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Modal title={account ? 'Счёт' : 'Новый счёт'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Тип</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="bank">Банк</option><option value="cash">Наличные</option><option value="savings">Накопления</option>
        </select>
      </div>
      <Palette color={color} setColor={setColor} />
    </Modal>
  );
}

function CategoryModal({ category, onClose }: { category?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [type, setType] = useState(category?.type ?? 'expense');
  const [color, setColor] = useState(category?.color ?? COLOR_PALETTE[4]);
  async function save() {
    try {
      const p = { name: name.trim(), type, color };
      if (category) await financeApi.updateCategory(category.id, p);
      else await financeApi.createCategory(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Modal title={category ? 'Категория' : 'Новая категория'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Реклама, Транспорт, Налоги…" /></div>
      <div className="field"><label>Тип</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="income">Доход</option><option value="expense">Расход</option>
          <option value="saving">Накопление</option>
        </select>
      </div>
      <Palette color={color} setColor={setColor} />
    </Modal>
  );
}

function ProjectModal({ project, onClose }: { project?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project?.name ?? '');
  const [direction, setDirection] = useState(project?.direction ?? 'smm');
  const [tariff, setTariff] = useState(String(project?.tariff ?? ''));
  const [contractDate, setContractDate] = useState(project?.contractDate ?? '');
  const [multiMonth, setMultiMonth] = useState(!!project?.multiMonth);
  const [status, setStatus] = useState(project?.status ?? 'active');
  async function save() {
    try {
      const p = {
        name: name.trim(), direction, tariff: parseFloat(tariff) || 0,
        contractDate: contractDate || null,
        multiMonth: direction === 'design' ? multiMonth : false,
        status,
      };
      if (project) await financeApi.updateProject(project.id, p);
      else await financeApi.createProject(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Modal title={project ? 'Проект' : 'Новый проект'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Направление</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            {INCOME_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Тариф / сумма</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Дата контракта</label><input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></div>
        <div className="field"><label>Статус</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="lead">Лид</option><option value="active">Активный</option><option value="done">Завершён</option>
            {status === 'archived' && <option value="archived">Архив</option>}
          </select>
        </div>
      </div>
      {direction === 'design' && (
        <label className="flex" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={multiMonth} onChange={(e) => setMultiMonth(e.target.checked)} style={{ width: 'auto' }} />
          Брендбук / логобук — оплата по месяцам
        </label>
      )}
    </Modal>
  );
}

function EmployeeModal({ employee, onClose }: { employee?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(employee?.name ?? '');
  const [role, setRole] = useState(employee?.role ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '');
  const [salary, setSalary] = useState(String(employee?.salary ?? ''));
  const [advance, setAdvance] = useState(String(employee?.advance ?? 0));
  const [status, setStatus] = useState(employee?.status ?? 'active');
  async function save() {
    try {
      const p = {
        name: name.trim(), role: role.trim() || null, hireDate: hireDate || null,
        salary: parseFloat(salary) || 0, advance: parseFloat(advance) || 0, status,
      };
      if (employee) await financeApi.updateEmployee(employee.id, p);
      else await financeApi.createEmployee(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Modal title={employee ? 'Сотрудник' : 'Новый сотрудник'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>ФИО</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Должность</label><input value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div className="field"><label>Дата приёма</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>ЗП / мес</label><input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
        <div className="field"><label>Аванс</label><input inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} /></div>
      </div>
      <div className="field"><label>Статус</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Работает</option><option value="fired">Уволен</option>
        </select>
      </div>
    </Modal>
  );
}

function SubModal({ sub, onClose }: { sub?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(sub?.name ?? '');
  const [kind, setKind] = useState(sub?.kind ?? 'subscription');
  const [amount, setAmount] = useState(String(sub?.amount ?? ''));
  async function save() {
    try {
      const p = { name: name.trim(), kind, amount: parseFloat(amount) || 0 };
      if (sub) await financeApi.updateSubscription(sub.id, p);
      else await financeApi.createSubscription(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Modal title={sub ? 'Позиция' : 'Новая позиция'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Тип</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="rent">Аренда</option><option value="subscription">Подписка</option>
          </select>
        </div>
        <div className="field"><label>Сумма / мес</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function DebtModal({ debt, onClose }: { debt?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(debt?.name ?? '');
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? '');
  const [monthly, setMonthly] = useState(String(debt?.monthlyPayment ?? ''));
  const [total, setTotal] = useState(String(debt?.totalAmount ?? ''));
  const [paidBefore, setPaidBefore] = useState(String(debt?.paidBefore ?? 0));
  async function save() {
    try {
      const p = {
        name: name.trim(), counterparty: counterparty.trim() || null,
        monthlyPayment: parseFloat(monthly) || null,
        totalAmount: parseFloat(total) || 0, paidBefore: parseFloat(paidBefore) || 0,
      };
      if (debt) await financeApi.updateDebt(debt.id, p);
      else await financeApi.createDebt(p);
      qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e: any) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Modal title={debt ? 'Долг' : 'Новый долг'} onClose={onClose} onSave={save} canSave={!!name.trim()}>
      <div className="field"><label>Наименование</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Контрагент</label><input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></div>
        <div className="field"><label>Платёж / мес</label><input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Сумма долга</label><input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
        <div className="field"><label>Погашено до старта</label><input inputMode="decimal" value={paidBefore} onChange={(e) => setPaidBefore(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
