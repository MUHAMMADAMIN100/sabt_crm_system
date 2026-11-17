// «Новый результат» (16.11.2026, макет GoalEditor, GOALS_SPEC §7, §9):
// уровень (компания / отдел), на что работает, название, откуда брать цифру
// (готовые источники CRM или «вручную») с живым «Сейчас по этому источнику»,
// цель и ответственный. Для «Выигранных сделок» отдела продаж после
// сохранения — «Разложить по менеджерам» (цели месяца каждому).
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui'
import { compassApi, compassKeys } from '@/services/goals.api'
import { DEPARTMENTS, DEPT_NAME, formatTarget, formatValue, monthLabel, pluralRu } from '@/lib/goals'
import { getRoleLabel } from '@/lib/permissions'
import { errorText } from '@/components/sales/leadUtils'
import type {
  DeptKey, GoalPerson, KeyResultInput, KeyResultView, KrKind, KrLevel, KrUnit, SourceKey, SourceMeta, SourceParamKey,
} from '@/types/goals'
import { useCompassPeople, useWhileOpen } from './GoalUi'

type KrDefaults = { level?: KrLevel; department?: DeptKey; objectiveId?: string; parentId?: string }
type Params = Partial<Record<SourceParamKey, string>>

const DIRECTION_OPTIONS = [
  { value: '', label: 'Все направления' },
  { value: 'smm', label: 'SMM' },
  { value: 'development', label: 'Разработка' },
]
const UNIT_OPTIONS: Array<{ value: KrUnit; label: string }> = [
  { value: 'count', label: 'Штуки' },
  { value: 'money', label: 'Сомони' },
  { value: 'percent', label: 'Проценты' },
]
const UNIT_SUFFIX: Record<KrUnit, string> = { count: 'шт.', money: 'с.', percent: '%' }
const PARAM_LABEL: Record<SourceParamKey, string> = { direction: 'Направление', department: 'Чей отдел считать', kpiKey: 'Метрика KPI' }
/** У этих источников нет цифры в CRM до сохранения — «Сейчас по источнику» не спрашиваем. */
const NO_PREVIEW: SourceKey[] = ['manual', 'rollup']

/** «Задачи в срок» считаются по задачам dev- или SMM-проектов; KPI — по любому отделу. */
function deptParamOptions(source: SourceKey | ''): Array<{ value: string; label: string }> {
  const keys: DeptKey[] = source === 'tasks_ontime' ? ['dev', 'smm'] : DEPARTMENTS.map(d => d.key)
  return [{ value: '', label: 'Все отделы' }, ...keys.map(k => ({ value: k, label: DEPT_NAME[k] }))]
}

/** «15», «1 500,5», «95 %» → число; пусто или мусор — null. */
function parseNum(s: string): number | null {
  const t = s.replace(/[\s%]/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** «Разложить по менеджерам» — только выигранные сделки отдела продаж. */
function canDistribute(kr: KeyResultView): boolean {
  return kr.source === 'won_deals' && kr.level === 'department' && kr.department === 'sales'
}

function FieldError({ id, text }: { id?: string; text?: string }) {
  if (!text) return null
  return <p id={id} className="mt-1 text-xs text-red-500">{text}</p>
}

export function KeyResultModal(props: {
  open: boolean
  onClose: () => void
  ym: string
  editing?: KeyResultView | null
  defaults?: KrDefaults
}) {
  const { open, onClose, ym } = props
  const shown = useWhileOpen(open, { editing: props.editing ?? null, defaults: props.defaults })
  // Второй шаг — «Разложить по менеджерам» после сохранения.
  const [saved, setSaved] = useState<KeyResultView | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSaved(null)
  }
  const d = shown.defaults
  const formKey = shown.editing?.id ?? `new:${d?.level ?? ''}:${d?.department ?? ''}:${d?.objectiveId ?? ''}:${d?.parentId ?? ''}`
  const title = saved ? 'Разложить по менеджерам' : shown.editing ? 'Изменить результат' : 'Новый результат'
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" closeOnBackdropClick={false}>
      {saved
        ? <DistributeStep kr={saved} onClose={onClose} />
        : (
          <KrForm
            key={formKey}
            ym={ym}
            editing={shown.editing}
            defaults={shown.defaults}
            onClose={onClose}
            onSaved={kr => (canDistribute(kr) ? setSaved(kr) : onClose())}
          />
        )}
    </Modal>
  )
}

function KrForm({ ym, editing, defaults, onClose, onSaved }: {
  ym: string
  editing: KeyResultView | null
  defaults?: KrDefaults
  onClose: () => void
  onSaved: (kr: KeyResultView) => void
}) {
  const qc = useQueryClient()
  const viewQ = useQuery({ queryKey: compassKeys.view(ym), queryFn: () => compassApi.view(ym), staleTime: 30_000 })
  const sourcesQ = useQuery({ queryKey: compassKeys.sources(ym), queryFn: () => compassApi.sources(ym), staleTime: 5 * 60_000 })
  const people = useCompassPeople()

  const view = viewQ.data
  const canCompany = !!view?.canManageCompany
  const isTop = !!view?.me.isTop
  const leads: DeptKey[] = view?.me.leads ?? []

  // ── Уровень и отдел ──
  const [levelPick, setLevelPick] = useState<KrLevel | null>(editing?.level ?? defaults?.level ?? null)
  const level: KrLevel = editing ? editing.level : canCompany ? (levelPick ?? 'company') : 'department'

  const deptKeys: DeptKey[] = isTop ? DEPARTMENTS.map(x => x.key) : [...leads]
  for (const k of [editing?.department, defaults?.department]) {
    if (k && !deptKeys.includes(k)) deptKeys.push(k)
  }
  const [deptPick, setDeptPick] = useState<DeptKey | ''>(editing?.department ?? defaults?.department ?? '')
  const department: DeptKey | '' = deptPick || (deptKeys.length === 1 ? deptKeys[0] : '')

  // ── На что работает ──
  const objectives = view?.objectives ?? []
  const [objectivePick, setObjectivePick] = useState(editing?.objectiveId ?? defaults?.objectiveId ?? '')
  const objectiveId = objectivePick || (objectives.length === 1 ? objectives[0].id : '')
  const companyKrs = objectives.flatMap(o => o.keyResults)
  const [parentId, setParentId] = useState(editing?.parentId ?? defaults?.parentId ?? '')
  const parentMissing = !!parentId && !companyKrs.some(k => k.id === parentId)

  // ── Название, источник, цель ──
  const [title, setTitle] = useState(editing?.title ?? '')
  const [source, setSource] = useState<SourceKey | ''>(editing?.source ?? '')
  const [params, setParams] = useState<Params>(() => ({ ...(editing?.sourceParams ?? {}) }))
  const [target, setTarget] = useState(editing ? String(editing.target) : '')
  const [unitPick, setUnitPick] = useState<KrUnit>(editing?.unit ?? 'count')
  const [ownerId, setOwnerId] = useState(editing?.owner?.id ?? '')
  const [manual, setManual] = useState(editing?.manualValue != null ? String(editing.manualValue) : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)

  const allSources: SourceMeta[] = sourcesQ.data?.sources ?? []
  const sources = allSources.filter(s => level === 'company' || !s.companyOnly)
  const meta = allSources.find(s => s.key === source) ?? null
  const unit: KrUnit = meta?.unit ?? unitPick
  const kind: KrKind = meta?.kind ?? editing?.kind ?? 'sum'
  const isManual = source === 'manual'
  const isRollup = source === 'rollup'
  const paramKeys: SourceParamKey[] = meta?.params ?? []
  const cleanParams: Params = {}
  for (const k of paramKeys) {
    const v = params[k]
    if (v) cleanParams[k] = v
  }

  // ── «Сейчас по этому источнику» — с задержкой, пока человек выбирает ──
  const previewArgs = source && !NO_PREVIEW.includes(source) ? JSON.stringify({ source, ym, ...cleanParams }) : ''
  const previewKey = useDebounced(previewArgs, 400)
  const previewQ = useQuery({
    queryKey: [...compassKeys.all, 'preview', previewKey],
    queryFn: () => compassApi.preview(JSON.parse(previewKey) as { source: string; ym?: string; direction?: string; kpiKey?: string; department?: string }),
    enabled: !!previewKey,
    staleTime: 60_000,
    retry: false,
  })

  const changeLevel = (l: KrLevel) => {
    setLevelPick(l)
    if (l === 'department' && meta?.companyOnly) setSource('')
    setErrors({})
  }

  const pickSource = (s: SourceMeta) => {
    setSource(s.key)
    setParams(prev => {
      const next: Params = {}
      for (const k of s.params) if (prev[k]) next[k] = prev[k]
      // Результат отдела: «Задачи в срок» и KPI сразу считаем по этому отделу.
      if (s.params.includes('department') && !next.department && level === 'department' && department
        && deptParamOptions(s.key).some(o => o.value === department)) {
        next.department = department
      }
      return next
    })
    if (s.key === 'rollup') setTarget('100')
    setErrors(e => ({ ...e, source: '' }))
  }

  const save = useMutation({
    mutationFn: (args: { body: KeyResultInput; manualValue?: number | null }) => {
      if (!editing) return compassApi.createKeyResult(args.body)
      const b = args.body
      const patch: Partial<KeyResultInput> & { manualValue?: number | null } = {
        title: b.title,
        source: b.source,
        sourceParams: b.sourceParams,
        target: b.target,
        ownerId: b.ownerId,
      }
      if (b.unit) patch.unit = b.unit
      if (b.level === 'company') patch.objectiveId = b.objectiveId
      else patch.parentId = b.parentId
      if (args.manualValue !== undefined) patch.manualValue = args.manualValue
      return compassApi.updateKeyResult(editing.id, patch)
    },
    onSuccess: kr => {
      qc.invalidateQueries({ queryKey: compassKeys.all })
      toast.success(editing ? 'Результат сохранён' : 'Результат добавлен')
      onSaved(kr)
    },
    onError: (e: unknown) => setServerError(errorText(e, 'Не удалось сохранить результат')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const t = title.trim()
    if (!t) errs.title = 'Напишите название результата'
    else if (t.length > 200) errs.title = 'Не больше 200 знаков'
    if (!source) errs.source = 'Выберите, откуда брать цифру'
    if (level === 'company' && !objectiveId) {
      errs.objectiveId = objectives.length ? 'Выберите цель компании' : 'Сначала добавьте цель компании на этот месяц'
    }
    if (level === 'department' && !department) {
      errs.department = deptKeys.length ? 'Выберите отдел' : 'Результаты отдела ставит его руководитель'
    }
    const targetNum = isRollup ? 100 : parseNum(target)
    if (targetNum == null || targetNum <= 0) errs.target = 'Цель — число больше нуля'
    let manualValue: number | null | undefined
    if (isManual && editing?.canCheckin) {
      const n = parseNum(manual)
      if (manual.trim() && n == null) errs.manual = 'Факт — число'
      else if (n !== (editing.manualValue ?? null)) manualValue = n
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean) || !source || targetNum == null) return
    setServerError(null)
    const body: KeyResultInput = {
      ym,
      level,
      department: level === 'department' ? (department || null) : null,
      objectiveId: level === 'company' ? objectiveId : null,
      parentId: level === 'department' ? (parentId || null) : null,
      title: t,
      source,
      sourceParams: cleanParams,
      target: targetNum,
      ownerId: ownerId || null,
    }
    if (isManual) body.unit = unitPick
    save.mutate({ body, manualValue })
  }

  // ── Подписи ──
  const preview = previewQ.data
  let previewText: ReactNode = 'Считаем…'
  if (previewArgs && previewArgs === previewKey && !previewQ.isFetching) {
    if (previewQ.isError) previewText = 'Не удалось посчитать сейчас — цифра появится после сохранения.'
    else if (preview) {
      previewText = (
        <>
          Сейчас по этому источнику:{' '}
          <b className="font-semibold text-surface-900 dark:text-surface-50">
            {preview.value == null ? 'нет данных' : formatValue(preview.value, preview.unit)}
          </b>
          {preview.detail ? ` — ${preview.detail}` : ''}
        </>
      )
    }
  }
  const targetLabel = kind === 'lower' ? 'Цель — не больше' : kind === 'rate' ? 'Цель — не меньше' : 'Цель на месяц'

  const list: GoalPerson[] = people.data ?? []
  // Люди отдела — первыми в списке ответственных.
  const peopleSorted = level === 'department' && department
    ? [...list].sort((a, b) => Number(b.department === department) - Number(a.department === department))
    : list
  const ownerMissing = !!editing?.owner && !list.some(p => p.id === editing.owner?.id)

  if (viewQ.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-surface-500">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Загружаем цели месяца…
      </p>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="-mt-1 text-[13px] text-surface-600 dark:text-surface-300">
        Измеримый результат на {monthLabel(ym)} — по нему видно, выполнена ли цель.
      </p>
      {viewQ.isError && (
        <p role="alert" className="text-sm text-amber-500">
          Не удалось загрузить цели месяца — список «Работает на» может быть пустым.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label" id="kr-level-label">Уровень</span>
          {editing || !canCompany ? (
            <p className="flex min-h-[34px] items-center text-sm text-surface-800 dark:text-surface-100">
              {level === 'company' ? 'Компания' : 'Отдел'}
            </p>
          ) : (
            <div role="group" aria-labelledby="kr-level-label"
              className="grid grid-cols-2 gap-0.5 rounded-lg border border-surface-300 bg-surface-100 p-0.5 dark:border-surface-600 dark:bg-surface-900">
              {(['company', 'department'] as const).map(l => (
                <button key={l} type="button" aria-pressed={level === l} onClick={() => changeLevel(l)}
                  className={clsx('min-h-[44px] lg:min-h-[34px] rounded-md px-3 text-sm font-semibold transition-colors',
                    level === l
                      ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-600 dark:text-white'
                      : 'text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200')}>
                  {l === 'company' ? 'Компания' : 'Отдел'}
                </button>
              ))}
            </div>
          )}
        </div>

        {level === 'department' && (
          editing ? (
            <div>
              <span className="label">Отдел</span>
              <p className="flex min-h-[34px] items-center text-sm text-surface-800 dark:text-surface-100">
                {editing.department ? DEPT_NAME[editing.department] : '—'}
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="kr-dept" className="label">Отдел</label>
              <select id="kr-dept" className="input" value={department}
                aria-invalid={!!errors.department} aria-describedby={errors.department ? 'kr-dept-err' : undefined}
                onChange={e => { setDeptPick(e.target.value as DeptKey | ''); setErrors(x => ({ ...x, department: '' })) }}>
                {deptKeys.length !== 1 && <option value="">Выберите отдел</option>}
                {deptKeys.map(k => <option key={k} value={k}>{DEPT_NAME[k]}</option>)}
              </select>
              <FieldError id="kr-dept-err" text={errors.department} />
            </div>
          )
        )}
      </div>

      {level === 'company' ? (
        <div>
          <label htmlFor="kr-objective" className="label">Работает на цель компании</label>
          <select id="kr-objective" className="input" value={objectiveId}
            aria-invalid={!!errors.objectiveId} aria-describedby={errors.objectiveId ? 'kr-objective-err' : undefined}
            onChange={e => { setObjectivePick(e.target.value); setErrors(x => ({ ...x, objectiveId: '' })) }}>
            {objectives.length !== 1 && <option value="">Выберите цель</option>}
            {objectives.map(o => <option key={o.id} value={o.id}>Цель {o.n} · {o.title}</option>)}
          </select>
          <FieldError id="kr-objective-err" text={errors.objectiveId} />
        </div>
      ) : (
        <div>
          <label htmlFor="kr-parent" className="label">Работает на результат компании</label>
          <select id="kr-parent" className="input" value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">Пока ни на какой</option>
            {parentMissing && <option value={parentId}>{editing?.parent?.title ?? 'Результат компании'}</option>}
            {companyKrs.map(k => (
              <option key={k.id} value={k.id}>
                {k.n != null ? `КР ${k.n} · ` : ''}{k.title} — {formatValue(k.value, k.unit)} из {formatTarget(k.target, k.unit, k.kind)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
            Прогресс этого результата будет виден в «Компасе» под результатом компании
          </p>
        </div>
      )}

      <div>
        <label htmlFor="kr-title" className="label">Название</label>
        <input id="kr-title" className="input" value={title} maxLength={200} autoFocus={!editing}
          aria-invalid={!!errors.title} aria-describedby={errors.title ? 'kr-title-err' : undefined}
          onChange={e => { setTitle(e.target.value); setErrors(x => ({ ...x, title: '' })) }}
          placeholder="Например, «Новые клиенты SMM»" />
        <FieldError id="kr-title-err" text={errors.title} />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="label mb-2">Откуда брать цифру</legend>
        {sourcesQ.isPending ? (
          <p role="status" className="flex items-center gap-2 text-sm text-surface-500">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Загружаем источники…
          </p>
        ) : sourcesQ.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-surface-600 dark:text-surface-300">
            Не удалось загрузить список источников.
            <button type="button" onClick={() => sourcesQ.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>
          </div>
        ) : (
          sources.map(s => {
            const on = source === s.key
            return (
              <label key={s.key}
                className={clsx('flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                  on
                    ? 'border-primary-600 bg-surface-100 dark:border-surface-300 dark:bg-surface-700/60'
                    : 'border-surface-200 bg-white hover:border-surface-400 dark:border-surface-700 dark:bg-surface-900 dark:hover:border-surface-500')}>
                <input type="radio" name="kr-source" value={s.key} checked={on} onChange={() => pickSource(s)}
                  className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-sm font-semibold text-surface-900 dark:text-surface-50">{s.label}</b>
                  <span className="text-xs text-surface-500 dark:text-surface-400">{s.hint}</span>
                </span>
              </label>
            )
          })
        )}
        <FieldError text={errors.source} />
      </fieldset>

      {paramKeys.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {paramKeys.map(k => {
            const options = k === 'direction' ? DIRECTION_OPTIONS
              : k === 'department' ? deptParamOptions(source)
              : [{ value: '', label: 'Выберите метрику' }, ...(sourcesQ.data?.kpiKeys ?? []).map(x => ({ value: x.key, label: x.label }))]
            return (
              <div key={k}>
                <label htmlFor={`kr-param-${k}`} className="label">{PARAM_LABEL[k]}</label>
                <select id={`kr-param-${k}`} className="input" value={params[k] ?? ''}
                  onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}>
                  {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {source && (
        <div role="status" aria-live="polite"
          className="rounded-lg border border-surface-200 bg-surface-100 px-3.5 py-3 text-sm text-surface-700 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300">
          {isManual
            ? 'Цифру отмечает ответственный или руководитель — прямо на «Компасе», у этого результата.'
            : isRollup
              ? 'Считается само: средний прогресс результатов отделов, которые работают на этот результат. Цель — 100 %.'
              : previewText}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="kr-target" className="label">{targetLabel}</label>
          <div className="relative">
            <input id="kr-target" className="input pr-12" inputMode="decimal" value={isRollup ? '100' : target}
              disabled={isRollup}
              aria-invalid={!!errors.target} aria-describedby={errors.target ? 'kr-target-err' : undefined}
              onChange={e => { setTarget(e.target.value); setErrors(x => ({ ...x, target: '' })) }} />
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-surface-500">
              {UNIT_SUFFIX[unit]}
            </span>
          </div>
          <FieldError id="kr-target-err" text={errors.target} />
        </div>

        {isManual && (
          <div>
            <label htmlFor="kr-unit" className="label">Единица</label>
            <select id="kr-unit" className="input" value={unitPick} onChange={e => setUnitPick(e.target.value as KrUnit)}>
              {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {isManual && editing?.canCheckin && (
          <div>
            <label htmlFor="kr-manual" className="label">Факт сейчас</label>
            <input id="kr-manual" className="input" inputMode="decimal" value={manual} placeholder="Пока нет"
              aria-invalid={!!errors.manual} aria-describedby={errors.manual ? 'kr-manual-err' : undefined}
              onChange={e => { setManual(e.target.value); setErrors(x => ({ ...x, manual: '' })) }} />
            <FieldError id="kr-manual-err" text={errors.manual} />
          </div>
        )}

        <div>
          <label htmlFor="kr-owner" className="label">Ответственный</label>
          <select id="kr-owner" className="input" value={ownerId} onChange={e => setOwnerId(e.target.value)}>
            <option value="">Не выбран</option>
            {ownerMissing && editing?.owner && <option value={editing.owner.id}>{editing.owner.name}</option>}
            {peopleSorted.map(p => <option key={p.id} value={p.id}>{p.name} · {getRoleLabel(p.role)}</option>)}
          </select>
          {people.isError && (
            <p className="mt-1 text-xs text-surface-500">Список сотрудников не загрузился — можно сохранить без ответственного.</p>
          )}
        </div>
      </div>

      {source === 'won_deals' && level === 'department' && department === 'sales' && (
        <p className="text-xs text-surface-500 dark:text-surface-400">
          После сохранения можно разложить цель по менеджерам — каждому создастся цель месяца.
        </p>
      )}

      {serverError && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{serverError}</p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-surface-200 pt-4 xs:flex-row xs:justify-end dark:border-surface-700">
        <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Отмена</button>
        <button type="submit" disabled={save.isPending} className="btn-primary min-h-[44px] lg:min-h-[36px]">
          {save.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {editing ? 'Сохранить' : 'Сохранить результат'}
        </button>
      </div>
    </form>
  )
}

// ── Шаг 2: «Разложить по менеджерам» ─────────────────────────────────

function DistributeStep({ kr, onClose }: { kr: KeyResultView; onClose: () => void }) {
  const people = useCompassPeople()
  if (people.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-surface-500">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Загружаем менеджеров…
      </p>
    )
  }
  if (people.isError) {
    return (
      <div role="alert" className="flex flex-col gap-3 py-2 text-sm text-surface-600 dark:text-surface-300">
        Результат сохранён, но список менеджеров не загрузился.
        <div className="flex gap-2">
          <button type="button" onClick={() => people.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Закрыть</button>
        </div>
      </div>
    )
  }
  const managers = (people.data ?? []).filter(p => p.department === 'sales')
  if (!managers.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="font-semibold text-surface-800 dark:text-surface-100">Раскладывать некому</p>
        <p className="max-w-xs text-sm text-surface-500 dark:text-surface-400">
          Результат сохранён. В отделе продаж сейчас нет активных менеджеров.
        </p>
        <button type="button" onClick={onClose} className="btn-secondary mt-2 min-h-[44px] lg:min-h-[36px]">Готово</button>
      </div>
    )
  }
  return <DistributeForm kr={kr} managers={managers} onClose={onClose} />
}

/** 15 на двоих → 8 и 7. */
function splitEvenly(total: number, n: number): number[] {
  const t = Math.max(0, Math.round(total))
  const base = Math.floor(t / n)
  const rem = t - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

function DistributeForm({ kr, managers, onClose }: { kr: KeyResultView; managers: GoalPerson[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const parts = splitEvenly(kr.target, managers.length)
    const v: Record<string, string> = {}
    managers.forEach((m, i) => { v[m.id] = String(parts[i]) })
    return v
  })
  const [error, setError] = useState<string | null>(null)

  const rows = managers.map(m => ({ userId: m.id, raw: values[m.id] ?? '', target: parseNum(values[m.id] ?? '') ?? 0 }))
  const total = rows.reduce((s, r) => s + r.target, 0)
  const matches = Math.abs(total - kr.target) < 0.001
  const nameOf = (id: string) => managers.find(m => m.id === id)?.name ?? 'сотрудник'

  const go = useMutation({
    mutationFn: () => compassApi.distribute(kr.id, rows.filter(r => r.target > 0).map(r => ({ userId: r.userId, target: r.target }))),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: compassKeys.all })
      if (res.created > 0) toast.success(`Цели месяца разложены: ${res.created} ${pluralRu(res.created, 'менеджер', 'менеджера', 'менеджеров')}`)
      else toast('Цели месяца не изменились')
      if (res.skipped?.length) {
        toast(`Не получилось: ${res.skipped.map(s => `${nameOf(s.userId)} — ${s.reason}`).join('; ')}`, { duration: 8000 })
      }
      onClose()
    },
    onError: (e: unknown) => setError(errorText(e, 'Не удалось создать цели')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const bad = rows.some(r => r.raw.trim() && (parseNum(r.raw) == null || r.target < 0 || !Number.isInteger(r.target)))
    if (bad) { setError('Укажите целое число сделок — 0 или больше'); return }
    if (!rows.some(r => r.target > 0)) { setError('Укажите хотя бы одному менеджеру число больше нуля'); return }
    setError(null)
    go.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-[13px] text-surface-600 dark:text-surface-300">
        Результат «{kr.title}» сохранён. Разложите цель {formatValue(kr.target, 'count')} по менеджерам — каждому
        создастся цель месяца с привязкой к этому результату. У кого уже 3 цели на месяц, новую не добавим.
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-x-4 gap-y-2 text-sm">
        {managers.map(m => (
          <Fragment key={m.id}>
            <label htmlFor={`dist-${m.id}`} className="min-w-0 break-words text-surface-800 dark:text-surface-100">
              {m.name} <span className="text-surface-500 dark:text-surface-400">· {getRoleLabel(m.role)}</span>
            </label>
            <input id={`dist-${m.id}`} className="input text-right tabular-nums" inputMode="numeric" value={values[m.id] ?? ''}
              onChange={e => setValues(v => ({ ...v, [m.id]: e.target.value }))} />
          </Fragment>
        ))}
        <span className="text-surface-500 dark:text-surface-400">Итого</span>
        <span aria-live="polite" className={clsx('text-right font-bold tabular-nums', matches ? 'text-green-500' : 'text-amber-500')}>
          {formatValue(total, 'count')} из {formatValue(kr.target, 'count')}
        </span>
      </div>
      {!matches && (
        <p className="text-xs text-surface-500 dark:text-surface-400">Сумма не совпадает с целью результата — так можно, но проверьте.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-col-reverse gap-2 border-t border-surface-200 pt-4 xs:flex-row xs:justify-end dark:border-surface-700">
        <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Пропустить</button>
        <button type="submit" disabled={go.isPending} className="btn-primary min-h-[44px] lg:min-h-[36px]">
          {go.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          Создать цели менеджерам
        </button>
      </div>
    </form>
  )
}
