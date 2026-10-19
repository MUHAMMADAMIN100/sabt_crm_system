import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SalesPlan } from './sales-plan.entity';
import { SmmPaymentsService } from './smm-payments.service';

type Actor = { id: string; role?: string | null; secondaryRole?: string | null };

/** Менеджеры по продажам — оба вида. */
const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev'];
const YM = /^\d{4}-\d{2}$/;

const todayDushanbe = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
const shiftYm = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/**
 * План продаж (решение владельца 19.10.2026, вариант А): основатель ставит
 * менеджеру сумму на месяц на странице «Сотрудники», а сделанное CRM считает
 * сама — деньги, полученные от клиентов менеджера по «Финансам». Менеджер
 * видит своё окошко в профиле на телефоне; без плана окошко не показывается.
 */
@Injectable()
export class SalesPlanService {
  private readonly logger = new Logger(SalesPlanService.name);

  constructor(
    @InjectRepository(SalesPlan) private repo: Repository<SalesPlan>,
    private payments: SmmPaymentsService,
    private ds: DataSource,
  ) {}

  private ymOr(raw?: string) {
    return YM.test(String(raw || '')) ? String(raw) : todayDushanbe().slice(0, 7);
  }

  private async managers(): Promise<Array<{ id: string; name: string; avatar: string | null; role: string; secondaryRole: string | null }>> {
    const rows: any[] = await this.ds.query(
      `SELECT id, name, avatar, role, "secondaryRole" FROM users
        WHERE "isActive" = true AND (role = ANY($1) OR "secondaryRole" = ANY($1))
        ORDER BY name`,
      [SALES_ROLES],
    ).catch((e: any) => { this.logger.warn(`sales managers query failed: ${e?.message || e}`); return []; });
    return rows.map(r => ({ ...r, avatar: r.avatar || null, secondaryRole: r.secondaryRole || null }));
  }

  /** Окошко «План продаж» на странице «Сотрудники» — основателю. */
  async list(ymRaw?: string) {
    const ym = this.ymOr(ymRaw);
    const people = await this.managers();
    const plans = people.length
      ? await this.repo.find({ where: { ym, userId: In(people.map(p => p.id)) } })
      : [];
    const planOf = new Map(plans.map(p => [p.userId, Number(p.amount) || 0]));
    const received = await Promise.all(people.map(p => this.payments.receivedOf(p.id, ym).catch(() => 0)));
    const managers = people.map((p, i) => ({
      id: p.id, name: p.name, avatar: p.avatar,
      role: SALES_ROLES.includes(p.role) ? p.role : p.secondaryRole,
      plan: planOf.has(p.id) ? planOf.get(p.id)! : null,
      received: received[i],
    }));
    const withPlan = managers.filter(m => m.plan !== null);
    return {
      ym,
      prevYm: shiftYm(ym, -1),
      managers,
      total: {
        plan: withPlan.reduce((s, m) => s + (m.plan || 0), 0),
        received: withPlan.reduce((s, m) => s + m.received, 0),
      },
    };
  }

  /** Поставить сумму на месяц; пусто или 0 — снять план. */
  async set(userId: string, body: any, actor: Actor) {
    const ym = this.ymOr(body?.ym);
    const people = await this.managers();
    if (!people.some(p => p.id === userId)) throw new NotFoundException('Менеджер по продажам не найден');
    const raw = body?.amount;
    const amount = raw === null || raw === undefined || raw === '' ? 0 : Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) throw new BadRequestException('Неверная сумма');
    if (amount === 0) {
      await this.repo.delete({ userId, ym });
    } else {
      const cur = await this.repo.findOne({ where: { userId, ym } });
      await this.repo.save(cur ? Object.assign(cur, { amount, updatedById: actor.id }) : this.repo.create({ userId, ym, amount, updatedById: actor.id }));
    }
    return this.list(ym);
  }

  /** «Как в прошлом месяце»: перенести суммы тем, у кого плана на месяц ещё нет. */
  async copyPrev(body: any, actor: Actor) {
    const ym = this.ymOr(body?.ym);
    const prev = await this.repo.find({ where: { ym: shiftYm(ym, -1) } });
    const has = new Set((await this.repo.find({ where: { ym } })).map(p => p.userId));
    const fresh = prev.filter(p => !has.has(p.userId));
    if (fresh.length) {
      await this.repo.save(fresh.map(p => this.repo.create({ userId: p.userId, ym, amount: p.amount, updatedById: actor.id })));
    }
    return this.list(ym);
  }

  /** Окошко в профиле менеджера: без плана на месяц — plan: null (не показываем). */
  async mine(actor: Actor) {
    const today = todayDushanbe();
    const ym = today.slice(0, 7);
    const row = await this.repo.findOne({ where: { userId: actor.id, ym } });
    if (!row) return { ym, plan: null };
    const day = Number(today.slice(8, 10));
    return {
      ym,
      plan: Number(row.amount) || 0,
      received: await this.payments.receivedOf(actor.id, ym).catch(() => 0),
      day,
      daysInMonth: daysIn(ym),
      daysLeft: daysIn(ym) - day,
    };
  }
}
