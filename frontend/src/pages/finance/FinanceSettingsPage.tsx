// Настройки Fin System: счета, справочники, снимки данных, резервные копии.
// Порт fin-webrand/src/pages/Settings.tsx (Dexie → financeApi + react-query).
import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import './finance.css';
import { money, todayISO, formatDate, INCOME_GROUPS, TYPE_LABEL, COLOR_PALETTE, apiErr } from './finlib';
import FinIcon, { CatIcon, PICKER_ICONS } from './FinIcon';
import { FinModal, FinLoading, FinLoadError, finConfirm, invalidateFinanceAll } from './FinKit';
import { ProjectFormModal, EmployeeFormModal, SubFormModal, DebtFormModal } from './FinForms';
import { financeApi } from '@/services/api.service';

export default function FinanceSettingsPage() {
  const qc = useQueryClient();

  const accountsQ = useQuery<any[]>({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() });
  const accounts = accountsQ.data ?? [];
  const { data: balances } = useQuery<any>({ queryKey: ['finance', 'accounts-balances'], queryFn: () => financeApi.accountsBalances() });
  const { data: categories = [] } = useQuery<any[]>({ queryKey: ['finref', 'categories'], queryFn: () => financeApi.categories() });
  const { data: projects = [] } = useQuery<any[]>({ queryKey: ['finref', 'projects'], queryFn: () => financeApi.projects() });
  const { data: employees = [] } = useQuery<any[]>({ queryKey: ['finref', 'employees'], queryFn: () => financeApi.employees() });
  const { data: subs = [] } = useQuery<any[]>({ queryKey: ['finref', 'subscriptions'], queryFn: () => financeApi.subscriptions() });
  const { data: debts = [] } = useQuery<any[]>({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() });

  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<ReactNode>(null);

  const invalidate = () => invalidateFinanceAll(qc);
  const empCategories = [...new Set(employees.map((e: any) => e.category).filter(Boolean))] as string[];

  function currentBalance(accountId: string): number {
    const row = balances?.perAccount?.find((p: any) => p.id === accountId);
    return row ? row.balance : 0;
  }

  async function saveStartBalance(a: any, raw: string) {
    const startBalance = parseFloat(raw) || 0;
    if (startBalance === Number(a.startBalance)) return;
    try {
      await financeApi.updateAccount(a.id, { startBalance });
      invalidate();
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function toggleArchived(a: any) {
    if (!a.archived && !(await finConfirm(
      `Архивировать счёт «${a.name}»? Он исчезнет из карточек и селектов, операции и история останутся.`,
      { confirmLabel: 'Архивировать' },
    ))) return;
    try {
      await financeApi.updateAccount(a.id, { archived: !a.archived });
      invalidate();
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function exportData() {
    try {
      const dump = await financeApi.exportAll();
      downloadJson(dump, `fin-system-${todayISO()}.json`);
      setMsg('Файл выгружен ✓');
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function importData(file: File) {
    let data: any;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast.error('Некорректный JSON-файл');
      return;
    }
    if (!(await finConfirm(
      'Импорт полностью заменит текущие финансовые данные. Перед заменой система проверит файл и создаст страховочную копию.',
      { danger: true, confirmLabel: 'Импортировать' },
    ))) return;
    try {
      await financeApi.importAll(data);
      setMsg('Импортировано ✓');
      invalidate();
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function resetAll() {
    if (!(await finConfirm('Удалить ВСЕ данные и пересоздать справочники? Действие необратимо (последний автоснимок останется).', { danger: true, confirmLabel: 'Сбросить всё' }))) return;
    try {
      await financeApi.resetAll();
      invalidate();
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function del(fn: () => Promise<any>) {
    try {
      await fn();
      invalidate();
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  if (accountsQ.isLoading) {
    return (
      <div className="fin-root">
        <div className="page-head"><div><h1>Настройки</h1><p>Счета, справочники, резервные копии</p></div></div>
        <FinLoading />
      </div>
    );
  }
  if (accountsQ.isError) {
    return (
      <div className="fin-root">
        <div className="page-head"><div><h1>Настройки</h1><p>Счета, справочники, резервные копии</p></div></div>
        <FinLoadError onRetry={() => accountsQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="fin-root">
      <div className="page-head"><div><h1>Настройки</h1><p>Счета, справочники, снимки данных</p></div></div>

      <div className="section-title">Счета и стартовые балансы</div>
      <div className="card">
        <p className="mini muted" style={{ marginTop: 0 }}>Стартовый баланс = сколько было на счёте на момент запуска. Текущий = старт + операции. Архивные счета скрыты из карточек и селектов.</p>
        <table>
          <thead><tr><th>Счёт</th><th className="num">Стартовый</th><th className="num">Текущий</th><th /></tr></thead>
          <tbody>
            {accounts.length === 0 && <tr><td colSpan={4} className="empty">Пусто</td></tr>}
            {accounts.map((a: any) => (
              <tr key={a.id} style={a.archived ? { opacity: .55 } : undefined}>
                <td>
                  <span className="dot" style={{ background: a.color }} /> <b style={{ marginLeft: 8 }}>{a.name}</b>
                  {a.archived && <span className="mini muted" style={{ marginLeft: 8 }}>архивный</span>}
                </td>
                <td className="num">
                  <input key={`${a.id}-${a.startBalance}`} className="cell-input" style={{ width: 140, textAlign: 'right' }}
                    type="number" inputMode="decimal" defaultValue={a.startBalance}
                    onBlur={(e) => saveStartBalance(a, e.target.value)} />
                </td>
                <td className="num"><b>{money(currentBalance(a.id))}</b></td>
                <td className="num"><span className="row-actions">
                  <button className="btn ghost sm" title="Редактировать" onClick={() => setModal(<AccountModal account={a} onClose={() => setModal(null)} />)}><FinIcon name="edit" size={15} /></button>
                  <button className="btn ghost sm" title={a.archived ? 'Вернуть из архива' : 'В архив'} onClick={() => toggleArchived(a)}>
                    <FinIcon name={a.archived ? 'undo' : 'download'} size={15} />
                  </button>
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setModal(<AccountModal onClose={() => setModal(null)} />)}><FinIcon name="plus" size={14} /> Счёт</button>
      </div>

      <Directory title="Категории" items={categories}
        head={['Название', 'Тип']}
        cols={(c: any) => [<span className="flex" key="n"><CatIcon icon={c.icon} color={c.color} size={24} /> {c.name}</span>, TYPE_LABEL[c.type] ?? c.type]}
        onAdd={() => setModal(<CategoryModal onClose={() => setModal(null)} />)}
        onEdit={(c: any) => setModal(<CategoryModal category={c} onClose={() => setModal(null)} />)}
        canDelete={(c: any) => !c.builtin}
        onDel={async (c: any) => (await finConfirm(`Удалить категорию «${c.name}»?`, { danger: true, confirmLabel: 'Удалить' })) && del(() => financeApi.removeCategory(c.id))} />

      <Directory title="Проекты / клиенты" items={projects}
        head={['Название', 'Направление', 'Тариф']}
        cols={(p: any) => [p.name, INCOME_GROUPS.find((g) => g.key === p.direction)?.label ?? p.direction, money(p.tariff)]}
        onAdd={() => setModal(<ProjectFormModal onClose={() => setModal(null)} />)}
        onEdit={(p: any) => setModal(<ProjectFormModal project={p} onClose={() => setModal(null)} />)}
        onDel={async (p: any) => (await finConfirm(`Удалить проект «${p.name}»? Удалятся его плановые оплаты и доходные операции.`, { danger: true, confirmLabel: 'Удалить' })) && del(() => financeApi.removeProject(p.id))} />

      <Directory title="Сотрудники" items={employees}
        head={['Имя', 'Роль', 'Оклад', 'Статус']}
        cols={(e: any) => [e.name, e.role || '—', money(e.salary), e.status === 'active' ? 'активный' : 'уволен']}
        onAdd={() => setModal(<EmployeeFormModal categories={empCategories} onClose={() => setModal(null)} />)}
        onEdit={(e: any) => setModal(<EmployeeFormModal employee={e} categories={empCategories} onClose={() => setModal(null)} />)}
        onDel={async (e: any) => (await finConfirm(`Удалить сотрудника «${e.name}»?`, { danger: true, confirmLabel: 'Удалить' })) && del(() => financeApi.removeEmployee(e.id))} />

      <Directory title="Аренда и подписки" items={subs}
        head={['Название', 'Тип', 'Сумма/мес', 'День оплаты']}
        cols={(s: any) => [s.name, s.kind === 'rent' ? 'Аренда' : 'Подписка', money(s.amount), s.dueDay ? `до ${s.dueDay}-го` : '—']}
        onAdd={() => setModal(<SubFormModal onClose={() => setModal(null)} />)}
        onEdit={(s: any) => setModal(<SubFormModal sub={s} onClose={() => setModal(null)} />)}
        onDel={async (s: any) => (await finConfirm(`Удалить «${s.name}»?`, { danger: true, confirmLabel: 'Удалить' })) && del(() => financeApi.removeSubscription(s.id))} />

      <Directory title="Долги" items={debts}
        head={['Название', 'Сумма', 'Платёж/мес']}
        cols={(d: any) => [d.name, money(d.totalAmount), d.monthlyPayment ? money(d.monthlyPayment) : '—']}
        onAdd={() => setModal(<DebtFormModal onClose={() => setModal(null)} />)}
        onEdit={(d: any) => setModal(<DebtFormModal debt={d} onClose={() => setModal(null)} />)}
        onDel={async (d: any) => (await finConfirm(`Удалить долг «${d.name}»?`, { danger: true, confirmLabel: 'Удалить' })) && del(() => financeApi.removeDebt(d.id))} />

      <BackupsSection />

      <div className="section-title">Резервная копия (файл)</div>
      <div className="card flex" style={{ gap: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={exportData}><FinIcon name="download" size={16} /> Экспорт JSON</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><FinIcon name="upload" size={16} /> Импорт JSON</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ''; }} />
        {msg && <span className="pos mini">{msg}</span>}
      </div>

      <div className="section-title">Опасная зона</div>
      <div className="card"><button className="btn danger" onClick={resetAll}>Сбросить все данные</button></div>

      {modal}
    </div>
  );
}

function downloadJson(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Снимки данных: ежедневный автобэкап 02:00 + ручные; восстановление обратимо
 *  (перед ним система сохраняет снимок pre_restore). */
function BackupsSection() {
  const qc = useQueryClient();
  const { data: backups = [], isLoading } = useQuery<any[]>({ queryKey: ['finance', 'backups'], queryFn: () => financeApi.backups() });
  const [busy, setBusy] = useState(false);

  const KIND_LABEL: Record<string, string> = { auto: 'авто', manual: 'ручной', pre_restore: 'перед восстановлением' };

  async function createSnapshot() {
    if (busy) return;
    setBusy(true);
    try {
      await financeApi.createBackup();
      qc.invalidateQueries({ queryKey: ['finance', 'backups'] });
      toast.success('Снимок создан');
    } catch (e: any) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function download(b: any) {
    try {
      const full = await financeApi.getBackup(b.id);
      downloadJson(full.data, `fin-backup-${String(b.createdAt).slice(0, 10)}.json`);
    } catch (e: any) {
      toast.error(apiErr(e));
    }
  }

  async function restore(b: any) {
    if (!(await finConfirm(
      `Восстановить данные из снимка от ${formatDate(String(b.createdAt).slice(0, 10))}? Текущее состояние сначала сохранится отдельным снимком.`,
      { danger: true, confirmLabel: 'Восстановить' },
    ))) return;
    if (busy) return;
    setBusy(true);
    try {
      await financeApi.restoreBackup(b.id);
      invalidateFinanceAll(qc);
      toast.success('Данные восстановлены');
    } catch (e: any) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="section-title">Снимки данных</div>
      <div className="card">
        <p className="mini muted" style={{ marginTop: 0 }}>Автоснимок — каждый день в 02:00 (хранятся последние 30). Перед восстановлением текущее состояние сохраняется — операция обратима.</p>
        {isLoading ? <div className="mini muted">Загрузка…</div> : backups.length === 0 ? (
          <div className="mini muted">Снимков пока нет — первый появится после 02:00 или по кнопке.</div>
        ) : (
          <div className="table-wrap" style={{ boxShadow: 'none', border: 'none' }}>
            <table>
              <thead><tr><th>Когда</th><th>Тип</th><th className="num">Операций</th><th /></tr></thead>
              <tbody>
                {backups.map((b: any) => (
                  <tr key={b.id}>
                    <td><b>{new Date(b.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</b></td>
                    <td>{KIND_LABEL[b.kind] ?? b.kind}</td>
                    <td className="num">{b.stats?.transactions ?? '—'}</td>
                    <td className="num"><span className="row-actions">
                      <button className="btn ghost sm" title="Скачать JSON" onClick={() => download(b)}><FinIcon name="download" size={15} /></button>
                      <button className="btn ghost sm" title="Восстановить из снимка" disabled={busy} onClick={() => restore(b)}><FinIcon name="undo" size={15} /></button>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button className="btn sm" style={{ marginTop: 12 }} disabled={busy} onClick={createSnapshot}><FinIcon name="plus" size={14} /> Создать снимок сейчас</button>
      </div>
    </>
  );
}

function Directory({ title, items, head, cols, onAdd, onEdit, onDel, canDelete }: {
  title: string; items: any[]; head: string[]; cols: (x: any) => ReactNode[];
  onAdd: () => void; onEdit: (x: any) => void; onDel: (x: any) => void; canDelete?: (x: any) => boolean;
}) {
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="table-wrap">
        <table>
          <thead><tr>{head.map((h, i) => <th key={i} className={i > 0 ? 'num' : ''}>{h}</th>)}<th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={head.length + 1} className="empty">Пусто</td></tr>}
            {items.map((it: any) => (
              <tr key={it.id} onDoubleClick={() => onEdit(it)}>
                {cols(it).map((c, i) => <td key={i} className={i > 0 ? 'num' : ''}>{i === 0 ? <b>{c}</b> : c}</td>)}
                <td className="num"><span className="row-actions">
                  <button className="btn ghost sm" onClick={() => onEdit(it)}><FinIcon name="edit" size={15} /></button>
                  {(!canDelete || canDelete(it)) && (
                    <button className="btn ghost sm danger" onClick={() => onDel(it)}><FinIcon name="trash" size={15} /></button>
                  )}
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn sm" style={{ marginTop: 12, marginBottom: 4 }} onClick={onAdd}><FinIcon name="plus" size={14} /> Добавить</button>
    </>
  );
}

function Palette({ color, setColor }: { color: string; setColor: (c: string) => void }) {
  return (
    <div className="field"><label>Цвет</label>
      <div className="flex" style={{ flexWrap: 'wrap' }}>
        {COLOR_PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)}
            style={{ width: 26, height: 26, borderRadius: 7, background: c, cursor: 'pointer', border: color === c ? '2px solid var(--text)' : '2px solid transparent' }} />
        ))}
      </div>
    </div>
  );
}

function AccountModal({ account, onClose }: { account?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState(account?.kind ?? 'bank');
  const [color, setColor] = useState(account?.color ?? COLOR_PALETTE[0]);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = { name: name.trim(), kind, color };
      if (account) await financeApi.updateAccount(account.id, p);
      else await financeApi.createAccount({ ...p, startBalance: 0 });
      invalidateFinanceAll(qc);
      onClose();
    } catch (e: any) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }
  return (
    <FinModal title={account ? 'Счёт' : 'Новый счёт'} onClose={onClose} width={440}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </>}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Тип</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="bank">Банк</option><option value="cash">Наличные</option><option value="savings">Накопления</option>
        </select>
      </div>
      <Palette color={color} setColor={setColor} />
    </FinModal>
  );
}

function CategoryModal({ category, onClose }: { category?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [type, setType] = useState(category?.type ?? 'expense');
  const [color, setColor] = useState(category?.color ?? COLOR_PALETTE[4]);
  const [icon, setIcon] = useState<string>(category?.icon ?? 'box');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = { name: name.trim(), type, color, icon };
      if (category) await financeApi.updateCategory(category.id, p);
      else await financeApi.createCategory(p);
      invalidateFinanceAll(qc);
      onClose();
    } catch (e: any) {
      toast.error(apiErr(e));
      setBusy(false);
    }
  }
  return (
    <FinModal title={category ? 'Категория' : 'Новая категория'} onClose={onClose} width={440}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </>}>
      <div className="field"><label>Название</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Реклама, Транспорт, Налоги…" /></div>
      <div className="field"><label>Тип</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="income">Доход</option><option value="expense">Расход</option>
          <option value="saving">Накопление</option>
        </select>
      </div>
      <Palette color={color} setColor={setColor} />
      <IconPicker icon={icon} setIcon={setIcon} color={color} />
    </FinModal>
  );
}

function IconPicker({ icon, setIcon, color }: { icon: string; setIcon: (v: string) => void; color: string }) {
  return (
    <div className="field"><label>Иконка</label>
      <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
        {PICKER_ICONS.map((n) => (
          <button key={n} type="button" onClick={() => setIcon(n)}
            title={n}
            style={{ padding: 0, border: icon === n ? '2px solid var(--text)' : '2px solid transparent', borderRadius: 9, background: 'transparent', cursor: 'pointer' }}>
            <CatIcon icon={n} color={color} size={30} />
          </button>
        ))}
      </div>
    </div>
  );
}
