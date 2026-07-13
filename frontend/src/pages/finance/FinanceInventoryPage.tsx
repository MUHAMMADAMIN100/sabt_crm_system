// Инвентарь /finance/inventory — оборудование склада: покупка, линейная
// амортизация (цена равными долями за срок службы), остаточная стоимость,
// статусы (в работе/ремонт/списано/продано), ответственные.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { money, todayISO, formatDate, apiErr } from './finlib';
import FinIcon from './FinIcon';
import { FinLoading, FinLoadError, finConfirm, useModalKeys, invalidateFinanceAll } from './FinKit';
import { financeApi } from '@/services/api.service';

const showErr = (e: any) => toast.error(apiErr(e));

const STATUS_META: Record<string, { label: string; badge: string }> = {
  in_use: { label: 'в работе', badge: 'ok' },
  repair: { label: 'в ремонте', badge: 'wait' },
  written_off: { label: 'списано', badge: 'expense' },
  sold: { label: 'продано', badge: 'info' },
};

/** Подсказки категорий для новых позиций (плюс уже использованные). */
const DEFAULT_CATEGORIES = ['Техника', 'Свет', 'Звук', 'Мебель', 'Реквизит', 'Прочее'];

export default function FinanceInventoryPage() {
  const [modal, setModal] = useState<any | 'new' | null>(null);
  const [catFilter, setCatFilter] = useState('');
  const [q, setQ] = useState('');

  const { data: assets = [], isLoading, isError, refetch } = useQuery<any[]>({ queryKey: ['finref', 'assets'], queryFn: () => financeApi.assets() });

  const categories = useMemo(
    () => [...new Set(assets.map((a: any) => a.category).filter(Boolean))] as string[],
    [assets],
  );

  const active = assets.filter((a: any) => a.status === 'in_use' || a.status === 'repair');
  const parkPrice = active.reduce((s: number, a: any) => s + (a.price || 0), 0);
  const parkResidual = active.reduce((s: number, a: any) => s + (a.residual || 0), 0);
  const monthlyDep = active.reduce((s: number, a: any) => s + (a.monthlyDep || 0), 0);
  const inRepair = assets.filter((a: any) => a.status === 'repair').length;
  const gone = assets.filter((a: any) => a.status === 'written_off' || a.status === 'sold').length;

  const rows = assets.filter((a: any) => {
    if (catFilter && a.category !== catFilter) return false;
    if (q) {
      const hay = [a.name, a.serial, a.assignee, a.note].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="folder" size={22} /> Инвентарь</h1>
          <p>Оборудование, амортизация и остаточная стоимость</p>
        </div>
        <button className="btn primary" onClick={() => setModal('new')}><FinIcon name="plus" size={16} /> Оборудование</button>
      </div>

      <div className="cards grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="label">Стоимость парка</div>
          <div className="value">{money(parkPrice)}</div>
          <div className="sub">закупочная, без списанных</div>
        </div>
        <div className="card stat">
          <div className="label">Остаточная стоимость</div>
          <div className="value pos">{money(parkResidual)}</div>
          <div className="sub">после амортизации</div>
        </div>
        <div className="card stat">
          <div className="label">Амортизация / мес</div>
          <div className="value neg">{money(monthlyDep)}</div>
          <div className="sub">цена ÷ срок службы</div>
        </div>
        <div className="card stat">
          <div className="label">Единиц</div>
          <div className="value">{active.length}</div>
          <div className="sub">{inRepair > 0 ? `в ремонте ${inRepair} · ` : ''}выбыло {gone}</div>
        </div>
      </div>

      <div className="toolbar">
        <input className="grow" style={{ maxWidth: 280 }} placeholder="Поиск: название, серийник, кто…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: 170 }}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="muted mini">{rows.length} позиций</span>
      </div>

      {isLoading ? (
        <FinLoading />
      ) : isError ? (
        <FinLoadError onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <div className="card empty"><div className="big"><FinIcon name="folder" size={30} /></div>Пусто — добавьте оборудование кнопкой «＋»</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Название</th>
                <th>Категория</th>
                <th>Куплено</th>
                <th className="num" style={{ width: 100 }}>Цена</th>
                <th className="num" style={{ width: 90 }} title="Срок службы, месяцев">Срок, мес</th>
                <th className="num" style={{ width: 110 }} title="Ежемесячная амортизация">Аморт./мес</th>
                <th style={{ minWidth: 150 }}>Остаточная</th>
                <th>Ответственный</th>
                <th style={{ minWidth: 110 }}>Статус</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((a: any) => {
                const st = STATUS_META[a.status] ?? STATUS_META.in_use;
                const pct = a.price > 0 ? Math.min(100, Math.round((a.residual / a.price) * 100)) : 0;
                const activeRow = a.status === 'in_use' || a.status === 'repair';
                return (
                  <tr key={a.id} style={{ opacity: activeRow ? 1 : 0.6 }} onDoubleClick={() => setModal(a)}>
                    <td>
                      <b>{a.name}</b>
                      {a.serial && <div className="mini muted">SN: {a.serial}</div>}
                      {a.warrantyUntil && a.warrantyUntil >= todayISO() && (
                        <div className="mini muted">гарантия до {formatDate(a.warrantyUntil)}</div>
                      )}
                    </td>
                    <td className="muted">{a.category ?? '—'}</td>
                    <td className="muted nowrap">{a.purchaseDate ? formatDate(a.purchaseDate) : '—'}</td>
                    <td className="num">{money(a.price)}</td>
                    <td className="num muted">{a.serviceMonths || '—'}</td>
                    <td className="num muted">{a.monthlyDep ? money(a.monthlyDep) : '—'}</td>
                    <td>
                      {activeRow && a.serviceMonths > 0 ? (
                        <>
                          <div className="progress" style={{ marginBottom: 4 }}>
                            <i style={{ width: pct + '%', background: pct > 30 ? 'var(--green)' : 'var(--amber)' }} />
                          </div>
                          <span className="mini nowrap">
                            <b>{money(a.residual)}</b>
                            {a.wornOut ? <span className="neg"> · ресурс выработан</span> : <span className="muted"> · {pct}%</span>}
                          </span>
                        </>
                      ) : activeRow ? (
                        <span className="mini muted nowrap">{money(a.residual)} · без износа</span>
                      ) : <span className="mini muted">—</span>}
                    </td>
                    <td className="muted">{a.assignee ?? '—'}</td>
                    <td><span className={'badge ' + st.badge}>{st.label}</span></td>
                    <td className="num nowrap">
                      <button className="btn ghost sm" title="Редактировать" onClick={() => setModal(a)}><FinIcon name="edit" size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><b>Итого (в работе и ремонте)</b></td>
                <td className="num"><b>{money(parkPrice)}</b></td>
                <td />
                <td className="num"><b>{money(monthlyDep)}</b></td>
                <td><b>{money(parkResidual)}</b></td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mini muted" style={{ marginTop: 12 }}>
        Амортизация линейная: цена делится на срок службы; остаточная стоимость уменьшается каждый полный
        месяц с даты покупки. Списанное и проданное в стоимости парка не учитывается.
      </p>

      {modal && <AssetModal asset={modal === 'new' ? undefined : modal} knownCategories={[...new Set([...DEFAULT_CATEGORIES, ...categories])]} onClose={() => setModal(null)} />}
    </div>
  );
}

function AssetModal({ asset, knownCategories, onClose }: { asset?: any; knownCategories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  useModalKeys(onClose);
  const inv = () => invalidateFinanceAll(qc);
  const isEdit = !!asset;
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState(asset?.category ?? '');
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate ?? todayISO());
  const [price, setPrice] = useState(asset ? String(asset.price) : '');
  const [serviceMonths, setServiceMonths] = useState(asset ? String(asset.serviceMonths || '') : '36');
  const [status, setStatus] = useState(asset?.status ?? 'in_use');
  const [assignee, setAssignee] = useState(asset?.assignee ?? '');
  const [serial, setSerial] = useState(asset?.serial ?? '');
  const [warrantyUntil, setWarrantyUntil] = useState(asset?.warrantyUntil ?? '');
  const [note, setNote] = useState(asset?.note ?? '');
  const [busy, setBusy] = useState(false);

  const priceNum = parseFloat(price.replace(',', '.')) || 0;
  const lifeNum = Math.max(0, parseInt(serviceMonths, 10) || 0);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const data: any = {
      name: name.trim(), category: category.trim() || undefined,
      purchaseDate: purchaseDate || undefined, price: priceNum, serviceMonths: lifeNum,
      status, assignee: assignee.trim() || undefined, serial: serial.trim() || undefined,
      warrantyUntil: warrantyUntil || undefined, note: note.trim() || undefined,
    };
    try {
      if (asset) await financeApi.updateAsset(asset.id, data);
      else await financeApi.createAsset(data);
      inv();
      onClose();
    } catch (e) { showErr(e); } finally { setBusy(false); }
  }
  async function remove() {
    if (!asset) return;
    if (!(await finConfirm(`Удалить «${asset.name}» из инвентаря? История не сохранится — для выбытия лучше сменить статус на «списано».`, { danger: true, confirmLabel: 'Удалить' }))) return;
    try { await financeApi.removeAsset(asset.id); inv(); onClose(); } catch (e) { showErr(e); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={isEdit ? 'Оборудование' : 'Новое оборудование'} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-head"><h3>{isEdit ? 'Оборудование' : 'Новое оборудование'}</h3><button className="btn ghost sm" aria-label="Закрыть" onClick={onClose}><FinIcon name="close" size={16} /></button></div>
        <div className="modal-body">
          <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sony A7 IV, штатив, стол…" /></div>
          <div className="form-grid">
            <div className="field">
              <label>Категория</label>
              <input list="asset-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Техника" />
              <datalist id="asset-cats">{knownCategories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field"><label>Дата приобретения</label><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Цена, сомони</label><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="field">
              <label>Срок службы, месяцев</label>
              <input inputMode="numeric" value={serviceMonths} onChange={(e) => setServiceMonths(e.target.value)} placeholder="0 — не амортизировать" />
            </div>
          </div>
          {priceNum > 0 && lifeNum > 0 && (
            <p className="mini muted" style={{ margin: 0 }}>
              Амортизация ≈ {money(Math.round((priceNum / lifeNum) * 100) / 100)} в месяц; к концу срока остаточная стоимость — 0.
            </p>
          )}
          <div className="form-grid">
            <div className="field"><label>Ответственный</label><input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="кому выдано" /></div>
            <div className="field"><label>Серийный номер</label><input value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Гарантия до</label><input type="date" value={warrantyUntil} onChange={(e) => setWarrantyUntil(e.target.value)} /></div>
            <div className="field"><label>Статус</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="in_use">В работе</option>
                <option value="repair">В ремонте</option>
                <option value="written_off">Списано</option>
                <option value="sold">Продано</option>
              </select>
            </div>
          </div>
          <div className="field"><label>Комментарий</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="состояние, комплектация…" /></div>
        </div>
        <div className="modal-foot">
          {isEdit && <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>Удалить</button>}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{isEdit ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    </div>
  );
}
