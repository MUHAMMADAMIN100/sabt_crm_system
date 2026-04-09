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
        primary: {
          50: '#f5f3ff',
          100: '#ede9ff',
          300: '#c4aff8',
          400: '#9b7aee',
          500: '#6B4FCF',
          600: '#5a3fba',
          700: '#4a33a0',
          900: '#2c1d6a',
        },
        surface: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: { xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem' },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)',
        modal: '0 20px 60px rgba(0,0,0,.15)',
        'card-hover': '0 8px 24px rgba(0,0,0,.10), 0 2px 8px rgba(0,0,0,.06)',
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
          to:   { opacity: '1', transform: 'translateY(0)' },
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
        'page-in':        'pageIn 0.4s cubic-bezier(0.22,1,0.36,1) both',
        'count-up':       'countUp 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'spin-slow':      'spinSlow 2s linear infinite',
        'bounce-soft':    'bounceSoft 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'notification':   'notificationDot 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
