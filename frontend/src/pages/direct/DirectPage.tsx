import { useEffect, useRef, useState } from 'react'
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
 * Окно на весь экран (Layout снимает поля); на телефоне открытый чат — без
 * нижней панели и без шапки страницы. Адрес чата — /direct?c=<id>.
 */
export default function DirectPage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('c')
  const tab: Tab = params.get('tab') === 'speed' ? 'speed' : 'chats'
  const role = useAuthStore(s => s.user?.role)
  const isTop = role === 'admin' || role === 'founder'
  const [sound, setSound] = useState(directSoundEnabled())
  const [showConnection, setShowConnection] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  const { data: status } = useQuery({ queryKey: ['direct', 'status'], queryFn: directApi.status, refetchInterval: 120_000 })
  const connected = status?.connected ?? true

  // Панель подключения закрывается кликом мимо неё.
  useEffect(() => {
    if (!showConnection) return
    const onDown = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) setShowConnection(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showConnection])

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

  // На телефоне открытый чат занимает весь экран — шапка страницы прячется.
  const hideOnPhone = selected && tab === 'chats' ? 'hidden lg:flex' : 'flex'

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-surface-900">
      {/* Тонкая шапка: название, вкладки, звук, подключение */}
      <div ref={panel} className={clsx('relative z-20 flex-wrap items-center gap-x-2 gap-y-1 border-b border-surface-200 px-3 py-1.5 dark:border-surface-700 sm:px-4', hideOnPhone)}>
        <MessageCircle size={17} className="shrink-0 text-surface-500" aria-hidden />
        <h1 className="text-[15px] font-semibold text-surface-900 dark:text-white">Директ</h1>
        {status?.account && (
          <span className="hidden min-w-0 truncate text-xs text-surface-500 sm:inline">
            Instagram <b className="font-medium text-surface-700 dark:text-surface-200">@{status.account}</b> · общий чат команды продаж
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="inline-flex overflow-hidden rounded-md border border-surface-200 dark:border-surface-700" role="tablist">
            {([['chats', 'Чаты'], ['speed', 'Скорость ответа']] as [Tab, string][]).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => go({ tab: key })}
                className={clsx('px-2.5 py-2 text-xs font-medium transition-colors sm:py-1',
                  tab === key ? 'bg-primary-600 text-white' : 'bg-surface-50 text-surface-600 hover:bg-surface-100 dark:bg-surface-800 dark:text-surface-300')}>
                {/* На узком телефоне «Скорость ответа» не влезала рядом с кнопками — короче. */}
                {key === 'speed' ? <>Скорость<span className="hidden min-[400px]:inline"> ответа</span></> : label}
              </button>
            ))}
          </div>
          <button type="button" onClick={toggleSound} className="btn-ghost !p-2 sm:!p-1.5" aria-pressed={sound}
            title={sound ? 'Звук новых сообщений включён' : 'Звук новых сообщений выключен'} aria-label="Звук новых сообщений">
            {sound ? <Bell size={17} /> : <BellOff size={17} />}
          </button>
          {isTop && status && (
            <button type="button" onClick={() => setShowConnection(v => !v)} className={clsx('btn-ghost !p-2 sm:!p-1.5', showConnection && 'bg-surface-100 dark:bg-surface-700')}
              aria-pressed={showConnection} aria-expanded={showConnection} title="Подключение Instagram" aria-label="Подключение Instagram">
              <Settings2 size={17} />
            </button>
          )}
        </div>
        {isTop && showConnection && status && (
          <div className="absolute right-2 top-full mt-1 max-h-[75vh] w-[min(600px,calc(100vw-1rem))] overflow-y-auto rounded-xl shadow-modal">
            <ConnectionPanel status={status} />
          </div>
        )}
      </div>

      {/* Предупреждения — тонкими полосами, чтобы не съедать место чата */}
      <div className={clsx('flex-col', hideOnPhone)}>
        {status?.tokenInvalid && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            Instagram не принимает ключ доступа — сообщения из CRM не уходят. {isTop ? 'Сгенерируйте новый маркер в кабинете Meta и замените INSTAGRAM_ACCESS_TOKEN в Railway.' : 'Сообщите администратору.'}
          </div>
        )}
        {status && !status.connected && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
            Instagram ещё не подключён к CRM. {isTop ? 'Нажмите на шестерёнку справа — там видно, чего не хватает.' : 'Как только администратор его подключит, сюда начнут приходить сообщения клиентов.'}
          </div>
        )}
        {isTop && status && status.connected && status.storagePersistent === false && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
            Файлы переписки хранятся временно и пропадут при следующей выкладке — подключите том Railway на /app/uploads.
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'speed' ? (
          <div className="h-full overflow-y-auto p-4 lg:p-6"><SpeedView /></div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(300px,360px)_1fr]">
            {/* grid-cols-1 = minmax(0, 1fr): без него колонка на телефоне растягивалась
                по самому широкому элементу чата (375 px на экране 320). */}
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
    </div>
  )
}
