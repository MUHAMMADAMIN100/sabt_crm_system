import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import Layout from '@/components/layout/Layout'
import { PageLoader } from '@/components/ui'

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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  return token ? <>{children}</> : <Navigate to="/auth" replace />
}

export default function App() {
  const token = useAuthStore(s => s.token)

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/auth" element={token ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="ai" element={<AiChatPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
