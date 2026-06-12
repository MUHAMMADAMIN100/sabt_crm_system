import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api, { markJustAuthed, isJustAuthed, tokenStore } from '@/lib/api'
import { syncAccentFromServer, resetAccent } from '@/lib/theme'

export type UserRole =
  | 'admin'
  | 'founder'
  | 'co_founder'
  | 'smm_director'
  | 'video_director'
  | 'smm_specialist'
  | 'designer'
  | 'sales_manager_smm'
  | 'sales_manager_dev'
  | 'developer'
  | 'videographer'
  | 'video_editor'
  | 'organizer'
  | 'storymaker'
  | 'employee'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  /** Вторая (дополнительная) роль — права = объединение обеих. */
  secondaryRole?: UserRole | null
  avatar?: string
  isActive: boolean
  isSubAdmin?: boolean
  /** Сторисмейкер — видит истории всех SMM-проектов, а не только своих. */
  isStoryMaker?: boolean
  position?: string | null
  department?: string | null
  isBlocked?: boolean
  blockedAt?: string | null
  blockedByName?: string | null
  blockedByRole?: string | null
  blockReason?: string | null
  /** Включена ли двухфакторная аутентификация. */
  twoFactorEnabled?: boolean
}

/** Специальная ошибка, которую кидает login() когда бэк ответил 2FA_REQUIRED.
 *  UI ловит её и просит ввести 6-значный код, потом повторяет login(...). */
export class TwoFactorRequiredError extends Error {
  constructor() {
    super('2FA_REQUIRED')
    this.name = 'TwoFactorRequiredError'
  }
}

interface AuthState {
  /** true когда сервер вернул валидный /auth/me — единственный показатель,
   *  что пользователь авторизован. JWT теперь живёт в httpOnly cookie и
   *  фронт его не видит вообще. */
  authenticated: boolean
  user: User | null
  loading: boolean
  login: (email: string, password: string, twoFactorCode?: string) => Promise<void>
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

      login: async (email, password, twoFactorCode) => {
        // Backend ставит httpOnly cookie + возвращает токены в теле ответа.
        // Тело сохраняем в sessionStorage как Bearer-фоллбэк — нужно для
        // Chrome/incognito, где third-party cookies блокируются. Cookie
        // и Bearer работают в параллель, backend принимает любой источник.
        let resp: any
        try {
          resp = await api.post('/auth/login', { email, password, twoFactorCode })
        } catch (e: any) {
          const msg = e?.response?.data?.message
          if (typeof msg === 'string' && msg.includes('2FA_REQUIRED')) {
            throw new TwoFactorRequiredError()
          }
          throw e
        }
        tokenStore.set(resp?.data?.token, resp?.data?.refreshToken)
        // Грейс-окно: interceptor не выкинет на /auth ближайшие 8 сек.
        markJustAuthed()
        set({ authenticated: true })
        await get().fetchMe()
      },

      register: async (regData) => {
        const resp = await api.post('/auth/register', regData)
        tokenStore.set(resp?.data?.token, resp?.data?.refreshToken)
        markJustAuthed()
        set({ authenticated: true })
        await get().fetchMe()
      },

      logout: async () => {
        try { await api.post('/auth/logout') } catch {}
        // Сносим всё локальное — даже если cookie не очистилась (другой домен,
        // ошибка сети), пользователь должен видеть экран логина.
        try { localStorage.removeItem('auth-storage') } catch {}
        try { localStorage.removeItem('token') } catch {} // legacy ключ
        tokenStore.clear()
        resetAccent()
        set({ authenticated: false, user: null })
      },

      fetchMe: async () => {
        set({ loading: true })
        try {
          const { data } = await api.get('/auth/me')
          const oldRole = get().user?.role
          set({ user: data, authenticated: true, loading: false })
          // Персональный цвет интерфейса: значение с сервера — источник
          // истины, применяется мгновенно (ездит между устройствами).
          syncAccentFromServer(data?.themeColor)
          // Если роль реально сменилась (промоут / демоут / blockUser) —
          // полный reload, чтобы все React Query кеши/sidebar/routes сбросились.
          if (oldRole && data.role && oldRole !== data.role) {
            window.location.reload()
          }
        } catch {
          // КРИТИЧНО: грейс после login. Иначе если /auth/me случайно
          // вернётся с 401 в первые секунды после входа (тайминг cookie,
          // первый запрос ещё не успел донести Set-Cookie), мы сами себя
          // выкидывали обратно на /auth. Не сбрасываем state, пытаемся ещё
          // раз через секунду — куки уже точно будут.
          if (isJustAuthed()) {
            set({ loading: false })
            setTimeout(() => {
              const st = get()
              if (st.authenticated && !st.user) {
                st.fetchMe().catch(() => {})
              }
            }, 1000)
            return
          }
          // 401 = cookie протухла или подделана. Чистим всё.
          try { localStorage.removeItem('auth-storage') } catch {}
          try { localStorage.removeItem('token') } catch {}
          tokenStore.clear()
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
  return useAuthStore(s => ['admin', 'founder', 'co_founder', 'smm_director', 'video_director'].includes(s.user?.role || ''))
}

export function useIsWorker() {
  return useAuthStore(s => ['smm_specialist', 'designer', 'video_editor', 'organizer', 'storymaker', 'sales_manager_smm', 'sales_manager_dev', 'developer', 'videographer', 'employee'].includes(s.user?.role || ''))
}

export function useCanManageTasks() {
  return useAuthStore(s => ['admin', 'founder', 'co_founder', 'smm_director', 'video_director'].includes(s.user?.role || ''))
}
