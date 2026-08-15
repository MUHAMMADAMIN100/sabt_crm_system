import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Upload, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { usersApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useWallpaperStore, syncWallpaperFromServer, canUseWallpaper, veilOf } from '@/lib/wallpaper'

/** До какого размера ужимаем картинку перед отправкой. 1920 хватает на
 *  любой монитор, а вес держим в пределах, которые примет сервер: он режет
 *  на 700 КБ ПОСЛЕ base64-кодирования, а оно раздувает данные примерно на
 *  треть — отсюда 480 КБ бинарных с запасом. */
const MAX_SIDE = 1920
const TARGET_BYTES = 480 * 1024
/** Если качества не хватило, уменьшаем и саму картинку. Шумное фото с
 *  телефона не влезает даже на качестве 0.35, и раньше уходило на сервер
 *  как есть — тот отвечал «слишком большая», и фон просто не ставился. */
const SCALE_STEPS = [1, 0.75, 0.55, 0.4]
const QUALITY_STEPS = [0.82, 0.7, 0.58, 0.45, 0.35]

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
 *  с телефона в базу нельзя. Возвращает JPEG-blob нужного веса и пропорции
 *  картинки — по ним считается масштаб («Размер»). */
async function compress(file: File): Promise<{ blob: Blob; ratio: number }> {
  const src = await loadImage(file)
  const fit = Math.min(1, MAX_SIDE / Math.max(src.width, src.height))
  const baseW = Math.max(1, Math.round(src.width * fit))
  const baseH = Math.max(1, Math.round(src.height * fit))
  // Пропорции берём у исходника: они не меняются от того, насколько сильно
  // мы ужали картинку, а по ним считается «Размер» на экране.
  const ratio = Math.round((baseW / baseH) * 1000) / 1000

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) { src.dispose(); throw new Error('Браузер не дал холст для сжатия картинки') }

  let last: Blob | null = null
  try {
    // Сначала снижаем качество, и только если этого мало — уменьшаем саму
    // картинку. Так фото 12 Мп с шумом всё равно укладывается в лимит.
    for (const s of SCALE_STEPS) {
      const w = Math.max(1, Math.round(baseW * s))
      const h = Math.max(1, Math.round(baseH * s))
      canvas.width = w
      canvas.height = h
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(src.image as CanvasImageSource, 0, 0, w, h)
      for (const q of QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q))
        if (!blob) continue
        last = blob
        if (blob.size <= TARGET_BYTES) return { blob, ratio }
      }
    }
  } finally {
    src.dispose()
  }
  // Сюда попадаем, только если даже 40 % размера на качестве 0.35 не влезли —
  // на практике недостижимо, но отдавать заведомо отвергаемый файл нельзя.
  if (last && last.size <= TARGET_BYTES) return { blob: last, ratio }
  throw new Error('Картинка слишком тяжёлая даже после сжатия — попробуйте другое фото')
}

export default function WallpaperSection() {
  const user = useAuthStore(s => s.user)
  const image = useWallpaperStore(s => s.image)
  const view = useWallpaperStore(s => s.view)
  const preview = useWallpaperStore(s => s.preview)
  const commit = useWallpaperStore(s => s.commit)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | null>(null)
  const pending = useRef<{ dim?: number; scale?: number }>({})
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 16, h: 9 })

  const allowed = canUseWallpaper(user)

  // Точка синхронизации с сервером: фон могли поставить с другого устройства,
  // а на каждом F5 качать сотни килобайт незачем — обновляем здесь.
  useEffect(() => {
    if (!allowed) return
    usersApi.getMyBackground()
      .then(r => syncWallpaperFromServer(r?.image, r))
      .catch(() => { /* не критично: работаем с тем, что есть */ })
  }, [allowed])

  // Превью должно показывать масштаб честно, а «заполнить экран» зависит от
  // пропорций окна — поэтому меряем саму карточку превью, а не гадаем.
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth || 16, h: el.offsetHeight || 9 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [image])

  if (!allowed) return null

  const veilAlpha = (view.dim / 100).toFixed(2)
  // Ширина картинки при «заполнить» — в процентах от ширины превью.
  const previewCoverPercent = Math.max(100, (box.h / box.w) * (view.ratio || 1) * 100)

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
      const { blob, ratio } = await compress(file)
      const res = await usersApi.uploadMyBackground(blob, { dim: view.dim, scale: view.scale, ratio })
      syncWallpaperFromServer(res?.image, res)
      toast.success('Фон установлен')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Не удалось загрузить фон')
    } finally {
      setBusy(false)
      reset()
    }
  }

  /** Ползунки: показываем сразу, а сохраняем через паузу после последнего
   *  движения. Ловить mouseup нельзя — если кнопку отпустили за пределами
   *  ползунка, событие до него не дойдёт и настройка молча не сохранится.
   *
   *  Правки НАКАПЛИВАЕМ: таймер у двух ползунков общий, и если подвинуть
   *  затемнение, а следом за те же 400 мс — размер, то без накопления на
   *  сервер ушёл бы только размер, а затемнение осталось бы лишь на экране
   *  до перезахода. */
  const onSlide = (patch: { dim?: number; scale?: number }) => {
    preview(patch)
    pending.current = { ...pending.current, ...patch }
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const merged = pending.current
      pending.current = {}
      commit(merged)
      usersApi.setMyBackgroundView(merged)
        .catch(() => toast.error('Настройка не сохранилась — действует до перезахода'))
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
          ref={boxRef}
          className="h-32 rounded-xl border border-surface-200 dark:border-surface-700 mb-3 bg-surface-100 dark:bg-surface-900"
          style={{
            // Плёнка — тем же токеном, что и на экране: иначе в тёмной теме
            // превью осветляло бы картинку, пока экран её затемняет.
            backgroundImage: `${veilOf(veilAlpha)}, url("${image}")`,
            // Превью показывает и масштаб: иначе ползунок «Размер» пришлось бы
            // проверять, глядя мимо карточки на весь экран.
            backgroundSize: `100% 100%, ${view.scale === 100 || !view.ratio
              ? 'cover'
              : `${Math.round(previewCoverPercent * view.scale / 100)}% auto`}`,
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
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
        <>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <label className="label text-xs mb-0">Затемнение</label>
              <span className="text-xs text-surface-500 dark:text-surface-400">{view.dim}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={view.dim}
              onChange={e => onSlide({ dim: Number(e.target.value) })}
              className="w-full accent-primary-600"
            />
            <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
              Чем больше затемнение, тем спокойнее фон и тем лучше читаются таблицы.
            </p>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <label className="label text-xs mb-0">Размер</label>
              <span className="text-xs text-surface-500 dark:text-surface-400">{view.scale}%</span>
            </div>
            <input
              type="range"
              min={30}
              max={200}
              step={5}
              value={view.scale}
              onChange={e => onSlide({ scale: Number(e.target.value) })}
              className="w-full accent-primary-600"
            />
            <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
              100% — картинка заполняет экран. Меньше — уменьшается и вокруг остаётся фон темы
              (логотип не обрежется). Больше — приближается.
            </p>
            {view.scale !== 100 && !view.ratio && (
              <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
                Для этой картинки размер не применится — загрузите её заново.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
