// «Импорт» кастинга (17.11.2026, docs/CASTING_SPEC.md §2): data.json и фото
// из артефакта одной кнопкой (можно выделить всю папку). Людей раскладываем
// по пачкам — человек со всеми своими фото в одном запросе, — поэтому
// обрыв посередине и повторный импорт ничего не путают: уже загруженных
// сервер пропускает.
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileJson, FolderOpen, Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { castingApi } from '@/services/casting.api'
import {
  IMPORT_MAX_BYTES, isImportImage, parseCastingData, planImport, plural, sumImportResults, type ImportEntry,
} from '@/lib/casting'
import type { CastingImportResult } from '@/types/casting'
import { CastingSheet, castingKeys, errorText } from './castingUi'

type Picked = { entries: ImportEntry[] | null; dataError: string | null; images: File[] }

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const filesRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ batch: number; batches: number; pct: number } | null>(null)
  const [result, setResult] = useState<(CastingImportResult & { failed?: string }) | null>(null)
  // Оборвалось посередине — «Продолжить» начинает с упавшей пачки.
  const [resume, setResume] = useState<{ next: number; results: CastingImportResult[] } | null>(null)

  // Выбор папки — атрибутом: в типах React его нет.
  useEffect(() => {
    dirRef.current?.setAttribute('webkitdirectory', '')
    dirRef.current?.setAttribute('directory', '')
  }, [])

  const onPick = async (list: FileList | null, input: HTMLInputElement | null) => {
    const files = Array.from(list || [])
    if (input) input.value = ''
    if (!files.length) return
    setResult(null)
    setResume(null)
    const json = files.find(f => f.name.toLowerCase() === 'data.json') || files.find(f => /\.json$/i.test(f.name))
    const images = files.filter(f => isImportImage(f.name))
    let entries: ImportEntry[] | null = null
    let dataError: string | null = null
    if (!json) dataError = 'Среди файлов нет data.json'
    else {
      try { entries = parseCastingData(await json.text()) } catch (e: any) { dataError = e?.message || 'data.json не читается' }
    }
    setPicked({ entries, dataError, images })
  }

  const plan = picked?.entries ? planImport(picked.entries, picked.images) : null

  const run = async () => {
    if (!plan || running) return
    setRunning(true)
    setResult(null)
    const start = resume?.next ?? 0
    const results: CastingImportResult[] = [...(resume?.results || [])]
    const left = plan.batches.slice(start)
    const totalBytes = left.reduce((s, b) => s + b.files.reduce((x, f) => x + f.size, 0), 0) || 1
    let doneBytes = 0
    let failed: string | undefined
    for (let i = start; i < plan.batches.length; i++) {
      const b = plan.batches[i]
      const size = b.files.reduce((x, f) => x + f.size, 0)
      setProgress({ batch: i + 1, batches: plan.batches.length, pct: Math.round((doneBytes / totalBytes) * 100) })
      try {
        const r = await castingApi.importBatch(b.entries, b.files, loaded => {
          setProgress({ batch: i + 1, batches: plan.batches.length, pct: Math.min(99, Math.round(((doneBytes + Math.min(loaded, size)) / totalBytes) * 100)) })
        })
        results.push(r)
      } catch (e) {
        failed = errorText(e, 'Сервер не принял файлы')
        setResume({ next: i, results })
        break
      }
      doneBytes += size
    }
    if (!failed) setResume(null)
    const sum = sumImportResults(results)
    // Чего не нашлось среди выбранных файлов — сервер об этом не узнает.
    for (const m of [...plan.missing, ...plan.tooBig]) if (!sum.missingPhotos.includes(m)) sum.missingPhotos.push(m)
    setResult({ ...sum, failed })
    setProgress(null)
    setRunning(false)
    qc.invalidateQueries({ queryKey: castingKeys.lists })
    qc.invalidateQueries({ queryKey: castingKeys.talents })
  }

  const btn = 'btn-secondary min-h-[44px] sm:min-h-[38px]'
  return (
    <CastingSheet title="Импорт кастинга" onClose={() => { if (!running) onClose() }}
      footer={(
        <div className="flex items-center gap-2 justify-end">
          <button type="button" className="btn-secondary min-h-[44px] sm:min-h-[34px]" disabled={running} onClick={onClose}>
            {result && !result.failed ? 'Готово' : 'Закрыть'}
          </button>
          {!(result && !result.failed) && (
            <button type="button" className="btn-primary min-h-[44px] sm:min-h-[34px]" disabled={!plan || running} onClick={run}>
              <Upload size={15} /> {running ? 'Загружаю…' : result?.failed ? 'Продолжить' : 'Загрузить'}
            </button>
          )}
        </div>
      )}>
      <div className="p-4 sm:p-5 space-y-4">
        <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
          Выберите <b>data.json</b> и фото из папки артефакта — всё одной кнопкой или папку целиком.
          Кто уже есть в базе, будет пропущен; недостающие фото к ним добавятся.
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={running} onClick={() => filesRef.current?.click()}>
            <FileJson size={16} /> Выбрать файлы
          </button>
          <button type="button" className={`${btn} hidden sm:inline-flex`} disabled={running} onClick={() => dirRef.current?.click()}>
            <FolderOpen size={16} /> Выбрать папку
          </button>
          <input ref={filesRef} type="file" multiple className="hidden"
            accept=".json,application/json,image/jpeg,image/png,image/webp"
            onChange={e => onPick(e.target.files, e.target)} />
          <input ref={dirRef} type="file" multiple className="hidden" onChange={e => onPick(e.target.files, e.target)} />
        </div>

        {picked && (
          <div className="rounded-xl border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700 text-sm">
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-28 shrink-0 text-surface-500">data.json</span>
              {picked.dataError
                ? <span className="text-red-600 dark:text-red-400 font-semibold">{picked.dataError}</span>
                : <span className="font-semibold text-surface-900 dark:text-surface-100">{picked.entries!.length} {plural(picked.entries!.length, 'человек', 'человека', 'человек')}</span>}
            </div>
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-28 shrink-0 text-surface-500">Фото</span>
              <span className="font-semibold text-surface-900 dark:text-surface-100">
                {plan ? `${plan.photoCount} к загрузке` : `${picked.images.length} выбрано`}
              </span>
            </div>
            {plan && (plan.missing.length > 0 || plan.tooBig.length > 0) && (
              <div className="px-3.5 py-2.5 text-[13px] text-amber-700 dark:text-amber-400 space-y-1">
                {plan.missing.length > 0 && <p>Не выбраны {plan.missing.length} {plural(plan.missing.length, 'фото', 'фото', 'фото')} из data.json: {short(plan.missing)}</p>}
                {plan.tooBig.length > 0 && <p>Тяжелее {Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} МБ, пропустим: {short(plan.tooBig)}</p>}
              </div>
            )}
          </div>
        )}

        {progress && (
          <div aria-live="polite">
            <div className="flex justify-between text-[13px] text-surface-500 mb-1.5">
              <span>{progress.batches > 1 ? `Часть ${progress.batch} из ${progress.batches}` : 'Загрузка'}</span>
              <span className="tabular-nums">{progress.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
              <div className="h-full bg-primary-600 dark:bg-primary-300 transition-[width] duration-200" style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}

        {result && (
          <div role="status" className="rounded-xl border border-surface-200 dark:border-surface-700 px-3.5 py-3 space-y-1.5">
            <p className="flex items-center gap-2 font-semibold text-surface-900 dark:text-surface-100">
              {result.failed ? <AlertTriangle size={17} className="text-amber-500" /> : <CheckCircle2 size={17} className="text-green-500" />}
              Создано {result.created}, пропущено {result.skipped}, фото {result.photos}
            </p>
            {result.failed && (
              <p className="text-[13px] text-red-600 dark:text-red-400">Остановились: {result.failed}. Нажмите «Продолжить» — загрузка пойдёт с места остановки.</p>
            )}
            {result.missingPhotos.length > 0 && (
              <p className="text-[13px] text-surface-500">Без файла: {short(result.missingPhotos, 8)}</p>
            )}
          </div>
        )}
      </div>
    </CastingSheet>
  )
}

function short(list: string[], n = 5): string {
  return list.length > n ? `${list.slice(0, n).join(', ')} и ещё ${list.length - n}` : list.join(', ')
}
