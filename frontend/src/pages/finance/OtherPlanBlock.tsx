// «Прочее»: план на месяцы вперёд (01.11.2026, макет «OtherPlan» утверждён
// владельцем). Деньги на амортизацию и развитие: своя цифра на месяц, пустая
// клетка — среднее по прошлым месяцам CRM. Цифры идут в «Расход» →
// «3 месяца / 6 месяцев / 1 год», строка «Прочее».
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import { money, moneyBare, monthLabel, apiErr, pluralRu } from './finlib';
import { invalidateFinance } from './FinKit';

export type OtherPlanData = {
  avg: number; avgFrom: string | null; avgTo: string | null; avgMonths: number;
  months: Array<{ ym: string; amount: number | null; estimate: number }>;
};

export function useOtherPlan() {
  return useQuery<OtherPlanData>({ queryKey: ['finance', 'otherPlan'], queryFn: () => financeApi.otherPlan() });
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** «июнь — октябрь 2026, 5 месяцев» — откуда среднее. */
export function avgBasis(d?: OtherPlanData | null): string {
  if (!d?.avgFrom || !d.avgTo || !d.avgMonths) return 'прошлых месяцев в CRM ещё нет';
  const range = d.avgFrom === d.avgTo ? monthLabel(d.avgFrom, true) : `${monthLabel(d.avgFrom, true)} — ${monthLabel(d.avgTo, true)}`;
  return `${range}, ${pluralRu(d.avgMonths, 'месяц', 'месяца', 'месяцев')}`;
}

/** Сумма из поля: пусто — null (вернуть среднее), не число — NaN. */
function parseAmount(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

function PlanCell({ ym, label, amount, avg }: { ym: string; label: string; amount: number | null; avg: number }) {
  const qc = useQueryClient();
  const shown = amount == null ? '' : moneyBare(amount);
  const [draft, setDraft] = useState(shown);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(shown); }, [shown]);

  async function save(value: number | null) {
    if (value !== null && Number.isNaN(value)) { toast.error('Впишите сумму числом'); setDraft(shown); return; }
    if (value === amount || (value === null && amount == null)) return;
    setBusy(true);
    try {
      await financeApi.setOtherPlan({ ym, amount: value });
      invalidateFinance(qc);
      toast.success(value === null ? 'Вернули среднее' : 'Сохранено');
    } catch (e) {
      toast.error(apiErr(e));
      setDraft(shown);
    } finally { setBusy(false); }
  }

  const own = amount != null;
  const id = `oth-plan-${ym}`;
  return (
    <div className={`fin-oth-cell${own ? ' own' : ''}`}>
      <label htmlFor={id}>{label}{own && <span className="tag">ваш план</span>}</label>
      <input id={id} inputMode="decimal" autoComplete="off" value={draft} placeholder={`≈ ${moneyBare(avg)}`} disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(parseAmount(draft))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(shown);
        }} />
      {own && <button type="button" className="rst" disabled={busy} onClick={() => { setDraft(''); save(null); }}>вернуть среднее</button>}
    </div>
  );
}

export function OtherPlanBlock({ data }: { data: OtherPlanData }) {
  const months = data.months ?? [];
  const total = months.reduce((s, m) => s + (Number(m.estimate) || 0), 0);
  const own = months.filter((m) => m.amount != null).length;
  const label = (ym: string, i: number) => {
    const full = cap(monthLabel(ym, true));
    // Год — у первого месяца и у января, как в макете.
    return i === 0 || ym.endsWith('-01') ? full : full.replace(/\s\d{4}$/, '');
  };
  return (
    <section className="card fin-oth-plan" aria-labelledby="fin-oth-plan-h">
      <div className="head">
        <div className="tx">
          <h2 id="fin-oth-plan-h">План на месяцы вперёд</h2>
          <p>Сколько примерно уйдёт на амортизацию и развитие. Пустая клетка — берём среднее: <b>{money(data.avg)} в месяц</b> ({avgBasis(data)}).</p>
        </div>
        <div className="tot">
          <span>Итого на {pluralRu(months.length, 'месяц', 'месяца', 'месяцев')}</span>
          <b>{money(total)}</b>
          <span>{own ? `ваш план — ${own} мес., среднее — ${months.length - own} мес.` : 'пока везде среднее'}</span>
        </div>
      </div>
      <div className="grid">
        {months.map((m, i) => <PlanCell key={m.ym} ym={m.ym} label={label(m.ym, i)} amount={m.amount} avg={data.avg} />)}
      </div>
      <p className="hint">Вписали число — сохраняется сразу (Enter или клик мимо). Эти цифры идут в «Расход» → «3 месяца / 6 месяцев / 1 год», строка «Прочее».</p>
    </section>
  );
}
