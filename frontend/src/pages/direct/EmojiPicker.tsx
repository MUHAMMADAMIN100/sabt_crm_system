import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

/** Эмодзи для переписки с клиентами — без тяжёлой библиотеки. Недавние
 *  запоминаются в браузере. */
const GROUPS: { key: string; title: string; icon: string; list: string[] }[] = [
  { key: 'smile', title: 'Смайлы', icon: '😊', list: '😊 😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 🤗 🤔 🤭 😌 😇 🙃 😏 😐 😶 🙄 😬 😴 😮 😯 😲 😳 🥺 😢 😭 😤 😡 🤯 😱 🤒 🤝'.split(' ') },
  { key: 'hands', title: 'Жесты', icon: '👍', list: '👍 👎 👌 ✌️ 🤞 🤟 👋 🙌 👏 🙏 💪 ☝️ 👉 👈 👆 👇 ✋ 🤙 ✍️ 🫶'.split(' ') },
  { key: 'hearts', title: 'Сердца', icon: '❤️', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💕 💞 💯 ✨ 🔥 ⭐ 🌟 🎉 🎊 🎁 🌹 💐'.split(' ') },
  { key: 'work', title: 'Работа', icon: '💼', list: '✅ ☑️ ❌ ❗ ❓ ⚠️ 📌 📍 📞 📱 💻 🖥️ 📷 🎥 🎬 📊 📈 💼 📝 📄 📎 🗓️ ⏰ ⌛ 💰 💵 💳 🏷️ 🛒 🚀 🎯 💡 🔔 📢 🤝'.split(' ') },
  { key: 'misc', title: 'Разное', icon: '☀️', list: '☀️ 🌙 ☕ 🍰 🎂 🍕 🌍 🏠 🚗 ✈️ 🇹🇯 🇷🇺 🇺🇿 🇺🇸'.split(' ') },
]

const RECENT_KEY = 'direct-emoji-recent'

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(x => typeof x === 'string').slice(0, 16) : []
  } catch { return [] }
}

export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [group, setGroup] = useState(recent.length ? 'recent' : 'smile')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Кнопка, которая открывает панель, закрывает её сама — иначе панель
      // закрылась бы здесь и тут же открылась бы её щелчком снова.
      if ((e.target as Element | null)?.closest?.('[data-emoji-toggle]')) return
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    // На следующем кадре: иначе тот же клик, что открыл панель, сразу её закроет.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey, true)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const pick = (emoji: string) => {
    const next = [emoji, ...recent.filter(e => e !== emoji)].slice(0, 16)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* не страшно */ }
    onPick(emoji)
  }

  const tabs = [...(recent.length ? [{ key: 'recent', title: 'Недавние', icon: '🕘', list: recent }] : []), ...GROUPS]
  const current = tabs.find(t => t.key === group) ?? tabs[0]

  return (
    <div ref={box} className="absolute bottom-full left-0 z-30 mb-2 w-[min(320px,calc(100vw-1.5rem))] rounded-xl border border-surface-200 bg-white p-2 shadow-modal dark:border-surface-600 dark:bg-surface-800"
      role="dialog" aria-label="Эмодзи">
      <div className="mb-1.5 flex gap-0.5 border-b border-surface-100 pb-1.5 dark:border-surface-700">
        {tabs.map(t => (
          <button key={t.key} type="button" onClick={() => setGroup(t.key)} title={t.title} aria-label={t.title}
            className={clsx('flex h-8 w-8 items-center justify-center rounded-lg text-[17px]', current.key === t.key ? 'bg-surface-100 dark:bg-surface-700' : 'hover:bg-surface-50 dark:hover:bg-surface-700/60')}>
            {t.icon}
          </button>
        ))}
      </div>
      <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
        {current.list.map(e => (
          <button key={e} type="button" onClick={() => pick(e)} className="flex h-9 items-center justify-center rounded-lg text-[20px] hover:bg-surface-100 dark:hover:bg-surface-700" aria-label={e}>
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
