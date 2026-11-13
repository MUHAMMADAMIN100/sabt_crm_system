import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { directApi, type DirectLabel } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import DirectModal from './DirectModal'
import { useLabels } from './chatActions'
import { LABEL_COLORS, labelColor } from './labelColors'

/** Справочник меток «Директа» — только руководству (сервер проверяет сам). */
export default function LabelsManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: labels, isLoading } = useLabels()
  const [name, setName] = useState('')
  const [color, setColor] = useState('sky')
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  const done = (list: DirectLabel[]) => {
    qc.setQueryData(['direct', 'labels'], list)
    qc.invalidateQueries({ queryKey: ['direct', 'list'] })
  }
  const err = (e: any) => toast.error(e?.response?.data?.message || 'Не получилось')
  // Поле очищаем сразу: ответ сервера может прийти, когда человек уже
  // печатает следующую метку, — её нельзя стереть. Не вышло — возвращаем.
  const create = useMutation({
    mutationFn: (v: { name: string; color: string }) => directApi.createLabel(v),
    onMutate: () => setName(''),
    onSuccess: list => { done(list); toast.success('Метка добавлена') },
    onError: (e: any, v) => { setName(cur => cur || v.name); err(e) },
  })
  const update = useMutation({
    mutationFn: (v: { id: string; name: string; color: string }) => directApi.updateLabel(v.id, { name: v.name.trim(), color: v.color }),
    onSuccess: list => { done(list); setEditing(null) },
    onError: err,
  })
  const remove = useMutation({
    mutationFn: (id: string) => directApi.deleteLabel(id),
    onSuccess: list => { done(list); setConfirm(null); toast.success('Метка удалена — с чатов она снята') },
    onError: err,
  })

  return (
    <DirectModal title="Метки чатов" onClose={onClose} width={480}>
      <div className="space-y-4 p-4">
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (name.trim() && !create.isPending) create.mutate({ name: name.trim(), color }) }}>
          <label className="label" htmlFor="new-label">Новая метка</label>
          <div className="flex gap-2">
            <input id="new-label" className="input min-w-0 flex-1" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="Например: Горячий" />
            <button type="submit" className="btn-primary shrink-0" disabled={!name.trim() || create.isPending}><Plus size={15} /> Добавить</button>
          </div>
          <ColorRow value={color} onChange={setColor} />
        </form>

        {isLoading ? <div className="flex justify-center py-4"><Spinner /></div> : !labels?.length ? (
          <p className="rounded-lg bg-surface-50 px-3 py-2.5 text-[13px] text-surface-500 dark:bg-surface-900/50">
            Меток пока нет. Метки помогают делить клиентов: «Горячий», «SMM», «Сайт», «Думает».
          </p>
        ) : (
          <ul className="divide-y divide-surface-100 rounded-xl border border-surface-200 dark:divide-surface-700 dark:border-surface-700">
            {labels.map(l => (
              <li key={l.id} className="px-3 py-2">
                {editing?.id === l.id ? (
                  <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (editing.name.trim()) update.mutate(editing) }}>
                    <div className="flex gap-1.5">
                      <input autoFocus className="input !min-h-[32px] min-w-0 flex-1 !py-1" maxLength={40} value={editing.name}
                        onChange={e => setEditing({ ...editing, name: e.target.value })} aria-label="Название метки" />
                      <button type="submit" className="rounded-lg p-1.5 text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10" aria-label="Сохранить" disabled={update.isPending}><Check size={17} /></button>
                      <button type="button" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label="Отмена" onClick={() => setEditing(null)}><X size={17} /></button>
                    </div>
                    <ColorRow value={editing.color} onChange={c => setEditing({ ...editing, color: c })} />
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12.5px] font-medium', labelColor(l.color).chip)}>
                      <span className={clsx('h-2 w-2 rounded-full', labelColor(l.color).dot)} /> {l.name}
                    </span>
                    <span className="ml-auto flex items-center">
                      {confirm === l.id ? (
                        <>
                          <span className="mr-1 text-[12px] text-surface-500">Снимется со всех чатов</span>
                          <button type="button" className="btn-danger !min-h-0 !px-2 !py-1 text-xs" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>Удалить</button>
                          <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setConfirm(null)}>Нет</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label={`Изменить метку ${l.name}`}
                            onClick={() => setEditing({ id: l.id, name: l.name, color: l.color })}><Pencil size={15} /></button>
                          <button type="button" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label={`Удалить метку ${l.name}`}
                            onClick={() => setConfirm(l.id)}><Trash2 size={15} /></button>
                        </>
                      )}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DirectModal>
  )
}

function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Цвет метки">
      {LABEL_COLORS.map(c => (
        <button key={c.key} type="button" role="radio" aria-checked={value === c.key} aria-label={c.name} title={c.name}
          onClick={() => onChange(c.key)}
          className={clsx('flex h-7 w-7 items-center justify-center rounded-full border-2', value === c.key ? 'border-surface-800 dark:border-white' : 'border-transparent')}>
          <span className={clsx('h-4 w-4 rounded-full', c.dot)} />
        </button>
      ))}
    </div>
  )
}
