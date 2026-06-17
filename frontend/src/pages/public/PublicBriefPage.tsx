import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { publicBriefApi } from '@/services/api.service'
import BriefFormBody, { BriefDraft } from '@/components/projects/BriefFormBody'
import { briefFilledPercent, TOTAL_BRIEF_QUESTIONS } from '@/lib/briefSchema'
import { FileText, CheckCircle2, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Публичная страница брифа — открывается клиентом по ссылке
 * /public/brief/<token>. Без авторизации, без сайдбара.
 * После заполнения и отправки данные мгновенно попадают в проект
 * в нашей системе (broadcast 'projects:changed').
 */
export default function PublicBriefPage() {
  const { token = '' } = useParams<{ token: string }>()

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-brief', token],
    queryFn: () => publicBriefApi.get(token),
    enabled: !!token,
    retry: 1,
  })

  const initial = useMemo<BriefDraft>(() => ({
    tariff: data?.brief?.tariff || '',
    clientSignature: data?.brief?.clientSignature || '',
    managerSignature: data?.brief?.managerSignature || '',
    clientPhone: data?.brief?.clientPhone || '',
    answers: (data?.brief?.answers as Record<string, string>) || {},
  }), [data?.brief])

  const [draft, setDraft] = useState<BriefDraft>(initial)
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => { setDraft(initial) }, [initial])

  const saveMut = useMutation({
    mutationFn: () => publicBriefApi.save(token, {
      tariff: draft.tariff || null,
      clientSignature: draft.clientSignature,
      managerSignature: draft.managerSignature,
      clientPhone: draft.clientPhone || '',
      answers: draft.answers,
    }),
    onSuccess: () => {
      setSubmitted(true)
      toast.success('Бриф отправлен — спасибо!')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось отправить'),
  })

  const filledPercent = briefFilledPercent({ answers: draft.answers })
  const canSubmit = filledPercent >= 10 && !saveMut.isPending

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900">
        <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-900 px-4">
        <div className="text-center max-w-md">
          <AlertCircle size={56} className="mx-auto text-red-500 mb-4" />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">
            Бриф не найден
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Возможно, ссылка устарела или отозвана. Свяжитесь с вашим менеджером
            WeBrand для получения новой ссылки.
          </p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-primary-50 dark:from-green-900/20 dark:via-surface-900 dark:to-primary-900/20 px-4">
        <div className="text-center max-w-md">
          <CheckCircle2 size={72} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-3xl font-bold text-surface-900 dark:text-surface-100 mb-3">
            Спасибо!
          </h1>
          <p className="text-base text-surface-600 dark:text-surface-300 mb-2">
            Ваш бриф получен. Менеджер WeBrand свяжется с вами в ближайшее время.
          </p>
          <p className="text-xs text-surface-400 mt-6">
            Окно можно закрыть. Если нужно что-то добавить — обновите страницу и
            продолжите заполнение, мы получим изменения автоматически.
          </p>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="mt-6 text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            ← Вернуться к брифу
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-900">
      {/* Шапка */}
      <header className="bg-surface-50 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1 select-none">
              <span className="text-xl font-extrabold tracking-tight text-primary-600">
                WeBrand
              </span>
              <span className="text-xs text-surface-400 ml-2">SMM-бриф</span>
            </div>
            <h1 className="text-base font-semibold text-surface-900 dark:text-surface-100 mt-1 truncate">
              {data.projectName}
            </h1>
          </div>
          <div className="shrink-0 text-right">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full inline-block ${
              filledPercent === 100 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : filledPercent >= 50 ? 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-300'
                : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'
            }`}>
              {filledPercent}% заполнено
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Intro */}
        <div className="card mb-5">
          <div className="flex items-start gap-3">
            <FileText size={20} className="text-primary-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">
                Здравствуйте! Это бриф для нашего сотрудничества.
              </h2>
              <p className="text-sm text-surface-600 dark:text-surface-300 mt-1 leading-relaxed">
                Заполните вопросы максимально подробно — это поможет нам подготовить
                контент именно под ваш бренд. {TOTAL_BRIEF_QUESTIONS} вопросов в 8 разделах.
                Можно сохранить и продолжить позже — ответы не теряются.
              </p>
            </div>
          </div>
        </div>

        {/* Форма — у клиента селект тарифа скрыт (выбирает менеджер в системе). */}
        <BriefFormBody value={draft} onChange={setDraft} tariffs={[]} hideTariff />

        {/* Submit */}
        <div className="card mt-5 sticky bottom-4 shadow-xl border-primary-200 dark:border-primary-800">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-surface-500 dark:text-surface-400">
              Нажав «Отправить», вы передаёте ответы менеджеру WeBrand.
            </p>
            <button
              type="button"
              onClick={() => saveMut.mutate()}
              disabled={!canSubmit}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50 shadow"
            >
              {saveMut.isPending ? 'Отправляю…' : 'Отправить бриф'}
            </button>
          </div>
          {filledPercent < 10 && (
            <p className="text-[11px] text-surface-600 dark:text-surface-400 mt-2 text-center">
              Заполните хотя бы несколько полей перед отправкой
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
