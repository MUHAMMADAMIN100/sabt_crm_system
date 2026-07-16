// Общие формы справочников «Финансов»: Проект, Сотрудник, Аренда/подписка, Долг.
// Раньше жили в двух расходящихся копиях (страницы направлений + Настройки).
// Все формы: FinModal (Escape/фокус/aria), busy-guard от даблкликов, apiErr.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiErr, todayISO, INCOME_GROUPS } from './finlib';
import { FinModal, finConfirm, invalidateFinanceAll } from './FinKit';
import type { FinProject, FinEmployee, FinSubscription, FinDebt } from './types';
import { financeApi } from '@/services/api.service';

const num = (s: string) => parseFloat(String(s).replace(',', '.')) || 0;

/** Кнопка «Удалить» в футере формы (только при редактировании). */
function DeleteButton({ label, confirmText, busy, onDelete }: {
  label?: string; confirmText: string; busy: boolean; onDelete: () => void;
}) {
  return (
    <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy}
      onClick={async () => { if (await finConfirm(confirmText, { danger: true, confirmLabel: 'Удалить' })) onDelete(); }}>
      {label ?? 'Удалить'}
    </button>
  );
}

/** Проект/клиент. direction без возможности смены — со страниц направлений. */
export function ProjectFormModal({ project, direction, onClose }: {
  project?: FinProject; direction?: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!project;
  const [name, setName] = useState(project?.name ?? '');
  const [dir, setDir] = useState(project?.direction ?? direction ?? 'smm');
  const [tariff, setTariff] = useState(project != null ? String(project.tariff ?? '') : '');
  // Со страницы направления новый проект чаще заводят в день подписания.
  const [contractDate, setContractDate] = useState(project ? (project.contractDate ?? '') : (direction ? todayISO() : ''));
  const [multiMonth, setMultiMonth] = useState(!!project?.multiMonth);
  const [status, setStatus] = useState(project?.status ?? 'active');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p: any = {
        name: name.trim(), direction: dir, tariff: num(tariff),
        contractDate: contractDate || null,
        multiMonth: dir === 'design' ? multiMonth : false,
        status,
      };
      if (isEdit) await financeApi.updateProject(project.id, p);
      else await financeApi.createProject(p);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  const dirLocked = !!direction;
  return (
    <FinModal title={isEdit ? 'Проект' : 'Новый проект'} onClose={onClose} width={460}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Направление</label>
          <select value={dir} disabled={dirLocked} onChange={(e) => setDir(e.target.value)}>
            {INCOME_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Тариф / сумма</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Дата контракта</label><input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></div>
        <div className="field"><label>Статус</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="lead">Лид</option><option value="active">Активный</option>
            <option value="paused">На паузе</option><option value="done">Завершён</option>
            {status === 'archived' && <option value="archived">Архив</option>}
          </select>
        </div>
      </div>
      {dir === 'design' && (
        <label className="flex" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={multiMonth} onChange={(e) => setMultiMonth(e.target.checked)} style={{ width: 'auto' }} />
          Брендбук / логобук — оплата по месяцам
        </label>
      )}
    </FinModal>
  );
}

/** Сотрудник; categories — существующие группы ЗП для подсказки. */
export function EmployeeFormModal({ employee, categories = [], onClose }: {
  employee?: FinEmployee; categories?: string[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!employee;
  const [name, setName] = useState(employee?.name ?? '');
  const [role, setRole] = useState(employee?.role ?? '');
  const [category, setCategory] = useState(employee?.category ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '');
  const [salary, setSalary] = useState(employee != null ? String(employee.salary ?? '') : '');
  const [status, setStatus] = useState<string>(employee?.status ?? 'active');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      // Аванс из формы убран: авансы теперь помесячные — правятся прямо в
      // зарплатной ведомости за конкретный месяц.
      const p = {
        name: name.trim(), role: role.trim() || null, category: category.trim() || null,
        hireDate: hireDate || null, salary: num(salary), status,
      };
      if (isEdit) await financeApi.updateEmployee(employee.id, p);
      else await financeApi.createEmployee(p);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!employee || busy) return;
    setBusy(true);
    try {
      await financeApi.removeEmployee(employee.id);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={isEdit ? 'Сотрудник' : 'Новый сотрудник'} onClose={onClose} width={460}
      footer={<>
        {isEdit && <DeleteButton confirmText={`Удалить сотрудника «${employee!.name}»? Его зарплатные операции останутся в журнале.`} busy={busy} onDelete={remove} />}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="field"><label>ФИО</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Должность</label><input value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div className="field"><label>Группа (категория ЗП)</label>
          <input list="fin-emp-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="SMM, Продажи…" />
          <datalist id="fin-emp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <div className="form-grid">
        <div className="field"><label>ЗП / мес</label><input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
        <div className="field"><label>Аванс</label><input disabled value="" placeholder="помесячно — в ведомости" title="Авансы теперь указываются за конкретный месяц прямо в зарплатной таблице" /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Дата приёма</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
        <div className="field"><label>Статус</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Работает</option><option value="fired">Уволен</option>
          </select>
        </div>
      </div>
    </FinModal>
  );
}

/** Аренда или подписка; dueDay — день оплаты для напоминаний. */
export function SubFormModal({ sub, onClose }: { sub?: FinSubscription; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!sub;
  const [name, setName] = useState(sub?.name ?? '');
  const [kind, setKind] = useState<string>(sub?.kind ?? 'subscription');
  const [amount, setAmount] = useState(sub != null ? String(sub.amount ?? '') : '');
  const [dueDay, setDueDay] = useState(sub?.dueDay ? String(sub.dueDay) : '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const day = Math.round(num(dueDay));
      const p = {
        name: name.trim(), kind, amount: num(amount), active: sub?.active ?? true,
        dueDay: day >= 1 && day <= 31 ? day : null,
      };
      if (isEdit) await financeApi.updateSubscription(sub.id, p);
      else await financeApi.createSubscription(p);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!sub || busy) return;
    setBusy(true);
    try {
      await financeApi.removeSubscription(sub.id);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={isEdit ? 'Позиция' : 'Новая позиция'} onClose={onClose} width={440}
      footer={<>
        {isEdit && <DeleteButton confirmText={`Удалить «${sub!.name}»?`} busy={busy} onDelete={remove} />}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Тип</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="rent">Аренда</option><option value="subscription">Подписка</option>
          </select>
        </div>
        <div className="field"><label>Сумма / мес</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
      <div className="field">
        <label>День оплаты (1–31)</label>
        <input inputMode="numeric" placeholder="пусто — без напоминаний" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
      </div>
    </FinModal>
  );
}

/** Долг. */
export function DebtFormModal({ debt, onClose }: { debt?: FinDebt; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!debt;
  const [name, setName] = useState(debt?.name ?? '');
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? '');
  const [totalAmount, setTotalAmount] = useState(debt != null ? String(debt.totalAmount ?? '') : '');
  const [monthlyPayment, setMonthlyPayment] = useState(debt?.monthlyPayment ? String(debt.monthlyPayment) : '');
  const [paidBefore, setPaidBefore] = useState(String(debt?.paidBefore ?? 0));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = {
        name: name.trim(), counterparty: counterparty.trim() || null,
        totalAmount: num(totalAmount), monthlyPayment: num(monthlyPayment) || null,
        paidBefore: num(paidBefore),
      };
      if (isEdit) await financeApi.updateDebt(debt.id, p);
      else await financeApi.createDebt(p);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!debt || busy) return;
    setBusy(true);
    try {
      await financeApi.removeDebt(debt.id);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={isEdit ? 'Долг' : 'Новый долг'} onClose={onClose} width={460}
      footer={<>
        {isEdit && <DeleteButton confirmText={`Удалить долг «${debt!.name}»? График платежей будет удалён.`} busy={busy} onDelete={remove} />}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="field"><label>Наименование</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Контрагент</label><input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></div>
        <div className="field"><label>Платёж / мес</label><input inputMode="decimal" value={monthlyPayment} onChange={(e) => setMonthlyPayment(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Сумма долга</label><input inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} /></div>
        <div className="field"><label>Погашено до старта</label><input inputMode="decimal" value={paidBefore} onChange={(e) => setPaidBefore(e.target.value)} /></div>
      </div>
    </FinModal>
  );
}
