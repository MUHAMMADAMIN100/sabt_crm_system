import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Pencil, Plus, Trash2, Users, User as UserIcon } from 'lucide-react'
import { directApi, type DirectTemplate } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import DirectModal from './DirectModal'

/**
 * Как обратиться к клиенту: «Фарход Каримов» → «Фарход» (имя и фамилия),
 * «Ювелирный магазин Золотые», «Торты и десерты» → целиком: это название,
 * а не имя, и первое слово прозвучало бы нелепо.
 */
export function addressOf(name?: string | null): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return words[0] || ''
  const capital = (w: string) => /^\p{Lu}/u.test(w)
  return words.length === 2 && words.every(capital) ? words[0] : words.join(' ')
}

/** Подстановки в шаблоне: имя клиента и моё имя. Имени нет — «Здравствуйте!», без висящей запятой. */
export function fillTemplate(text: string, vars: { client?: string | null; manager?: string | null }): string {
  const fill = (src: string, key: string, value: string) => {
    const re = new RegExp(`\\{\\s*${key}\\s*\\}`, 'gi')
    if (value) return src.replace(re, value)
    return src
      .replace(new RegExp(`,\\s*\\{\\s*${key}\\s*\\}`, 'gi'), '')
      .replace(new RegExp(`\\{\\s*${key}\\s*\\}\\s*,?\\s*`, 'gi'), '')
  }
  const manager = (vars.manager || '').trim().split(/\s+/)[0] || ''
  return fill(fill(text, 'имя', addressOf(vars.client)), 'менеджер', manager)
}

type Form = { id: string | null; title: string; text: string; shared: boolean }

/**
 * Шаблоны быстрых ответов: общие ведёт руководство, личные — каждый сам.
 * Подстановки {имя} и {менеджер} заполняются при вставке в ответ.
 */
export default function TemplatesManager({ isTop, onClose }: { isTop: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: templates, isLoading } = useQuery({ queryKey: ['direct', 'templates'], queryFn: directApi.templates, staleTime: 60_000 })
  const [form, setForm] = useState<Form | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['direct', 'templates'] })
  const save = useMutation({
    mutationFn: (f: Form) => f.id
      ? directApi.updateTemplate(f.id, { title: f.title, text: f.text })
      : directApi.createTemplate({ title: f.title, text: f.text, shared: f.shared }),
    onSuccess: () => { setForm(null); refresh(); toast.success('Шаблон сохранён') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Шаблон не сохранён'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => directApi.deleteTemplate(id),
    onSuccess: () => { refresh(); toast.success('Шаблон удалён') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось удалить'),
  })

  const shared = (templates ?? []).filter(t => t.shared)
  const mine = (templates ?? []).filter(t => !t.shared)
  const startNew = () => setForm({ id: null, title: '', text: '', shared: false })
  const edit = (t: DirectTemplate) => setForm({ id: t.id, title: t.title, text: t.text, shared: t.shared })
  const canSave = !!form && form.title.trim() && form.text.trim() && !save.isPending

  return (
    <DirectModal title="Шаблоны быстрых ответов" onClose={onClose} width={600}>
      <div className="space-y-4 p-4">
        {form ? (
          <form className="space-y-3 rounded-xl border border-surface-200 p-3 dark:border-surface-700"
            onSubmit={e => { e.preventDefault(); if (canSave) save.mutate(form!) }}>
            <div>
              <label className="label" htmlFor="tpl-title">Название</label>
              <input id="tpl-title" className="input" maxLength={80} autoFocus value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Например: Прайс на SMM" />
            </div>
            <div>
              <label className="label" htmlFor="tpl-text">Текст</label>
              <textarea id="tpl-text" className="input min-h-[120px] resize-y" maxLength={4000} value={form.text}
                onChange={e => setForm({ ...form, text: e.target.value })}
                placeholder="Здравствуйте, {имя}! Меня зовут {менеджер}…" />
              <p className="mt-1 text-[12px] text-surface-500">
                <code className="rounded bg-surface-100 px-1 dark:bg-surface-700">{'{имя}'}</code> — имя клиента,{' '}
                <code className="rounded bg-surface-100 px-1 dark:bg-surface-700">{'{менеджер}'}</code> — ваше имя. Подставятся при вставке.
              </p>
            </div>
            {!form.id && isTop && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Кому виден шаблон">
                {[false, true].map(v => (
                  <button key={String(v)} type="button" role="radio" aria-checked={form.shared === v}
                    onClick={() => setForm({ ...form, shared: v })}
                    className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
                      form.shared === v ? 'border-primary-600 bg-primary-600 text-white' : 'border-surface-300 text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700')}>
                    {v ? <><Users size={13} /> Общий — для всей команды</> : <><UserIcon size={13} /> Личный — только мне</>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Отмена</button>
              <button type="submit" className="btn-primary" disabled={!canSave}>{save.isPending ? 'Сохраняю…' : 'Сохранить'}</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-primary" onClick={startNew}><Plus size={15} /> Новый шаблон</button>
        )}

        {isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : (
          <>
            <Section title="Общие" hint={isTop ? 'Видны всей команде' : 'Ведёт руководство'} items={shared} onEdit={edit} onDelete={id => remove.mutate(id)} busy={remove.isPending} />
            <Section title="Мои" hint="Видны только вам" items={mine} onEdit={edit} onDelete={id => remove.mutate(id)} busy={remove.isPending}
              empty="Личных шаблонов пока нет. Сохраните сюда то, что часто пишете клиентам." />
          </>
        )}
      </div>
    </DirectModal>
  )
}

function Section({ title, hint, items, onEdit, onDelete, busy, empty }: {
  title: string; hint: string; items: DirectTemplate[]; onEdit: (t: DirectTemplate) => void; onDelete: (id: string) => void; busy: boolean; empty?: string
}) {
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <section>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-[13px] font-semibold text-surface-800 dark:text-surface-100">{title}</h3>
        <span className="text-[12px] text-surface-500">{hint}</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg bg-surface-50 px-3 py-2.5 text-[13px] text-surface-500 dark:bg-surface-900/50">{empty || 'Пока пусто'}</p>
      ) : (
        <ul className="divide-y divide-surface-100 rounded-xl border border-surface-200 dark:divide-surface-700 dark:border-surface-700">
          {items.map(t => (
            <li key={t.id} className="flex items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-surface-900 dark:text-white">{t.title}</div>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[12.5px] text-surface-500">{t.text}</p>
              </div>
              {t.canEdit && (
                confirm === t.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" className="btn-danger !min-h-0 !px-2 !py-1 text-xs" disabled={busy} onClick={() => { onDelete(t.id); setConfirm(null) }}>Удалить</button>
                    <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setConfirm(null)}>Нет</button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center">
                    <button type="button" onClick={() => onEdit(t)} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label={`Изменить шаблон ${t.title}`} title="Изменить">
                      <Pencil size={15} />
                    </button>
                    <button type="button" onClick={() => setConfirm(t.id)} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label={`Удалить шаблон ${t.title}`} title="Удалить">
                      <Trash2 size={15} />
                    </button>
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
