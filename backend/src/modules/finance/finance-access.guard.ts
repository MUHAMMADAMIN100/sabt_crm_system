import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { hasGrant } from '../auth/permissions';

/**
 * Доступ к финансовому модулю: право `finance.manage` (нативно у FOUNDER /
 * CO_FOUNDER либо персональным грантом extraPermissions).
 *
 * Нужен отдельным guard'ом, потому что RolesGuard/PermissionsGuard читают
 * метаданные только с обработчика (getHandler) — классовые @Roles/@RequirePerm
 * на контроллере ими не видны, и без этого guard'а финансы были бы доступны
 * любому залогиненному пользователю.
 */
@Injectable()
export class FinanceAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (hasGrant(user, 'finance.manage')) return true;
    throw new ForbiddenException('Недостаточно прав для этого действия');
  }
}
