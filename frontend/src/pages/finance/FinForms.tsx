// Общие формы справочников «Финансов»: Проект, Сотрудник, Аренда/подписка, Долг.
// Раньше жили в двух расходящихся копиях (страницы направлений + Настройки).
// Все формы: FinModal (Escape/фокус/aria), busy-guard от даблкликов, apiErr.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiErr, todayISO, currentYm, monthLabel, money, INCOME_GROUPS } from './finlib';
import { FinModal, finConfirm, invalidateFinanceAll } from './FinKit';
import type { FinProject, FinEmployee, FinSubscription, FinDebt } from './types';
import { financeApi, usersApi } from '@/services/api.service';

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
  // Ориентировочный срок сотрудничества (мес.). '' = «Бессрочно». Новый проект — 6.
  const [retentionMonths, setRetentionMonths] = useState<string>(
    project ? (project.retentionMonths != null ? String(project.retentionMonths) : '') : '6');
  const [status, setStatus] = useState(project?.status ?? 'active');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const recurring = dir === 'smm' || dir === 'maintenance';
      const p: any = {
        name: name.trim(), direction: dir, tariff: num(tariff),
        contractDate: contractDate || null,
        multiMonth: dir === 'design' ? multiMonth : false,
        retentionMonths: recurring ? (retentionMonths === '' ? null : Number(retentionMonths)) : null,
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
      {(dir === 'smm' || dir === 'maintenance') && (
        <div className="field"><label>Ориентировочно работаем</label>
          <select value={retentionMonths} onChange={(e) => setRetentionMonths(e.target.value)}>
            <option value="3">3 месяца</option>
            <option value="6">6 месяцев</option>
            <option value="12">12 месяцев</option>
            <option value="24">24 месяца</option>
            <option value="">Бессрочно</option>
          </select>
          <span className="mini muted">На этот срок планируем будущий доход в календаре (по тарифу, на день оплаты). «Бессрочно» — на 12 мес. вперёд.</span>
        </div>
      )}
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
export function EmployeeFormModal({ employee, initial, categories = [], onClose }: {
  employee?: FinEmployee;
  /** Заготовка новой строки: имя и аккаунт уже известны (из «Не видят свою зарплату»). */
  initial?: { name?: string; userId?: string; role?: string };
  categories?: string[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!employee;
  const [name, setName] = useState(employee?.name ?? initial?.name ?? '');
  const [role, setRole] = useState(employee?.role ?? initial?.role ?? '');
  // Учётная запись: по ней сотрудник видит свою зарплату в личном профиле.
  // Без привязки строка ведомости ничья — в профиле ЗП не появится.
  const [userId, setUserId] = useState(employee?.userId ?? initial?.userId ?? '');
  const { data: crmUsers } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });
  const [category, setCategory] = useState(employee?.category ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '');
  const [terminationDate, setTerminationDate] = useState(employee?.terminationDate ?? '');
  const [salary, setSalary] = useState(employee != null ? String(employee.salary ?? '') : '');
  const [salaryEffectiveYm, setSalaryEffectiveYm] = useState(currentYm());
  // План будущих окладов: строки на месяцы позже текущего. Инициализируем
  // из salaryHistory (будущие записи), сортируя по возрастанию месяца.
  const [plannedRows, setPlannedRows] = useState<{ ym: string; amount: string }[]>(() =>
    Object.entries(employee?.salaryHistory || {})
      .filter(([ym]) => ym > currentYm())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, amount]) => ({ ym, amount: String(amount) })),
  );
  const [status, setStatus] = useState<string>(employee?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const invalidEmploymentDates = !!terminationDate && !!hireDate && terminationDate < hireDate;

  const cur = currentYm();
  // Минимально допустимый месяц плана — следующий за текущим.
  const nextYm = (() => {
    const [y, m] = cur.split('-').map(Number);
    const d = new Date(y, m, 1); // m — 1-based; месяц в Date 0-based → следующий месяц
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  // Валидация плана: заполненные строки должны быть будущими, без повторов, сумма > 0.
  const plannedIssue = (() => {
    const seen = new Set<string>();
    for (const r of plannedRows) {
      if (!r.ym && !r.amount) continue;
      if (!r.ym) return 'Выберите месяц для запланированного оклада.';
      if (r.ym <= cur) return 'Планировать можно только будущие месяцы.';
      if (seen.has(r.ym)) return 'Месяц не должен повторяться.';
      seen.add(r.ym);
      if (num(r.amount) <= 0) return 'Сумма должна быть больше нуля.';
    }
    return '';
  })();

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      // Аванс из формы убран: авансы теперь помесячные — правятся прямо в
      // зарплатной ведомости за конкретный месяц.
      const salaryChanged = !isEdit || num(salary) !== Number(employee?.salary || 0);
      const p: any = {
        name: name.trim(), role: role.trim() || null, category: category.trim() || null,
        userId: userId || null,
        hireDate: hireDate || null,
        terminationDate: status === 'fired' ? terminationDate || null : null,
        salary: num(salary), status,
      };
      if (salaryChanged) p.salaryEffectiveYm = salaryEffectiveYm;
      // План будущих окладов — отправляем полный набор будущих месяцев
      // (пустой = очистить план). Бэкенд заменяет ими будущие ставки.
      const plannedSalaries: Record<string, number> = {};
      for (const r of plannedRows) {
        if (!r.ym) continue;
        plannedSalaries[r.ym] = num(r.amount);
      }
      p.plannedSalaries = plannedSalaries;
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
        {isEdit && employee?.status !== 'fired' && (
          <DeleteButton label="Уволить" confirmText={`Уволить сотрудника «${employee!.name}»? История зарплаты и операций сохранится.`} busy={busy} onDelete={remove} />
        )}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || invalidEmploymentDates || !!plannedIssue || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="field"><label>ФИО</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Должность</label><input value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div className="field"><label>Группа (категория ЗП)</label>
          <input list="fin-emp-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="SMM, Продажи…" />
          <datalist id="fin-emp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <div className="field">
        <label>Учётная запись в CRM</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— не привязана —</option>
          {(crmUsers || []).map((u: any) => (
            <option key={u.id} value={u.id}>{u.name}{u.email ? ` · ${u.email}` : ''}</option>
          ))}
        </select>
        <span className="mini muted">Сотрудник увидит свою зарплату в личном профиле.</span>
      </div>
      <div className="form-grid">
        <div className="field"><label>ЗП / мес</label><input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
        <div className="field"><label>Оклад действует с</label><input type="month" value={salaryEffectiveYm} onChange={(e) => setSalaryEffectiveYm(e.target.value)} /></div>
      </div>
      <div className="field">
        <label>План будущих окладов</label>
        <div className="fin-salary-history" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plannedRows.length === 0 && (
            <span className="mini muted">Пока нет запланированных изменений.</span>
          )}
          {plannedRows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="month" min={nextYm} value={r.ym} style={{ flex: 1 }}
                onChange={(e) => setPlannedRows(rows => rows.map((x, idx) => idx === i ? { ...x, ym: e.target.value } : x))} />
              <input inputMode="decimal" placeholder="Сумма" value={r.amount} style={{ width: 110 }}
                onChange={(e) => setPlannedRows(rows => rows.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} />
              <button type="button" className="btn ghost" title="Удалить" style={{ padding: '4px 10px' }}
                onClick={() => setPlannedRows(rows => rows.filter((_, idx) => idx !== i))}>🗑</button>
            </div>
          ))}
          <button type="button" className="btn ghost" style={{ alignSelf: 'flex-start' }}
            onClick={() => setPlannedRows(rows => [...rows, { ym: '', amount: '' }])}>+ Добавить месяц</button>
        </div>
        {plannedIssue
          ? <span className="mini neg">{plannedIssue}</span>
          : <span className="mini muted">С указанного месяца оклад автоматически учитывается в аналитике, ведомости и прогнозе.</span>}
      </div>
      {isEdit && Object.entries(employee?.salaryHistory || {}).filter(([ym]) => ym <= cur).length > 0 && (
        <div className="field">
          <label>История оклада (факт)</label>
          <div className="fin-salary-history">
            {Object.entries(employee!.salaryHistory || {})
              .filter(([ym]) => ym <= cur)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([ym, amount]) => (
                <div key={ym}><span>{monthLabel(ym, true)}</span><strong>{money(Number(amount))}</strong></div>
              ))}
          </div>
          <span className="mini muted">Прошлые месяцы менять нельзя — они закрыты выплатой.</span>
        </div>
      )}
      <div className="form-grid">
        <div className="field"><label>Дата приёма</label><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
        <div className="field"><label>Статус</label>
          <select value={status} onChange={(e) => {
            const next = e.target.value;
            setStatus(next);
            if (next === 'fired' && !terminationDate) setTerminationDate(todayISO());
            if (next === 'active') {
              setTerminationDate('');
              if (employee?.status === 'fired') setHireDate(todayISO());
            }
          }}>
            <option value="active">Работает</option><option value="fired">Уволен</option>
          </select>
        </div>
      </div>
      {status === 'fired' && (
        <div className="field"><label>Последний день работы</label>
          <input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} />
          {invalidEmploymentDates && <span className="mini neg">Дата увольнения не может быть раньше даты приёма.</span>}
          <span className="mini muted">Сотрудник останется в ведомостях за месяцы, когда он работал.</span>
        </div>
      )}
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
  const [dueDate, setDueDate] = useState(sub?.dueDate ? String(sub.dueDate).slice(0, 10) : '');
  const [endDate, setEndDate] = useState(sub?.endDate ? String(sub.endDate).slice(0, 10) : '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = {
        name: name.trim(), kind, amount: num(amount), active: sub?.active ?? true,
        dueDate: dueDate || null, endDate: endDate || null,
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
      <div className="form-grid">
        <div className="field">
          <label>Дата начала (первое списание)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Дата окончания</label>
          <input type="date" value={endDate} min={dueDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <span className="mini muted">Списание повторяется каждый месяц в день начала — с даты начала до даты окончания. Дата окончания пуста — без ограничения.</span>
    </FinModal>
  );
}

/** Долг (31.10.2026): кому, сколько, «вернуть до» и, по желанию, транши.
 *  Платежа в месяц нет — отдают сразу или частями, когда получается.
 *  Кредиты и рассрочки банков заводятся в «Рассрочках». */
type TrancheDraft = { key: string; date: string; amount: string };
let trancheSeq = 0;
const newTranche = (date: string, amount: string): TrancheDraft => ({ key: `t${++trancheSeq}`, date, amount });
/** Та же дата через месяц (31-е → последний день месяца). */
function plusMonth(iso: string): string {
  const [y, m, d] = (iso || todayISO()).slice(0, 10).split('-').map(Number);
  const last = new Date(y, m + 1, 0).getDate();
  const dt = new Date(y, m, Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function DebtFormModal({ debt, onClose }: { debt?: FinDebt; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!debt;
  const [name, setName] = useState(debt?.name ?? '');
  const [totalAmount, setTotalAmount] = useState(debt != null ? String(debt.totalAmount ?? '') : '');
  const [paidBefore, setPaidBefore] = useState(debt?.paidBefore ? String(debt.paidBefore) : '');
  const [dueDate, setDueDate] = useState(debt?.dueDate ? String(debt.dueDate).slice(0, 10) : '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [mode, setMode] = useState<'free' | 'plan'>('free');
  const [rows, setRows] = useState<TrancheDraft[]>([]);
  const [loaded, setLoaded] = useState(!isEdit);
  const [busy, setBusy] = useState(false);

  // Уже намеченные транши — ожидаемые плановые оплаты долга.
  const plannedQ = useQuery({
    queryKey: ['finance', 'plannedPayments', 'debt', debt?.id],
    queryFn: () => financeApi.plannedPayments({ debtId: debt!.id }),
    enabled: isEdit,
  });
  useEffect(() => {
    if (loaded || !plannedQ.data) return;
    const exp = (plannedQ.data as any[])
      .filter((p) => p.status === 'expected')
      .map((p) => ({ date: p.dueDate ? String(p.dueDate).slice(0, 10) : `${p.ym}-10`, amount: Number(p.amount) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (exp.length) { setMode('plan'); setRows(exp.map((t) => newTranche(t.date, String(t.amount)))); }
    setLoaded(true);
  }, [plannedQ.data, loaded]);

  const total = num(totalAmount);
  const before = num(paidBefore);
  const paid = Number(debt?.paid) || 0;
  const toSplit = Math.max(0, Math.round((total - before - paid) * 100) / 100);
  const parsed = rows.map((r) => ({ ...r, amt: num(r.amount), ok: /^\d{4}-\d{2}-\d{2}$/.test(r.date) && num(r.amount) > 0 }));
  const sumT = Math.round(parsed.reduce((s, r) => s + (r.ok ? r.amt : 0), 0) * 100) / 100;
  const overBy = Math.round((sumT - toSplit) * 100) / 100;
  const planBad = mode === 'plan' && (parsed.some((r) => !r.ok) || overBy > 0.005);
  const can = !!name.trim() && total > 0 && before <= total && loaded && !planBad && !busy;

  function addRow() {
    const lastDate = rows.length ? rows[rows.length - 1].date : '';
    const rest = Math.max(0, Math.round((toSplit - sumT) * 100) / 100);
    setRows([...rows, newTranche(plusMonth(lastDate || todayISO()), rest > 0 ? String(rest) : '')]);
  }
  function pickMode(m: 'free' | 'plan') {
    setMode(m);
    if (m === 'plan' && rows.length === 0) setRows([newTranche(plusMonth(todayISO()), toSplit > 0 ? String(toSplit) : '')]);
  }
  const setRow = (key: string, patch: Partial<TrancheDraft>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    if (!can) return;
    setBusy(true);
    try {
      const p = {
        name: name.trim(), totalAmount: total, paidBefore: before,
        dueDate: dueDate || null, note: note.trim() || null,
        tranches: mode === 'plan' ? parsed.filter((r) => r.ok).map((r) => ({ date: r.date, amount: r.amt })) : [],
      };
      if (isEdit) await financeApi.updateDebt(debt!.id, p);
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
    <FinModal title={isEdit ? 'Долг' : 'Новый долг'} onClose={onClose} width={600}
      footer={<>
        {isEdit && <DeleteButton confirmText={`Удалить долг «${debt!.name}»? Намеченные транши удалятся, уже отданное останется в журнале.`} busy={busy} onDelete={remove} />}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!can} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="form-grid">
        <div className="field"><label>Кому должны</label><input autoFocus={!isEdit} value={name} onChange={(e) => setName(e.target.value)} placeholder="Сабина" /></div>
        <div className="field"><label>Сумма долга</label><input inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} /></div>
        <div className="field"><label>Уже отдали раньше</label><input inputMode="decimal" value={paidBefore} onChange={(e) => setPaidBefore(e.target.value)} placeholder="0" /></div>
        <div className="field"><label>Вернуть до <span className="muted" style={{ fontWeight: 400 }}>· необязательно</span></label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <div className="field"><label>За что <span className="muted" style={{ fontWeight: 400 }}>· необязательно</span></label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="на закупку оборудования" /></div>
      {paid > 0 && <p className="mini muted" style={{ margin: 0 }}>Через «Отдать» уже отдали {money(paid)} — осталось {money(toSplit)}.</p>}

      <div className="field">
        <label>Как отдаём</label>
        <div className="fin-inst-method" role="radiogroup" aria-label="Как отдаём">
          <button type="button" role="radio" aria-checked={mode === 'free'} className={mode === 'free' ? 'on' : ''} onClick={() => pickMode('free')}>
            <b>Когда получится</b><span>сразу всё или траншами, без дат — жмёте «Отдать», когда есть деньги</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'plan'} className={mode === 'plan' ? 'on' : ''} onClick={() => pickMode('plan')}>
            <b>Наметить транши</b><span>даты и суммы — придут напоминанием в «Планирование»</span>
          </button>
        </div>
      </div>

      {mode === 'plan' && (
        <div className="fin-inst-bank fin-dbt-plan">
          <div className="fin-dbt-prow head"><span /><span>Дата</span><span>Сумма</span><span /></div>
          {parsed.map((r, i) => {
            const late = !!dueDate && r.date > dueDate;
            return (
              <div key={r.key} className={'fin-dbt-prow' + (late ? ' late' : '')}>
                <span className="n">{i + 1}</span>
                <input type="date" aria-label={`Дата транша ${i + 1}`} value={r.date} onChange={(e) => setRow(r.key, { date: e.target.value })} />
                <input inputMode="decimal" aria-label={`Сумма транша ${i + 1}`} value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />
                <button type="button" className="btn ghost sm" aria-label={`Убрать транш ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</button>
                {late && <span className="hint">позже срока «вернуть до»</span>}
              </div>
            );
          })}
          <div className="fin-dbt-pfoot">
            <button type="button" className="fin-inst-link" onClick={addRow}>+ ещё транш</button>
            {overBy > 0.005
              ? <span className="neg">больше остатка на {money(overBy)}</span>
              : Math.abs(overBy) <= 0.005 && sumT > 0
                ? <span className="pos">✓ распределено {money(sumT)} из {money(toSplit)}</span>
                : <span className="muted">распределено {money(sumT)} из {money(toSplit)} · остальное — когда получится</span>}
          </div>
        </div>
      )}
    </FinModal>
  );
}
