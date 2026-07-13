// Справочники организатора съёмок: Клиенты / Модели / Места.
// Один компонент на три раздела (kind), полный CRUD. Доступ — грант
// organizer.directory (организатор, руководитель SMM, топ).
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { organizerApi } from '@/services/api.service'
import { ConfirmDialog, Modal } from '@/components/ui'
import { Plus, Search, Edit, Trash2, Contact, PersonStanding, MapPin, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

type Kind = 'clients' | 'models' | 'places'

interface Field {
  key: string
  label: string
  required?: boolean
  textarea?: boolean
  money?: boolean
  placeholder?: string
}

const CONFIGS: Record<Kind, { title: string; subtitle: string; icon: any; addLabel: string; fields: Field[] }> = {
  clients: {
    title: 'Клиенты',
    subtitle: 'Справочник клиентов для организации съёмок',
    icon: Contact,
    addLabel: 'Клиент',
    fields: [
      { key: 'name', label: 'Имя / название', required: true, placeholder: 'Клиника Индотач' },
      { key: 'company', label: 'Компания / бренд' },
      { key: 'phone', label: 'Телефон', placeholder: '+992 …' },
      { key: 'instagram', label: 'Instagram', placeholder: '@…' },
      { key: 'telegram', label: 'Telegram', placeholder: '@…' },
      { key: 'address', label: 'Адрес' },
      { key: 'note', label: 'Заметка', textarea: true },
    ],
  },
  models: {
    title: 'Модели',
    subtitle: 'Модели и актёры для съёмок',
    icon: PersonStanding,
    addLabel: 'Модель',
    fields: [
      { key: 'name', label: 'Имя', required: true },
      { key: 'phone', label: 'Телефон', placeholder: '+992 …' },
      { key: 'instagram', label: 'Instagram', placeholder: '@…' },
      { key: 'look', label: 'Типаж / описание', textarea: true, placeholder: 'возраст, внешность, опыт…' },
      { key: 'rate', label: 'Ставка за съёмку, с.', money: true },
      { key: 'note', label: 'Заметка', textarea: true },
    ],
  },
  places: {
    title: 'Места',
    subtitle: 'Локации для съёмок',
    icon: MapPin,
    addLabel: 'Место',
    fields: [
      { key: 'name', label: 'Название', required: true, placeholder: 'Кафе, студия, парк…' },
      { key: 'address', label: 'Адрес' },
      { key: 'contact', label: 'Контакт (администратор, телефон)' },
      { key: 'price', label: 'Стоимость аренды, с.', money: true },
      { key: 'link', label: 'Ссылка (карта / instagram)', placeholder: 'https://…' },
      { key: 'note', label: 'Заметка', textarea: true },
    ],
  },
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const showErr = (e: any) => toast.error(e?.response?.data?.message || 'Ошибка')

export default function OrganizerDirectoryPage({ kind }: { kind: Kind }) {
  const cfg = CONFIGS[kind]
  const Icon = cfg.icon
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<any | 'new' | null>(null)
  const [deleteRow, setDeleteRow] = useState<any | null>(null)

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['organizer', kind, search],
    queryFn: () => organizerApi.list(kind, search || undefined),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['organizer', kind] })

  const removeMut = useMutation({
    mutationFn: (id: string) => organizerApi.remove(kind, id),
    onSuccess: () => { invalidate(); toast.success('Удалено') },
    onError: showErr,
  })

  // Колонки таблицы: все поля кроме заметки/типажа (длинные — только в форме).
  const columns = cfg.fields.filter(f => !f.textarea)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon size={20} className="text-primary-600" />
            <h1 className="page-title">{cfg.title}</h1>
          </div>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{cfg.subtitle}</p>
        </div>
        <button onClick={() => setModal('new')} className="btn-primary text-sm">
          <Plus size={15} /> {cfg.addLabel}
        </button>
      </div>

      <div className="relative max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени…"
          className="input pl-9 text-sm"
        />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700 text-left">
              {columns.map(c => (
                <th key={c.key} className="px-4 py-2.5 text-[11px] uppercase tracking-wide text-surface-400 font-semibold whitespace-nowrap">
                  {c.money ? c.label.replace(', с.', '') : c.label}
                </th>
              ))}
              <th className="px-4 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-surface-400">Загрузка…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-surface-400">
                Пусто — добавьте первую запись кнопкой «＋ {cfg.addLabel}»
              </td></tr>
            )}
            {rows.map((r: any) => (
              <tr key={r.id} onDoubleClick={() => setModal(r)}
                className="border-b border-surface-100 dark:border-surface-700/60 last:border-0 hover:bg-surface-50 dark:hover:bg-surface-700/40 cursor-pointer">
                {columns.map((c, i) => (
                  <td key={c.key} className="px-4 py-2.5 align-middle">
                    {i === 0 ? (
                      <div>
                        <span className="font-semibold text-surface-900 dark:text-surface-100">{r[c.key]}</span>
                        {r.note && <p className="text-[11px] text-surface-400 truncate max-w-[220px]" title={r.note}>{r.note}</p>}
                      </div>
                    ) : c.money ? (
                      <span className="tabular-nums whitespace-nowrap">{r[c.key] != null ? `${nf.format(r[c.key])} с.` : '—'}</span>
                    ) : c.key === 'link' && r.link ? (
                      <a href={r.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                        <ExternalLink size={12} /> открыть
                      </a>
                    ) : (
                      <span className="text-surface-600 dark:text-surface-300">{r[c.key] || '—'}</span>
                    )}
                  </td>
                ))}
                <td className="px-4 py-2.5 whitespace-nowrap text-right">
                  <button onClick={e => { e.stopPropagation(); setModal(r) }} title="Редактировать"
                    className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Edit size={14} /></button>
                  <button onClick={e => { e.stopPropagation(); setDeleteRow(r) }} title="Удалить"
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DirectoryModal
          kind={kind}
          cfg={cfg}
          row={modal === 'new' ? undefined : modal}
          onClose={() => setModal(null)}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={!!deleteRow}
        title="Удалить запись?"
        message={deleteRow ? `«${deleteRow.name}» будет удалено безвозвратно.` : undefined}
        danger
        onConfirm={() => { if (deleteRow) removeMut.mutate(deleteRow.id) }}
        onClose={() => setDeleteRow(null)}
      />
    </div>
  )
}

function DirectoryModal({ kind, cfg, row, onClose, onSaved }: {
  kind: Kind; cfg: (typeof CONFIGS)[Kind]; row?: any; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(cfg.fields.map(f => [f.key, row?.[f.key] != null ? String(row[f.key]) : ''])),
  )
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  async function save() {
    if (!form.name?.trim() || busy) return
    setBusy(true)
    const payload: Record<string, any> = {}
    for (const f of cfg.fields) {
      const v = form[f.key]?.trim() ?? ''
      payload[f.key] = f.money ? (v === '' ? null : parseFloat(v.replace(',', '.'))) : (v === '' ? null : v)
    }
    try {
      if (row) await organizerApi.update(kind, row.id, payload)
      else await organizerApi.create(kind, payload)
      onSaved()
      onClose()
      toast.success(row ? 'Сохранено' : 'Добавлено')
    } catch (e) { showErr(e) } finally { setBusy(false) }
  }

  // Общий Modal рендерится порталом в body: самодельный fixed-оверлей ловил
  // transform от анимации контейнера страницы и уезжал за верх экрана.
  return (
    <Modal open onClose={onClose} title={row ? `Изменить: ${row.name}` : `Новая запись — ${cfg.title.toLowerCase()}`}>
      <div className="space-y-3">
        {cfg.fields.map(f => (
          <div key={f.key}>
            <label className="label">{f.label}{f.required && ' *'}</label>
            {f.textarea ? (
              <textarea value={form[f.key]} onChange={e => set(f.key, e.target.value)} rows={2}
                placeholder={f.placeholder} className="input text-sm resize-y" />
            ) : (
              <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder} inputMode={f.money ? 'decimal' : undefined}
                className="input text-sm" />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600">
          Отмена
        </button>
        <button onClick={save} disabled={!form.name?.trim() || busy} className="btn-primary text-sm disabled:opacity-50">
          {row ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Modal>
  )
}
