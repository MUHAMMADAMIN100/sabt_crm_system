import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { apiErr, currentYm, formatDate, money, monthLabel } from './finlib';
import { FinLoadError, FinLoading, FinModal } from './FinKit';
import FinIcon from './FinIcon';
import ImportedArchiveBadge, { isImportedArchive } from './ImportedArchiveBadge';
import { floatingPosition, scrollableAncestors, type FloatingPosition } from './floatingPosition';
import './finance.css';
import { PlanningCashFlowChart } from './FinanceCharts';
import { AccountMark } from './AccountIdentity';

const scenarios: Record<string, string> = { conservative: 'Осторожный', base: 'Базовый', optimistic: 'Оптимистичный' };

export default function FinancePlanningPage() {
  const qc = useQueryClient();
  const currentYear = Number(currentYm().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const start = `${year}-01`;
  const months = 12;
  const [scenario, setScenario] = useState('base');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: ['finance', 'forecast', start, months, scenario],
    queryFn: () => financeApi.forecast({ start, months, scenario }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => financeApi.removeForecastAdjustment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance', 'forecast'] }),
    onError: (e) => toast.error(apiErr(e)),
  });
  if (query.isLoading) return <div className="fin-root"><FinLoading cards={4} /></div>;
  if (query.isError) return <div className="fin-root"><FinLoadError onRetry={() => query.refetch()} /></div>;
  const data = query.data;
  const availableYear = Number(String(data.availableFrom || start).slice(0, 4)) || year;
  const firstYear = Math.min(availableYear, currentYear);
  const lastYear = Math.max(currentYear + 5, year);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  const visibleRows = data.rows.filter((row: any) => !data.availableFrom || row.ym >= data.availableFrom);
  const periodStart = data.availableFrom?.startsWith(`${year}-`) ? data.availableFrom : `${year}-01`;
  return (
    <div className="fin-root">
      <div className="page-head">
        <div><h1 className="flex"><FinIcon name="chart" size={22} /> Планирование</h1><p>Прогноз движения денег по уже известным доходам и обязательствам</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Корректировка</button>
      </div>
      <div className="fin-plan-controls">
        <div className="field fin-plan-period-field">
          <label>Период планирования</label>
          <strong>{monthLabel(periodStart, true)} — {monthLabel(`${year}-12`, true)}</strong>
        </div>
        <div className="fin-segments" role="group" aria-label="Сценарий прогноза">
          {Object.entries(scenarios).map(([key, label]) => (
            <button key={key} className={scenario === key ? 'active' : ''}
              aria-pressed={scenario === key} onClick={() => setScenario(key)}>{label}</button>
          ))}
        </div>
      </div>
      {data.summary.cashGapYm && <div className="fin-plan-warning">Внимание: при этом сценарии возможен кассовый разрыв в {monthLabel(data.summary.cashGapYm, true)}.</div>}
      <div className="cards grid-4">
        <div className="card"><span className="muted mini">Текущий баланс</span><div className="value">{money(data.openingBalance)}</div></div>
        <div className="card"><span className="muted mini">Доход за период · факт + план</span><div className="value pos">{money(data.summary.expectedIncome)}</div></div>
        <div className="card"><span className="muted mini">Расход за период · факт + план</span><div className="value neg">{money(data.summary.expectedExpense)}</div></div>
        <div className="card"><span className="muted mini">Баланс в конце</span><div className={`value ${data.summary.endingBalance < 0 ? 'neg' : ''}`}>{money(data.summary.endingBalance)}</div></div>
      </div>
      <PlanningCashFlowChart rows={visibleRows} scenarioLabel={scenarios[scenario]} cashGapYm={data.summary.cashGapYm} dataTableId="fin-planning-data" />
      <div className="table-wrap"><table id="fin-planning-data"><caption className="sr-only">Подробные значения прогноза движения денег по месяцам</caption><thead><tr><th>Месяц</th><th>Доход · факт / осталось</th><th>Расход · факт / осталось</th><th>Результат</th><th>Баланс сейчас / после плана</th></tr></thead><tbody>
        {visibleRows.map((r: any) => {
          const toggle = () => setExpanded(expanded === r.ym ? null : r.ym);
          const isCurrentMonth = r.ym === currentYm();
          return <Fragment key={r.ym}><tr className={`clickable${isCurrentMonth ? ' fin-current-month-row' : ''}`} aria-expanded={expanded === r.ym}
            tabIndex={0} onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
              }
            }}>
          <td>
            <strong>{monthLabel(r.ym, true)}</strong>
            {isCurrentMonth && <small className="fin-current-month-badge">текущий месяц</small>}
            {r.balanceReset && (
              <small className="fin-plan-balance-reset"
                title="С этого месяца остаток считается по счетам CRM, а не по архиву Notion">
                переход на остатки CRM
              </small>
            )}
          </td>
          <td><FlowCell tone="income" actual={r.actualIncome} planned={r.plannedIncome} total={r.income} /></td>
          <td><FlowCell tone="expense" actual={r.actualExpense} planned={r.plannedExpense} total={r.expense} /></td>
          <td><FlowCell actual={r.actualIncome - r.actualExpense} planned={r.plannedIncome - r.plannedExpense} total={r.net} signed /></td>
          <td><BalanceCell current={r.balanceNow} forecast={r.closingBalance} /></td>
        </tr>{expanded === r.ym && <tr className="fin-plan-detail-row"><td colSpan={5}><div className="fin-plan-detail">
          <SourceList title="Доходы" tone="income" rows={r.incomeSources} remove={(id) => remove.mutate(id)} />
          <SourceList title="Расходы" tone="expense" rows={r.expenseSources} remove={(id) => remove.mutate(id)} />
        </div></td></tr>}</Fragment>;
        })}
      </tbody></table></div>
      <div className="fin-plan-year-nav" role="group" aria-label="Выбор года планирования">
        <button type="button" className="btn ghost" disabled={year <= firstYear} onClick={() => setYear(year - 1)}>‹</button>
        <label>
          <span>Другой год</span>
          <select aria-label="Другой год" value={year} onChange={event => setYear(Number(event.target.value))}>
            {years.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button type="button" className="btn ghost" onClick={() => setYear(year + 1)}>›</button>
      </div>
      {adding && <AdjustmentModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['finance', 'forecast'] }); }} />}
    </div>
  );
}

function SourceList({ title, tone, rows, remove }: { title: string; tone: 'income' | 'expense'; rows: any[]; remove: (id: string) => void }) {
  const salaryRows = rows.filter(x => x.salary || String(x.kind).startsWith('Зарплата'));
  const salaryMap = new Map<string, any>();
  for (const row of salaryRows) {
    const prev = salaryMap.get(row.label);
    salaryMap.set(row.label, prev
      ? {
          ...prev,
          amount: Number(prev.amount) + Number(row.amount),
          imported: isImportedArchive(prev) || isImportedArchive(row),
        }
      : { ...row });
  }
  const salaries = [...salaryMap.values()];
  const visible = rows.filter(x => !(x.salary || String(x.kind).startsWith('Зарплата')));
  if (salaries.length) visible.unshift({
    key: 'salary-group',
    label: 'Зарплата',
    kind: `${salaries.length} сотрудников`,
    amount: salaries.reduce((s, x) => s + Number(x.amount), 0),
    salaries,
    imported: salaries.some(isImportedArchive),
  });
  return <div className={`fin-plan-column ${tone}`}>
    <div className="fin-plan-column-title"><strong>{title}</strong><span>{money(rows.reduce((s, x) => s + Number(x.amount), 0))}</span></div>
    {visible.length ? visible.map(x => x.salaries
      ? <SalaryGroup key={x.key} group={x} />
      : <PlanSource key={x.key} source={x} remove={remove} />
    ) : <p className="muted">Нет ожидаемых операций</p>}
  </div>;
}

function sourceMeta(source: any): string[] {
  return [
    source.date ? (String(source.date).length >= 10 ? formatDate(source.date) : String(source.date)) : null,
    source.categoryName ? `категория: ${source.categoryName}` : null,
    source.accountName ? `счёт: ${source.accountName}` : null,
  ].filter(Boolean) as string[];
}

function PlanSource({ source, remove }: { source: any; remove: (id: string) => void }) {
  const meta = sourceMeta(source);
  return (
    <div className={`fin-plan-source${isImportedArchive(source) ? ' imported' : ''}`}>
      <span>
        <span className="fin-plan-source-label">
          {source.label}
          {isImportedArchive(source) && <ImportedArchiveBadge />}
        </span>
        <small>{source.kind}</small>
        {meta.length > 0 && <span className="fin-plan-source-meta-row">
          {source.accountName && <AccountMark name={source.accountName} compact />}
          <small className="fin-plan-source-meta">{meta.join(' · ')}</small>
        </span>}
      </span>
      <b>{money(source.amount)}</b>
      {source.adjustmentId && (
        <button onClick={() => remove(source.adjustmentId)} title="Удалить"
          aria-label={`Удалить корректировку «${source.label}»`}>×</button>
      )}
    </div>
  );
}

function SalaryGroup({ group }: { group: any }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<FloatingPosition | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos(floatingPosition(rect, 410, Math.min(390, window.innerHeight * .7)));
  }, []);
  useEffect(() => {
    if (!open || pinned) return;
    pinTimer.current = setTimeout(() => setPinned(true), 5_500);
    return () => { if (pinTimer.current) clearTimeout(pinTimer.current); };
  }, [open, pinned]);
  useEffect(() => () => {
    if (pinTimer.current) clearTimeout(pinTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    if (!open) return;
    const ancestors = scrollableAncestors(anchorRef.current);
    window.addEventListener('resize', updatePosition);
    ancestors.forEach((el) => el.addEventListener('scroll', updatePosition, { passive: true }));
    return () => {
      window.removeEventListener('resize', updatePosition);
      ancestors.forEach((el) => el.removeEventListener('scroll', updatePosition));
    };
  }, [open, updatePosition]);
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    updatePosition();
    setOpen(true);
  };
  const leave = () => {
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const close = (e: MouseEvent) => { e.stopPropagation(); setPinned(false); setOpen(false); };
  const togglePinned = () => {
    updatePosition();
    setOpen((wasOpen) => {
      const nextOpen = !wasOpen || !pinned;
      setPinned(nextOpen);
      return nextOpen;
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePinned();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setPinned(false);
      setOpen(false);
    }
  };
  return <div ref={anchorRef} className="fin-plan-source has-popover"
    role="button" tabIndex={0} aria-expanded={open} aria-controls={open ? popoverId : undefined}
    aria-label={`Показать зарплаты ${group.kind}`}
    onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
    onClick={togglePinned} onKeyDown={onKeyDown}>
    <span>
      <span className="fin-plan-source-label">
        {group.label}
        {isImportedArchive(group) && <ImportedArchiveBadge />}
      </span>
      <small>{group.kind}</small>
    </span>
    <b>{money(group.amount)}</b>
    {open && pos && createPortal(<div id={popoverId} className={`fin-salary-popover open${pinned ? ' pinned' : ''}`}
      role="dialog" aria-label="Зарплата сотрудников" tabIndex={-1}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
      onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onMouseLeave={leave}
      onFocus={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onBlur={leave}
      onClick={e => e.stopPropagation()}>
      <div className="fin-salary-popover-head"><strong>Зарплата сотрудников</strong><b>{money(group.amount)}</b>
        {pinned && <button className="fin-payout-close" type="button" aria-label="Закрыть" onClick={close}><FinIcon name="close" size={14} /></button>}
      </div>
      <div className="fin-salary-popover-body">{group.salaries.map((person: any) => {
        const meta = sourceMeta(person);
        return <div key={person.key}>
          <span>
            {person.label}
            {meta.length > 0 && <small className="fin-salary-person-meta">{meta.join(' · ')}</small>}
          </span>
          <b>{money(person.amount)}</b>
        </div>;
      })}</div>
      <div className={'fin-payout-pin-hint' + (pinned ? ' pinned' : '')}>{pinned ? 'Окно закреплено — можно прокручивать' : 'Задержите курсор, чтобы закрепить окно'}</div>
    </div>, document.body)}
  </div>;
}

function FlowCell({ actual, planned, total, tone, signed = false }: {
  actual: number; planned: number; total: number; tone?: 'income' | 'expense'; signed?: boolean;
}) {
  const hasFact = Math.abs(Number(actual) || 0) > .004;
  const hasPlan = Math.abs(Number(planned) || 0) > .004;
  const shown = hasFact ? actual : total;
  const cls = tone === 'income' ? 'pos' : tone === 'expense' ? 'neg' : Number(shown) < 0 ? 'neg' : '';
  const remainderLabel = tone === 'income' ? 'осталось получить' : tone === 'expense' ? 'осталось оплатить' : 'ожидаемое изменение';
  return <div className={`fin-plan-flow-cell ${cls}`}>
    <strong>{money(shown, signed)}</strong>
    <small>{hasFact ? 'факт' : remainderLabel}{hasFact && hasPlan ? ` · ${remainderLabel} ${money(planned, signed)}` : ''}</small>
  </div>;
}

function BalanceCell({ current, forecast }: { current?: number | null; forecast: number }) {
  const now = current == null ? null : Number(current);
  const shown = now ?? Number(forecast);
  return <div className={`fin-plan-flow-cell ${shown < 0 ? 'neg' : ''}`}>
    <strong>{money(shown)}</strong>
    <small>{now == null ? 'прогноз' : `сейчас · после планов ${money(forecast)}`}</small>
  </div>;
}

function AdjustmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', type: 'expense', amount: '', startYm: currentYm(), endYm: '', recurrence: 'once', scenario: 'all', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await financeApi.createForecastAdjustment({ ...form, amount: Number(form.amount) }); onSaved(); } catch (e) { toast.error(apiErr(e)); setBusy(false); } };
  return <FinModal title="Корректировка прогноза" onClose={onClose} width={520} footer={<><button className="btn ghost" onClick={onClose}>Отмена</button><button className="btn primary" disabled={busy || !form.name || !form.amount} onClick={save}>Добавить</button></>}>
    <div className="field"><label>Название</label><input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Налог, новая услуга, покупка…" /></div>
    <div className="form-grid"><div className="field"><label>Тип</label><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="income">Доход</option><option value="expense">Расход</option></select></div><div className="field"><label>Сумма</label><input inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div></div>
    <div className="form-grid"><div className="field"><label>С месяца</label><input type="month" value={form.startYm} onChange={e => setForm({ ...form, startYm: e.target.value })} /></div><div className="field"><label>Повторение</label><select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value })}><option value="once">Один раз</option><option value="monthly">Каждый месяц</option></select></div></div>
    {form.recurrence === 'monthly' && <div className="field"><label>До месяца (необязательно)</label><input type="month" value={form.endYm} onChange={e => setForm({ ...form, endYm: e.target.value })} /></div>}
    <div className="field"><label>Сценарий</label><select value={form.scenario} onChange={e => setForm({ ...form, scenario: e.target.value })}><option value="all">Все сценарии</option><option value="base">Базовый</option><option value="conservative">Осторожный</option><option value="optimistic">Оптимистичный</option></select></div>
  </FinModal>;
}
