import { useId } from 'react'
import clsx from 'clsx'
import type { NextAction } from '@/types/sales'
import { daysFromNow } from './leadUtils'

/**
 * «Следующий шаг» в шторках звонка и итога встречи (15.11.2026): быстрые
 * кнопки «Завтра 11:00 / Через 3 дня / Выбрать дату» и вид действия —
 * перезвон по умолчанию, ссылками можно сделать встречей или шагом.
 * Состояние держит родитель (NextDraft), в запрос уходит draftToNext().
 */
export type NextPreset = 'tomorrow' | 'in3' | 'custom'

export interface NextDraft {
  preset: NextPreset | null
  /** <input type="datetime-local"> — местное время. */
  custom: string
  kind: NextAction['kind']
  text: string
}

export function emptyDraft(kind: NextAction['kind'] = 'callback'): NextDraft {
  return { preset: null, custom: '', kind, text: '' }
}

function atOf(d: NextDraft): Date | null {
  if (d.preset === 'tomorrow') return daysFromNow(1, 11)
  if (d.preset === 'in3') return daysFromNow(3, 11)
  if (d.preset === 'custom' && d.custom) {
    const x = new Date(d.custom)
    return isNaN(x.getTime()) ? null : x
  }
  return null
}

/** Ошибка черновика (или null): выбрали «дату», но не указали / указали
 *  прошедшую; шаг без описания (в «Сегодня» был бы пустой пункт). */
export function draftError(d: NextDraft): string | null {
  if (!d.preset) return null
  if (d.preset === 'custom') {
    const at = atOf(d)
    if (!at) return 'Укажите дату и время'
    if (at.getTime() < Date.now() - 60_000) return 'Это время уже прошло'
  }
  if (d.kind === 'step' && !d.text.trim()) return 'Опишите шаг'
  return null
}

export function draftToNext(d: NextDraft): NextAction | undefined {
  const at = atOf(d)
  if (!at || draftError(d)) return undefined
  const text = d.text.trim().slice(0, 500)
  return { kind: d.kind, at: at.toISOString(), ...(text ? { text } : {}) }
}

const PRESETS: Array<{ value: NextPreset; label: string }> = [
  { value: 'tomorrow', label: 'Завтра 11:00' },
  { value: 'in3', label: 'Через 3 дня' },
  { value: 'custom', label: 'Выбрать дату' },
]

const KIND_LABEL: Record<NextAction['kind'], string> = {
  callback: 'перезвонить',
  meeting: 'встреча',
  step: 'шаг',
}

export default function NextActionPicker({ value, onChange }: {
  value: NextDraft
  onChange: (v: NextDraft) => void
}) {
  const idPrefix = useId()
  const err = value.preset ? draftError(value) : null
  const others = (Object.keys(KIND_LABEL) as Array<NextAction['kind']>).filter(k => k !== value.kind)
  return (
    <fieldset className="space-y-2">
      <legend className="label">Следующий шаг</legend>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => {
          const on = value.preset === p.value
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={on}
              // Повторное нажатие снимает выбор: следующий шаг не обязателен.
              onClick={() => onChange({ ...value, preset: on ? null : p.value })}
              className={clsx(
                'min-h-[44px] rounded-lg border px-3 text-sm font-medium transition-colors',
                on
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-surface-300 bg-surface-50 text-surface-700 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200',
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      {value.preset === 'custom' && (
        <div>
          <label htmlFor={`${idPrefix}-at`} className="sr-only">Дата и время</label>
          <input
            id={`${idPrefix}-at`}
            type="datetime-local"
            className="input"
            value={value.custom}
            onChange={e => onChange({ ...value, custom: e.target.value })}
          />
        </div>
      )}
      {value.preset && (
        <>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            Это будет: <b className="font-semibold text-surface-700 dark:text-surface-200">{KIND_LABEL[value.kind]}</b>.{' '}
            Сделать{' '}
            {others.map((k, i) => (
              <span key={k}>
                {i > 0 && ' или '}
                <button type="button" onClick={() => onChange({ ...value, kind: k })}
                  className="font-medium text-primary-700 underline underline-offset-2 hover:no-underline dark:text-primary-300">
                  {k === 'callback' ? 'перезвоном' : k === 'meeting' ? 'встречей' : 'шагом'}
                </button>
              </span>
            ))}
          </p>
          {value.kind !== 'meeting' && (
            <div>
              <label htmlFor={`${idPrefix}-text`} className="sr-only">Что сделать</label>
              <input
                id={`${idPrefix}-text`}
                className="input"
                maxLength={500}
                value={value.text}
                onChange={e => onChange({ ...value, text: e.target.value })}
                placeholder={value.kind === 'step' ? 'Что сделать: отправить КП, согласовать договор…' : 'Комментарий к перезвону (необязательно)'}
              />
            </div>
          )}
          {err && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{err}</p>}
        </>
      )}
    </fieldset>
  )
}
