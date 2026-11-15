import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClientLead, ClientLeadDirection } from '../clients/client-lead.entity';
import { ClientsService } from '../clients/clients.service';
import { loadSalesSettings, saveSalesSetting, SalesNorms } from '../clients/sales-settings';
import { dushanbeDay, dushanbeDayEnd, dushanbeDayStart } from '../clients/sales-kpi.logic';
import { User, UserRole } from '../users/user.entity';
import { SalesPlan } from '../smm-control/sales-plan.entity';
import { SmmPaymentsService } from '../smm-control/smm-payments.service';
import { getSalesSegment, salesRoleOf } from '../../common/sales-segment';
import { SalesSettingsDto } from './dto/sales.dto';
import { SalesUser, canEditCommission, canEditNorms, isSalesTop } from './sales-access';
import {
  CohortLead, FunnelRow, Milestone, SourceRow, buildFunnel, bySource, cycleDaysMedian, expectedInPeriod,
  groupMilestones, lostReasonCounts, pct, sumOrNull, wholeMonths,
} from './sales-analytics.logic';
import { mergeCommission, mergeNorms, newCommissionIds } from './sales-settings.logic';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Типизировано UserRole: In() по колонке role иначе не сойдётся с типом. */
const SALES_ROLES: UserRole[] = [UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV];
/** Больше трёх лет — уже не «период», а выгрузка всей базы. */
const MAX_PERIOD_DAYS = 366 * 3;

export interface ManagerRow {
  userId: string;
  name: string;
  role: string;
  leads: number;
  meetingsHeld: number;
  won: number;
  received: number | null;
  plan: number | null;
  kpiPercent: number | null;
}

export interface SalesAnalytics {
  period: { from: string; to: string };
  totals: {
    leads: number; won: number; conversion: number; cycleDaysMedian: number | null;
    received: number | null; plan: number | null; expected: number | null;
  };
  funnel: FunnelRow[];
  bySource: SourceRow[];
  byManager: ManagerRow[];
  lostReasons: Array<{ reason: string; count: number }>;
}

export interface SalesSettingsView {
  norms: { smm: SalesNorms; development: SalesNorms };
  commission: Record<string, number>;
  managers: Array<{ id: string; name: string; role: string }>;
}

/** Период аналитики: YYYY-MM-DD по Душанбе; пусто — с 1-го числа по сегодня. */
export function analyticsPeriod(from: string | undefined, to: string | undefined, now: Date): { from: string; to: string } {
  const today = dushanbeDay(now);
  const f = from ? String(from) : `${today.slice(0, 7)}-01`;
  const t = to ? String(to) : today;
  const valid = (s: string) => ISO_DAY.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`))
    && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!valid(f) || !valid(t)) throw new BadRequestException('Период — даты YYYY-MM-DD');
  if (f > t) throw new BadRequestException('Начало периода позже конца');
  if ((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000 > MAX_PERIOD_DAYS) {
    throw new BadRequestException('Период — не больше трёх лет');
  }
  return { from: f, to: t };
}

/**
 * Аналитика продаж и настройки (15.11.2026, SALES_SPEC §5). Математика —
 * в sales-analytics.logic.ts, здесь только выборки.
 */
@Injectable()
export class SalesAnalyticsService {
  private readonly logger = new Logger(SalesAnalyticsService.name);

  constructor(
    @InjectRepository(ClientLead) private leadRepo: Repository<ClientLead>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(SalesPlan) private planRepo: Repository<SalesPlan>,
    private clients: ClientsService,
    private payments: SmmPaymentsService,
  ) {}

  private q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.leadRepo.manager.query(sql, params);
  }

  // ─── Аналитика ─────────────────────────────────────────────────────────

  async analytics(fromRaw?: string, toRaw?: string, directionRaw?: string): Promise<SalesAnalytics> {
    const now = new Date();
    const { from, to } = analyticsPeriod(fromRaw, toRaw, now);
    if (directionRaw && directionRaw !== 'smm' && directionRaw !== 'development') {
      throw new BadRequestException('direction — smm или development');
    }
    const direction = (directionRaw || null) as 'smm' | 'development' | null;
    const start = dushanbeDayStart(from);
    const end = dushanbeDayEnd(to);

    const params: unknown[] = [start, end];
    const dirSql = direction ? ` AND c.direction::text = $3` : '';
    if (direction) params.push(direction);

    // 1. Лиды периода (когорта).
    const cohort: Array<CohortLead & { createdAt: Date }> = await this.q(
      `SELECT c.id, c.status::text AS status, c."ownerId"::text AS "ownerId", c."leadSource", c."createdAt"
         FROM client_leads c
        WHERE c."createdAt" BETWEEN $1 AND $2${dirSql}`,
      params,
    );

    // 2. Вехи когорты: до какого этапа лиды доходили (даже если сейчас lost).
    const ids = cohort.map(l => l.id);
    const milestones: Milestone[] = ids.length
      ? await this.q<Milestone>(
        `SELECT lead_id::text AS "leadId", status_to AS "statusTo", stage_to AS "stageTo"
           FROM lead_progress WHERE lead_id = ANY($1::uuid[]) AND delta > 0`,
        [ids],
      ).catch((e: any) => { this.logger.warn(`lead_progress for analytics failed: ${e?.message || e}`); return []; })
      : [];

    // 3. Выигранные — для цикла сделки (выигрыш в периоде, создание — любое).
    const wonRows = await this.wonRows(direction);

    // 4. Проигранные в периоде — причины.
    const lostRows = await this.lostRows(start, end, direction);

    // 5. Прогноз: активные лиды с ожидаемой датой закрытия в периоде.
    const expectedRows: any[] = await this.q(
      `SELECT c.status::text AS status, c."dealPotential", c.probability,
              to_char(c."expectedCloseAt", 'YYYY-MM-DD') AS "expectedCloseAt"
         FROM client_leads c
        WHERE c."expectedCloseAt" BETWEEN $1::date AND $2::date${direction ? ` AND c.direction::text = $3` : ''}`,
      direction ? [from, to, direction] : [from, to],
    ).catch(() => []);

    const byManager = await this.byManager(cohort, from, to, direction, now);
    const won = cohort.filter(l => String(l.status) === 'won').length;

    return {
      period: { from, to },
      totals: {
        leads: cohort.length,
        won,
        conversion: pct(won, cohort.length),
        cycleDaysMedian: cycleDaysMedian(wonRows, from, to),
        received: sumOrNull(byManager.map(m => m.received)),
        plan: sumOrNull(byManager.map(m => m.plan)),
        expected: expectedInPeriod(expectedRows, from, to),
      },
      funnel: buildFunnel(cohort, groupMilestones(milestones)),
      bySource: bySource(cohort),
      byManager,
      lostReasons: lostReasonCounts(lostRows),
    };
  }

  /** Дата выигрыша: первая веха «won» (или этап «Реализация»), иначе
   *  передача в работу, иначе последняя правка. Без lead_progress — без вех. */
  private async wonRows(direction: string | null): Promise<Array<{ createdAt: Date; wonAt: Date | null }>> {
    const dir = direction ? ` AND c.direction::text = $1` : '';
    const params = direction ? [direction] : [];
    return this.q(
      `SELECT c."createdAt",
              COALESCE(
                (SELECT MIN(p.created_at) FROM lead_progress p
                  WHERE p.lead_id = c.id AND p.delta > 0
                    AND (p.status_to = 'won' OR p.stage_to = 'implementation')),
                c."handoffAt", c."updatedAt") AS "wonAt"
         FROM client_leads c
        WHERE c.status::text = 'won'${dir}`,
      params,
    ).catch(() => this.q(
      `SELECT c."createdAt", COALESCE(c."handoffAt", c."updatedAt") AS "wonAt"
         FROM client_leads c WHERE c.status::text = 'won'${dir}`,
      params,
    ));
  }

  /** Проигранные в периоде: момент проигрыша — последнее событие «stage» →
   *  lost в ленте, у старых лидов (до ленты) — последняя правка. */
  private async lostRows(start: Date, end: Date, direction: string | null): Promise<Array<{ lostReason: string | null }>> {
    const dir = direction ? ` AND c.direction::text = $3` : '';
    const params: unknown[] = direction ? [start, end, direction] : [start, end];
    return this.q(
      `SELECT x."lostReason" FROM (
         SELECT c."lostReason",
                COALESCE(
                  (SELECT MAX(e.created_at) FROM lead_events e
                    WHERE e.lead_id = c.id AND e.kind = 'stage' AND e.data->>'to' = 'lost'),
                  c."updatedAt") AS lost_at
           FROM client_leads c
          WHERE c.status::text = 'lost'${dir}
       ) x WHERE x.lost_at BETWEEN $1 AND $2`,
      params,
    ).catch(() => this.q(
      `SELECT c."lostReason" FROM client_leads c
        WHERE c.status::text = 'lost' AND c."updatedAt" BETWEEN $1 AND $2${dir}`,
      params,
    ));
  }

  /** Менеджеры продаж (основной или второй ролью; при фильтре — только
   *  этого направления) и уволенные МП, у которых есть лиды периода. */
  private async salesUsers(cohortOwnerIds: string[], direction: string | null): Promise<User[]> {
    const where: any[] = [
      { role: In(SALES_ROLES), isActive: true },
      { secondaryRole: In(SALES_ROLES), isActive: true },
    ];
    if (cohortOwnerIds.length) {
      where.push({ id: In(cohortOwnerIds), role: In(SALES_ROLES) });
      where.push({ id: In(cohortOwnerIds), secondaryRole: In(SALES_ROLES) });
    }
    const users = await this.userRepo.find({ where, order: { name: 'ASC' } });
    const seen = new Set<string>();
    return users.filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      const dir = getSalesSegment(salesRoleOf(u))?.leadDirection ?? null;
      return !direction || dir === direction;
    });
  }

  private async byManager(
    cohort: CohortLead[], from: string, to: string, direction: string | null, now: Date,
  ): Promise<ManagerRow[]> {
    const ownerIds = [...new Set(cohort.map(l => l.ownerId).filter((x): x is string => !!x))];
    const users = await this.salesUsers(ownerIds, direction);
    if (!users.length) return [];
    const userIds = users.map(u => u.id);

    // Встречи «состоялись» — lead_actions kind=meeting по времени встречи.
    const meetingRows: Array<{ userId: string; c: number }> = await this.q(
      `SELECT user_id::text AS "userId", COUNT(*)::int AS c FROM lead_actions
        WHERE kind = 'meeting' AND user_id = ANY($1::uuid[]) AND "at" BETWEEN $2 AND $3
        GROUP BY user_id`,
      [userIds, dushanbeDayStart(from), dushanbeDayEnd(to)],
    ).catch(() => []);
    const meetings = new Map(meetingRows.map(r => [r.userId, Number(r.c) || 0]));

    // План и «получено» — помесячные: только для периода из целых месяцев.
    const months = wholeMonths(from, to, dushanbeDay(now));
    const plans: SalesPlan[] = months
      ? await this.planRepo.find({ where: { userId: In(userIds), ym: In(months) } }).catch((): SalesPlan[] => [])
      : [];

    const rows = await Promise.all(users.map(async (u): Promise<ManagerRow> => {
      const role = salesRoleOf(u) || u.role;
      const dir = getSalesSegment(role)?.leadDirection as ClientLeadDirection | undefined;
      const own = cohort.filter(l => l.ownerId === u.id);
      const userPlans = plans.filter(p => p.userId === u.id);
      const [kpiPercent, received] = await Promise.all([
        this.kpiPercent(u.id, dir, from, to),
        months ? this.receivedOf(u.id, months) : Promise.resolve(null),
      ]);
      return {
        userId: u.id,
        name: u.name,
        role,
        leads: own.length,
        meetingsHeld: meetings.get(u.id) ?? 0,
        won: own.filter(l => String(l.status) === 'won').length,
        received,
        plan: userPlans.length ? sumOrNull(userPlans.map(p => Number(p.amount))) : null,
        kpiPercent,
      };
    }));
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  /** Общий процент KPI — тот же, что на «Панели» менеджера; выходной или
   *  ошибка — null. */
  private async kpiPercent(userId: string, dir: ClientLeadDirection | undefined, from: string, to: string): Promise<number | null> {
    try {
      const k: any = await this.clients.kpi(userId, dir, from, to);
      if (!k || k.restDay || typeof k.overallPercent !== 'number') return null;
      return k.overallPercent;
    } catch (e: any) {
      this.logger.warn(`kpi for ${userId} failed: ${e?.message || e}`);
      return null;
    }
  }

  /** «Получено» за месяцы — те же деньги, что в плане продаж (SmmPaymentsService). */
  private async receivedOf(userId: string, months: string[]): Promise<number | null> {
    try {
      const parts = await Promise.all(months.map(ym => this.payments.receivedOf(userId, ym)));
      return sumOrNull(parts);
    } catch (e: any) {
      this.logger.warn(`received for ${userId} failed: ${e?.message || e}`);
      return null;
    }
  }

  // ─── Настройки ─────────────────────────────────────────────────────────

  /** Действующие менеджеры продаж — для экрана настроек. */
  private async managers(): Promise<Array<{ id: string; name: string; role: string }>> {
    const users = await this.userRepo.find({
      where: [
        { role: In(SALES_ROLES), isActive: true, isBlocked: false },
        { secondaryRole: In(SALES_ROLES), isActive: true, isBlocked: false },
      ],
      order: { name: 'ASC' },
    });
    const byId = new Map<string, User>();
    for (const u of users) if (!byId.has(u.id)) byId.set(u.id, u);
    return [...byId.values()].map(u => ({ id: u.id, name: u.name, role: salesRoleOf(u) || u.role }));
  }

  /** Руководство — всё; остальные (МП) — нормы и свой процент. */
  async getSettings(user: SalesUser): Promise<SalesSettingsView> {
    const s = await loadSalesSettings(this.leadRepo.manager);
    if (isSalesTop(user)) {
      return { norms: s.norms, commission: s.commission, managers: await this.managers() };
    }
    const own = s.commission[user.id];
    return {
      norms: s.norms,
      commission: typeof own === 'number' ? { [user.id]: own } : {},
      managers: [],
    };
  }

  /** Нормы — основатель и админ; комиссия — только основатель. */
  async saveSettings(user: SalesUser, dto: SalesSettingsDto): Promise<SalesSettingsView> {
    const wantsNorms = dto?.norms !== undefined && dto?.norms !== null;
    const wantsCommission = dto?.commission !== undefined && dto?.commission !== null;
    if (!wantsNorms && !wantsCommission) throw new BadRequestException('Нечего сохранять: передайте norms или commission');
    if (wantsNorms && !canEditNorms(user)) throw new ForbiddenException('Нормы KPI меняют основатель и администратор');
    if (wantsCommission && !canEditCommission(user)) throw new ForbiddenException('Комиссию менеджеров меняет только основатель');

    const m = this.leadRepo.manager;
    const current = await loadSalesSettings(m);
    // Сначала всё проверяем, потом пишем: ошибка в комиссии не должна
    // оставить сохранёнными одни нормы.
    const norms = wantsNorms ? mergeNorms(current.norms, dto.norms) : null;
    const commission = wantsCommission ? mergeCommission(current.commission, dto.commission) : null;
    if (commission) {
      const changed = newCommissionIds(current.commission, commission);
      if (changed.length) {
        const allowed = new Set((await this.managers()).map(x => x.id));
        if (changed.some(id => !allowed.has(id))) {
          throw new BadRequestException('Комиссия — только действующим менеджерам продаж');
        }
      }
    }
    if (norms) await saveSalesSetting(m, 'kpi_norms', norms, user.id);
    if (commission) await saveSalesSetting(m, 'commission', commission, user.id);
    return this.getSettings(user);
  }
}
