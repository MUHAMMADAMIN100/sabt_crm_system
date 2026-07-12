import React, { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import Layout from '@/components/layout/Layout'
import { PageLoader } from '@/components/ui'
import { canAccessRoute } from '@/lib/permissions'

/** Граница ошибок для lazy-чанков. После деплоя браузер с устаревшим
 *  index.html пытается подгрузить chunk, которого уже нет, и React-роутер
 *  молча рендерит пустоту. Перехватываем ChunkLoadError и автоматически
 *  перезагружаем страницу — пользователь получает свежий index.html и
 *  правильные ссылки на чанки. */
class ChunkErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    const msg = String(error?.message || error?.name || '')
    const isChunkError = error?.name === 'ChunkLoadError'
      || /Loading chunk \S+ failed/i.test(msg)
      || /Failed to fetch dynamically imported module/i.test(msg)
      || /Importing a module script failed/i.test(msg)
    if (isChunkError && typeof window !== 'undefined') {
      // Reload один раз: при бесконечной петле sessionStorage-флаг остановит.
      if (!sessionStorage.getItem('__chunkReloaded')) {
        sessionStorage.setItem('__chunkReloaded', '1')
        window.location.reload()
      }
    }
  }
  componentDidMount() {
    // Если страница ожила после reload — снимаем флаг, чтобы не блокировать
    // следующий легитимный reload.
    sessionStorage.removeItem('__chunkReloaded')
  }
  render() {
    if (this.state.error) return <PageLoader />
    return this.props.children
  }
}

const AuthPage          = lazy(() => import('@/pages/auth/AuthPage'))
const DashboardPage     = lazy(() => import('@/pages/dashboard/DashboardPage'))
const ProjectsPage      = lazy(() => import('@/pages/projects/ProjectsPage'))
const ProjectsBoardPage = lazy(() => import('@/pages/workflow/ProjectsBoardPage'))
const ProjectStoriesPage = lazy(() => import('@/pages/stories/ProjectStoriesPage'))
const ProjectDetailPage = lazy(() => import('@/pages/projects/ProjectDetailPage'))
const EmployeesPage     = lazy(() => import('@/pages/employees/EmployeesPage'))
const EmployeeAccessPage = lazy(() => import('@/pages/access/EmployeeAccessPage'))
const EmployeeDetailPage = lazy(() => import('@/pages/employees/EmployeeDetailPage'))
const CalendarPage      = lazy(() => import('@/pages/calendar/CalendarPage'))
const ReportsPage       = lazy(() => import('@/pages/reports/ReportsPage'))
const AnalyticsPage     = lazy(() => import('@/pages/analytics/AnalyticsPage'))
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'))
const ProfilePage       = lazy(() => import('@/pages/profile/ProfilePage'))
const ArchivePage       = lazy(() => import('@/pages/archive/ArchivePage'))
const FilesPage         = lazy(() => import('@/pages/files/FilesPage'))
const AiChatPage        = lazy(() => import('@/pages/ai/AiChatPage'))
const ClientsPage       = lazy(() => import('@/pages/clients/ClientsPage'))
const OnboardingPage    = lazy(() => import('@/pages/onboarding/OnboardingPage'))
const TariffsPage       = lazy(() => import('@/pages/tariffs/TariffsPage'))
const RisksPage         = lazy(() => import('@/pages/risks/RisksPage'))
const SecurityLogPage   = lazy(() => import('@/pages/security/SecurityLogPage'))
// Fin System · WebRand — финансовый раздел (Обзор/Доход/Расход/Транзакции/Настройки)
const FinanceOverviewPage     = lazy(() => import('@/pages/finance/FinanceOverviewPage'))
const FinanceIncomePage       = lazy(() => import('@/pages/finance/FinanceIncomePage'))
const FinanceIncomeGroupPage  = lazy(() => import('@/pages/finance/FinanceIncomeGroupPage'))
const FinanceExpensePage      = lazy(() => import('@/pages/finance/FinanceExpensePage'))
const FinanceExpenseGroupPage = lazy(() => import('@/pages/finance/FinanceExpenseGroupPage'))
const FinanceTransactionsPage = lazy(() => import('@/pages/finance/FinanceTransactionsPage'))
const FinanceInventoryPage    = lazy(() => import('@/pages/finance/FinanceInventoryPage'))
const FinanceSettingsPage     = lazy(() => import('@/pages/finance/FinanceSettingsPage'))
const PublicBriefPage   = lazy(() => import('@/pages/public/PublicBriefPage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  // `authenticated` — это локальная подсказка. Реальная авторизация —
  // в httpOnly cookie на бэке. Если cookie протухла, /auth/me вернёт 401,
  // axios-interceptor выкинет на /auth.
  const authenticated = useAuthStore(s => s.authenticated)
  const user = useAuthStore(s => s.user)
  const loading = useAuthStore(s => s.loading)
  const fetchMe = useAuthStore(s => s.fetchMe)

  // Если authenticated=true но user пуст (F5 страницы или только что после
  // login) — сами тянем /auth/me. Раньше это делал Layout.useEffect, но
  // PrivateRoute блокирует рендер Layout до прихода user → был бы deadlock.
  useEffect(() => {
    if (authenticated && !user && !loading) {
      fetchMe().catch(() => {})
    }
  }, [authenticated, user, loading, fetchMe])

  if (!authenticated) return <Navigate to="/auth" replace />
  // Пока fetchMe не вернул свежего user — показываем splash, чтобы не
  // мигало «чужое» содержимое (DashboardPage с дефолтной ролью employee
  // и админскими виджетами на 1 секунду).
  if (!user) return <PageLoader />
  return <>{children}</>
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore(s => s.user?.role)
  const secondaryRole = useAuthStore(s => s.user?.secondaryRole)
  const extraPermissions = useAuthStore(s => s.user?.extraPermissions)
  const location = useLocation()
  // Strip query/hash, get pathname
  const path = location.pathname
  // Build canonical path: /projects/:id → /projects/abc treated as /projects/abc
  if (role && !canAccessRoute(role, path, secondaryRole, extraPermissions)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  const authenticated = useAuthStore(s => s.authenticated)

  return (
    <ChunkErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/auth" element={authenticated ? <Navigate to="/" replace /> : <AuthPage />} />
        {/* Публичная страница брифа — без авторизации, по токену. */}
        <Route path="/public/brief/:token" element={<PublicBriefPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<RoleGuard><ProjectsPage /></RoleGuard>} />
          <Route path="workflow-board" element={<RoleGuard><ProjectsBoardPage /></RoleGuard>} />
          <Route path="project-stories" element={<RoleGuard><ProjectStoriesPage /></RoleGuard>} />
          <Route path="projects/:id" element={<RoleGuard><ProjectDetailPage /></RoleGuard>} />
          <Route path="employees" element={<RoleGuard><EmployeesPage /></RoleGuard>} />
          <Route path="employee-access" element={<RoleGuard><EmployeeAccessPage /></RoleGuard>} />
          <Route path="employees/:id" element={<RoleGuard><EmployeeDetailPage /></RoleGuard>} />
          <Route path="calendar" element={<RoleGuard><CalendarPage /></RoleGuard>} />
          <Route path="reports" element={<RoleGuard><ReportsPage /></RoleGuard>} />
          <Route path="analytics" element={<RoleGuard><AnalyticsPage /></RoleGuard>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="archive" element={<RoleGuard><ArchivePage /></RoleGuard>} />
          <Route path="files" element={<RoleGuard><FilesPage /></RoleGuard>} />
          <Route path="ai" element={<RoleGuard><AiChatPage /></RoleGuard>} />
          <Route path="clients" element={<RoleGuard><ClientsPage /></RoleGuard>} />
          <Route path="onboarding" element={<RoleGuard><OnboardingPage /></RoleGuard>} />
          <Route path="tariffs" element={<RoleGuard><TariffsPage /></RoleGuard>} />
          <Route path="risks" element={<RoleGuard><RisksPage /></RoleGuard>} />
          <Route path="security-log" element={<RoleGuard><SecurityLogPage /></RoleGuard>} />
          <Route path="finance" element={<RoleGuard><FinanceOverviewPage /></RoleGuard>} />
          <Route path="finance/income" element={<RoleGuard><FinanceIncomePage /></RoleGuard>} />
          <Route path="finance/income/:direction" element={<RoleGuard><FinanceIncomeGroupPage /></RoleGuard>} />
          <Route path="finance/expense" element={<RoleGuard><FinanceExpensePage /></RoleGuard>} />
          <Route path="finance/expense/:kind" element={<RoleGuard><FinanceExpenseGroupPage /></RoleGuard>} />
          <Route path="finance/transactions" element={<RoleGuard><FinanceTransactionsPage /></RoleGuard>} />
          <Route path="finance/inventory" element={<RoleGuard><FinanceInventoryPage /></RoleGuard>} />
          <Route path="finance/settings" element={<RoleGuard><FinanceSettingsPage /></RoleGuard>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ChunkErrorBoundary>
  )
}
