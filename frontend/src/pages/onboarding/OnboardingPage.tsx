import { Navigate } from 'react-router-dom'

/**
 * «Онбординг» убран (15.11.2026, продажи — этап 2): вторая воронка
 * дублировала этапы лида и расходилась с ними. Этапы «Встреча / КП /
 * Договор» теперь — этапы единой воронки в «Клиентах». Старые ссылки и
 * закладки ведут на доску.
 */
export default function OnboardingPage() {
  return <Navigate to="/clients?view=board" replace />
}
