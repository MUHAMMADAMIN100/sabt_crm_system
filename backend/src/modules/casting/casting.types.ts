/**
 * Формы ответов кастинга (docs/CASTING_SPEC.md §3–4). Даты — 'YYYY-MM-DD'
 * (по Душанбе), моменты — ISO-строки.
 */

export type BookingStatus = 'invited' | 'confirmed' | 'declined';

/** Карточка в сетке CRM. photo — первое фото, photo2 — второе (для наведения). */
export interface TalentListItem {
  id: string;
  name: string;
  categories: string[];
  city: string | null;
  height: string | null;
  age: number | null;
  kid: boolean;
  tags: string[];
  photo: string | null;
  photo2: string | null;
  photosCount: number;
  isPublic: boolean;
  isArchived: boolean;
}

export interface TalentCounts {
  all: number;
  actor: number;
  blogger: number;
  model: number;
  kids: number;
}

export interface TalentListView {
  items: TalentListItem[];
  counts: TalentCounts;
}

export interface TalentShoot {
  bookingId: string;
  contentItemId: string;
  projectId: string | null;
  date: string | null;
  projectName: string | null;
  title: string | null;
  status: BookingStatus;
  note: string | null;
}

export interface TalentRequest {
  leadId: string | null;
  leadName: string | null;
  createdAt: string;
}

export interface TalentDetail extends TalentListItem {
  birthDate: string | null;
  experience: string | null;
  links: string[];
  phone: string | null;
  telegram: string | null;
  rate: string | null;
  notes: string | null;
  photos: Array<{ id: string; path: string }>;
  shoots: TalentShoot[];
  requests: TalentRequest[];
  canEdit: boolean;
}

export interface ShootTalent {
  bookingId: string;
  status: BookingStatus;
  note: string | null;
  talent: { id: string; name: string; photo: string | null; categories: string[]; age: number | null };
}

/** canEdit — можно ли ставить/убирать людей и менять статус в этой съёмке. */
export interface ShootTalentsView {
  items: ShootTalent[];
  canEdit: boolean;
}

/** Публичный каталог: без телефона, Telegram, гонорара и заметок. */
export interface PublicTalent {
  id: string;
  name: string;
  categories: string[];
  city: string | null;
  height: string | null;
  age: number | null;
  kid: boolean;
  tags: string[];
  experience: string | null;
  links: string[];
  photos: string[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  photos: number;
  missingPhotos: string[];
}
