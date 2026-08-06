// Активность финансов: кто, что и когда изменил (журнал пишется бэкендом
// на каждое успешное изменение в разделе). Только чтение.
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { FinLoading, FinLoadError } from './FinKit';
import FinIcon from './FinIcon';
import { money, formatDate, monthLabel } from './finlib';
import './finance.css';

const PAGE = 50;

/** Человекочитаемые ключи деталей журнала. */
const DETAIL_LABELS: Record<string, string> = {
  amount: 'сумма', date: 'дата', ym: 'месяц', comment: 'комментарий',
  type: 'тип', name: 'название', employeeId: 'сотрудник', projectId: 'проект',
  accountId: 'счёт', fromAccountId: 'со счёта', toAccountId: 'на счёт',
  categoryId: 'категория', debtId: 'долг', subscriptionId: 'подписка',
  assetId: 'инвентарь', id: 'объект', salary: 'оклад', salaryYm: 'месяц ЗП',
  role: 'должность', status: 'статус', kind: 'вид выплаты',
  tariff: 'тариф', dueDate: 'срок', contractDate: 'дата договора',
  hireDate: 'дата приёма', terminationDate: 'дата увольнения',
  archived: 'архив', note: 'примечание',
};

type RefMaps = Record<string, Map<string, string>>;

function detailValue(key: string, value: unknown, route: string, refs: RefMaps): string {
  if (key === 'amount' || key === 'salary' || key === 'tariff') return money(Number(value))
  if (key === 'date' || key === 'dueDate' || key === 'contractDate' || key === 'hireDate' || key === 'terminationDate') return formatDate(String(value))
  if (key === 'ym' || key === 'salaryYm') return monthLabel(String(value), true)
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  const id = String(value);
  const directMap: Record<string, string> = {
    employeeId: 'employees', projectId: 'projects', accountId: 'accounts',
    fromAccountId: 'accounts', toAccountId: 'accounts', categoryId: 'categories',
    debtId: 'debts', subscriptionId: 'subscriptions',
  };
  const direct = directMap[key] && refs[directMap[key]]?.get(id);
  if (direct) return direct;
  if (key === 'id') {
    const routeMap: Array<[string, string]> = [
      ['/employees/', 'employees'], ['/projects/', 'projects'],
      ['/accounts/', 'accounts'], ['/categories/', 'categories'],
      ['/debts/', 'debts'], ['/subscriptions/', 'subscriptions'],
    ];
    const mapKey = routeMap.find(([part]) => route.includes(part))?.[1];
    const resolved = mapKey ? refs[mapKey]?.get(id) : null;
    if (resolved) return resolved;
  }
  if (key === 'type') return ({ income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление' } as Record<string, string>)[id] || id;
  if (key === 'status') return ({ active: 'Работает', fired: 'Уволен', paused: 'На паузе', archived: 'В архиве', done: 'Завершён', lead: 'Лид' } as Record<string, string>)[id] || id;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return `${id.slice(0, 8)}…`;
  return id.slice(0, 80)
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function FinanceActivityPage() {
  const [limit, setLimit] = useState(PAGE);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['finance', 'activity', limit],
    queryFn: () => financeApi.activity(limit, 0),
    placeholderData: keepPreviousData,
  });
  const { data: referenceData } = useQuery({
    queryKey: ['finance', 'activity', 'references'],
    queryFn: async () => {
      const [accounts, categories, projects, employees, debts, subscriptions] = await Promise.all([
        financeApi.accounts(), financeApi.categories(), financeApi.projects(),
        financeApi.employees(), financeApi.debts(), financeApi.subscriptions(),
      ]);
      return { accounts, categories, projects, employees, debts, subscriptions };
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

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="activity" size={22} /> Активность</h1>
          <p>Журнал изменений финансов — кто, что и когда изменил</p>
        </div>
      </div>

      {isLoading ? <FinLoading /> : isError ? <FinLoadError onRetry={() => refetch()} /> : rows.length === 0 ? (
        <div className="card empty">Пока пусто — здесь появятся все изменения раздела «Финансы»</div>
      ) : (
        <>
          <div className="table-wrap fin-wide-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Когда</th>
                  <th style={{ width: 180 }}>Кто</th>
                  <th style={{ minWidth: 180 }}>Действие</th>
                  <th>Детали</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted nowrap">{fmtWhen(r.createdAt)}</td>
                    <td><b>{r.userName || 'Система'}</b></td>
                    <td>{r.action}</td>
                    <td className="mini muted fin-activity-details">
                      {r.details && Object.keys(r.details).length > 0
                        ? Object.entries(r.details).slice(0, 8).map(([k, v]) => (
                          <span key={k} className="fin-activity-detail">
                            <span>{DETAIL_LABELS[k] || k}</span>
                            <b>{detailValue(k, v, r.route || '', refs)}</b>
                          </span>
                        ))
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
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
