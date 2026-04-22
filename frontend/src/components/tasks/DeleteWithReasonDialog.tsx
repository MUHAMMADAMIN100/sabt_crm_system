import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui'
import { AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  title?: string
  message?: string
  loading?: boolean
}

/** Wave 17: диалог удаления задачи с обязательной причиной (TZ п.5).
 *  Бэкенд возвращает 400 если reason пустой — тут блокируем кнопку до ввода. */
export default function DeleteWithReasonDialog({
  open, onClose, onConfirm, title = 'Удалить задачу?', message, loading,
}: Props) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  if (!open) return null

  const trimmed = reason.trim()
  const canSubmit = trimmed.length > 0 && !loading

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 text-sm">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="text-surface-700 dark:text-surface-300">
            {message ?? 'Удаление необратимо. Укажите причину — она сохранится в журнале активности.'}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-surface-700 dark:text-surface-300 block mb-1">
            Причина удаления <span className="text-red-500">*</span>
          </label>
          <textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Например: дубликат задачи / отменено клиентом / создано по ошибке"
            className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-surface-100 dark:border-surface-800">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 rounded-lg text-sm border border-surface-200 dark:border-surface-700">
            Отмена
          </button>
          <button
            onClick={() => canSubmit && onConfirm(trimmed)}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {loading ? 'Удаление...' : 'Удалить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
