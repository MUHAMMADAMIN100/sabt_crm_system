import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ImpersonationContext, impersonationStore, NO_IMPERSONATION } from './impersonation';

/**
 * Перехватчик входа «от имени» — для всех запросов приложения.
 *
 * 1) Запрещает то, что за сотрудника делать нельзя (@NoImpersonation).
 * 2) Выполняет запрос внутри контекста «от имени». Журналы (действий,
 *    безопасности) видят этот контекст и ничего не пишут: «Войти как» не
 *    оставляет следов — решение владельца 13.11.2026.
 */
@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const user = context.switchToHttp().getRequest()?.user;
    if (!user?.impersonatorId) return next.handle();

    const forbidden = this.reflector.getAllAndOverride<string>(NO_IMPERSONATION, [
      context.getHandler(), context.getClass(),
    ]);
    if (forbidden) throw new ForbiddenException(forbidden);

    const ctx: ImpersonationContext = { actorId: user.impersonatorId, targetId: user.id };
    return new Observable(subscriber => {
      // Обработчик подписывается внутри контекста — асинхронный код сервиса
      // (await, запросы к базе) видит его до самого конца запроса.
      const sub = impersonationStore.run(ctx, () => next.handle().subscribe(subscriber));
      return () => sub.unsubscribe();
    });
  }
}
