import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useTransactions, useClients, usePlannedPayments, useAccounts,
  receivePlanned, unreceivePlanned, removePayment, addTransaction, addReceivedPart, addPlannedPayment, deleteClientIncome, deleteClient,
  archiveClient, unarchiveClient,
} from '../state/data';
import { db, uid } from '../db/db';
import type { Client, PlannedPayment, IncomeGroup as IG } from '../db/types';
import { smmMonth, clientPaid, smmPaymentAlert } from '../lib/calc';
import { groupMeta, CAT } from '../lib/constants';
import { money, currentYm, shiftYm, todayISO, formatDate, monthLabel, ymOf } from '../lib/format';
import MonthNav from '../components/MonthNav';
import Icon from '../components/Icon';

export default function IncomeGroupPage() {
  const { group } = useParams<{ group: IG }>();
  const g = groupMeta(group);
  const [ym, setYm] = useState(currentYm());
  const [showNew, setShowNew] = useState(false);
  if (!g || !group) return <div className="empty">Направление не найдено</div>;

  return (
    <>
      <Link to="/income" className="back"><Icon name="chevronLeft" size={15} /> Доход</Link>
      <div className="page-head">
        <div>
          <h1 className="flex" style={{ color: g.color }}><Icon name={g.icon} size={22} /> <span style={{ color: 'var(--text)' }}>{g.label}</span></h1>
          <p>{group === 'smm' ? 'Помесячный учёт оплат по частям' : 'Проекты направления'}</p>
        </div>
        <div className="flex">
          {group === 'smm' && <MonthNav ym={ym} onChange={setYm} />}
          <button className="btn primary" onClick={() => setShowNew(true)}><Icon name="plus" size={16} /> Проект</button>
        </div>
      </div>

      {group === 'smm' ? <SmmTable ym={ym} /> : group === 'development' ? <DevTable group={group} /> : <DesignTables group={group} />}

      {showNew && <ProjectModal group={group} onClose={() => setShowNew(false)} />}
    </>
  );
}

function ProjectModal({ group, client, onClose }: { group: IG; client?: Client; onClose: () => void }) {
  const g = groupMeta(group);
  const isEdit = !!client;
  const [name, setName] = useState(client?.name ?? '');
  const [tariff, setTariff] = useState(client ? String(client.tariff) : '');
  const [contractDate, setContractDate] = useState(client ? (client.contractDate ?? '') : todayISO());
  const [multiMonth, setMultiMonth] = useState(client?.multiMonth ?? false);
  const amt = parseFloat(tariff.replace(',', '.'));

  async function save() {
    if (!name.trim()) return;
    const data = {
      name: name.trim(), tariff: amt > 0 ? amt : 0,
      contractDate: contractDate || undefined,
      multiMonth: group === 'design' ? multiMonth : undefined,
    };
    if (client) await db.clients.update(client.id, data);
    else await db.clients.add({ id: uid(), group, status: 'active', ...data });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{isEdit ? 'Проект' : 'Новый проект'} · {g?.label}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название клиента/проекта" /></div>
          <div className="form-grid">
            <div className="field"><label>{group === 'smm' ? 'Тариф / мес' : 'Сумма'}</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
            <div className="field"><label>Дата контракта</label><input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></div>
          </div>
          {group === 'design' && (
            <label className="flex" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={multiMonth} onChange={(e) => setMultiMonth(e.target.checked)} style={{ width: 'auto' }} />
              Брендбук / логобук — оплата по месяцам
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{isEdit ? 'Сохранить' : 'Добавить проект'}</button>
        </div>
      </div>
    </div>
  );
}

function SmmTable({ ym }: { ym: string }) {
  const clients = useClients();
  const planned = usePlannedPayments();
  const [planFor, setPlanFor] = useState<{ client: Client; partNo: 1 | 2 } | null>(null);
  const [receive, setReceive] = useState<PlannedPayment | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const rows = useMemo(() => smmMonth(clients.filter(c => c.status !== 'archived'), planned, ym), [clients, planned, ym]);
  const archived = useMemo(() => clients.filter(c => c.group === 'smm' && c.status === 'archived'), [clients]);

  const expected = rows.reduce((s, r) => s + r.payments.filter(p => p.status === 'expected').reduce((x, p) => x + p.amount, 0), 0);
  const receivedCash = rows.reduce((s, r) => s + r.payments.filter(p => p.status === 'received' && p.receivedTxId).reduce((x, p) => x + p.amount, 0), 0);
  const spent = rows.reduce((s, r) => s + r.payments.filter(p => p.status === 'received' && !p.receivedTxId).reduce((x, p) => x + p.amount, 0), 0);

  const today = todayISO();
  const alertOf = (c: Client) => smmPaymentAlert(c, planned, today);
  const needPay = rows.filter(r => alertOf(r.client) === 'оплату').length;
  const needRest = rows.filter(r => alertOf(r.client) === 'остаток').length;

  const partSum = (n: 1 | 2) => rows.reduce((s, r) => s + (r.payments.find(p => p.partNo === n)?.amount ?? 0), 0);
  const tariffSum = rows.reduce((s, r) => s + r.client.tariff, 0);
  const part1Sum = partSum(1);
  const part2Sum = partSum(2);
  const fullSum = part1Sum + part2Sum;

  async function removeClient(c: Client) {
    if (confirm(`Удалить проект «${c.name}»? Удалятся его плановые оплаты и доходные операции.`)) await deleteClient(c.id);
  }

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Ожидается" value={money(expected)} cls="" />
        <Stat label="Получено на счёт" value={money(receivedCash)} cls="pos" sub={spent > 0 ? `освоено вне счёта: ${money(spent)}` : undefined} />
        <Stat label="Всего за месяц" value={money(expected + receivedCash)} cls="" />
      </div>

      {(needPay > 0 || needRest > 0) && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', marginBottom: 12, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <Icon name="receipt" size={16} style={{ color: 'var(--amber)' }} />
          {needPay > 0 && <b style={{ color: 'var(--amber)' }}>Получить оплату: {needPay}</b>}
          {needRest > 0 && <b style={{ color: 'var(--accent)' }}>Получить остаток: {needRest}</b>}
          <span className="mini muted">— по сроку оплаты проектов</span>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Проект</th>
              <th>Дата контракта</th>
              <th className="num">Тариф</th>
              <th>Часть 1</th>
              <th>Часть 2</th>
              <th>Полная оплата</th>
              <th style={{ minWidth: 180 }}>Комментарий</th>
              <th style={{ width: 76 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const part = (n: 1 | 2) => r.payments.find(p => p.partNo === n);
              const paidLife = planned.filter(p => p.clientId === r.client.id && p.status === 'received').reduce((s, p) => s + p.amount, 0);
              const fullyPaidLife = r.client.tariff > 0 && paidLife >= r.client.tariff;
              const alert = alertOf(r.client);
              return (
                <tr key={r.client.id}>
                  <td>
                    <b>{r.client.name}</b>
                    {alert === 'оплату' && <div style={{ marginTop: 4 }}><span className="badge wait">получить оплату</span></div>}
                    {alert === 'остаток' && <div style={{ marginTop: 4 }}><span className="badge transfer">получить остаток</span></div>}
                  </td>
                  <td className="muted nowrap">{r.client.contractDate ? formatDate(r.client.contractDate) : '—'}</td>
                  <td className="num">{money(r.client.tariff)}</td>
                  {([1, 2] as const).map((n) => {
                    const p = part(n);
                    return (
                      <td key={n}>
                        {!p ? (
                          <button className="btn ghost sm" title="Записать оплату" onClick={() => setPlanFor({ client: r.client, partNo: n })}><Icon name="plus" size={15} /></button>
                        ) : p.status === 'received' ? (
                          <span className="flex">
                            <span className="badge ok"><Icon name="check" size={13} /> {money(p.amount)}</span>
                            <button className="btn ghost sm" title="Отменить оплату" onClick={() => removePayment(p)}><Icon name="undo" size={15} /></button>
                          </span>
                        ) : (
                          <span className="flex">
                            <span className="badge wait">{money(p.amount)}</span>
                            <button className="btn primary sm" onClick={() => setReceive(p)}>Получено</button>
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {fullyPaidLife
                      ? <span className="badge ok">оплачено</span>
                      : <span className="mini muted">{money(paidLife)} / {money(r.client.tariff)}</span>}
                  </td>
                  <td>
                    <input className="cell-input" placeholder="—" defaultValue={r.client.note ?? ''}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.client.note ?? '')) db.clients.update(r.client.id, { note: v || undefined }); }} />
                  </td>
                  <RowActions onEdit={() => setEditClient(r.client)} onArchive={() => archiveClient(r.client.id)} onDelete={() => removeClient(r.client)} />
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}><b>Итого</b></td>
                <td className="num"><b>{money(tariffSum)}</b></td>
                <td><b>{money(part1Sum)}</b></td>
                <td><b>{money(part2Sum)}</b></td>
                <td><b>{money(fullSum)}</b></td>
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mini muted" style={{ marginTop: 12 }}>
        «Получено» создаёт операцию-доход на выбранный счёт и привязывает её к проекту. «↩» отменяет.
      </p>

      <ArchivedProjects clients={archived} />

      {planFor && <PayPartModal client={planFor.client} partNo={planFor.partNo} ym={ym} onClose={() => setPlanFor(null)} />}
      {receive && <ReceiveModal payment={receive} onClose={() => setReceive(null)} />}
      {editClient && <ProjectModal group="smm" client={editClient} onClose={() => setEditClient(null)} />}
    </>
  );
}

function Stat({ label, value, cls, sub }: { label: string; value: string; cls: string; sub?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={'value ' + cls}>{value}</div>
      {sub && <div className="sub" style={{ textTransform: 'capitalize' }}>{sub}</div>}
    </div>
  );
}

function RowActions({ onEdit, onArchive, onDelete }: { onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  return (
    <td className="num nowrap">
      <button className="btn ghost sm" title="Редактировать" onClick={onEdit}><Icon name="edit" size={15} /></button>
      <button className="btn ghost sm" title="Архив (больше не работаем)" onClick={onArchive}><Icon name="archive" size={15} /></button>
      <button className="btn ghost sm danger" title="Удалить проект" onClick={onDelete}><Icon name="trash" size={15} /></button>
    </td>
  );
}

function ArchivedProjects({ clients }: { clients: Client[] }) {
  const [open, setOpen] = useState(false);
  if (clients.length === 0) return null;
  async function remove(c: Client) {
    if (confirm(`Удалить проект «${c.name}» навсегда? Удалятся его плановые оплаты и доходные операции.`)) await deleteClient(c.id);
  }
  return (
    <>
      <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={() => setOpen(v => !v)}>
        <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={14} /> Архив проектов ({clients.length})
      </button>
      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Проект</th><th>Дата контракта</th><th className="num">Тариф</th><th style={{ width: 150 }} /></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} style={{ opacity: 0.75 }}>
                  <td><b>{c.name}</b></td>
                  <td className="muted nowrap">{c.contractDate ? formatDate(c.contractDate) : '—'}</td>
                  <td className="num muted">{money(c.tariff)}</td>
                  <td className="num nowrap">
                    <button className="btn ghost sm" title="Вернуть из архива" onClick={() => unarchiveClient(c.id)}><Icon name="undo" size={15} /> Вернуть</button>
                    <button className="btn ghost sm danger" title="Удалить проект" onClick={() => remove(c)}><Icon name="trash" size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PayPartModal({ client, partNo, ym, onClose }: { client: Client; partNo: 1 | 2; ym: string; onClose: () => void }) {
  const accounts = useAccounts();
  const planned = usePlannedPayments();
  const [amount, setAmount] = useState(String(partNo === 1 ? client.tariff : 0));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const amt = parseFloat(amount.replace(',', '.'));

  const scheduledMonth = planned.filter(p => p.clientId === client.id && p.ym === ym).reduce((s, p) => s + p.amount, 0);
  const remaining = client.tariff - scheduledMonth;
  const overLimit = client.tariff > 0 && amt > remaining;

  async function save() {
    if (!(amt > 0) || !accountId || overLimit) return;
    await addReceivedPart(client.id, ym, partNo, amt, accountId, date);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Оплата · {client.name} · часть {partNo}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>На счёт</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
          {overLimit
            ? <p className="mini neg">Больше остатка за месяц. Доступно ещё {money(Math.max(0, remaining))} из тарифа {money(client.tariff)}.</p>
            : <p className="mini muted">Оплата этой части в указанную дату — создаётся доход. Остаток за месяц: {money(Math.max(0, remaining))}.</p>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!(amt > 0) || !accountId || overLimit} onClick={save}>Записать оплату</button>
        </div>
      </div>
    </div>
  );
}

function ReceiveModal({ payment, onClose }: { payment: PlannedPayment; onClose: () => void }) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  async function confirmPay() {
    if (!accountId) return;
    await receivePlanned(payment, accountId, date);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-head"><h3>Получено · {money(payment.amount)}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>На счёт</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
          <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={confirmPay}>Подтвердить</button>
        </div>
      </div>
    </div>
  );
}

function DevTable({ group }: { group: IG }) {
  const clients = useClients();
  const active = useMemo(() => clients.filter(c => c.group === group && c.status !== 'archived'), [clients, group]);
  const archived = useMemo(() => clients.filter(c => c.group === group && c.status === 'archived'), [clients, group]);

  if (active.length === 0 && archived.length === 0)
    return <div className="card empty"><div className="big"><Icon name="folder" size={30} /></div>Нет проектов — нажмите «＋ Проект»</div>;

  return (
    <>
      {active.length > 0
        ? <><MonthCards clients={active} /><MatrixTable clients={active} /></>
        : <div className="card empty">Нет активных проектов</div>}
      <ArchivedProjects clients={archived} />
    </>
  );
}

function MonthCards({ clients, totalLabel }: { clients: Client[]; totalLabel?: string }) {
  const planned = usePlannedPayments();
  const ids = new Set(clients.map(c => c.id));
  const cm = currentYm();
  const monthPlanned = planned.filter(p => ids.has(p.clientId ?? "") && p.ym === cm);
  const expectedMonth = monthPlanned.filter(p => p.status === 'expected').reduce((s, p) => s + p.amount, 0);
  const receivedMonth = monthPlanned.filter(p => p.status === 'received').reduce((s, p) => s + p.amount, 0);
  const tariffSum = clients.reduce((s, c) => s + c.tariff, 0);

  return (
    <div className="cards grid-3" style={{ marginBottom: 16 }}>
      <Stat label="Ожидается за месяц" value={money(expectedMonth)} cls="" sub={monthLabel(cm, true)} />
      <Stat label="Получено за месяц" value={money(receivedMonth)} cls="pos" sub={monthLabel(cm, true)} />
      <Stat label="Всего сумма" value={money(tariffSum)} cls="" sub={totalLabel ?? `${clients.length} проектов`} />
    </div>
  );
}

function MatrixTable({ clients }: { clients: Client[] }) {
  const planned = usePlannedPayments();
  const [start, setStart] = useState<string | null>(null);
  const [cellFor, setCellFor] = useState<{ client: Client; ym: string; payment?: PlannedPayment } | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const group = (clients[0]?.group ?? 'development') as IG;

  async function removeClient(c: Client) {
    if (confirm(`Удалить проект «${c.name}»? Удалятся его плановые оплаты и доходные операции.`)) await deleteClient(c.id);
  }

  const ids = useMemo(() => new Set(clients.map(c => c.id)), [clients]);
  const startDefault = useMemo(() => {
    const ms = [
      ...clients.map(c => c.contractDate?.slice(0, 7)).filter(Boolean) as string[],
      ...planned.filter(p => ids.has(p.clientId ?? "")).map(p => p.ym),
      currentYm(),
    ].sort();
    return ms[0] ?? currentYm();
  }, [clients, planned, ids]);
  const winStart = start ?? startDefault;
  const months = Array.from({ length: 6 }, (_, i) => shiftYm(winStart, i));

  const cellPayments = (clientId: string, ym: string) => planned.filter(p => p.clientId === clientId && p.ym === ym);
  const monthTotal = (ym: string) => planned.filter(p => p.ym === ym && ids.has(p.clientId ?? "")).reduce((s, p) => s + p.amount, 0);
  const tariffSum = clients.reduce((s, c) => s + c.tariff, 0);

  return (
    <>
      <div className="toolbar">
        <div className="month-nav">
          <button onClick={() => setStart(shiftYm(winStart, -1))} title="Раньше">‹</button>
          <span className="label" style={{ minWidth: 170, textTransform: 'none' }}>{monthLabel(months[0])} – {monthLabel(months[5])}</span>
          <button onClick={() => setStart(shiftYm(winStart, 1))} title="Позже">›</button>
        </div>
        <span className="mini muted">Ячейка — поступление за месяц. «+» добавляет план или сразу оплату.</span>
      </div>

      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Проект</th>
              <th className="num">Сумма</th>
              {months.map((m) => <th key={m} className="num" style={{ textTransform: 'capitalize' }}>{monthLabel(m)}</th>)}
              <th style={{ minWidth: 150 }}>Комментарий</th>
              <th style={{ width: 76 }} />
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const paid = planned.filter(p => p.clientId === c.id && p.status === 'received').reduce((s, p) => s + p.amount, 0);
              const pct = c.tariff ? Math.min(100, Math.round((paid / c.tariff) * 100)) : 0;
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                    <div className="progress" style={{ marginTop: 6 }}><i style={{ width: pct + '%' }} /></div>
                    <span className="mini muted">{money(paid)} / {money(c.tariff)}</span>
                  </td>
                  <td className="num">{money(c.tariff)}</td>
                  {months.map((m) => {
                    const ps = cellPayments(c.id, m);
                    return (
                      <td key={m} className="num">
                        {ps.length === 0 ? (
                          <button className="btn ghost sm" title="Добавить поступление" onClick={() => setCellFor({ client: c, ym: m })}><Icon name="plus" size={14} /></button>
                        ) : (
                          <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
                            {ps.map((p) => (
                              <button
                                key={p.id}
                                className={'badge ' + (p.status === 'received' ? 'ok' : 'wait')}
                                style={{ cursor: 'pointer' }}
                                title={p.status === 'received' ? 'Получено — нажмите для управления' : 'Запланировано — нажмите, чтобы отметить оплату'}
                                onClick={() => setCellFor({ client: c, ym: m, payment: p })}
                              >
                                {p.status === 'received' && <Icon name="check" size={12} />} {money(p.amount)}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <input className="cell-input" placeholder="—" defaultValue={c.note ?? ''}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.note ?? '')) db.clients.update(c.id, { note: v || undefined }); }} />
                  </td>
                  <RowActions onEdit={() => setEditClient(c)} onArchive={() => archiveClient(c.id)} onDelete={() => removeClient(c)} />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td><b>Итого</b></td>
              <td className="num"><b>{money(tariffSum)}</b></td>
              {months.map(m => <td key={m} className="num"><b>{money(monthTotal(m))}</b></td>)}
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {cellFor && <DevCellModal {...cellFor} onClose={() => setCellFor(null)} />}
      {editClient && <ProjectModal group={group} client={editClient} onClose={() => setEditClient(null)} />}
    </>
  );
}

function DevCellModal({ client, ym, payment, onClose }: { client: Client; ym: string; payment?: PlannedPayment; onClose: () => void }) {
  const accounts = useAccounts();
  const planned = usePlannedPayments();
  const [amount, setAmount] = useState(String(payment?.amount ?? ''));
  const [paidNow, setPaidNow] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const amt = parseFloat(amount.replace(',', '.'));
  const monthName = monthLabel(ym, true);

  const scheduled = planned.filter(p => p.clientId === client.id).reduce((s, p) => s + p.amount, 0);
  const remaining = client.tariff - scheduled;
  const overLimit = client.tariff > 0 && amt > remaining;

  async function saveNew() {
    if (!(amt > 0) || overLimit) return;
    if (paidNow) { if (!accountId) return; await addReceivedPart(client.id, ym, 1, amt, accountId, date); }
    else await addPlannedPayment(client.id, ym, 1, amt);
    onClose();
  }
  async function markReceived() {
    if (!payment || !accountId) return;
    await receivePlanned(payment, accountId, date);
    onClose();
  }
  async function deletePlan() {
    if (payment) await db.plannedPayments.delete(payment.id);
    onClose();
  }
  async function undo() {
    if (payment) await unreceivePlanned(payment);
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{client.name} · {monthName}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        {payment ? (
          <>
            <div className="modal-body">
              {payment.status === 'received' ? (
                <p>Поступление <b>{money(payment.amount)}</b> отмечено как полученное.</p>
              ) : (
                <>
                  <p>Запланировано <b>{money(payment.amount)}</b>. Отметить как полученное?</p>
                  <div className="form-grid">
                    <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                    <div className="field"><label>На счёт</label><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              {payment.status === 'received'
                ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={undo}>Отменить оплату</button>
                : <button className="btn danger" style={{ marginRight: 'auto' }} onClick={deletePlan}>Удалить план</button>}
              <button className="btn ghost" onClick={onClose}>Закрыть</button>
              {payment.status === 'expected' && <button className="btn primary" onClick={markReceived}>Отметить полученным</button>}
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <label className="flex" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} style={{ width: 'auto' }} />
                Уже получено (создать доход)
              </label>
              {paidNow && (
                <div className="form-grid">
                  <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div className="field"><label>На счёт</label><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                </div>
              )}
              {overLimit
                ? <p className="mini neg">Больше остатка по проекту. Доступно ещё {money(Math.max(0, remaining))} из {money(client.tariff)}.</p>
                : <p className="mini muted">Без галочки — план на {monthName}. С галочкой — деньги уже получены. Остаток по проекту: {money(Math.max(0, remaining))}.</p>}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={onClose}>Отмена</button>
              <button className="btn primary" disabled={!(amt > 0) || overLimit} onClick={saveNew}>{paidNow ? 'Записать оплату' : 'Добавить план'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DesignTables({ group }: { group: IG }) {
  const clients = useClients();
  const txns = useTransactions();
  const planned = usePlannedPayments();
  const [payFor, setPayFor] = useState<Client | null>(null);
  const [workFor, setWorkFor] = useState<Client | 'new' | null>(null);

  const designClients = clients.filter(c => c.group === group && c.status !== 'archived');
  const archived = clients.filter(c => c.group === group && c.status === 'archived');
  const simple = designClients.filter(c => !c.multiMonth);
  const matrix = designClients.filter(c => c.multiMonth);

  const cm = currentYm();
  const receivedMonth = txns
    .filter(t => t.type === 'income' && t.group === group && ymOf(t.date) === cm)
    .reduce((s, t) => s + t.amount, 0);
  const matrixIds = new Set(matrix.map(c => c.id));
  const expectedMatrix = planned
    .filter(p => matrixIds.has(p.clientId ?? "") && p.ym === cm && p.status === 'expected')
    .reduce((s, p) => s + p.amount, 0);
  const expectedSimple = simple
    .filter(c => c.contractDate && ymOf(c.contractDate) === cm)
    .reduce((s, c) => s + Math.max(0, c.tariff - clientPaid(c.id, txns)), 0);
  const totalAll = designClients.reduce((s, c) => s + c.tariff, 0);

  if (designClients.length === 0 && archived.length === 0)
    return <div className="card empty"><div className="big"><Icon name="folder" size={30} /></div>Нет проектов — нажмите «＋ Проект»</div>;

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Ожидается за месяц" value={money(expectedMatrix + expectedSimple)} cls="" sub={monthLabel(cm, true)} />
        <Stat label="Получено за месяц" value={money(receivedMonth)} cls="pos" sub={monthLabel(cm, true)} />
        <Stat label="Всего сумма" value={money(totalAll)} cls="" sub={`${designClients.length} проектов`} />
      </div>

      <div className="between" style={{ marginTop: 8, marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Разовые работы</div>
        <button className="btn sm" onClick={() => setWorkFor('new')}><Icon name="plus" size={14} /> Добавить работу</button>
      </div>
      <SimpleDesignTable clients={simple} onPay={setPayFor} onEdit={setWorkFor} />

      {matrix.length > 0 && (
        <>
          <div className="section-title">Брендбуки и логобуки · оплата по месяцам</div>
          <MatrixTable clients={matrix} />
        </>
      )}

      <ArchivedProjects clients={archived} />

      {payFor && <RecordIncomeModal client={payFor} group={group} onClose={() => setPayFor(null)} />}
      {workFor && <WorkModal work={workFor === 'new' ? undefined : workFor} onClose={() => setWorkFor(null)} />}
    </>
  );
}

function SimpleDesignTable({ clients, onPay, onEdit }: { clients: Client[]; onPay: (c: Client) => void; onEdit: (c: Client) => void }) {
  const txns = useTransactions();
  if (clients.length === 0) return <div className="card empty" style={{ padding: 28 }}>Нет разовых работ — нажмите «＋ Добавить работу»</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Название</th>
            <th>Дата</th>
            <th className="num">Сумма</th>
            <th style={{ minWidth: 170 }}>Комментарий</th>
            <th>Статус</th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => {
            const paid = clientPaid(c.id, txns);
            const isPaid = c.tariff > 0 && paid >= c.tariff;
            return (
              <tr key={c.id} onDoubleClick={() => onEdit(c)}>
                <td><b>{c.name}</b></td>
                <td className="muted">{c.contractDate ? formatDate(c.contractDate) : '—'}</td>
                <td className="num">{money(c.tariff)}</td>
                <td>
                  <input className="cell-input" placeholder="—" defaultValue={c.note ?? ''}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.note ?? '')) db.clients.update(c.id, { note: v || undefined }); }} />
                </td>
                <td>
                  {isPaid
                    ? <span className="badge ok"><Icon name="check" size={13} /> оплачено</span>
                    : <button className="btn primary sm" onClick={() => onPay(c)}>Записать оплату</button>}
                </td>
                <td className="num nowrap">
                  <button className="btn ghost sm" title="Редактировать" onClick={() => onEdit(c)}><Icon name="edit" size={15} /></button>
                  <button className="btn ghost sm" title="Архив (больше не работаем)" onClick={() => archiveClient(c.id)}><Icon name="archive" size={15} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WorkModal({ work, onClose }: { work?: Client; onClose: () => void }) {
  const txns = useTransactions();
  const [name, setName] = useState(work?.name ?? '');
  const [tariff, setTariff] = useState(work ? String(work.tariff) : '');
  const [date, setDate] = useState(work?.contractDate ?? todayISO());
  const [note, setNote] = useState(work?.note ?? '');
  const amt = parseFloat(tariff.replace(',', '.'));
  const paid = work ? clientPaid(work.id, txns) : 0;

  async function save() {
    if (!name.trim()) return;
    const p = {
      name: name.trim(), group: 'design' as IG, tariff: amt > 0 ? amt : 0,
      contractDate: date || undefined, note: note.trim() || undefined, multiMonth: false, status: 'active' as const,
    };
    if (work) await db.clients.update(work.id, p);
    else await db.clients.add({ id: uid(), ...p });
    onClose();
  }
  async function cancelPayment() {
    if (work && confirm('Отменить оплату по этой работе? Доход будет удалён.')) await deleteClientIncome(work.id);
  }
  async function remove() {
    if (work && confirm('Удалить работу?')) { await db.clients.delete(work.id); onClose(); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{work ? 'Работа' : 'Новая работа'}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Логотип, флаерс…" /></div>
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
            <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>Комментарий</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {work && paid > 0 && (
            <div className="flex between" style={{ background: 'var(--green-soft)', padding: '9px 12px', borderRadius: 9 }}>
              <span className="mini pos">Оплачено {money(paid)}</span>
              <button className="btn danger sm" onClick={cancelPayment}><Icon name="undo" size={14} /> Отменить оплату</button>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {work && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>Удалить</button>}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{work ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  );
}

function RecordIncomeModal({ client, group, onClose }: { client: Client; group: IG; onClose: () => void }) {
  const accounts = useAccounts();
  const txns = useTransactions();
  const remaining = Math.max(0, client.tariff - clientPaid(client.id, txns));
  const [amount, setAmount] = useState(String(remaining || client.tariff));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const amt = parseFloat(amount.replace(',', '.'));
  const overLimit = client.tariff > 0 && amt > remaining;

  async function save() {
    if (!(amt > 0) || !accountId || overLimit) return;
    const categoryId = group === 'development' ? CAT.development : group === 'design' ? CAT.design : CAT.smm;
    await addTransaction({ date, type: 'income', amount: amt, group, categoryId, accountTo: accountId, clientId: client.id, comment: 'Оплата за работу' });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Оплата · {client.name}</h3><button className="btn ghost sm" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>На счёт</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
          {overLimit && <p className="mini neg">Больше остатка. Доступно ещё {money(remaining)} из {money(client.tariff)}.</p>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!(amt > 0) || !accountId || overLimit} onClick={save}>Записать оплату</button>
        </div>
      </div>
    </div>
  );
}
