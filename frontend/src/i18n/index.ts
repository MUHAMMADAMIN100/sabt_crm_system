// Simple i18n system
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import ru from './locales/ru.json'
import en from './locales/en.json'
import tj from './locales/tj.json'

export type Locale = 'ru' | 'en' | 'tj'

const translations = { ru, en, tj }

interface I18nStore {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useI18nStore = create<I18nStore>()(
  persist(
    (set) => ({
      locale: 'ru',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'erp-locale' }
  )
)

export const t = (key: string, locale?: Locale): string => {
  const currentLocale = locale || useI18nStore.getState().locale
  const keys = key.split('.')
  let value: any = translations[currentLocale]
  
  for (const k of keys) {
    value = value?.[k]
  }
  
  return value || key
}

export const useTranslation = () => {
  const locale = useI18nStore((s) => s.locale)
  const setLocale = useI18nStore((s) => s.setLocale)
  
  return {
    t: (key: string) => t(key, locale),
    locale,
    setLocale,
  }
}
