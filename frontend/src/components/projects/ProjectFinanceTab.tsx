import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { DatePicker } from '@/components/ui/DatePicker'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { DollarSign, TrendingUp, AlertCircle, Edit, Save, X } from 'lucide-react'
import { projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

interface FinanceProject {
  id: string
  name: string
  totalContractValue: number | string | null
  paidAmount: number | string | null
  outstandingAmount: number | string | null
  internalCostEstimate: number | string | null
  marginEstimate: number | string | null
  tariffLimitOveruseCost: number | string | null
  paymentStatus: string
  nextPaymentDate: string | null
  startBillingDate: string | null
  monthlyFee: number | string | null
  billingType: string | null
  tariffNameSnapshot: string | null
  tariffPriceSnapshot: number | string | null
  discount?: number | string | null
  discountType?: 'fixed' | 'percent' | null
}

const PAYMENT_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:        { label: 'Ожидает',        color: 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300' },
  invoice_sent:   { label: 'Счёт отправлен', color: 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400' },
  partially_paid: { label: 'Частично',       color: 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400' },
  paid:           { label: 'Оплачено ✓',     color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  overdue:        { label: 'Просрочено',     color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  frozen:         { label: 'Заморожено',     color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
}

const fmt = (v: number | string | null | undefined) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('ru-RU').format(n) + ' сомони'
}

const FINANCE_ROLES = ['founder', 'co_founder']

export default function ProjectFinanceTab({ project }: { project: FinanceProject }) {
  const role = useAuthStore(s => s.user?.role)
  const canEdit = !!role && FINANCE_ROLES.includes(role)
  const qc = useQueryClient()
  const [editMode, setEditMode] = useState(false)

  const { register, handleSubmit, reset, watch, control } = useForm({
    defaultValues: {
      totalContractValue: Number(project.totalContractValue ?? 0),
      paidAmount: Number(project.paidAmount ?? 0),
      internalCostEstimate: Number(project.internalCostEstimate ?? 0),
      tariffLimitOveruseCost: Number(project.tariffLimitOveruseCost ?? 0),
      discount: Number((project as any).discount ?? 0),
      discountType: ((project as any).discountType as string) || 'fixed',
      paymentStatus: project.paymentStatus || 'pending',
      nextPaymentDate: project.nextPaymentDate
        ? new Date(project.nextPaymentDate).toISOString().split('T')[0]
        : '',
      monthlyFee: Number(project.monthlyFee ?? 0),
    },
  })

  // Live preview of derived fields while editing (с учётом скидки)
  const total = Number(watch('totalContractValue') || 0)
  const paid = Number(watch('paidAmount') || 0)
  const internalCost = Number(watch('internalCostEstimate') || 0)
  const discountValue = Number(watch('discount') || 0)
  const discountType = (watch('discountType') as string) || 'fixed'
  const computedDiscount = discountType === 'percent'
    ? (total * Math.min(100, Math.max(0, discountValue))) / 100
    : Math.max(0, discountValue)
  const effectiveTotal = Math.max(0, total - computedDiscount)
  const previewOutstanding = Math.max(0, effectiveTotal - paid)
  const previewMargin = effectiveTotal - internalCost
  const previewMarginPct = effectiveTotal > 0 ? Math.round((previewMargin / effectiveTotal) * 100) : 0

  useEffect(() => {
    reset({
      totalContractValue: Number(project.totalContractValue ?? 0),
      paidAmount: Number(project.paidAmount ?? 0),
      internalCostEstimate: Number(project.internalCostEstimate ?? 0),
      tariffLimitOveruseCost: Number(project.tariffLimitOveruseCost ?? 0),
      discount: Number((project as any).discount ?? 0),
      discountType: ((project as any).discountType as string) || 'fixed',
      paymentStatus: project.paymentStatus || 'pending',
      nextPaymentDate: project.nextPaymentDate
        ? new Date(project.nextPaymentDate).toISOString().split('T')[0]
        : '',
      monthlyFee: Number(project.monthlyFee ?? 0),
    })
  }, [project, reset])

  const updateMut = useMutation({
    mutationFn: (data: any) => projectsApi.update(project.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] })
      qc.invalidateQueries({ queryKey: ['project-risk', project.id] })
      qc.invalidateQueries({ queryKey: ['plan-fact', project.id] })
      setEditMode(false)
      toast.success('Финансы обновлены')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const onSubmit = (data: any) => {
    updateMut.mutate({
      totalContractValue: Number(data.totalContractValue) || null,
      paidAmount: Number(data.paidAmount) || null,
      internalCostEstimate: Number(data.internalCostEstimate) || null,
      tariffLimitOveruseCost: Number(data.tariffLimitOveruseCost) || null,
      discount: Number(data.discount) || 0,
      discountType: data.discountType === 'percent' ? 'percent' : 'fixed',
      paymentStatus: data.paymentStatus,
      nextPaymentDate: data.nextPaymentDate || null,
      monthlyFee: Number(data.monthlyFee) || null,
    })
  }

  const totalRaw = Number(project.totalContractValue ?? 0)
  const paidRaw = Number(project.paidAmount ?? 0)
  const outstanding = Number(project.outstandingAmount ?? 0)
  const margin = Number(project.marginEstimate ?? 0)
  const marginPct = totalRaw > 0 ? Math.round((margin / totalRaw) * 100) : 0
  const paidPct = totalRaw > 0 ? Math.min(100, Math.round((paidRaw / totalRaw) * 100)) : 0

  const statusInfo = PAYMENT_STATUS_LABEL[project.paymentStatus] || PAYMENT_STATUS_LABEL.pending

  // ─── READ MODE ──────────────────────────────────────────────────────
  if (!editMode) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <DollarSign size={18} className="text-green-500" /> Финансы проекта
          </h2>
          {canEdit && (
            <button onClick={() => setEditMode(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Edit size={14} /> Редактировать
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FinanceCard label="Контракт (всего)" value={fmt(project.totalContractValue)} accent="text-surface-600" />
          {(() => {
            const dVal = Number((project as any).discount ?? 0)
            const dType = (project as any).discountType as string
            const isPct = dType === 'percent'
            const displayValue = dVal > 0
              ? (isPct
                  ? `−${dVal.toLocaleString('ru-RU')}%`
                  : `−${fmt(dVal)}`)
              : '—'
            const sub = dVal > 0
              ? (isPct
                  ? `≈ ${fmt((Number(project.totalContractValue ?? 0) * dVal) / 100)}`
                  : 'Фиксированная')
              : undefined
            return (
              <FinanceCard
                label="Скидка"
                value={displayValue}
                sub={sub}
                accent={dVal > 0 ? 'text-surface-600' : 'text-gray-500'}
              />
            )
          })()}
          <FinanceCard label="Оплачено" value={fmt(project.paidAmount)} accent="text-green-600" />
          <FinanceCard label="К оплате" value={fmt(project.outstandingAmount)} accent={outstanding > 0 ? 'text-red-600' : 'text-gray-500'} />
          <FinanceCard label="Себестоимость" value={fmt(project.internalCostEstimate)} accent="text-surface-600" />
          <FinanceCard
            label="Маржа"
            value={fmt(project.marginEstimate)}
            sub={totalRaw > 0 ? `${marginPct}% от контракта` : undefined}
            accent={margin > 0 ? 'text-green-600' : margin < 0 ? 'text-red-600' : 'text-gray-500'}
          />
          <FinanceCard
            label="Перерасход тарифа"
            value={fmt(project.tariffLimitOveruseCost)}
            accent={Number(project.tariffLimitOveruseCost ?? 0) > 0 ? 'text-red-600' : 'text-gray-500'}
          />
        </div>

        {totalRaw > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Прогресс оплаты</span>
              <span className="text-xs text-gray-500">{paidPct}%</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className={clsx('h-full transition-all', paidPct >= 100 ? 'bg-green-500' : paidPct >= 50 ? 'bg-surface-500' : 'bg-red-500')} style={{ width: `${paidPct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>{fmt(project.paidAmount)} из {fmt(project.totalContractValue)}</span>
              <span>Остаток: {fmt(project.outstandingAmount)}</span>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3">Параметры биллинга</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Статус оплаты">
              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', statusInfo.color)}>{statusInfo.label}</span>
            </Row>
            <Row label="Следующий платёж" value={project.nextPaymentDate ? new Date(project.nextPaymentDate).toLocaleDateString('ru-RU') : '—'} />
            <Row label="Тип биллинга" value={project.billingType === 'monthly' ? 'Ежемесячно' : project.billingType === 'one_time' ? 'Разово' : project.billingType === 'recurring' ? 'Периодически' : '—'} />
            <Row label="Ежемесячная плата" value={fmt(project.monthlyFee)} />
            <Row label="Привязанный тариф" value={project.tariffNameSnapshot ?? '—'} />
            <Row label="Цена тарифа (snapshot)" value={fmt(project.tariffPriceSnapshot)} />
            <Row label="Старт биллинга" value={project.startBillingDate ? new Date(project.startBillingDate).toLocaleDateString('ru-RU') : '—'} />
          </dl>
        </div>

        {!canEdit && (
          <p className="text-xs text-gray-500 italic flex items-start gap-1">
            <AlertCircle size={12} className="mt-0.5" /> Финансовые поля доступны для просмотра, но изменять может только основатель/сооснователь.
          </p>
        )}
      </div>
    )
  }

  // ─── EDIT MODE ──────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <Edit size={16} /> Редактирование финансов
        </h2>
        <button type="button" onClick={() => setEditMode(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Контракт (всего)" hint="Полная сумма по договору">
          <input type="number" step="0.01" {...register('totalContractValue')} className="input" />
        </Field>
        <Field label="Оплачено" hint="Сколько клиент уже заплатил">
          <input type="number" step="0.01" {...register('paidAmount')} className="input" />
        </Field>
        <Field label="Скидка (тип)" hint="Фиксированная сумма или процент от контракта">
          <select {...register('discountType')} className="input">
            <option value="fixed">Фиксированная</option>
            <option value="percent">Процентная</option>
          </select>
        </Field>
        <Field label="Значение скидки" hint={discountType === 'percent' ? 'Процент от подытога (0–100)' : 'Сумма в сомони'}>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0"
              max={discountType === 'percent' ? '100' : undefined}
              {...register('discount')}
              className="input pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-500 pointer-events-none">
              {discountType === 'percent' ? '%' : 'TJS'}
            </span>
          </div>
        </Field>
        <Field label="К оплате (авто)" hint={`= ${fmt(effectiveTotal)} − ${fmt(paid)} (скидка: ${fmt(computedDiscount)})`}>
          <input value={fmt(previewOutstanding)} disabled className="input bg-gray-50 dark:bg-gray-800 cursor-not-allowed" />
        </Field>
        <Field label="Себестоимость" hint="Внутренние расходы агентства">
          <input type="number" step="0.01" {...register('internalCostEstimate')} className="input" />
        </Field>
        <Field label="Маржа (авто)" hint={`= (контракт − скидка) − себестоимость · ${previewMarginPct}%`}>
          <input value={fmt(previewMargin)} disabled className="input bg-gray-50 dark:bg-gray-800 cursor-not-allowed" />
        </Field>
        <Field label="Перерасход тарифа (сомони)" hint="Авто-пересчёт по факту published > limit. Можно перебить вручную.">
          <input type="number" step="0.01" {...register('tariffLimitOveruseCost')} className="input" />
        </Field>
        <Field label="Ежемесячная плата">
          <input type="number" step="0.01" {...register('monthlyFee')} className="input" />
        </Field>
        <Field label="Следующий платёж">
          <Controller name="nextPaymentDate" control={control}
            render={({ field }) => <DatePicker value={field.value || ''} onChange={field.onChange} />} />
        </Field>
        <Field label="Статус оплаты">
          <select {...register('paymentStatus')} className="input">
            {Object.entries(PAYMENT_STATUS_LABEL).map(([v, info]) => (
              <option key={v} value={v}>{info.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={() => setEditMode(false)} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">Отмена</button>
        <button type="submit" disabled={updateMut.isPending} className="px-4 py-2 rounded-lg text-sm bg-green-600 hover:bg-green-700 text-white inline-flex items-center gap-1 disabled:opacity-50">
          <Save size={14} /> {updateMut.isPending ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

function FinanceCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={clsx('text-xl font-bold', accent || 'text-gray-900 dark:text-gray-100')}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-right">{children ?? value ?? '—'}</dd>
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}
