import api from '@/lib/api'
import type {
  CastingImportResult, PublicBookingInput, PublicTalent, ShootTalentsResponse, TalentDetail, TalentInput,
  TalentListParams, TalentListResponse, TalentPatch, BookingStatus,
} from '@/types/casting'

/**
 * «Кастинг» (17.11.2026). Договор — docs/CASTING_SPEC.md §2–4.
 */

/** Фото лежат на сервере API ('/uploads/casting/…'); фронт может жить на
 *  другом домене, поэтому адрес собираем через VITE_API_URL, как у файлов. */
const FILE_BASE: string = import.meta.env.VITE_API_URL || ''
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${FILE_BASE}${path.startsWith('/') ? '' : '/'}${path}`
}

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } }

export const castingApi = {
  list: (p: TalentListParams = {}) =>
    api.get<TalentListResponse>('/casting/talents', {
      params: {
        search: p.search?.trim() || undefined,
        category: p.category || undefined,
        tags: p.tags?.length ? p.tags.join(',') : undefined,
        kids: p.kids ? 1 : undefined,
        archived: p.archived ? 1 : undefined,
      },
    }).then(r => r.data),
  get: (id: string) => api.get<TalentDetail>(`/casting/talents/${id}`).then(r => r.data),
  create: (data: TalentInput) => api.post<TalentDetail>('/casting/talents', data).then(r => r.data),
  update: (id: string, data: TalentPatch) => api.patch<TalentDetail>(`/casting/talents/${id}`, data).then(r => r.data),

  addPhotos: (id: string, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f, f.name)
    return api.post<TalentDetail>(`/casting/talents/${id}/photos`, fd, multipart).then(r => r.data)
  },
  reorderPhotos: (id: string, ids: string[]) =>
    api.patch<TalentDetail>(`/casting/talents/${id}/photos/order`, { ids }).then(r => r.data),
  removePhoto: (photoId: string) => api.delete<TalentDetail>(`/casting/photos/${photoId}`).then(r => r.data),

  /** Одна пачка импорта: data.json (только люди этой пачки) + их фото.
   *  onProgress — отправленные байты пачки. */
  importBatch: (entries: unknown[], files: File[], onProgress?: (loaded: number) => void) => {
    const fd = new FormData()
    fd.append('data', new Blob([JSON.stringify(entries)], { type: 'application/json' }), 'data.json')
    for (const f of files) fd.append('files', f, f.name)
    return api.post<CastingImportResult>('/casting/import', fd, {
      ...multipart,
      // Загрузка фото может идти дольше обычного запроса.
      timeout: 10 * 60_000,
      onUploadProgress: e => onProgress?.(e.loaded || 0),
    }).then(r => r.data)
  },

  shoot: (contentItemId: string) =>
    api.get<ShootTalentsResponse>(`/casting/shoots/${contentItemId}`).then(r => r.data),
  addToShoot: (contentItemId: string, talentId: string, note?: string) =>
    api.post<ShootTalentsResponse>(`/casting/shoots/${contentItemId}`, { talentId, note }).then(r => r.data),
  updateBooking: (bookingId: string, data: { status?: BookingStatus; note?: string | null }) =>
    api.patch<ShootTalentsResponse>(`/casting/bookings/${bookingId}`, data).then(r => r.data),
  removeBooking: (bookingId: string) =>
    api.delete<ShootTalentsResponse>(`/casting/bookings/${bookingId}`).then(r => r.data),
}

/** Публичный каталог — без входа (страница /public/casting). */
export const publicCastingApi = {
  list: () => api.get<{ items: PublicTalent[] }>('/public/casting').then(r => r.data),
  book: (data: PublicBookingInput) => api.post<{ ok: true }>('/public/casting/book', data).then(r => r.data),
}
