import { clearResponseCache } from '../../common/response-cache';
import type { AppGateway } from './app.gateway';

/** Что именно поменялось в задачах (08.11.2026, третья волна).
 *  Фронт по этому решает, что перезапрашивать: тяжёлый список проектов
 *  (там счётчики задач и прогресс) нужен не после каждой правки названия.
 *    create / delete — задач стало больше или меньше;
 *    status          — сменился статус (меняются прогресс и «готово»);
 *    move            — задачу перенесли в другой проект или сменили тип;
 *    edit            — правка полей без влияния на счётчики проектов;
 *    bulk            — массовое действие, затронуто сразу многое;
 *    content         — изменились только карточки контент-плана (рилсы,
 *                      посты, съёмки), сами задачи не тронуты. */
export type TasksChangedKind = 'create' | 'delete' | 'status' | 'move' | 'edit' | 'bulk' | 'content';

/** Поля необязательные: старые клиенты их не читают, новый фронт без них
 *  обновляет всё, как раньше.
 *  projectId: строка — проект задачи; null — задача без проекта; поля нет —
 *  проект неизвестен (фронт обновит карточки всех проектов). */
export interface TasksChangedPayload {
  projectId?: string | null;
  taskId?: string | null;
  /** Кто изменил: по нему вкладка автора узнаёт эхо своей же правки. */
  actorId?: string | null;
  kind?: TasksChangedKind;
  /** Событие только про личные задачи — пришло лишь их владельцу. */
  personal?: boolean;
  /** Пришло из контент-плана: фронт обновит и умный календарь, «Мои
   *  задачи производства», план-факт и прочие экраны контента. */
  content?: boolean;
}

/** Единая отправка «задачи изменились».
 *
 *  Обычные задачи — рассылка всем через broadcast (он же сбрасывает
 *  короткий кэш ответов сервера). Личные видит только владелец, поэтому
 *  событие уходит лишь в его комнату `user:{id}` (onlyFor) — так его вторая
 *  вкладка и телефон видят заметку сразу, а остальные не перезапрашивают
 *  ничего ради чужой заметки. Кэш ответов сбрасываем и здесь: notifyUser,
 *  в отличие от broadcast, этого не делает.
 *
 *  Реалтайм вспомогательный: ошибка отправки не должна ронять операцию. */
export function emitTasksChanged(
  gateway: AppGateway | null | undefined,
  payload: TasksChangedPayload,
  onlyFor?: Array<string | null | undefined>,
): void {
  if (!gateway) return;
  try {
    if (onlyFor) {
      const ids = [...new Set(onlyFor.filter((x): x is string => typeof x === 'string' && !!x))];
      if (!ids.length) return;
      clearResponseCache();
      const data = { ...payload, personal: true };
      for (const id of ids) gateway.notifyUser(id, 'tasks:changed', data);
      return;
    }
    gateway.broadcast('tasks:changed', payload);
  } catch {
    /* best-effort: см. AppGateway.safeEmit */
  }
}
