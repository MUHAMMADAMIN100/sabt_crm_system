import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

/**
 * Анимированный поздравительный модал когда менеджер закрывает KPI-метрику.
 * Центрируется на экране через portal, scale+fade анимация, конфетти
 * из эмодзи по краям, авто-закрытие через 5 сек или по клику на фон.
 *
 * Триггерится из SalesDashboard когда `done` переходит false→true для
 * одной из метрик. Антиспам — на стороне родителя (useRef<Set>).
 */

interface KpiCelebrationProps {
  /** Открыто или нет. Закрывается через onClose (родитель ставит state в null). */
  open: boolean
  /** Имя сотрудника — кладётся в заголовок. */
  name: string
  /** Ключ метрики (sales_*) — определяет конкретный текст похвалы и эмодзи. */
  metricKey: string | null
  /** Колбэк закрытия — родитель сбрасывает state. */
  onClose: () => void
}

/** Готовые похвалы для каждой sales-метрики + специальная для overall=100%. */
const PRAISES: Record<string, { icon: string; title: string; subtitle: string; accent: string }> = {
  sales_funnel_progress: {
    icon: '🚀',
    title: 'Воронка в огне!',
    subtitle: 'Ты сделал все продвижения по воронке за сегодня. Так держать!',
    accent: 'from-indigo-500 to-violet-600',
  },
  funnel_progress: {
    icon: '🚀',
    title: 'Воронка в огне!',
    subtitle: 'Ты сделал все продвижения по воронке за сегодня. Так держать!',
    accent: 'from-indigo-500 to-violet-600',
  },
  sales_new_companies: {
    icon: '🌟',
    title: 'Ты — машина!',
    subtitle: 'Все новые компании добавлены. База растёт благодаря тебе.',
    accent: 'from-amber-400 to-orange-500',
  },
  new_companies: {
    icon: '🌟',
    title: 'Ты — машина!',
    subtitle: 'Все новые компании добавлены. База растёт благодаря тебе.',
    accent: 'from-amber-400 to-orange-500',
  },
  sales_cold_calls: {
    icon: '📞',
    title: 'Король холодных звонков!',
    subtitle: 'План по звонкам закрыт. Каждый звонок — шаг к новой сделке.',
    accent: 'from-sky-500 to-blue-600',
  },
  cold_calls: {
    icon: '📞',
    title: 'Король холодных звонков!',
    subtitle: 'План по звонкам закрыт. Каждый звонок — шаг к новой сделке.',
    accent: 'from-sky-500 to-blue-600',
  },
  sales_personal_emails: {
    icon: '💌',
    title: 'Мастер переписки!',
    subtitle: 'Все письма отправлены. Каждое — на вес золота.',
    accent: 'from-pink-500 to-rose-600',
  },
  personal_emails: {
    icon: '💌',
    title: 'Мастер переписки!',
    subtitle: 'Все письма отправлены. Каждое — на вес золота.',
    accent: 'from-pink-500 to-rose-600',
  },
  sales_meetings: {
    icon: '🤝',
    title: 'Встречи закрыты!',
    subtitle: 'Сделки уже совсем рядом. Так держать!',
    accent: 'from-emerald-500 to-green-600',
  },
  meetings: {
    icon: '🤝',
    title: 'Встречи закрыты!',
    subtitle: 'Сделки уже совсем рядом. Так держать!',
    accent: 'from-emerald-500 to-green-600',
  },
  __all__: {
    icon: '🏆',
    title: 'Сегодня ты — №1!',
    subtitle: 'ВСЕ KPI закрыты на 100%. Это уровень чемпиона!',
    accent: 'from-yellow-400 via-amber-500 to-orange-500',
  },
}

/** 24 эмодзи-конфетти, разлетающиеся от центра по случайным траекториям. */
const CONFETTI_EMOJI = ['🎉', '🎊', '⭐', '✨', '💥', '🔥', '💪', '👑', '🏆', '🚀', '💎', '⚡']
const CONFETTI_COUNT = 24

export default function KpiCelebration({ open, name, metricKey, onClose }: KpiCelebrationProps) {
  // Автозакрытие через 5 секунд
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(onClose, 5000)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Случайные траектории для конфетти — генерируются один раз при открытии.
  const confetti = useMemo(() => {
    if (!open) return []
    return Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
      // Псевдослучайные значения с детерминированным сидом (i) — чтобы каждый
      // рендер не плодил новых стилей. Math.random нельзя — нет stable.
      const seed = (i * 9301 + 49297) % 233280
      const rand = (k: number) => ((seed * (k + 1)) % 233280) / 233280
      const angle = rand(1) * 360
      const distance = 200 + rand(2) * 250
      const dx = Math.cos((angle * Math.PI) / 180) * distance
      const dy = Math.sin((angle * Math.PI) / 180) * distance
      const delay = rand(3) * 0.3
      const duration = 1.2 + rand(4) * 0.8
      const rotate = (rand(5) - 0.5) * 720
      const emoji = CONFETTI_EMOJI[Math.floor(rand(6) * CONFETTI_EMOJI.length)]
      return { i, dx, dy, delay, duration, rotate, emoji }
    })
  }, [open, metricKey])

  if (!open || !metricKey) return null
  const praise = PRAISES[metricKey] || PRAISES.__all__

  return createPortal(
    <>
      <style>{`
        @keyframes kpiCelebrationFadeIn {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes kpiCelebrationPop {
          0%   { transform: scale(0.3) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        @keyframes kpiCelebrationIcon {
          0%   { transform: scale(0) rotate(-180deg); }
          50%  { transform: scale(1.3) rotate(20deg); }
          100% { transform: scale(1) rotate(0); }
        }
        @keyframes kpiCelebrationConfetti {
          0%   { transform: translate(0, 0) rotate(0); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes kpiCelebrationShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      {/* Overlay — кликабельно для закрытия */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[10000] bg-slate-900/40 backdrop-blur-md flex items-center justify-center px-4"
        style={{ animation: 'kpiCelebrationFadeIn 0.25s ease-out' }}
      >
        {/* Центральная карточка */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative"
          style={{ animation: 'kpiCelebrationPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        >
          {/* Конфетти разлетается от центра */}
          {confetti.map((c) => (
            <span
              key={c.i}
              className="absolute left-1/2 top-1/2 text-3xl pointer-events-none select-none"
              style={{
                ['--dx' as any]: `${c.dx}px`,
                ['--dy' as any]: `${c.dy}px`,
                ['--rot' as any]: `${c.rotate}deg`,
                animation: `kpiCelebrationConfetti ${c.duration}s ease-out ${c.delay}s forwards`,
              }}
            >
              {c.emoji}
            </span>
          ))}

          {/* Карточка */}
          <div
            className={clsx(
              'relative w-[min(92vw,460px)] rounded-3xl p-8 text-center',
              'bg-white dark:bg-surface-900',
              'shadow-[0_30px_80px_-20px_rgba(15,23,42,0.5)]',
              'border border-white/40 dark:border-white/10',
              'overflow-hidden',
            )}
          >
            {/* Градиент-акцент сверху */}
            <div className={clsx('absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r', praise.accent)} />

            {/* Иконка */}
            <div
              className={clsx(
                'mx-auto mb-4 w-24 h-24 rounded-full flex items-center justify-center text-6xl',
                'bg-gradient-to-br shadow-lg',
                praise.accent,
              )}
              style={{ animation: 'kpiCelebrationIcon 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}
            >
              <span className="drop-shadow-md">{praise.icon}</span>
            </div>

            {/* Имя с shimmer-эффектом */}
            <p
              className="text-sm uppercase tracking-widest text-surface-400 mb-1 font-semibold"
            >
              Поздравляем
            </p>
            <h2
              className={clsx(
                'text-3xl font-extrabold mb-3 bg-clip-text text-transparent bg-gradient-to-r',
                praise.accent,
              )}
              style={{
                backgroundSize: '200% 100%',
                animation: 'kpiCelebrationShimmer 2.5s linear infinite',
              }}
            >
              {name || 'Сотрудник'}
            </h2>

            {/* Заголовок похвалы */}
            <h3 className="text-2xl font-bold text-surface-900 dark:text-surface-50 mb-2 leading-snug">
              {praise.title}
            </h3>

            {/* Подзаголовок */}
            <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
              {praise.subtitle}
            </p>

            {/* Кнопка закрытия */}
            <button
              onClick={onClose}
              className={clsx(
                'mt-6 inline-flex items-center justify-center px-6 py-2.5 rounded-xl',
                'bg-gradient-to-r text-white font-semibold text-sm',
                'shadow-md hover:shadow-lg transition-shadow',
                praise.accent,
              )}
            >
              Спасибо! 🙌
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
