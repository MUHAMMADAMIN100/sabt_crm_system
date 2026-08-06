import './finance.css';
import FinIcon, { CatIcon } from './FinIcon';
import { formatDate, INCOME_GROUPS, money, monthLabel, todayISO, TYPE_LABEL } from './finlib';
import ImportedArchiveBadge, { isImportedArchive } from './ImportedArchiveBadge';
import type { FinTx } from './types';

const DIRECTION_LABEL = Object.fromEntries(INCOME_GROUPS.map((g) => [g.key, g.label]));

function payoutKind(t: FinTx): string | null {
  if (!t.employeeId) return null;
  const comment = (t.comment || '').trim().toLowerCase();
  if (comment.startsWith('аванс')) return 'Аванс';
  if (comment.startsWith('бонус')) return 'Бонус';
  if (comment.startsWith('премия')) return 'Премия';
  return 'Зарплата';
}

function statusOf(t: FinTx) {
  if (t.status === 'cancelled') return { label: 'Отменено', cls: 'cancelled' };
  if (String(t.date || '').slice(0, 10) > todayISO()) return { label: 'Запланировано', cls: 'planned' };
  return { label: 'Проведено', cls: 'completed' };
}

function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function Detail({ label, value, strong = false }: { label: string; value?: React.ReactNode; strong?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return <div className="fin-tx-detail"><span>{label}</span><b className={strong ? 'strong' : undefined}>{value}</b></div>;
}

export default function TransactionDetailsPanel({ transaction: t, id, onClose, onEdit }: {
  transaction: FinTx;
  id: string;
  onClose: () => void;
  onEdit?: (t: FinTx) => void;
}) {
  const status = statusOf(t);
  const kind = payoutKind(t);
  const paired = t.type === 'transfer' || t.type === 'saving';
  const from = paired ? t.fromAccountName : t.type === 'expense' ? t.accountName : null;
  const to = paired ? (t.toAccountName || (t.type === 'saving' ? t.accountName : null)) : t.type === 'income' ? t.accountName : null;
  const flowFromLabel = paired ? 'Со счёта' : t.type === 'income' ? 'Плательщик / проект' : 'Списано со счёта';
  const flowFromValue = t.type === 'income' ? (t.projectName || t.counterparty || t.legacyProject) : from;
  const flowToLabel = paired ? 'На счёт' : t.type === 'income' ? 'Зачислено на счёт' : 'Получатель';
  const flowToValue = t.type === 'expense'
    ? (t.employeeId ? (t.employeeName || 'Сотрудник не найден') : t.debtCounterparty || t.debtName || t.subscriptionName || t.counterparty)
    : to;
  const linked = !!(t.employeeId || t.projectId || t.debtId || t.subscriptionId || t.counterparty || t.legacyProject);
  const canEdit = !!onEdit && !isImportedArchive(t) && t.status !== 'cancelled';

  return (
    <section id={id} className="fin-tx-details-panel" role="region"
      aria-label={`Подробности операции — ${t.comment || t.categoryName || TYPE_LABEL[t.type] || t.id}`}>
      <div className="fin-tx-details-panel-head">
        <div><strong>Подробности операции</strong><span>Все данные без перехода со страницы</span></div>
        <div className="flex">
          {canEdit && <button className="btn primary sm" onClick={() => onEdit?.(t)}><FinIcon name="edit" size={14} /> Изменить</button>}
          <button className="btn ghost sm" onClick={onClose}><FinIcon name="chevronLeft" size={14} /> Свернуть</button>
        </div>
      </div>
      <div className={`fin-tx-detail-hero ${t.type}`}>
        <CatIcon
          icon={paired ? (t.type === 'saving' ? 'piggy' : 'transactions') : t.categoryIcon}
          color={paired ? (t.type === 'saving' ? 'var(--violet)' : 'var(--accent)') : t.categoryColor}
          size={42}
        />
        <div className="fin-tx-detail-heading">
          <div className="fin-tx-detail-kicker">{kind || t.categoryName || TYPE_LABEL[t.type] || 'Операция'}</div>
          <div className={`fin-tx-detail-amount ${t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : ''}`}>
            {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{money(t.amount)}
          </div>
          <div className="fin-tx-detail-caption">{t.comment || t.legacyDescription || 'Без описания'}</div>
        </div>
        <span className={`fin-tx-status ${status.cls}`}>{status.label}</span>
      </div>

      {t.employeeId && (
        <section className="fin-tx-detail-focus">
          <span className="fin-tx-detail-focus-label">Кому выплачено</span>
          <strong>{t.employeeName || 'Сотрудник не найден'}</strong>
          {(t.employeeRole || t.employeeCategory) && <small>{[t.employeeRole, t.employeeCategory].filter(Boolean).join(' · ')}</small>}
        </section>
      )}

      <section className="fin-tx-detail-section">
        <h4>Операция</h4>
        <div className="fin-tx-detail-grid">
          <Detail label="Дата операции" value={formatDate(t.date)} strong />
          <Detail label="Тип" value={TYPE_LABEL[t.type] || t.type} />
          <Detail label="Категория" value={t.categoryName || (paired ? TYPE_LABEL[t.type] : 'Без категории')} />
          <Detail label="Тип выплаты" value={kind} />
          {t.employeeId && <Detail label="Месяц начисления" value={monthLabel(t.salaryYm || String(t.date).slice(0, 7), true)} />}
          <Detail label="Способ оплаты" value={t.paymentMethod} />
          <Detail label="Описание" value={t.comment || t.legacyDescription} />
        </div>
      </section>

      <section className="fin-tx-detail-section">
        <h4>Движение денег</h4>
        <div className="fin-tx-account-flow">
          <div><span>{flowFromLabel}</span><b>{flowFromValue || '—'}</b></div>
          <FinIcon name="arrowRight" size={20} />
          <div><span>{flowToLabel}</span><b>{flowToValue || '—'}</b></div>
        </div>
      </section>

      {linked && (
        <section className="fin-tx-detail-section">
          <h4>Связанные данные</h4>
          <div className="fin-tx-detail-grid">
            <Detail label="Сотрудник" value={t.employeeName} strong />
            <Detail label="Должность / отдел" value={[t.employeeRole, t.employeeCategory].filter(Boolean).join(' · ')} />
            <Detail label="Проект / клиент" value={t.projectName || t.legacyProject} strong />
            <Detail label="Направление" value={t.projectDirection ? (DIRECTION_LABEL[t.projectDirection] || t.projectDirection) : null} />
            <Detail label="Тариф проекта" value={t.projectTariff != null ? money(t.projectTariff) : null} />
            <Detail label="Долг" value={t.debtName} strong />
            <Detail label="Кредитор / контрагент" value={t.debtCounterparty || t.counterparty} />
            <Detail label={t.subscriptionKind === 'rent' ? 'Аренда' : 'Подписка'} value={t.subscriptionName} strong />
          </div>
        </section>
      )}

      <section className="fin-tx-detail-section quiet">
        <h4>Учётная информация</h4>
        <div className="fin-tx-detail-grid">
          <Detail label="Создал" value={t.createdByName} />
          <Detail label="Создано" value={formatDateTime(t.createdAt)} />
          <Detail label="Последнее изменение" value={formatDateTime(t.updatedAt)} />
          <Detail label="Влияет на баланс" value={t.affectsBalance === false ? 'Нет — архивный факт' : 'Да'} />
          <Detail label="Источник" value={isImportedArchive(t) ? <ImportedArchiveBadge /> : 'CRM'} />
          <Detail label="ID операции" value={<code>{t.id}</code>} />
        </div>
      </section>
    </section>
  );
}
