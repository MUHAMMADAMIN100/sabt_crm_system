export interface SmmQuestion {
  key: string
  label: string
  type: 'text' | 'textarea' | 'radio'
  options?: string[]
}

const SMM_QUESTIONS: SmmQuestion[] = [
  { key: 'companyName', label: 'Название компании', type: 'text' },
  { key: 'contactPerson', label: 'Контактное лицо', type: 'text' },
  { key: 'contactPhone', label: 'Телефон', type: 'text' },
  { key: 'services', label: 'Какие услуги вы предоставляете?', type: 'textarea' },
  { key: 'uniqueness', label: 'Чем вы отличаетесь от других конкурентов?', type: 'textarea' },
  { key: 'philosophy', label: 'Опишите ваш стиль работы/философию', type: 'textarea' },
  { key: 'socialProjects', label: 'Какие проекты вы хотите показывать в соцсетях?', type: 'textarea' },
  { key: 'smmGoals', label: 'Какие цели вы хотите достичь с помощью SMM?', type: 'textarea' },
  { key: 'socialNetworks', label: 'Какие соцсети нужно вести?', type: 'text' },
  { key: 'contentType', label: 'Какой тип контента вам нужен?', type: 'text' },
  { key: 'visualStyle', label: 'Какой стиль визуала вам нравится?', type: 'text' },
  { key: 'accountExamples', label: 'Примеры аккаунтов, которые вам нравятся', type: 'text' },
  { key: 'targetAudience', label: 'Кто ваша целевая аудитория?', type: 'textarea' },
  { key: 'competitors', label: 'Кто ваши конкуренты?', type: 'text' },
  { key: 'materialsFrequency', label: 'Как часто вы готовы предоставлять материалы?', type: 'text' },
  { key: 'forbiddenTopics', label: 'Какие темы точно НЕЛЬЗЯ публиковать?', type: 'textarea' },
  { key: 'priorityServices', label: 'Какие услуги вы хотите продвигать в первую очередь?', type: 'textarea' },
  { key: 'geography', label: 'География продвижения', type: 'text' },
  { key: 'promotionBudget', label: 'Бюджет на продвижение', type: 'text' },
  { key: 'hasMediaContent', label: 'Есть ли у вас фото/видео ваших проектов?', type: 'radio', options: ['Да', 'Нет', 'Другое'] },
  { key: 'wantsAds', label: 'Хотите запускать рекламу?', type: 'radio', options: ['Да', 'Нет', 'Другое'] },
]

export default SMM_QUESTIONS
