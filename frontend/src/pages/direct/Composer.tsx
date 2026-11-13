import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import {
  Camera, CornerUpLeft, ExternalLink, FileText, Film, Image as ImageIcon, Lock, Mic, Paperclip, Plus, Send, Settings2, Smile, Square,
  StickyNote, Trash2, X, Zap,
} from 'lucide-react'
import { directApi, type DirectMessage, type DirectPerson, type DirectTemplate } from '@/services/direct.api'
import { useAuthStore } from '@/store/auth.store'
import { compressImage } from '@/lib/imageCompress'
import EmojiPicker from './EmojiPicker'
import TemplatesManager, { fillTemplate } from './TemplatesManager'
import { getDraft, setDraft, type DraftMode } from './drafts'
import { isTopUser } from './directAccess'
import { useMedia } from './useMedia'

const MAX_CHARS = 4000
const MAX_VOICE_S = 300
const MAX_FILES = 10
const MB = 1024 * 1024
const encoder = new TextEncoder()

/** Что принимает Instagram и сколько весит самое большее. */
const FILE_RULES: Record<string, { max: number; kind: 'image' | 'video' | 'file' }> = {
  jpg: { max: 8 * MB, kind: 'image' },
  jpeg: { max: 8 * MB, kind: 'image' },
  png: { max: 8 * MB, kind: 'image' },
  mp4: { max: 25 * MB, kind: 'video' },
  mov: { max: 25 * MB, kind: 'video' },
  pdf: { max: 25 * MB, kind: 'file' },
}
const TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
}
/** Фото, которые Instagram не примет как есть, но их можно перевести в JPEG. */
const CONVERTIBLE = new Set(['heic', 'heif', 'webp'])
const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,.webp,.pdf,.mp4,.mov,image/jpeg,image/png,image/heic,image/webp,application/pdf,video/mp4,video/quicktime'

const extOf = (f: File) => {
  const fromName = (f.name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1]
  return fromName && (FILE_RULES[fromName] || CONVERTIBLE.has(fromName)) ? fromName : TYPE_EXT[f.type] || fromName || ''
}

/** Файл к отправке: HEIC/WEBP и слишком тяжёлые фото переводим в JPEG до 8 МБ,
 *  у вставленного из буфера скриншота появляется понятное имя. */
async function prepareFile(f: File): Promise<File> {
  const ext = extOf(f)
  const base = (f.name || '').replace(/\.[^.]+$/, '') || `Снимок ${new Date().toLocaleString('ru-RU').replace(/[/:]/g, '-')}`
  const isPhoto = ext === 'jpg' || ext === 'jpeg' || ext === 'png'
  if (CONVERTIBLE.has(ext) || (isPhoto && f.size > 8 * MB)) {
    const { blob } = await compressImage(f, { maxSide: 2560, targetBytes: 7.5 * MB })
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  }
  // Скриншот из буфера приходит как «image.png» или вовсе без имени.
  if (!/\.[a-z0-9]{2,5}$/i.test(f.name || '') && ext) return new File([f], `${base}.${ext}`, { type: f.type })
  return f
}

type Mode = DraftMode
type Attached = { id: string; file: File; preview: string | null; kind: 'image' | 'video' | 'file' }
type Picker =
  | { kind: 'templates'; query: string; source: 'slash' | 'button' }
  | { kind: 'mentions'; query: string; start: number }

export interface ComposerHandle {
  /** Файлы, перетащенные в чат. */
  addFiles: (files: File[]) => void
  focus: () => void
}

let seq = 0
const nextId = () => `att-${Date.now()}-${++seq}`

/** Поле ответа: текст, фото/видео/PDF, голосовое, шаблоны, эмодзи, цитата;
 *  режим «Заметка для команды» с @упоминаниями. */
const Composer = forwardRef<ComposerHandle, {
  conversationId: string
  /** Почему писать клиенту сейчас нельзя (окно 24 часов, нет подключения). Заметки можно всегда. */
  blockedReason: string | null
  /** Чат ведёт другой менеджер: клиенту не пишем, остаются заметки. */
  readOnlyReason?: string | null
  igLink: string
  /** Имя клиента — для {имя} в шаблонах. */
  contactName: string | null
  /** Ответ на это сообщение (цитата). */
  replyTo: DirectMessage | null
  onCancelReply: () => void
  onSendText: (text: string) => void
  onSendFiles: (files: File[], text: string) => void
  onSendVoice: (blob: Blob) => void
  onAddNote: (text: string, mentions: string[]) => void
  /** Кого можно упомянуть в заметке. */
  team: DirectPerson[]
}>(function Composer({
  conversationId, blockedReason, readOnlyReason, igLink, contactName, replyTo, onCancelReply,
  onSendText, onSendFiles, onSendVoice, onAddNote, team,
}, ref) {
  const user = useAuthStore(s => s.user)
  const top = isTopUser(user)
  const roomy = useMedia('(min-width: 640px)')
  // Телефон — поле как в Instagram (13.11.2026).
  const phone = !roomy
  const [plusOpen, setPlusOpen] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const plusBox = useRef<HTMLDivElement>(null)
  /** Голосовое удержанием: где начали, отпустили ли, отменили ли свайпом. */
  const hold = useRef<{ x: number; started: number; released: boolean; cancelled: boolean } | null>(null)
  const initial = useMemo(() => getDraft(user?.id, conversationId), [user?.id, conversationId])
  const [chosen, setMode] = useState<Mode>(initial?.mode ?? 'message')
  // Чужой закреплённый чат — только заметки.
  const mode: Mode = readOnlyReason ? 'note' : chosen
  const [text, setText] = useState(initial?.text ?? '')
  const [files, setFiles] = useState<Attached[]>([])
  const [preparing, setPreparing] = useState(0)
  const [recording, setRecording] = useState<{ started: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [pickIndex, setPickIndex] = useState(0)
  const [pickerSearch, setPickerSearch] = useState('')
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [manageTemplates, setManageTemplates] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; cancel: boolean } | null>(null)
  const lastTyping = useRef(0)
  const filesRef = useRef(files)
  filesRef.current = files

  const blocked = mode === 'message' && !!blockedReason

  const { data: templates } = useQuery({ queryKey: ['direct', 'templates'], queryFn: directApi.templates, staleTime: 5 * 60_000 })

  // Черновик: сохраняем, пока сотрудник печатает; при уходе из чата — сразу.
  const latest = useRef({ text, mode })
  latest.current = { text, mode }
  useEffect(() => {
    const t = setTimeout(() => setDraft(user?.id, conversationId, { text, mode }), 300)
    return () => clearTimeout(t)
  }, [text, mode, user?.id, conversationId])
  useEffect(() => () => {
    setDraft(user?.id, conversationId, latest.current)
    filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
    stopRecording(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Чат стал чужим посреди записи — запись отменяем: отправить её уже нельзя.
  useEffect(() => {
    if (readOnlyReason) stopRecording(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnlyReason])

  // Нажали «Ответить» на сообщении — режим ответа клиенту и курсор в поле.
  useEffect(() => {
    if (!replyTo) return
    setMode('message')
    requestAnimationFrame(() => area.current?.focus())
  }, [replyTo])

  // Поле растёт вместе с текстом, до шести строк.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - recording.started) / 1000)
      setElapsed(s)
      if (s >= MAX_VOICE_S) stopRecording(false)
    }, 250)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  // ─── Подсказки: шаблоны и упоминания ─────────────────────────────
  const recomputePicker = (value: string, caret: number) => {
    if (dismissedAt !== null && dismissedAt === value) return
    if (picker?.kind === 'templates' && picker.source === 'button') return
    if (mode === 'message' && /^\/[^\n]*$/.test(value)) {
      setPicker({ kind: 'templates', query: value.slice(1), source: 'slash' })
      return
    }
    if (mode === 'note') {
      // «@Тест Р» — имя и первые буквы фамилии: одно слово через пробел тоже часть запроса.
      const m = value.slice(0, caret).match(/(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/)
      if (m && team.some(p => mentionMatches(p.name, m[2]))) {
        setPicker({ kind: 'mentions', query: m[2], start: caret - m[2].length - 1 })
        return
      }
    }
    if (picker) setPicker(null)
  }

  const templateItems = useMemo(() => {
    if (picker?.kind !== 'templates') return []
    const q = (picker.source === 'button' ? pickerSearch : picker.query).trim().toLowerCase()
    const all = templates ?? []
    return q ? all.filter(t => t.title.toLowerCase().includes(q) || t.text.toLowerCase().includes(q)) : all
  }, [picker, pickerSearch, templates])

  const mentionItems = useMemo(() => {
    if (picker?.kind !== 'mentions') return []
    return team.filter(p => p.id !== user?.id && mentionMatches(p.name, picker.query)).slice(0, 6)
  }, [picker, team, user?.id])

  const itemsCount = picker?.kind === 'templates' ? templateItems.length : picker?.kind === 'mentions' ? mentionItems.length : 0
  useEffect(() => { setPickIndex(0) }, [picker?.kind, (picker as any)?.query, pickerSearch])

  const closePicker = () => {
    setDismissedAt(text)
    setPicker(null)
    setPickerSearch('')
  }

  const placeCaret = (pos: number) => requestAnimationFrame(() => {
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
  })

  const insertTemplate = (t: DirectTemplate) => {
    const filled = fillTemplate(t.text, { client: contactName, manager: user?.name })
    if (picker?.kind === 'templates' && picker.source === 'slash') {
      setText(filled)
      placeCaret(filled.length)
    } else {
      const el = area.current
      const start = el?.selectionStart ?? text.length
      const end = el?.selectionEnd ?? text.length
      const next = text.slice(0, start) + filled + text.slice(end)
      setText(next.slice(0, MAX_CHARS))
      placeCaret(Math.min(start + filled.length, MAX_CHARS))
    }
    setPicker(null)
    setPickerSearch('')
    setDismissedAt(null)
  }

  const insertMention = (p: DirectPerson) => {
    if (picker?.kind !== 'mentions') return
    const caret = area.current?.selectionStart ?? text.length
    const insert = `@${p.name} `
    const next = text.slice(0, picker.start) + insert + text.slice(caret)
    setText(next)
    setPicker(null)
    placeCaret(picker.start + insert.length)
  }

  const pickCurrent = () => {
    if (picker?.kind === 'templates' && templateItems[pickIndex]) insertTemplate(templateItems[pickIndex])
    else if (picker?.kind === 'mentions' && mentionItems[pickIndex]) insertMention(mentionItems[pickIndex])
  }

  /** Стрелки, Enter/Tab, Esc в открытой подсказке. true — клавиша обработана. */
  const pickerKey = (e: ReactKeyboardEvent) => {
    if (!picker) return false
    // Пустая подсказка стрелки не забирает: курсор ходит по тексту как обычно.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && itemsCount) {
      e.preventDefault()
      setPickIndex(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + itemsCount) % itemsCount)
      return true
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && itemsCount) {
      e.preventDefault()
      pickCurrent()
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closePicker()
      area.current?.focus()
      return true
    }
    return false
  }

  // ─── Файлы ───────────────────────────────────────────────────────
  const addFiles = useCallback(async (list: File[]) => {
    if (!list.length) return
    if (readOnlyReason) { toast.error('В этом чате клиенту отвечает закреплённый менеджер'); return }
    if (blockedReason) { toast.error(blockedReason); return }
    const room = MAX_FILES - filesRef.current.length
    if (room <= 0) { toast.error(`За раз — не больше ${MAX_FILES} файлов`); return }
    if (list.length > room) toast.error(`За раз — не больше ${MAX_FILES} файлов: лишние не добавлены`)
    setMode('message')
    setPreparing(n => n + 1)
    try {
      const ready: Attached[] = []
      for (const raw of list.slice(0, room)) {
        const ext = extOf(raw)
        if (ext === 'gif') { toast.error(`${raw.name}: GIF Instagram не примет — отправьте JPG, PNG или видео`); continue }
        if (!FILE_RULES[ext] && !CONVERTIBLE.has(ext)) {
          toast.error(`${raw.name || 'Файл'}: Instagram принимает фото JPG и PNG, видео MP4 и MOV и документы PDF`)
          continue
        }
        let file: File
        try {
          file = await prepareFile(raw)
        } catch (e: any) {
          toast.error(`${raw.name || 'Фото'}: ${e?.message || 'не удалось подготовить'}`)
          continue
        }
        const rule = FILE_RULES[extOf(file)]
        if (!rule) { toast.error(`${raw.name}: такой файл Instagram не примет`); continue }
        if (file.size > rule.max) {
          toast.error(`${file.name}: ${rule.kind === 'video' ? 'видео' : 'PDF'} больше ${Math.round(rule.max / MB)} МБ — Instagram его не примет`)
          continue
        }
        ready.push({ id: nextId(), file, kind: rule.kind, preview: rule.kind === 'file' ? null : URL.createObjectURL(file) })
      }
      if (ready.length) setFiles(prev => [...prev, ...ready].slice(0, MAX_FILES))
    } finally {
      setPreparing(n => n - 1)
      area.current?.focus()
    }
  }, [readOnlyReason, blockedReason])

  const removeFile = (id: string) => setFiles(prev => {
    prev.filter(f => f.id === id).forEach(f => f.preview && URL.revokeObjectURL(f.preview))
    return prev.filter(f => f.id !== id)
  })

  useImperativeHandle(ref, () => ({
    addFiles: (list: File[]) => { void addFiles(list) },
    focus: () => area.current?.focus(),
  }), [addFiles])

  // ─── Отправка ────────────────────────────────────────────────────
  function submit() {
    const value = text.trim()
    if (mode === 'note') {
      if (!value) return
      const mentions = team.filter(p => p.id !== user?.id && value.includes(`@${p.name}`)).map(p => p.id)
      setText('')
      setDraft(user?.id, conversationId, null)
      onAddNote(value, mentions)
      area.current?.focus()
      return
    }
    if (blocked || preparing || (!value && !files.length)) return
    const sending = files
    setText('')
    setFiles([])
    setDraft(user?.id, conversationId, null)
    if (sending.length) {
      onSendFiles(sending.map(f => f.file), value)
      sending.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
    } else {
      onSendText(value)
    }
    area.current?.focus()
  }

  const onChange = (value: string, caret: number) => {
    setText(value)
    if (dismissedAt !== null && dismissedAt !== value) setDismissedAt(null)
    recomputePicker(value, caret)
    // «Печатает…» у клиента — не чаще раза в 6 секунд.
    if (mode === 'message' && !blockedReason && !readOnlyReason && value.trim() && Date.now() - lastTyping.current > 6000) {
      lastTyping.current = Date.now()
      directApi.typing(conversationId).catch(() => {})
    }
  }

  const insertAtCaret = (s: string) => {
    const el = area.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = (text.slice(0, start) + s + text.slice(end)).slice(0, MAX_CHARS)
    setText(next)
    placeCaret(Math.min(start + s.length, next.length))
  }

  // ─── Голосовое ───────────────────────────────────────────────────
  async function startRecording(): Promise<boolean> {
    if (blocked || recording || mode !== 'message') return false
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Этот браузер не умеет записывать голос'); return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
        .find(t => (MediaRecorder as any).isTypeSupported?.(t))
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const state = { rec, stream, chunks: [] as Blob[], cancel: false }
      rec.ondataavailable = e => { if (e.data.size) state.chunks.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        if (state.cancel) return
        const blob = new Blob(state.chunks, { type: rec.mimeType || mime || 'audio/webm' })
        if (blob.size < 1200) { toast.error('Запись слишком короткая'); return }
        onSendVoice(blob)
      }
      recorder.current = state
      rec.start(250)
      setElapsed(0)
      setRecording({ started: Date.now() })
      return true
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
      toast.error(denied ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Микрофон не найден')
      return false
    }
  }

  // ─── Голосовое удержанием (телефон): держишь — запись, отпустил —
  // отправилось, увёл палец влево — отмена. ─────────────────────────
  const micDown = async (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (blocked || recording) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* не страшно */ }
    hold.current = { x: e.clientX, started: Date.now(), released: false, cancelled: false }
    const ok = await startRecording()
    // Палец отпустили, пока браузер спрашивал разрешение на микрофон.
    if (ok && hold.current?.released) {
      stopRecording(true)
      toast('Удерживайте микрофон, пока говорите')
    }
  }
  const micMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const h = hold.current
    if (!h || h.cancelled || !recorder.current) return
    if (e.clientX - h.x < -70) {
      h.cancelled = true
      stopRecording(true)
      toast('Запись отменена')
    }
  }
  const micUp = () => {
    const h = hold.current
    if (!h) return
    h.released = true
    if (h.cancelled || !recorder.current) return
    if (Date.now() - h.started < 700) {
      stopRecording(true)
      toast('Удерживайте микрофон, пока говорите')
    } else {
      stopRecording(false)
    }
  }

  // Меню «+» закрывается касанием мимо.
  useEffect(() => {
    if (!plusOpen) return
    const onDown = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('[data-plus-toggle]')) return
      if (plusBox.current && !plusBox.current.contains(e.target as Node)) setPlusOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [plusOpen])

  function stopRecording(cancel: boolean) {
    const r = recorder.current
    recorder.current = null
    setRecording(null)
    if (!r) return
    r.cancel = cancel
    try { if (r.rec.state !== 'inactive') r.rec.stop() } catch { /* уже остановлен */ }
    if (cancel) r.stream.getTracks().forEach(t => t.stop())
  }

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const bytes = encoder.encode(text).length
  const parts = Math.max(1, Math.ceil(bytes / 1000))
  const showReply = !!replyTo && mode === 'message' && !blocked
  const canSend = mode === 'note' ? !!text.trim() : (!!text.trim() || files.length > 0) && !preparing

  const replyBar = (<>{showReply && replyTo && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border-l-[3px] border-primary-500 bg-white py-1.5 pl-2.5 pr-1.5 dark:bg-surface-900">
              <CornerUpLeft size={15} className="shrink-0 text-primary-600 dark:text-primary-300" />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-semibold text-primary-700 dark:text-primary-300">
                  Ответ на сообщение {replyTo.direction === 'in' ? 'клиента' : replyTo.author?.id === user?.id ? '(ваше)' : replyTo.author ? `· ${replyTo.author.name}` : ''}
                </div>
                <div className="truncate text-[12.5px] text-surface-600 dark:text-surface-300">{quoteOf(replyTo)}</div>
              </div>
              <button type="button" onClick={onCancelReply} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-700" aria-label="Не отвечать на сообщение" title="Отменить ответ (Esc)">
                <X size={15} />
              </button>
            </div>
          )}</>)
  const filesStrip = (<>{(files.length > 0 || preparing > 0) && mode === 'message' && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Прикреплённые файлы">
              {files.map(f => (
                <div key={f.id} className="relative shrink-0">
                  {f.kind === 'image' && f.preview ? (
                    <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-lg border border-surface-200 object-cover dark:border-surface-600" />
                  ) : (
                    <div className="flex h-16 w-28 flex-col justify-center gap-0.5 rounded-lg border border-surface-200 bg-white px-2 dark:border-surface-600 dark:bg-surface-900" title={f.file.name}>
                      {f.kind === 'video' ? <Film size={16} className="text-surface-500" /> : <FileText size={16} className="text-surface-500" />}
                      <span className="truncate text-[11px] text-surface-700 dark:text-surface-200">{f.file.name}</span>
                      <span className="text-[10px] text-surface-400">{(f.file.size / MB).toFixed(1).replace('.', ',')} МБ</span>
                    </div>
                  )}
                  <button type="button" onClick={() => removeFile(f.id)}
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-surface-200 bg-white text-surface-600 shadow-sm hover:text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
                    aria-label={`Убрать файл ${f.file.name}`}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {preparing > 0 && (
                <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-surface-300 text-[11px] text-surface-500 dark:border-surface-600">
                  Готовлю фото…
                </div>
              )}
            </div>
          )}</>)
  const popovers = (<>{picker?.kind === 'templates' && (
              <TemplatesPopover
                items={templateItems}
                total={(templates ?? []).length}
                active={pickIndex}
                onHover={setPickIndex}
                onPick={insertTemplate}
                onManage={() => { setPicker(null); setManageTemplates(true) }}
                search={picker.source === 'button' ? pickerSearch : null}
                onSearch={setPickerSearch}
                onSearchKey={e => { pickerKey(e) }}
                onClose={closePicker}
              />
            )}
            {picker?.kind === 'mentions' && mentionItems.length > 0 && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(280px,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-modal dark:border-surface-600 dark:bg-surface-800" role="listbox" aria-label="Упомянуть коллегу">
                {mentionItems.map((p, i) => (
                  <button key={p.id} type="button" role="option" aria-selected={i === pickIndex}
                    onMouseDown={e => { e.preventDefault(); insertMention(p) }} onMouseEnter={() => setPickIndex(i)}
                    className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]', i === pickIndex ? 'bg-surface-100 dark:bg-surface-700' : '')}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[11px] font-semibold text-primary-700 dark:bg-primary-500/20 dark:text-primary-200">{p.name[0]}</span>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {showEmoji && <EmojiPicker onPick={e => insertAtCaret(e)} onClose={() => setShowEmoji(false)} />}</>)
  const textarea = (<textarea
                ref={area}
                rows={1}
                value={text}
                maxLength={MAX_CHARS}
                onChange={e => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onClick={e => recomputePicker(text, e.currentTarget.selectionStart ?? text.length)}
                onPaste={e => {
                  const pasted = Array.from(e.clipboardData?.files ?? [])
                  if (!pasted.length) return
                  e.preventDefault()
                  if (mode === 'note') { toast.error('К заметке файл не прикрепить — переключитесь на «Ответ клиенту»'); return }
                  void addFiles(pasted)
                }}
                onKeyDown={e => {
                  if (pickerKey(e)) return
                  if (e.key === 'Escape' && showReply) { e.preventDefault(); e.stopPropagation(); onCancelReply(); return }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
                }}
                placeholder={mode === 'note'
                  ? (roomy ? 'Заметка видна только команде · @ — упомянуть коллегу' : 'Заметка для команды')
                  : files.length ? 'Подпись (необязательно)' : roomy ? 'Сообщение клиенту · «/» — шаблоны' : 'Сообщение…'}
                className="max-h-40 min-h-[36px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-snug outline-none placeholder:text-surface-400"
                aria-label={mode === 'note' ? 'Заметка для команды' : 'Сообщение клиенту'}
              />)

  if (phone) {
    const hasContent = !!text.trim() || files.length > 0
    const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }
    return (
      <div className="border-t border-surface-200 bg-white px-2 pt-2 dark:border-surface-700 dark:bg-surface-900" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickFiles} />
        <input ref={galleryInput} type="file" multiple accept="image/*,video/mp4,video/quicktime" className="hidden" onChange={pickFiles} />
        <input ref={pdfInput} type="file" multiple accept=".pdf,application/pdf" className="hidden" onChange={pickFiles} />
        {readOnlyReason ? (
          <div className="mb-1.5 flex items-start gap-1.5 px-1 text-[12.5px] leading-snug text-surface-600 dark:text-surface-300">
            <Lock size={13} className="mt-0.5 shrink-0 text-surface-400" />
            <span>{readOnlyReason}</span>
          </div>
        ) : mode === 'note' && (
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">
            <StickyNote size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Заметка для команды — клиент её не увидит</span>
            <button type="button" onClick={() => setMode('message')} className="shrink-0 rounded-full px-2 py-1 text-surface-500 active:bg-surface-100 dark:active:bg-surface-800">
              Ответ клиенту
            </button>
          </div>
        )}
        {blocked ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
            {blockedReason}
            <div className="mt-2 flex gap-2">
              <a href={igLink} target="_blank" rel="noreferrer" className="btn-secondary flex-1 justify-center !py-2 text-xs"><ExternalLink size={13} /> В Instagram</a>
              <button type="button" onClick={() => setMode('note')} className="btn-secondary flex-1 justify-center !py-2 text-xs"><StickyNote size={13} /> Заметка</button>
            </div>
          </div>
        ) : (
          <>
            {replyBar}
            {filesStrip}
            <div className="relative">
              {popovers}
              {plusOpen && (
                <div ref={plusBox} className="absolute bottom-full right-0 z-30 mb-2 w-60 overflow-hidden rounded-2xl border border-surface-200 bg-white py-1 shadow-modal dark:border-surface-600 dark:bg-surface-800" role="menu" aria-label="Ещё">
                  {!readOnlyReason && (
                    <button type="button" role="menuitem" onClick={() => { setPlusOpen(false); setMode(mode === 'note' ? 'message' : 'note'); area.current?.focus() }}
                      className="flex h-12 w-full items-center gap-3 px-4 text-left text-[15px] text-surface-900 active:bg-surface-100 dark:text-surface-100 dark:active:bg-surface-700">
                      <StickyNote size={18} className="text-amber-600" /> {mode === 'note' ? 'Ответ клиенту' : 'Заметка для команды'}
                    </button>
                  )}
                  {mode === 'message' && (
                    <button type="button" role="menuitem" onClick={() => { setPlusOpen(false); pdfInput.current?.click() }}
                      className="flex h-12 w-full items-center gap-3 px-4 text-left text-[15px] text-surface-900 active:bg-surface-100 dark:text-surface-100 dark:active:bg-surface-700">
                      <FileText size={18} className="text-surface-500" /> Документ PDF
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-end gap-2">
                {mode === 'message' && !recording && (
                  <button type="button" onClick={() => cameraInput.current?.click()}
                    className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white active:bg-primary-700"
                    aria-label="Снять фото" title="Снять фото">
                    <Camera size={20} />
                  </button>
                )}
                <div className={clsx('flex min-h-[44px] min-w-0 flex-1 items-end rounded-[22px] border pl-3.5 pr-1',
                  mode === 'note' ? 'border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/5'
                    : recording ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10'
                      : 'border-surface-200 bg-surface-50 dark:border-surface-600 dark:bg-surface-800')}>
                  {recording ? (
                    <div className="flex min-h-[42px] min-w-0 flex-1 items-center gap-2 text-[15px] text-surface-800 dark:text-surface-100" aria-live="polite">
                      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden />
                      <span className="tabular-nums">{clock}</span>
                      <span className="min-w-0 truncate text-[13px] text-surface-400">‹ влево — отмена</span>
                    </div>
                  ) : textarea}
                  {hasContent && !recording ? (
                    <button type="button" onClick={submit} disabled={!canSend}
                      className="mb-1.5 shrink-0 rounded-full px-2.5 py-1 text-[15px] font-semibold text-primary-600 disabled:opacity-40 dark:text-primary-300">
                      Отправить
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center pb-[3px]">
                      {mode === 'message' && !recording ? (
                        <>
                          <button type="button" onClick={() => galleryInput.current?.click()}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-surface-600 active:bg-surface-200 dark:text-surface-300 dark:active:bg-surface-700" aria-label="Фото и видео из галереи">
                            <ImageIcon size={21} />
                          </button>
                          <button type="button" data-picker-toggle
                            onClick={() => { setPlusOpen(false); setPickerSearch(''); setPicker(picker?.kind === 'templates' ? null : { kind: 'templates', query: '', source: 'button' }) }}
                            className={clsx('flex h-9 w-9 items-center justify-center rounded-full active:bg-surface-200 dark:active:bg-surface-700', picker?.kind === 'templates' ? 'text-primary-600 dark:text-primary-300' : 'text-surface-600 dark:text-surface-300')}
                            aria-label="Шаблоны быстрых ответов" aria-expanded={picker?.kind === 'templates'}>
                            <Zap size={21} />
                          </button>
                        </>
                      ) : null}
                      {!recording ? (
                        <button type="button" data-plus-toggle onClick={() => { setPicker(null); setPlusOpen(v => !v) }}
                          className={clsx('flex h-9 w-9 items-center justify-center rounded-full active:bg-surface-200 dark:active:bg-surface-700', plusOpen ? 'text-primary-600 dark:text-primary-300' : 'text-surface-600 dark:text-surface-300')}
                          aria-label="Ещё: заметка для команды, документ" aria-expanded={plusOpen}>
                          <Plus size={22} />
                        </button>
                      ) : null}
                      {mode === 'message' ? (
                        <button type="button" onPointerDown={micDown} onPointerMove={micMove} onPointerUp={micUp} onPointerCancel={micUp}
                          onContextMenu={e => e.preventDefault()} disabled={preparing > 0}
                          className={clsx('direct-phone-bubble flex h-9 w-9 items-center justify-center rounded-full transition-transform',
                            recording ? 'scale-125 bg-amber-500 text-white' : 'text-surface-600 active:bg-surface-200 dark:text-surface-300 dark:active:bg-surface-700')}
                          aria-label="Голосовое: удерживайте, чтобы записать" title="Удерживайте, чтобы записать">
                          <Mic size={21} />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
        {manageTemplates && <TemplatesManager isTop={top} onClose={() => { setManageTemplates(false); area.current?.focus() }} />}
      </div>
    )
  }

  return (
    <div className="border-t border-surface-200 bg-surface-50 p-2.5 dark:border-surface-700 dark:bg-surface-800">
      {readOnlyReason ? (
        <div className="mb-2 flex items-start gap-1.5 px-1 text-[12.5px] leading-snug text-surface-600 dark:text-surface-300">
          <Lock size={13} className="mt-0.5 shrink-0 text-surface-400" />
          <span>{readOnlyReason}</span>
        </div>
      ) : (
        <div className="mb-2 flex items-center gap-1">
          {(['message', 'note'] as Mode[]).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setPicker(null) }}
              className={clsx('inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-0',
                mode === m
                  ? m === 'note' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' : 'bg-primary-600 text-white'
                  : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700')}>
              {m === 'note' ? <><StickyNote size={12} /> Заметка для команды</> : 'Ответ клиенту'}
            </button>
          ))}
        </div>
      )}

      {blocked ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="min-w-0 flex-1 basis-[220px]">{blockedReason}</span>
          <a href={igLink} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 text-xs max-sm:w-full max-sm:justify-center max-sm:!py-2.5">
            <ExternalLink size={13} /> Открыть в Instagram
          </a>
        </div>
      ) : recording ? (
        <div className="flex items-center gap-3 rounded-xl border border-surface-200 bg-white px-3 py-2 dark:border-surface-600 dark:bg-surface-900">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
          <span className="text-sm tabular-nums text-surface-700 dark:text-surface-200">Запись {clock}</span>
          <span className="text-xs text-surface-400">до 5:00</span>
          <button type="button" onClick={() => stopRecording(true)} className="ml-auto rounded-lg p-2 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label="Отменить запись" title="Отменить">
            <Trash2 size={18} />
          </button>
          <button type="button" onClick={() => stopRecording(false)} className="btn-primary !px-3" aria-label="Отправить голосовое">
            <Square size={14} /> Отправить
          </button>
        </div>
      ) : (
        <>
          {replyBar}

          {filesStrip}

          <div className="relative">
            {popovers}

            <div className={clsx('flex items-end gap-0.5 rounded-xl border bg-white px-1.5 py-1.5 dark:bg-surface-900',
              mode === 'note' ? 'border-amber-300 dark:border-amber-500/40' : 'border-surface-200 dark:border-surface-600')}>
              {mode === 'message' && (
                <>
                  <input ref={filePicker} type="file" multiple accept={ACCEPT} className="hidden"
                    onChange={e => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
                  <button type="button" onClick={() => filePicker.current?.click()}
                    className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label="Прикрепить фото, видео или PDF" title="Фото, видео или PDF — можно перетащить в чат или вставить Ctrl+V">
                    <Paperclip size={18} />
                  </button>
                  <button type="button" data-picker-toggle
                    onClick={() => { setShowEmoji(false); setPickerSearch(''); setPicker(picker?.kind === 'templates' ? null : { kind: 'templates', query: '', source: 'button' }) }}
                    className={clsx('rounded-lg p-2 hover:bg-surface-100 dark:hover:bg-surface-700', picker?.kind === 'templates' ? 'text-primary-600 dark:text-primary-300' : 'text-surface-500')}
                    aria-label="Шаблоны быстрых ответов" title="Шаблоны (или «/» в начале строки)" aria-expanded={picker?.kind === 'templates'}>
                    <Zap size={18} />
                  </button>
                </>
              )}
              <button type="button" data-emoji-toggle onClick={() => { setPicker(null); setShowEmoji(v => !v) }}
                className={clsx('rounded-lg p-2 hover:bg-surface-100 dark:hover:bg-surface-700', showEmoji ? 'text-primary-600 dark:text-primary-300' : 'text-surface-500')}
                aria-label="Эмодзи" aria-expanded={showEmoji}>
                <Smile size={18} />
              </button>
              {textarea}
              {mode === 'message' && !text.trim() && !files.length ? (
                <button type="button" onClick={startRecording} disabled={preparing > 0}
                  className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 disabled:opacity-50 dark:hover:bg-surface-700" aria-label="Записать голосовое" title="Записать голосовое">
                  <Mic size={18} />
                </button>
              ) : (
                <button type="button" onClick={submit} disabled={!canSend}
                  className="rounded-lg bg-primary-600 p-2 text-white hover:bg-primary-700 disabled:opacity-50" aria-label={mode === 'note' ? 'Сохранить заметку' : 'Отправить'}>
                  <Send size={18} />
                </button>
              )}
            </div>
          </div>
          {text.length > 700 && (
            <p className="mt-1 text-right text-[11px] text-surface-400">
              {text.length} / {MAX_CHARS}{mode === 'message' && parts > 1 ? ` · уйдёт ${parts} сообщениями` : ''}
            </p>
          )}
        </>
      )}
      {manageTemplates && <TemplatesManager isTop={top} onClose={() => { setManageTemplates(false); area.current?.focus() }} />}
    </div>
  )
})

export default Composer

/** Подходит ли коллега под «@запрос»: по началу любого слова или всего имени. */
function mentionMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const full = name.toLowerCase()
  return full.startsWith(q) || full.split(/\s+/).some(w => w.startsWith(q))
}

/** Цитата одной строкой: текст или что это за вложение. */
export function quoteOf(m: Pick<DirectMessage, 'text' | 'attachments' | 'deleted'>): string {
  if (m.deleted) return 'Сообщение удалено'
  const words = (m.text || '').replace(/\s+/g, ' ').trim()
  if (words) return words
  const kind = m.attachments[0]?.kind
  return kind === 'image' ? 'Фото' : kind === 'video' ? 'Видео' : kind === 'audio' ? 'Голосовое сообщение'
    : kind === 'file' ? 'Файл' : kind === 'story' ? 'Сторис' : kind === 'share' ? 'Публикация' : kind === 'reel' ? 'Reels' : 'Сообщение'
}

function TemplatesPopover({ items, total, active, onHover, onPick, onManage, search, onSearch, onSearchKey, onClose }: {
  items: DirectTemplate[]
  total: number
  active: number
  onHover: (i: number) => void
  onPick: (t: DirectTemplate) => void
  onManage: () => void
  /** null — ищем по тексту после «/» в поле, иначе своё поле поиска. */
  search: string | null
  onSearch: (s: string) => void
  onSearchKey: (e: ReactKeyboardEvent) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-picker-toggle]')) return
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [onClose])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const shared = items.filter(t => t.shared)
  const mine = items.filter(t => !t.shared)
  let index = -1
  const row = (t: DirectTemplate) => {
    index += 1
    const i = index
    return (
      <button key={t.id} type="button" role="option" aria-selected={i === active} data-index={i}
        onMouseDown={e => { e.preventDefault(); onPick(t) }} onMouseEnter={() => onHover(i)}
        className={clsx('block w-full px-3 py-2 text-left', i === active ? 'bg-surface-100 dark:bg-surface-700' : '')}>
        <span className="block truncate text-[13px] font-medium text-surface-900 dark:text-white">{t.title}</span>
        <span className="block truncate text-[12px] text-surface-500">{t.text}</span>
      </button>
    )
  }
  return (
    <div ref={box} className="absolute bottom-full left-0 z-30 mb-2 flex max-h-[min(380px,60vh)] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-surface-200 bg-white shadow-modal dark:border-surface-600 dark:bg-surface-800">
      <div className="flex items-center gap-2 border-b border-surface-100 px-3 py-2 dark:border-surface-700">
        <Zap size={14} className="shrink-0 text-surface-400" />
        {search !== null ? (
          <input autoFocus value={search} onChange={e => onSearch(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Найти шаблон" aria-label="Найти шаблон"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-surface-400" />
        ) : (
          <span className="min-w-0 flex-1 text-[12.5px] text-surface-500">Шаблоны · ↑↓ выбрать, Enter вставить</span>
        )}
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={onManage}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-700 dark:hover:text-surface-100">
          <Settings2 size={13} /> Настроить
        </button>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Шаблоны быстрых ответов">
        {total === 0 ? (
          <div className="px-3 py-4 text-center text-[13px] text-surface-500">
            Шаблонов пока нет.
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={onManage} className="mt-2 block w-full font-medium text-primary-700 hover:underline dark:text-primary-300">
              Добавить первый шаблон
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-4 text-center text-[13px] text-surface-500">Ничего не нашлось</div>
        ) : (
          <>
            {shared.length > 0 && <div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-surface-400">Общие</div>}
            {shared.map(row)}
            {mine.length > 0 && <div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-surface-400">Мои</div>}
            {mine.map(row)}
          </>
        )}
      </div>
    </div>
  )
}
