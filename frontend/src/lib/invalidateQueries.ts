import type { QueryClient } from '@tanstack/react-query'
import { FULL_SCOPE, getTaskChangeSync, invalidateTaskQueries } from './taskChangeSync'

/**
 * Invalidates ALL queries that depend on task/project data.
 * Call this on any task or project mutation so every page stays in sync.
 *
 * 08.11.2026: тот же набор, что и у события tasks:changed (taskChangeSync), —
 * поэтому эхо своей правки вкладка может пропустить, ничего не потеряв.
 * Убраны ['employees'] (в списке сотрудников нет данных задач, а запрос
 * висит в шапке и шёл после каждой правки) и сторис (считаются по отметкам
 * сторис, у них своё событие stories:changed). Список проектов — через общий
 * троттлинг: не чаще раза в 10 с.
 */
export function invalidateAfterTaskChange(qc: QueryClient, projectId?: string) {
  const sync = getTaskChangeSync(qc)
  sync.markLocal(projectId)
  invalidateTaskQueries(qc, FULL_SCOPE, sync.requestProjectsList)

  // ── Только у автора: то, чего нет в событии ────────────
  qc.invalidateQueries({ queryKey: ['projects-archived'] })
  qc.invalidateQueries({ queryKey: ['proj-status'] })
  qc.invalidateQueries({ queryKey: ['notifications'] })
  qc.invalidateQueries({ queryKey: ['notifications-count'] })
  qc.invalidateQueries({ queryKey: ['files'] })              // partial — covers ['files', *]
  qc.invalidateQueries({ queryKey: ['files-project'] })      // partial
}

/**
 * Invalidates queries after project member/manager changes.
 */
export function invalidateAfterProjectChange(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['projects'] })
  qc.invalidateQueries({ queryKey: ['project'] })
  qc.invalidateQueries({ queryKey: ['employees'] })
  qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
  qc.invalidateQueries({ queryKey: ['analytics-workload'] })
  qc.invalidateQueries({ queryKey: ['employee-workload'] })
  qc.invalidateQueries({ queryKey: ['calendar'] })
}

/**
 * Invalidates queries after employee changes.
 */
export function invalidateAfterEmployeeChange(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['employees'] })
  qc.invalidateQueries({ queryKey: ['users'] })
  qc.invalidateQueries({ queryKey: ['employee-tasks'] })
  qc.invalidateQueries({ queryKey: ['employee-stories'] })
  qc.invalidateQueries({ queryKey: ['employee-efficiency'] })
  qc.invalidateQueries({ queryKey: ['employee-workload'] })
  qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
  qc.invalidateQueries({ queryKey: ['emp-eff'] })
  qc.invalidateQueries({ queryKey: ['emp-activity'] })
}
