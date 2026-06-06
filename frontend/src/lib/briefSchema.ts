/**
 * Структура SMM-брифа клиента — 8 секций, 37 вопросов.
 * Источник: WeBrand_SMM_brief.pdf. Используется компонентом
 * ProjectBriefTab для рендера формы и хранения значений.
 */

export interface BriefField {
  /** Уникальный ключ — попадает в brief.answers[key] */
  key: string
  /** Номер вопроса (как в PDF) */
  num: number
  /** Подпись поля */
  label: string
  /** textarea для длинных ответов, иначе обычный input */
  long?: boolean
}

export interface BriefSection {
  title: string
  fields: BriefField[]
}

export const BRIEF_TARIFFS = ['Start', 'Business', 'Premium', 'Индивидуальный'] as const

export const BRIEF_SECTIONS: BriefSection[] = [
  {
    title: 'Контакты и организация',
    fields: [
      { key: 'q1',  num: 1,  label: 'Название компании / бренда.' },
      { key: 'q2',  num: 2,  label: 'ФИО и должность контактного лица.' },
      { key: 'q3',  num: 3,  label: 'Кто принимает финальные решения и согласует контент (ЛПР)? Контакты.', long: true },
      { key: 'q4',  num: 4,  label: 'Удобные каналы и время связи.' },
      { key: 'q5',  num: 5,  label: 'Кто со стороны клиента предоставляет фактуру (фото, информацию о продукте)?', long: true },
    ],
  },
  {
    title: 'О компании и продукте',
    fields: [
      { key: 'q6',  num: 6,  label: 'Сфера деятельности, ключевые продукты / услуги.', long: true },
      { key: 'q7',  num: 7,  label: 'Миссия, ценности, история бренда.', long: true },
      { key: 'q8',  num: 8,  label: 'УТП — чем вы лучше конкурентов (3–5 пунктов)?', long: true },
      { key: 'q9',  num: 9,  label: 'География работы (город, районы, доставка?).' },
      { key: 'q10', num: 10, label: 'Ценовой сегмент (эконом / средний / премиум).' },
      { key: 'q11', num: 11, label: 'Сильные и слабые стороны продукта (честно).', long: true },
      { key: 'q12', num: 12, label: 'Сайт и все действующие соцсети.', long: true },
      { key: 'q13', num: 13, label: 'Хиты продаж / самые маржинальные позиции для активного продвижения.', long: true },
    ],
  },
  {
    title: 'Целевая аудитория',
    fields: [
      { key: 'q14', num: 14, label: 'Опишите текущих клиентов (пол, возраст, доход, гео, интересы).', long: true },
      { key: 'q15', num: 15, label: 'Кого хотите привлекать дополнительно?', long: true },
      { key: 'q16', num: 16, label: 'Какие проблемы / потребности клиента решает ваш продукт?', long: true },
      { key: 'q17', num: 17, label: 'Барьеры и возражения перед покупкой?', long: true },
    ],
  },
  {
    title: 'Конкуренты',
    fields: [
      { key: 'q18', num: 18, label: '3–5 основных конкурентов (ссылки на их соцсети).', long: true },
      { key: 'q19', num: 19, label: 'Что нравится / не нравится в их соцсетях?', long: true },
      { key: 'q20', num: 20, label: 'Чем хотите от них отличаться?', long: true },
    ],
  },
  {
    title: 'Бренд, голос и визуал',
    fields: [
      { key: 'q21', num: 21, label: 'Есть ли брендбук / гайдлайн? Логотип, фирменные цвета, шрифты. (приложите)', long: true },
      { key: 'q22', num: 22, label: 'Tone of Voice: на «ты» / «вы», экспертно / по-дружески / с юмором?', long: true },
      { key: 'q23', num: 23, label: 'Стоп-слова и темы-табу (о чём нельзя писать).', long: true },
      { key: 'q24', num: 24, label: 'Референсы: аккаунты, которые нравятся, и что именно в них нравится.', long: true },
    ],
  },
  {
    title: 'Цели и задачи',
    fields: [
      { key: 'q25', num: 25, label: 'Главная цель SMM (продажи / узнаваемость / трафик / лояльность)?' },
      { key: 'q26', num: 26, label: 'На чём сделать акцент?', long: true },
      { key: 'q27', num: 27, label: 'Желаемый результат через 3 и 6 месяцев?', long: true },
      { key: 'q28', num: 28, label: 'Был ли опыт SMM раньше? Что получилось / не получилось?', long: true },
    ],
  },
  {
    title: 'Контент и продакшн',
    fields: [
      { key: 'q29', num: 29, label: 'Готовы ли сотрудники / руководитель появляться в кадре? Если привлекаем модель — какую? Кто будет в кадре?', long: true },
      { key: 'q30', num: 30, label: 'Какой бюджет готовы выделить на привлечение моделей (за съёмку / в месяц)? Сумма и валюта.', long: true },
      { key: 'q31', num: 31, label: 'Можно ли снимать на ваших локациях? Контактное лицо и график доступа.', long: true },
      { key: 'q32', num: 32, label: 'Есть ли готовый фото / видеоматериал, который можно использовать?', long: true },
      { key: 'q33', num: 33, label: 'Особые пожелания по подаче контента (что обязательно показывать, что точно не показывать).', long: true },
    ],
  },
  {
    title: 'Рекламный бюджет и доступы',
    fields: [
      { key: 'q34', num: 34, label: 'Рекламный бюджет на платное продвижение в месяц. Сумма и валюта.', long: true },
      { key: 'q35', num: 35, label: 'Приоритетная цель рекламы (заявки / трафик / охват / подписчики)?' },
      { key: 'q36', num: 36, label: 'Доступы к аккаунтам и рекламным кабинетам (передаются отдельно по защищённому каналу).', long: true },
      { key: 'q37', num: 37, label: 'Подключённые системы аналитики / CRM, если есть.', long: true },
    ],
  },
]

export const TOTAL_BRIEF_QUESTIONS = BRIEF_SECTIONS.reduce((s, sec) => s + sec.fields.length, 0)

/** Считает процент заполненности брифа (сколько вопросов с непустыми ответами). */
export function briefFilledPercent(brief: any): number {
  if (!brief || !brief.answers) return 0
  let filled = 0
  for (const sec of BRIEF_SECTIONS) {
    for (const f of sec.fields) {
      const v = brief.answers[f.key]
      if (typeof v === 'string' && v.trim().length > 0) filled++
    }
  }
  return Math.round((filled / TOTAL_BRIEF_QUESTIONS) * 100)
}
