// Активность финансов: кто, что и когда изменил (журнал пишется бэкендом
// на каждое успешное изменение в разделе). Только чтение.
import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { FinLoading, FinLoadError } from './FinKit';
import FinIcon from './FinIcon';
import { money, formatDate, monthLabel } from './finlib';
import './finance.css';

const PAGE = 50;

/** Человекочитаемые ключи деталей журнала. */
const DETAIL_LABELS: Record<string, string> = {
  amount: 'Сумма', date: 'Дата операции', ym: 'Месяц', comment: 'Комментарий',
  type: 'Тип', name: 'Название', employeeId: 'Сотрудник', projectId: 'Проект',
  accountId: 'Счёт', fromAccountId: 'Со счёта', toAccountId: 'На счёт',
  categoryId: 'Категория', debtId: 'Долг', subscriptionId: 'Подписка',
  assetId: 'Инвентарь', id: 'Объект', salary: 'Оклад', salaryYm: 'Месяц ЗП',
  role: 'Должность', status: 'Статус', kind: 'Вид выплаты',
  tariff: 'Тариф', dueDate: 'Срок', contractDate: 'Дата договора',
  hireDate: 'Дата приёма', terminationDate: 'Дата увольнения',
  archived: 'В архиве', active: 'Активно', affectsBalance: 'Влияет на баланс',
  note: 'Примечание', partNo: 'Часть оплаты', totalAmount: 'Сумма долга',
  monthlyPayment: 'Платёж в месяц', startBalance: 'Начальный баланс',
  direction: 'Направление', category: 'Группа', price: 'Стоимость',
  assignee: 'Ответственный', purchaseDate: 'Дата покупки', warrantyUntil: 'Гарантия до',
  startYm: 'С месяца', endYm: 'До месяца', recurrence: 'Повторение', scenario: 'Сценарий',
};

const META_KEYS = new Set(['createdAt', 'updatedAt']);
type RefMaps = Record<string, Map<string, string>>;
type DetailObject = Record<string, unknown>;

function asObject(value: unknown): DetailObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DetailObject : {};
}

function hasOwn(obj: DetailObject, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function sameValue(left: unknown, right: unknown) {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return left === right; }
}

function detailValue(key: string, value: unknown, route: string, refs: RefMaps): string {
  if (value == null || value === '') return '—';
  if (['amount', 'salary', 'tariff', 'totalAmount', 'monthlyPayment', 'startBalance', 'price'].includes(key)) return money(Number(value));
  if (['date', 'dueDate', 'contractDate', 'hireDate', 'terminationDate', 'purchaseDate', 'warrantyUntil'].includes(key)) return formatDate(String(value));
  if (['ym', 'salaryYm', 'startYm', 'endYm'].includes(key)) return monthLabel(String(value), true);
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, 160); } catch { return '—'; }
  }
  const id = String(value);
  const directMap: Record<string, string> = {
    employeeId: 'employees', projectId: 'projects', accountId: 'accounts',
    fromAccountId: 'accounts', toAccountId: 'accounts', categoryId: 'categories',
    debtId: 'debts', subscriptionId: 'subscriptions', assetId: 'assets',
  };
  const direct = directMap[key] && refs[directMap[key]]?.get(id);
  if (direct) return direct;
  if (key === 'id') {
    const routeMap: Array<[string, string]> = [
      ['/employees/', 'employees'], ['/projects/', 'projects'], ['/accounts/', 'accounts'],
      ['/categories/', 'categories'], ['/debts/', 'debts'], ['/subscriptions/', 'subscriptions'],
      ['/assets/', 'assets'],
    ];
    const mapKey = routeMap.find(([part]) => route.includes(part))?.[1];
    const resolved = mapKey ? refs[mapKey]?.get(id) : null;
    if (resolved) return resolved;
  }
  if (key === 'type') return ({ income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление' } as Record<string, string>)[id] || id;
  if (key === 'status') return ({ active: 'Активный', fired: 'Уволен', paused: 'На паузе', archived: 'В архиве', done: 'Завершён', lead: 'Лид', expected: 'Ожидается', received: 'Получено', completed: 'Проведено', cancelled: 'Отменено' } as Record<string, string>)[id] || id;
  if (key === 'kind') return ({ advance: 'Аванс', bonus: 'Бонус', salary: 'Зарплата', rent: 'Аренда', subscription: 'Подписка' } as Record<string, string>)[id] || id;
  if (key === 'recurrence') return ({ once: 'Один раз', monthly: 'Ежемесячно' } as Record<string, string>)[id] || id;
  if (key === 'scenario') return ({ all: 'Все', base: 'Базовый', conservative: 'Осторожный', optimistic: 'Оптимистичный' } as Record<string, string>)[id] || id;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return `${id.slice(0, 8)}…`;
  return id.slice(0, 160);
}

function fmtWhen(iso: string, full = false): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', full
    ? { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

type Change = { key: string; before?: unknown; after?: unknown; value?: unknown; compared: boolean };

/** Новые записи содержат снимки before/after. Старые остаются читаемыми как набор сохранённых полей. */
export function activityChanges(details: unknown): { rows: Change[]; hasSnapshots: boolean } {
  const root = asObject(details);
  const before = asObject(root.before);
  const after = asObject(root.after);
  const input = asObject(root.input);
  const hasSnapshots = Object.keys(before).length > 0 || Object.keys(after).length > 0 || hasOwn(root, 'before') || hasOwn(root, 'after');
  if (hasSnapshots || Object.keys(input).length > 0) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(input)])]
      .filter(key => !META_KEYS.has(key) && key !== 'id');
    return {
      hasSnapshots,
      rows: keys.map(key => {
        const next = hasOwn(after, key) ? after[key] : input[key];
        return { key, before: before[key], after: next, compared: hasOwn(before, key) && next !== undefined };
      }).filter(row => (row.before !== undefined || row.after !== undefined)
        && !(row.compared && sameValue(row.before, row.after))),
    };
  }
  return {
    hasSnapshots: false,
    rows: Object.entries(root)
      .filter(([key]) => !META_KEYS.has(key))
      .map(([key, value]) => ({ key, value, compared: false })),
  };
}

function entityLabel(route: string): string {
  const labels: Array<[string, string]> = [
    ['/transactions', 'Операция'], ['/operations', 'Операция'], ['/employees', 'Сотрудник'],
    ['/planned-payments', 'Плановая оплата'], ['/pay-now', 'Оплата проекта'], ['/projects', 'Проект'],
    ['/accounts', 'Счёт'], ['/categories', 'Категория'], ['/subscriptions', 'Регулярный платёж'],
    ['/debts', 'Долг'], ['/assets', 'Инвентарь'], ['/salary', 'Зарплатный месяц'],
    ['/forecast', 'Корректировка прогноза'], ['/backup', 'Резервная копия'],
  ];
  return labels.find(([part]) => route.includes(part))?.[1] || 'Финансы';
}

function eventTone(action: string): string {
  if (/отмен|удал|увол|архив|сброс/i.test(action)) return 'danger';
  if (/добав|создал|получ|провёл|восстанов/i.test(action)) return 'success';
  return 'change';
}

function ActivityDetailPanel({ row, refs, onClose }: { row: any; refs: RefMaps; onClose: () => void }) {
  const details = asObject(row.details);
  const changeSet = activityChanges(details);
  const subject = { ...asObject(details.before), ...asObject(details.input), ...asObject(details.after), ...details };
  const identityKey = subject.name != null ? 'name'
    : subject.projectId != null ? 'projectId'
    : subject.employeeId != null ? 'employeeId'
    : subject.accountId != null ? 'accountId'
    : subject.debtId != null ? 'debtId'
    : subject.subscriptionId != null ? 'subscriptionId'
    : 'id';
  const identity = subject[identityKey];
  const objectName = identity == null ? 'Без названия' : detailValue(
    identityKey, identity, row.route || '', refs,
  );
  const tone = eventTone(row.action || '');

  return <section className="fin-activity-panel" role="region" aria-label={`Подробности активности — ${row.action}`}>
    <div className="fin-activity-panel-head">
      <span className={`fin-activity-event-icon ${tone}`}><FinIcon name={tone === 'danger' ? 'undo' : tone === 'success' ? 'check' : 'edit'} size={17} /></span>
      <div>
        <span className="mini muted">{entityLabel(row.route || '')}</span>
        <strong>{objectName}</strong>
        <small>{row.action}</small>
      </div>
      <button type="button" className="btn ghost sm" onClick={onClose}><FinIcon name="chevronLeft" size={14} /> Свернуть</button>
    </div>

    <div className="fin-activity-context">
      <div><span>Кто изменил</span><b>{row.userName || 'Система'}</b></div>
      <div><span>Когда</span><b>{fmtWhen(row.createdAt, true)}</b></div>
      <div><span>Что сделал</span><b>{row.action}</b></div>
    </div>

    <div className="fin-activity-change-block">
      <div className="fin-activity-section-title">
        <strong>{changeSet.rows.some(item => item.compared) ? 'Что изменилось' : 'Сохранённые данные'}</strong>
        <span>{changeSet.rows.length} {changeSet.rows.length === 1 ? 'поле' : 'полей'}</span>
      </div>
      {changeSet.rows.length ? (
        <div className="fin-activity-change-list">
          {changeSet.rows.map(item => (
            <div className={`fin-activity-change${item.compared ? ' compared' : ''}`} key={item.key}>
              <span className="fin-activity-change-label">{DETAIL_LABELS[item.key] || item.key}</span>
              {item.compared ? <>
                <span className="fin-activity-old">{detailValue(item.key, item.before, row.route || '', refs)}</span>
                <FinIcon name="arrowRight" size={14} />
                <b className="fin-activity-new">{detailValue(item.key, item.after, row.route || '', refs)}</b>
              </> : <b className="fin-activity-value">{detailValue(item.key, item.value ?? item.after ?? item.before, row.route || '', refs)}</b>}
            </div>
          ))}
        </div>
      ) : <div className="fin-activity-empty-detail">Для этого системного действия дополнительные поля не сохранялись.</div>}
      {!changeSet.hasSnapshots && changeSet.rows.length > 0 && (
        <p className="fin-activity-legacy-note"><FinIcon name="info" size={14} /> Это старая запись: в ней сохранено итоговое значение, но ещё нет снимка «до».</p>
      )}
    </div>

  </section>;
}

export default function FinanceActivityPage() {
  const [limit, setLimit] = useState(PAGE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['finance', 'activity', limit],
    queryFn: () => financeApi.activity(limit, 0),
    placeholderData: keepPreviousData,
  });
  const { data: referenceData } = useQuery({
    queryKey: ['finance', 'activity', 'references'],
    queryFn: async () => {
      const [accounts, categories, projects, employees, debts, subscriptions, assets] = await Promise.all([
        financeApi.accounts(), financeApi.categories(), financeApi.projects(), financeApi.employees(),
        financeApi.debts(), financeApi.subscriptions(), financeApi.assets(),
      ]);
      return { accounts, categories, projects, employees, debts, subscriptions, assets };
    },
  });

  const rows: any[] = data?.rows ?? [];
  const total: number = data?.total ?? 0;
  const refs: RefMaps = Object.fromEntries(
    Object.entries(referenceData || {}).map(([key, values]) => [
      key,
      new Map((values as any[]).map(item => [item.id, item.name])),
    ]),
  );
  const collapse = (id: string) => {
    setExpandedId(null);
    window.setTimeout(() => rowRefs.current[id]?.focus(), 0);
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setExpandedId(current => current === id ? null : id);
  };

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="activity" size={22} /> Активность</h1>
          <p>Журнал изменений финансов — нажмите на запись, чтобы увидеть, что именно изменилось</p>
        </div>
      </div>

      {isLoading ? <FinLoading /> : isError ? <FinLoadError onRetry={() => refetch()} /> : rows.length === 0 ? (
        <div className="card empty">Пока пусто — здесь появятся все изменения раздела «Финансы»</div>
      ) : (
        <>
          <div className="table-wrap fin-wide-table fin-mobile-cards fin-activity-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Когда</th>
                  <th style={{ width: 180 }}>Кто</th>
                  <th style={{ minWidth: 200 }}>Действие</th>
                  <th>Кратко</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const changeSet = activityChanges(r.details);
                  const open = expandedId === r.id;
                  return <Fragment key={r.id}>
                    <tr
                      ref={node => { rowRefs.current[r.id] = node; }}
                      className={`fin-activity-openable${open ? ' expanded' : ''}`}
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setExpandedId(current => current === r.id ? null : r.id)}
                      onKeyDown={event => onRowKeyDown(event, r.id)}
                    >
                      <td data-label="Когда" className="muted nowrap">{fmtWhen(r.createdAt)}</td>
                      <td data-label="Кто"><b>{r.userName || 'Система'}</b></td>
                      <td data-label="Действие"><span className={`fin-activity-action ${eventTone(r.action || '')}`}>{r.action}</span></td>
                      <td data-label="Кратко" className="mini muted fin-activity-details">
                        {changeSet.rows.length > 0 ? <>
                          {changeSet.rows.slice(0, 3).map(item => (
                            <span key={item.key} className="fin-activity-detail">
                              <span>{DETAIL_LABELS[item.key] || item.key}</span>
                              <b>{detailValue(item.key, item.after ?? item.value ?? item.before, r.route || '', refs)}</b>
                            </span>
                          ))}
                          {changeSet.rows.length > 3 && <span className="fin-activity-more">+{changeSet.rows.length - 3}</span>}
                        </> : <span className="muted">Без дополнительных полей</span>}
                      </td>
                    </tr>
                    {open && <tr className="fin-activity-details-row"><td colSpan={4}>
                      <ActivityDetailPanel row={r} refs={refs} onClose={() => collapse(r.id)} />
                    </td></tr>}
                  </Fragment>;
                })}
              </tbody>
            </table>
          </div>

          {rows.length < total && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button className="btn" disabled={isFetching} onClick={() => setLimit(l => l + PAGE)}>
                {isFetching ? 'Загрузка…' : `Показать ещё (${total - rows.length})`}
              </button>
            </div>
          )}
          <p className="mini muted" style={{ marginTop: 10 }}>Всего записей: {total}</p>
        </>
      )}
    </div>
  );
}
