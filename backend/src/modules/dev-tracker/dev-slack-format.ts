/** Плоский payload вебхука доски (контракт E) в Slack-совместимом виде. */

export interface DevSlackTask {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  /** Имя исполнителя (плоское поле payload.assignee). */
  assignee?: string | null;
  /** ISO-строка дедлайна или null. */
  deadline?: string | null;
  /** Имя проекта (плоское поле payload.project). */
  project?: string | null;
  /** Абсолютная ссылка на карточку. */
  url?: string | null;
}

export interface DevSlackMessage {
  /** Текст с mrkdwn-разметкой — fallback для уведомлений. */
  text: string;
  /** Структурированные блоки (section + fields) для rich-рендера. */
  blocks: Array<Record<string, any>>;
}

const EVENT_VERBS: Record<string, string> = {
  'task.created': 'создана',
  'task.moved': 'перемещена',
  'task.done': 'завершена',
  'task.commented': 'прокомментирована',
};

/** Текст + структурированные поля для Slack (mrkdwn-fallback).
 *  Чистая функция: по плоскому payload-полю задачи и событию строит
 *  {text, blocks}. Не ходит в сеть и не трогает репозитории. */
export function formatDevSlackMessage(task: DevSlackTask, event: string): DevSlackMessage {
  const verb = EVENT_VERBS[event] ?? event;
  const title = task?.title ?? '(без названия)';
  const link = task?.url ? `<${task.url}|${title}>` : title;

  const field = (label: string, value: string | null | undefined): string =>
    `*${label}:* ${value ?? '—'}`;

  const text =
    `Задача ${verb}: ${title}` +
    (task?.status ? ` • статус: ${task.status}` : '') +
    (task?.assignee ? ` • исполнитель: ${task.assignee}` : '') +
    (task?.url ? ` • ${task.url}` : '');

  const blocks: Array<Record<string, any>> = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Задача ${verb}:* ${link}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: field('Статус', task?.status ?? null) },
        { type: 'mrkdwn', text: field('Приоритет', task?.priority ?? null) },
        { type: 'mrkdwn', text: field('Исполнитель', task?.assignee ?? null) },
        { type: 'mrkdwn', text: field('Дедлайн', task?.deadline ?? null) },
        { type: 'mrkdwn', text: field('Проект', task?.project ?? null) },
        { type: 'mrkdwn', text: field('Событие', event) },
      ],
    },
  ];

  return { text, blocks };
}
