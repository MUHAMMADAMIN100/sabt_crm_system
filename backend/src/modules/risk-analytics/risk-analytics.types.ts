/** Wave 5: типы для аналитики плана-факта, нагрузки и рисков. */

export type RiskLevel = 'green' | 'yellow' | 'red';

export interface PlanFactRow {
  contentType: string;
  planned: number;       // позиций в контент-плане (status != cancelled)
  actual: number;        // фактически опубликовано
  cancelled: number;     // отменено
  remaining: number;     // ещё не выпущено и не отменено
  tariffLimit: number | null; // лимит из тарифа (null если тариф не задан)
  percent: number;       // % выполнения = actual / max(planned, tariffLimit)
  overuse: number;       // насколько фактический выпуск превысил лимит тарифа
  underuse: number;      // насколько недотянули до лимита тарифа
}

export interface EmployeeWorkload {
  userId: string;
  userName: string;
  role: string;
  projectCount: number;       // активных проектов где он member или manager
  tasksInProgress: number;    // задачи в работе
  tasksInQueue: number;       // задачи в очереди (new)
  plannedHours: number;       // сумма estimatedHours активных задач
  loggedHoursLast30d: number; // фактически потрачено за 30 дней
  overload: RiskLevel;
}

export interface PmWorkload {
  pmId: string;
  pmName: string;
  projectCount: number;            // проектов под управлением
  smmSpecialistCount: number;      // SMM-специалистов в его проектах
  tasksOnReview: number;           // задач на проверке (review / on_pm_review)
  tasksOnRework: number;           // задач на доработке (returned / on_rework)
  projectsAtRisk: number;          // подсчёт проектов с risk = yellow|red
}

export interface RiskFactor {
  key: string;
  label: string;
  triggered: boolean;
  weight: number;
  detail?: string;
}

export interface ProjectRisk {
  projectId: string;
  projectName: string;
  managerId: string | null;
  managerName: string | null;
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
}

export interface EmployeeRisk {
  userId: string;
  userName: string;
  role: string;
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
}
