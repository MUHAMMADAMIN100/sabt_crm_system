import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Copy } from 'lucide-react'
import type { DirectStatusInfo } from '@/services/direct.api'
import { duration } from './directTime'

function Row({ label, value, tone = 'normal' }: { label: string; value: React.ReactNode; tone?: 'normal' | 'warn' | 'bad' | 'muted' }) {
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

/** Состояние подключения Instagram — для администратора и основателя. */
export default function ConnectionPanel({ status }: { status: DirectStatusInfo }) {
  const missing = [
    !status.configured.token && 'INSTAGRAM_ACCESS_TOKEN',
    !status.configured.secret && 'INSTAGRAM_APP_SECRET',
    !status.configured.verifyToken && 'META_VERIFY_TOKEN',
  ].filter(Boolean) as string[]
  const expires = status.tokenExpiresAt ? new Date(status.tokenExpiresAt) : null
  const webhookAgo = status.lastWebhookAt ? Date.now() - new Date(status.lastWebhookAt).getTime() : null

  const copy = async () => {
    try { await navigator.clipboard.writeText(status.webhookUrl); toast.success('Адрес скопирован') }
    catch { toast.error('Не удалось скопировать') }
  }

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Подключение Instagram</h2>
      <dl className="mt-2 divide-y divide-surface-100 dark:divide-surface-700/60">
        <Row label="Аккаунт" value={status.account ? `@${status.account}` : status.connected ? 'проверяем ключ…' : 'не подключён'} tone={status.account ? 'normal' : 'muted'} />
        <Row
          label="Ключ доступа"
          tone={status.tokenInvalid ? 'bad' : !status.connected ? 'muted' : 'normal'}
          value={status.tokenInvalid
            ? 'Instagram не принимает ключ — сгенерируйте новый и замените INSTAGRAM_ACCESS_TOKEN в Railway'
            : !status.connected ? 'не задан'
            : expires ? `действует до ${expires.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, CRM продлевает его сама`
            : 'действует 60 дней с выпуска, CRM продлевает его сама'}
        />
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
