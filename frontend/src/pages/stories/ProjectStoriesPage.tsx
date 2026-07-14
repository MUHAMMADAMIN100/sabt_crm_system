import StoryCalendar from '@/components/stories/StoryCalendar'

/**
 * «Истории по проектам» — рабочий экран сторисмейкера. Показывает ВСЕ
 * SMM-проекты системы; по каждому можно отметить количество сторис за каждый
 * день. Отметки попадают в аналитику руководителей (StoryCalendar adminAll).
 */
export default function ProjectStoriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Истории по проектам</h1>
        <p className="text-surface-500 dark:text-surface-400 mt-0.5">
          Отмечайте количество сторис по каждому SMM-проекту за каждый день.
        </p>
      </div>
      {/* Режим сторисмейкера: хотя бы одна сторис за день — зелёный. */}
      <StoryCalendar greenAnyProgress />
    </div>
  )
}
