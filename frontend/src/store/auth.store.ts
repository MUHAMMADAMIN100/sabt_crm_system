import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '@/lib/api'

export type UserRole =
  | 'admin'
  | 'founder'
  | 'co_founder'
  | 'smm_director'
  | 'project_manager'
  | 'head_smm'
  | 'smm_specialist'
  | 'designer'
  | 'sales_manager_smm'
  | 'sales_manager_dev'
  | 'marketer'
  | 'targetologist'
  | 'developer'
  | 'employee'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  avatar?: string
  isActive: boolean
  isSubAdmin?: boolean
  position?: string | null
  department?: string | null
  isBlocked?: boolean
  blockedAt?: string | null
  blockedByName?: string | null
  blockedByRole?: string | null
  blockReason?: string | null
}

interface AuthState {
  /** true когда сервер вернул валидный /auth/me — единственный показатель,
   *  что пользователь авторизован. JWT теперь живёт в httpOnly cookie и
   *  фронт его не видит вообще. */
  authenticated: boolean
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: {
    name: string
    email: string
    password: string
    role?: string
    position?: string
    phone?: string
    telegram?: string
    instagram?: string
    birthDate?: string
  }) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  updateUser: (user: Partial<User>) => void
}

/**
 * Security note:
 *  - JWT хранится только в httpOnly cookie (ставится бэком на login/register,
 *    чистится на logout). Из JavaScript прочитать нельзя.
 *  - Никаких user / role / token в localStorage. Подмена user.role через
 *    DevTools больше ничего не даёт — фронт каждый раз тянет /auth/me
 *    при старте и берёт роль оттуда.
 *  - В localStorage сохраняем ТОЛЬКО флаг authenticated, чтобы при
 *    F5 не мигал экран логина пока идёт /auth/me. Даже если кто-то выставит
 *    его в true — реальный fetch свалится 401 и состояние сбросится.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      authenticated: false,
      user: null,
      loading: false,

      login: async (email, password) => {
        // Тело ответа использовать не обязательно — backend выставит
        // httpOnly cookie. Дальше зовём /auth/me чтобы получить актуальный
        // user-объект (без необходимости доверять telу ответа).
        await api.post('/auth/login', { email, password })
        set({ authenticated: true })
        await get().fetchMe()
      },

      register: async (regData) => {
        await api.post('/auth/register', regData)
        set({ authenticated: true })
        await get().fetchMe()
      },

      logout: async () => {
        try { await api.post('/auth/logout') } catch {}
        // Сносим всё локальное — даже если cookie не очистилась (другой домен,
        // ошибка сети), пользователь должен видеть экран логина.
        try { localStorage.removeItem('auth-storage') } catch {}
        try { localStorage.removeItem('token') } catch {} // legacy ключ
        set({ authenticated: false, user: null })
      },

      fetchMe: async () => {
        set({ loading: true })
        try {
          const { data } = await api.get('/auth/me')
          const oldRole = get().user?.role
          set({ user: data, authenticated: true, loading: false })
          // Если роль реально сменилась (промоут / демоут / blockUser) —
          // полный reload, чтобы все React Query кеши/sidebar/routes сбросились.
          if (oldRole && data.role && oldRole !== data.role) {
            window.location.reload()
          }
        } catch {
          // 401 = cookie протухла или подделана. Чистим всё.
          try { localStorage.removeItem('auth-storage') } catch {}
          try { localStorage.removeItem('token') } catch {}
          set({ authenticated: false, user: null, loading: false })
        }
      },

      updateUser: (updates) => {
        set(s => ({ user: s.user ? { ...s.user, ...updates } : null }))
      },
    }),
    {
      name: 'auth-storage',
      // ВАЖНО: НЕ персистим user и token. Сохраняем только флаг — это
      // подсказка для splash-загрузки, не доверенное значение.
      partialize: (s) => ({ authenticated: s.authenticated }),
    },
  ),
)

// ── Role helper hooks ─────────────────────────────────────────────────────────
export function useRole() {
  return useAuthStore(s => s.user?.role)
}

export function useIsAdmin() {
  return useAuthStore(s => s.user?.role === 'admin')
}

export function useIsFounder() {
  return useAuthStore(s => ['admin', 'founder', 'co_founder'].includes(s.user?.role || ''))
}

export function useIsPM() {
  return useAuthStore(s => ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(s.user?.role || ''))
}

export function useIsWorker() {
  return useAuthStore(s => ['smm_specialist', 'designer', 'marketer', 'targetologist', 'sales_manager_smm', 'sales_manager_dev', 'developer', 'employee'].includes(s.user?.role || ''))
}

export function useCanManageTasks() {
  return useAuthStore(s => ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm'].includes(s.user?.role || ''))
}
