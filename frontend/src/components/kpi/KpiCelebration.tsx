import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

/**
 * Полноэкранное анимированное поздравление с фейерверком.
 * Триггерится из KpiCelebrationWatcher / SalesDashboard когда метрика
 * KPI впервые за день достигает цели.
 */

interface KpiCelebrationProps {
  open: boolean
  name: string
  metricKey: string | null
  onClose: () => void
}

/** Визуальный стиль на каждую метрику (иконка/градиент/свечение). */
const PRAISE_STYLE: Record<string, { icon: string; accent: string; ring: string }> = {
  funnel_progress: { icon: '🚀', accent: 'from-surface-400 via-surface-500 to-surface-600', ring: 'rgba(139,92,246,0.6)' },
  new_companies:   { icon: '🌟', accent: 'from-surface-300 via-surface-400 to-surface-500', ring: 'rgba(251,146,60,0.6)' },
  cold_calls:      { icon: '📞', accent: 'from-surface-300 via-surface-500 to-surface-600', ring: 'rgba(59,130,246,0.6)' },
  personal_emails: { icon: '💌', accent: 'from-surface-400 via-surface-500 to-surface-600', ring: 'rgba(244,114,182,0.6)' },
  meetings:        { icon: '🤝', accent: 'from-green-400 via-green-500 to-surface-600',     ring: 'rgba(52,211,153,0.6)' },
  __all__:         { icon: '🏆', accent: 'from-surface-300 via-surface-400 to-surface-500', ring: 'rgba(250,204,21,0.7)' },
}

/** Пулы похвал — на каждое срабатывание выбирается случайная фраза,
 *  чтобы поздравление не приедалось и заряжало работать дальше. */
const PRAISE_TEXTS: Record<string, { title: string; subtitle: string }[]> = {
  funnel_progress: [
    { title: 'Воронка в огне! 🔥',        subtitle: 'Все продвижения по воронке закрыты. Ты двигаешь сделки как профи!' },
    { title: 'Машина продаж!',            subtitle: 'Сегодня воронка крутится только благодаря тебе. Невероятный темп!' },
    { title: 'Каждый шаг — к деньгам!',   subtitle: 'Ты протолкнул все сделки вперёд. Так и куётся результат!' },
    { title: 'Движуха на максимум!',      subtitle: 'Воронка не стоит — ты её двигатель. Завтра будет ещё круче!' },
    { title: 'Ты держишь темп чемпиона!', subtitle: 'Все продвижения сделаны. Клиенты ближе к «да», чем когда-либо.' },
    { title: 'Воронка покорена!',         subtitle: 'Ни одной застрявшей сделки. Это и есть мастерство продаж.' },
  ],
  new_companies: [
    { title: 'Ты — машина! 💪',           subtitle: 'Все новые компании в базе. Ты строишь будущее агентства!' },
    { title: 'База растёт с тобой!',      subtitle: 'Каждая новая компания — твой вклад в большие сделки. Огонь!' },
    { title: 'Охотник за клиентами!',     subtitle: 'План по новым компаниям закрыт. Ты находишь золото там, где другие проходят мимо.' },
    { title: 'Сеть расширяется!',         subtitle: 'Новые компании добавлены. Чем шире сеть — тем крупнее улов!' },
    { title: 'Ты заряжаешь воронку!',     subtitle: 'Свежие лиды в базе — это твоя будущая премия. Красавчик!' },
    { title: 'Рекорд по новым клиентам!', subtitle: 'Ты не сбавляешь обороты. Команда тобой гордится!' },
  ],
  cold_calls: [
    { title: 'Король холодных звонков! 📞', subtitle: 'План по звонкам закрыт. Каждый звонок — шаг к новой сделке.' },
    { title: 'Голос, который продаёт!',     subtitle: 'Все звонки сделаны. Ты не боишься «нет» — и именно поэтому слышишь «да».' },
    { title: 'Звонки — твоя стихия!',       subtitle: 'Холодные? Уже горячие после твоего звонка. Так держать!' },
    { title: 'Несгибаемый!',                subtitle: 'Ты прозвонил всех. Настойчивость — суперсила продажника, и она у тебя есть.' },
    { title: 'Трубка в руках мастера!',     subtitle: 'План выполнен. Каждый разговор приближает крупную сделку.' },
    { title: 'Ты пробиваешь любые двери!',  subtitle: 'Звонки закрыты. Клиенты запомнят твой голос!' },
  ],
  personal_emails: [
    { title: 'Мастер переписки! 💌',       subtitle: 'Все письма отправлены. Каждое — на вес золота.' },
    { title: 'Слово — твоё оружие!',       subtitle: 'Письма ушли клиентам. Ты умеешь зацепить с первой строки!' },
    { title: 'Пишешь — значит продаёшь!',  subtitle: 'План по письмам закрыт. Твои сообщения открывают и читают!' },
    { title: 'Виртуоз коммуникации!',      subtitle: 'Все письма отправлены. Внимание к каждому клиенту — твой стиль.' },
    { title: 'Каждое письмо в цель!',      subtitle: 'Ты на связи со всеми. Именно так строится доверие и сделки.' },
    { title: 'Связь налажена!',            subtitle: 'Письма доставлены. Клиенты чувствуют твою заботу — это бесценно.' },
  ],
  meetings: [
    { title: 'Встречи закрыты! 🤝',        subtitle: 'Сделки уже совсем рядом. Так держать!' },
    { title: 'Мастер личных встреч!',      subtitle: 'Все встречи назначены и проведены. Вживую ты неотразим!' },
    { title: 'Рукопожатие — и сделка!',    subtitle: 'План по встречам выполнен. Доверие строится глаза в глаза.' },
    { title: 'Ты закрываешь вживую!',      subtitle: 'Встречи проведены. Каждая — на шаг ближе к подписанному договору.' },
    { title: 'Переговорщик от бога!',      subtitle: 'Все встречи в кармане. Ты умеешь убеждать — и это видно!' },
    { title: 'Лицом к лицу — на победу!',  subtitle: 'Встречи закрыты. Клиенты уходят с желанием работать именно с тобой.' },
  ],
  __all__: [
    { title: 'Сегодня ты — №1! 🏆',        subtitle: 'ВСЕ KPI закрыты на 100%. Это уровень чемпиона!' },
    { title: 'Абсолютный чемпион дня!',    subtitle: 'Полный план выполнен. Ты сделал всё — и сделал блестяще!' },
    { title: 'Идеальный день! 💯',         subtitle: 'Каждая метрика на максимуме. Так выглядит лучший менеджер!' },
    { title: 'Ты сделал невозможное!',     subtitle: '100% по всем KPI. Команда равняется на тебя!' },
    { title: 'Легенда продаж!',            subtitle: 'Все цели взяты. Этот день войдёт в историю агентства!' },
    { title: 'Безупречно! 👑',             subtitle: 'Ни одного незакрытого KPI. Ты — эталон, на тебя хочется равняться!' },
  ],
}

const FIREWORK_COLORS = ['#ffffff', '#ffd166', '#ff6b6b', '#4dd4ac', '#5b8cff', '#c77dff', '#ffe066', '#ff8fab', '#7afcff', '#b9fbc0']
const FIREWORK_BURSTS = 16       // залпов салюта (волнами по всему экрану)
const SPARKS_PER_BURST = 34      // искр в каждом залпе
const CONFETTI_EMOJI = ['🎉', '🎊', '⭐', '✨', '💥', '🔥', '💪', '👑', '🏆', '🚀', '💎', '⚡', '🌟', '✊', '🙌', '🥳', '🎆', '🎇']
const CONFETTI_COUNT = 90

/** Псевдослучайный детерминированный rand по двум числам (для стабильных
 *  значений между рендерами без Math.random). */
function rand(a: number, b: number): number {
  const seed = (a * 9301 + b * 49297 + 7919) % 233280
  return seed / 233280
}

export default function KpiCelebration({ open, name, metricKey, onClose }: KpiCelebrationProps) {
  // Авто-закрытие через 7.5 сек — дать насладиться салютом
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(onClose, 7500)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Залпы фейерверка — позиции, цвета и сетка искр.
  // Стабильны между рендерами одного и того же metricKey.
  const bursts = useMemo(() => {
    if (!open || !metricKey) return []
    return Array.from({ length: FIREWORK_BURSTS }).map((_, b) => {
      // Позиция залпа: по всему экрану, разнесены по X и Y.
      const left = 6 + rand(b, 11) * 88                // 6–94% по X
      const top  = 8 + rand(b, 13) * 74                // 8–82% по Y (весь экран)
      // Волны залпов: непрерывный салют первые ~4 сек, потом по кругу.
      const delay = (b * 0.22 + rand(b, 17) * 0.3) % 4
      const color = FIREWORK_COLORS[Math.floor(rand(b, 19) * FIREWORK_COLORS.length)]
      const sparks = Array.from({ length: SPARKS_PER_BURST }).map((__, s) => {
        const angle = (360 / SPARKS_PER_BURST) * s + rand(b, s) * 10
        const distance = 180 + rand(b + 1, s + 7) * 140
        const dx = Math.cos((angle * Math.PI) / 180) * distance
        const dy = Math.sin((angle * Math.PI) / 180) * distance
        const dur = 1.0 + rand(b, s + 31) * 0.6
        return { s, dx, dy, dur, color }
      })
      return { b, left, top, delay, color, sparks }
    })
  }, [open, metricKey])

  // Эмодзи-конфетти из центра — поверх фейерверка.
  const confetti = useMemo(() => {
    if (!open) return []
    return Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
      const angle = rand(i, 3) * 360
      const distance = 200 + rand(i, 7) * 400
      const dx = Math.cos((angle * Math.PI) / 180) * distance
      const dy = Math.sin((angle * Math.PI) / 180) * distance
      const delay = rand(i, 11) * 0.5
      const duration = 1.4 + rand(i, 13) * 1.0
      const rotate = (rand(i, 17) - 0.5) * 1080
      const emoji = CONFETTI_EMOJI[Math.floor(rand(i, 23) * CONFETTI_EMOJI.length)]
      const size = 24 + rand(i, 29) * 28
      return { i, dx, dy, delay, duration, rotate, emoji, size }
    })
  }, [open, metricKey])

  // Канонический ключ (срезаем префикс sales_) → стиль + пул фраз.
  const canonKey = (metricKey || '').replace(/^sales_/, '')
  const style = PRAISE_STYLE[canonKey] || PRAISE_STYLE.__all__
  // Случайная похвала из пула — новая на каждое открытие модала.
  const variant = useMemo(() => {
    const pool = PRAISE_TEXTS[canonKey] || PRAISE_TEXTS.__all__
    return pool[Math.floor(Math.random() * pool.length)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, metricKey])

  if (!open || !metricKey) return null
  const praise = { ...style, ...variant }

  return createPortal(
    <>
      <style>{`
        @keyframes kpiFadeIn        { from { opacity: 0 } to { opacity: 1 } }
        @keyframes kpiBgShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes kpiIconPop {
          0%   { transform: scale(0) rotate(-180deg); opacity: 0; }
          55%  { transform: scale(1.25) rotate(15deg); opacity: 1; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        @keyframes kpiIconFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-12px); }
        }
        @keyframes kpiTextRise {
          0%   { opacity: 0; transform: translateY(40px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes kpiNameShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes kpiSpark {
          0%   { transform: translate(0, 0) scale(1); opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0.4); opacity: 0; }
        }
        @keyframes kpiBurstFlash {
          0%   { transform: scale(0.2); opacity: 0; }
          30%  { transform: scale(1.4); opacity: 1; }
          100% { transform: scale(0.6); opacity: 0; }
        }
        @keyframes kpiConfetti {
          0%   { transform: translate(0, 0) rotate(0); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes kpiBtnPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
          50%      { box-shadow: 0 0 0 16px rgba(255,255,255,0); }
        }
      `}</style>

      {/* Overlay на весь экран */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[10000] overflow-hidden cursor-pointer"
        style={{
          animation: 'kpiFadeIn 0.3s ease-out',
        }}
      >
        {/* Слой 1 — анимированный градиентный фон */}
        <div
          className={clsx('absolute inset-0 bg-gradient-to-br', praise.accent)}
          style={{
            backgroundSize: '300% 300%',
            animation: 'kpiBgShift 8s ease-in-out infinite',
          }}
        />
        {/* Затемнение поверх градиента */}
        <div className="absolute inset-0 bg-surface-950/55" />

        {/* Слой 2 — фейерверк (залпы искр) */}
        {bursts.map(burst => (
          <div
            key={burst.b}
            className="absolute pointer-events-none"
            style={{ left: `${burst.left}%`, top: `${burst.top}%` }}
          >
            {/* Вспышка центра залпа — крупная */}
            <span
              className="absolute -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full"
              style={{
                background: `radial-gradient(circle, ${burst.color} 0%, transparent 65%)`,
                animation: `kpiBurstFlash 0.9s ease-out ${burst.delay}s both`,
              }}
            />
            {/* Искры разлетаются радиально */}
            {burst.sparks.map(sp => (
              <span
                key={sp.s}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full"
                style={{
                  ['--dx' as any]: `${sp.dx}px`,
                  ['--dy' as any]: `${sp.dy}px`,
                  backgroundColor: sp.color,
                  boxShadow: `0 0 10px ${sp.color}, 0 0 22px ${sp.color}99`,
                  animation: `kpiSpark ${sp.dur}s ease-out ${burst.delay}s forwards`,
                }}
              />
            ))}
          </div>
        ))}

        {/* Слой 3 — эмодзи-конфетти из центра */}
        {confetti.map(c => (
          <span
            key={c.i}
            className="absolute left-1/2 top-1/2 pointer-events-none select-none"
            style={{
              ['--dx' as any]: `${c.dx}px`,
              ['--dy' as any]: `${c.dy}px`,
              ['--rot' as any]: `${c.rotate}deg`,
              fontSize: `${c.size}px`,
              animation: `kpiConfetti ${c.duration}s ease-out ${c.delay}s forwards`,
            }}
          >
            {c.emoji}
          </span>
        ))}

        {/* Слой 4 — центральный контент */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none"
        >
          {/* Огромная иконка */}
          <div
            className="pointer-events-auto"
            style={{
              fontSize: 'min(200px, 30vw)',
              filter: `drop-shadow(0 0 40px ${praise.ring}) drop-shadow(0 0 80px ${praise.ring})`,
              animation: 'kpiIconPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), kpiIconFloat 3s ease-in-out 0.8s infinite',
              lineHeight: 1,
            }}
          >
            {praise.icon}
          </div>

          {/* «ПОЗДРАВЛЯЕМ» */}
          <p
            className="text-white/70 uppercase tracking-[0.4em] font-bold mt-8 text-base sm:text-lg"
            style={{ animation: 'kpiTextRise 0.6s ease-out 0.4s both' }}
          >
            Поздравляем
          </p>

          {/* Имя сотрудника — огромное, с переливающимся градиентом */}
          <h1
            className={clsx(
              'font-black mt-2 leading-none bg-clip-text text-transparent bg-gradient-to-r',
              praise.accent,
            )}
            style={{
              fontSize: 'min(120px, 14vw)',
              backgroundSize: '300% 100%',
              animation: 'kpiTextRise 0.7s ease-out 0.5s both, kpiNameShimmer 3s linear 0.5s infinite',
              filter: `drop-shadow(0 4px 20px ${praise.ring})`,
              letterSpacing: '-0.02em',
            }}
          >
            {name || 'Сотрудник'}
          </h1>

          {/* Заголовок похвалы */}
          <h2
            className="font-extrabold text-white mt-6 leading-tight"
            style={{
              fontSize: 'min(56px, 7vw)',
              textShadow: '0 4px 20px rgba(0,0,0,0.4)',
              animation: 'kpiTextRise 0.7s ease-out 0.65s both',
            }}
          >
            {praise.title}
          </h2>

          {/* Подзаголовок */}
          <p
            className="text-white/85 mt-4 max-w-2xl leading-relaxed"
            style={{
              fontSize: 'min(22px, 3vw)',
              textShadow: '0 2px 10px rgba(0,0,0,0.3)',
              animation: 'kpiTextRise 0.7s ease-out 0.8s both',
            }}
          >
            {praise.subtitle}
          </p>

          {/* Кнопка */}
          <button
            onClick={onClose}
            className={clsx(
              'pointer-events-auto mt-10 px-10 py-4 rounded-2xl text-xl font-bold text-white',
              'bg-surface-50/15 backdrop-blur-md border-2 border-white/40',
              'hover:bg-surface-50/25 hover:scale-105 active:scale-95 transition-all',
            )}
            style={{
              animation: 'kpiTextRise 0.6s ease-out 1s both, kpiBtnPulse 2s ease-out 1.5s infinite',
            }}
          >
            Спасибо! 🙌
          </button>

          {/* Подсказка снизу */}
          <p
            className="absolute bottom-6 text-white/40 text-sm tracking-wide"
            style={{ animation: 'kpiTextRise 0.6s ease-out 1.3s both' }}
          >
            Кликни в любое место чтобы закрыть · Esc
          </p>
        </div>
      </div>
    </>,
    document.body,
  )
}
