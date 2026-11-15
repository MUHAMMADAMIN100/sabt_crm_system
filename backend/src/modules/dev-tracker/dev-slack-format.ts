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

/** Экранирование управляющих символов Slack mrkdwn (15.11.2026): &, <, >.
 *  Без него «<» в названии задачи ломал ссылку <url|title> и позволял
 *  подсунуть свою разметку (<!channel>, <https://evil|…>). Другие символы
 *  Slack не декодирует — HTML-энтити не трогаем. */
export function escapeSlack(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Текст + структурированные поля для Slack (mrkdwn-fallback).
 *  Чистая функция: по плоскому payload-полю задачи и событию строит
 *  {text, blocks}. Не ходит в сеть и не трогает репозитории.
 *  Все пользовательские значения — через escapeSlack (15.11.2026). */
export function formatDevSlackMessage(task: DevSlackTask, event: string): DevSlackMessage {
  const verb = escapeSlack(EVENT_VERBS[event] ?? event);
  const title = escapeSlack(task?.title ?? '(без названия)');
  // '|' в URL закрыл бы адрес ссылки раньше времени — кодируем (15.11.2026).
  const url = task?.url ? escapeSlack(task.url).replace(/\|/g, '%7C') : null;
  const link = url ? `<${url}|${title}>` : title;

  const field = (label: string, value: string | null | undefined): string =>
    `*${label}:* ${value === null || value === undefined ? '—' : escapeSlack(value)}`;

  const text =
    `Задача ${verb}: ${title}` +
    (task?.status ? ` • статус: ${escapeSlack(task.status)}` : '') +
    (task?.assignee ? ` • исполнитель: ${escapeSlack(task.assignee)}` : '') +
    (url ? ` • ${url}` : '');

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
