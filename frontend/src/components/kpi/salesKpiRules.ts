/**
 * KPI менеджера продаж: короткие подписи и правило счёта каждой метрики
 * (15.11.2026, «Продажи, этап 2»). Один источник для «Сегодня» менеджера и
 * карточки KPI сотрудника — раньше правила нигде не объяснялись, и менеджер
 * не понимал, почему назначенная встреча не прибавила KPI.
 * Правила совпадают с сервером: docs/SALES_SPEC.md §1, §4, §5.
 */
export type SalesKpiKey = 'funnel_progress' | 'new_companies' | 'cold_calls' | 'personal_emails' | 'meetings'

export const SALES_KPI_ORDER: SalesKpiKey[] = ['funnel_progress', 'new_companies', 'cold_calls', 'personal_emails', 'meetings']

/** Подписи на экране. «Холодные звонки» → «Звонки» (15.11.2026): считается
 *  любой звонок с итогом, не только холодный. */
export const SALES_KPI_LABEL: Record<SalesKpiKey, string> = {
  funnel_progress: 'Продвижения по воронке',
  new_companies:   'Новые компании',
  cold_calls:      'Звонки',
  personal_emails: 'Письма',
  meetings:        'Встречи',
}

/** Правило счёта — одно предложение на метрику. */
export const SALES_KPI_RULE: Record<SalesKpiKey, string> = {
  funnel_progress: '+1 за первое достижение лидом следующего этапа; повторный переход не считается.',
  new_companies:   'Лиды, которые вы сами создали за период.',
  cold_calls:      'Звонок с записанным итогом — не чаще одного на лид в день.',
  personal_emails: 'Отмеченное письмо — одно на лид в день.',
  meetings:        'Встреча засчитывается после отметки «Состоялась», а не при назначении.',
}

/** Ключ метрики без префикса: /kpi/user отдаёт sales_cold_calls, /clients/kpi — cold_calls. */
export function salesKpiKey(key: string): SalesKpiKey | null {
  const k = key.startsWith('sales_') ? key.slice(6) : key
  return (SALES_KPI_ORDER as string[]).includes(k) ? (k as SalesKpiKey) : null
}
