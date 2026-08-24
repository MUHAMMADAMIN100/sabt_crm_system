import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ChevronLeft, ChevronRight, Send, Trash2, Eye, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { teamStoriesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Avatar } from '@/components/ui'
import { patchStory, removeStories, shortAgo, type StoryGroup } from '@/lib/teamStories'

/** Сколько показывается фотография, пока не переключимся на следующую. */
const PHOTO_MS = 6000
const EMOJI = ['❤️', '😂', '😮', '😢', '👏', '🔥']

interface Props {
  groups: StoryGroup[]
  startAuthorId: string
  onClose: () => void
}

/**
 * Полноэкранный просмотр сторис — как в инстаграме: полоски прогресса
 * сверху, автопереход, тап по краям экрана, удержание — пауза.
 *
 * Реакции и комментарии обновляются оптимистично: своё действие видно
 * сразу, ответ сервера только подтверждает. Чужие действия прилетают
 * вебсокетом и правят тот же кэш (см. lib/teamStories).
 */
export default function StoryViewer({ groups, startAuthorId, onClose }: Props) {
  const me = useAuthStore(s => s.user)
  const qc = useQueryClient()

  const startGroup = Math.max(0, groups.findIndex(g => g.authorId === startAuthorId))
  const [gi, setGi] = useState(startGroup)
  const [si, setSi] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [commentText, setCommentText] = useState('')
  const [showViewers, setShowViewers] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const startedAt = useRef<number>(Date.now())
  const elapsed = useRef<number>(0)

  const group = groups[gi]
  const story = group?.stories[si]
  const isMine = story && group?.authorId === me?.id

  // ─── Переходы ───────────────────────────────────────────────────────
  const next = useCallback(() => {
    setProgress(0); elapsed.current = 0; startedAt.current = Date.now()
    setSi(prevSi => {
      const g = groups[gi]
      if (g && prevSi + 1 < g.stories.length) return prevSi + 1
      setGi(prevGi => {
        if (prevGi + 1 < groups.length) return prevGi + 1
        // Дошли до конца ленты — закрываем просмотр.
        queueMicrotask(onClose)
        return prevGi
      })
      return 0
    })
  }, [gi, groups, onClose])

  const prev = useCallback(() => {
    setProgress(0); elapsed.current = 0; startedAt.current = Date.now()
    setSi(prevSi => {
      if (prevSi > 0) return prevSi - 1
      let jumped = false
      setGi(prevGi => {
        if (prevGi > 0) { jumped = true; return prevGi - 1 }
        return prevGi
      })
      // На первой сторис первого автора остаёмся на месте.
      return jumped ? Math.max(0, (groups[gi - 1]?.stories.length || 1) - 1) : 0
    })
  }, [gi, groups])

  // ─── Прогресс и автопереход ─────────────────────────────────────────
  useEffect(() => {
    if (!story) return
    const duration = story.kind === 'video'
      ? Math.max(1, story.durationSec || 10) * 1000
      : PHOTO_MS
    startedAt.current = Date.now() - elapsed.current
    const timer = window.setInterval(() => {
      if (paused) { startedAt.current = Date.now() - elapsed.current; return }
      elapsed.current = Date.now() - startedAt.current
      const p = Math.min(1, elapsed.current / duration)
      setProgress(p)
      if (p >= 1) next()
    }, 50)
    return () => window.clearInterval(timer)
  }, [story, paused, next])

  // Пауза управляет и видео: иначе звук продолжал бы идти под паузой.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (paused) v.pause()
    else v.play().catch(() => { /* автовоспроизведение могло быть запрещено */ })
  }, [paused, story?.id])

  // ─── Клавиатура ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
        || (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (typing) return
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === ' ') { e.preventDefault(); setPaused(p => !p) }
    }
    document.addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
    }
  }, [next, prev, onClose])

  // ─── Отметка просмотра ──────────────────────────────────────────────
  const viewMut = useMutation({
    mutationFn: (id: string) => teamStoriesApi.view(id),
    onSuccess: (r: any, id) => patchStory(qc, id, s => ({ ...s, viewsCount: r?.viewsCount ?? s.viewsCount })),
  })
  useEffect(() => {
    if (!story || story.seen || isMine || story.pending) return
    // Оптимистично: кольцо гаснет сразу, не дожидаясь сервера.
    patchStory(qc, story.id, s => ({ ...s, seen: true }))
    viewMut.mutate(story.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id])

  // ─── Реакции ────────────────────────────────────────────────────────
  const reactMut = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) => teamStoriesApi.react(id, emoji),
    onMutate: async ({ id, emoji }) => {
      const before = qc.getQueryData(['team-stories'])
      patchStory(qc, id, s => {
        const counts = { ...s.reactions }
        if (s.myReaction) counts[s.myReaction] = Math.max(0, (counts[s.myReaction] || 1) - 1)
        const same = s.myReaction === emoji
        if (!same) counts[emoji] = (counts[emoji] || 0) + 1
        for (const k of Object.keys(counts)) if (!counts[k]) delete counts[k]
        return { ...s, reactions: counts, myReaction: same ? null : emoji }
      })
      return { before }
    },
    onError: (_e, _v, ctx) => {
      // Сервер отказал — возвращаем ленту в прежний вид, чтобы человек не
      // остался с реакцией, которой на самом деле нет.
      if (ctx?.before) qc.setQueryData(['team-stories'], ctx.before)
      toast.error('Не удалось поставить реакцию')
    },
    onSuccess: (r: any, { id }) =>
      patchStory(qc, id, s => ({ ...s, reactions: r.reactions, myReaction: r.myReaction })),
  })

  // ─── Комментарии ────────────────────────────────────────────────────
  const { data: comments = [], isLoading: commentsLoading } = useQuery<any[]>({
    queryKey: ['team-story-comments', story?.id],
    queryFn: () => teamStoriesApi.comments(story!.id),
    enabled: !!story?.id && !story?.pending,
  })

  const commentMut = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => teamStoriesApi.addComment(id, text),
    onMutate: async ({ id, text }) => {
      const key = ['team-story-comments', id]
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<any[]>(key)
      const draft = {
        id: `tmp-${Date.now()}`,
        storyId: id,
        authorId: me?.id,
        authorName: me?.name || 'Вы',
        authorAvatar: (me as any)?.avatar || null,
        text,
        createdAt: new Date().toISOString(),
        pending: true,
      }
      qc.setQueryData<any[]>(key, [...(before || []), draft])
      patchStory(qc, id, s => ({ ...s, commentsCount: s.commentsCount + 1 }))
      return { before, key, draftId: draft.id }
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.before !== undefined) qc.setQueryData(ctx.key, ctx.before)
      patchStory(qc, id, s => ({ ...s, commentsCount: Math.max(0, s.commentsCount - 1) }))
      toast.error('Комментарий не отправился')
    },
    onSuccess: (saved: any, { id }, ctx) => {
      // Заменяем черновик настоящим — id понадобится для удаления.
      qc.setQueryData<any[]>(ctx!.key, (list) =>
        (list || []).map(c => (c.id === ctx!.draftId ? saved : c)))
      patchStory(qc, id, s => ({ ...s, commentsCount: saved.commentsCount ?? s.commentsCount }))
    },
  })

  const delCommentMut = useMutation({
    mutationFn: (commentId: string) => teamStoriesApi.removeComment(commentId),
    onMutate: async (commentId) => {
      const key = ['team-story-comments', story!.id]
      const before = qc.getQueryData<any[]>(key)
      qc.setQueryData<any[]>(key, (list) => (list || []).filter(c => c.id !== commentId))
      return { before, key }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before !== undefined) qc.setQueryData(ctx.key, ctx.before)
      toast.error('Не удалось удалить комментарий')
    },
  })

  const delStoryMut = useMutation({
    mutationFn: (id: string) => teamStoriesApi.remove(id),
    onSuccess: (_r, id) => { removeStories(qc, [id]); toast.success('Сторис удалена'); onClose() },
    onError: () => toast.error('Не удалось удалить сторис'),
  })

  const { data: viewers = [] } = useQuery<any[]>({
    queryKey: ['team-story-viewers', story?.id],
    queryFn: () => teamStoriesApi.viewers(story!.id),
    enabled: !!story?.id && !!isMine && showViewers,
  })

  if (!story || !group) return null

  const send = () => {
    const text = commentText.trim()
    if (!text) return
    setCommentText('')
    commentMut.mutate({ id: story.id, text })
  }

  return createPortal(
    <div className="fixed inset-0 z-[10002] bg-black/95 flex items-center justify-center"
      role="dialog" aria-modal="true" aria-label={`Сторис: ${group.authorName}`}>

      <button type="button" onClick={onClose} aria-label="Закрыть"
        className="absolute top-4 right-4 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
        <X size={22} />
      </button>

      {/* Стрелки для мыши: на телефоне работают тапы по краям кадра. */}
      {(gi > 0 || si > 0) && (
        <button type="button" onClick={prev} aria-label="Предыдущая"
          className="hidden sm:flex absolute left-4 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
          <ChevronLeft size={22} />
        </button>
      )}
      <button type="button" onClick={next} aria-label="Следующая"
        className="hidden sm:flex absolute right-4 top-1/2 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
        <ChevronRight size={22} />
      </button>

      <div className="relative w-full h-full sm:h-[92vh] sm:w-auto sm:aspect-[9/16] sm:rounded-2xl overflow-hidden bg-black flex flex-col">
        {/* Полоски прогресса */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 bg-white/30 rounded-full overflow-hidden">
              <div className="h-full bg-white transition-[width] duration-100 ease-linear"
                style={{ width: i < si ? '100%' : i === si ? `${progress * 100}%` : '0%' }} />
            </div>
          ))}
        </div>

        {/* Шапка */}
        <div className="absolute top-4 left-0 right-0 z-20 flex items-center gap-2 px-3 pt-2">
          <Avatar name={group.authorName} src={group.authorAvatar || undefined} size={32} zoomable={false} />
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{group.authorName}</p>
            <p className="text-white/60 text-[11px]">{shortAgo(story.createdAt)}</p>
          </div>
          {story.pending && (
            <span className="text-white/70 text-[11px] flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> отправляется
            </span>
          )}
          {isMine && !story.pending && (
            <button type="button" aria-label="Удалить сторис"
              onClick={() => delStoryMut.mutate(story.id)}
              className="ml-auto text-white/70 hover:text-red-400 p-1">
              <Trash2 size={16} />
            </button>
          )}
        </div>

        {/* Кадр. Клик по левой трети — назад, по правой — вперёд,
            удержание в середине — пауза, как в инстаграме. */}
        <div className="flex-1 relative select-none"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}>
          {story.kind === 'video' ? (
            <video ref={videoRef} key={story.id}
              src={teamStoriesApi.mediaUrl(story.mediaKey)}
              className="absolute inset-0 w-full h-full object-contain"
              autoPlay playsInline onEnded={next} />
          ) : (
            <img key={story.id} src={teamStoriesApi.mediaUrl(story.mediaKey)} alt={story.caption || 'Сторис'}
              className="absolute inset-0 w-full h-full object-contain" />
          )}
          <button type="button" aria-label="Назад" onClick={prev}
            className="absolute left-0 top-0 bottom-0 w-1/3 cursor-default" />
          <button type="button" aria-label="Вперёд" onClick={next}
            className="absolute right-0 top-0 bottom-0 w-1/3 cursor-default" />
        </div>

        {/* Подпись, реакции, комментарии */}
        <div className="relative z-20 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-6 space-y-2">
          {story.caption && <p className="text-white text-sm">{story.caption}</p>}

          <div className="flex items-center gap-1.5 flex-wrap">
            {EMOJI.map(e => {
              const count = story.reactions[e] || 0
              const active = story.myReaction === e
              return (
                <button key={e} type="button" aria-label={`Реакция ${e}`}
                  disabled={story.pending}
                  onClick={() => reactMut.mutate({ id: story.id, emoji: e })}
                  className={clsx('px-2 py-1 rounded-full text-sm transition-colors disabled:opacity-40',
                    active ? 'bg-white/30 ring-1 ring-white/60' : 'bg-white/10 hover:bg-white/20')}>
                  <span>{e}</span>
                  {count > 0 && <span className="text-white text-[11px] ml-1">{count}</span>}
                </button>
              )
            })}
            {isMine && (
              <button type="button" onClick={() => { setShowViewers(v => !v); setPaused(true) }}
                className="ml-auto text-white/80 text-xs flex items-center gap-1 hover:text-white">
                <Eye size={13} /> {story.viewsCount}
              </button>
            )}
          </div>

          {showViewers && isMine && (
            <div className="max-h-32 overflow-y-auto bg-white/10 rounded-lg p-2 space-y-1">
              {viewers.length === 0 ? (
                <p className="text-white/60 text-xs text-center py-1">Пока никто не посмотрел</p>
              ) : viewers.map((v: any) => (
                <div key={v.userId} className="flex items-center gap-2">
                  <Avatar name={v.name} src={v.avatar || undefined} size={20} zoomable={false} />
                  <span className="text-white text-xs">{v.name}</span>
                </div>
              ))}
            </div>
          )}

          <div className="max-h-28 overflow-y-auto space-y-1.5">
            {commentsLoading ? (
              <p className="text-white/50 text-xs">Загружаем комментарии…</p>
            ) : comments.map((c: any) => (
              <div key={c.id} className={clsx('flex items-start gap-2', c.pending && 'opacity-60')}>
                <Avatar name={c.authorName} src={c.authorAvatar || undefined} size={20} zoomable={false} />
                <p className="text-white text-xs flex-1">
                  <span className="font-semibold">{c.authorName}</span>{' '}
                  <span className="text-white/90">{c.text}</span>
                </p>
                {(c.authorId === me?.id || isMine) && !c.pending && (
                  <button type="button" aria-label="Удалить комментарий"
                    onClick={() => delCommentMut.mutate(c.id)}
                    className="text-white/40 hover:text-red-400 shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
              disabled={story.pending}
              placeholder="Написать комментарий…"
              aria-label="Комментарий к сторис"
              className="flex-1 bg-white/10 text-white placeholder-white/40 text-sm rounded-full px-3 py-2 outline-none focus:bg-white/20 disabled:opacity-40"
            />
            <button type="button" onClick={send} aria-label="Отправить"
              disabled={!commentText.trim() || story.pending}
              className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white disabled:opacity-30">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
