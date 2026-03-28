import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '@/lib/api'

interface User {
  id: string; name: string; email: string;
  role: 'admin' | 'employee';
  avatar?: string; isActive: boolean;
}

interface AuthState {
  token: string | null; user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; position?: string; phone?: string; telegram?: string; instagram?: string }) => Promise<void>;
  logout: () => Promise<void>; fetchMe: () => Promise<void>; updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null, user: null,
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
        try { const { data } = await api.get('/auth/me'); set({ user: data }) }
        catch { get().logout() }
      },
      updateUser: (updates) => { set(s => ({ user: s.user ? { ...s.user, ...updates } : null })) },
    }),
    { name: 'auth-storage', partialize: s => ({ token: s.token, user: s.user }) }
  )
)
