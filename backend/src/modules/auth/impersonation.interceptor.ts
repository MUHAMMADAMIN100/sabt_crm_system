import {
  CallHandler, ExecutionContext, ForbiddenException, Injectable, Logger, NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { ImpersonationContext, impersonationStore, NO_IMPERSONATION } from './impersonation';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Служебные запросы, которые не являются действиями человека. */
const SILENT_PATHS = [/^\/auth\/heartbeat/, /^\/auth\/impersonate/, /^\/auth\/logout/];

/** Раздел по адресу — чтобы в журнале было «Задачи», а не голый путь. */
const SECTIONS: Array<[RegExp, string]> = [
  [/^\/(tasks|dev-tasks|task)/, 'Задачи'],
  [/^\/projects/, 'Проекты'],
  [/^\/content-plan/, 'Контент-план'],
  [/^\/(clients|client-leads|leads|sales)/, 'Клиенты'],
  [/^\/(stories|story)/, 'Сторис'],
  [/^\/notifications/, 'Уведомления'],
  [/^\/(comments|task-comments)/, 'Комментарии'],
  [/^\/(notes|personal-notes)/, 'Заметки'],
  [/^\/(work-shifts|shifts)/, 'Смены'],
  [/^\/finance/, 'Финансы'],
  [/^\/(direct|instagram)/, 'Директ'],
  [/^\/(users|employees|profile)/, 'Профиль и сотрудники'],
  [/^\/(files|uploads|attachments)/, 'Файлы'],
  [/^\/(transport)/, 'Транспорт'],
];

const VERBS: Record<string, string> = { POST: 'Создал / отправил', PUT: 'Изменил', PATCH: 'Изменил', DELETE: 'Удалил' };

/**
 * Перехватчик входа «от имени» — для всех запросов приложения.
 *
 * 1) Запрещает то, что за сотрудника делать нельзя (@NoImpersonation).
 * 2) Выполняет запрос внутри контекста «от имени»: журналы сами помечают
 *    свои записи настоящим автором (см. ActivityLogService.log).
 * 3) Если обработчик ничего в журнал не записал, а запрос что-то менял —
 *    пишем общую строку «действие в кабинете сотрудника». Так в журнале
 *    остаётся след КАЖДОГО изменения, а не только тех, что журналирует сервис.
 */
@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Impersonation');

  constructor(private reflector: Reflector, private activityLog: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user?.impersonatorId) return next.handle();

    const forbidden = this.reflector.getAllAndOverride<string>(NO_IMPERSONATION, [
      context.getHandler(), context.getClass(),
    ]);
    if (forbidden) throw new ForbiddenException(forbidden);

    const method = String(req.method || '').toUpperCase();
    const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api/, '') || '/';
    const ctx: ImpersonationContext = {
      actorId: user.impersonatorId,
      actorName: user.impersonatorName || 'Администратор',
      actorRole: user.impersonatorRole || 'admin',
      targetId: user.id,
      targetName: user.name,
      logged: 0,
    };
    const writeTrail = WRITE_METHODS.has(method) && !SILENT_PATHS.some(re => re.test(path));

    return new Observable(subscriber => {
      // Обработчик подписывается внутри контекста — асинхронный код сервиса
      // (await, запросы к базе) видит его до самого конца запроса.
      const sub = impersonationStore.run(ctx, () =>
        next.handle().pipe(
          tap(() => {
            if (!writeTrail || ctx.logged > 0) return;
            const section = SECTIONS.find(([re]) => re.test(path))?.[1] || 'Прочее';
            this.activityLog.log({
              userId: ctx.targetId,
              userName: ctx.targetName,
              action: ActivityAction.IMPERSONATED_ACTION,
              entity: 'impersonation',
              entityName: `${VERBS[method] || 'Действие'} · ${section}`,
              details: {
                method,
                path: path.slice(0, 200),
                section,
                impersonatedBy: { id: ctx.actorId, name: ctx.actorName, role: ctx.actorRole },
              },
            }).catch((e: any) => this.logger.warn(`trail failed: ${e?.message || e}`));
          }),
        ).subscribe(subscriber),
      );
      return () => sub.unsubscribe();
    });
  }
}
