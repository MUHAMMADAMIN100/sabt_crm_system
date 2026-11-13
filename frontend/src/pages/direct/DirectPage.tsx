import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, BellOff, Keyboard, MessageCircle, Settings2 } from 'lucide-react'
import { directApi } from '@/services/direct.api'
import { useAuthStore } from '@/store/auth.store'
import { directSoundEnabled, playDirectChime, setDirectSound } from '@/lib/directSound'
import ConversationList from './ConversationList'
import ChatPane from './ChatPane'
import AnalyticsView from './AnalyticsView'
import ConnectionPanel from './ConnectionPanel'
import DirectModal from './DirectModal'

type Tab = 'chats' | 'analytics'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * «Директ» — переписка Instagram аккаунта агентства (04.11.2026).
 * Видят все с доступом к Базе клиентов; клиент закрепляется за менеджером
 * продаж, который первым ответил (06.11.2026), — чужой закреплённый чат
 * менеджер только читает. Окно на весь экран (Layout снимает поля); на
 * телефоне открытый чат — без нижней панели и без шапки страницы.
 * Адрес: /direct?c=<чат>&m=<менеджер>&tab=analytics. «Аналитика» — только
 * руководству (решение владельца 06.11.2026).
 */
export default function DirectPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const selected = params.get('c')
  const focusParam = params.get('msg')
  const focusMessageId = focusParam && UUID.test(focusParam) ? focusParam : null
  const role = useAuthStore(s => s.user?.role)
  const isTop = role === 'admin' || role === 'founder'
  // tab=speed — старый адрес «Скорости ответа», теперь это «Аналитика».
  const wantsAnalytics = params.get('tab') === 'analytics' || params.get('tab') === 'speed'
  const tab: Tab = isTop && wantsAnalytics ? 'analytics' : 'chats'
  const managerParam = params.get('m')
  const assigneeId = managerParam && UUID.test(managerParam) ? managerParam : null
  const [sound, setSound] = useState(directSoundEnabled())
  const [showConnection, setShowConnection] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const order = useRef<string[]>([])
  const onOrder = useCallback((ids: string[]) => { order.current = ids }, [])

  const { data: status } = useQuery({ queryKey: ['direct', 'status'], queryFn: directApi.status, refetchInterval: 120_000 })
  const connected = status?.connected ?? true

  // Менеджер открыл старую ссылку на аналитику — убираем её из адреса, чтобы
  // и нижнее меню (Layout смотрит на tab) вело себя как в обычных чатах.
  useEffect(() => {
    if (isTop || !params.has('tab')) return
    const p = new URLSearchParams(params)
    p.delete('tab')
    setParams(p, { replace: true })
  }, [isTop, params, setParams])

  // Панель подключения закрывается кликом мимо неё.
  useEffect(() => {
    if (!showConnection) return
    const onDown = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) setShowConnection(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showConnection])

  // Чат, открытый из списка, — шаг «Назад» (08.11.2026). Переход из чата в
  // другой чат шагов не копит, а «‹» в чате снимает свой шаг, а не добавляет
  // новый: раньше на телефоне «‹», а потом системный «Назад» снова открывали чат.
  const chatPushed = useRef(false)
  const go = (next: { c?: string | null; tab?: Tab; m?: string | null; msg?: string | null }) => {
    if (next.c === null && next.tab === undefined && next.m === undefined && chatPushed.current) {
      chatPushed.current = false
      navigate(-1)
      return
    }
    const p = new URLSearchParams(params)
    // Переход к сообщению — разовый: в адресе он только до открытия.
    if (next.msg) p.set('msg', next.msg); else p.delete('msg')
    if (next.tab !== undefined) { if (next.tab === 'analytics') p.set('tab', 'analytics'); else p.delete('tab') }
    if (next.c !== undefined) { if (next.c) p.set('c', next.c); else p.delete('c') }
    if (next.m !== undefined) { if (next.m) p.set('m', next.m); else p.delete('m') }
    // Открыть чат из списка или менеджера из «Аналитики» — шаг «Назад»;
    // другой чат при открытом — замена.
    // На компьютере список и чат видны рядом — открыть чат не шаг; на
    // телефоне чат закрывает список — шаг.
    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
    const openingChat = !!next.c && !selected && phone
    const step = openingChat || next.m !== undefined
    if (openingChat && next.tab === undefined && next.m === undefined) chatPushed.current = true
    setParams(p, { replace: !step })
  }
  // Ушли со «шага чата» системным «Назад» — шаг уже снят.
  useEffect(() => { if (!selected) chatPushed.current = false }, [selected])

  // Горячие клавиши (13.11.2026): Esc — закрыть чат, Alt+↑/↓ — соседний чат,
  // Ctrl+K — поиск, «?» — подсказка. Окна и меню ловят Esc раньше и гасят его.
  const goRef = useRef(go)
  goRef.current = go
  useEffect(() => {
    if (tab !== 'chats') return
    const typing = (el: EventTarget | null) => {
      const node = el as HTMLElement | null
      return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const ids = order.current
        if (!ids.length) return
        e.preventDefault()
        const at = selected ? ids.indexOf(selected) : -1
        const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : ids.length - 1) : at + (e.key === 'ArrowDown' ? 1 : -1)
        if (next >= 0 && next < ids.length) goRef.current({ c: ids[next] })
        return
      }
      if (e.key === 'Escape' && selected && !document.querySelector('[role="dialog"],[role="menu"]')) {
        e.preventDefault()
        if (typing(e.target)) (e.target as HTMLElement).blur()
        goRef.current({ c: null })
        return
      }
      if (e.key === '?' && !typing(e.target) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowKeys(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, selected])

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
            Instagram <b className="font-medium text-surface-700 dark:text-surface-200">@{status.account}</b> · клиент закрепляется за менеджером, который ответил первым
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Чаты видят все с доступом; «Аналитику» по менеджерам — только руководство. */}
          {isTop && (
            <div className="inline-flex overflow-hidden rounded-md border border-surface-200 dark:border-surface-700" role="tablist">
              {([['chats', 'Чаты'], ['analytics', 'Аналитика']] as [Tab, string][]).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => go({ tab: key })}
                  className={clsx('px-2.5 py-2 text-xs font-medium transition-colors sm:py-1',
                    tab === key ? 'bg-primary-600 text-white' : 'bg-surface-50 text-surface-600 hover:bg-surface-100 dark:bg-surface-800 dark:text-surface-300')}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setShowKeys(true)} className="btn-ghost hidden !p-1.5 lg:inline-flex" title="Горячие клавиши (?)" aria-label="Горячие клавиши">
            <Keyboard size={17} />
          </button>
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
        {tab === 'analytics' ? (
          <div className="h-full overflow-y-auto p-4 lg:p-6">
            <AnalyticsView onOpenManager={userId => go({ tab: 'chats', m: userId, c: null })} />
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(300px,360px)_1fr]">
            {/* grid-cols-1 = minmax(0, 1fr): без него колонка на телефоне растягивалась
                по самому широкому элементу чата (375 px на экране 320). */}
            <div className={clsx('min-h-0 border-surface-200 dark:border-surface-700 lg:border-r', selected ? 'hidden lg:block' : 'block')}>
              <ConversationList selectedId={selected} onSelect={id => go({ c: id || null })}
                onOpenMessage={(c, msg) => go({ c, msg })}
                assigneeId={assigneeId} onAssigneeChange={m => go({ m })}
                searchRef={searchRef} onOrder={onOrder} />
            </div>
            <div className={clsx('min-h-0', selected ? 'block' : 'hidden lg:block')}>
              {selected ? (
                <ChatPane key={selected} id={selected} connected={connected} onBack={() => go({ c: null })}
                  focusMessageId={focusMessageId}
                  onFocusDone={() => { const p = new URLSearchParams(params); p.delete('msg'); setParams(p, { replace: true }) }} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-surface-500">
                  <MessageCircle size={32} className="text-surface-300" />
                  Выберите чат слева
                  <button type="button" onClick={() => setShowKeys(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-700 dark:hover:text-surface-200">
                    <Keyboard size={13} /> Горячие клавиши — нажмите «?»
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showKeys && <HotkeysHelp onClose={() => setShowKeys(false)} />}
    </div>
  )
}

const KEYS: [string[], string][] = [
  [['Ctrl', 'K'], 'Поиск по чатам и сообщениям'],
  [['Alt', '↓'], 'Следующий чат'],
  [['Alt', '↑'], 'Предыдущий чат'],
  [['Esc'], 'Закрыть чат, отменить ответ на сообщение'],
  [['Enter'], 'Отправить'],
  [['Shift', 'Enter'], 'Новая строка'],
  [['/'], 'Шаблоны быстрых ответов (в начале строки)'],
  [['@'], 'Упомянуть коллегу в заметке'],
  [['Ctrl', 'V'], 'Вставить скриншот или фото в ответ'],
  [['?'], 'Эта подсказка'],
]

function HotkeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <DirectModal title="Горячие клавиши Директа" onClose={onClose} width={440}>
      <ul className="divide-y divide-surface-100 px-4 py-2 dark:divide-surface-700">
        {KEYS.map(([keys, what]) => (
          <li key={what} className="flex items-center gap-3 py-2 text-[13.5px]">
            <span className="flex w-[120px] shrink-0 items-center gap-1">
              {keys.map(k => (
                <kbd key={k} className="rounded-md border border-surface-300 bg-surface-50 px-1.5 py-0.5 font-sans text-[12px] font-semibold text-surface-700 shadow-[0_1px_0_rgba(0,0,0,0.08)] dark:border-surface-600 dark:bg-surface-700 dark:text-surface-100">{k}</kbd>
              ))}
            </span>
            <span className="text-surface-700 dark:text-surface-200">{what}</span>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-4 text-[12px] text-surface-500">Ещё: двойной щелчок по сообщению клиента — ❤️; файлы можно перетащить прямо в чат; правый щелчок по чату в списке — меню.</p>
    </DirectModal>
  )
}
