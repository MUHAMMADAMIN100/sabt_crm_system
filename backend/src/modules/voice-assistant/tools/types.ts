import { User } from '../../users/user.entity';
import { UserApi } from '../internal-api';
import { RefTable } from '../refs';

/** Кнопка Telegram (повтор TgButton, чтобы не тянуть модуль бота в тесты). */
export interface Button { text: string; callback_data: string }

/** Файл, присланный человеком в чат бота (фото или документ). */
export interface AttachedFile {
  name: string;
  mime: string;
  kind: 'photo' | 'document';
  /** Скачать содержимое из Telegram. */
  download: () => Promise<Buffer>;
}

export interface ToolContext {
  user: User;
  api: UserApi;
  refs: RefTable;
  /** Сегодня по Душанбе, YYYY-MM-DD. */
  today: string;
  /** Сейчас по Душанбе, HH:MM. */
  nowTime: string;
  /** Что человек сказал (расшифровка) — пишем в описание созданной задачи. */
  utterance: string;
  /** Файл, присланный вместе с просьбой (или перед ней). Нет — файла нет. */
  file?: AttachedFile;
}

/** Обратная операция для «↩ Отменить» — вызов API от того же человека. */
export interface UndoStep {
  method: 'PATCH' | 'POST' | 'DELETE' | 'PUT';
  path: string;
  body?: any;
}

export interface WriteOutcome {
  /** Что сделано — одной строкой, для ответа человеку. */
  summary: string;
  /** Как отменить. Нет — кнопку «Отменить» не показываем. */
  undo?: UndoStep[];
  /** Доп. кнопки (например «📎 Приложить результат»). */
  buttons?: Button[][];
  /** Сообщения в Telegram другим людям после успеха (штраф/премия —
   *  сотруднику). Сайт сам их не шлёт — шлёт бот. */
  notify?: Array<{ userId: string; text: string }>;
  /** Что сообщить тем же людям, если действие отменили кнопкой. */
  undoNotify?: Array<{ userId: string; text: string }>;
}

export interface ToolDef<A = any> {
  name: string;
  /** Для ИИ: когда вызывать, какими словами это просят. */
  description: string;
  /** JSON Schema аргументов. */
  parameters: Record<string, any>;
  kind: 'read' | 'write';
  /** Виден ли инструмент этому человеку (как кнопка на сайте). */
  available?: (user: User) => boolean;
  /** Нужно ли подтверждение перед выполнением. */
  confirm?: (args: A, ctx: ToolContext) => boolean;
  /** Текст «Понял так: …» для подтверждения. Заодно проверяет аргументы. */
  preview?: (args: A, ctx: ToolContext) => Promise<string>;
  /** read → данные для ИИ; write → WriteOutcome. */
  run: (args: A, ctx: ToolContext) => Promise<any>;
}

/** Инструмент сам решил, что без уточнения нельзя: бот покажет кнопки,
 *  выбор перезапустит разбор фразы с этим уточнением. Решает код, а не ИИ —
 *  чтобы ИИ не мог «додумать» за человека (например вид перерыва). */
export class NeedChoice extends Error {
  constructor(readonly question: string, readonly options: string[]) {
    super(question);
  }
}

/** Ошибка, которую стоит показать ИИ (а через него — человеку) как есть. */
export class ToolError extends Error {
  constructor(message: string, readonly buttons?: Button[][]) {
    super(message);
  }
}
