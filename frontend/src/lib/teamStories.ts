import { QueryClient } from '@tanstack/react-query'

/** Одна сторис в ленте. */
export interface TeamStory {
  id: string
  kind: 'photo' | 'video'
  caption: string
  mediaKey: string
  mediaMime: string
  durationSec: number
  createdAt: string
  expiresAt: string
  viewsCount: number
  commentsCount: number
  reactions: Record<string, number>
  myReaction: string | null
  seen: boolean
  /** Помечается локально, пока файл ещё летит на сервер. */
  pending?: boolean
}

/** Сторис одного автора — кружок в ленте. */
export interface StoryGroup {
  authorId: string
  authorName: string
  authorAvatar: string | null
  stories: TeamStory[]
  hasUnseen: boolean
  lastAt: string
}

export const FEED_KEY = ['team-stories'] as const

/**
 * Точечные правки ленты в кэше.
 *
 * Ими пользуются и оптимистичные обновления (своё действие видно мгновенно),
 * и события вебсокета (чужое действие прилетает без перезагрузки). Логика
 * одна на оба случая — иначе они неизбежно разъезжаются.
 */
export function patchStory(
  qc: QueryClient,
  storyId: string,
  patch: (s: TeamStory) => TeamStory,
) {
  qc.setQueryData<StoryGroup[]>(FEED_KEY, (groups) => {
    if (!groups) return groups
    return groups.map(g => {
      if (!g.stories.some(s => s.id === storyId)) return g
      const stories = g.stories.map(s => (s.id === storyId ? patch(s) : s))
      return { ...g, stories, hasUnseen: stories.some(s => !s.seen) }
    })
  })
}

/** Добавляет сторис в ленту, не создавая дублей (событие могло прийти и от
 *  своей же публикации, и от вебсокета). */
export function addStory(qc: QueryClient, story: TeamStory & {
  authorId: string; authorName: string; authorAvatar: string | null
}, viewerId?: string) {
  qc.setQueryData<StoryGroup[]>(FEED_KEY, (groups) => {
    const list = groups ? [...groups] : []
    if (list.some(g => g.stories.some(s => s.id === story.id))) return list
    const idx = list.findIndex(g => g.authorId === story.authorId)
    const item: TeamStory = { ...story }
    if (idx >= 0) {
      const g = list[idx]
      const stories = [...g.stories, item]
      list[idx] = { ...g, stories, hasUnseen: stories.some(s => !s.seen), lastAt: story.createdAt }
    } else {
      list.push({
        authorId: story.authorId,
        authorName: story.authorName,
        authorAvatar: story.authorAvatar,
        stories: [item],
        hasUnseen: !item.seen,
        lastAt: story.createdAt,
      })
    }
    return sortGroups(list, viewerId)
  })
}

/** Убирает сторис (удалили автором или истекли сутки). Автор без сторис
 *  пропадает из ленты — пустой кружок не нужен. */
export function removeStories(qc: QueryClient, ids: string[]) {
  const gone = new Set(ids)
  qc.setQueryData<StoryGroup[]>(FEED_KEY, (groups) => {
    if (!groups) return groups
    return groups
      .map(g => {
        const stories = g.stories.filter(s => !gone.has(s.id))
        return { ...g, stories, hasUnseen: stories.some(s => !s.seen) }
      })
      .filter(g => g.stories.length > 0)
  })
}

/** Свои сторис первыми, затем непросмотренные, затем по свежести —
 *  тот же порядок, что отдаёт сервер. */
export function sortGroups(groups: StoryGroup[], viewerId?: string): StoryGroup[] {
  return [...groups].sort((a, b) => {
    if (viewerId) {
      if (a.authorId === viewerId) return -1
      if (b.authorId === viewerId) return 1
    }
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1
    return String(b.lastAt).localeCompare(String(a.lastAt))
  })
}

/** «5 мин назад» — короткая подпись возраста сторис. */
export function shortAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч`
  return `${Math.floor(h / 24)} д`
}
