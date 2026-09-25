import React, { lazy, Suspense, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import Layout from '@/components/layout/Layout'
import { PageLoader } from '@/components/ui'
import { canAccessRoute } from '@/lib/permissions'
import { SmmSectionContext } from '@/pages/smm/smmShared'

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
      // Перезагружаем максимум раз в 8 сек. Если СРАЗУ после reload снова та же
      // ошибка — reload не помог (устаревший/удалённый чанк), и мы НЕ зацикливаемся:
      // показываем экран с кнопкой обновления. Раньше флаг снимался в componentDidMount
      // на каждом маунте → защита не работала и получался бесконечный релоад.
      let last = 0
      try { last = Number(sessionStorage.getItem('__chunkReloadTs') || '0') } catch { /* ignore */ }
      if (Date.now() - last > 8000) {
        try { sessionStorage.setItem('__chunkReloadTs', String(Date.now())) } catch { /* ignore */ }
        window.location.reload()
      }
    }
  }
  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message || this.state.error?.name || '')
      const isChunk = this.state.error?.name === 'ChunkLoadError'
        || /Loading chunk|dynamically imported module|module script failed/i.test(msg)
      // Пока идёт авто-reload — лоадер; если reload не помог (throttle) — кнопка «Обновить».
      if (!isChunk) return <PageLoader />
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
          <p style={{ color: '#8b93a1', fontSize: 14, maxWidth: 360 }}>Не удалось загрузить обновлённую версию страницы. Обновите её.</p>
          <button
            onClick={() => { try { sessionStorage.removeItem('__chunkReloadTs') } catch { /* ignore */ }; window.location.reload() }}
            style={{ padding: '9px 18px', borderRadius: 10, background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 14, border: 0, cursor: 'pointer' }}
          >Обновить страницу</button>
        </div>
      )
    }
    return this.props.children
  }
}

const AuthPage          = lazy(() => import('@/pages/auth/AuthPage'))
const DashboardPage     = lazy(() => import('@/pages/dashboard/DashboardPage'))
const MyNotesPage       = lazy(() => import('@/pages/notes/MyNotesPage'))
// Раздел «Задачи»: исполнителю — кабинет поручений, руководителю
// направления — полный список задач его сферы (см. TasksRoute).
const TasksRoute = lazy(() => import('@/pages/tasks/TasksRoute'))
const TaskDetailPage    = lazy(() => import('@/pages/tasks/TaskDetailPage'))
const ProjectDetailPage = lazy(() => import('@/pages/projects/ProjectDetailPage'))
const SmmProjectsPage   = lazy(() => import('@/pages/smm/SmmProjectsPage'))
const SmmProjectPage    = lazy(() => import('@/pages/smm/SmmProjectPage'))
const SmmStoriesPage    = lazy(() => import('@/pages/smm/SmmStoriesPage'))
const StoriesCheckPage  = lazy(() => import('@/pages/stories/StoriesCheckPage'))
const EmployeesPage     = lazy(() => import('@/pages/employees/EmployeesPage'))
const EmployeeAccessPage = lazy(() => import('@/pages/access/EmployeeAccessPage'))
const EmployeeDetailPage = lazy(() => import('@/pages/employees/EmployeeDetailPage'))
const CalendarPage      = lazy(() => import('@/pages/calendar/CalendarPage'))
const SmmPage           = lazy(() => import('@/pages/smm/SmmPage'))
// Обёртка раздела «Разработка»: те же SMM-страницы, но работающие с
// dev-проектами (страницы читают раздел из контекста).
const DevSection = ({ children }: { children: React.ReactNode }) => (
  <SmmSectionContext.Provider value="dev">{children}</SmmSectionContext.Provider>
)
// Алиасы раздела «Разработка» вида /dev/board → /dev-board: сохраняют
// location.search, чтобы фильтр `?project=` не терялся при переходе.
function DevAlias({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}
const AnalyticsPage     = lazy(() => import('@/pages/analytics/AnalyticsPage'))
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'))
const ProfilePage       = lazy(() => import('@/pages/profile/ProfilePage'))
const ArchivePage       = lazy(() => import('@/pages/archive/ArchivePage'))
const FilesPage         = lazy(() => import('@/pages/files/FilesPage'))
const AiChatPage        = lazy(() => import('@/pages/ai/AiChatPage'))
const ClientsPage       = lazy(() => import('@/pages/clients/ClientsPage'))
const OnboardingPage    = lazy(() => import('@/pages/onboarding/OnboardingPage'))
const TariffsPage       = lazy(() => import('@/pages/tariffs/TariffsPage'))
const TestNewPage       = lazy(() => import('@/pages/test-new/TestNewPage'))
const RisksPage         = lazy(() => import('@/pages/risks/RisksPage'))
const SecurityLogPage   = lazy(() => import('@/pages/security/SecurityLogPage'))
// Fin System · WebRand — финансовый раздел (Обзор/Доход/Расход/Транзакции/Настройки)
const FinanceOverviewPage     = lazy(() => import('@/pages/finance/FinanceOverviewPage'))
const FinanceIncomePage       = lazy(() => import('@/pages/finance/FinanceIncomePage'))
const FinanceIncomeGroupPage  = lazy(() => import('@/pages/finance/FinanceIncomeGroupPage'))
const FinanceExpensePage      = lazy(() => import('@/pages/finance/FinanceExpensePage'))
const FinanceExpenseGroupPage = lazy(() => import('@/pages/finance/FinanceExpenseGroupPage'))
const FinancePlanningPage     = lazy(() => import('@/pages/finance/FinancePlanningPage'))
const FinanceTransactionsPage = lazy(() => import('@/pages/finance/FinanceTransactionsPage'))
const FinanceInventoryPage    = lazy(() => import('@/pages/finance/FinanceInventoryPage'))
const FinanceActivityPage     = lazy(() => import('@/pages/finance/FinanceActivityPage'))
const FinanceSettingsPage     = lazy(() => import('@/pages/finance/FinanceSettingsPage'))
const EmployeeSalaryPage      = lazy(() => import('@/pages/finance/EmployeeSalaryPage'))
const PublicBriefPage   = lazy(() => import('@/pages/public/PublicBriefPage'))
// «Доска разработки» — канбан dev-трекера (Jira/Notion-стиль).
const DevBoardPage      = lazy(() => import('@/pages/dev-board/DevBoardPage'))
const DevTaskDetailPage = lazy(() => import('@/pages/dev-board/DevTaskDetailPage'))
const DevBoardKpiPage   = lazy(() => import('@/pages/dev-board/DevBoardKpiPage'))
const DevBoardReportsPage = lazy(() => import('@/pages/dev-board/DevBoardReportsPage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  // `authenticated` — это локальная подсказка. Реальная авторизация —
  // в httpOnly cookie на бэке. Если cookie протухла, /auth/me вернёт 401,
  // axios-interceptor выкинет на /auth.
  const authenticated = useAuthStore(s => s.authenticated)
  const user = useAuthStore(s => s.user)
  const fetchMe = useAuthStore(s => s.fetchMe)

  // Если authenticated=true но user пуст (F5 страницы или только что после
  // login) — сами тянем /auth/me. Раньше это делал Layout.useEffect, но
  // PrivateRoute блокирует рендер Layout до прихода user → был бы deadlock.
  //
  // Просим РОВНО ОДИН раз за попытку входа. Раньше в зависимостях был
  // loading: каждая неудача сбрасывала его в false, эффект срабатывал снова
  // и слал новый запрос — сервер отвечал 429, и шторм кормил сам себя.
  // Повторы с нарастающей паузой теперь целиком на стороне стора.
  const askedMe = useRef(false)
  useEffect(() => {
    if (!authenticated || user) { askedMe.current = false; return }
    if (askedMe.current) return
    askedMe.current = true
    fetchMe().catch(() => {})
  }, [authenticated, user, fetchMe])

  if (!authenticated) return <Navigate to="/auth" replace />
  // Пока fetchMe не вернул свежего user — показываем splash, чтобы не
  // мигало «чужое» содержимое (DashboardPage с дефолтной ролью employee
  // и админскими виджетами на 1 секунду).
  if (!user) return <PageLoader />
  return <>{children}</>
}

/** Главная. «Проверяющему сторис» показывать общую панель нечем — у роли
 *  нет ни задач, ни проектов, поэтому сразу ведём на его единственную
 *  страницу «Проверка сторис». */
function HomeRoute() {
  const role = useAuthStore(s => s.user?.role)
  if (role === 'stories_checker') return <Navigate to="/stories-check" replace />
  return <DashboardPage />
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore(s => s.user?.role)
  const secondaryRole = useAuthStore(s => s.user?.secondaryRole)
  const extraPermissions = useAuthStore(s => s.user?.extraPermissions)
  const deniedPermissions = useAuthStore(s => s.user?.deniedPermissions)
  const isStoryMaker = useAuthStore(s => s.user?.isStoryMaker)
  const location = useLocation()
  // Strip query/hash, get pathname
  const path = location.pathname
  // Build canonical path: /projects/:id → /projects/abc treated as /projects/abc
  if (role && !canAccessRoute(role, path, secondaryRole, extraPermissions, deniedPermissions, isStoryMaker)) {
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
          <Route index element={<HomeRoute />} />
          <Route path="my-notes" element={<RoleGuard><MyNotesPage /></RoleGuard>} />
          {/* Задачи от руководителя + детальная карточка задачи. Раньше этих
              маршрутов не было вовсе — ссылки из уведомлений (/tasks/:id)
              падали в «*» и уводили на дашборд. */}
          <Route path="tasks" element={<RoleGuard><TasksRoute /></RoleGuard>} />
          <Route path="tasks/:id" element={<RoleGuard><TaskDetailPage /></RoleGuard>} />
          <Route path="projects/:id" element={<RoleGuard><ProjectDetailPage /></RoleGuard>} />
          <Route path="employees" element={<RoleGuard><EmployeesPage /></RoleGuard>} />
          <Route path="employee-access" element={<RoleGuard><EmployeeAccessPage /></RoleGuard>} />
          <Route path="employees/:id" element={<RoleGuard><EmployeeDetailPage /></RoleGuard>} />
          <Route path="calendar" element={<RoleGuard><CalendarPage /></RoleGuard>} />
          <Route path="stories-check" element={<RoleGuard><StoriesCheckPage /></RoleGuard>} />
          <Route path="smm" element={<RoleGuard><SmmPage /></RoleGuard>} />
          <Route path="smm/stories" element={<RoleGuard><SmmStoriesPage /></RoleGuard>} />
          <Route path="smm/projects" element={<RoleGuard><SmmProjectsPage /></RoleGuard>} />
          <Route path="smm/projects/:id" element={<RoleGuard><SmmProjectPage /></RoleGuard>} />
          {/* Раздел «Разработка» — те же страницы, что у СММ, но провайдер
              переключает их на dev-проекты (см. SmmSectionContext). */}
          <Route path="dev" element={<RoleGuard><DevSection><SmmPage /></DevSection></RoleGuard>} />
          <Route path="dev/projects" element={<RoleGuard><DevSection><SmmProjectsPage /></DevSection></RoleGuard>} />
          <Route path="dev/projects/:id" element={<RoleGuard><DevSection><SmmProjectPage /></DevSection></RoleGuard>} />
          {/* Алиасы «Разработки» на каноническую доску (сохраняют ?project=).
              Канонические остаются /dev-board*. Гард — тот же, что у /dev. */}
          <Route path="dev/board" element={<RoleGuard><DevAlias to="/dev-board" /></RoleGuard>} />
          <Route path="dev/kpi" element={<RoleGuard><DevAlias to="/dev-board/kpi" /></RoleGuard>} />
          <Route path="dev/reports" element={<RoleGuard><DevAlias to="/dev-board/reports" /></RoleGuard>} />
          {/* «Доска разработки» — канбан-трекер задач команды разработки. */}
          <Route path="dev-board" element={<RoleGuard><DevBoardPage /></RoleGuard>} />
          <Route path="dev-board/kpi" element={<RoleGuard><DevBoardKpiPage /></RoleGuard>} />
          <Route path="dev-board/reports" element={<RoleGuard><DevBoardReportsPage /></RoleGuard>} />
          <Route path="dev-board/task/:id" element={<RoleGuard><DevTaskDetailPage /></RoleGuard>} />
          <Route path="analytics" element={<RoleGuard><AnalyticsPage /></RoleGuard>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="archive" element={<RoleGuard><ArchivePage /></RoleGuard>} />
          <Route path="files" element={<RoleGuard><FilesPage /></RoleGuard>} />
          <Route path="ai" element={<RoleGuard><AiChatPage /></RoleGuard>} />
          <Route path="clients" element={<RoleGuard><ClientsPage /></RoleGuard>} />
          <Route path="onboarding" element={<RoleGuard><OnboardingPage /></RoleGuard>} />
          <Route path="tariffs" element={<RoleGuard><TariffsPage /></RoleGuard>} />
          <Route path="test-new" element={<RoleGuard><TestNewPage /></RoleGuard>} />
          <Route path="risks" element={<RoleGuard><RisksPage /></RoleGuard>} />
          <Route path="security-log" element={<RoleGuard><SecurityLogPage /></RoleGuard>} />
          {/* «Активность команды» переехала вкладкой на страницу «Сотрудники»
              (19.09.2026). Старые ссылки и закладки ведут туда же. */}
          <Route path="team-activity" element={<Navigate to="/employees" replace />} />
          <Route path="finance" element={<RoleGuard><FinanceOverviewPage /></RoleGuard>} />
          <Route path="finance/income" element={<RoleGuard><FinanceIncomePage /></RoleGuard>} />
          <Route path="finance/income/:direction" element={<RoleGuard><FinanceIncomeGroupPage /></RoleGuard>} />
          <Route path="finance/expense" element={<RoleGuard><FinanceExpensePage /></RoleGuard>} />
          <Route path="finance/expense/:kind" element={<RoleGuard><FinanceExpenseGroupPage /></RoleGuard>} />
          <Route path="finance/salary/:id" element={<RoleGuard><EmployeeSalaryPage /></RoleGuard>} />
          <Route path="finance/planning" element={<RoleGuard><FinancePlanningPage /></RoleGuard>} />
          <Route path="finance/transactions" element={<RoleGuard><FinanceTransactionsPage /></RoleGuard>} />
          <Route path="finance/inventory" element={<RoleGuard><FinanceInventoryPage /></RoleGuard>} />
          <Route path="finance/activity" element={<RoleGuard><FinanceActivityPage /></RoleGuard>} />
          <Route path="finance/settings" element={<RoleGuard><FinanceSettingsPage /></RoleGuard>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ChunkErrorBoundary>
  )
}
