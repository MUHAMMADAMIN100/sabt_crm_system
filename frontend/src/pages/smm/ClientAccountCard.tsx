// «Аккаунт клиента» на вкладке «Обзор» SMM-проекта (макет владельца
// 19.10.2026, вариант Б): ссылка на страницу клиента, логин и пароль.
// Ссылку видят все, кто открыл проект. Логин и пароль — руководитель СММ,
// менеджер по продажам SMM, SMM-специалист этого проекта и основатель; они
// же их меняют. Пароль приходит отдельным запросом и только им, хранится
// на сервере зашифрованным.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, Copy, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react'
import { projectsApi } from '@/services/api.service'
import { Modal } from '@/components/ui'

type Access = { pageUrl?: string; login: string; password: string; note: string; updatedAt?: string | null; updatedByName?: string | null }

const card = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5'
const secLabel = 'text-[11px] font-bold uppercase tracking-wider text-gray-400'
const row = 'flex items-center gap-2.5 min-h-[50px] border-t border-gray-100 dark:border-gray-800'
const iconBtn = 'w-9 h-9 sm:w-[34px] sm:h-[34px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center justify-center shrink-0'

/** «instagram.com/afsona.tj» — ссылка без протокола и хвостового слеша. */
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

export default function ClientAccountCard({ projectId, pageUrl, canSeeAccess }: {
  projectId: string
  pageUrl: string | null
  canSeeAccess: boolean
}) {
  const qc = useQueryClient()
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState<'login' | 'password' | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ pageUrl: '', login: '', password: '', note: '' })
  const [formShown, setFormShown] = useState(false)

  const { data, isLoading } = useQuery<Access>({
    queryKey: ['client-access', projectId],
    queryFn: () => projectsApi.clientAccess(projectId),
    enabled: canSeeAccess,
    staleTime: 5 * 60_000,
  })

  const save = useMutation({
    mutationFn: () => projectsApi.saveClientAccess(projectId, form),
    onSuccess: (fresh: Access) => {
      qc.setQueryData(['client-access', projectId], fresh)
      qc.setQueryData(['smm-profile', projectId], (old: any) => old && { ...old, pageUrl: fresh.pageUrl || null })
      setEditing(false)
      setShown(false)
      toast.success('Сохранено')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })

  if (!pageUrl && !canSeeAccess) return null

  const copy = async (what: 'login' | 'password', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      toast.error('Браузер не дал скопировать')
    }
  }
  const startEdit = () => {
    setForm({ pageUrl: pageUrl || data?.pageUrl || '', login: data?.login || '', password: data?.password || '', note: data?.note || '' })
    setFormShown(false)
    setEditing(true)
  }
  const empty = !pageUrl && !data?.login && !data?.password && !data?.note

  return (
    <div className={card}>
      <div className="flex items-center mb-2">
        <h2 className={secLabel + ' flex-1'}>Аккаунт клиента</h2>
        {canSeeAccess && (
          <button type="button" onClick={startEdit} disabled={isLoading}
            className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            {empty ? 'Добавить' : 'Изменить'}
          </button>
        )}
      </div>

      {canSeeAccess && isLoading ? (
        <p className="text-sm text-gray-400 py-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Загружаем…</p>
      ) : empty ? (
        <p className="text-sm text-gray-400 py-2">Аккаунт не указан</p>
      ) : (
        <>
          {pageUrl && (
            <div className={row}>
              <span className="text-sm text-gray-500 w-20 shrink-0">Страница</span>
              <a href={pageUrl} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-w-0 text-right text-sm font-semibold text-blue-600 dark:text-blue-300 hover:underline truncate">{shortUrl(pageUrl)}</a>
              <a href={pageUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть страницу" className={iconBtn}><ExternalLink size={15} /></a>
            </div>
          )}
          {canSeeAccess && data?.login && (
            <div className={row}>
              <span className="text-sm text-gray-500 w-20 shrink-0">Логин</span>
              <span className="flex-1 min-w-0 text-right text-sm font-semibold break-all">{data.login}</span>
              <button type="button" onClick={() => copy('login', data.login)} aria-label="Скопировать логин" className={iconBtn}>
                {copied === 'login' ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
              </button>
            </div>
          )}
          {canSeeAccess && data?.password && (
            <div className={row}>
              <span className="text-sm text-gray-500 w-20 shrink-0">Пароль</span>
              <span className="flex-1 min-w-0 text-right text-sm font-semibold font-mono break-all">
                {shown ? data.password : '•'.repeat(Math.min(10, data.password.length))}
              </span>
              <button type="button" onClick={() => setShown(v => !v)} aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'} className={iconBtn}>
                {shown ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button type="button" onClick={() => copy('password', data.password)} aria-label="Скопировать пароль" className={iconBtn}>
                {copied === 'password' ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
              </button>
            </div>
          )}
          {canSeeAccess && (data?.note || data?.updatedAt) && (
            <p className="border-t border-gray-100 dark:border-gray-800 pt-2.5 text-[12.5px] text-gray-500 whitespace-pre-wrap">
              {data?.note}
              {data?.note && data?.updatedAt ? ' · ' : ''}
              {data?.updatedAt ? `обновлено ${new Date(data.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''}
            </p>
          )}
        </>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Аккаунт клиента" size="sm">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate() }}>
          <div>
            <label className="label" htmlFor="ca-url">Ссылка на страницу</label>
            <input id="ca-url" className="input" inputMode="url" autoComplete="off" value={form.pageUrl}
              onChange={e => setForm({ ...form, pageUrl: e.target.value })} placeholder="instagram.com/…" />
          </div>
          <div>
            <label className="label" htmlFor="ca-login">Логин</label>
            <input id="ca-login" className="input" autoComplete="off" value={form.login}
              onChange={e => setForm({ ...form, login: e.target.value })} placeholder="@account или email" />
          </div>
          <div>
            <label className="label" htmlFor="ca-password">Пароль</label>
            <div className="relative">
              <input id="ca-password" className="input pr-11" type={formShown ? 'text' : 'password'} autoComplete="new-password"
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setFormShown(v => !v)} aria-label={formShown ? 'Скрыть пароль' : 'Показать пароль'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                {formShown ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ca-note">Заметка</label>
            <textarea id="ca-note" className="input min-h-[72px]" value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Двухфакторка, привязанная почта" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Отмена</button>
            <button type="submit" disabled={save.isPending} className="btn-primary">{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
