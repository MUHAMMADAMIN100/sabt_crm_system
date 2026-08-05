/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      'xs': '480px',
      'sm': '600px',
      'md': '768px',
      'tablet': '601px',
      'lg': '993px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Primary — строгий ч/б монохром через CSS-переменные (см.
        // index.css :root / .dark). В светлой теме акцент — почти чёрный,
        // в тёмной — серый, чтобы text-primary-* без dark:-вариантов
        // оставался читаемым. Все классы primary-* по всему приложению
        // подхватывают значения автоматически — JSX менять не нужно.
        primary: {
          50:  'rgb(var(--prim-50) / <alpha-value>)',
          100: 'rgb(var(--prim-100) / <alpha-value>)',
          300: 'rgb(var(--prim-300) / <alpha-value>)',
          400: 'rgb(var(--prim-400) / <alpha-value>)',
          500: 'rgb(var(--prim-500) / <alpha-value>)',
          600: 'rgb(var(--prim-600) / <alpha-value>)',
          700: 'rgb(var(--prim-700) / <alpha-value>)',
          900: 'rgb(var(--prim-900) / <alpha-value>)',
        },
        // surface — нейтральный масштаб через CSS-переменные (index.css
        // :root). Персональная тема (lib/theme.ts) интерполирует его
        // между Background и Text, поэтому ВЕСЬ интерфейс перекрашивается.
        surface: {
          50:  'rgb(var(--surf-50) / <alpha-value>)',
          100: 'rgb(var(--surf-100) / <alpha-value>)',
          200: 'rgb(var(--surf-200) / <alpha-value>)',
          300: 'rgb(var(--surf-300) / <alpha-value>)',
          400: 'rgb(var(--surf-400) / <alpha-value>)',
          500: 'rgb(var(--surf-500) / <alpha-value>)',
          600: 'rgb(var(--surf-600) / <alpha-value>)',
          700: 'rgb(var(--surf-700) / <alpha-value>)',
          800: 'rgb(var(--surf-800) / <alpha-value>)',
          900: 'rgb(var(--surf-900) / <alpha-value>)',
          950: 'rgb(var(--surf-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      /* Радиус переопределён ЦЕЛИКОМ, а не расширен. В интерфейсе больше
         шестисот мест с rounded-*; менять их поштучно — недели работы и
         гарантированные пропуски. Здесь одна правка задаёт форму всей
         системы: строгие 2–4 px вместо шаблонных 12–16.
         full не трогаем — это аватары, точки статусов и переключатели,
         они должны оставаться круглыми. */
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
        '2xl': '4px',
        '3xl': '4px',
        full: '9999px',
      },
      /* Тени убраны у плоских элементов: в деловом софте глубину даёт
         граница, а не размытое пятно. Оставлены только для слоёв, которые
         физически висят над страницей, — иначе выпадающие списки и модалки
         сольются с фоном. */
      boxShadow: {
        none: 'none',
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        card: 'none',
        'card-hover': 'none',
        lg: '0 4px 16px rgba(15, 15, 18, .10)',
        xl: '0 8px 24px rgba(15, 15, 18, .12)',
        '2xl': '0 12px 32px rgba(15, 15, 18, .14)',
        modal: '0 12px 40px rgba(15, 15, 18, .18)',
        inner: 'inset 0 1px 2px rgba(15, 15, 18, .06)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeDown: {
          from: { opacity: '0', transform: 'translateY(-16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.94) translateY(10px)' },
          to:   { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        scaleOut: {
          from: { opacity: '1', transform: 'scale(1) translateY(0)' },
          to:   { opacity: '0', transform: 'scale(0.94) translateY(10px)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-20px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(20px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        bounceDot: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.5' },
          '40%':           { transform: 'translateY(-10px)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.7', transform: 'scale(0.97)' },
        },
        backdropIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        backdropOut: {
          from: { opacity: '1' },
          to:   { opacity: '0' },
        },
        pageIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          // none, а не translateY(0): fill both держит последний кадр, а любой
          // transform ломает fixed-позиционирование модалок внутри страницы.
          to:   { opacity: '1', transform: 'none' },
        },
        countUp: {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.9)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        spinSlow: {
          to: { transform: 'rotate(360deg)' },
        },
        bounceSoft: {
          '0%':   { opacity: '0', transform: 'scale(0.7)' },
          '60%':  { transform: 'scale(1.1)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        ripple: {
          from: { transform: 'scale(0)', opacity: '0.4' },
          to:   { transform: 'scale(4)', opacity: '0' },
        },
        notificationDot: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.3)' },
        },
      },
      animation: {
        'fade-in':        'fadeIn 0.3s cubic-bezier(0.22,1,0.36,1) both',
        'fade-up':        'fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both',
        'fade-down':      'fadeDown 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in':       'scaleIn 0.28s cubic-bezier(0.22,1,0.36,1) both',
        'scale-out':      'scaleOut 0.2s ease-in both',
        'slide-in-left':  'slideInLeft 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in-right': 'slideInRight 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'shimmer':        'shimmer 1.8s ease-in-out infinite',
        'bounce-dot':     'bounceDot 1.2s ease-in-out infinite',
        'pulse-soft':     'pulseSoft 2s ease-in-out infinite',
        'backdrop-in':    'backdropIn 0.2s ease both',
        'backdrop-out':   'backdropOut 0.18s ease both',
        // backwards, а не both: висящая fill-анимация transform делала обёртку
        // страницы containing block'ом для fixed (модалки съезжали от центра).
        'page-in':        'pageIn 0.4s cubic-bezier(0.22,1,0.36,1) backwards',
        'count-up':       'countUp 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'spin-slow':      'spinSlow 2s linear infinite',
        'bounce-soft':    'bounceSoft 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'notification':   'notificationDot 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
