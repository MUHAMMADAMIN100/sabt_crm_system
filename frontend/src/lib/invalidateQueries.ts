import type { QueryClient } from '@tanstack/react-query'

/**
 * Invalidates all queries that depend on task/project data.
 * Call this whenever a task status changes so analytics and project
 * progress update instantly without a page refresh.
 */
export function invalidateAfterTaskChange(qc: QueryClient, projectId?: string) {
  // Project data
  qc.invalidateQueries({ queryKey: ['projects'] })
  if (projectId) {
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  } else {
    qc.invalidateQueries({ queryKey: ['project'] }) // partial match — covers all ['project', *]
  }
  qc.invalidateQueries({ queryKey: ['tasks'] })

  // Analytics — all dashboard queries
  qc.invalidateQueries({ queryKey: ['overview'] })
  qc.invalidateQueries({ queryKey: ['proj-status'] })
  qc.invalidateQueries({ queryKey: ['task-status'] })
  qc.invalidateQueries({ queryKey: ['task-priority'] })
  qc.invalidateQueries({ queryKey: ['proj-perf'] })
  qc.invalidateQueries({ queryKey: ['emp-eff'] })
  qc.invalidateQueries({ queryKey: ['emp-activity'] })
}
