import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Film, Image as ImageIcon, GalleryHorizontalEnd, Palette, FileText, Plus, X, Loader2, Check, Trash2, ListTree } from 'lucide-react'
import toast from 'react-hot-toast'
import { contentPlanApi } from '@/services/api.service'
import { DatePicker } from '@/components/ui/DatePicker'

// Блок «Контент-план» на странице SMM-проекта (Вариант A): таблица позиций
// (тип · тема/сценарий · дата · дедлайн · статус) + редактор с полем «Сценарий».
// Позиции — те же content_plan_items, что и в Умном календаре: появляются там же.

type Item = {
  id: string
  contentType: string
  topic: string
  scriptText?: string | null
  caption?: string | null
  publishDate?: string | null
  preparationDeadline?: string | null
  status: string
  fileLink?: string | null
  assignee?: { name?: string } | null
}

// Сторис в КП не ведём — их СММ-специалисты делают автоматически (см. /smm/stories).
// Здесь только макеты/посты, рилсы, карусели, дизайн.
const TYPES: { v: string; label: string; Icon: any }[] = [
  { v: 'reel', label: 'Рилс', Icon: Film },
  { v: 'post', label: 'Макет / пост', Icon: ImageIcon },
  { v: 'carousel', label: 'Карусель', Icon: GalleryHorizontalEnd },
  { v: 'design', label: 'Дизайн', Icon: Palette },
  { v: 'other', label: 'Другое', Icon: FileText },
]
const typeMeta = (v: string) => TYPES.find(t => t.v === v) ?? TYPES[TYPES.length - 1]

const STATUS: { v: string; label: string; cls: string }[] = [
  { v: 'planned', label: 'Планируется', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  { v: 'preparing', label: 'Подготовка', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { v: 'in_production', label: 'В производстве', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { v: 'on_review', label: 'На ревью', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { v: 'on_approval', label: 'На согласовании', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  { v: 'approved', label: 'Согласовано', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { v: 'published', label: 'Опубликовано', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  { v: 'cancelled', label: 'Отменено', cls: 'bg-gray-100 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500' },
]
const statusMeta = (v: string) => STATUS.find(s => s.v === v) ?? STATUS[0]

const fld = 'w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500'
const lbl = 'block text-xs text-gray-500 mb-1'
const card = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5'

const dOnly = (v?: string | null) => (v ? String(v).slice(0, 10) : '')
const fmtShort = (v?: string | null) => {
  const s = dOnly(v); if (!s) return '—'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

type Draft = { contentType: string; topic: string; scriptText: string; caption: string; publishDate: string; preparationDeadline: string; status: string; fileLink: string }
const blank: Draft = { contentType: 'reel', topic: '', scriptText: '', caption: '', publishDate: '', preparationDeadline: '', status: 'planned', fileLink: '' }
const fromItem = (it: Item): Draft => ({
  contentType: it.contentType || 'other', topic: it.topic || '', scriptText: it.scriptText || '', caption: it.caption || '',
  publishDate: dOnly(it.publishDate), preparationDeadline: dOnly(it.preparationDeadline), status: it.status || 'planned', fileLink: it.fileLink || '',
})

export default function SmmContentPlan({ projectId, color, canEdit, canDelete }: {
  projectId: string; color: string; canEdit: boolean; canDelete: boolean
}) {
  const qc = useQueryClient()
  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ['content-plan', projectId],
    queryFn: () => contentPlanApi.list({ projectId }),
    enabled: !!projectId,
  })
  // Сторисы в КП не показываем — их ведут отдельно (автоматом у СММ-специалистов).
  const shown = items.filter(it => it.contentType !== 'story')

  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [d, setD] = useState<Draft>(blank)

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['content-plan', projectId] }); qc.invalidateQueries({ queryKey: ['smm-calendar'] }) }
  const createMut = useMutation({
    mutationFn: (body: any) => contentPlanApi.create(body),
    onSuccess: () => { invalidate(); setOpen(false); toast.success('Позиция добавлена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => contentPlanApi.update(id, body),
    onSuccess: () => { invalidate(); setOpen(false); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  const removeMut = useMutation({
    mutationFn: (id: string) => contentPlanApi.remove(id),
    onSuccess: () => { invalidate(); setOpen(false); toast.success('Удалено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось удалить'),
  })
  const saving = createMut.isPending || updateMut.isPending

  const openNew = () => { setEditId(null); setD(blank); setOpen(true) }
  const openItem = (it: Item) => { if (!canEdit) return; setEditId(it.id); setD(fromItem(it)); setOpen(true) }
  const save = () => {
    if (!d.topic.trim()) { toast.error('Введите тему'); return }
    const body: any = {
      projectId, contentType: d.contentType, topic: d.topic.trim(), status: d.status,
      scriptText: d.scriptText.trim() || null, caption: d.caption.trim() || null, fileLink: d.fileLink.trim() || null,
      publishDate: d.publishDate || null, preparationDeadline: d.preparationDeadline || null,
    }
    if (editId) updateMut.mutate({ id: editId, body }); else createMut.mutate(body)
  }

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 inline-flex items-center gap-2"><ListTree size={14} /> Контент-план</h2>
        {canEdit && (
          <button onClick={openNew} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white hover:brightness-110" style={{ background: color }}>
            <Plus size={14} /> Добавить
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : shown.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          Пока нет позиций. {canEdit && <button onClick={openNew} className="text-primary-600 font-semibold hover:underline">Добавить первую</button>}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <th className="px-2 py-2 font-bold">Тип</th>
                <th className="px-2 py-2 font-bold">Тема / сценарий</th>
                <th className="px-2 py-2 font-bold whitespace-nowrap">Публикация</th>
                <th className="px-2 py-2 font-bold whitespace-nowrap">Дедлайн</th>
                <th className="px-2 py-2 font-bold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(it => {
                const tm = typeMeta(it.contentType); const sm = statusMeta(it.status); const TIcon = tm.Icon
                return (
                  <tr key={it.id} onClick={() => openItem(it)}
                    className={'border-b border-gray-50 dark:border-gray-800/60 ' + (canEdit ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : '')}>
                    <td className="px-2 py-2.5 align-middle">
                      <span className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap" style={{ color }}><TIcon size={14} /> {tm.label}</span>
                    </td>
                    <td className="px-2 py-2.5 align-middle max-w-[420px]">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{it.topic || <span className="text-gray-400 font-normal">Без темы</span>}</div>
                      {it.scriptText && <div className="text-[11.5px] text-gray-400 truncate">{it.scriptText}</div>}
                    </td>
                    <td className="px-2 py-2.5 align-middle tabular-nums whitespace-nowrap text-gray-500">{fmtShort(it.publishDate)}</td>
                    <td className="px-2 py-2.5 align-middle tabular-nums whitespace-nowrap text-gray-500">{fmtShort(it.preparationDeadline)}</td>
                    <td className="px-2 py-2.5 align-middle">
                      <span className={'inline-flex items-center text-[11px] font-bold rounded-lg px-2.5 py-1 whitespace-nowrap ' + sm.cls}>{sm.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && createPortal(
        <Editor
          d={d} setD={setD} editId={editId} saving={saving} deleting={removeMut.isPending}
          canDelete={canDelete} onSave={save} onClose={() => setOpen(false)}
          onDelete={() => { if (editId) removeMut.mutate(editId) }}
        />, document.body)}
    </div>
  )
}

function Editor({ d, setD, editId, saving, deleting, canDelete, onSave, onClose, onDelete }: {
  d: Draft; setD: (u: (p: Draft) => Draft) => void; editId: string | null; saving: boolean; deleting: boolean
  canDelete: boolean; onSave: () => void; onClose: () => void; onDelete: () => void
}) {
  const set = (k: keyof Draft) => (v: string) => setD(p => ({ ...p, [k]: v }))
  const TIcon = typeMeta(d.contentType).Icon
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 py-8 bg-black/50 overflow-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <span className="w-9 h-9 rounded-xl grid place-items-center bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300"><TIcon size={18} /></span>
          <h3 className="text-base font-bold flex-1">{editId ? 'Позиция контент-плана' : 'Новая позиция'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={lbl}>Тип</label>
              <select value={d.contentType} onChange={e => set('contentType')(e.target.value)} className={fld}>
                {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Статус</label>
              <select value={d.status} onChange={e => set('status')(e.target.value)} className={fld}>
                {STATUS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={lbl}>Дата публикации</label><DatePicker value={d.publishDate} onChange={set('publishDate')} placeholder="дата" /></div>
            <div><label className={lbl}>Дедлайн подготовки</label><DatePicker value={d.preparationDeadline} onChange={set('preparationDeadline')} placeholder="дата" /></div>
          </div>

          <div><label className={lbl}>Тема <span className="text-red-500">*</span></label>
            <input value={d.topic} onChange={e => set('topic')(e.target.value)} placeholder="Напр. Рилс: 3 ошибки в маникюре" className={fld} autoFocus /></div>

          <div className="relative">
            <span className="absolute right-0 -top-0.5 text-[10px] font-bold text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 rounded-md px-1.5 py-0.5">сценарий</span>
            <label className={lbl}>Сценарий</label>
            <textarea value={d.scriptText} onChange={e => set('scriptText')(e.target.value)} rows={5}
              placeholder={'Хук (0–2 с) → сцены → CTA.\nМожно раскадровку по строкам.'} className={fld + ' resize-y leading-relaxed'} />
          </div>

          <div><label className={lbl}>Подпись к публикации</label>
            <textarea value={d.caption} onChange={e => set('caption')(e.target.value)} rows={2} placeholder="Текст под постом, хэштеги…" className={fld + ' resize-y leading-relaxed'} /></div>

          <div><label className={lbl}>Ссылка на файл</label>
            <input value={d.fileLink} onChange={e => set('fileLink')(e.target.value)} placeholder="Google Drive / Figma / R2…" className={fld} /></div>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          {editId && canDelete && (
            <button onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60">
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Удалить
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          <button onClick={onSave} disabled={saving || !d.topic.trim()}
            className="inline-flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-[#3f7a58] text-white hover:brightness-110 disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
