import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { BarChart3, Bell, BellOff, ChevronLeft, Keyboard, Send, Settings2 } from 'lucide-react'
import { directApi } from '@/services/direct.api'
import { useAuthStore } from '@/store/auth.store'
import { directSoundEnabled, playDirectChime, setDirectSound } from '@/lib/directSound'
import ConversationList from './ConversationList'
import ChatPane from './ChatPane'
import AnalyticsView from './AnalyticsView'
import ConnectionPanel from './ConnectionPanel'
import DirectModal from './DirectModal'
import { useKeyboardViewport } from './useKeyboardViewport'

type Tab = 'chats' | 'analytics'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * «Директ» — переписка Instagram аккаунта агентства (04.11.2026).
 * Видят все с доступом к Базе клиентов; клиент закрепляется за менеджером
 * продаж, который первым ответил (06.11.2026), — чужой закреплённый чат
 * менеджер только читает. Окно на весь экран (Layout снимает поля); на
 * телефоне открытый чат — без нижней панели и без шапки страницы.
 * Вид как в Instagram на любом экране (16.11.2026): «Директ» и кнопки — над
 * списком чатов, чат справа во всю высоту, карточка клиента — по ⓘ.
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
  useKeyboardViewport()

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

  const iconBtn = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-surface-800 hover:bg-surface-100 active:bg-surface-200 dark:text-surface-100 dark:hover:bg-surface-800 dark:active:bg-surface-700'
  const usernames = (status?.accounts ?? []).filter(a => a.username).map(a => `@${a.username}`)

  // Предупреждения — тонкими полосами, чтобы не съедать место.
  const warnings = (
    <>
      {(status?.accounts ?? []).filter(a => a.tokenInvalid).map(a => (
        <div key={a.accountId || 'primary'} className="mx-4 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
          Instagram не принимает ключ{a.username ? ` @${a.username}` : ''} — сообщения из CRM через него не уходят.{' '}
          {!isTop ? 'Сообщите администратору.' : a.primary
            ? 'Сгенерируйте новый маркер в кабинете Meta и замените INSTAGRAM_ACCESS_TOKEN в Railway.'
            : 'Сгенерируйте новый маркер в кабинете Meta и вставьте его: шестерёнка → «Добавить аккаунт».'}
        </div>
      ))}
      {status && !status.connected && (
        <div className="mx-4 mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Instagram ещё не подключён к CRM. {isTop ? 'Нажмите на шестерёнку — там видно, чего не хватает.' : 'Как только администратор его подключит, сюда начнут приходить сообщения клиентов.'}
        </div>
      )}
      {isTop && status && status.connected && status.storagePersistent === false && (
        <div className="mx-4 mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Файлы переписки хранятся временно и пропадут при следующей выкладке — подключите том Railway на /app/uploads.
        </div>
      )}
    </>
  )

  const connection = isTop && showConnection && status && (
    <div className="absolute left-2 top-full z-30 mt-1 max-h-[75vh] w-[min(600px,calc(100vw-1rem))] overflow-y-auto rounded-xl shadow-modal">
      <ConnectionPanel status={status} />
    </div>
  )

  // Шапка колонки чатов — как имя аккаунта в Instagram: крупно «Директ»,
  // под ним наши аккаунты; справа — аналитика, клавиши, звук, подключение.
  const chatsHeader = (
    <div ref={panel} className="relative">
      <div className="flex items-center gap-1 pb-2 pl-4 pr-2 pt-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-surface-900 dark:text-white">Директ</h1>
          {usernames.length > 0 && (
            <p className="truncate text-[12.5px] text-surface-500" title="Клиент закрепляется за менеджером, который ответил первым">
              Instagram {usernames.join(', ')}
            </p>
          )}
        </div>
        {isTop && (
          <button type="button" onClick={() => go({ tab: 'analytics' })} className={iconBtn} title="Аналитика по менеджерам" aria-label="Аналитика">
            <BarChart3 size={21} />
          </button>
        )}
        <button type="button" onClick={() => setShowKeys(true)} className={clsx(iconBtn, 'hidden lg:flex')} title="Горячие клавиши (?)" aria-label="Горячие клавиши">
          <Keyboard size={21} />
        </button>
        <button type="button" onClick={toggleSound} className={iconBtn} aria-pressed={sound}
          title={sound ? 'Звук новых сообщений включён' : 'Звук новых сообщений выключен'} aria-label="Звук новых сообщений">
          {sound ? <Bell size={21} /> : <BellOff size={21} />}
        </button>
        {isTop && status && (
          <button type="button" onClick={() => setShowConnection(v => !v)} className={clsx(iconBtn, showConnection && 'bg-surface-100 dark:bg-surface-800')}
            aria-pressed={showConnection} aria-expanded={showConnection} title="Подключение Instagram" aria-label="Подключение Instagram">
            <Settings2 size={21} />
          </button>
        )}
      </div>
      {connection}
      {warnings}
    </div>
  )

  if (tab === 'analytics') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white dark:bg-surface-900">
        <div ref={panel} className="relative flex items-center gap-1 border-b border-surface-200 py-1.5 pl-1 pr-2 dark:border-surface-800 sm:pl-2">
          <button type="button" onClick={() => go({ tab: 'chats' })} className={iconBtn} aria-label="К чатам" title="К чатам">
            <ChevronLeft size={26} strokeWidth={2.2} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-surface-900 dark:text-white">Аналитика Директа</h1>
          {status && (
            <button type="button" onClick={() => setShowConnection(v => !v)} className={clsx(iconBtn, showConnection && 'bg-surface-100 dark:bg-surface-800')}
              aria-pressed={showConnection} aria-expanded={showConnection} title="Подключение Instagram" aria-label="Подключение Instagram">
              <Settings2 size={21} />
            </button>
          )}
          {isTop && showConnection && status && (
            <div className="absolute right-2 top-full z-30 mt-1 max-h-[75vh] w-[min(600px,calc(100vw-1rem))] overflow-y-auto rounded-xl shadow-modal">
              <ConnectionPanel status={status} />
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <AnalyticsView onOpenManager={userId => go({ tab: 'chats', m: userId, c: null })} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-white dark:bg-surface-900 lg:grid-cols-[360px_1fr] xl:grid-cols-[400px_1fr]">
      {/* grid-cols-1 = minmax(0, 1fr): без него колонка на телефоне растягивалась
          по самому широкому элементу чата (375 px на экране 320). */}
      <div className={clsx('min-h-0 border-surface-200 dark:border-surface-800 lg:border-r', selected ? 'hidden lg:block' : 'block')}>
        <ConversationList header={chatsHeader} selectedId={selected} onSelect={id => go({ c: id || null })}
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
          // Чат не выбран — как «Ваши сообщения» в Instagram.
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <span className="mb-3 flex h-24 w-24 items-center justify-center rounded-full border-2 border-surface-900 text-surface-900 dark:border-white dark:text-white">
              <Send size={40} strokeWidth={1.6} className="-translate-x-0.5 translate-y-0.5" />
            </span>
            <p className="text-[20px] font-semibold text-surface-900 dark:text-white">Ваши сообщения</p>
            <p className="max-w-[320px] text-[14px] text-surface-500">Выберите чат слева, чтобы ответить клиенту. Сообщения из Instagram приходят сюда сразу.</p>
            <button type="button" onClick={() => setShowKeys(true)} className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-surface-400 hover:text-surface-700 dark:hover:text-surface-200">
              <Keyboard size={14} /> Горячие клавиши — нажмите «?»
            </button>
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
