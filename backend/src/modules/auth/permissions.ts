/**
 * Гранты (персональные доступы) — выдаются основателем/сооснователем/админом
 * на странице «Доступы сотрудников» поверх роли. Каждый грант описывает:
 *   - label    — что это (для UI выдачи);
 *   - category — раздел для группировки в UI;
 *   - roles    — роли, у которых право есть ИЗНАЧАЛЬНО (нативно);
 *   - danger   — необратимые/чувствительные операции (в UI с предупреждением).
 *
 * Итог для пользователя считает hasGrant():
 *   1) ключ в users.deniedPermissions  → НЕТ (запрет сильнее всего);
 *   2) роль или вторая роль в roles    → ДА;
 *   3) ключ в users.extraPermissions   → ДА;
 *   4) иначе                           → НЕТ.
 *
 * ВАЖНО про roles: список обязан в точности повторять @Roles эндпоинта,
 * который этим ключом закрывается. Тогда включение проверки гранта ничего
 * не меняет для существующих ролей, а гранты становятся честным слоем
 * «добавить/отнять» поверх ролевой модели.
 *
 * Управление доступами (страница «Доступы сотрудников») намеренно НЕ входит
 * в каталог: выдав его, сотрудник смог бы выдать себе всё остальное и обойти
 * любые ограничения. Оно остаётся строго за ролью admin/founder/co_founder —
 * это же гарантирует, что запретом нельзя закрыть себе путь назад.
 */
export interface GrantDef { label: string; category: string; roles: string[]; danger?: boolean }

const TOP = ['admin', 'founder', 'co_founder'];
const FOUNDERS = ['founder', 'co_founder'];

/** Все роли системы — для возможностей, которые нативно есть у каждого.
 *  Выдать такую нельзя (она и так есть), а вот ОТНЯТЬ запретом — можно. */
const ALL_ROLES = [
  'admin', 'founder', 'co_founder', 'smm_director', 'video_director', 'dev_director',
  'smm_specialist', 'designer', 'sales_manager_smm', 'sales_manager_dev',
  'pm_dev', 'developer', 'videographer', 'video_editor', 'organizer',
  'storymaker', 'scriptwriter', 'qa', 'publisher', 'targetologist', 'employee',
];

export const GRANTABLE: Record<string, GrantDef> = {
  // ─── Проекты ───────────────────────────────────────────────────────
  'projects.view':   { label: 'Проекты — просмотр',       category: 'Проекты', roles: [...TOP, 'smm_director', 'dev_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.create': { label: 'Проекты — добавление',     category: 'Проекты', roles: [...TOP, 'smm_director', 'dev_director', 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.edit':   { label: 'Проекты — редактирование', category: 'Проекты', roles: [...TOP, 'smm_director', 'dev_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev'] },
  // Архив/восстановление проектов. Нативно — те же роли, что были в @Roles
  // эндпоинта; грантом можно выдать другим (напр. проект-менеджеру по
  // разработке — он архивирует только dev-проекты, см. projects.service).
  'projects.archive': { label: 'Проекты — архивирование',  category: 'Проекты', roles: [...TOP, 'smm_director', 'dev_director', 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.delete':  { label: 'Проекты — удаление',       category: 'Проекты', roles: [...TOP, 'smm_director', 'dev_director', 'sales_manager_smm', 'sales_manager_dev'], danger: true },
  'projects.payments.view':    { label: 'Оплаты проекта — просмотр',  category: 'Проекты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev', 'smm_director', 'dev_director', 'video_director'] },
  'projects.payments.request': { label: 'Оплаты проекта — запрос',    category: 'Проекты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.brief.manage':     { label: 'Бриф проекта — заполнение',  category: 'Проекты', roles: [...TOP, 'smm_director', 'video_director', 'smm_specialist', 'sales_manager_smm', 'sales_manager_dev'] },
  'projects.brief.clear':      { label: 'Бриф проекта — очистка',     category: 'Проекты', roles: [...TOP, 'smm_director', 'video_director'], danger: true },
  'projects.launch.manage':    { label: 'Чек-лист запуска — отметки', category: 'Проекты', roles: [...TOP, 'smm_director', 'video_director'] },

  // ─── Организация съёмок ────────────────────────────────────────────
  'organizer.directory': { label: 'Организация съёмок — клиенты/модели/места', category: 'Проекты', roles: [...TOP, 'smm_director', 'organizer'] },

  // ─── Доска проектов и контент-план ─────────────────────────────────
  'board.view':          { label: 'Доска проектов — просмотр (все статусы)',      category: 'Доска проектов', roles: [...TOP, 'smm_director', 'video_director', 'organizer'] },
  'content-plan.manage': { label: 'Доска проектов — полное управление (все этапы)', category: 'Доска проектов', roles: [...TOP, 'smm_director', 'organizer'] },
  'content-plan.create': { label: 'Контент-план — добавление',     category: 'Доска проектов', roles: [...TOP, 'smm_director', 'video_director', 'smm_specialist'] },
  'content-plan.edit':   { label: 'Контент-план — редактирование', category: 'Доска проектов', roles: [...TOP, 'smm_director', 'video_director', 'smm_specialist'] },
  'content-plan.delete': { label: 'Контент-план — удаление',       category: 'Доска проектов', roles: [...TOP, 'smm_director', 'video_director'], danger: true },

  // ─── Задачи ────────────────────────────────────────────────────────
  // Задачи есть у каждого сотрудника — эти возможности нативны для всех
  // ролей. Выдавать нечего, зато можно точечно ОТНЯТЬ (например, запретить
  // удаление задач конкретному человеку).
  'tasks.view':   { label: 'Задачи — просмотр',       category: 'Задачи', roles: [...ALL_ROLES] },
  'tasks.create': { label: 'Задачи — добавление',     category: 'Задачи', roles: [...ALL_ROLES] },
  'tasks.edit':   { label: 'Задачи — редактирование', category: 'Задачи', roles: [...ALL_ROLES] },
  'tasks.delete': { label: 'Задачи — удаление',       category: 'Задачи', roles: [...ALL_ROLES], danger: true },
  'tasks.export': { label: 'Задачи — выгрузка CSV',   category: 'Задачи', roles: [...ALL_ROLES] },
  'tasks.approve':      { label: 'Задачи — подтверждение результата', category: 'Задачи', roles: [...TOP, 'smm_director', 'dev_director', 'video_director'] },
  'tasks.return':       { label: 'Задачи — возврат на доработку',     category: 'Задачи', roles: [...TOP, 'smm_director', 'dev_director', 'video_director'] },
  'tasks.bulk':         { label: 'Задачи — массовые операции',        category: 'Задачи', roles: [...TOP, 'smm_director', 'dev_director', 'video_director'] },
  'tasks.overdue.view': { label: 'Задачи — просроченные по компании', category: 'Задачи', roles: [...TOP, 'smm_director', 'dev_director', 'video_director'] },

  // ─── Календарь ─────────────────────────────────────────────────────
  'calendar.view':   { label: 'Календарь — просмотр', category: 'Календарь', roles: [...ALL_ROLES] },
  'calendar.create': { label: 'Календарь — создание задач кликом по дню', category: 'Календарь', roles: [...TOP, 'smm_director', 'dev_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev', 'pm_dev'] },

  // ─── Клиенты ───────────────────────────────────────────────────────
  'clients.view':    { label: 'Клиенты — просмотр',       category: 'Клиенты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'clients.create':  { label: 'Клиенты — добавление',     category: 'Клиенты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'clients.edit':    { label: 'Клиенты — редактирование', category: 'Клиенты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'clients.delete':  { label: 'Клиенты — удаление',       category: 'Клиенты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'], danger: true },
  'clients.kpi.all': { label: 'Клиенты — KPI всех менеджеров', category: 'Клиенты', roles: [...TOP] },

  // ─── Сотрудники ────────────────────────────────────────────────────
  'employees.view':   { label: 'Сотрудники — просмотр',       category: 'Сотрудники', roles: [...TOP, 'smm_director', 'dev_director', 'video_director'] },
  'employees.create': { label: 'Сотрудники — добавление',     category: 'Сотрудники', roles: [...TOP] },
  'employees.edit':   { label: 'Сотрудники — редактирование', category: 'Сотрудники', roles: [...TOP] },
  'employees.delete': { label: 'Сотрудники — удаление',       category: 'Сотрудники', roles: [...TOP], danger: true },
  'employees.salary.view': { label: 'Сотрудники — зарплаты',  category: 'Сотрудники', roles: [...FOUNDERS], danger: true },

  // ─── Команды ───────────────────────────────────────────────────────
  'teams.view':   { label: 'Команды — просмотр',   category: 'Сотрудники', roles: [...TOP, 'video_director'] },
  'teams.manage': { label: 'Команды — управление', category: 'Сотрудники', roles: [...FOUNDERS] },

  // ─── Отчёты ────────────────────────────────────────────────────────
  'reports.view':   { label: 'Отчёты — просмотр',       category: 'Аналитика и отчёты', roles: [...TOP, 'smm_director', 'dev_director', 'video_director'] },
  'reports.create': { label: 'Отчёты — добавление',     category: 'Аналитика и отчёты', roles: [...ALL_ROLES] },
  'reports.edit':   { label: 'Отчёты — редактирование', category: 'Аналитика и отчёты', roles: [...ALL_ROLES] },
  'reports.delete': { label: 'Отчёты — удаление',       category: 'Аналитика и отчёты', roles: [...TOP], danger: true },

  // ─── Аналитика ─────────────────────────────────────────────────────
  'analytics.view':           { label: 'Аналитика — просмотр',            category: 'Аналитика и отчёты', roles: [...TOP, 'smm_director', 'dev_director', 'video_director', 'sales_manager_smm', 'sales_manager_dev'] },
  'analytics.sales':          { label: 'Аналитика — продажи',             category: 'Аналитика и отчёты', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'analytics.payroll':        { label: 'Аналитика — фонд оплаты труда',   category: 'Аналитика и отчёты', roles: [...FOUNDERS], danger: true },
  'analytics.income-expense': { label: 'Аналитика — доходы и расходы',    category: 'Аналитика и отчёты', roles: [...FOUNDERS], danger: true },
  'analytics.export':         { label: 'Аналитика — выгрузка отчётов',    category: 'Аналитика и отчёты', roles: [...TOP] },

  // ─── Финансы ───────────────────────────────────────────────────────
  'finance.manage': { label: 'Финансы — доступ', category: 'Финансы', roles: [...FOUNDERS], danger: true },

  // ─── Истории, заметки, файлы, учёт времени ─────────────────────────
  'stories.manage':    { label: 'Истории — отметки по проектам',  category: 'Производство', roles: [...ALL_ROLES] },
  'notes.use':         { label: 'Заметки — личные записи',       category: 'Производство', roles: [...ALL_ROLES] },
  'time-tracker.use':  { label: 'Учёт времени — таймер',         category: 'Производство', roles: [...ALL_ROLES] },
  'files.view':        { label: 'Файлы — просмотр',              category: 'Производство', roles: [...ALL_ROLES] },
  'files.upload':      { label: 'Файлы — загрузка',              category: 'Производство', roles: [...ALL_ROLES] },
  'files.delete':      { label: 'Файлы — удаление',              category: 'Производство', roles: [...ALL_ROLES], danger: true },

  // ─── Тарифы и настройки ────────────────────────────────────────────
  'tariffs.manage': { label: 'SMM-тарифы — управление', category: 'Настройки', roles: [...TOP, 'smm_director'] },
  'tariffs.delete': { label: 'SMM-тарифы — удаление',   category: 'Настройки', roles: [...TOP], danger: true },
  'risks.view':     { label: 'Риски — просмотр',        category: 'Настройки', roles: [...TOP, 'smm_director', 'video_director'] },
  // Менеджеры продаж видят в «Архиве» СВОЙ личный список скрытых проектов
  // (см. project_hidden в projects.service) — им доступ нужен нативно.
  'archive.view':      { label: 'Архив — просмотр',            category: 'Настройки', roles: [...TOP, 'sales_manager_smm', 'sales_manager_dev'] },
  'security-log.view': { label: 'Журнал безопасности — доступ', category: 'Настройки', roles: [...TOP], danger: true },
  'ai.chat':           { label: 'ИИ-помощник — доступ',         category: 'Настройки', roles: [...TOP] },
};

/** Все валидные ключи грантов (для валидации входящих данных). */
export const GRANT_KEYS = Object.keys(GRANTABLE);

/** ВАЖНО: deniedPermissions обязателен. Поле нарочно НЕ опционально — иначе
 *  легко собрать объект вручную, забыть про запреты, и запрет молча перестанет
 *  действовать в этом месте (так и случилось однажды в workflow.service).
 *  Проще всего передавать сюда сам entity User. */
type GrantUser = {
  role?: string | null;
  secondaryRole?: string | null;
  extraPermissions?: string[] | null;
  deniedPermissions: string[] | null | undefined;
} | null | undefined;

/** Есть ли у пользователя возможность.
 *  Запрет сильнее всего: снимает и право роли, и выданный ранее грант. */
export function hasGrant(user: GrantUser, key: string): boolean {
  const def = GRANTABLE[key];
  if (!def || !user) return false;
  const denied = Array.isArray(user.deniedPermissions) ? user.deniedPermissions : [];
  if (denied.includes(key)) return false;
  if (def.roles.includes(user.role || '')) return true;
  if (user.secondaryRole && def.roles.includes(user.secondaryRole)) return true;
  const extra = Array.isArray(user.extraPermissions) ? user.extraPermissions : [];
  return extra.includes(key);
}

/** Очистка входящего списка ключей — только валидные, без дублей. */
export function sanitizeGrants(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((k: any) => typeof k === 'string' && GRANT_KEYS.includes(k)))];
}
