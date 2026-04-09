import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '@/lib/api'

export type UserRole =
  | 'admin'
  | 'founder'
  | 'project_manager'
  | 'smm_specialist'
  | 'designer'
  | 'sales_manager'
  | 'marketer'
  | 'targetologist'
  | 'employee'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  avatar?: string
  isActive: boolean
  isSubAdmin?: boolean
}

interface AuthState {
  token: string | null
  user: User | null
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
  }) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,

      login: async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password })
        localStorage.setItem('token', data.token)
        set({ token: data.token, user: data.user })
      },

      register: async (regData) => {
        const { data } = await api.post('/auth/register', regData)
        localStorage.setItem('token', data.token)
        set({ token: data.token, user: data.user })
      },

      logout: async () => {
        try { await api.post('/auth/logout') } catch {}
        localStorage.removeItem('token')
        set({ token: null, user: null })
      },

      fetchMe: async () => {
        try {
          const { data } = await api.get('/auth/me')
          set({ user: data })
        } catch {
          // Clear locally without calling API logout to avoid infinite recursion
          localStorage.removeItem('token')
          set({ token: null, user: null })
        }
      },

      updateUser: (updates) => {
        set(s => ({ user: s.user ? { ...s.user, ...updates } : null }))
      },
    }),
    { name: 'auth-storage', partialize: s => ({ token: s.token, user: s.user }) }
  )
)

// ── Role helper hooks ─────────────────────────────────────────────────────────
export function useRole() {
  return useAuthStore(s => s.user?.role)
}

export function useIsAdmin() {
  return useAuthStore(s => s.user?.role === 'admin')
}

export function useIsFounder() {
  return useAuthStore(s => ['admin', 'founder'].includes(s.user?.role || ''))
}

export function useIsPM() {
  return useAuthStore(s => ['admin', 'founder', 'project_manager'].includes(s.user?.role || ''))
}

export function useIsWorker() {
  return useAuthStore(s => ['smm_specialist', 'designer', 'marketer', 'targetologist', 'sales_manager', 'employee'].includes(s.user?.role || ''))
}

export function useCanManageTasks() {
  return useAuthStore(s => ['admin', 'founder', 'project_manager'].includes(s.user?.role || ''))
}
