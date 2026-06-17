import { useQuery } from '@tanstack/react-query'
import { smmTariffsApi } from '@/services/api.service'
import { BRIEF_SECTIONS } from '@/lib/briefSchema'

export interface BriefDraft {
  tariff: string
  clientSignature: string
  managerSignature: string
  /** Телефон клиента — заполняет клиент в публичном брифе. */
  clientPhone?: string
  answers: Record<string, string>
}

interface Props {
  value: BriefDraft
  onChange: (next: BriefDraft) => void
  /** Заблокировать все поля (read-only). */
  disabled?: boolean
  /** Доп. блок шапки — например, имя компании и дата создания
   *  (показывается только в существующем проекте). */
  headerExtra?: React.ReactNode
  /** Загружать ли тарифы через API. Для публичной страницы клиента
   *  передаём готовый список — иначе требуется auth. */
  tariffs?: Array<{ id?: string; name: string }>
  /** Скрыть селект тарифа — для клиентского (публичного) брифа: клиент
   *  не выбирает тариф, это делает менеджер внутри системы. */
  hideTariff?: boolean
}

/**
 * Чистая форма брифа без логики сохранения — родитель сам решает что
 * делать с onChange. Используется в:
 *  - ProjectBriefTab (вкладка карточки проекта)
 *  - ProjectsPage (модалка «Заполнить бриф» при создании проекта)
 *  - PublicBriefPage (страница для клиента, доступная по ссылке)
 */
export default function BriefFormBody({
  value, onChange, disabled = false, headerExtra, tariffs: tariffsProp, hideTariff = false,
}: Props) {
  const { data: loadedTariffs } = useQuery({
    queryKey: ['smm-tariffs', { isActive: true }],
    queryFn: () => smmTariffsApi.list({ isActive: true }),
    enabled: !tariffsProp,
  })
  const tariffs = tariffsProp || loadedTariffs || []

  const setAnswer = (key: string, v: string) =>
    onChange({ ...value, answers: { ...value.answers, [key]: v } })

  return (
    <div className="space-y-4">
      {/* Шапка: переданный extra (название/дата) + селект тарифа.
          На клиентском (публичном) брифе тариф скрыт — клиент его не выбирает. */}
      {(headerExtra || !hideTariff) && (
        <div className="card grid grid-cols-1 sm:grid-cols-3 gap-3">
          {headerExtra}
          {!hideTariff && (
            <div>
              <label className="label text-xs">Тариф</label>
              <select
                className="input"
                value={value.tariff}
                onChange={e => onChange({ ...value, tariff: e.target.value })}
                disabled={disabled}
              >
                <option value="">— Не выбран —</option>
                {tariffs.map((t: any) => (
                  <option key={t.id || t.name} value={t.name}>{t.name}</option>
                ))}
                {value.tariff && !tariffs.some((t: any) => t.name === value.tariff) && (
                  <option value={value.tariff}>{value.tariff} (архивный)</option>
                )}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Секции с вопросами */}
      {BRIEF_SECTIONS.map((sec, idx) => (
        <div key={sec.title} className="card">
          <h3 className="text-base font-bold text-surface-900 dark:text-surface-100 mb-3 pb-2 border-b border-surface-100 dark:border-surface-700">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-bold mr-2">
              {idx + 1}
            </span>
            {sec.title}
          </h3>
          <div className="space-y-3">
            {sec.fields.map(f => (
              <div key={f.key}>
                <label className="label text-xs flex items-start gap-2">
                  <span className="text-surface-400 font-mono shrink-0 mt-0.5">{f.num}.</span>
                  <span>{f.label}</span>
                </label>
                {f.long ? (
                  <textarea
                    className="input min-h-[72px] resize-y"
                    value={value.answers[f.key] || ''}
                    onChange={e => setAnswer(f.key, e.target.value)}
                    disabled={disabled}
                    placeholder="—"
                  />
                ) : (
                  <input
                    className="input"
                    value={value.answers[f.key] || ''}
                    onChange={e => setAnswer(f.key, e.target.value)}
                    disabled={disabled}
                    placeholder="—"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Подписи + телефон клиента */}
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label text-xs">Клиент</label>
          <input
            className="input"
            value={value.clientSignature}
            onChange={e => onChange({ ...value, clientSignature: e.target.value })}
            disabled={disabled}
            placeholder="ФИО клиента"
          />
        </div>
        <div>
          <label className="label text-xs">Телефон клиента</label>
          <input
            className="input"
            type="tel"
            value={value.clientPhone || ''}
            onChange={e => onChange({ ...value, clientPhone: e.target.value })}
            disabled={disabled}
            placeholder="+992 ..."
          />
        </div>
        <div>
          <label className="label text-xs">Менеджер WeBrand</label>
          <input
            className="input"
            value={value.managerSignature}
            onChange={e => onChange({ ...value, managerSignature: e.target.value })}
            disabled={disabled}
            placeholder="ФИО менеджера"
          />
        </div>
      </div>
    </div>
  )
}
