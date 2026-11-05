import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { ExternalLink, FileText, Image as ImageIcon, Mic, Paperclip, Send, Square, StickyNote, Trash2, X } from 'lucide-react'

const MAX_CHARS = 4000
const MAX_VOICE_S = 300
const encoder = new TextEncoder()

type Mode = 'message' | 'note'

/** Поле ответа: текст, фото/PDF, голосовое; режим «Заметка для команды». */
export default function Composer({ blockedReason, igLink, onSendText, onSendFile, onSendVoice, onAddNote, conversationId }: {
  /** Почему писать клиенту сейчас нельзя (окно 24 часов, нет подключения). Заметки можно всегда. */
  blockedReason: string | null
  igLink: string
  /** Отправка мгновенная: пузырь сразу в ленте, ответ сервера — потом. */
  onSendText: (text: string) => void
  onSendFile: (file: File, text: string) => void
  onSendVoice: (blob: Blob) => void
  onAddNote: (text: string) => void
  conversationId: string
}) {
  const [mode, setMode] = useState<Mode>('message')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [recording, setRecording] = useState<{ started: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; cancel: boolean } | null>(null)

  // Другой чат — чистое поле и обычный режим.
  useEffect(() => {
    setText(''); setFile(null); setMode('message')
    return () => stopRecording(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

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

  const blocked = mode === 'message' && !!blockedReason
  const bytes = encoder.encode(text).length
  const parts = Math.max(1, Math.ceil(bytes / 1000))

  // Поле очищается сразу, сообщение тут же появляется в ленте; если сервер
  // его не примет, пузырь покажет «не доставлено» и «Повторить».
  function submit() {
    const value = text.trim()
    if (mode === 'note') {
      if (!value) return
      setText('')
      onAddNote(value)
      area.current?.focus()
      return
    }
    if (blocked || (!value && !file)) return
    const sending = file
    setText(''); setFile(null)
    if (sending) onSendFile(sending, value)
    else onSendText(value)
    area.current?.focus()
  }

  function pick(f: File | undefined) {
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop() || ''
    if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) { toast.error('Instagram принимает фото JPG и PNG и документы PDF'); return }
    const limit = ext === 'pdf' ? 25 : 8
    if (f.size > limit * 1024 * 1024) { toast.error(ext === 'pdf' ? 'PDF больше 25 МБ — Instagram его не примет' : 'Фото больше 8 МБ — Instagram его не примет'); return }
    setFile(f)
    setMode('message')
  }

  async function startRecording() {
    if (blocked || recording) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Этот браузер не умеет записывать голос'); return
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
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
      toast.error(denied ? 'Нет доступа к микрофону — разрешите его в настройках браузера' : 'Микрофон не найден')
    }
  }

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

  return (
    <div className="border-t border-surface-200 bg-surface-50 p-2.5 dark:border-surface-700 dark:bg-surface-800">
      <div className="mb-2 flex items-center gap-1">
        {(['message', 'note'] as Mode[]).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={clsx('inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-0',
              mode === m
                ? m === 'note' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' : 'bg-primary-600 text-white'
                : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700')}>
            {m === 'note' ? <><StickyNote size={12} /> Заметка для команды</> : 'Ответ клиенту'}
          </button>
        ))}
      </div>

      {blocked ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          {/* basis 220px: на телефоне текст во всю ширину, кнопка — под ним,
              а не узкий столбик текста рядом с кнопкой. */}
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
          {file && mode === 'message' && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-[13px] dark:border-surface-600 dark:bg-surface-900">
              {file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? <FileText size={16} /> : <ImageIcon size={16} />}
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} className="rounded p-0.5 text-surface-400 hover:text-surface-700" aria-label="Убрать файл"><X size={14} /></button>
            </div>
          )}
          <div className={clsx('flex items-end gap-1.5 rounded-xl border bg-white px-2 py-1.5 dark:bg-surface-900',
            mode === 'note' ? 'border-amber-300 dark:border-amber-500/40' : 'border-surface-200 dark:border-surface-600')}>
            {mode === 'message' && (
              <>
                <input ref={picker} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden"
                  onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
                <button type="button" onClick={() => picker.current?.click()}
                  className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 disabled:opacity-50 dark:hover:bg-surface-700" aria-label="Прикрепить фото или PDF" title="Фото (JPG, PNG) или PDF">
                  <Paperclip size={18} />
                </button>
              </>
            )}
            <textarea
              ref={area}
              rows={1}
              value={text}
              maxLength={MAX_CHARS}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
              }}
              placeholder={mode === 'note' ? 'Заметка видна только команде' : file ? 'Подпись к файлу (необязательно)' : 'Сообщение клиенту…'}
              className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-snug outline-none placeholder:text-surface-400"
              aria-label={mode === 'note' ? 'Заметка для команды' : 'Сообщение клиенту'}
            />
            {mode === 'message' && !text.trim() && !file ? (
              <button type="button" onClick={startRecording}
                className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 disabled:opacity-50 dark:hover:bg-surface-700" aria-label="Записать голосовое" title="Записать голосовое">
                <Mic size={18} />
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={!text.trim() && !file}
                className="rounded-lg bg-primary-600 p-2 text-white hover:bg-primary-700 disabled:opacity-50" aria-label={mode === 'note' ? 'Сохранить заметку' : 'Отправить'}>
                <Send size={18} />
              </button>
            )}
          </div>
          {text.length > 700 && (
            <p className="mt-1 text-right text-[11px] text-surface-400">
              {text.length} / {MAX_CHARS}{mode === 'message' && parts > 1 ? ` · уйдёт ${parts} сообщениями` : ''}
            </p>
          )}
        </>
      )}
    </div>
  )
}
