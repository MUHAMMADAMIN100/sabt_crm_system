import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import Layout from '@/components/layout/Layout'
import { PageLoader } from '@/components/ui'
import { canAccessRoute } from '@/lib/permissions'

const AuthPage          = lazy(() => import('@/pages/auth/AuthPage'))
const DashboardPage     = lazy(() => import('@/pages/dashboard/DashboardPage'))
const ProjectsPage      = lazy(() => import('@/pages/projects/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('@/pages/projects/ProjectDetailPage'))
const TasksPage         = lazy(() => import('@/pages/tasks/TasksPage'))
const TaskDetailPage    = lazy(() => import('@/pages/tasks/TaskDetailPage'))
const EmployeesPage     = lazy(() => import('@/pages/employees/EmployeesPage'))
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
const TariffsPage       = lazy(() => import('@/pages/tariffs/TariffsPage'))
const RisksPage         = lazy(() => import('@/pages/risks/RisksPage'))
const FinancePage       = lazy(() => import('@/pages/finance/FinancePage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  return token ? <>{children}</> : <Navigate to="/auth" replace />
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore(s => s.user?.role)
  const location = useLocation()
  // Strip query/hash, get pathname
  const path = location.pathname
  // Build canonical path: /projects/:id → /projects/abc treated as /projects/abc
  if (role && !canAccessRoute(role, path)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  const token = useAuthStore(s => s.token)

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/auth" element={token ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<RoleGuard><ProjectsPage /></RoleGuard>} />
          <Route path="projects/:id" element={<RoleGuard><ProjectDetailPage /></RoleGuard>} />
          <Route path="tasks" element={<RoleGuard><TasksPage /></RoleGuard>} />
          <Route path="tasks/:id" element={<RoleGuard><TaskDetailPage /></RoleGuard>} />
          <Route path="employees" element={<RoleGuard><EmployeesPage /></RoleGuard>} />
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
          <Route path="tariffs" element={<RoleGuard><TariffsPage /></RoleGuard>} />
          <Route path="risks" element={<RoleGuard><RisksPage /></RoleGuard>} />
          <Route path="finance" element={<RoleGuard><FinancePage /></RoleGuard>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
