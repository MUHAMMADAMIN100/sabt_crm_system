import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, BellOff, MessageCircle, Settings2 } from 'lucide-react'
import { directApi } from '@/services/direct.api'
import { useAuthStore } from '@/store/auth.store'
import { directSoundEnabled, playDirectChime, setDirectSound } from '@/lib/directSound'
import ConversationList from './ConversationList'
import ChatPane from './ChatPane'
import SpeedView from './SpeedView'
import ConnectionPanel from './ConnectionPanel'

type Tab = 'chats' | 'speed'

/**
 * «Директ» — переписка Instagram аккаунта агентства (04.11.2026).
 * Чат общий: видят все с доступом к Базе клиентов, отвечает любой.
 * Адрес чата — /direct?c=<id>: по нему ведут уведомления.
 */
export default function DirectPage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('c')
  const tab: Tab = params.get('tab') === 'speed' ? 'speed' : 'chats'
  const role = useAuthStore(s => s.user?.role)
  const isTop = role === 'admin' || role === 'founder'
  const [sound, setSound] = useState(directSoundEnabled())
  const [showConnection, setShowConnection] = useState(false)

  const { data: status } = useQuery({ queryKey: ['direct', 'status'], queryFn: directApi.status, refetchInterval: 120_000 })
  const connected = status?.connected ?? true

  const go = (next: { c?: string | null; tab?: Tab }) => {
    const p = new URLSearchParams(params)
    if (next.tab !== undefined) { if (next.tab === 'speed') p.set('tab', 'speed'); else p.delete('tab') }
    if (next.c !== undefined) { if (next.c) p.set('c', next.c); else p.delete('c') }
    setParams(p, { replace: next.c === undefined })
  }

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    setDirectSound(next)
    if (next) playDirectChime()
  }

  return (
    <div className="flex h-[calc(100dvh-56px-7rem)] min-h-[480px] flex-col gap-3 lg:h-[calc(100dvh-56px-3rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Директ</h1>
          <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
            {status?.account ? <>Instagram <b className="font-medium text-surface-700 dark:text-surface-200">@{status.account}</b> · общий чат команды продаж</> : 'Переписка Instagram в CRM'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-surface-200 dark:border-surface-700" role="tablist">
            {([['chats', 'Чаты'], ['speed', 'Скорость ответа']] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => go({ tab: key })}
                className={clsx('px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === key ? 'bg-primary-600 text-white' : 'bg-surface-50 text-surface-600 hover:bg-surface-100 dark:bg-surface-800 dark:text-surface-300')}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={toggleSound} className="btn-ghost !p-2" aria-pressed={sound}
            title={sound ? 'Звук новых сообщений включён' : 'Звук новых сообщений выключен'} aria-label="Звук новых сообщений">
            {sound ? <Bell size={18} /> : <BellOff size={18} />}
          </button>
          {isTop && status && (
            <button type="button" onClick={() => setShowConnection(v => !v)} className={clsx('btn-ghost !p-2', showConnection && 'bg-surface-100 dark:bg-surface-700')}
              aria-pressed={showConnection} title="Подключение Instagram" aria-label="Подключение Instagram">
              <Settings2 size={18} />
            </button>
          )}
        </div>
      </div>

      {status?.tokenInvalid && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          Instagram не принимает ключ доступа — сообщения из CRM не уходят. {isTop ? 'Сгенерируйте новый маркер в кабинете Meta и замените INSTAGRAM_ACCESS_TOKEN в Railway.' : 'Сообщите администратору.'}
        </div>
      )}
      {status && !status.connected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          Instagram ещё не подключён к CRM. {isTop ? 'Нажмите на шестерёнку справа — там видно, чего не хватает.' : 'Как только администратор его подключит, сюда начнут приходить сообщения клиентов.'}
        </div>
      )}
      {isTop && status && status.connected && status.storagePersistent === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          Файлы переписки хранятся временно и пропадут при следующей выкладке — подключите том Railway на /app/uploads.
        </div>
      )}
      {isTop && showConnection && status && <ConnectionPanel status={status} />}

      {tab === 'speed' ? (
        <div className="min-h-0 flex-1 overflow-y-auto"><SpeedView /></div>
      ) : (
        <div className="card grid min-h-0 flex-1 overflow-hidden p-0 lg:grid-cols-[340px_1fr]">
          <div className={clsx('min-h-0 border-surface-200 dark:border-surface-700 lg:border-r', selected ? 'hidden lg:block' : 'block')}>
            <ConversationList selectedId={selected} onSelect={id => go({ c: id })} />
          </div>
          <div className={clsx('min-h-0', selected ? 'block' : 'hidden lg:block')}>
            {selected ? (
              <ChatPane key={selected} id={selected} connected={connected} onBack={() => go({ c: null })} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-surface-500">
                <MessageCircle size={32} className="text-surface-300" />
                Выберите чат слева
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
