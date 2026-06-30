import { Injectable, CanActivate, ExecutionContext, SetMetadata, Optional, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasGrant } from '../permissions';
import { SecurityAuditService } from '../security-audit.service';
import { SecurityEventType } from '../security-event.entity';

/** Требуемая возможность для эндпоинта. Пропускает, если у пользователя есть
 *  право нативно (по роли) ИЛИ выдан персональный грант (extraPermissions). */
export const RequirePerm = (key: string) => SetMetadata('perm', key);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional() private audit?: SecurityAuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const key = this.reflector.get<string>('perm', context.getHandler());
    if (!key) return true; // нет @RequirePerm — этот гард не ограничивает
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (hasGrant(user, key)) return true;
    this.audit?.log({
      type: SecurityEventType.FORBIDDEN_ACCESS,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      req,
      details: {
        path: req.originalUrl || req.url,
        method: req.method,
        userRole: user?.role,
        requiredPerm: key,
      },
    }).catch(() => {});
    throw new ForbiddenException('Недостаточно прав для этого действия');
  }
}
