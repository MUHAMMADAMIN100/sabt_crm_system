import { Injectable, CanActivate, ExecutionContext, SetMetadata, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user.entity';
import { SecurityAuditService } from '../security-audit.service';
import { SecurityEventType } from '../security-event.entity';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    // @Optional чтобы guard работал даже там где SecurityAuditService не
    // прокинут в DI-цепочку (например, в тестах).
    @Optional() private audit?: SecurityAuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<UserRole[]>('roles', context.getHandler());
    if (!roles) return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    // У сотрудника может быть вторая роль (например видеограф + монтажёр).
    // Доступ разрешён, если ЛЮБАЯ из двух ролей подходит под @Roles(...).
    const allowed = roles.includes(user?.role)
      || (!!user?.secondaryRole && roles.includes(user.secondaryRole));
    if (!allowed) {
      // Логируем попытку доступа выше роли — это сигнал либо о реальном
      // bruteforce, либо о подмене role на фронте, либо о баге в UI
      // (показали кнопку, которая не должна быть видна).
      this.audit?.log({
        type: SecurityEventType.FORBIDDEN_ACCESS,
        userId: user?.id ?? null,
        email: user?.email ?? null,
        req,
        details: {
          path: req.originalUrl || req.url,
          method: req.method,
          userRole: user?.role,
          userSecondaryRole: user?.secondaryRole ?? null,
          required: roles,
        },
      }).catch(() => {});
    }
    return allowed;
  }
}
