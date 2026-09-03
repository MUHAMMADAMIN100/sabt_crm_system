import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { from, Observable } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { FinanceActivity } from './entities/finance-activity.entity';
import { FinanceTransaction } from './finance-transaction.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { FinanceCategory } from './entities/finance-category.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { FinanceEmployee } from './entities/finance-employee.entity';
import { FinanceSubscription } from './entities/finance-subscription.entity';
import { FinanceDebt } from './entities/finance-debt.entity';
import { FinancePlannedPayment } from './entities/finance-planned-payment.entity';
import { FinanceAsset } from './entities/finance-asset.entity';
import { FinanceForecastAdjustment } from './entities/finance-forecast-adjustment.entity';

/** Человекочитаемые названия действий по маршруту. Порядок важен —
 *  берётся первое совпадение. */
const LABELS: Array<{ re: RegExp; method?: string; label: string }> = [
  { re: /\/transactions\/[^/?]+(?:\?.*)?$/, method: 'PATCH', label: 'Изменил операцию' },
  { re: /\/transactions\/[^/?]+(?:\?.*)?$/, method: 'DELETE', label: 'Отменил операцию' },
  { re: /\/operations$/, method: 'POST', label: 'Добавил операцию' },
  { re: /\/operations\/remove-month$/, method: 'POST', label: 'Откатил выплаты месяца' },
  { re: /\/employees\/[^/]+\/bonus$/, label: 'Изменил бонус сотрудника' },
  { re: /\/employees\/[^/]+\/advance$/, label: 'Изменил аванс сотрудника' },
  { re: /\/employees\/[^/]+\/fine$/, label: 'Изменил штраф сотрудника' },
  { re: /\/employees\/[^/]+\/vacation$/, label: 'Изменил отпускные/удержание сотрудника' },
  { re: /\/employees\/[^/]+\/deduction(?:\/[^/]+)?$/, label: 'Изменил бонус/удержания сотрудника (бонус/штраф/отпускные)' },
  { re: /\/employees\/[^/]+$/, method: 'PATCH', label: 'Изменил сотрудника (ЗП)' },
  { re: /\/employees\/[^/]+$/, method: 'DELETE', label: 'Уволил сотрудника (ЗП)' },
  { re: /\/employees$/, method: 'POST', label: 'Добавил сотрудника (ЗП)' },
  { re: /\/planned-payments\/[^/]+\/receive/, label: 'Отметил оплату полученной' },
  { re: /\/planned-payments\/[^/]+\/unreceive/, label: 'Отменил получение оплаты' },
  { re: /\/pay-now/, label: 'Провёл оплату (сейчас)' },
  { re: /\/planned-payments/, label: 'Изменил план оплат' },
  { re: /\/projects\/[^/]+$/, method: 'PATCH', label: 'Изменил проект (финансы)' },
  { re: /\/projects\/[^/]+$/, method: 'DELETE', label: 'Архивировал проект (финансы)' },
  { re: /\/projects$/, method: 'POST', label: 'Добавил проект (финансы)' },
  { re: /\/salary\/close-month$/, label: 'Закрыл зарплатный месяц' },
  { re: /\/salary\/reopen-month$/, label: 'Переоткрыл зарплатный месяц' },
  { re: /\/forecast\/adjustments\/[^/?]+$/, method: 'PATCH', label: 'Изменил корректировку прогноза' },
  { re: /\/forecast\/adjustments\/[^/?]+$/, method: 'DELETE', label: 'Удалил корректировку прогноза' },
  { re: /\/forecast\/adjustments$/, method: 'POST', label: 'Добавил корректировку прогноза' },
  { re: /\/assets\/[^/?]+(?:\?.*)?$/, method: 'PATCH', label: 'Изменил инвентарь' },
  { re: /\/assets\/[^/?]+(?:\?.*)?$/, method: 'DELETE', label: 'Удалил позицию инвентаря' },
  { re: /\/assets$/, method: 'POST', label: 'Добавил позицию инвентаря' },
  { re: /\/accounts/, label: 'Изменил счета' },
  { re: /\/categories/, label: 'Изменил категории' },
  { re: /\/subscriptions/, label: 'Изменил подписки/аренду' },
  { re: /\/debts/, label: 'Изменил долги' },
  { re: /\/backups\/[^/]+\/restore/, label: 'Восстановил бэкап' },
  { re: /\/backups/, method: 'POST', label: 'Создал бэкап' },
  { re: /\/backup\/import$/, method: 'POST', label: 'Импортировал финансовые данные' },
  { re: /\/reset$/, method: 'POST', label: 'Сбросил финансовые данные' },
  { re: /\/reminders\/run/, label: 'Запустил проверку напоминаний' },
];

function labelFor(method: string, url: string): string {
  for (const l of LABELS) {
    if (l.method && l.method !== method) continue;
    if (l.re.test(url)) return l.label;
  }
  return 'Изменение в финансах';
}

const OMIT_KEYS = new Set(['createdAt', 'updatedAt', 'createdBy', 'createdById']);
const IDENTITY_KEYS = ['name', 'type', 'status', 'amount', 'date', 'ym', 'salaryYm', 'kind', 'projectId', 'employeeId', 'accountId', 'fromAccountId', 'toAccountId', 'categoryId', 'debtId', 'subscriptionId', 'assetId', 'partNo'];

/** JSON для аудита ограничен по глубине и размеру: журнал не должен хранить
 *  импортированные файлы, большие массивы и приватные поля запроса. */
function cleanValue(value: any, depth = 0): any {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > 220 ? `${value.slice(0, 220)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) {
    try { return JSON.stringify(value).slice(0, 280); } catch { return null; }
  }
  if (Array.isArray(value)) return value.slice(0, 8).map(item => cleanValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, child] of Object.entries(value).slice(0, 30)) {
      if (/password|token|secret/i.test(key) || child === undefined) continue;
      out[key] = cleanValue(child, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 220);
}

function different(a: any, b: any) {
  try { return JSON.stringify(cleanValue(a)) !== JSON.stringify(cleanValue(b)); }
  catch { return a !== b; }
}

function pick(source: Record<string, any> | null, keys: string[]): Record<string, any> | null {
  if (!source) return null;
  const out: Record<string, any> = {};
  for (const key of keys) {
    if (OMIT_KEYS.has(key) || source[key] === undefined) continue;
    out[key] = cleanValue(source[key]);
  }
  return Object.keys(out).length ? out : null;
}

@Injectable()
export class FinanceActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FinanceActivityInterceptor.name);

  constructor(
    @InjectRepository(FinanceActivity) private repo: Repository<FinanceActivity>,
  ) {}

  private entityFor(url: string): any | null {
    const mappings: Array<[string, any]> = [
      ['/planned-payments/', FinancePlannedPayment], ['/transactions/', FinanceTransaction],
      ['/employees/', FinanceEmployee], ['/projects/', FinanceProject], ['/accounts/', FinanceAccount],
      ['/categories/', FinanceCategory], ['/subscriptions/', FinanceSubscription], ['/debts/', FinanceDebt],
      ['/assets/', FinanceAsset], ['/forecast/adjustments/', FinanceForecastAdjustment],
    ];
    return mappings.find(([part]) => url.includes(part))?.[1] ?? null;
  }

  /** Снимок помесячного бонуса/аванса/штрафа приводим к тем же полям,
   *  которые пользователь меняет в форме. */
  private normalizeSnapshot(req: any, entity: Record<string, any> | null): Record<string, any> | null {
    if (!entity) return null;
    const url = String(req?.originalUrl || req?.url || '');
    const monthField = url.includes('/advance') ? 'advances' : url.includes('/bonus') ? 'bonuses' : url.includes('/fine') ? 'fines' : url.includes('/vacation') ? 'vacations' : null;
    if (monthField) {
      const ym = req?.body?.ym;
      return { id: entity.id, name: entity.name, ym, amount: Number(entity[monthField]?.[ym] ?? 0) };
    }
    return entity;
  }

  private async capture(req: any): Promise<Record<string, any> | null> {
    const id = req?.params?.id;
    const Entity = id ? this.entityFor(String(req?.originalUrl || req?.url || '')) : null;
    if (!Entity) return null;
    const entity = await this.repo.manager.getRepository(Entity).findOne({ where: { id } } as any).catch(() => null);
    return this.normalizeSnapshot(req, entity as any);
  }

  private detailPayload(req: any, before: Record<string, any> | null, after: Record<string, any> | null, response: any) {
    const input = cleanValue({ ...(req?.params || {}), ...(req?.body || {}) }) as Record<string, any>;
    const result = response && typeof response === 'object' && !Array.isArray(response) ? response : null;
    const actualAfter = after || result;
    const requested = Object.keys(req?.body || {});
    const changed = before && actualAfter
      ? [...new Set([...Object.keys(before), ...Object.keys(actualAfter)])]
        .filter(key => !OMIT_KEYS.has(key) && different(before[key], actualAfter[key]))
      : [];
    const keys = [...new Set([...requested, ...changed, ...IDENTITY_KEYS])].slice(0, 24);
    return cleanValue({
      input,
      before: pick(before, keys),
      after: pick(actualAfter, keys),
      objectId: req?.params?.id || result?.id || null,
    });
  }

  private async write(req: any, before: Record<string, any> | null, response: any) {
    try {
      // После успешного обработчика читаем объект повторно: это даёт реальный
      // снимок результата, включая статусы, изменённые сервисом автоматически.
      const after = await this.capture(req);
      const method = String(req?.method || '');
      const url = String(req?.originalUrl || req?.url || '');
      await this.repo.save(this.repo.create({
        userId: req?.user?.id ?? null,
        action: labelFor(method, url),
        route: `${method} ${url}`.slice(0, 200),
        details: this.detailPayload(req, before, after, response),
      }));
    } catch (error: any) {
      this.logger.warn(`finance activity log failed: ${error?.message || error}`);
    }
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const method = String(req?.method || '');
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return next.handle();

    // Сначала фиксируем «до», затем пропускаем запрос. Ошибка снимка не должна
    // мешать финансовой операции — в этом случае журнал сохранит доступные поля.
    return from(this.capture(req).catch(() => null)).pipe(
      switchMap(before => next.handle().pipe(
        tap(response => { void this.write(req, before, response); }),
      )),
    );
  }
}
