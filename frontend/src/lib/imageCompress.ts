/**
 * Сжатие картинок перед отправкой на сервер.
 *
 * Сжимаем именно в браузере: на бэкенде нет sharp, а гнать 12-мегапиксельное
 * фото с телефона в базу нельзя — раньше такая загрузка отваливалась с
 * «File too large», и человек видел только «Ошибка загрузки».
 *
 * Побочная польза — формат. Что бы человек ни выбрал, на сервер уходит
 * обычный JPEG, поэтому формат исходника значения не имеет. HEIC со
 * съёмки айфонов и маков Chrome и Firefox сами не читают — для них
 * подключается декодер, но только если файл действительно HEIC:
 * библиотека весит около 3 МБ и грузится по требованию.
 */

/** Если качества не хватило, уменьшаем и саму картинку: шумное фото с
 *  телефона не влезает в лимит даже на качестве 0.35. */
const SCALE_STEPS = [1, 0.75, 0.55, 0.4]
const QUALITY_STEPS = [0.82, 0.7, 0.58, 0.45, 0.35]

type Loaded = { image: CanvasImageSource; width: number; height: number; dispose: () => void }

/** Похож ли файл на HEIC/HEIF. Смотрим и расширение, и тип: Windows часто
 *  отдаёт такой файл с пустым type, а Safari — с image/heic. */
function looksLikeHeic(file: File): boolean {
  const name = (file.name || '').toLowerCase()
  return /\.(heic|heif)$/.test(name) || /^image\/hei[cf]/.test(file.type || '')
}

/** Декодируем HEIC отдельной библиотекой. Импорт динамический: три мегабайта
 *  не должны попадать в основной бандл ради формата, который встречается у
 *  части сотрудников. */
async function decodeHeic(file: File): Promise<Loaded> {
  const { heicTo } = await import('heic-to')
  const bmp = await heicTo({ blob: file, type: 'bitmap' })
  return { image: bmp, width: bmp.width, height: bmp.height, dispose: () => bmp.close?.() }
}

/** Читаем картинку. createImageBitmap быстрее и не держит DOM-узел, но есть
 *  не везде (старые Safari) — тогда падаем на обычный <img>. */
async function loadImage(file: File): Promise<Loaded> {
  // HEIC проверяем первым: встроенные декодеры на нём молча спотыкаются,
  // и без этой ветки человек получал бы «не удалось прочитать файл».
  if (looksLikeHeic(file)) {
    try {
      return await decodeHeic(file)
    } catch {
      // Не вышло — вдруг это Safari, который HEIC умеет сам.
    }
  }
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation: фотографии с телефона хранят поворот в EXIF.
      // Без этого портретный снимок после перекодирования ложится набок.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
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
      el.onerror = () => rej(new Error('Не удалось прочитать файл как изображение'))
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
    // Последняя попытка: файл мог оказаться HEIC без узнаваемого имени
    // и типа — например, скачанный из мессенджера.
    if (!looksLikeHeic(file)) {
      try {
        return await decodeHeic(file)
      } catch {
        // Значит, это действительно не картинка.
      }
    }
    throw e
  }
}

export interface CompressOptions {
  /** Максимальная сторона результата в пикселях. */
  maxSide: number
  /** Целевой вес готового файла в байтах. */
  targetBytes: number
}

/** Сжимает картинку в JPEG. Возвращает blob и пропорции ИСХОДНИКА
 *  (они не меняются от степени сжатия и нужны для показа фона). */
export async function compressImage(
  file: File,
  { maxSide, targetBytes }: CompressOptions,
): Promise<{ blob: Blob; ratio: number }> {
  const src = await loadImage(file)
  const fit = Math.min(1, maxSide / Math.max(src.width, src.height))
  const baseW = Math.max(1, Math.round(src.width * fit))
  const baseH = Math.max(1, Math.round(src.height * fit))
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
      // JPEG не умеет прозрачность: без заливки прозрачные места PNG
      // становятся чёрными. Белый фон выглядит как лист бумаги.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(src.image, 0, 0, w, h)
      for (const q of QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', q))
        if (!blob) continue
        last = blob
        if (blob.size <= targetBytes) return { blob, ratio }
      }
    }
  } finally {
    src.dispose()
  }
  if (last && last.size <= targetBytes) return { blob: last, ratio }
  throw new Error('Картинка слишком тяжёлая даже после сжатия — попробуйте другое фото')
}

/** Фотография сотрудника: показывается кружком максимум ~120 px, поэтому
 *  512 с запасом хватает и на экраны с высокой плотностью. Вес держим
 *  небольшим — картинка хранится в БД и ездит по сети при каждом показе. */
const AVATAR_MAX_SIDE = 512
const AVATAR_TARGET_BYTES = 200 * 1024

/** Готовит фотографию к отправке: обрезает по размеру, жмёт в JPEG.
 *  Имя файла делаем .jpg — сервер проверяет расширение. */
export async function prepareAvatar(file: File): Promise<File> {
  const { blob } = await compressImage(file, {
    maxSide: AVATAR_MAX_SIDE,
    targetBytes: AVATAR_TARGET_BYTES,
  })
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
}
