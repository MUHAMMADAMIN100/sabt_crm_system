import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import {
  CalPay, FinClient, FinPlan, FinTx, PayItem, byUrgency, calendarPays, isEarning, paymentItems, resolveFinanceLinks,
} from './smm-payments.logic';

/** Кто видит оплаты всех проектов и связывает проект с клиентом «Финансов». */
const MONEY_ROLES = ['admin', 'founder'];
/** Ответственные за SMM-проекты — менеджеры по продажам, оба вида
 *  (решение владельца 10.10.2026, подтверждено 15.10.2026). */
const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev'];

type Actor = { id: string; role?: string | null; secondaryRole?: string | null };
/** Клиент «Финансов» с полями, нужными календарю менеджера. */
type FinClientRow = FinClient & { retentionMonths: number | null; salesManagerId: string | null };

/** Деньги дня в календаре на «Панели» менеджера: сумма, клиент и проект CRM. */
export type CalendarPayItem = CalPay & { name: string; projectId: string | null; direction: string | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Оплата проекта для менеджера: проект, день, состояние — без сумм. */
export type ProjectPayItem = PayItem & { projectId: string; projectName: string };

const todayDushanbe = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
const shiftMonth = (iso: string, delta: number) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthEnd = (iso: string) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};
const managerOf = (p: Project): string | null =>
  typeof (p.smmData as any)?.salesManagerId === 'string' ? (p.smmData as any).salesManagerId : null;
const linkOf = (p: Project): string | null =>
  typeof (p.smmData as any)?.financeProjectId === 'string' ? (p.smmData as any).financeProjectId : null;

/**
 * «Когда клиент должен заплатить» — для ответственного менеджера SMM-проекта
 * (решение владельца 12.10.2026). Сроки берутся из плановых оплат «Финансов»;
 * менеджер видит только свои проекты (smmData.salesManagerId). В карточке
 * проекта — день и состояние; в календаре «Панели» (17.10.2026) — ещё и
 * суммы, и клиенты разработки. Финансовые таблицы читаем SQL-запросом, а не
 * через FinanceModule, — как раздел «Контроль»: модуль финансов тяжёлый и
 * тянет за собой половину приложения.
 */
@Injectable()
export class SmmPaymentsService {
  private readonly logger = new Logger(SmmPaymentsService.name);

  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private ds: DataSource,
  ) {}

  private rolesOf(a: Actor) { return [a.role, a.secondaryRole].filter(Boolean) as string[]; }
  private isTop(a: Actor) { return this.rolesOf(a).some(r => MONEY_ROLES.includes(r)); }

  private async smmProjects(): Promise<Project[]> {
    const rows = await this.projectRepo.find({ where: { projectType: 'SMM', isArchived: false } as any });
    return rows.filter(p => String(p.status) !== 'archived');
  }

  private async clients(): Promise<FinClientRow[]> {
    const rows: any[] = await this.ds.query(
      `SELECT id, name, direction, tariff::float AS tariff,
              to_char("contractDate", 'YYYY-MM-DD') AS "contractDate",
              to_char("cycleAnchor", 'YYYY-MM-DD') AS "cycleAnchor",
              COALESCE(archived, false) AS archived, status,
              "retentionMonths", "salesManagerId"
         FROM finance_projects`,
    ).catch((e: any) => { this.logger.warn(`finance clients query failed: ${e?.message || e}`); return []; });
    return rows.map(r => ({
      ...r, tariff: Number(r.tariff) || 0, archived: !!r.archived,
      retentionMonths: r.retentionMonths == null ? null : Number(r.retentionMonths),
      salesManagerId: r.salesManagerId || null,
    }));
  }

  /** Плановые оплаты клиентов: все ожидаемые и полученные за последние месяцы
   *  (они нужны для «оплачено» и для срока по дню договора). */
  private async plans(clientIds: string[], today: string): Promise<FinPlan[]> {
    if (!clientIds.length) return [];
    const rows: any[] = await this.ds.query(
      `SELECT pp.id, pp."projectId" AS "projectId", pp.ym, pp."partNo" AS "partNo", pp.status,
              to_char(pp."dueDate", 'YYYY-MM-DD') AS "dueDate", pp.amount::float AS amount,
              to_char(tx.date, 'YYYY-MM-DD') AS "paidAt"
         FROM finance_planned_payments pp
         LEFT JOIN finance_transactions tx ON tx.id = pp."receivedTxId"
        WHERE pp."projectId" = ANY($1::uuid[])
          AND (pp.status = 'expected' OR pp.ym >= $2)`,
      [clientIds, shiftMonth(today, -2)],
    ).catch((e: any) => { this.logger.warn(`finance plans query failed: ${e?.message || e}`); return []; });
    return rows.map(r => ({ ...r, partNo: Number(r.partNo) || 1, amount: Number(r.amount) || 0 }));
  }

  /** Оплаты по набору проектов + проекты, для которых клиент в «Финансах» не найден. */
  private async collect(projects: Project[], today: string) {
    const clients = await this.clients();
    const links = resolveFinanceLinks(
      projects.map(p => ({ id: p.id, name: p.name, financeProjectId: linkOf(p) })), clients,
    );
    const plans = await this.plans([...new Set([...links.values()].map(l => l.client.id))], today);
    const items: ProjectPayItem[] = [];
    const unlinked: Array<{ projectId: string; projectName: string }> = [];
    for (const p of projects) {
      const link = links.get(p.id);
      if (!link) { unlinked.push({ projectId: p.id, projectName: p.name }); continue; }
      for (const it of paymentItems(link.client, plans, today)) {
        items.push({ ...it, key: `${p.id}:${it.key}`, projectId: p.id, projectName: p.name });
      }
    }
    items.sort((a, b) => byUrgency(a, b) || a.projectName.localeCompare(b.projectName, 'ru'));
    unlinked.sort((a, b) => a.projectName.localeCompare(b.projectName, 'ru'));
    return { items, unlinked, links };
  }

  /** Оплаты проектов, где сотрудник — ответственный менеджер. Для календаря. */
  async forManager(userId: string): Promise<ProjectPayItem[]> {
    const own = (await this.smmProjects()).filter(p => managerOf(p) === userId);
    if (!own.length) return [];
    return (await this.collect(own, todayDushanbe())).items;
  }

  /**
   * Деньги в календаре «Панели» менеджера по продажам (решение владельца
   * 17.10.2026): то же, что владелец видит в «Финансах → Планирование», но
   * только по клиентам менеджера — SMM-проекты, где он ответственный в CRM,
   * и клиенты разработки, где он назначен в «Доход → Разработка». Суммы
   * видны. Владелец и админ видят всех клиентов, у которых есть менеджер.
   */
  async calendar(actor: Actor, fromRaw?: string, toRaw?: string) {
    const today = todayDushanbe();
    const from = ISO_DAY.test(String(fromRaw || '')) ? String(fromRaw) : `${today.slice(0, 7)}-01`;
    const to = ISO_DAY.test(String(toRaw || '')) && String(toRaw) >= from ? String(toRaw) : monthEnd(from);
    const top = this.isTop(actor);
    return this.calendarOf(id => (top ? !!id : id === actor.id), from, to);
  }

  /** Получено от клиентов менеджера за месяц — «сделано» в плане продаж
   *  (решение владельца 19.10.2026, вариант А): те же оплаты, что зелёным
   *  в его календаре, по данным «Финансов». */
  async receivedOf(managerId: string, ym: string): Promise<number> {
    const from = `${ym}-01`;
    const to = monthEnd(from);
    const { items } = await this.calendarOf(id => id === managerId, from, to);
    const sum = items
      .filter(it => it.state === 'paid' && it.date >= from && it.date <= to)
      .reduce((s, it) => s + (Number(it.amount) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  /** Деньги клиентов, чей менеджер подходит под mineOnly, за [from, to]. */
  private async calendarOf(mineOnly: (managerId: string | null) => boolean, from: string, to: string) {
    const today = todayDushanbe();
    const all = await this.clients();
    const own = (await this.smmProjects()).filter(p => mineOnly(managerOf(p)));
    const links = resolveFinanceLinks(own.map(p => ({ id: p.id, name: p.name, financeProjectId: linkOf(p) })), all);
    const scope = new Map<string, { client: FinClientRow; name: string; projectId: string | null }>();
    for (const p of [...own].sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
      const l = links.get(p.id);
      if (l && !scope.has(l.client.id)) scope.set(l.client.id, { client: l.client, name: p.name, projectId: p.id });
    }
    for (const c of all) {
      if (c.direction === 'smm' || scope.has(c.id) || !mineOnly(c.salesManagerId)) continue;
      scope.set(c.id, { client: c, name: c.name, projectId: null });
    }
    if (!scope.size) return { today, from, to, clients: 0, items: [] as CalendarPayItem[] };

    const ids = [...scope.keys()];
    // Окно запросов шире календаря: текущий месяц нужен всегда (прогноз и
    // «Просрочено»), месяц до окна — для оплат, полученных позже своего месяца.
    const lo = [from, today].sort()[0];
    const hi = [to, today].sort()[1];
    const [plans, txs] = await Promise.all([this.calendarPlans(ids, lo), this.incomeTxs(ids, lo, hi)]);
    const items: CalendarPayItem[] = [];
    for (const { client, name, projectId } of scope.values()) {
      for (const it of calendarPays(client, plans, txs, from, to, today)) {
        items.push({ ...it, name, projectId, direction: client.direction });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ru') || a.partNo - b.partNo);
    return { today, from, to, clients: scope.size, items };
  }

  /** Плановые оплаты для календаря: все ожидаемые (просрочка) и любые с
   *  месяцем или сроком не раньше месяца до окна. */
  private async calendarPlans(clientIds: string[], lo: string): Promise<FinPlan[]> {
    const rows: any[] = await this.ds.query(
      `SELECT pp.id, pp."projectId" AS "projectId", pp.ym, pp."partNo" AS "partNo", pp.status,
              to_char(pp."dueDate", 'YYYY-MM-DD') AS "dueDate", pp.amount::float AS amount,
              to_char(tx.date, 'YYYY-MM-DD') AS "paidAt", pp."receivedTxId" AS "receivedTxId"
         FROM finance_planned_payments pp
         LEFT JOIN finance_transactions tx ON tx.id = pp."receivedTxId"
        WHERE pp."projectId" = ANY($1::uuid[])
          AND (pp.status = 'expected' OR pp.ym >= $2 OR pp."dueDate" >= $3::date)`,
      [clientIds, shiftMonth(lo, -1), `${shiftMonth(lo, -1)}-01`],
    ).catch((e: any) => { this.logger.warn(`finance calendar plans query failed: ${e?.message || e}`); return []; });
    return rows.map(r => ({ ...r, partNo: Number(r.partNo) || 1, amount: Number(r.amount) || 0 }));
  }

  /** Поступления по клиентам за месяцы окна — для «получено» без плана и
   *  чтобы не прогнозировать месяц, за который деньги уже пришли. */
  private async incomeTxs(clientIds: string[], lo: string, hi: string): Promise<FinTx[]> {
    const rows: any[] = await this.ds.query(
      `SELECT id, "projectId" AS "projectId", to_char(date, 'YYYY-MM-DD') AS date, amount::float AS amount,
              ("employeeId" IS NULL AND "subscriptionId" IS NULL AND "debtId" IS NULL) AS plain
         FROM finance_transactions
        WHERE type = 'income' AND COALESCE(status, 'completed') <> 'cancelled'
          AND "projectId" = ANY($1::uuid[])
          AND date >= $2::date AND date < $3::date`,
      [clientIds, `${lo.slice(0, 7)}-01`, `${shiftMonth(hi, 1)}-01`],
    ).catch((e: any) => { this.logger.warn(`finance income txs query failed: ${e?.message || e}`); return []; });
    return rows.map(r => ({ ...r, amount: Number(r.amount) || 0, plain: !!r.plain }));
  }

  /** Строка «Оплата клиента» в карточке SMM-проекта. Владелец и админ видят
   *  её всегда, менеджер — только у своего проекта. */
  async project(projectId: string, actor: Actor) {
    const p = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!p || p.projectType !== 'SMM') throw new NotFoundException('Проект не найден');
    const top = this.isTop(actor);
    const sales = this.rolesOf(actor).some(r => SALES_ROLES.includes(r));
    if (!top && !(sales && managerOf(p) === actor.id)) return { visible: false };

    const today = todayDushanbe();
    const { items, links } = await this.collect([p], today);
    const link = links.get(p.id) || null;
    return {
      visible: true,
      canLink: top,
      today,
      client: link ? { id: link.client.id, name: link.client.name, by: link.by, active: isEarning(link.client) } : null,
      // Ближайшее неоплаченное — главное; последняя оплата — для «оплачено».
      next: items.find(it => it.state !== 'paid') || null,
      lastPaid: items.find(it => it.state === 'paid') || null,
    };
  }

  /** Клиенты SMM из «Финансов» — для выбора в карточке проекта. */
  async financeClients() {
    const rows = (await this.clients()).filter(c => !c.archived && c.direction === 'smm');
    return rows
      .map(c => ({ id: c.id, name: c.name, active: isEarning(c) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  /**
   * Колонка «Менеджер» в «Финансы → Доход → SMM» (13.10.2026): кто берёт
   * деньги у клиента. Это тот же ответственный менеджер, что в карточке
   * SMM-проекта (smmData.salesManagerId) — отдельного поля в «Финансах» нет,
   * чтобы назначение не расходилось. Клиент «Финансов» находит свой проект
   * CRM той же связью, что и сроки оплат; где её нет — project = null, и
   * владелец связывает их вручную.
   */
  async financeManagers(actor: Actor) {
    const projects = await this.smmProjects();
    const all = await this.clients();
    const links = resolveFinanceLinks(
      projects.map(p => ({ id: p.id, name: p.name, financeProjectId: linkOf(p) })), all,
    );
    // Обратная сторона связи: клиент → проект. Ручной выбор важнее названия.
    const byClient = new Map<string, { project: Project; by: 'manual' | 'name' }>();
    for (const p of [...projects].sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
      const l = links.get(p.id);
      if (!l) continue;
      const cur = byClient.get(l.client.id);
      if (!cur || (cur.by === 'name' && l.by === 'manual')) byClient.set(l.client.id, { project: p, by: l.by });
    }
    const users: Array<{ id: string; name: string; avatar: string | null; role: string; secondaryRole: string | null; isActive: boolean }> =
      await this.ds.query(`SELECT id, name, avatar, role, "secondaryRole", "isActive" FROM users`)
        .catch((e: any) => { this.logger.warn(`users query failed: ${e?.message || e}`); return []; });
    const userOf = new Map(users.map(u => [u.id, u]));
    const person = (id: string | null) => {
      const u = id ? userOf.get(id) : undefined;
      return u ? { id: u.id, name: u.name, avatar: u.avatar || null } : null;
    };
    const linkedProject = new Map<string, string>();
    for (const [clientId, v] of byClient) linkedProject.set(v.project.id, clientId);

    return {
      // Менеджера назначает только владелец — как в карточке проекта.
      canAssign: this.rolesOf(actor).includes('founder'),
      canLink: this.isTop(actor),
      clients: [
        ...all
          .filter(c => c.direction === 'smm' && !c.archived)
          .map(c => {
            const hit = byClient.get(c.id) || null;
            return {
              financeProjectId: c.id,
              project: hit ? { id: hit.project.id, name: hit.project.name } : null,
              by: hit ? hit.by : null,
              manager: hit ? person(managerOf(hit.project)) : null,
              direct: false,
            };
          }),
        // Разработка (17.10.2026): менеджер хранится у клиента в «Финансах»,
        // связь с проектом CRM не нужна.
        ...all
          .filter(c => c.direction === 'development' && !c.archived)
          .map(c => ({ financeProjectId: c.id, project: null, by: null, manager: person(c.salesManagerId), direct: true })),
      ],
      managers: users
        .filter(u => u.isActive && (SALES_ROLES.includes(u.role) || SALES_ROLES.includes(u.secondaryRole || '')))
        .map(u => ({ id: u.id, name: u.name, avatar: u.avatar || null }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      // Проекты CRM для «связать»: свободные первыми.
      projects: projects
        .map(p => ({ id: p.id, name: p.name, taken: linkedProject.has(p.id) }))
        .sort((a, b) => Number(a.taken) - Number(b.taken) || a.name.localeCompare(b.name, 'ru')),
    };
  }

  /** Связать клиента «Финансов» с SMM-проектом CRM со стороны «Финансов»
   *  (null — снять ручную связь). У клиента один проект: прежняя ручная
   *  связь с этим клиентом у других проектов снимается. */
  async linkClient(financeProjectId: string, projectId: string | null, actor: Actor) {
    const found = (await this.clients()).some(c => c.id === financeProjectId);
    if (!found) throw new NotFoundException('Клиент в «Финансах» не найден');
    const projects = await this.smmProjects();
    const target = projectId ? projects.find(p => p.id === projectId) : null;
    if (projectId && !target) throw new NotFoundException('Проект не найден');
    for (const p of projects) {
      if (linkOf(p) !== financeProjectId || p.id === projectId) continue;
      const sd: any = { ...(p.smmData || {}) };
      delete sd.financeProjectId;
      await this.projectRepo.update(p.id, { smmData: sd });
    }
    if (target) {
      const sd: any = { ...(target.smmData || {}), financeProjectId };
      await this.projectRepo.update(target.id, { smmData: sd });
    }
    return this.financeManagers(actor);
  }

  /** Менеджер клиента разработки в «Доход → Разработка» (null — снять).
   *  У SMM-клиента менеджер назначается в карточке проекта CRM. */
  async setClientManager(financeProjectId: string, userId: string | null, actor: Actor) {
    if (!this.rolesOf(actor).includes('founder')) throw new BadRequestException('Менеджера назначает основатель');
    const client = (await this.clients()).find(c => c.id === financeProjectId);
    if (!client) throw new NotFoundException('Клиент в «Финансах» не найден');
    if (client.direction === 'smm') throw new BadRequestException('Менеджер SMM-клиента назначается в карточке проекта');
    if (userId) {
      const [u]: any[] = await this.ds.query(`SELECT role, "secondaryRole", "isActive" FROM users WHERE id = $1`, [userId]);
      if (!u || !u.isActive || !(SALES_ROLES.includes(u.role) || SALES_ROLES.includes(u.secondaryRole || ''))) {
        throw new BadRequestException('Выберите менеджера по продажам');
      }
    }
    await this.ds.query(`UPDATE finance_projects SET "salesManagerId" = $1 WHERE id = $2`, [userId, financeProjectId]);
    return this.financeManagers(actor);
  }

  /** Связать SMM-проект с клиентом «Финансов» вручную (null — вернуть поиск
   *  по названию). Нужно там, где названия в CRM и в «Финансах» разные. */
  async link(projectId: string, financeProjectId: string | null, actor: Actor) {
    const p = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!p || p.projectType !== 'SMM') throw new NotFoundException('Проект не найден');
    if (financeProjectId) {
      const found = (await this.clients()).some(c => c.id === financeProjectId);
      if (!found) throw new BadRequestException('Клиент в «Финансах» не найден');
    }
    const sd: any = { ...(p.smmData || {}) };
    if (financeProjectId) sd.financeProjectId = financeProjectId;
    else delete sd.financeProjectId;
    await this.projectRepo.update(projectId, { smmData: sd });
    return this.project(projectId, actor);
  }
}
