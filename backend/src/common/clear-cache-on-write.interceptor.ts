import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { clearResponseCache } from './response-cache';

/** Сбросить короткий кэш ответов после записи через этот контроллер
 *  (08.11.2026). Не каждая запись шлёт событие изменения: перенос карточки
 *  в умном календаре, смены, цели месяца — без сброса человек после своего
 *  же действия до минуты видел бы старый ответ из кэша. Сбрасываем и при
 *  ошибке: запись могла пройти наполовину.
 *
 *  Вешается на контроллер, GET не трогает. Глобально не включаем: heartbeat
 *  каждого раз в минуту обнулял бы кэш постоянно. */
@Injectable()
export class ClearCacheOnWriteInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method = String(ctx.switchToHttp().getRequest()?.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();
    return next.handle().pipe(tap({
      next: () => clearResponseCache(),
      error: () => clearResponseCache(),
    }));
  }
}
