import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FinanceActivity } from './entities/finance-activity.entity';

/** Человекочитаемые названия действий по маршруту. Порядок важен —
 *  берётся первое совпадение. */
const LABELS: Array<{ re: RegExp; method?: string; label: string }> = [
  { re: /\/operations\/[^/]+$/, method: 'PATCH', label: 'Изменил операцию' },
  { re: /\/operations\/[^/]+$/, method: 'DELETE', label: 'Удалил операцию' },
  { re: /\/operations$/, method: 'POST', label: 'Добавил операцию' },
  { re: /\/employees\/[^/]+\/bonus$/, label: 'Изменил бонус сотрудника' },
  { re: /\/employees\/[^/]+\/advance$/, label: 'Изменил аванс сотрудника' },
  { re: /\/employees\/[^/]+\/fine$/, label: 'Изменил штраф сотрудника' },
  { re: /\/employees\/[^/]+$/, method: 'PATCH', label: 'Изменил сотрудника (ЗП)' },
  { re: /\/employees\/[^/]+$/, method: 'DELETE', label: 'Удалил сотрудника (ЗП)' },
  { re: /\/employees$/, method: 'POST', label: 'Добавил сотрудника (ЗП)' },
  { re: /\/planned-payments\/[^/]+\/receive/, label: 'Отметил оплату полученной' },
  { re: /\/planned-payments\/[^/]+\/unreceive/, label: 'Отменил получение оплаты' },
  { re: /\/pay-now/, label: 'Провёл оплату (сейчас)' },
  { re: /\/planned-payments/, label: 'Изменил план оплат' },
  { re: /\/projects\/[^/]+$/, method: 'PATCH', label: 'Изменил проект (финансы)' },
  { re: /\/projects\/[^/]+$/, method: 'DELETE', label: 'Удалил проект (финансы)' },
  { re: /\/projects$/, method: 'POST', label: 'Добавил проект (финансы)' },
  { re: /\/accounts/, label: 'Изменил счета' },
  { re: /\/categories/, label: 'Изменил категории' },
  { re: /\/subscriptions/, label: 'Изменил подписки/аренду' },
  { re: /\/debts/, label: 'Изменил долги' },
  { re: /\/remove-month-expenses/, label: 'Откатил выплаты месяца' },
  { re: /\/backups\/[^/]+\/restore/, label: 'Восстановил бэкап' },
  { re: /\/backups/, method: 'POST', label: 'Создал бэкап' },
  { re: /\/reminders\/run/, label: 'Запустил проверку напоминаний' },
];

function labelFor(method: string, url: string): string {
  for (const l of LABELS) {
    if (l.method && l.method !== method) continue;
    if (l.re.test(url)) return l.label;
  }
  return 'Изменение в финансах';
}

/** Усечь тело запроса для журнала: без гигантских полей и вложенных монстров. */
function sanitize(obj: any): any {
  try {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (v == null) continue;
      if (typeof v === 'string') out[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else out[k] = JSON.stringify(v).slice(0, 300);
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/** Пишет каждый успешный мутирующий запрос к /finance/* в finance_activity:
 *  кто (userId), что (человекочитаемое действие + маршрут), когда, детали. */
@Injectable()
export class FinanceActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FinanceActivityInterceptor.name);

  constructor(
    @InjectRepository(FinanceActivity) private repo: Repository<FinanceActivity>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const method: string = req?.method || '';
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return next.handle();
    const url: string = req?.originalUrl || req?.url || '';

    return next.handle().pipe(
      tap(() => {
        // Логируем только успешные мутации; сбой журнала не валит запрос.
        this.repo.save(this.repo.create({
          userId: req?.user?.id ?? null,
          action: labelFor(method, url),
          route: `${method} ${url}`.slice(0, 200),
          details: sanitize({ ...req?.params, ...req?.body }),
        })).catch(e => this.logger.warn(`finance activity log failed: ${e?.message || e}`));
      }),
    );
  }
}
