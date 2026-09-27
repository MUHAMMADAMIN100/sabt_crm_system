// Карточка операции из календаря — общая для «Транзакций» и «Планирования».
// Жила внутри FinanceTransactionsPage; вынесена, чтобы денежный календарь
// «Планирования» не тянул за собой весь модуль журнала операций.
import { TYPE_LABEL, money, todayISO, formatDate } from './finlib';
import { isImportedArchive } from './ImportedArchiveBadge';
import { FinModal } from './FinKit';

export default function CalendarItemModal({ item, planMode, onEdit, renderStatusControl, onClose }: {
  item: any; planMode?: boolean; onEdit?: (t: any) => void;
  renderStatusControl?: (item: any, close: () => void) => any; onClose: () => void;
}) {
  const type = item.type;
  const sign = type === 'expense' ? '−' : type === 'income' ? '+' : '';
  const amtCls = type === 'income' ? 'pos' : type === 'expense' ? 'neg' : 'muted';
  const title = item.comment || item.categoryName || TYPE_LABEL[type] || 'Операция';
  const dateStr = String(item.date || '').slice(0, 10);
  const future = dateStr > todayISO();
  const status = item.status === 'cancelled' ? 'Отменено' : future ? 'Запланировано' : 'Проведено';
  const canEdit = !!onEdit && !isImportedArchive(item) && item.status !== 'cancelled';
  const statusNode = renderStatusControl ? renderStatusControl(item, onClose) : null;
  return (
    <FinModal title="Операция" onClose={onClose} width={340}
      footer={<>
        {canEdit && <button className="btn primary" onClick={() => { onEdit!(item); onClose(); }}>Открыть</button>}
        <button className="btn ghost" onClick={onClose}>Закрыть</button>
      </>}>
      <div className="cal-item">
        <div className={'cal-item-amount ' + amtCls}>{sign}{money(item.amount)}</div>
        <div className="cal-item-title">{title}</div>
        <div className="cal-item-rows">
          {!planMode && <div className="cal-item-row"><span>Тип</span><b>{TYPE_LABEL[type] || type}</b></div>}
          {!planMode && <div className="cal-item-row"><span>Дата</span><b>{formatDate(dateStr)}</b></div>}
          {item.categoryName && <div className="cal-item-row"><span>Категория</span><b>{item.categoryName}</b></div>}
          {item.accountName && <div className="cal-item-row"><span>Счёт</span><b>{item.accountName}</b></div>}
          {Array.isArray(item.details) && item.details.map((d: any, i: number) => (
            <div className="cal-item-row" key={i}><span>{d.label}</span><b>{d.value}</b></div>
          ))}
        </div>
        {statusNode || <div className="cal-item-rows"><div className="cal-item-row"><span>Статус</span><b>{status}</b></div></div>}
      </div>
    </FinModal>
  );
}
