import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
        <ResponsiveContainer width="100%" height={320}><ComposedChart data={data.rows}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="ym" tickFormatter={(v) => monthLabel(v)} />
          <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}к`} /><Tooltip formatter={(v: number) => money(v)} labelFormatter={(v) => monthLabel(v, true)} />
          <Legend /><Bar dataKey="income" name="Доход" fill="#16a34a" radius={[5, 5, 0, 0]} /><Bar dataKey="expense" name="Расход" fill="#ef4444" radius={[5, 5, 0, 0]} />
          <Line type="monotone" dataKey="closingBalance" name="Остаток" stroke="#2563eb" strokeWidth={3} />
        </ComposedChart></ResponsiveContainer>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Месяц</th><th>Доход</th><th>Расход</th><th>Результат</th><th>Остаток</th></tr></thead><tbody>
        {data.rows.map((r: any) => <><tr key={r.ym} className="clickable" onClick={() => setExpanded(expanded === r.ym ? null : r.ym)}>
          <td><strong>{monthLabel(r.ym, true)}</strong></td><td className="pos">{money(r.income)}</td><td className="neg">{money(r.expense)}</td><td>{money(r.net, true)}</td><td className={r.closingBalance < 0 ? 'neg' : ''}><strong>{money(r.closingBalance)}</strong></td>
        </tr>{expanded === r.ym && <tr key={`${r.ym}-detail`}><td colSpan={5}><div className="fin-plan-detail">
          <SourceList title="Доходы" rows={r.incomeSources} remove={(id) => remove.mutate(id)} />
          <SourceList title="Расходы" rows={r.expenseSources} remove={(id) => remove.mutate(id)} />
        </div></td></tr>}</>)}
      </tbody></table></div>
      {adding && <AdjustmentModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['finance', 'forecast'] }); }} />}
    </div>
  );
}

function SourceList({ title, rows, remove }: { title: string; rows: any[]; remove: (id: string) => void }) {
  return <div><strong>{title}</strong>{rows.length ? rows.map(x => <div className="fin-plan-source" key={x.key}><span>{x.label}<small>{x.kind}</small></span><b>{money(x.amount)}</b>{x.adjustmentId && <button onClick={() => remove(x.adjustmentId)} title="Удалить">×</button>}</div>) : <p className="muted">Нет ожидаемых операций</p>}</div>;
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
