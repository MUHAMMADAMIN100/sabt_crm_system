import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      setTheme: (theme) => {
        set({ theme })
        // Add transition class before switching, remove after
        document.documentElement.classList.add('theme-switching')
        document.documentElement.classList.toggle('dark', theme === 'dark')
        setTimeout(() => {
          document.documentElement.classList.remove('theme-switching')
        }, 350)
      },
      toggleTheme: () => {
        const newTheme = get().theme === 'light' ? 'dark' : 'light'
        get().setTheme(newTheme)
      },
    }),
    { 
      name: 'erp-theme',
      onRehydrateStorage: () => (state) => {
        // Apply theme on load
        if (state?.theme) {
          document.documentElement.classList.toggle('dark', state.theme === 'dark')
        }
      },
    }
  )
)
