// Транзакции /finance/transactions — журнал с Notion-инлайн-редактированием
// (порт fin-webrand/src/pages/Transactions.tsx, ТЗ «Этап 5»).
// Таблица — серверная пагинация/поиск/фильтр; календарь грузит свой месяц.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { TYPE_LABEL, money, moneyBare, currentYm, todayISO, formatDate, monthLabel, apiErr, downloadCsv , useYmParam } from './finlib';
import FinIcon, { CatIcon } from './FinIcon';
import MonthNav from './MonthNav';
import TransactionModal from './TransactionModal';
import TransactionDetailsPanel from './TransactionDetailsModal';
import ImportedArchiveBadge, { IMPORTED_ARCHIVE_HINT, isImportedArchive } from './ImportedArchiveBadge';
import { FinLoading, FinLoadError, finConfirm, invalidateFinance } from './FinKit';
import { financeApi } from '@/services/api.service';
import { AccountLabel } from './AccountIdentity';

const TYPES = ['income', 'expense', 'transfer', 'saving'];
const PAGE_SIZE = 50;

export function buildFinanceTransactionCsv(items: any[]): Array<Array<string | number | null>> {
  return [
    ['Дата', 'Статус', 'Тип', 'Категория', 'Описание', 'Сумма', 'Со счёта', 'На счёт', 'Проект', 'Сотрудник', 'Месяц ЗП', 'Долг', 'Источник'],
    ...items.map((t: any) => [
      String(t.date || '').slice(0, 10),
      t.status === 'cancelled' ? 'Отменено' : String(t.date || '').slice(0, 10) > todayISO() ? 'Запланировано' : 'Проведено',
      TYPE_LABEL[t.type] ?? t.type, t.categoryName, t.comment,
      t.amount, ['transfer', 'saving'].includes(t.type) ? t.fromAccountName : (t.type === 'expense' ? t.accountName : null),
      ['transfer', 'saving'].includes(t.type) ? t.toAccountName : (t.type !== 'expense' ? t.accountName : null),
      t.projectName, t.employeeName, t.employeeId ? (t.salaryYm ?? String(t.date || '').slice(0, 7)) : null, t.debtName,
      isImportedArchive(t) ? 'Notion · архив' : null,
    ]),
  ];
}

export default function FinanceTransactionsPage() {
  const qc = useQueryClient();
  const [urlParams, setUrlParams] = useSearchParams();
  const [q, setQ] = useState(() => urlParams.get('q') || '');
  const [dq, setDq] = useState(() => urlParams.get('q') || ''); // дебаунс поиска — не дёргаем сервер на каждый символ
  const [typeFilter, setTypeFilter] = useState(() => urlParams.get('type') || '');
  const [statusFilter, setStatusFilter] = useState(() => urlParams.get('status') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(urlParams.get('page')) || 1));
  const [addType, setAddType] = useState<string | null>(null);
  // Вид: журнал-таблица или календарь месяца (карточки операций по дням).
  const [view, setView] = useState<'table' | 'calendar'>(() => urlParams.get('view') === 'calendar' ? 'calendar' : 'table');
  const [calYm, setCalYm] = useYmParam();
  const [editTx, setEditTx] = useState<any>(null);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);
  // Back/forward restores the journal exactly as it was: filters, view and page
  // are URL state, while q stays local only during the debounce window.
  useEffect(() => {
    const nextQ = urlParams.get('q') || '';
    setQ(nextQ);
    setDq(nextQ);
    setTypeFilter(urlParams.get('type') || '');
    setStatusFilter(urlParams.get('status') || '');
    setView(urlParams.get('view') === 'calendar' ? 'calendar' : 'table');
    setPage(Math.max(1, Number(urlParams.get('page')) || 1));
  }, [urlParams]);
  useEffect(() => {
    const next = new URLSearchParams(urlParams);
    const sync = (key: string, value: string) => value ? next.set(key, value) : next.delete(key);
    sync('q', dq); sync('type', typeFilter); sync('status', statusFilter);
    sync('view', view === 'calendar' ? 'calendar' : '');
    sync('page', page > 1 ? String(page) : '');
    if (next.toString() !== urlParams.toString()) setUrlParams(next, { replace: true });
  }, [dq, typeFilter, statusFilter, view, page, urlParams, setUrlParams]);

  const txQ = useQuery({
    queryKey: ['finance', 'transactions', { page, dq, typeFilter, statusFilter }],
    queryFn: () => financeApi.transactions({
      page,
      pageSize: PAGE_SIZE,
      search: dq || undefined,
      type: typeFilter || undefined,
      status: statusFilter && statusFilter !== 'all' ? statusFilter : undefined,
    }),
    placeholderData: (prev: any) => prev, // при листании не мигаем пустотой
  });
  // Календарь берёт СВОЙ месяц целиком — в постраничном журнале месяца может не быть.
  const calQ = useQuery({
    queryKey: ['finance', 'transactions', 'month', calYm, statusFilter],
    queryFn: () => {
      const [y, m] = calYm.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      return financeApi.transactions({
        from: `${calYm}-01`,
        to: `${calYm}-${String(last).padStart(2, '0')}`,
        pageSize: 1000,
        status: statusFilter && statusFilter !== 'all' ? statusFilter : undefined,
      });
    },
    enabled: view === 'calendar',
  });
  const calData = calQ.data;
  const txns: any[] = txQ.data?.items ?? [];
  const total: number = txQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const matches = (t: any) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (statusFilter === 'cancelled' && t.status !== 'cancelled') return false;
    if (!statusFilter && t.status === 'cancelled') return false;
    if (dq) {
      const hay = [t.comment, t.categoryName].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(dq.toLowerCase())) return false;
    }
    return true;
  };
  const calTxns = ((calData?.items ?? []) as any[]).filter(matches);
  const expandedTx = [...txns, ...calTxns].find((t: any) => t.id === expandedTxId) ?? null;

  function toggleDetails(t: any) {
    setExpandedTxId((current) => current === t.id ? null : t.id);
  }

  function closeDetails(id: string) {
    setExpandedTxId(null);
    requestAnimationFrame(() => document.getElementById(`finance-tx-row-${id}`)?.focus());
  }

  function editFromDetails(t: any) {
    setExpandedTxId(null);
    setEditTx(t);
  }

  async function remove(id: string) {
    try {
      await financeApi.removeTransaction(id);
      invalidateFinance(qc);
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  /** Выгрузка CSV по текущему фильтру — сервер отдаёт все страницы разом. */
  async function exportCsv() {
    try {
      const res = await financeApi.transactions({
        pageSize: 100000,
        search: dq || undefined,
        type: typeFilter || undefined,
        status: statusFilter && statusFilter !== 'all' ? statusFilter : undefined,
      });
      const rows = buildFinanceTransactionCsv((res?.items ?? []) as any[]);
      downloadCsv(`transactions-${todayISO()}.csv`, rows);
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  return (
    <div className="fin-root">
      <div className="page-head">
        <div><h1 className="flex"><FinIcon name="transactions" size={22} /> Транзакции</h1><p>Журнал операций — нажмите на строку для подробностей и редактирования</p></div>
        <div className="flex">
          <button className="btn" style={{ color: 'var(--green)' }} onClick={() => setAddType('income')}><FinIcon name="plus" size={15} /> Доход</button>
          <button className="btn" style={{ color: 'var(--red)' }} onClick={() => setAddType('expense')}><FinIcon name="plus" size={15} /> Расход</button>
          <button className="btn" style={{ color: 'var(--accent)' }} onClick={() => setAddType('transfer')}><FinIcon name="plus" size={15} /> Трансфер</button>
        </div>
      </div>
      {addType && <TransactionModal initialType={addType} onClose={() => setAddType(null)} />}

      <div className="toolbar">
        <div className="view-toggle" role="group" aria-label="Вид журнала">
          <button className={view === 'table' ? 'active' : ''} aria-pressed={view === 'table'}
            onClick={() => { setView('table'); setExpandedTxId(null); }}><FinIcon name="transactions" size={13} /> Таблица</button>
          <button className={view === 'calendar' ? 'active' : ''} aria-pressed={view === 'calendar'}
            onClick={() => { setView('calendar'); setExpandedTxId(null); }}><FinIcon name="overview" size={13} /> Календарь</button>
        </div>
        {view === 'calendar' && <MonthNav ym={calYm} onChange={setCalYm} />}
        <input aria-label="Поиск транзакций" className="grow" style={{ maxWidth: 300 }} placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Тип транзакции" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} style={{ width: 150 }}>
          <option value="">Все типы</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select aria-label="Статус транзакции" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 160 }}>
          <option value="">Действующие</option>
          <option value="cancelled">Отменённые</option>
          <option value="all">Все статусы</option>
        </select>
        {view === 'table' && (
          <>
            <span className="muted mini">{total} операций{[dq, typeFilter, statusFilter].filter(Boolean).length ? ` · фильтров: ${[dq, typeFilter, statusFilter].filter(Boolean).length}` : ''}</span>
            <button className="btn sm" onClick={exportCsv} title="Выгрузить текущий фильтр в CSV"><FinIcon name="download" size={14} /> CSV</button>
          </>
        )}
      </div>

      {view === 'calendar' && calQ.isLoading ? (
        <FinLoading />
      ) : view === 'calendar' && calQ.isError ? (
        <FinLoadError onRetry={() => calQ.refetch()} text="Не удалось загрузить операции календаря." />
      ) : view === 'calendar' ? (
        <>
          <TxCalendar ym={calYm} txns={calTxns} expandedTxId={expandedTxId} onToggle={toggleDetails} onAdd={setAddDate} />
          {expandedTx && <div className="fin-tx-calendar-details"><TransactionDetailsPanel
            id={`finance-tx-details-${expandedTx.id}`} transaction={expandedTx}
            onClose={() => closeDetails(expandedTx.id)} onEdit={editFromDetails} /></div>}
        </>
      ) : txQ.isLoading ? (
        <FinLoading />
      ) : txQ.isError ? (
        <FinLoadError onRetry={() => txQ.refetch()} />
      ) : txns.length === 0 ? (
        <div className="card empty"><div className="big"><FinIcon name="wallet" size={30} /></div>{dq || typeFilter || statusFilter ? 'Ничего не найдено по фильтру' : 'Нет операций — добавьте кнопками сверху'}</div>
      ) : (
        <>
          <div className="table-wrap fin-wide-table fin-mobile-cards fin-transactions-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Дата</th>
                  <th style={{ width: 120 }}>Тип</th>
                  <th style={{ width: 170 }}>Категория</th>
                  <th style={{ minWidth: 200 }}>Описание</th>
                  <th className="num" style={{ width: 120 }}>Сумма</th>
                  <th style={{ width: 130 }}>Со счёта</th>
                  <th style={{ width: 130 }}>На счёт</th>
                  <th style={{ width: 120 }} title="Месяц начисления зарплаты — за какой месяц выплата">Месяц ЗП</th>
                  <th style={{ width: 88 }} />
                </tr>
              </thead>
              <tbody>
                {txns.map((t: any) => (
                  <TxRow key={t.id} t={t} remove={remove}
                    expanded={expandedTxId === t.id} onToggle={toggleDetails} onClose={closeDetails} onEdit={editFromDetails} />
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex" style={{ justifyContent: 'center', marginTop: 12, gap: 10 }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Новее</button>
              <span className="mini muted">стр. {page} из {pages}</span>
              <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Старее →</button>
            </div>
          )}
        </>
      )}

      {editTx && <TransactionModal initial={editTx} onClose={() => setEditTx(null)} />}
      {addDate && <TransactionModal initialDate={addDate} onClose={() => setAddDate(null)} />}
    </div>
  );
}

/** Календарь месяца: операции строками по дням, итоги дня и месяца.
 *  Клик по строке — подробности, «+» в дне — новая операция этой датой,
 *  длинные дни сворачиваются до 5 строк («ещё N»). */
const CAL_DAY_LIMIT = 5;
function TxCalendar({ ym, txns, expandedTxId, onToggle, onAdd }: {
  ym: string; txns: any[]; expandedTxId: string | null; onToggle: (t: any) => void; onAdd: (iso: string) => void;
}) {
  const [y, m] = ym.split('-').map(Number);
  const firstIdx = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Пн = 0
  const daysIn = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array(firstIdx).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  // Развёрнутость длинных дней; ключ — полная дата, месяцы не пересекаются.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const toggleDay = (iso: string) => setOpenDays((s) => ({ ...s, [iso]: !s[iso] }));

  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of txns) {
      const k = String(t.date || '').slice(0, 10);
      if (k.slice(0, 7) !== ym) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return map;
  }, [txns, ym]);

  // Итоги дня/месяца — только реальные деньги (доход/расход, без переводов).
  const totals = useMemo(() => {
    const day = new Map<string, { inc: number; exp: number }>();
    let inc = 0, exp = 0, plannedInc = 0, plannedExp = 0, count = 0;
    for (const [k, list] of byDay) {
      const t = { inc: 0, exp: 0 };
      for (const x of list) {
        if (x.status === 'cancelled') continue;
        const future = String(x.date || '').slice(0, 10) > todayISO();
        if (x.type === 'income') {
          if (future) plannedInc += Number(x.amount) || 0;
          else t.inc += Number(x.amount) || 0;
        } else if (x.type === 'expense') {
          if (future) plannedExp += Number(x.amount) || 0;
          else t.exp += Number(x.amount) || 0;
        }
      }
      day.set(k, t);
      inc += t.inc; exp += t.exp; count += list.length;
    }
    return { day, inc, exp, plannedInc, plannedExp, count };
  }, [byDay]);

  const today = todayISO();
  const net = totals.inc - totals.exp;

  return (
    <>
      <div className="tx-cal-wrap">
        <div className="tx-cal-top">
          <div className="sums">
            <span className="pos">+{money(totals.inc)}</span>
            <span className="neg">−{money(totals.exp)}</span>
            <span className={'net ' + (net >= 0 ? 'pos' : 'neg')}>{money(net, true)}</span>
            {(totals.plannedInc > 0 || totals.plannedExp > 0) && (
              <span className="muted mini">
                план: +{moneyBare(totals.plannedInc)} / −{moneyBare(totals.plannedExp)}
              </span>
            )}
          </div>
          <span className="mini muted">{totals.count} операций за месяц</span>
        </div>
        <div className="tx-cal">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, i) => (
            <div key={d} className={'tx-cal-h' + (i >= 5 ? ' wknd' : '')}>{d}</div>
          ))}
          {cells.map((iso, i) => {
            const list = iso ? (byDay.get(iso) ?? []) : [];
            const open = iso ? !!openDays[iso] : false;
            // Строго максимум 5 строк в дне — остальное под «ещё N».
            const collapsible = list.length > CAL_DAY_LIMIT;
            const visible = collapsible && !open ? list.slice(0, CAL_DAY_LIMIT) : list;
            const dt = iso ? totals.day.get(iso) : undefined;
            return (
              <div key={i} className={'tx-cal-cell' + (iso ? '' : ' off') + (iso === today ? ' today' : '') + (i % 7 >= 5 ? ' wknd' : '')}>
                {iso && (
                  <>
                    <div className="tx-cal-day">
                      <span className="n">{Number(iso.slice(8))}</span>
                      <button className="tx-cal-add" title="Добавить операцию этой датой" onClick={() => onAdd(iso)}>＋</button>
                    </div>
                    {dt && (dt.inc > 0 || dt.exp > 0) && (
                      <div className="tx-day-sum">
                        {dt.inc > 0 && <span className="pos">+{moneyBare(dt.inc)}</span>}
                        {dt.exp > 0 && <span className="neg">−{moneyBare(dt.exp)}</span>}
                      </div>
                    )}
                    {visible.map((t) => {
                      const content = <>
                        <i className="d" />
                        <span className="t">{t.comment || t.categoryName || TYPE_LABEL[t.type]}</span>
                        {isImportedArchive(t) && <ImportedArchiveBadge compact />}
                        <span className={'a ' + (t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : 'muted')}>
                          {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}{moneyBare(t.amount)}
                        </span>
                      </>;
                      return (
                        <button key={t.id} type="button" className={'tx-row ' + t.type + (isImportedArchive(t) ? ' imported' : '')}
                          id={`finance-tx-row-${t.id}`} aria-expanded={expandedTxId === t.id}
                          aria-controls={expandedTxId === t.id ? `finance-tx-details-${t.id}` : undefined}
                          title={isImportedArchive(t)
                            ? `${t.comment || t.categoryName || TYPE_LABEL[t.type]} · ${money(t.amount)} · ${IMPORTED_ARCHIVE_HINT}`
                            : `${String(t.date || '').slice(0, 10) > today ? 'Запланировано · ' : ''}${t.comment || t.categoryName || TYPE_LABEL[t.type]} · ${money(t.amount)}`}
                          onClick={() => onToggle(t)}>
                          {content}
                        </button>
                      );
                    })}
                    {collapsible && (
                      <button className="tx-cal-more" onClick={() => toggleDay(iso)}>
                        {open ? 'свернуть' : `ещё ${list.length - CAL_DAY_LIMIT}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mini muted fin-table-note">Строка — открыть операцию · «＋» в дне — добавить этой датой.</p>
    </>
  );
}

function TxRow({ t, remove, expanded, onToggle, onClose, onEdit }: {
  t: any; remove: (id: string) => void;
  expanded: boolean; onToggle: (t: any) => void; onClose: (id: string) => void; onEdit: (t: any) => void;
}) {
  if (isImportedArchive(t)) return <ImportedTxRow t={t} expanded={expanded} onToggle={onToggle} onClose={onClose} />;

  const cancelled = t.status === 'cancelled';
  const fromActive = t.type === 'expense' || t.type === 'transfer' || t.type === 'saving';
  const toActive = t.type === 'income' || t.type === 'transfer' || t.type === 'saving';
  const paired = t.type === 'transfer' || t.type === 'saving';
  const fromName = paired ? t.fromAccountName : t.type === 'expense' ? t.accountName : null;
  const toName = paired ? t.toAccountName : t.type === 'income' ? t.accountName : null;

  async function confirmRemove() {
    if (await finConfirm(
      `Отменить операцию «${t.comment || t.categoryName || TYPE_LABEL[t.type]}» на ${money(t.amount)}? Она останется в журнале, а балансы счетов пересчитаются.`,
      { title: 'Отмена операции', danger: true, confirmLabel: 'Отменить операцию' },
    )) remove(t.id);
  }

  return (
    <Fragment>
    <tr id={`finance-tx-row-${t.id}`} tabIndex={0} aria-expanded={expanded}
      aria-controls={expanded ? `finance-tx-details-${t.id}` : undefined}
      aria-label={`${expanded ? 'Свернуть' : 'Открыть'} подробности операции — ${t.comment || t.categoryName || TYPE_LABEL[t.type]}`}
      className={'fin-tx-openable' + (expanded ? ' expanded' : '') + (cancelled ? ' fin-tx-cancelled' : '')}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, summary, details')) onToggle(t); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(t); } }}>
      <td data-label="Дата"><span className="nowrap">{formatDate(t.date)}</span></td>
      <td data-label="Тип"><span className={`badge ${t.type}`}>{TYPE_LABEL[t.type] ?? t.type}</span></td>
      <td data-label="Категория">
        {t.type === 'transfer' ? <span className="muted mini">—</span> : <span className="flex fin-tx-static-category">
          {(t.categoryIcon || t.categoryColor) && <CatIcon icon={t.categoryIcon} color={t.categoryColor} size={24} />}
          <span>{t.categoryName || t.category || 'Без категории'}</span>
        </span>}
      </td>
      <td data-label="Описание"><span>{t.comment || t.description || 'Без описания'}</span></td>
      <td className="num" data-label="Сумма"><b className={t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : ''}>
        {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}{money(t.amount)}
      </b></td>
      <td data-label="Со счёта">{fromActive && fromName ? <AccountLabel name={fromName} compact /> : <span className="muted mini">—</span>}</td>
      <td data-label="На счёт">{toActive && toName ? <AccountLabel name={toName} compact /> : <span className="muted mini">—</span>}</td>
      <td data-label="Месяц ЗП">{t.employeeId ? <span className="nowrap">{monthLabel(t.salaryYm ?? String(t.date || '').slice(0, 7), true)}</span> : <span className="muted mini">—</span>}</td>
      <td className="num" data-label="Действия">
        {cancelled ? <span className="badge wait">Отменено</span> : <details className="fin-row-menu" onClick={(event) => event.stopPropagation()}>
          <summary aria-label={`Действия операции «${t.comment || t.categoryName || TYPE_LABEL[t.type]}»`} title="Действия"><FinIcon name="dots" size={16} /></summary>
          <div className="fin-row-menu-pop">
            <button type="button" onClick={() => onToggle(t)}><FinIcon name="info" size={14} /> {expanded ? 'Свернуть' : 'Подробнее'}</button>
            <button type="button" onClick={() => onEdit(t)}><FinIcon name="edit" size={14} /> Редактировать</button>
            <button type="button" className="danger" onClick={confirmRemove}><FinIcon name="undo" size={14} /> Отменить операцию</button>
          </div>
        </details>}
      </td>
    </tr>
    {expanded && <tr className="fin-tx-details-row"><td colSpan={9}><TransactionDetailsPanel
      id={`finance-tx-details-${t.id}`} transaction={t} onClose={() => onClose(t.id)} onEdit={onEdit} /></td></tr>}
    </Fragment>
  );
}

/** Архив Notion — только для чтения. Это не банковская проводка CRM:
 *  сохраняем строку в журнале/CSV, но исключаем любые способы её изменить. */
function ImportedTxRow({ t, expanded, onToggle, onClose }: {
  t: any; expanded: boolean; onToggle: (t: any) => void; onClose: (id: string) => void;
}) {
  const paired = t.type === 'transfer' || t.type === 'saving';
  const fromName = paired ? t.fromAccountName : t.type === 'expense' ? t.accountName : null;
  const toName = paired ? t.toAccountName : t.type === 'income' ? t.accountName : null;
  return <Fragment>
    <tr id={`finance-tx-row-${t.id}`} className={'fin-tx-imported fin-tx-openable' + (expanded ? ' expanded' : '')}
      title={`${IMPORTED_ARCHIVE_HINT} · нажмите, чтобы посмотреть подробности`} tabIndex={0}
      aria-expanded={expanded} aria-controls={expanded ? `finance-tx-details-${t.id}` : undefined}
      onClick={() => onToggle(t)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(t); } }}>
      <td data-label="Дата"><span className="nowrap">{formatDate(t.date)}</span></td>
      <td data-label="Тип"><span className={`badge ${t.type}`}>{TYPE_LABEL[t.type] ?? t.type}</span></td>
      <td data-label="Категория">
        {t.type === 'transfer'
          ? <span className="muted mini">—</span>
          : (
            <span className="flex fin-tx-static-category">
              {(t.categoryIcon || t.categoryColor) && <CatIcon icon={t.categoryIcon} color={t.categoryColor} size={24} />}
              <span>{t.categoryName || t.category || '—'}</span>
            </span>
          )}
      </td>
      <td data-label="Описание">
        <div className="fin-tx-imported-description">
          <span>{t.comment || t.description || 'Архивная операция'}</span>
          <ImportedArchiveBadge />
        </div>
      </td>
      <td className="num" data-label="Сумма"><b>{money(t.amount)}</b></td>
      <td data-label="Со счёта">{fromName ? <AccountLabel name={fromName} compact /> : <span className="muted mini">—</span>}</td>
      <td data-label="На счёт">{toName ? <AccountLabel name={toName} compact /> : <span className="muted mini">—</span>}</td>
      <td data-label="Месяц ЗП">{t.employeeId && t.salaryYm
        ? <span className="nowrap">{monthLabel(t.salaryYm, true)}</span>
        : <span className="muted mini">—</span>}</td>
      <td className="num" data-label="Действия"><button className="btn ghost sm" title={expanded ? 'Свернуть' : 'Подробнее'}
        aria-label={expanded ? 'Свернуть подробности операции' : 'Подробнее об операции'}
        onClick={(e) => { e.stopPropagation(); onToggle(t); }}><FinIcon name="info" size={14} /></button></td>
    </tr>
    {expanded && <tr className="fin-tx-details-row"><td colSpan={9}><TransactionDetailsPanel
      id={`finance-tx-details-${t.id}`} transaction={t} onClose={() => onClose(t.id)} /></td></tr>}
  </Fragment>;
}
