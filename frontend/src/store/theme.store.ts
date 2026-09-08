import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

// Тёмная тема ЗАФИКСИРОВАНА на всю компанию (по решению основателя): режим
// день/ночь больше не выбирается — всегда тёмная. setTheme/toggleTheme оставлены
// как no-op (совместимость с местами, где их вызывают), но всегда держат 'dark'.
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: () => {
        set({ theme: 'dark' })
        document.documentElement.classList.add('dark')
      },
      toggleTheme: () => {
        set({ theme: 'dark' })
        document.documentElement.classList.add('dark')
      },
    }),
    {
      name: 'erp-theme',
      onRehydrateStorage: () => (state) => {
        // Игнорируем сохранённый выбор — всегда тёмная.
        if (state) state.theme = 'dark'
        document.documentElement.classList.add('dark')
      },
    }
  )
)

// Принудительно тёмная даже если в localStorage осталось 'light' (после гидратации).
useThemeStore.setState({ theme: 'dark' })
document.documentElement.classList.add('dark')
