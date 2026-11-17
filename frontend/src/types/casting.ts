/**
 * «Кастинг» (17.11.2026) — база актёров, блогеров и моделей WeBrand.
 * Договор с бэкендом — docs/CASTING_SPEC.md §2–4. Меняя формы здесь,
 * правьте и сервер (modules/casting).
 *
 * Пути фото (`photo`, `photos[].path`, PublicTalent.photos) — вида
 * '/uploads/casting/<файл>'; полный адрес строит photoUrl() из casting.api.
 */

export type CastingCategory = 'actor' | 'blogger' | 'model'
export type CastingTag = 'ads' | 'film' | 'theatre' | 'clips' | 'social' | 'model'
/** Вкладка списка: категория, «Все» или «Дети» (возраст < 16). */
export type CastingTab = 'all' | CastingCategory | 'kids'
export type BookingStatus = 'invited' | 'confirmed' | 'declined'

export interface TalentListItem {
  id: string
  name: string
  categories: CastingCategory[]
  city: string | null
  /** Свободный текст: '175', '180+', '154-155'. */
  height: string | null
  age: number | null
  kid: boolean
  tags: CastingTag[]
  /** Главное фото (первое по порядку). */
  photo: string | null
  /** Второе фото — показываем при наведении на карточку (если сервер его отдаёт). */
  photo2?: string | null
  photosCount: number
  isPublic: boolean
  isArchived: boolean
}

export interface TalentCounts {
  all: number
  actor: number
  blogger: number
  model: number
  kids: number
}

export interface TalentListResponse {
  items: TalentListItem[]
  counts: TalentCounts
}

export interface TalentListParams {
  search?: string
  category?: CastingCategory
  tags?: CastingTag[]
  kids?: boolean
  archived?: boolean
}

export interface TalentPhoto {
  id: string
  path: string
}

/** Съёмка в истории актёра (новые сверху). */
export interface TalentShoot {
  bookingId: string
  contentItemId: string
  projectId?: string | null
  date: string | null
  projectName: string | null
  title: string | null
  status: BookingStatus
  note?: string | null
}

/** Заявка клиента с публичного каталога. */
export interface TalentRequest {
  leadId: string | null
  leadName: string | null
  createdAt: string
}

export interface TalentDetail extends TalentListItem {
  birthDate: string | null
  experience: string | null
  links: string[]
  phone: string | null
  telegram: string | null
  rate: string | null
  notes: string | null
  photos: TalentPhoto[]
  shoots: TalentShoot[]
  requests: TalentRequest[]
  canEdit: boolean
}

/** Что отправляет форма «Добавить / Изменить». ageBase — возраст «на сегодня»,
 *  когда даты рождения нет (сервер ставит ageBaseAt = сегодня). */
export interface TalentInput {
  name: string
  categories: CastingCategory[]
  city: string | null
  height: string | null
  birthDate: string | null
  ageBase?: number | null
  tags: CastingTag[]
  experience: string | null
  links: string[]
  phone: string | null
  telegram: string | null
  rate: string | null
  notes: string | null
  isPublic: boolean
}

export type TalentPatch = Partial<TalentInput> & { isArchived?: boolean }

/** Актёр в съёмке. */
export interface ShootTalent {
  bookingId: string
  status: BookingStatus
  note: string | null
  talent: {
    id: string
    name: string
    photo: string | null
    categories: CastingCategory[]
    age: number | null
  }
}

export interface ShootTalentsResponse {
  items: ShootTalent[]
  /** Может ли этот человек ставить, убирать и менять статус в этой съёмке
   *  (сервер учитывает и проект: SMM-специалист — только своих проектов). */
  canEdit?: boolean
}

export interface CastingImportResult {
  created: number
  skipped: number
  photos: number
  missingPhotos: string[]
}

/** Каталог для клиентов — без телефона, Telegram, гонорара и заметок. */
export interface PublicTalent {
  id: string
  name: string
  categories: CastingCategory[]
  city: string | null
  height: string | null
  age: number | null
  kid: boolean
  tags: CastingTag[]
  experience: string | null
  links: string[]
  photos: string[]
}

export interface PublicBookingInput {
  talentIds: string[]
  name: string
  phone: string
  comment?: string
  /** Ловушка для ботов: человек это поле не видит и не заполняет. */
  website?: string
}
