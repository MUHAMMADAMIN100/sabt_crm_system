import { Project, ProjectPaymentStatus } from './project.entity';

/** Ключи launch-чеклиста (10 пунктов из ТЗ). */
export const LAUNCH_KEYS = {
  CLIENT_ADDED:        'client_added',
  TARIFF_SELECTED:     'tariff_selected',
  PM_ASSIGNED:         'pm_assigned',
  SMM_ASSIGNED:        'smm_assigned',
  MATERIALS_RECEIVED:  'materials_received',
  ACCESSES_RECEIVED:   'accesses_received',
  FIRST_WEEK_PLANNED:  'first_week_planned',
  CONTENT_PLAN_READY:  'content_plan_ready',
  TASKS_CREATED:       'tasks_created',
  PAYMENT_CONFIRMED:   'payment_confirmed',
} as const;

/** Эти пункты можно проставить только вручную — детектора нет. */
export const MANUAL_LAUNCH_KEYS: string[] = [
  LAUNCH_KEYS.MATERIALS_RECEIVED,
  LAUNCH_KEYS.ACCESSES_RECEIVED,
];

/** Подписи на русском для UI и текста алертов. */
export const LAUNCH_LABELS: Record<string, string> = {
  [LAUNCH_KEYS.CLIENT_ADDED]:       'Клиент добавлен',
  [LAUNCH_KEYS.TARIFF_SELECTED]:    'Тариф выбран',
  [LAUNCH_KEYS.PM_ASSIGNED]:        'PM назначен',
  [LAUNCH_KEYS.SMM_ASSIGNED]:       'SMM-команда назначена',
  [LAUNCH_KEYS.MATERIALS_RECEIVED]: 'Материалы получены',
  [LAUNCH_KEYS.ACCESSES_RECEIVED]:  'Доступы получены',
  [LAUNCH_KEYS.FIRST_WEEK_PLANNED]: 'Первая неделя спланирована',
  [LAUNCH_KEYS.CONTENT_PLAN_READY]: 'Контент-план сформирован',
  [LAUNCH_KEYS.TASKS_CREATED]:      'Задачи созданы',
  [LAUNCH_KEYS.PAYMENT_CONFIRMED]:  'Оплата подтверждена',
};

export interface LaunchItem {
  key: string;
  label: string;
  done: boolean;
  manual: boolean;
}

export interface LaunchState {
  items: LaunchItem[];
  completedCount: number;
  totalCount: number;
  percent: number;
  isComplete: boolean;
}

/** Сигналы из БД, нужные для расчёта чеклиста (передаются из ProjectsService). */
export interface LaunchSignals {
  hasSmmMember: boolean;
  contentPlanCount: number;
  contentPlanFirstWeekCount: number;
  taskCount: number;
}

/** Главный вычислитель: берёт проект + сигналы + сохранённые ручные флаги
 *  и возвращает полное состояние чеклиста. */
export function computeLaunchState(
  project: Project,
  signals: LaunchSignals,
): LaunchState {
  const stored = project.launchChecklist || {};

  const auto: Record<string, boolean> = {
    [LAUNCH_KEYS.CLIENT_ADDED]:
      !!project.clientInfo && Object.keys(project.clientInfo).length > 0,
    [LAUNCH_KEYS.TARIFF_SELECTED]: !!project.tariffId,
    [LAUNCH_KEYS.PM_ASSIGNED]: !!project.managerId,
    [LAUNCH_KEYS.SMM_ASSIGNED]: signals.hasSmmMember,
    [LAUNCH_KEYS.FIRST_WEEK_PLANNED]: signals.contentPlanFirstWeekCount > 0,
    [LAUNCH_KEYS.CONTENT_PLAN_READY]: signals.contentPlanCount > 0,
    [LAUNCH_KEYS.TASKS_CREATED]: signals.taskCount > 0,
    [LAUNCH_KEYS.PAYMENT_CONFIRMED]:
      project.paymentStatus === ProjectPaymentStatus.PAID ||
      Number(project.paidAmount || 0) > 0,
  };

  const items: LaunchItem[] = Object.values(LAUNCH_KEYS).map(key => {
    const isManual = MANUAL_LAUNCH_KEYS.includes(key);
    // Для ручных пунктов берём только stored. Для авто — auto, но
    // ручной override через stored=true имеет приоритет (можно «закрыть» вручную).
    const done = isManual
      ? !!stored[key]
      : !!auto[key] || !!stored[key];
    return { key, label: LAUNCH_LABELS[key], done, manual: isManual };
  });

  const completedCount = items.filter(i => i.done).length;
  const totalCount = items.length;
  return {
    items,
    completedCount,
    totalCount,
    percent: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    isComplete: completedCount === totalCount,
  };
}
