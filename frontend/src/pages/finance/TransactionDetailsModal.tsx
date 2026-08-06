import './finance.css';
import FinIcon, { CatIcon } from './FinIcon';
import { formatDate, INCOME_GROUPS, money, monthLabel, todayISO, TYPE_LABEL } from './finlib';
import ImportedArchiveBadge, { isImportedArchive } from './ImportedArchiveBadge';
import type { FinTx } from './types';
import { AccountLabel } from './AccountIdentity';

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

function Detail({ label, value, sub, primary = false }: {
  label: string; value?: React.ReactNode; sub?: React.ReactNode; primary?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return <div className={'fin-tx-detail' + (primary ? ' primary' : '')}>
    <span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}
  </div>;
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
  const flowFromValue = t.type === 'income'
    ? (t.projectName || t.counterparty || t.legacyProject)
    : from ? <AccountLabel name={from} compact /> : null;
  const flowToLabel = paired ? 'На счёт' : t.type === 'income' ? 'Зачислено на счёт' : 'Получатель';
  const flowToValue = t.type === 'expense'
    ? (t.employeeId ? (t.employeeName || 'Сотрудник не найден') : t.debtCounterparty || t.debtName || t.subscriptionName || t.counterparty)
    : to ? <AccountLabel name={to} compact /> : null;
  const canEdit = !!onEdit && !isImportedArchive(t) && t.status !== 'cancelled';
  const role = [t.employeeRole, t.employeeCategory].filter(Boolean).join(' · ');
  const direction = t.projectDirection ? (DIRECTION_LABEL[t.projectDirection] || t.projectDirection) : null;
  const contextLabel = t.employeeId ? 'Кому выплачено'
    : t.projectId || t.legacyProject ? 'Проект / клиент'
    : t.debtId ? 'Долг'
    : t.subscriptionId ? (t.subscriptionKind === 'rent' ? 'Аренда' : 'Подписка')
    : t.counterparty ? 'Контрагент' : null;
  const contextValue = t.employeeId ? (t.employeeName || 'Сотрудник не найден')
    : t.projectName || t.legacyProject || t.debtName || t.subscriptionName || t.counterparty || null;
  const contextSub = t.employeeId ? role : t.projectId ? direction : t.debtId ? (t.debtCounterparty || t.counterparty) : null;

  return (
    <section id={id} className="fin-tx-details-panel" role="region"
      aria-label={`Подробности операции — ${t.comment || t.categoryName || TYPE_LABEL[t.type] || t.id}`}>
      <div className="fin-tx-details-panel-head">
        <div className="fin-tx-compact-title">
          <CatIcon
            icon={paired ? (t.type === 'saving' ? 'piggy' : 'transactions') : t.categoryIcon}
            color={paired ? (t.type === 'saving' ? 'var(--violet)' : 'var(--accent)') : t.categoryColor}
            size={30}
          />
          <div><strong>{kind || t.categoryName || TYPE_LABEL[t.type] || 'Операция'}</strong>
            <span>{t.comment || t.legacyDescription || 'Без описания'} · {formatDate(t.date)}</span></div>
        </div>
        <div className="fin-tx-compact-summary">
          <b className={t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : ''}>
            {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{money(t.amount)}
          </b>
          <span className={`fin-tx-status ${status.cls}`}>{status.label}</span>
        </div>
        <div className="flex">
          {canEdit && <button className="btn primary sm" onClick={() => onEdit?.(t)}><FinIcon name="edit" size={14} /> Изменить</button>}
          <button className="btn ghost sm" onClick={onClose}><FinIcon name="chevronLeft" size={14} /> Свернуть</button>
        </div>
      </div>

      <div className="fin-tx-compact-grid">
        {contextLabel && <Detail label={contextLabel} value={contextValue} sub={contextSub || undefined} primary />}
        {flowFromValue && flowFromValue !== contextValue && <Detail label={flowFromLabel} value={flowFromValue} />}
        {flowToValue && flowToValue !== contextValue && <Detail label={flowToLabel} value={flowToValue} />}
        <Detail label="Тип / категория" value={`${TYPE_LABEL[t.type] || t.type} · ${t.categoryName || (paired ? TYPE_LABEL[t.type] : 'Без категории')}`} />
        {t.employeeId && <Detail label="Месяц начисления" value={monthLabel(t.salaryYm || String(t.date).slice(0, 7), true)} />}
        <Detail label="Тариф проекта" value={t.projectTariff != null ? money(t.projectTariff) : null} />
        <Detail label="Способ оплаты" value={t.paymentMethod} />
      </div>

      <div className="fin-tx-compact-audit">
        {t.createdByName && <span>Создал: <b>{t.createdByName}</b></span>}
        {formatDateTime(t.createdAt) && <span>Создано: <b>{formatDateTime(t.createdAt)}</b></span>}
        {formatDateTime(t.updatedAt) && <span>Изменено: <b>{formatDateTime(t.updatedAt)}</b></span>}
        <span>Баланс: <b>{t.affectsBalance === false ? 'не влияет' : 'учитывается'}</b></span>
        <span>Источник: <b>{isImportedArchive(t) ? <ImportedArchiveBadge /> : 'CRM'}</b></span>
        <code title="ID операции">{t.id}</code>
      </div>
    </section>
  );
}
