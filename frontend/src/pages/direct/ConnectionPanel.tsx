import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { AlertTriangle, AtSign, Copy, Plus, X } from 'lucide-react'
import { directApi, type DirectAccount, type DirectStatusInfo } from '@/services/direct.api'
import { duration } from './directTime'

function Row({ label, value, tone = 'normal' }: { label: string; value: ReactNode; tone?: 'normal' | 'warn' | 'bad' | 'muted' }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-44 shrink-0 text-xs text-surface-500">{label}</dt>
      <dd className={clsx('min-w-0 text-sm',
        tone === 'bad' && 'font-medium text-red-600 dark:text-red-400',
        tone === 'warn' && 'font-medium text-amber-700 dark:text-amber-300',
        tone === 'muted' && 'text-surface-400',
        tone === 'normal' && 'text-surface-800 dark:text-surface-100')}>{value}</dd>
    </div>
  )
}

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

/** Подключение Instagram — для администратора и основателя: аккаунты
 *  (основной из Railway и подключённые в CRM), вебхук, хранилище. */
export default function ConnectionPanel({ status }: { status: DirectStatusInfo }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [token, setToken] = useState('')
  const [webhookHint, setWebhookHint] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const missing = [
    !status.configured.secret && 'INSTAGRAM_APP_SECRET',
    !status.configured.verifyToken && 'META_VERIFY_TOKEN',
  ].filter(Boolean) as string[]
  const webhookAgo = status.lastWebhookAt ? Date.now() - new Date(status.lastWebhookAt).getTime() : null
  const accounts = status.accounts ?? []

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['direct', 'status'] })
    qc.invalidateQueries({ queryKey: ['direct', 'list'] })
    qc.invalidateQueries({ queryKey: ['direct', 'counts'] })
  }
  const connect = useMutation({
    mutationFn: () => directApi.connectAccount(token.trim()),
    onSuccess: r => {
      setToken('')
      setAdding(false)
      refresh()
      toast.success(r.renewed ? `@${r.username}: ключ обновлён` : `@${r.username} подключён к Директу`)
      setWebhookHint(r.webhooks ? null : r.username)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Аккаунт не подключён'),
  })
  const disconnect = useMutation({
    mutationFn: (accountId: string) => directApi.disconnectAccount(accountId),
    onSuccess: () => { setConfirm(null); refresh(); toast.success('Аккаунт отключён — переписка осталась в CRM') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось отключить'),
  })

  const copy = async () => {
    try { await navigator.clipboard.writeText(status.webhookUrl); toast.success('Адрес скопирован') }
    catch { toast.error('Не удалось скопировать') }
  }

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Подключение Instagram</h2>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-surface-500">Аккаунты</h3>
          {!adding && status.configured.secret && (
            <button type="button" onClick={() => setAdding(true)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10">
              <Plus size={13} /> Добавить аккаунт
            </button>
          )}
        </div>
        {accounts.length === 0 ? (
          <p className="rounded-lg bg-surface-50 px-3 py-2.5 text-[13px] text-surface-500 dark:bg-surface-900/50">Ни одного аккаунта не подключено.</p>
        ) : (
          <ul className="divide-y divide-surface-100 rounded-xl border border-surface-200 dark:divide-surface-700 dark:border-surface-700" aria-label="Аккаунты Instagram">
            {accounts.map(a => (
              <AccountRow key={a.accountId || 'primary'} a={a} confirming={confirm === a.accountId}
                onAsk={() => setConfirm(a.accountId)} onCancel={() => setConfirm(null)}
                onDisconnect={() => a.accountId && disconnect.mutate(a.accountId)} busy={disconnect.isPending}
                onReconnect={() => setAdding(true)} />
            ))}
          </ul>
        )}

        {webhookHint && (
          <div className="mt-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              @{webhookHint} подключён, но Instagram не дал CRM включить уведомления. В кабинете Meta у этого аккаунта
              включите переключатель «Подписка на вебхуки» — иначе новые сообщения сюда не придут.
            </span>
            <button type="button" onClick={() => setWebhookHint(null)} className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/20" aria-label="Скрыть"><X size={14} /></button>
          </div>
        )}

        {adding && (
          <form className="mt-3 space-y-2.5 rounded-xl border border-surface-200 p-3 dark:border-surface-700"
            onSubmit={e => { e.preventDefault(); if (token.trim().length >= 20 && !connect.isPending) connect.mutate() }}>
            <div className="text-[13px] font-semibold text-surface-900 dark:text-white">Новый аккаунт Instagram</div>
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-snug text-surface-600 dark:text-surface-300">
              <li>В кабинете Meta для разработчиков откройте приложение <b>Sabt_ai_crm</b> → Instagram → «Настройка API со входом через Instagram».</li>
              <li>В шаге «Создать маркеры доступа» нажмите «Добавить аккаунт» и войдите в нужный Instagram (профессиональный аккаунт).</li>
              <li>Если Meta пишет, что не хватает роли: «Роли приложения» → «Тестировщики Instagram» → добавьте аккаунт, потом в Instagram: Настройки → Приложения и сайты → Приглашения тестировщиков → принять.</li>
              <li>Нажмите «Создать маркер» у этого аккаунта, скопируйте и вставьте ниже. Уведомления CRM включит сама.</li>
            </ol>
            <textarea value={token} onChange={e => setToken(e.target.value)} rows={3} spellCheck={false} autoComplete="off"
              placeholder="Маркер доступа (начинается с IGAA…)" aria-label="Маркер доступа Instagram"
              className="input resize-none font-mono !text-[12px]" />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setToken('') }}>Отмена</button>
              <button type="submit" className="btn-primary" disabled={token.trim().length < 20 || connect.isPending}>
                {connect.isPending ? 'Проверяю маркер…' : 'Подключить'}
              </button>
            </div>
          </form>
        )}
      </div>

      <dl className="mt-3 divide-y divide-surface-100 dark:divide-surface-700/60">
        <Row
          label="Уведомления от Meta"
          tone={webhookAgo === null ? 'muted' : 'normal'}
          value={webhookAgo === null ? 'ещё не приходили' : `последнее — ${duration(webhookAgo)} назад`}
        />
        <Row
          label="Адрес вебхука"
          value={(
            <span className="inline-flex max-w-full items-center gap-2">
              <code className="truncate rounded bg-surface-100 px-1.5 py-0.5 text-[12px] dark:bg-surface-700">{status.webhookUrl}</code>
              <button type="button" onClick={copy} className="rounded p-1 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label="Скопировать адрес" title="Скопировать">
                <Copy size={14} />
              </button>
            </span>
          )}
        />
        <Row
          label="Хранилище файлов"
          tone={status.storagePersistent === false ? 'warn' : 'normal'}
          value={status.storagePersistent === false
            ? 'временное — файлы пропадут при выкладке. Подключите том Railway на /app/uploads'
            : status.storagePersistent ? 'постоянное (том Railway)' : 'не удалось проверить'}
        />
        {missing.length > 0 && (
          <Row label="Не хватает в Railway" tone="warn" value={missing.join(', ')} />
        )}
      </dl>
    </div>
  )
}

function AccountRow({ a, confirming, onAsk, onCancel, onDisconnect, onReconnect, busy }: {
  a: DirectAccount
  confirming: boolean
  onAsk: () => void
  onCancel: () => void
  onDisconnect: () => void
  onReconnect: () => void
  busy: boolean
}) {
  const ago = a.lastEventAt ? Date.now() - new Date(a.lastEventAt).getTime() : null
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AtSign size={14} className="shrink-0 text-surface-400" />
        <span className="text-sm font-semibold text-surface-900 dark:text-white">{a.username || 'узнаём имя…'}</span>
        <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] text-surface-600 dark:bg-surface-700 dark:text-surface-300">
          {a.primary ? 'основной · ключ в Railway' : `подключён в CRM${a.connectedAt ? ` ${dateRu(a.connectedAt)}` : ''}`}
        </span>
        {!a.primary && (
          confirming ? (
            <span className="ml-auto flex items-center gap-1">
              <button type="button" className="btn-danger !min-h-0 !px-2 !py-1 text-xs" disabled={busy} onClick={onDisconnect}>Отключить</button>
              <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={onCancel}>Нет</button>
            </span>
          ) : (
            <button type="button" onClick={onAsk} className="ml-auto rounded-md px-2 py-1 text-xs text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-700 dark:hover:text-surface-100">
              Отключить
            </button>
          )
        )}
      </div>
      <div className="mt-1 space-y-0.5 pl-6 text-[12.5px]">
        {a.tokenInvalid ? (
          <p className="font-medium text-red-600 dark:text-red-400">
            Instagram не принимает ключ — {a.primary ? 'замените INSTAGRAM_ACCESS_TOKEN в Railway' : (
              <button type="button" onClick={onReconnect} className="underline">вставьте новый маркер</button>
            )}
          </p>
        ) : (
          <p className="text-surface-600 dark:text-surface-300">
            Ключ {a.tokenExpiresAt ? `действует до ${dateRu(a.tokenExpiresAt)}` : 'действует 60 дней'}, CRM продлевает его сама
          </p>
        )}
        <p className="text-surface-500">
          {ago === null ? 'сообщений через этот аккаунт ещё не было' : `последнее событие — ${duration(ago)} назад`} · чатов: {a.chats}
        </p>
        {confirming && <p className="text-surface-500">Переписка останется в CRM, но ответить из CRM будет нельзя, пока аккаунт снова не подключат.</p>}
      </div>
    </li>
  )
}
