/** Поля проекта, которые отдаются вместе со строками списков: задачи, сторис,
 *  контент-план, отчёты, учёт времени (08.11.2026).
 *
 *  Полная строка проекта несёт деньги (бюджет, оплачено, абонплата, договор,
 *  маржа), бриф со ссылкой для клиента, профиль клиента и jsonb-настройки —
 *  а списки видят все роли. Экранам из этих строк нужно только имя и тип
 *  (плюс статус/архив/цвет для подписей). Деньги и бриф — только в карточке
 *  проекта, где права проверяются отдельно.
 *
 *  Использование: `.leftJoin('t.project', 'project').addSelect(projectListFields('project'))`
 *  — алиас остаётся доступным в WHERE (фильтры по project.projectType работают). */
export const PROJECT_LIST_FIELDS = ['id', 'name', 'projectType', 'status', 'isArchived', 'color'] as const

export function projectListFields(alias: string): string[] {
  return PROJECT_LIST_FIELDS.map((f) => `${alias}.${f}`)
}
