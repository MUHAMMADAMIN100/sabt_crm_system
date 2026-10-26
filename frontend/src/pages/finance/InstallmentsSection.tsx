// Рассрочки сотрудников (/finance/expense/installments). Компания купила
// сотруднику вещь, деньги возвращаются частями. Решение владельца 26.10.2026:
// своя карточка на «Расходе» (таблица по месяцам) + колонка «Рассрочка» в
// зарплатной ведомости. Удержание месяца само встаёт в ведомость; здесь —
// своя сумма на месяц, пропуск и платежи мимо зарплаты. Менять может только
// владелец, сотрудник видит своё в профиле.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financeApi } from '@/services/api.service';
import useNarrow from '@/hooks/useNarrow';
import { money, moneyBare, monthLabel, shiftYm, todayISO, apiErr, pluralRu, formatDate } from './finlib';
import { FinLoading, FinLoadError, FinModal, finConfirm, invalidateFinance } from './FinKit';
import FinIcon from './FinIcon';

export const INSTALLMENT_COLOR = '#47aaa4';

const num = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

type Cell = {
  ym: string; amount: number; status: 'deducted' | 'planned' | 'skip' | 'none';
  frozen: boolean; custom: boolean; payments: any[];
};

function useAccounts(): any[] {
  const { data } = useQuery({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  return (data ?? []).filter((a: any) => !a.archived);
}

/** «осталось 6 400 с. из 9 600 с. · последний — май 2027» */
function restLine(r: any): string {
  if (r.done) return 'закрыта';
  const base = `осталось ${money(r.remaining)} из ${money(r.installment.totalAmount)}`;
  return r.endYm ? `${base} · последний — ${monthLabel(r.endYm, true)}` : base;
}

export function InstallmentsList() {
  const narrow = useNarrow();
  const [start, setStart] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['finance', 'installments', start ?? 'auto'],
    queryFn: () => financeApi.installments(start ?? undefined),
  });
  const [formFor, setFormFor] = useState<any | 'new' | null>(null);
  const [cellFor, setCellFor] = useState<{ row: any; cell: Cell } | null>(null);
  const [payFor, setPayFor] = useState<any | null>(null);

  if (isLoading) return <FinLoading />;
  if (isError) return <FinLoadError onRetry={refetch} />;

  const months: string[] = data?.months ?? [];
  const rows: any[] = data?.rows ?? [];
  const stats = data?.stats ?? { remaining: 0, total: 0, paid: 0, count: 0, people: 0, nextEndYm: null, openMonth: null };
  const openYm: string = data?.latestOpenYm ?? months[2];
  const perMonth = (m: string) => (data?.perMonth ?? []).find((x: any) => x.ym === m)?.total ?? 0;
  const shiftWindow = (d: number) => months.length && setStart(shiftYm(months[0], d));

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Сотрудники должны</div>
          <div className="value" style={{ color: INSTALLMENT_COLOR }}>{money(stats.remaining)}</div>
          <div className="sub">из {money(stats.total)} · вернули {money(stats.paid)}</div>
        </div>
        <div className="card stat">
          <div className="label" style={{ textTransform: 'none' }}>Из зарплаты за {stats.openMonth ? monthLabel(stats.openMonth.ym, true) : '—'}</div>
          <div className="value">{money(stats.openMonth?.amount ?? 0)}</div>
          <div className="sub">встанет в ведомость сам</div>
        </div>
        <div className="card stat">
          <div className="label">Рассрочек</div>
          <div className="value">{stats.count}</div>
          <div className="sub">
            {stats.count
              ? `${pluralRu(stats.people, 'сотрудник', 'сотрудника', 'сотрудников')}${stats.nextEndYm ? ` · ближайшая закроется в ${monthLabel(stats.nextEndYm)}` : ''}`
              : 'открытых нет'}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="month-nav">
          <button onClick={() => shiftWindow(-1)} title="Раньше">‹</button>
          <span className="label" style={{ minWidth: 170, textTransform: 'none' }}>{months.length ? `${monthLabel(months[0])} – ${monthLabel(months[5])}` : '…'}</span>
          <button onClick={() => shiftWindow(1)} title="Позже">›</button>
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setFormFor('new')}><FinIcon name="plus" size={16} /> Рассрочка</button>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">
          <div className="big"><FinIcon name="installment" size={30} /></div>
          Рассрочек нет — нажмите «＋ Рассрочка», если купили сотруднику вещь с возвратом частями
        </div>
      ) : narrow ? (
        <div className="fin-debt-cards">
          {rows.map((r) => (
            <InstallmentCard key={r.installment.id} row={r} months={months} openYm={openYm}
              onEdit={() => setFormFor(r)} onPay={() => setPayFor(r)}
              onCell={(cell) => setCellFor({ row: r, cell })} />
          ))}
        </div>
      ) : (
        <div className="table-wrap fin-wide-table">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Сотрудник и покупка</th>
                <th className="num" style={{ width: 96 }}>Сумма</th>
                {months.map((m) => (
                  <th key={m} className={`num${m === openYm ? ' fin-current-month-cell' : ''}`} style={{ textTransform: 'capitalize', minWidth: 92 }}>
                    {monthLabel(m)}{m === openYm && <small className="fin-current-month-dot" title="Открытый месяц ведомости" />}
                  </th>
                ))}
                <th style={{ width: 84 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.installment.id} className={r.done ? 'fin-inst-done' : undefined}>
                  <td>
                    <b>{r.employee?.name ?? 'Сотрудник удалён'}</b>
                    <div className="mini">{r.installment.name}</div>
                    <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${r.progress ?? 0}%`, background: INSTALLMENT_COLOR }} /></div>
                    <span className="mini muted">{restLine(r)}</span>
                  </td>
                  <td className="num">{money(r.installment.totalAmount)}</td>
                  {r.cells.map((c: Cell) => (
                    <td key={c.ym} className={`num${c.ym === openYm ? ' fin-current-month-cell' : ''}`}>
                      <InstCell row={r} cell={c} openYm={openYm} onOpen={() => setCellFor({ row: r, cell: c })} />
                    </td>
                  ))}
                  <td className="num">
                    <span className="flex" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      {!r.done && <button className="btn ghost sm" title="Платёж мимо зарплаты" onClick={() => setPayFor(r)}><FinIcon name="banknote" size={15} /></button>}
                      <button className="btn ghost sm" title="Изменить" onClick={() => setFormFor(r)}><FinIcon name="edit" size={15} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Итого</b></td>
                <td className="num"><b>{money(stats.total)}</b></td>
                {months.map((m) => <td key={m} className={`num${m === openYm ? ' fin-current-month-cell' : ''}`}><b>{money(perMonth(m))}</b></td>)}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="fin-inst-legend mini muted">
          <span><span className="badge ok"><FinIcon name="check" size={11} /> 800</span> удержано — зарплата месяца выплачена</span>
          <span><span className="fin-inst-plan">800</span> впереди — само встанет в ведомость</span>
          <span><span className="fin-inst-pay">+800</span> внесено мимо зарплаты</span>
          {!narrow && <span>Нажмите на месяц — можно изменить сумму или пропустить, срок сдвинется сам.</span>}
        </div>
      )}

      {formFor && <InstallmentFormModal row={formFor === 'new' ? null : formFor} openYm={openYm} onClose={() => setFormFor(null)} />}
      {cellFor && <InstallmentMonthModal row={cellFor.row} cell={cellFor.cell} onClose={() => setCellFor(null)} />}
      {payFor && <InstallmentPaymentModal row={payFor} onClose={() => setPayFor(null)} />}
    </>
  );
}

/** Месяц можно поправить, пока его зарплату не выплатили. */
function cellEditable(row: any, cell: Cell, openYm: string): boolean {
  return !cell.frozen && !row.done && cell.ym >= row.installment.startYm && cell.ym >= openYm;
}

function InstCell({ row, cell, openYm, onOpen }: { row: any; cell: Cell; openYm: string; onOpen: () => void }) {
  const main = cell.status === 'deducted'
    ? <span className="badge ok"><FinIcon name="check" size={11} /> {moneyBare(cell.amount)}</span>
    : cell.status === 'planned'
      ? <span className={`fin-inst-plan${cell.custom ? ' custom' : ''}`} title={cell.custom ? 'Своя сумма на этот месяц' : undefined}>{moneyBare(cell.amount)}</span>
      : cell.status === 'skip'
        ? <span className="fin-inst-skip">пропуск</span>
        : <span className="muted">—</span>;
  const content = (
    <span className="fin-inst-cell">
      {main}
      {cell.payments.map((p: any) => (
        <span key={p.id} className="fin-inst-pay" title={`${formatDate(p.date)}${p.note ? ` · ${p.note}` : ''}`}>+{moneyBare(p.amount)}</span>
      ))}
    </span>
  );
  if (!cellEditable(row, cell, openYm)) return content;
  return (
    <button type="button" className="fin-inst-cellbtn" onClick={onOpen}
      aria-label={`${monthLabel(cell.ym, true)}: изменить сумму или пропустить`}>
      {content}
    </button>
  );
}

/** Рассрочка на телефоне: шесть месяцев колонками не помещаются — полоска
 *  месяцев, ближайшее удержание и история по нажатию (как карточка долга). */
function InstallmentCard({ row, months, openYm, onEdit, onPay, onCell }: {
  row: any; months: string[]; openYm: string;
  onEdit: () => void; onPay: () => void; onCell: (cell: Cell) => void;
}) {
  const [open, setOpen] = useState(false);
  const segState = (c: Cell) => c.status === 'deducted' ? 'paid' : c.status === 'planned' ? 'plan' : c.status === 'skip' ? 'skip' : 'none';
  const openCell: Cell | undefined = row.cells.find((c: Cell) => c.ym === openYm);
  const history: any[] = row.history ?? [];
  return (
    <div className="fin-debt-card">
      <button type="button" className="fin-debt-head" onClick={onEdit}>
        <b>{row.employee?.name ?? 'Сотрудник удалён'}</b>
        <span className="num">{money(row.installment.totalAmount)}</span>
      </button>
      <span className="mini" style={{ marginTop: -8 }}>{row.installment.name}</span>
      <div className="progress"><i style={{ width: `${row.progress ?? 0}%`, background: INSTALLMENT_COLOR }} /></div>
      <span className="mini muted">{restLine(row)}</span>

      <div className="fin-debt-year">
        {months.map((m) => {
          const c: Cell = row.cells.find((x: Cell) => x.ym === m);
          return (
            <span key={m} className={`seg ${segState(c)}${m === openYm ? ' now' : ''}`}>
              <i /><em>{monthLabel(m).split(' ')[0]}</em>
            </span>
          );
        })}
      </div>

      {!row.done && (
        <div className="fin-debt-next">
          {row.next ? (
            <>
              <span className="mini muted">ближайшее удержание · {monthLabel(row.next.ym)}</span>
              <b className="num">{money(row.next.amount)}</b>
            </>
          ) : <span className="mini muted">удержаний по плану нет</span>}
          <span className="flex" style={{ gap: 6, marginLeft: row.next ? 0 : 'auto' }}>
            {openCell && cellEditable(row, openCell, openYm) && <button className="btn sm" onClick={() => onCell(openCell)}>Месяц</button>}
            <button className="btn sm" onClick={onPay}>Платёж</button>
          </span>
        </div>
      )}

      {history.length > 0 && (
        <button type="button" className="fin-debt-more" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть историю' : `История возврата · ${history.length}`}
        </button>
      )}
      {open && (
        <div className="fin-debt-plan">
          {history.map((h) => (
            <div key={h.key} className="fin-debt-plan-row" style={{ cursor: 'default' }}>
              <span className="m">{h.kind === 'before' ? 'до CRM' : monthLabel(h.ym)}</span>
              <span className="mini muted">{h.kind === 'salary' ? 'из зарплаты' : h.kind === 'manual' ? (h.note || 'мимо зарплаты') : 'вернули раньше'}</span>
              <span className="num">{money(h.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Окна ────────────────────────────────────────────────

/** Новая рассрочка / правка. Покупка пишется расходом, только если отметить. */
export function InstallmentFormModal({ row, openYm, onClose }: { row: any | null; openYm: string; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const inst = row?.installment;
  const isEdit = !!inst;
  const { data: employees = [] } = useQuery({ queryKey: ['finref', 'employees'], queryFn: () => financeApi.employees() });
  const activeEmployees = useMemo(
    () => (employees as any[]).filter((e) => e.status === 'active' || e.id === inst?.employeeId)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')),
    [employees, inst?.employeeId],
  );
  const deducted = (row?.history ?? []).some((h: any) => h.kind === 'salary');

  const [employeeId, setEmployeeId] = useState<string>(inst?.employeeId ?? '');
  const [name, setName] = useState<string>(inst?.name ?? '');
  const [total, setTotal] = useState<string>(inst ? String(inst.totalAmount) : '');
  const [before, setBefore] = useState<string>(inst ? String(inst.paidBefore || '') : '');
  const [monthly, setMonthly] = useState<string>(inst ? String(inst.monthlyAmount) : '');
  const [startYm, setStartYm] = useState<string>(inst?.startYm ?? openYm);
  const [note, setNote] = useState<string>(inst?.note ?? '');
  const [buy, setBuy] = useState(false);
  const [buyAccount, setBuyAccount] = useState<string>('');
  const [buyDate, setBuyDate] = useState<string>(todayISO());
  const [busy, setBusy] = useState(false);

  const monthOptions = useMemo(() => {
    const list = Array.from({ length: 12 }, (_, i) => shiftYm(openYm, i));
    if (inst?.startYm && !list.includes(inst.startYm)) list.unshift(inst.startYm);
    return list;
  }, [openYm, inst?.startYm]);

  const t = num(total), b = num(before), mo = num(monthly);
  const rest = Math.max(0, t - b);
  const count = mo > 0 ? Math.ceil(rest / mo - 1e-9) : 0;
  const last = count > 0 ? shiftYm(startYm, count - 1) : null;
  const lastAmount = count > 0 ? Math.round((rest - mo * (count - 1)) * 100) / 100 : 0;
  const accountForBuy = buyAccount || accounts[0]?.id || '';
  const valid = !!employeeId && !!name.trim() && t > 0 && mo > 0 && b <= t && (!buy || !!accountForBuy);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const purchase = buy && !inst?.purchaseTxId ? { accountId: accountForBuy, date: buyDate } : undefined;
      const body: any = {
        name: name.trim(), totalAmount: t, monthlyAmount: mo, paidBefore: b,
        note: note.trim(), purchase,
      };
      if (!isEdit || startYm !== inst.startYm) body.startYm = startYm;
      if (isEdit) await financeApi.updateInstallment(inst.id, body);
      else await financeApi.createInstallment({ ...body, employeeId });
      invalidateFinance(qc);
      toast.success(isEdit ? 'Рассрочка сохранена' : 'Рассрочка добавлена');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!inst || busy) return;
    const ok = await finConfirm(
      `Удалить рассрочку «${inst.name}»? Операции, записанные вместе с ней (покупка, платежи на счёт), отменятся. Удержания из уже выплаченных зарплат останутся в ведомости.`,
      { danger: true, confirmLabel: 'Удалить' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await financeApi.removeInstallment(inst.id);
      invalidateFinance(qc);
      toast.success('Рассрочка удалена');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  return (
    <FinModal title={isEdit ? 'Рассрочка' : 'Новая рассрочка'} onClose={onClose} width={520}
      footer={<>
        {isEdit && <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>Удалить</button>}
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить'}</button>
      </>}>
      <div className="field">
        <label>Сотрудник</label>
        <select value={employeeId} disabled={isEdit} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">— выберите —</option>
          {activeEmployees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      <div className="field"><label>Что куплено</label><input autoFocus={!isEdit} value={name} maxLength={200} placeholder="например, iPhone 15 · 128 ГБ" onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-grid">
        <div className="field"><label>Стоимость</label><input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
        <div className="field"><label>Уже вернули раньше</label><input inputMode="decimal" value={before} placeholder="0" onChange={(e) => setBefore(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Удерживать в месяц</label><input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></div>
        <div className="field">
          <label>С зарплаты за</label>
          <select value={startYm} disabled={deducted} onChange={(e) => setStartYm(e.target.value)}>
            {monthOptions.map((m) => <option key={m} value={m} style={{ textTransform: 'capitalize' }}>{monthLabel(m, true)}</option>)}
          </select>
        </div>
      </div>
      {b > t && <p className="mini neg" style={{ margin: 0 }}>«Уже вернули» больше стоимости.</p>}
      {count > 0 && last && b <= t && (
        <div className="fin-inst-calc">
          <FinIcon name="check" size={14} />
          <span>
            {isEdit ? 'По плану: ' : ''}<b>{pluralRu(count, 'платёж', 'платежа', 'платежей')}</b> по {money(mo)}
            {lastAmount !== mo ? `, последний ${money(lastAmount)}` : ''} · последний — <b style={{ textTransform: 'capitalize' }}>{monthLabel(last, true)}</b>
          </span>
        </div>
      )}
      {deducted && <p className="mini muted" style={{ margin: 0 }}>Из зарплаты уже удерживали — первый месяц не меняется.</p>}

      {inst?.purchaseTxId ? (
        <p className="mini muted" style={{ margin: 0 }}>Покупка записана в расходы — категория «Рассрочки сотрудникам».</p>
      ) : (
        <>
          <label className="flex" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={buy} onChange={(e) => setBuy(e.target.checked)} style={{ width: 'auto' }} />
            Записать покупку в расходы
          </label>
          {buy && (
            <div className="form-grid">
              <div className="field"><label>Со счёта</label>
                <select value={accountForBuy} onChange={(e) => setBuyAccount(e.target.value)}>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Дата покупки</label><input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} /></div>
            </div>
          )}
          {!buy && <p className="mini muted" style={{ margin: 0 }}>Без галочки — только учёт возврата, счета не меняются.</p>}
        </>
      )}
      <div className="field"><label>Комментарий</label><input value={note} maxLength={2000} placeholder="необязательно" onChange={(e) => setNote(e.target.value)} /></div>
    </FinModal>
  );
}

/** Своя сумма на месяц или пропуск. Сумма попадёт в ведомость этого месяца. */
function InstallmentMonthModal({ row, cell, onClose }: { row: any; cell: Cell; onClose: () => void }) {
  const qc = useQueryClient();
  const inst = row.installment;
  const usual = Number(inst.monthlyAmount) || 0;
  const [amount, setAmount] = useState<string>(String(cell.status === 'planned' ? cell.amount : usual));
  const [busy, setBusy] = useState(false);
  const isCustom = inst.overrides?.[cell.ym] != null;

  async function send(value: number | null, done: string) {
    if (busy) return;
    setBusy(true);
    try {
      await financeApi.setInstallmentMonth(inst.id, { ym: cell.ym, amount: value });
      invalidateFinance(qc);
      toast.success(done);
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  const a = num(amount);
  return (
    <FinModal title={`${row.employee?.name ?? 'Рассрочка'} · ${monthLabel(cell.ym, true)}`} onClose={onClose} width={440}
      footer={<>
        {cell.status !== 'skip' && <button className="btn ghost" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => send(0, 'Месяц пропущен — срок сдвинулся')}>Пропустить месяц</button>}
        {isCustom && <button className="btn ghost" style={cell.status === 'skip' ? { marginRight: 'auto' } : undefined} disabled={busy} onClick={() => send(null, 'Вернули обычную сумму')}>Как обычно · {money(usual)}</button>}
        <button className="btn primary" disabled={busy || !(a > 0)} onClick={() => send(a, 'Сумма месяца сохранена')}>Сохранить</button>
      </>}>
      <p style={{ margin: 0 }}>{inst.name}. Обычно удерживаем <b>{money(usual)}</b> — сумма сама встаёт в зарплатную ведомость этого месяца.</p>
      <div className="field">
        <label>Удержать из зарплаты за {monthLabel(cell.ym, true)}</label>
        <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <p className="mini muted" style={{ margin: 0 }}>Больше обычного — рассрочка закроется раньше, меньше или пропуск — срок сдвинется. Осталось {money(row.remaining)}</p>
    </FinModal>
  );
}

/** Платёж мимо зарплаты: деньги внесли отдельно или закрыли часть досрочно.
 *  Счёт — по желанию: тогда это ещё и доход «Возврат долга». */
function InstallmentPaymentModal({ row, onClose }: { row: any; onClose: () => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const inst = row.installment;
  const suggested = Math.min(Number(inst.monthlyAmount) || 0, Number(row.remaining) || 0);
  const [amount, setAmount] = useState<string>(suggested > 0 ? String(suggested) : '');
  const [date, setDate] = useState<string>(todayISO());
  const [accountId, setAccountId] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const payments: any[] = inst.payments ?? [];
  const a = num(amount);
  const over = a > (Number(row.remaining) || 0) + 0.005;

  async function save() {
    if (busy || !(a > 0) || over) return;
    setBusy(true);
    try {
      await financeApi.addInstallmentPayment(inst.id, { amount: a, date, note: note.trim() || undefined, accountId: accountId || undefined });
      invalidateFinance(qc);
      toast.success('Платёж записан');
      onClose();
    } catch (e) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }

  async function removePayment(p: any) {
    const ok = await finConfirm(
      `Убрать платёж ${money(p.amount)} от ${formatDate(p.date)}?${p.txId ? ' Доход на счёт тоже отменится.' : ''}`,
      { danger: true, confirmLabel: 'Убрать' },
    );
    if (!ok) return;
    try {
      await financeApi.removeInstallmentPayment(inst.id, p.id);
      invalidateFinance(qc);
      toast.success('Платёж убран');
      onClose();
    } catch (e) { toast.error(apiErr(e)); }
  }

  return (
    <FinModal title={`Платёж · ${row.employee?.name ?? ''}`} onClose={onClose} width={460}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={busy || !(a > 0) || over} onClick={save}>{busy ? 'Записываю…' : 'Записать платёж'}</button>
      </>}>
      <p style={{ margin: 0 }}>{inst.name} · осталось <b>{money(row.remaining)}</b></p>
      <p className="mini muted" style={{ margin: 0 }}>Платёж мимо зарплаты: деньги внесли отдельно или закрыли часть досрочно.</p>
      <div className="form-grid">
        <div className="field"><label>Сумма</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {over && <p className="mini neg" style={{ margin: 0 }}>Больше остатка: осталось {money(row.remaining)}.</p>}
      <div className="field">
        <label>Куда пришли деньги</label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Не записывать на счёт — только учёт</option>
          {accounts.map((acc: any) => <option key={acc.id} value={acc.id}>{acc.name} — доход «Возврат долга»</option>)}
        </select>
      </div>
      <div className="field"><label>Комментарий</label><input value={note} maxLength={300} placeholder="например, наличными" onChange={(e) => setNote(e.target.value)} /></div>
      {payments.length > 0 && (
        <div className="fin-inst-paylist">
          <span className="mini muted">Уже внесено мимо зарплаты</span>
          {payments.map((p) => (
            <div key={p.id} className="fin-inst-payrow">
              <span>{formatDate(p.date)}</span>
              <span className="mini muted">{p.note || (p.txId ? 'на счёт' : 'учёт')}</span>
              <b className="num">{money(p.amount)}</b>
              <button type="button" className="btn ghost sm" aria-label="Убрать платёж" onClick={() => removePayment(p)}><FinIcon name="close" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </FinModal>
  );
}

// ─── Блок в раскрытой строке зарплатной ведомости ─────────────

/** «Рассрочка» в месяце сотрудника: что удерживаем, сколько осталось;
 *  в открытом месяце — пропустить или поменять сумму прямо отсюда. */
export function InstallmentSalaryField({ row, ym, frozen }: { row: any; ym: string; frozen: boolean }) {
  const qc = useQueryClient();
  const parts: any[] = row.installmentParts || [];
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  if (!parts.length) return null;
  const total = Number(row.installment) || 0;

  async function setMonth(p: any, amount: number | null, done: string) {
    try {
      await financeApi.setInstallmentMonth(p.id, { ym, amount });
      invalidateFinance(qc);
      setEditing(null);
      toast.success(done);
    } catch (e) { toast.error(apiErr(e)); }
  }

  return (
    <div className="fld fin-inst-fld">
      <div className="cap"><span className="lbl">Рассрочка</span>{total > 0 && <span className="tot" style={{ color: INSTALLMENT_COLOR }}>{money(total)}</span>}</div>
      {parts.map((p) => {
        const pct = p.total > 0 ? Math.min(100, Math.round((p.paid / p.total) * 100)) : 0;
        return (
          <div key={p.id} className="fin-inst-part">
            <div className="t">
              <b title={p.name}>{p.name}</b>
              <span>{p.amount > 0 ? money(p.amount) : p.skipped ? 'пропуск' : '—'}</span>
            </div>
            {p.total > 0 && <div className="progress"><i style={{ width: `${pct}%`, background: INSTALLMENT_COLOR }} /></div>}
            {p.total > 0 && (
              <div className="mini muted">
                вернули {money(p.paid)} из {money(p.total)}{p.remaining > 0 ? ` · осталось ${money(p.remaining)}` : ''}
              </div>
            )}
            {!frozen && !p.done && editing !== p.id && (
              <div className="acts">
                {p.skipped
                  ? <button type="button" className="btn ghost sm" onClick={() => setMonth(p, null, 'Удержание вернули')}>Удержать как обычно</button>
                  : <button type="button" className="btn ghost sm" onClick={() => setMonth(p, 0, 'Месяц пропущен — срок сдвинулся')}>Пропустить месяц</button>}
                <button type="button" className="btn ghost sm" onClick={() => { setEditing(p.id); setValue(String(p.amount || p.monthly || '')); }}>Изменить сумму</button>
              </div>
            )}
            {editing === p.id && (
              <div className="in">
                <input autoFocus inputMode="decimal" value={value} aria-label="Сумма удержания за месяц"
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); const n = num(value); if (n > 0) setMonth(p, n, 'Сумма месяца сохранена'); }
                    if (e.key === 'Escape') setEditing(null);
                  }} />
                <button type="button" className="issue" title="Сохранить" onClick={() => { const n = num(value); if (n > 0) setMonth(p, n, 'Сумма месяца сохранена'); }}>
                  <FinIcon name="check" size={15} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
