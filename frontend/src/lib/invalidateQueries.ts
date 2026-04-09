import type { QueryClient } from '@tanstack/react-query'

/**
 * Invalidates ALL queries that depend on task/project data.
 * Call this on any task or project mutation so every page stays in sync.
 */
export function invalidateAfterTaskChange(qc: QueryClient, projectId?: string) {
  // ── Project data ──────────────────────────────────────
  qc.invalidateQueries({ queryKey: ['projects'] })
  qc.invalidateQueries({ queryKey: ['projects-archived'] })
  qc.invalidateQueries({ queryKey: ['project'] })           // partial — covers ['project', *]

  // ── Task data ─────────────────────────────────────────
  qc.invalidateQueries({ queryKey: ['tasks'] })
  qc.invalidateQueries({ queryKey: ['my-tasks'] })
  qc.invalidateQueries({ queryKey: ['task'] })               // partial — covers ['task', *]
  qc.invalidateQueries({ queryKey: ['tasks-review'] })
  qc.invalidateQueries({ queryKey: ['tasks-overdue'] })
  qc.invalidateQueries({ queryKey: ['task-results'] })       // partial — covers ['task-results', *]
  qc.invalidateQueries({ queryKey: ['task-checklist'] })     // partial
  qc.invalidateQueries({ queryKey: ['task-files'] })         // partial

  // ── Employee data ─────────────────────────────────────
  qc.invalidateQueries({ queryKey: ['employees'] })
  qc.invalidateQueries({ queryKey: ['employee-tasks'] })     // partial — covers ['employee-tasks', *]
  qc.invalidateQueries({ queryKey: ['employee-stories'] })   // partial

  // ── Analytics — ALL dashboard queries ─────────────────
  qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
  qc.invalidateQueries({ queryKey: ['analytics-workload'] })
  qc.invalidateQueries({ queryKey: ['overview'] })
  qc.invalidateQueries({ queryKey: ['proj-status'] })
  qc.invalidateQueries({ queryKey: ['task-status'] })
  qc.invalidateQueries({ queryKey: ['task-priority'] })
  qc.invalidateQueries({ queryKey: ['proj-perf'] })
  qc.invalidateQueries({ queryKey: ['emp-eff'] })
  qc.invalidateQueries({ queryKey: ['emp-activity'] })
  qc.invalidateQueries({ queryKey: ['employee-efficiency'] })
  qc.invalidateQueries({ queryKey: ['employee-workload'] })

  // ── Calendar & misc ───────────────────────────────────
  qc.invalidateQueries({ queryKey: ['calendar'] })
  qc.invalidateQueries({ queryKey: ['unread-count'] })
  qc.invalidateQueries({ queryKey: ['notifications'] })
  qc.invalidateQueries({ queryKey: ['notifications-count'] })

  // ── Files (cross-page sync) ───────────────────────────
  qc.invalidateQueries({ queryKey: ['files'] })              // partial — covers ['files', *]
  qc.invalidateQueries({ queryKey: ['files-project'] })      // partial

  // ── Reports & stories ─────────────────────────────────
  qc.invalidateQueries({ queryKey: ['reports'] })
  qc.invalidateQueries({ queryKey: ['stories'] })            // partial
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
