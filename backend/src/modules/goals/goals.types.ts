/**
 * «Компас компании» — формы ответов API (16.11.2026).
 *
 * Копия frontend/src/types/goals.ts: фронтенд пишет код против неё, поэтому
 * сервер обязан отдавать ровно эти поля. Меняя форму — правьте обе стороны
 * и docs/GOALS_SPEC.md.
 */

export type DeptKey = 'sales' | 'smm' | 'dev' | 'management';
export type KrLevel = 'company' | 'department';
export type KrUnit = 'money' | 'count' | 'percent';
/** sum — копится за месяц (есть темп), rate — доля (больше — лучше), lower — меньше — лучше. */
export type KrKind = 'sum' | 'rate' | 'lower';
export type GoalStatus = 'on_track' | 'at_risk' | 'off_track' | 'done' | 'missed' | 'none';
export type CheckinStatus = 'on_track' | 'at_risk' | 'off_track';
export type SourceKey =
  | 'revenue' | 'overdue_share' | 'smm_retention' | 'won_deals' | 'new_leads'
  | 'content_ontime' | 'tasks_ontime' | 'stories_norm' | 'kpi_efficiency' | 'rollup' | 'manual';
export type SourceParamKey = 'direction' | 'department' | 'kpiKey';

export interface PersonRef {
  id: string;
  name: string;
  avatar?: string | null;
}

export interface SourceMeta {
  key: SourceKey;
  label: string;
  /** Одна строка: что именно считается. */
  hint: string;
  /** null — единицу выбирает автор (manual). */
  unit: KrUnit | null;
  kind: KrKind;
  /** Какие параметры источник принимает. */
  params: SourceParamKey[];
  /** true — только для результата компании (rollup). */
  companyOnly?: boolean;
}

export interface SourcesView {
  sources: SourceMeta[];
  /** Метрики KPI (для kpiKey). */
  kpiKeys: Array<{ key: string; label: string }>;
}

export interface SourcePreview {
  value: number | null;
  detail: string | null;
  unit: KrUnit;
}

export interface CheckinView {
  /** Понедельник недели, YYYY-MM-DD. */
  weekStart: string;
  status: CheckinStatus;
  comment: string | null;
  user: PersonRef | null;
  /** ISO-время отметки. */
  at: string;
}

export interface InitiativeView {
  id: string;
  kind: 'project' | 'task';
  refId: string;
  title: string;
  /** Короткое состояние: «в работе», «до 25 ноября», «готово». */
  state: string | null;
  /** Ссылка во фронтенде: /projects/:id или /tasks/:id. */
  link: string;
}

export interface KeyResultView {
  id: string;
  ym: string;
  level: KrLevel;
  department: DeptKey | null;
  objectiveId: string | null;
  parentId: string | null;
  /** Для КР отдела — КР компании, на который он работает. */
  parent: { id: string; n: number | null; title: string } | null;
  /** Номер КР компании в месяце (КР 1, КР 2 …); у КР отдела — null. */
  n: number | null;
  title: string;
  source: SourceKey;
  sourceLabel: string;
  sourceParams: Partial<Record<SourceParamKey, string>>;
  unit: KrUnit;
  kind: KrKind;
  target: number;
  value: number | null;
  /** Пояснение к цифре. */
  detail: string | null;
  /** 0–100+ для полосы; null — нет данных. */
  progress: number | null;
  /** Где должны быть сегодня (0–100), только kind=sum текущего месяца. */
  pace: number | null;
  /** Изменение за 7 дней в единицах КР; null — не считается. */
  trend: number | null;
  status: GoalStatus;
  /** Отметка текущей недели; нет — последняя в этом месяце; нет — null. */
  checkin: CheckinView | null;
  /** Отметки последних 5 недель месяца, по возрастанию weekStart. */
  history: Array<{ weekStart: string; status: CheckinStatus | null }>;
  owner: PersonRef | null;
  /** Для КР компании — отделы, чьи КР на него работают. */
  departments: DeptKey[];
  initiatives: InitiativeView[];
  manualValue: number | null;
  canEdit: boolean;
  canCheckin: boolean;
}

export interface ObjectiveView {
  id: string;
  /** Порядковый номер цели в месяце: 1, 2, 3. */
  n: number;
  title: string;
  owner: PersonRef | null;
  status: GoalStatus;
  keyResults: KeyResultView[];
  canEdit: boolean;
}

export interface DepartmentSummary {
  key: DeptKey;
  name: string;
  leader: PersonRef | null;
  members: number;
  status: GoalStatus;
  /** Сколько КР отдела в каждом статусе. */
  counts: Partial<Record<GoalStatus, number>>;
  krCount: number;
  /** Есть отметка недели хотя бы по одному КР отдела за текущую неделю. */
  checkedThisWeek: boolean;
  /** Сколько членов отдела без цели месяца; null — не видно actor-у. */
  withoutGoals: number | null;
}

export interface AttentionItem {
  kind: 'kr' | 'overdue' | 'plans' | 'checkin' | 'no_goals';
  tone: 'off_track' | 'at_risk' | 'info';
  /** Короткая метка слева: «КР 4», «Статус», «Отдел». */
  label: string;
  title: string;
  text: string | null;
  link: string | null;
  linkLabel: string | null;
  keyResultId?: string;
  department?: DeptKey;
}

/** КР, на который работает цель месяца сотрудника, с родителем. */
export interface ChainKeyResult {
  id: string;
  title: string;
  level: KrLevel;
  department: DeptKey | null;
  departmentName: string | null;
  progress: number | null;
  status: GoalStatus;
  parent: { id: string; title: string; progress: number | null; status: GoalStatus } | null;
}

/** Цель месяца сотрудника с цепочкой наверх. */
export interface ChainGoal {
  id: string;
  title: string;
  metric: string | null;
  target: number | null;
  value: number | null;
  done: boolean;
  reached: boolean;
  keyResult: ChainKeyResult | null;
}

export interface CompassView {
  ym: string;
  /** Сегодня по Душанбе, YYYY-MM-DD. */
  today: string;
  /** Сколько процентов месяца прошло (0–100). */
  elapsed: number;
  /** Дней до конца месяца (0 у прошедшего). */
  daysLeft: number;
  me: {
    id: string;
    isTop: boolean;
    /** Видит детали: экраны отделов, «Требует внимания», людей. */
    details: boolean;
    /** Отделы, которыми руководит. */
    leads: DeptKey[];
    /** Отдел по основной роли. */
    department: DeptKey | null;
  };
  /** Сколько КР компании в каждом статусе. */
  counts: Partial<Record<GoalStatus, number>>;
  objectives: ObjectiveView[];
  /** details — все отделы; иначе — только свой. */
  departments: DepartmentSummary[];
  /** Только details; иначе []. */
  attention: AttentionItem[];
  /** Цели месяца actor-а с цепочкой. */
  myChain: ChainGoal[];
  /** КР своего отдела — для сотрудника без details; details → []. */
  myDepartmentKeyResults: KeyResultView[];
  /** В прошлом месяце были цели/КР, которые можно перенести. */
  prevHasGoals: boolean;
  /** Может перенести цели прошлого месяца (isTop или руководитель). */
  canCopy: boolean;
  /** Может создавать цели и КР компании (isTop). */
  canManageCompany: boolean;
}

export interface PersonGoalRow {
  userId: string;
  name: string;
  avatar: string | null;
  role: string;
  goals: Array<{
    id: string;
    title: string;
    metric: string | null;
    target: number | null;
    value: number | null;
    done: boolean;
    reached: boolean;
    keyResultId: string | null;
    keyResultTitle: string | null;
  }>;
}

export interface DepartmentView {
  ym: string;
  today: string;
  elapsed: number;
  /** Понедельник текущей недели. */
  weekStart: string;
  department: { key: DeptKey; name: string; leader: PersonRef | null; members: number };
  status: GoalStatus;
  checkedThisWeek: boolean;
  keyResults: KeyResultView[];
  /** КР компании этого месяца — для «Работает на». */
  companyKeyResults: Array<{ id: string; n: number | null; title: string }>;
  /** Только details; иначе null. */
  people: PersonGoalRow[] | null;
  canEdit: boolean;
  canCheckin: boolean;
}

export interface CheckinFormView {
  weekStart: string;
  items: Array<{ keyResult: KeyResultView; departmentName: string | null }>;
}

export interface KeyResultInput {
  ym: string;
  level: KrLevel;
  department?: DeptKey | null;
  objectiveId?: string | null;
  parentId?: string | null;
  title: string;
  source: SourceKey;
  sourceParams?: Partial<Record<SourceParamKey, string>>;
  target: number;
  /** Только для manual; у остальных берётся из каталога. */
  unit?: KrUnit;
  ownerId?: string | null;
  sortOrder?: number;
}

export interface GoalSettingsView {
  /** Действующий руководитель отдела (с учётом значения по умолчанию). */
  leaders: Record<DeptKey, PersonRef | null>;
  /** Назначенный вручную; null — по умолчанию. */
  overrides: Record<DeptKey, string | null>;
  candidates: Array<{ id: string; name: string; role: string }>;
}

export interface GoalPerson {
  id: string;
  name: string;
  role: string;
  department: DeptKey | null;
}
