import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Eye, EyeOff, Copy, Check, Edit, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

/** Кому положено видеть доступы к аккаунтам клиента. Тот же список, что и на
 *  сервере (ProjectsService.CLIENT_ACCESS_ROLES) — здесь он только прячет
 *  блок, решение всё равно принимает бэкенд. */
const ACCESS_ROLES = ['smm_director', 'sales_manager_smm', 'founder']

export function canSeeClientAccess(user?: { role?: string | null; secondaryRole?: string | null } | null): boolean {
  if (!user) return false
  return ACCESS_ROLES.includes(user.role || '') || ACCESS_ROLES.includes(user.secondaryRole || '')
}

interface Access { login: string; password: string; note: string; updatedAt?: string | null; updatedByName?: string | null }

/**
 * Доступы к аккаунтам клиента (Instagram и прочее) в карточке проекта.
 * Отдельная ручка, а не часть карточки: пароль не должен приезжать всем,
 * кто просто открыл проект. Показан звёздочками, пока не нажмут «Показать».
 */
export default function ClientAccessCard({ projectId }: { projectId: string }) {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState<'login' | 'password' | null>(null)
  const [form, setForm] = useState<Access>({ login: '', password: '', note: '' })

  const allowed = canSeeClientAccess(user)

  const { data, isLoading } = useQuery<Access>({
    queryKey: ['client-access', projectId],
    queryFn: () => projectsApi.clientAccess(projectId),
    enabled: allowed && !!projectId,
    staleTime: 60_000,
  })

  const saveMut = useMutation({
    mutationFn: (v: Access) => projectsApi.saveClientAccess(projectId, {
      login: v.login, password: v.password, note: v.note,
    }),
    onSuccess: (fresh) => {
      qc.setQueryData(['client-access', projectId], fresh)
      setEditing(false)
      setShown(false)
      toast.success('Доступы сохранены')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить доступы'),
  })

  if (!allowed) return null

  const filled = !!(data && (data.login || data.password || data.note))

  const copy = async (what: 'login' | 'password', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      toast.error('Браузер не дал доступ к буферу обмена')
    }
  }

  const startEdit = () => {
    setForm({ login: data?.login || '', password: data?.password || '', note: data?.note || '' })
    setEditing(true)
  }

  return (
    <div className="card space-y-4 mt-4">
      <div className="flex items-center justify-between border-b border-surface-100 dark:border-surface-700 pb-3">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-base">Доступы к аккаунтам</h3>
        </div>
        {!editing && (
          <button onClick={startEdit}
            className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline">
            <Edit size={13} /> {filled ? 'Изменить' : 'Добавить'}
          </button>
        )}
      </div>

      <p className="text-[11px] text-surface-500 dark:text-surface-400 -mt-1">
        Видят только руководитель СММ, менеджер продаж СММ и основатель. Пароль хранится в зашифрованном виде.
      </p>

      {isLoading ? (
        <p className="text-sm text-surface-400 py-3 text-center flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Загружаем…
        </p>
      ) : editing ? (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="ca-login">Логин</label>
            <input id="ca-login" className="input" autoComplete="off" value={form.login}
              onChange={e => setForm({ ...form, login: e.target.value })}
              placeholder="@account или email" />
          </div>
          <div>
            <label className="label" htmlFor="ca-password">Пароль</label>
            <input id="ca-password" className="input" type={shown ? 'text' : 'password'}
              autoComplete="new-password" value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="Пароль от аккаунта" />
            <button type="button" onClick={() => setShown(v => !v)}
              className="mt-1 text-[11px] text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 inline-flex items-center gap-1">
              {shown ? <EyeOff size={11} /> : <Eye size={11} />} {shown ? 'Скрыть' : 'Показать'}
            </button>
          </div>
          <div>
            <label className="label" htmlFor="ca-note">Заметка</label>
            <textarea id="ca-note" className="input min-h-[72px]" value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="Двухфакторка, привязанная почта, особенности входа" />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => { setEditing(false); setShown(false) }} className="btn-secondary text-sm">Отмена</button>
            <button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}
              className="btn-primary text-sm">
              {saveMut.isPending ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </div>
      ) : !filled ? (
        <p className="text-sm text-surface-400 dark:text-surface-500 py-4 text-center">Доступы не указаны</p>
      ) : (
        <div className="space-y-3">
          {data!.login && (
            <div>
              <p className="text-xs text-surface-500 dark:text-surface-400">Логин</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 break-all">{data!.login}</p>
                <button onClick={() => copy('login', data!.login)} title="Скопировать логин"
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 shrink-0">
                  {copied === 'login' ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}
          {data!.password && (
            <div>
              <p className="text-xs text-surface-500 dark:text-surface-400">Пароль</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 break-all font-mono">
                  {shown ? data!.password : '•'.repeat(Math.min(12, data!.password.length))}
                </p>
                <button onClick={() => setShown(v => !v)} title={shown ? 'Скрыть' : 'Показать'}
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 shrink-0">
                  {shown ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button onClick={() => copy('password', data!.password)} title="Скопировать пароль"
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 shrink-0">
                  {copied === 'password' ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}
          {data!.note && (
            <div>
              <p className="text-xs text-surface-500 dark:text-surface-400">Заметка</p>
              <p className="text-sm text-surface-800 dark:text-surface-200 whitespace-pre-wrap">{data!.note}</p>
            </div>
          )}
          {data!.updatedByName && (
            <p className="text-[11px] text-surface-400 pt-1 border-t border-surface-100 dark:border-surface-700">
              Обновил: {data!.updatedByName}
              {data!.updatedAt && ` · ${new Date(data!.updatedAt).toLocaleDateString('ru-RU')}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
