import { CacheInterceptor } from '@nestjs/cache-manager';
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
 * продаж (его направление + личный архив), доставался другому. Здесь ключ
 * любого кэшируемого GET дополняется id пользователя.
 *
 * Почему без исключений даже для статического @CacheKey: сводные ручки
 * аналитики теперь зависят от смотрящего (руководитель направления получает
 * цифры только своей сферы). Общая запись означала бы, что первый вошедший
 * прогревает кэш для всех остальных ролей.
 */
@Injectable()
export class UserScopedCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    // Явный отказ от кэша (персональные мутирующие данные) — не кэшируем.
    const skip = this.reflector.get<boolean>(SKIP_CACHE, context.getHandler());
    if (skip) return undefined;

    const base = super.trackBy(context);
    if (!base) return undefined; // некэшируемый запрос — не трогаем

    // Ключ ВСЕГДА персональный, даже при явном @CacheKey. Раньше статический
    // ключ считался «общими данными», но после появления направленческого
    // скоупа (руководитель разработки видит только свою сферу) один и тот же
    // URL отдаёт разный ответ разным людям: общая запись кэша показывала
    // Сабрине прогретые основателем цифры всей компании — и наоборот.
    const req = context.switchToHttp().getRequest();
    const uid = req?.user?.id || 'anon';
    return `${base}:u:${uid}`;
  }
}
