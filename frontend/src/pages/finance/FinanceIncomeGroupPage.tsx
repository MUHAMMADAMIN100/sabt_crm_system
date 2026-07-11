// Доход · направление (SMM / Development / Design). Порт fin-webrand/src/pages/IncomeGroup.tsx.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { money, currentYm, shiftYm, todayISO, formatDate, monthLabel, ymOf, daysLabel, daysUntil, INCOME_GROUPS } from './finlib';
import FinIcon from './FinIcon';
import MonthNav from './MonthNav';
import { financeApi } from '@/services/api.service';

const showErr = (e: any) => toast.error(e?.response?.data?.message || 'Ошибка');

function useAccounts(): any[] {
  const { data } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => financeApi.accounts() });
  return (data as any[]) || [];
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['finance'] });
}

export default function FinanceIncomeGroupPage() {
  const { direction } = useParams<{ direction: string }>();
  const g = INCOME_GROUPS.find((x) => x.key === direction);
  const [ym, setYm] = useState(currentYm());
  const [start, setStart] = useState<string | undefined>(undefined);
  const [showNew, setShowNew] = useState(false);

  const { data } = useQuery({
    queryKey: ['finance', 'income-direction', direction, ym, start ?? ''],
    queryFn: () => financeApi.incomeDirectionDetail(direction!, ym, start),
    enabled: !!g,
  });

  // Архив для Development/Design — в детальном ответе его нет, берём из справочника проектов.
  const { data: allProjects } = useQuery({
    queryKey: ['finance', 'projects'],
    queryFn: () => financeApi.projects(),
    enabled: !!g && direction !== 'smm',
  });

  if (!g || !direction) return <div className="fin-root"><div className="empty">Направление не найдено</div></div>;

  const archivedOther = ((allProjects as any[]) || []).filter((p: any) => p.direction === direction && p.archived);
  const shiftStart = (months: string[], delta: number) => setStart(shiftYm(months[0], delta));

  return (
    <div className="fin-root">
      <Link to="/finance/income" className="back"><FinIcon name="chevronLeft" size={15} /> Доход</Link>
      <div className="page-head">
        <div>
          <h1 className="flex" style={{ color: g.color }}><FinIcon name={g.icon} size={22} /> <span style={{ color: 'var(--text)' }}>{g.label}</span></h1>
          <p>{direction === 'smm' ? 'Помесячный учёт оплат по частям' : 'Проекты направления'}</p>
        </div>
        <div className="flex">
          {direction === 'smm' && <MonthNav ym={ym} onChange={setYm} />}
          <button className="btn primary" onClick={() => setShowNew(true)}><FinIcon name="plus" size={16} /> Проект</button>
        </div>
      </div>

      {!data ? null
        : data.kind === 'smm' ? <SmmSection data={data} ym={ym} />
        : data.kind === 'matrix' ? <DevSection data={data} direction={direction} archived={archivedOther} onShift={shiftStart} />
        : <DesignSection data={data} direction={direction} archived={archivedOther} onShift={shiftStart} />}

      {showNew && <ProjectModal direction={direction} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Stat({ label, value, cls, sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={'value ' + (cls || '')}>{value}</div>
      {sub && <div className="sub" style={{ textTransform: 'capitalize' }}>{sub}</div>}
    </div>
  );
}

function RowActions({ onEdit, onArchive, onDelete }: { onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  return (
    <td className="num nowrap">
      <button className="btn ghost sm" title="Редактировать" onClick={onEdit}><FinIcon name="edit" size={15} /></button>
      <button className="btn ghost sm" title="В архив (больше не работаем)" onClick={onArchive}><FinIcon name="archive" size={15} /></button>
      <button className="btn ghost sm danger" title="Удалить проект" onClick={onDelete}><FinIcon name="trash" size={15} /></button>
    </td>
  );
}

function NoteCell({ project }: { project: any }) {
  const inv = useInvalidate();
  return (
    <input
      className="cell-input" placeholder="—" defaultValue={project.note ?? ''}
      onBlur={async (e) => {
        const v = e.target.value.trim();
        if (v === (project.note ?? '')) return;
        try { await financeApi.updateProject(project.id, { note: v }); inv(); } catch (err) { showErr(err); }
      }}
    />
  );
}

// ---------- Модалка проекта (создание/редактирование) ----------

function ProjectModal({ direction, project, onClose }: { direction: string; project?: any; onClose: () => void }) {
  const g = INCOME_GROUPS.find((x) => x.key === direction);
  const inv = useInvalidate();
  const isEdit = !!project;
  const [name, setName] = useState(project?.name ?? '');
  const [tariff, setTariff] = useState(project ? String(project.tariff) : '');
  const [contractDate, setContractDate] = useState(project ? (project.contractDate ?? '') : todayISO());
  const [multiMonth, setMultiMonth] = useState(project?.multiMonth ?? false);
  const amt = parseFloat(tariff.replace(',', '.'));

  async function save() {
    if (!name.trim()) return;
    const data: any = { name: name.trim(), tariff: amt > 0 ? amt : 0 };
    if (direction !== 'development') data.contractDate = contractDate || undefined;
    if (direction === 'design') data.multiMonth = multiMonth;
    try {
      if (project) await financeApi.updateProject(project.id, data);
      else await financeApi.createProject({ direction, ...data });
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{isEdit ? 'Проект' : 'Новый проект'} · {g?.label}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название клиента/проекта" /></div>
          <div className="form-grid">
            <div className="field"><label>{direction === 'smm' ? 'Тариф / мес' : 'Сумма'}</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
            {direction !== 'development' && (
              <div className="field"><label>Дата контракта</label><input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} /></div>
            )}
          </div>
          {direction === 'design' && (
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

// ---------- Архив проектов ----------

function ArchivedProjects({ projects }: { projects: any[] }) {
  const inv = useInvalidate();
  const [open, setOpen] = useState(false);
  if (!projects || projects.length === 0) return null;

  async function restore(p: any) {
    try { await financeApi.updateProject(p.id, { archived: false }); inv(); } catch (e) { showErr(e); }
  }
  async function remove(p: any) {
    if (!confirm(`Удалить проект «${p.name}» навсегда? Удалятся его плановые оплаты и доходные операции.`)) return;
    try { await financeApi.removeProject(p.id); inv(); } catch (e) { showErr(e); }
  }

  return (
    <>
      <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={() => setOpen((v) => !v)}>
        <FinIcon name={open ? 'chevronLeft' : 'chevronRight'} size={14} /> Архив проектов ({projects.length})
      </button>
      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Проект</th><th>Дата контракта</th><th className="num">Тариф</th><th style={{ width: 172 }} /></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} style={{ opacity: 0.75 }}>
                  <td><b>{p.name}</b></td>
                  <td className="muted nowrap">{p.contractDate ? formatDate(p.contractDate) : '—'}</td>
                  <td className="num muted">{money(p.tariff)}</td>
                  <td className="num nowrap">
                    <button className="btn ghost sm" title="Вернуть из архива" onClick={() => restore(p)}><FinIcon name="undo" size={15} /> Вернуть</button>
                    <button className="btn ghost sm danger" title="Удалить проект" onClick={() => remove(p)}><FinIcon name="trash" size={15} /></button>
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

// ---------- SMM ----------

function SmmSection({ data, ym }: { data: any; ym: string }) {
  const inv = useInvalidate();
  const [planFor, setPlanFor] = useState<{ row: any; partNo: 1 | 2 } | null>(null);
  const [receive, setReceive] = useState<any>(null); // part {plannedId, amount, ...}
  const [editProject, setEditProject] = useState<any>(null);

  const rows: any[] = data.rows || [];
  const { stats, totals, needPay, needRest } = data;

  async function removeProjectRow(p: any) {
    if (!confirm(`Удалить проект «${p.name}»? Удалятся его плановые оплаты и доходные операции.`)) return;
    try { await financeApi.removeProject(p.id); inv(); } catch (e) { showErr(e); }
  }
  async function archiveProject(p: any) {
    try { await financeApi.updateProject(p.id, { archived: true }); inv(); } catch (e) { showErr(e); }
  }
  // «↩» на полученной части: удаляем и операцию, и сам платёж — ячейка снова «+» (как в эталоне).
  async function undoPart(part: any) {
    try {
      if (part.txId) await financeApi.unreceivePlanned(part.plannedId);
      await financeApi.removePlanned(part.plannedId);
      inv();
    } catch (e) { showErr(e); }
  }

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Ожидается" value={money(stats.expected)} />
        <Stat label="Получено на счёт" value={money(stats.receivedCash)} cls="pos" sub={stats.spentOffAccount > 0 ? `освоено вне счёта: ${money(stats.spentOffAccount)}` : undefined} />
        <Stat label="Всего за месяц" value={money(stats.total)} />
      </div>

      {(needPay > 0 || needRest > 0) && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', marginBottom: 12, borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
          <FinIcon name="receipt" size={16} style={{ color: 'var(--amber)' }} />
          {needPay > 0 && <b style={{ color: 'var(--amber)' }}>Получить оплату: {needPay}</b>}
          {needRest > 0 && <b style={{ color: 'var(--accent)' }}>Получить остаток: {needRest}</b>}
          <span className="mini muted">— по сроку оплаты проектов</span>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 150 }}>Проект</th>
              <th>Дата контракта</th>
              <th className="num" style={{ width: 90 }}>Тариф</th>
              <th style={{ minWidth: 170 }}>Часть 1</th>
              <th style={{ minWidth: 170 }}>Часть 2</th>
              <th style={{ minWidth: 118 }}>Полная оплата</th>
              <th style={{ minWidth: 140 }}>Комментарий</th>
              {/* 3 кнопки действий — 76px не хватало, колонка обрезалась. */}
              <th style={{ width: 116 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.project.id}>
                <td>
                  <b>{r.project.name}</b>
                  {r.alert === 'pay' && <div style={{ marginTop: 4 }}><span className="badge wait">получить оплату</span></div>}
                  {r.alert === 'rest' && <div style={{ marginTop: 4 }}><span className="badge transfer">получить остаток</span></div>}
                </td>
                {/* Дата цикла катится по месяцам: контракт 20.01 → в феврале 20.02.
                    После каждой полной оплаты якорь = дата фактической оплаты. */}
                <td className="muted nowrap">{r.cycleDate ? formatDate(r.cycleDate) : (r.project.contractDate ? formatDate(r.project.contractDate) : '—')}</td>
                <td className="num">{money(r.project.tariff)}</td>
                {([1, 2] as const).map((n) => {
                  const p = n === 1 ? r.part1 : r.part2;
                  return (
                    <td key={n}>
                      {!p ? (
                        <button className="btn ghost sm" title="Записать оплату" onClick={() => setPlanFor({ row: r, partNo: n })}><FinIcon name="plus" size={15} /></button>
                      ) : p.status === 'received' ? (
                        <span className="flex">
                          <span className="badge ok"><FinIcon name="check" size={13} /> {money(p.amount)}</span>
                          <button className="btn ghost sm" title="Отменить оплату" onClick={() => undoPart(p)}><FinIcon name="undo" size={15} /></button>
                        </span>
                      ) : (
                        // Срок — второй строкой: ячейка вдвое уже, таблица влезает в окно.
                        <div className="part-cell">
                          <span className="flex">
                            <span className="badge wait">{money(p.amount)}</span>
                            <button className="btn primary sm" onClick={() => setReceive(p)}>Получено</button>
                          </span>
                          {p.dueDate && (
                            <span className={'mini nowrap ' + (p.dueDate < todayISO() ? 'neg' : 'muted')} title="Срок оплаты">
                              до {formatDate(p.dueDate)} · {daysLabel(p.dueDate)}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td>
                  {r.fullyPaid
                    ? (
                      <div>
                        <span className="badge ok">оплачено</span>
                        {r.nextDue?.dueDate && (
                          <div className={'mini nowrap ' + ((daysUntil(r.nextDue.dueDate) ?? 1) < 0 ? 'neg' : 'muted')} style={{ marginTop: 4 }}>
                            след. {money(r.nextDue.amount)} к {formatDate(r.nextDue.dueDate)}
                            <br />{daysLabel(r.nextDue.dueDate)}
                          </div>
                        )}
                      </div>
                    )
                    : <span className="mini muted nowrap">{money(r.paidLife)} / {money(r.project.tariff)}</span>}
                </td>
                <td><NoteCell project={r.project} /></td>
                <RowActions onEdit={() => setEditProject(r.project)} onArchive={() => archiveProject(r.project)} onDelete={() => removeProjectRow(r.project)} />
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2}><b>Итого</b></td>
                <td className="num"><b>{money(totals.tariff)}</b></td>
                <td><b>{money(totals.part1)}</b></td>
                <td><b>{money(totals.part2)}</b></td>
                <td><b>{money(totals.full)}</b></td>
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mini muted" style={{ marginTop: 12 }}>
        Частичная оплата: остаток планируется сам со сроком +20 дней. Полная оплата: дата контракта
        сдвигается на день оплаты, план следующего месяца создаётся автоматически.
      </p>

      <ArchivedProjects projects={data.archived || []} />

      {planFor && <PayPartModal row={planFor.row} partNo={planFor.partNo} ym={ym} onClose={() => setPlanFor(null)} />}
      {receive && <ReceiveModal part={receive} onClose={() => setReceive(null)} />}
      {editProject && <ProjectModal direction="smm" project={editProject} onClose={() => setEditProject(null)} />}
    </>
  );
}

function PayPartModal({ row, partNo, ym, onClose }: { row: any; partNo: 1 | 2; ym: string; onClose: () => void }) {
  const accounts = useAccounts();
  const inv = useInvalidate();
  const project = row.project;
  const [amount, setAmount] = useState(String(partNo === 1 ? project.tariff : 0));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const amt = parseFloat(amount.replace(',', '.'));

  const scheduledMonth = (row.part1?.amount ?? 0) + (row.part2?.amount ?? 0);
  const remaining = project.tariff - scheduledMonth;
  const overLimit = project.tariff > 0 && amt > remaining;

  async function save() {
    if (!(amt > 0) || !accountId || overLimit) return;
    try {
      await financeApi.payNow({ projectId: project.id, ym, partNo, amount: amt, accountId, date });
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Оплата · {project.name} · часть {partNo}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>На счёт</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
          {overLimit
            ? <p className="mini neg">Больше остатка за месяц. Доступно ещё {money(Math.max(0, remaining))} из тарифа {money(project.tariff)}.</p>
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

function ReceiveModal({ part, onClose }: { part: any; onClose: () => void }) {
  const accounts = useAccounts();
  const inv = useInvalidate();
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);

  async function confirmPay() {
    if (!accountId) return;
    try {
      await financeApi.receivePlanned(part.plannedId, { accountId, date });
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-head"><h3>Получено · {money(part.amount)}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
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

// ---------- Development (матрица «проект × месяцы») ----------

function DevSection({ data, direction, archived, onShift }: { data: any; direction: string; archived: any[]; onShift: (months: string[], d: number) => void }) {
  const rows: any[] = data.rows || [];
  const cm = currentYm();

  if (rows.length === 0 && archived.length === 0)
    return <div className="card empty"><div className="big"><FinIcon name="folder" size={30} /></div>Нет проектов — нажмите «＋ Проект»</div>;

  return (
    <>
      {rows.length > 0 ? (
        <>
          <div className="cards grid-3" style={{ marginBottom: 16 }}>
            <Stat label="Ожидается за месяц" value={money(data.stats.expected)} sub={monthLabel(cm, true)} />
            <Stat label="Получено за месяц" value={money(data.stats.received)} cls="pos" sub={monthLabel(cm, true)} />
            <Stat label="Всего сумма" value={money(data.totals.tariff)} sub={`${rows.length} проектов`} />
          </div>
          <MatrixSection rows={rows} months={data.months} totals={data.totals} direction={direction} onShift={onShift} />
        </>
      ) : <div className="card empty">Нет активных проектов</div>}
      <ArchivedProjects projects={archived} />
    </>
  );
}

function MatrixSection({ rows, months, totals, direction, onShift }: { rows: any[]; months: string[]; totals: any; direction: string; onShift: (months: string[], d: number) => void }) {
  const inv = useInvalidate();
  const [cellFor, setCellFor] = useState<{ row: any; ym: string; plan?: any } | null>(null);
  const [editProject, setEditProject] = useState<any>(null);

  async function removeProjectRow(p: any) {
    if (!confirm(`Удалить проект «${p.name}»? Удалятся его плановые оплаты и доходные операции.`)) return;
    try { await financeApi.removeProject(p.id); inv(); } catch (e) { showErr(e); }
  }
  async function archiveProject(p: any) {
    try { await financeApi.updateProject(p.id, { archived: true }); inv(); } catch (e) { showErr(e); }
  }

  const monthTotal = (m: string) => (totals.perMonth || []).find((x: any) => x.ym === m)?.total ?? 0;
  const cellOf = (row: any, m: string) => (row.cells || []).find((c: any) => c.ym === m);

  return (
    <>
      <div className="toolbar">
        <div className="month-nav">
          <button onClick={() => onShift(months, -1)} title="Раньше">‹</button>
          <span className="label" style={{ minWidth: 170, textTransform: 'none' }}>{monthLabel(months[0])} – {monthLabel(months[5])}</span>
          <button onClick={() => onShift(months, 1)} title="Позже">›</button>
        </div>
        <span className="mini muted">Ячейка — поступление за месяц. «+» добавляет план или сразу оплату.</span>
      </div>

      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 190 }}>Проект</th>
              <th className="num" style={{ width: 96 }}>Сумма</th>
              {months.map((m) => <th key={m} className="num" style={{ textTransform: 'capitalize', minWidth: 84 }}>{monthLabel(m)}</th>)}
              <th style={{ minWidth: 160 }}>Комментарий</th>
              <th style={{ width: 124 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = r.project;
              const pct = p.tariff ? Math.min(100, Math.round((r.paidLife / p.tariff) * 100)) : 0;
              return (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    <div className="progress" style={{ marginTop: 6 }}><i style={{ width: pct + '%' }} /></div>
                    <span className="mini muted">{money(r.paidLife)} / {money(p.tariff)}</span>
                  </td>
                  <td className="num">{money(p.tariff)}</td>
                  {months.map((m) => {
                    const cell = cellOf(r, m);
                    const plans: any[] = cell?.plans || [];
                    return (
                      <td key={m} className="num">
                        {plans.length === 0 ? (
                          <button className="btn ghost sm" title="Добавить поступление" onClick={() => setCellFor({ row: r, ym: m })}><FinIcon name="plus" size={14} /></button>
                        ) : (
                          <div className="flex" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }}>
                            {plans.map((pl) => (
                              <button
                                key={pl.id}
                                className={'badge ' + (pl.status === 'received' ? 'ok' : 'wait')}
                                style={{ cursor: 'pointer' }}
                                title={pl.status === 'received' ? 'Получено — нажмите для управления' : 'Запланировано — нажмите, чтобы отметить оплату'}
                                onClick={() => setCellFor({ row: r, ym: m, plan: pl })}
                              >
                                {pl.status === 'received' && <FinIcon name="check" size={12} />} {money(pl.amount)}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td><NoteCell project={p} /></td>
                  <RowActions onEdit={() => setEditProject(p)} onArchive={() => archiveProject(p)} onDelete={() => removeProjectRow(p)} />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td><b>Итого</b></td>
              <td className="num"><b>{money(totals.tariff)}</b></td>
              {months.map((m) => <td key={m} className="num"><b>{money(monthTotal(m))}</b></td>)}
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {cellFor && <CellModal row={cellFor.row} ym={cellFor.ym} plan={cellFor.plan} onClose={() => setCellFor(null)} />}
      {editProject && <ProjectModal direction={direction} project={editProject} onClose={() => setEditProject(null)} />}
    </>
  );
}

function CellModal({ row, ym, plan, onClose }: { row: any; ym: string; plan?: any; onClose: () => void }) {
  const accounts = useAccounts();
  const inv = useInvalidate();
  const project = row.project;
  const [amount, setAmount] = useState(String(plan?.amount ?? ''));
  const [paidNow, setPaidNow] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const amt = parseFloat(amount.replace(',', '.'));
  const monthName = monthLabel(ym, true);

  const remaining = project.tariff - (row.scheduledLife ?? 0);
  const overLimit = project.tariff > 0 && amt > remaining;

  async function saveNew() {
    if (!(amt > 0) || overLimit) return;
    try {
      if (paidNow) {
        if (!accountId) return;
        await financeApi.payNow({ projectId: project.id, ym, amount: amt, accountId, date });
      } else {
        await financeApi.createPlanned({ projectId: project.id, ym, amount: amt });
      }
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }
  async function markReceived() {
    if (!plan || !accountId) return;
    try { await financeApi.receivePlanned(plan.id, { accountId, date }); inv(); onClose(); } catch (e) { showErr(e); }
  }
  async function deletePlan() {
    if (!plan) return;
    try { await financeApi.removePlanned(plan.id); inv(); onClose(); } catch (e) { showErr(e); }
  }
  async function undo() {
    if (!plan) return;
    try { await financeApi.unreceivePlanned(plan.id); inv(); onClose(); } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{project.name} · {monthName}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        {plan ? (
          <>
            <div className="modal-body">
              {plan.status === 'received' ? (
                <p>Поступление <b>{money(plan.amount)}</b> отмечено как полученное.</p>
              ) : (
                <>
                  <p>Запланировано <b>{money(plan.amount)}</b>. Отметить как полученное?</p>
                  <div className="form-grid">
                    <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                    <div className="field"><label>На счёт</label><select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              {plan.status === 'received'
                ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={undo}>Отменить оплату</button>
                : <button className="btn danger" style={{ marginRight: 'auto' }} onClick={deletePlan}>Удалить план</button>}
              <button className="btn ghost" onClick={onClose}>Закрыть</button>
              {plan.status === 'expected' && <button className="btn primary" onClick={markReceived}>Отметить полученным</button>}
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
                ? <p className="mini neg">Больше остатка по проекту. Доступно ещё {money(Math.max(0, remaining))} из {money(project.tariff)}.</p>
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

// ---------- Design (разовые работы + брендбуки) ----------

function DesignSection({ data, direction, archived, onShift }: { data: any; direction: string; archived: any[]; onShift: (months: string[], d: number) => void }) {
  const inv = useInvalidate();
  const [payFor, setPayFor] = useState<any>(null);   // simple row
  const [workFor, setWorkFor] = useState<any>(null); // 'new' | simple row
  const simple: any[] = data.simple || [];
  const matrixRows: any[] = data.matrix?.rows || [];
  const cm = currentYm();

  if (simple.length === 0 && matrixRows.length === 0 && archived.length === 0)
    return <div className="card empty"><div className="big"><FinIcon name="folder" size={30} /></div>Нет проектов — нажмите «＋ Проект»</div>;

  async function archiveProject(p: any) {
    try { await financeApi.updateProject(p.id, { archived: true }); inv(); } catch (e) { showErr(e); }
  }

  return (
    <>
      <div className="cards grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Ожидается за месяц" value={money(data.stats.expected)} sub={monthLabel(cm, true)} />
        <Stat label="Получено за месяц" value={money(data.stats.received)} cls="pos" sub={monthLabel(cm, true)} />
        <Stat label="Всего сумма" value={money(data.stats.total)} sub={`${simple.length + matrixRows.length} проектов`} />
      </div>

      <div className="between" style={{ marginTop: 8, marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Разовые работы</div>
        <button className="btn sm" onClick={() => setWorkFor('new')}><FinIcon name="plus" size={14} /> Добавить работу</button>
      </div>

      {simple.length === 0 ? (
        <div className="card empty" style={{ padding: 28 }}>Нет разовых работ — нажмите «＋ Добавить работу»</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Название</th>
                <th>Дата</th>
                <th className="num" style={{ width: 96 }}>Сумма</th>
                <th style={{ minWidth: 170 }}>Комментарий</th>
                <th style={{ minWidth: 140 }}>Статус</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {simple.map((r) => (
                <tr key={r.project.id} onDoubleClick={() => setWorkFor(r)}>
                  <td><b>{r.project.name}</b></td>
                  <td className="muted">{r.project.contractDate ? formatDate(r.project.contractDate) : '—'}</td>
                  <td className="num">{money(r.project.tariff)}</td>
                  <td><NoteCell project={r.project} /></td>
                  <td>
                    {/* «Оплачено» — только при полной сумме; частичная оплата оставляет кнопку. */}
                    {r.project.tariff > 0 && (Number(r.paid) || 0) >= r.project.tariff
                      ? <span className="badge ok"><FinIcon name="check" size={13} /> оплачено</span>
                      : <button className="btn primary sm" onClick={() => setPayFor(r)}>Записать оплату</button>}
                  </td>
                  <td className="num nowrap">
                    <button className="btn ghost sm" title="Редактировать" onClick={() => setWorkFor(r)}><FinIcon name="edit" size={15} /></button>
                    <button className="btn ghost sm" title="В архив (больше не работаем)" onClick={() => archiveProject(r.project)}><FinIcon name="archive" size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matrixRows.length > 0 && (
        <>
          <div className="section-title">Брендбуки и логобуки · оплата по месяцам</div>
          <MatrixSection rows={matrixRows} months={data.matrix.months || data.months} totals={data.matrix.totals} direction={direction} onShift={onShift} />
        </>
      )}

      <ArchivedProjects projects={archived} />

      {payFor && <RecordIncomeModal row={payFor} onClose={() => setPayFor(null)} />}
      {workFor && <WorkModal row={workFor === 'new' ? undefined : workFor} onClose={() => setWorkFor(null)} />}
    </>
  );
}

function WorkModal({ row, onClose }: { row?: any; onClose: () => void }) {
  const inv = useInvalidate();
  const work = row?.project;
  const paid = row?.paidLife ?? 0;
  const [name, setName] = useState(work?.name ?? '');
  const [tariff, setTariff] = useState(work ? String(work.tariff) : '');
  const [date, setDate] = useState(work?.contractDate ?? todayISO());
  const [note, setNote] = useState(work?.note ?? '');
  const amt = parseFloat(tariff.replace(',', '.'));

  async function save() {
    if (!name.trim()) return;
    const p: any = {
      name: name.trim(), tariff: amt > 0 ? amt : 0,
      contractDate: date || undefined, note: note.trim() || undefined, multiMonth: false,
    };
    try {
      if (work) await financeApi.updateProject(work.id, p);
      else await financeApi.createProject({ direction: 'design', ...p });
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }
  // Отмена оплаты работы: удаляем оплаченные поступления проекта вместе с их доходными операциями.
  async function cancelPayment() {
    if (!work || !confirm('Отменить оплату по этой работе? Доход будет удалён.')) return;
    try {
      const plans: any[] = await financeApi.plannedPayments({ projectId: work.id });
      for (const pl of plans) {
        if (pl.status === 'received' && pl.receivedTxId) await financeApi.unreceivePlanned(pl.id);
        await financeApi.removePlanned(pl.id);
      }
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }
  async function remove() {
    if (!work || !confirm('Удалить работу?')) return;
    try { await financeApi.removeProject(work.id); inv(); onClose(); } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{work ? 'Работа' : 'Новая работа'}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Логотип, флаеры…" /></div>
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} /></div>
            <div className="field"><label>Дата</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>Комментарий</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {work && paid > 0 && (
            <div className="flex between" style={{ background: 'var(--green-soft)', padding: '9px 12px', borderRadius: 9 }}>
              <span className="mini pos">Оплачено {money(paid)}</span>
              <button className="btn danger sm" onClick={cancelPayment}><FinIcon name="undo" size={14} /> Отменить оплату</button>
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

function RecordIncomeModal({ row, onClose }: { row: any; onClose: () => void }) {
  const accounts = useAccounts();
  const inv = useInvalidate();
  const project = row.project;
  const remaining = Math.max(0, project.tariff - (row.paidLife ?? 0));
  const [amount, setAmount] = useState(String(remaining || project.tariff));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const amt = parseFloat(amount.replace(',', '.'));
  const overLimit = project.tariff > 0 && amt > remaining;

  async function save() {
    if (!(amt > 0) || !accountId || overLimit) return;
    try {
      await financeApi.payNow({ projectId: project.id, ym: ymOf(date), amount: amt, accountId, date });
      inv();
      onClose();
    } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Оплата · {project.name}</h3><button className="btn ghost sm" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="field"><label>Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Дата оплаты</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field"><label>На счёт</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
          {overLimit && <p className="mini neg">Больше остатка. Доступно ещё {money(remaining)} из {money(project.tariff)}.</p>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!(amt > 0) || !accountId || overLimit} onClick={save}>Записать оплату</button>
        </div>
      </div>
    </div>
  );
}
