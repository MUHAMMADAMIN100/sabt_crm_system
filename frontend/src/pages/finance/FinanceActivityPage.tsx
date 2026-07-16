// Активность финансов: кто, что и когда изменил (журнал пишется бэкендом
// на каждое успешное изменение в разделе). Только чтение.
import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { financeApi } from '@/services/api.service';
import { FinLoading, FinLoadError } from './FinKit';
import FinIcon from './FinIcon';
import './finance.css';

const PAGE = 50;

/** Человекочитаемые ключи деталей журнала. */
const DETAIL_LABELS: Record<string, string> = {
  amount: 'сумма', date: 'дата', ym: 'месяц', comment: 'комментарий',
  type: 'тип', name: 'название', employeeId: 'сотрудник', projectId: 'проект',
  accountId: 'счёт', categoryId: 'категория', id: 'id', salary: 'оклад',
};

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

  const rows: any[] = data?.rows ?? [];
  const total: number = data?.total ?? 0;

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="transactions" size={22} /> Активность</h1>
          <p>Журнал изменений финансов — кто, что и когда изменил</p>
        </div>
      </div>

      {isLoading ? <FinLoading /> : isError ? <FinLoadError onRetry={() => refetch()} /> : rows.length === 0 ? (
        <div className="card empty">Пока пусто — здесь появятся все изменения раздела «Финансы»</div>
      ) : (
        <>
          <div className="table-wrap">
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
                    <td className="mini muted" style={{ maxWidth: 420 }}>
                      {r.details && Object.keys(r.details).length > 0
                        ? Object.entries(r.details).slice(0, 6).map(([k, v]) => (
                          <span key={k} style={{ marginRight: 10, display: 'inline-block' }}>
                            {DETAIL_LABELS[k] || k}: <b style={{ color: 'var(--text)' }}>{String(v).slice(0, 60)}</b>
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
