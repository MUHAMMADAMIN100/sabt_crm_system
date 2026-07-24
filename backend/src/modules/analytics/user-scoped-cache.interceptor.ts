import { CacheInterceptor, CACHE_KEY_METADATA } from '@nestjs/cache-manager';
import { ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';

/** Пометить эндпоинт как некэшируемый под классовым CacheInterceptor. Нужен
 *  для персональных данных, которые ещё и мутируют (напр. /analytics/sales —
 *  зависит от личного архива менеджера и меняется при скрытии проекта). */
export const SKIP_CACHE = 'cache:skip';
export const SkipCache = () => SetMetadata(SKIP_CACHE, true);

/**
 * Кэш аналитики с изоляцией по пользователю там, где ответ от пользователя
 * зависит.
 *
 * Обычный CacheInterceptor кэширует GET по URL, поэтому эндпоинт вроде
 * /analytics/sales отдавал ОДИН кэш всем: ответ, собранный для одного менеджера
 * продаж (его направление + личный архив), доставался другому. Здесь:
 *   - эндпоинты со СТАТИЧЕСКИМ @CacheKey — общие для всех (глобальные дашборды),
 *     ключ не трогаем;
 *   - остальные кэшируемые GET (без @CacheKey, напр. /sales) — ключ дополняется
 *     id пользователя, чтобы данные одного не утекали другому.
 */
@Injectable()
export class UserScopedCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    // Явный отказ от кэша (персональные мутирующие данные) — не кэшируем.
    const skip = this.reflector.get<boolean>(SKIP_CACHE, context.getHandler());
    if (skip) return undefined;

    const base = super.trackBy(context);
    if (!base) return undefined; // некэшируемый запрос — не трогаем

    // Явный @CacheKey → это общие данные, оставляем общий ключ.
    const explicit = this.reflector.get<string | undefined>(
      CACHE_KEY_METADATA,
      context.getHandler(),
    );
    if (explicit) return base;

    // Динамический эндпоинт без @CacheKey — изолируем по пользователю.
    const req = context.switchToHttp().getRequest();
    const uid = req?.user?.id || 'anon';
    return `${base}:u:${uid}`;
  }
}
