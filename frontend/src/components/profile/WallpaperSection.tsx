import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Upload, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { usersApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useWallpaperStore, syncWallpaperFromServer, canUseWallpaper } from '@/lib/wallpaper'

/** До какого размера ужимаем картинку перед отправкой. 1920 хватает на
 *  любой монитор, а вес держим в пределах, которые примет сервер (700 КБ
 *  в base64 ≈ 520 КБ бинарных). */
const MAX_SIDE = 1920
const TARGET_BYTES = 480 * 1024

/** Читаем картинку. createImageBitmap быстрее и не держит DOM-узел, но есть
 *  не везде (старые Safari) — тогда падаем на обычный <img>. */
async function loadImage(file: File): Promise<{ image: unknown; width: number; height: number; dispose: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { image: bmp, width: bmp.width, height: bmp.height, dispose: () => bmp.close?.() }
    } catch {
      // Битый файл или неподдерживаемый формат — пробуем через <img>,
      // он даст внятную ошибку onerror.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image()
      el.onload = () => res(el)
      el.onerror = () => rej(new Error('Файл не похож на картинку'))
      el.src = url
    })
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/** Сжимаем на клиенте: sharp на бэкенде нет, а гнать 12-мегапиксельное фото
 *  с телефона в базу нельзя. Возвращает JPEG-blob нужного веса. */
async function compress(file: File): Promise<Blob> {
  const src = await loadImage(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не дал холст для сжатия картинки')
  ctx.drawImage(src.image as CanvasImageSource, 0, 0, w, h)
  src.dispose()

  const toBlob = (q: number) => new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q))
  // Понижаем качество, пока не уложимся в лимит: одного прохода мало —
  // фото с детализацией и на 0.8 бывает под мегабайт.
  for (const q of [0.82, 0.7, 0.58, 0.45, 0.35]) {
    const blob = await toBlob(q)
    if (blob && blob.size <= TARGET_BYTES) return blob
    if (q === 0.35 && blob) return blob
  }
  throw new Error('Не удалось сжать картинку')
}

export default function WallpaperSection() {
  const user = useAuthStore(s => s.user)
  const image = useWallpaperStore(s => s.image)
  const dim = useWallpaperStore(s => s.dim)
  const previewDim = useWallpaperStore(s => s.previewDim)
  const commitDim = useWallpaperStore(s => s.commitDim)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dimTimer = useRef<number | null>(null)

  const allowed = canUseWallpaper(user)

  // Точка синхронизации с сервером: фон могли поставить с другого устройства,
  // а на каждом F5 качать сотни килобайт незачем — обновляем здесь.
  useEffect(() => {
    if (!allowed) return
    usersApi.getMyBackground()
      .then(r => syncWallpaperFromServer(r?.image, r?.dim))
      .catch(() => { /* не критично: работаем с тем, что есть */ })
  }, [allowed])

  if (!allowed) return null

  const pick = async (file?: File | null) => {
    // Сбрасываем input всегда: иначе повторный выбор ТОГО ЖЕ файла после
    // ошибки не вызовет change и кнопка будет выглядеть сломанной.
    const reset = () => { if (fileRef.current) fileRef.current.value = '' }
    if (!file) { reset(); return }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error('Только JPG, PNG или WEBP')
      reset()
      return
    }
    setBusy(true)
    try {
      const blob = await compress(file)
      const res = await usersApi.uploadMyBackground(blob, dim)
      syncWallpaperFromServer(res?.image, res?.dim)
      toast.success('Фон установлен')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Не удалось загрузить фон')
    } finally {
      setBusy(false)
      reset()
    }
  }

  /** Ползунок: показываем сразу, а сохраняем через паузу после последнего
   *  движения. Ловить mouseup нельзя — если кнопку отпустили за пределами
   *  ползунка, событие до него не дойдёт и настройка молча не сохранится. */
  const onDim = (value: number) => {
    previewDim(value)
    if (dimTimer.current) window.clearTimeout(dimTimer.current)
    dimTimer.current = window.setTimeout(() => {
      commitDim(value)
      usersApi.setMyBackgroundDim(value)
        .catch(() => toast.error('Затемнение не сохранилось — действует до перезахода'))
    }, 400)
  }

  const remove = async () => {
    setBusy(true)
    try {
      await usersApi.clearMyBackground()
      useWallpaperStore.getState().clear()
      toast.success('Фон убран')
    } catch {
      toast.error('Не удалось убрать фон')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-primary-600 dark:text-primary-400" />
          <h3 className="section-title">Фон интерфейса</h3>
        </div>
        {image && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 disabled:opacity-50"
          >
            <Trash2 size={13} /> Убрать фон
          </button>
        )}
      </div>
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
        Своя картинка на фоне всей системы. Видите её только вы — на других сотрудников не влияет.
        Картинка хранится в базе, поэтому не пропадает при обновлениях.
      </p>

      {image ? (
        <div
          className="h-32 rounded-xl border border-surface-200 dark:border-surface-700 mb-3 bg-center bg-cover"
          style={{
            backgroundImage: `linear-gradient(rgb(var(--surf-100) / ${(dim / 100).toFixed(2)}), rgb(var(--surf-100) / ${(dim / 100).toFixed(2)})), url("${image}")`,
          }}
        />
      ) : (
        <div className="h-32 rounded-xl border border-dashed border-surface-300 dark:border-surface-600 mb-3 flex items-center justify-center text-xs text-surface-400 dark:text-surface-500">
          Фон не выбран
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={e => pick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="btn-secondary text-sm inline-flex items-center gap-2 disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {image ? 'Заменить картинку' : 'Загрузить картинку'}
      </button>

      {image && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <label className="label text-xs mb-0">Затемнение</label>
            <span className="text-xs text-surface-500 dark:text-surface-400">{dim}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={dim}
            onChange={e => onDim(Number(e.target.value))}
            className="w-full accent-primary-600"
          />
          <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
            Чем больше затемнение, тем спокойнее фон и тем лучше читаются таблицы.
          </p>
        </div>
      )}
    </div>
  )
}
