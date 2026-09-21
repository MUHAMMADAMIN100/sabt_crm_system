// Интерфейс одноязычный — русский.
//
// Выбор языка убран из системы (решение владельца, 21.09.2026): английский
// и таджикский переводы отставали от русского, половина экранов всё равно
// была на русском, а переключатель только путал. Ключи и файлы переводов
// оставлены — вернуть выбор можно, не переписывая экраны.
import ru from './locales/ru.json'

export type Locale = 'ru'

export const t = (key: string): string => {
  let value: any = ru
  for (const k of key.split('.')) value = value?.[k]
  return value || key
}

export const useTranslation = () => ({
  t,
  locale: 'ru' as Locale,
  // Заглушка: язык больше не переключается. Оставлена, чтобы старый код,
  // который её зовёт, не падал.
  setLocale: (_locale?: Locale) => {},
})
