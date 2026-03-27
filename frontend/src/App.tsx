import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import Layout from '@/components/layout/Layout'
import AuthPage from '@/pages/auth/AuthPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import ProjectsPage from '@/pages/projects/ProjectsPage'
import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'
import TasksPage from '@/pages/tasks/TasksPage'
import TaskDetailPage from '@/pages/tasks/TaskDetailPage'
import EmployeesPage from '@/pages/employees/EmployeesPage'
import EmployeeDetailPage from '@/pages/employees/EmployeeDetailPage'
import CalendarPage from '@/pages/calendar/CalendarPage'
import ReportsPage from '@/pages/reports/ReportsPage'
import AnalyticsPage from '@/pages/analytics/AnalyticsPage'
import NotificationsPage from '@/pages/notifications/NotificationsPage'
import ProfilePage from '@/pages/profile/ProfilePage'
import ArchivePage from '@/pages/archive/ArchivePage'
import FilesPage from '@/pages/files/FilesPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  return token ? <>{children}</> : <Navigate to="/auth" replace />
}

export default function App() {
  const token = useAuthStore(s => s.token)

  return (
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
