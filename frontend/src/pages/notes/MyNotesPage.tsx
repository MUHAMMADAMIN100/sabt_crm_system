import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notesApi } from '@/services/api.service'
import { ConfirmDialog, PageLoader } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import {
  StickyNote, Plus, ChevronLeft, ChevronRight, Pencil, Trash2, Check, X, CalendarDays,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

/**
 * «Заметки» — личные задачи сторисмейкера с календарём. Бэк скоупит все
 * запросы по владельцу (userId из JWT) — заметки видит ТОЛЬКО их автор,
 * включая руководителей. Календарь подсвечивает дни, где есть задачи:
 * красный — просроченные невыполненные, зелёный — все выполнены,
 * акцентный — есть невыполненные (сегодня/будущее). Клик по дню — фильтр.
 */

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** '2026-07-17' → '17.07' (в списке) / '17.07.2026' (полный). */
function fmtDay(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-')
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}`
}

interface Note {
  id: string
  text: string
  date: string | null
  done: boolean
  createdAt: string
}

export default function MyNotesPage() {
  const qc = useQueryClient()
  const queryKey = ['my-notes']
  const today = todayISO()

  const { data: notes, isLoading } = useQuery<Note[]>({
    queryKey,
    queryFn: () => notesApi.list(),
  })

  // ── Календарь ────────────────────────────────────────────────────────
  const [ym, setYm] = useState(() => today.slice(0, 7))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [year, month] = ym.split('-').map(Number)

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Дни месяца сеткой с понедельника; в начале — пустые ячейки-отступы.
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1)
    const offset = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month, 0).getDate()
    const list: (string | null)[] = Array.from({ length: offset }, () => null)
    for (let d = 1; d <= daysInMonth; d++) {
      list.push(`${ym}-${String(d).padStart(2, '0')}`)
    }
    return list
  }, [ym, year, month])

  // Свод по дням: сколько задач и все ли выполнены.
  const byDate = useMemo(() => {
    const map = new Map<string, { total: number; undone: number }>()
    for (const n of notes || []) {
      if (!n.date) continue
      const key = String(n.date).slice(0, 10)
      const e = map.get(key) || { total: 0, undone: 0 }
      e.total += 1
      if (!n.done) e.undone += 1
      map.set(key, e)
    }
    return map
  }, [notes])

  // ── Мутации ──────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey })
  const createMut = useMutation({
    mutationFn: (data: { text: string; date?: string | null }) => notesApi.create(data),
    onSuccess: () => { invalidate(); setNewText(''); toast.success('Заметка добавлена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось добавить'),
  })
  const updateMut = useMutation({
    mutationKey: ['my-notes-update'],
    mutationFn: ({ id, data }: { id: string; data: any }) => notesApi.update(id, data),
    // Оптимизм: чекбокс «выполнено» и правки применяются мгновенно,
    // при ошибке сервера откатываемся к прежнему списку.
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<Note[]>(queryKey)
      qc.setQueryData(queryKey, (old: Note[] = []) => old.map(n => n.id === id ? { ...n, ...data } : n))
      // Закрываем редактор только если мутация — сохранение ЭТОЙ заметки:
      // toggle чекбокса на другой строке не должен терять введённый текст.
      if (id === editId) setEditId(null)
      return { previous }
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Не удалось сохранить')
    },
    // Не затираем оптимистичное состояние, пока летят другие PATCH'и
    // (быстрый двойной клик): invalidate только у последней мутации.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['my-notes-update'] }) === 1) invalidate()
    },
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => notesApi.remove(id),
    onSuccess: () => { invalidate(); setDeleteId(null); toast.success('Заметка удалена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось удалить'),
  })

  // ── Форма добавления ─────────────────────────────────────────────────
  const [newText, setNewText] = useState('')
  const [newDate, setNewDate] = useState<string>('')
  const submitNew = () => {
    const text = newText.trim()
    if (!text) { toast.error('Напишите текст заметки'); return }
    createMut.mutate({ text, date: (selectedDate || newDate) || null })
  }

  // ── Inline-редактирование ────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editDate, setEditDate] = useState<string>('')
  const startEdit = (n: Note) => {
    setEditId(n.id)
    setEditText(n.text)
    setEditDate(n.date ? String(n.date).slice(0, 10) : '')
  }
  const saveEdit = () => {
    const text = editText.trim()
    if (!text) { toast.error('Текст не может быть пустым'); return }
    if (editId) updateMut.mutate({ id: editId, data: { text, date: editDate || null } })
  }

  const [deleteId, setDeleteId] = useState<string | null>(null)

  // ── Список: фильтр по выбранному дню + сортировка ────────────────────
  const { active, doneList } = useMemo(() => {
    let list = [...(notes || [])]
    if (selectedDate) list = list.filter(n => n.date && String(n.date).slice(0, 10) === selectedDate)
    // Активные: просроченные → по дате → без даты. Выполненные — отдельно.
    const rank = (n: Note) => (n.date ? String(n.date).slice(0, 10) : '9999-99-99')
    const active = list.filter(n => !n.done).sort((a, b) => rank(a).localeCompare(rank(b)))
    const doneList = list.filter(n => n.done).sort((a, b) => rank(b).localeCompare(rank(a)))
    return { active, doneList }
  }, [notes, selectedDate])

  if (isLoading) return <PageLoader />

  const noteRow = (n: Note) => {
    const dateStr = n.date ? String(n.date).slice(0, 10) : null
    const overdue = !n.done && !!dateStr && dateStr < today
    if (editId === n.id) {
      return (
        <div key={n.id} className="card p-3 space-y-2">
          <input className="input" value={editText} onChange={e => setEditText(e.target.value)} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }} />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-44"><DatePicker value={editDate} onChange={setEditDate} placeholder="Без даты" /></div>
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={() => setEditId(null)} className="btn-secondary text-xs px-2.5 py-1.5"><X size={13} /> Отмена</button>
              <button type="button" onClick={saveEdit} disabled={updateMut.isPending} className="btn-primary text-xs px-2.5 py-1.5"><Check size={13} /> Сохранить</button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div key={n.id} className={clsx('card p-3 flex items-start gap-2.5 group', n.done && 'opacity-70')}>
        <input type="checkbox" checked={n.done} onChange={() => updateMut.mutate({ id: n.id, data: { done: !n.done } })}
          className="w-4 h-4 mt-0.5 shrink-0 cursor-pointer accent-green-600" title={n.done ? 'Вернуть в работу' : 'Отметить выполненной'} />
        <div className="min-w-0 flex-1">
          <p className={clsx('text-sm text-surface-800 dark:text-surface-100 break-words whitespace-pre-wrap leading-snug',
            n.done && 'line-through text-surface-400 dark:text-surface-500')}>{n.text}</p>
          {dateStr && (
            <span className={clsx('inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-1.5 py-0.5 rounded',
              n.done
                ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                : overdue
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                  : 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-300')}>
              <CalendarDays size={11} /> {fmtDay(dateStr, true)}{overdue && ' · просрочено'}
            </span>
          )}
        </div>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" title="Редактировать" onClick={() => startEdit(n)}
            className="p-1.5 rounded-md text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">
            <Pencil size={14} />
          </button>
          <button type="button" title="Удалить" onClick={() => setDeleteId(n.id)}
            className="p-1.5 rounded-md text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <StickyNote size={20} className="text-primary-600" />
          <h1 className="page-title">Заметки</h1>
        </div>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
          Личные задачи и заметки — их видите только вы.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-4 items-start">
        {/* ── Календарь ── */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} title="Предыдущий месяц"
              className="p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                {MONTHS_RU[month - 1]} {year}
              </span>
              {ym !== today.slice(0, 7) && (
                <button type="button" onClick={() => setYm(today.slice(0, 7))}
                  className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline">Сегодня</button>
              )}
            </div>
            <button type="button" onClick={() => shiftMonth(1)} title="Следующий месяц"
              className="p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS_RU.map(d => (
              <span key={d} className="text-[10px] font-semibold text-surface-400 uppercase py-1">{d}</span>
            ))}
            {cells.map((iso, i) => {
              if (!iso) return <span key={`x${i}`} />
              const info = byDate.get(iso)
              const isToday = iso === today
              const isSelected = iso === selectedDate
              const overdue = !!info && info.undone > 0 && iso < today
              const allDone = !!info && info.undone === 0
              return (
                <button key={iso} type="button"
                  onClick={() => setSelectedDate(prev => prev === iso ? null : iso)}
                  title={info ? `Задач: ${info.total}${info.undone ? ` · не выполнено: ${info.undone}` : ' · все выполнены'}` : undefined}
                  className={clsx(
                    'relative aspect-square rounded-lg text-xs font-medium flex flex-col items-center justify-center transition-colors',
                    isSelected
                      ? 'bg-primary-600 text-white'
                      : info
                        ? overdue
                          ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/25 dark:text-red-300 dark:hover:bg-red-900/40'
                          : allDone
                            ? 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/25 dark:text-green-300 dark:hover:bg-green-900/40'
                            : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/25 dark:text-primary-300 dark:hover:bg-primary-900/40'
                        : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700',
                    isToday && !isSelected && 'ring-1 ring-inset ring-primary-500',
                  )}>
                  {Number(iso.slice(8, 10))}
                  {info && (
                    <span className={clsx(
                      'absolute bottom-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-bold inline-flex items-center justify-center leading-none',
                      isSelected
                        ? 'bg-white/25 text-white'
                        : overdue
                          ? 'bg-red-500 text-white'
                          : allDone
                            ? 'bg-green-500 text-white'
                            : 'bg-primary-500 text-white',
                    )}>{info.total}</span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-surface-400 leading-relaxed">
            Подсвечены дни с задачами: красный — есть просроченные, зелёный — все выполнены. Клик по дню — фильтр списка.
          </p>
        </div>

        {/* ── Список + форма ── */}
        <div className="space-y-3">
          <div className="card p-3 space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input className="input flex-1" placeholder="Новая задача или заметка…"
                value={newText} onChange={e => setNewText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNew() }} maxLength={2000} />
              <div className="flex gap-2">
                <div className="w-44">
                  {selectedDate
                    ? <p className="input flex items-center text-sm text-surface-600 dark:text-surface-300 min-h-[38px]" title="Дата берётся из выбранного дня календаря">{fmtDay(selectedDate, true)}</p>
                    : <DatePicker value={newDate} onChange={setNewDate} placeholder="Без даты" />}
                </div>
                <button type="button" onClick={submitNew} disabled={createMut.isPending} className="btn-primary text-sm whitespace-nowrap">
                  <Plus size={14} /> Добавить
                </button>
              </div>
            </div>
          </div>

          {selectedDate && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-surface-700 dark:text-surface-200">Задачи на {fmtDay(selectedDate, true)}</span>
              <button type="button" onClick={() => setSelectedDate(null)}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Показать все</button>
            </div>
          )}

          {active.length === 0 && doneList.length === 0 ? (
            <div className="card p-8 text-center text-sm text-surface-400">
              {selectedDate ? 'На этот день заметок нет.' : 'Пока нет заметок — добавьте первую выше.'}
            </div>
          ) : (
            <>
              <div className="space-y-2">{active.map(noteRow)}</div>
              {doneList.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-surface-400 uppercase tracking-wide pt-2">
                    Выполненные ({doneList.length})
                  </p>
                  {doneList.map(noteRow)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title="Удалить заметку?"
        message="Это действие нельзя отменить."
        danger
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        onClose={() => setDeleteId(null)}
      />
    </div>
  )
}
