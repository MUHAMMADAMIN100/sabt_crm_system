import api from '@/lib/api'
import type {
  CheckinFormView, CheckinStatus, CompassView, DepartmentView, DeptKey, GoalPerson, GoalSettingsView,
  KeyResultInput, KeyResultView, SourcePreview, SourcesView,
} from '@/types/goals'

/**
 * «Компас компании» (16.11.2026). Договор — docs/GOALS_SPEC.md §7.
 * Цели месяца сотрудника — goalsApi в api.service.ts (маршруты /goals/*).
 */
export const compassApi = {
  view: (ym?: string) =>
    api.get<CompassView>('/compass', { params: ym ? { ym } : undefined }).then(r => r.data),
  department: (key: DeptKey, ym?: string) =>
    api.get<DepartmentView>(`/compass/departments/${key}`, { params: ym ? { ym } : undefined }).then(r => r.data),

  sources: (ym?: string) =>
    api.get<SourcesView>('/compass/sources', { params: ym ? { ym } : undefined }).then(r => r.data),
  preview: (params: { source: string; ym?: string; direction?: string; kpiKey?: string; department?: string }) =>
    api.get<SourcePreview>('/compass/sources/preview', { params }).then(r => r.data),

  createObjective: (data: { ym: string; title: string; ownerId?: string | null }) =>
    api.post<CompassView>('/compass/objectives', data).then(r => r.data),
  updateObjective: (id: string, data: { title?: string; ownerId?: string | null; sortOrder?: number }) =>
    api.patch<CompassView>(`/compass/objectives/${id}`, data).then(r => r.data),
  removeObjective: (id: string) =>
    api.delete<CompassView>(`/compass/objectives/${id}`).then(r => r.data),

  createKeyResult: (data: KeyResultInput) =>
    api.post<KeyResultView>('/compass/key-results', data).then(r => r.data),
  updateKeyResult: (id: string, data: Partial<KeyResultInput> & { manualValue?: number | null }) =>
    api.patch<KeyResultView>(`/compass/key-results/${id}`, data).then(r => r.data),
  removeKeyResult: (id: string) =>
    api.delete<{ ok: true }>(`/compass/key-results/${id}`).then(r => r.data),

  checkinOne: (id: string, data: { status: CheckinStatus; comment?: string | null }) =>
    api.post<KeyResultView>(`/compass/key-results/${id}/checkin`, data).then(r => r.data),
  addInitiative: (id: string, data: { kind: 'project' | 'task'; refId: string }) =>
    api.post<KeyResultView>(`/compass/key-results/${id}/initiatives`, data).then(r => r.data),
  removeInitiative: (id: string) =>
    api.delete<{ ok: true }>(`/compass/initiatives/${id}`).then(r => r.data),
  distribute: (id: string, items: Array<{ userId: string; target: number }>) =>
    api.post<{ created: number; skipped: Array<{ userId: string; reason: string }> }>(
      `/compass/key-results/${id}/distribute`, { items },
    ).then(r => r.data),

  checkinForm: () => api.get<CheckinFormView>('/compass/checkin').then(r => r.data),
  submitCheckin: (items: Array<{ keyResultId: string; status: CheckinStatus; comment?: string | null }>) =>
    api.post<CheckinFormView>('/compass/checkin', { items }).then(r => r.data),

  copyMonth: (fromYm: string, toYm: string) =>
    api.post<{ objectives: number; keyResults: number }>('/compass/copy-month', { fromYm, toYm }).then(r => r.data),

  settings: () => api.get<GoalSettingsView>('/compass/settings').then(r => r.data),
  saveSettings: (leaders: Partial<Record<DeptKey, string | null>>) =>
    api.put<GoalSettingsView>('/compass/settings', { leaders }).then(r => r.data),

  people: (search?: string) =>
    api.get<GoalPerson[]>('/compass/people', { params: search ? { search } : undefined }).then(r => r.data),
}

/** Ключи TanStack Query «Компаса». */
export const compassKeys = {
  all: ['compass'] as const,
  view: (ym: string) => ['compass', 'view', ym] as const,
  department: (key: string, ym: string) => ['compass', 'department', key, ym] as const,
  sources: (ym: string) => ['compass', 'sources', ym] as const,
  checkin: ['compass', 'checkin'] as const,
  settings: ['compass', 'settings'] as const,
}
