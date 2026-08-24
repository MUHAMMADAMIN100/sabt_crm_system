import { useRef, useState, lazy, Suspense } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { teamStoriesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Avatar } from '@/components/ui'
import { compressImage } from '@/lib/imageCompress'
import { addStory, FEED_KEY, type StoryGroup } from '@/lib/teamStories'

const StoryViewer = lazy(() => import('./StoryViewer'))

/** Сторис показывается вертикально, поэтому и сжимаем под вертикаль. */
const STORY_MAX_SIDE = 1280
const STORY_TARGET_BYTES = 900 * 1024
const MAX_VIDEO_BYTES = 12 * 1024 * 1024
const MAX_VIDEO_SEC = 20

/** Длительность видео читаем в браузере: так человек узнаёт о слишком
 *  длинном ролике сразу, а не после загрузки 12 МБ на сервер. */
function videoInfo(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(v.duration || 0)) }
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0) }
    v.src = url
  })
}

/**
 * Лента команды: кружки авторов сверху страницы. Непросмотренные обведены
 * цветным кольцом, просмотренные — серым, как в инстаграме.
 */
export default function TeamStoriesBar() {
  const me = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [openAuthor, setOpenAuthor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: groups = [], isLoading } = useQuery<StoryGroup[]>({
    queryKey: FEED_KEY,
    queryFn: () => teamStoriesApi.feed(),
    staleTime: 60_000,
  })

  const createMut = useMutation({
    mutationFn: ({ file, duration }: { file: File; duration: number }) =>
      teamStoriesApi.create(file, '', duration),
    onSuccess: (story: any) => {
      // Убираем черновик и кладём настоящую сторис: у неё есть ключ медиа.
      qc.setQueryData<StoryGroup[]>(FEED_KEY, (gs) => (gs || []).map(g => ({
        ...g, stories: g.stories.filter(s => !s.pending),
      })).filter(g => g.stories.length > 0))
      addStory(qc, story, me?.id)
      toast.success('Сторис опубликована')
    },
    onError: (e: any) => {
      qc.setQueryData<StoryGroup[]>(FEED_KEY, (gs) => (gs || []).map(g => ({
        ...g, stories: g.stories.filter(s => !s.pending),
      })).filter(g => g.stories.length > 0))
      toast.error(e?.response?.data?.message || 'Не удалось опубликовать сторис')
    },
    onSettled: () => setBusy(false),
  })

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy(true)
    try {
      const isVideo = file.type.startsWith('video/')
      let toSend = file
      let duration = 0
      if (isVideo) {
        duration = await videoInfo(file)
        if (duration > MAX_VIDEO_SEC) {
          toast.error(`Видео ${duration} с — длиннее ${MAX_VIDEO_SEC} с. Обрежьте ролик.`)
          setBusy(false); return
        }
        if (file.size > MAX_VIDEO_BYTES) {
          toast.error(`Видео ${Math.round(file.size / 1024 / 1024)} МБ — тяжелее ${MAX_VIDEO_BYTES / 1024 / 1024} МБ.`)
          setBusy(false); return
        }
      } else {
        // Фото сжимаем тем же кодом, что аватарки: с телефона прилетают
        // мегабайты, и без этого загрузка была бы долгой.
        const { blob } = await compressImage(file, {
          maxSide: STORY_MAX_SIDE, targetBytes: STORY_TARGET_BYTES,
        })
        toSend = new File([blob], 'story.jpg', { type: 'image/jpeg' })
      }

      // Черновик в ленте — кружок появляется сразу, ещё до ответа сервера.
      addStory(qc, {
        id: `tmp-${Date.now()}`,
        authorId: me!.id,
        authorName: me?.name || 'Вы',
        authorAvatar: (me as any)?.avatar || null,
        kind: isVideo ? 'video' : 'photo',
        caption: '',
        mediaKey: '',
        mediaMime: toSend.type,
        durationSec: duration,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        viewsCount: 0, commentsCount: 0, reactions: {}, myReaction: null,
        seen: true, pending: true,
      } as any, me?.id)

      createMut.mutate({ file: toSend, duration })
    } catch (err: any) {
      setBusy(false)
      toast.error(err?.message || 'Не удалось прочитать файл')
    }
  }

  if (isLoading && groups.length === 0) return null

  return (
    <div className="card py-3">
      <div className="flex items-center gap-3 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Своя кнопка «выложить» — всегда первой */}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex flex-col items-center gap-1 shrink-0 w-[72px] group disabled:opacity-60"
          title="Выложить сторис">
          <span className="relative w-14 h-14 rounded-full flex items-center justify-center bg-surface-100 dark:bg-surface-700 border-2 border-dashed border-surface-300 dark:border-surface-600 group-hover:border-primary-500 transition-colors">
            {busy ? <Loader2 size={18} className="animate-spin text-primary-600" />
              : <Plus size={20} className="text-surface-500 group-hover:text-primary-600" />}
          </span>
          <span className="text-[11px] text-surface-500 dark:text-surface-400 truncate w-full text-center">
            Выложить
          </span>
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={pick}
          accept="image/*,.heic,.heif,video/mp4,video/webm,video/quicktime" />

        {groups.map(g => (
          <button key={g.authorId} type="button" onClick={() => setOpenAuthor(g.authorId)}
            className="flex flex-col items-center gap-1 shrink-0 w-[72px]"
            title={`Сторис: ${g.authorName}`}>
            {/* Кольцо — признак непросмотренного, как в инстаграме */}
            <span className={clsx('rounded-full p-[2px]',
              g.hasUnseen
                ? 'bg-gradient-to-tr from-amber-400 via-pink-500 to-violet-600'
                : 'bg-surface-200 dark:bg-surface-700')}>
              <span className="block rounded-full p-[2px] bg-surface-50 dark:bg-surface-800">
                <Avatar name={g.authorName} src={g.authorAvatar || undefined} size={48} zoomable={false} />
              </span>
            </span>
            <span className="text-[11px] text-surface-600 dark:text-surface-300 truncate w-full text-center">
              {g.authorId === me?.id ? 'Вы' : g.authorName.split(' ')[0]}
            </span>
          </button>
        ))}

        {groups.length === 0 && (
          <p className="text-xs text-surface-400 dark:text-surface-500 pl-1">
            Пока никто не выкладывал сторис — будьте первым.
          </p>
        )}
      </div>

      {openAuthor && (
        <Suspense fallback={null}>
          <StoryViewer groups={groups} startAuthorId={openAuthor} onClose={() => setOpenAuthor(null)} />
        </Suspense>
      )}
    </div>
  )
}
