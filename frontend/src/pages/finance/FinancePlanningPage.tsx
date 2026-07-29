import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { apiErr, currentYm, money, monthLabel } from './finlib';
import { FinLoadError, FinLoading, FinModal } from './FinKit';
import FinIcon from './FinIcon';
import './finance.css';

const scenarios: Record<string, string> = { conservative: 'Осторожный', base: 'Базовый', optimistic: 'Оптимистичный' };

export default function FinancePlanningPage() {
  const qc = useQueryClient();
  const [start, setStart] = useState(currentYm());
  const [months, setMonths] = useState(12);
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
  return (
    <div className="fin-root">
      <div className="page-head">
        <div><h1 className="flex"><FinIcon name="chart" size={22} /> Планирование</h1><p>Прогноз движения денег по уже известным доходам и обязательствам</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Корректировка</button>
      </div>
      <div className="fin-plan-controls">
        <div className="field"><label>Начать с</label><input type="month" value={start} onChange={e => setStart(e.target.value)} /></div>
        <div className="field"><label>Горизонт</label><select value={months} onChange={e => setMonths(Number(e.target.value))}><option value={6}>6 месяцев</option><option value={12}>12 месяцев</option><option value={24}>24 месяца</option></select></div>
        <div className="fin-segments">{Object.entries(scenarios).map(([key, label]) => <button key={key} className={scenario === key ? 'active' : ''} onClick={() => setScenario(key)}>{label}</button>)}</div>
      </div>
      {data.summary.cashGapYm && <div className="fin-plan-warning">Внимание: при этом сценарии возможен кассовый разрыв в {monthLabel(data.summary.cashGapYm, true)}.</div>}
      <div className="cards grid-4">
        <div className="card"><span className="muted mini">Текущий баланс</span><div className="value">{money(data.openingBalance)}</div></div>
        <div className="card"><span className="muted mini">Ожидаемый доход</span><div className="value pos">{money(data.summary.expectedIncome)}</div></div>
        <div className="card"><span className="muted mini">Ожидаемый расход</span><div className="value neg">{money(data.summary.expectedExpense)}</div></div>
        <div className="card"><span className="muted mini">Баланс в конце</span><div className={`value ${data.summary.endingBalance < 0 ? 'neg' : ''}`}>{money(data.summary.endingBalance)}</div></div>
      </div>
      <div className="card fin-plan-chart">
        <div className="fin-plan-chart-head"><div><strong>Денежный поток</strong><span>Столбцы — поступления и выплаты, синяя область — прогноз остатка</span></div><span className="fin-plan-scenario">{scenarios[scenario]}</span></div>
        <ResponsiveContainer width="100%" height={320}><ComposedChart data={data.rows}>
          <defs><linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={.22}/><stop offset="95%" stopColor="#2563eb" stopOpacity={.015}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#94a3b833" /><XAxis dataKey="ym" tickFormatter={(v) => monthLabel(v)} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}к`} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<PlanChartTooltip />} /><Legend iconType="circle" />
          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
          <Area type="monotone" dataKey="closingBalance" name="Остаток" stroke="#2563eb" fill="url(#balanceFill)" strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
          <Bar dataKey="income" name="Доход" fill="#22c55e" radius={[6, 6, 0, 0]} maxBarSize={30} />
          <Bar dataKey="expense" name="Расход" fill="#fb7185" radius={[6, 6, 0, 0]} maxBarSize={30} />
        </ComposedChart></ResponsiveContainer>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Месяц</th><th>Доход</th><th>Расход</th><th>Результат</th><th>Остаток</th></tr></thead><tbody>
        {data.rows.map((r: any) => <><tr key={r.ym} className="clickable" onClick={() => setExpanded(expanded === r.ym ? null : r.ym)}>
          <td><strong>{monthLabel(r.ym, true)}</strong></td><td className="pos">{money(r.income)}</td><td className="neg">{money(r.expense)}</td><td>{money(r.net, true)}</td><td className={r.closingBalance < 0 ? 'neg' : ''}><strong>{money(r.closingBalance)}</strong></td>
        </tr>{expanded === r.ym && <tr key={`${r.ym}-detail`}><td colSpan={5}><div className="fin-plan-detail">
          <SourceList title="Доходы" tone="income" rows={r.incomeSources} remove={(id) => remove.mutate(id)} />
          <SourceList title="Расходы" tone="expense" rows={r.expenseSources} remove={(id) => remove.mutate(id)} />
        </div></td></tr>}</>)}
      </tbody></table></div>
      {adding && <AdjustmentModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['finance', 'forecast'] }); }} />}
    </div>
  );
}

function SourceList({ title, tone, rows, remove }: { title: string; tone: 'income' | 'expense'; rows: any[]; remove: (id: string) => void }) {
  const salaries = rows.filter(x => x.kind === 'Зарплата');
  const visible = rows.filter(x => x.kind !== 'Зарплата');
  if (salaries.length) visible.unshift({ key: 'salary-group', label: 'Зарплата', kind: `${salaries.length} сотрудников`, amount: salaries.reduce((s, x) => s + Number(x.amount), 0), salaries });
  return <div className={`fin-plan-column ${tone}`}>
    <div className="fin-plan-column-title"><strong>{title}</strong><span>{money(rows.reduce((s, x) => s + Number(x.amount), 0))}</span></div>
    {visible.length ? visible.map(x => x.salaries
      ? <SalaryGroup key={x.key} group={x} />
      : <div className="fin-plan-source" key={x.key}><span>{x.label}<small>{x.kind}</small></span><b>{money(x.amount)}</b>{x.adjustmentId && <button onClick={() => remove(x.adjustmentId)} title="Удалить">×</button>}</div>
    ) : <p className="muted">Нет ожидаемых операций</p>}
  </div>;
}

function SalaryGroup({ group }: { group: any }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || pinned) return;
    pinTimer.current = setTimeout(() => setPinned(true), 5_500);
    return () => { if (pinTimer.current) clearTimeout(pinTimer.current); };
  }, [open, pinned]);
  const enter = () => setOpen(true);
  const leave = () => { if (!pinned) setOpen(false); };
  const close = (e: MouseEvent) => { e.stopPropagation(); setPinned(false); setOpen(false); };
  return <div className="fin-plan-source has-popover" onMouseEnter={enter} onMouseLeave={leave}>
    <span>{group.label}<small>{group.kind}</small></span><b>{money(group.amount)}</b>
    {open && <div className={`fin-salary-popover open${pinned ? ' pinned' : ''}`} onClick={e => e.stopPropagation()}>
      <div className="fin-salary-popover-head"><strong>Зарплата сотрудников</strong><b>{money(group.amount)}</b>
        {pinned && <button className="fin-payout-close" type="button" aria-label="Закрыть" onClick={close}><FinIcon name="close" size={14} /></button>}
      </div>
      <div className="fin-salary-popover-body">{group.salaries.map((person: any) => <div key={person.key}><span>{person.label}</span><b>{money(person.amount)}</b></div>)}</div>
      <div className={'fin-payout-pin-hint' + (pinned ? ' pinned' : '')}>{pinned ? 'Окно закреплено — можно прокручивать' : 'Задержите курсор, чтобы закрепить окно'}</div>
    </div>}
  </div>;
}

function PlanChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((p: any) => [p.dataKey, Number(p.value)]));
  return <div className="fin-chart-tooltip"><strong>{monthLabel(label, true)}</strong>
    <div><span className="income-dot" />Доход <b>{money(values.income)}</b></div>
    <div><span className="expense-dot" />Расход <b>{money(values.expense)}</b></div>
    <div><span className="balance-dot" />Остаток <b>{money(values.closingBalance)}</b></div>
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
