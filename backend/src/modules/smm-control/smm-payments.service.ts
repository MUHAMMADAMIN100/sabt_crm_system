import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { patchSmmData } from '../projects/project-access';
import { hasGrant } from '../auth/permissions';
import {
  CalPay, FinClient, FinPlan, FinTx, OwnerProject, PayItem, calendarPays, cardPays, isEarning, mayOwn,
  monthPayState, ownedPays, payScope, resolveFinanceLinks, toPayItem, withManagerChange,
} from './smm-payments.logic';

/** Кто видит сроки оплат всех проектов и связывает проект с клиентом
 *  «Финансов». Суммы — отдельно, по праву finance.manage (15.11.2026):
 *  «админ без финансов» — календарь у админа есть, денег в нём нет. */
const TOP_ROLES = ['admin', 'founder'];
/** Ответственные за SMM-проекты — менеджеры по продажам, оба вида
 *  (решение владельца 10.10.2026, подтверждено 15.10.2026). */
const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev'];

type Actor = {
  id: string; role?: string | null; secondaryRole?: string | null;
  // Персональные доступы (req.user — сущность User): запрет сильнее роли.
  extraPermissions?: string[] | null; deniedPermissions?: string[] | null;
};
/** Чьи суммы видит зритель календаря: все, только своих клиентов или ничьи. */
export type MoneyView = 'all' | 'own' | 'none';
/** Клиент «Финансов» с полями, нужными календарю менеджера. */
type FinClientRow = FinClient & { retentionMonths: number | null; salesManagerId: string | null; salesManagerHistory: unknown };
/** Менеджеры, чьи деньги нужны: id менеджера → подходит ли. */
type Want = (managerId: string | null) => boolean;
/** Направления, где менеджер хранится у клиента «Финансов» (не SMM). */
const DIRECT_DIRECTIONS = ['development', 'design', 'maintenance'];

/** Деньги дня в календаре на «Панели» менеджера: сумма, клиент и проект CRM. */
export type CalendarPayItem = CalPay & { name: string; projectId: string | null; direction: string | null };
/** Оплата с пометкой «клиент самого зрителя» — для решения, показать ли сумму. */
type OwnedCalendarPayItem = CalendarPayItem & { own: boolean };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Оплата клиента для менеджера: проект, день, состояние — без сумм. У
 *  клиента не из SMM проекта CRM нет — projectId = null. */
export type ProjectPayItem = PayItem & { projectId: string | null; projectName: string };

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
const isLive = (p: Project) => !p.isArchived && String(p.status) !== 'archived';
const addDays = (iso: string, delta: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
/** Проект CRM для выбора, чей клиент «Финансов». */
const ownerProject = (p: Project): OwnerProject => ({
  id: p.id, name: p.name, financeProjectId: linkOf(p), live: isLive(p),
  managerId: managerOf(p), history: (p.smmData as any)?.salesManagerHistory,
});

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
  private isTop(a: Actor) { return this.rolesOf(a).some(r => TOP_ROLES.includes(r)); }
  /** Суммы (15.11.2026): все — у права finance.manage; менеджер по продажам —
   *  только своих клиентов и при праве «Оплаты проекта — просмотр»; админ и
   *  остальные — без сумм. Запреты (deniedPermissions) учитывает hasGrant. */
  private moneyView(a: Actor): MoneyView {
    const user = {
      role: a.role ?? null, secondaryRole: a.secondaryRole ?? null,
      extraPermissions: a.extraPermissions ?? null, deniedPermissions: a.deniedPermissions ?? null,
    };
    if (hasGrant(user, 'finance.manage')) return 'all';
    const sales = this.rolesOf(a).some(r => SALES_ROLES.includes(r));
    return sales && hasGrant(user, 'projects.payments.view') ? 'own' : 'none';
  }

  private async smmProjects(): Promise<Project[]> {
    const rows = await this.projectRepo.find({ where: { projectType: 'SMM', isArchived: false } as any });
    return rows.filter(p => String(p.status) !== 'archived');
  }

  /** Все SMM-проекты, и архивные: их прошлые оплаты остаются за менеджером. */
  private async allSmmProjects(): Promise<Project[]> {
    return this.projectRepo.find({ where: { projectType: 'SMM' } as any });
  }

  private async clients(): Promise<FinClientRow[]> {
    const rows: any[] = await this.ds.query(
      `SELECT id, name, direction, tariff::float AS tariff,
              to_char("contractDate", 'YYYY-MM-DD') AS "contractDate",
              to_char("cycleAnchor", 'YYYY-MM-DD') AS "cycleAnchor",
              COALESCE(archived, false) AS archived, status,
              "retentionMonths", "salesManagerId", "salesManagerHistory"
         FROM finance_projects`,
    ).catch((e: any) => { this.logger.warn(`finance clients query failed: ${e?.message || e}`); return []; });
    return rows.map(r => ({
      ...r, tariff: Number(r.tariff) || 0, archived: !!r.archived,
      retentionMonths: r.retentionMonths == null ? null : Number(r.retentionMonths),
      salesManagerId: r.salesManagerId || null,
      salesManagerHistory: r.salesManagerHistory ?? null,
    }));
  }

  /** Оплаты клиентов менеджера за [from, to] — события «Оплата: …» в
   *  «Календаре»: те же даты и состояния, что на «Панели», без сумм.
   *  Полученная стоит в день прихода денег; клиенты разработки — тоже. */
  async forManager(userId: string, from?: string, to?: string): Promise<ProjectPayItem[]> {
    const today = todayDushanbe();
    const lo = ISO_DAY.test(String(from || '')) ? String(from) : `${today.slice(0, 7)}-01`;
    const hi = ISO_DAY.test(String(to || '')) && String(to) >= lo ? String(to) : monthEnd(lo);
    const { items } = await this.calendarOf(id => id === userId, lo, hi);
    return items.map(it => ({
      ...toPayItem(it), key: `${it.projectId || it.clientId}:${it.key}`, projectId: it.projectId, projectName: it.name,
    }));
  }

  /**
   * Деньги в календаре «Панели» менеджера по продажам (решение владельца
   * 17.10.2026): то же, что владелец видит в «Финансах → Планирование», но
   * только по клиентам менеджера — SMM-проекты, где он ответственный в CRM,
   * и клиенты разработки, дизайна и обслуживания, где он назначен в
   * «Доходе». Полученное — только за время, когда клиент был его (история
   * назначений, 14.11.2026). Владелец и админ видят всех клиентов, у
   * которых есть менеджер. Суммы — по moneyView (15.11.2026): без права
   * amount = null, money подсказывает фронту, что суммы скрыты.
   */
  async calendar(actor: Actor, fromRaw?: string, toRaw?: string) {
    const today = todayDushanbe();
    const from = ISO_DAY.test(String(fromRaw || '')) ? String(fromRaw) : `${today.slice(0, 7)}-01`;
    const to = ISO_DAY.test(String(toRaw || '')) && String(toRaw) >= from ? String(toRaw) : monthEnd(from);
    const top = this.isTop(actor);
    const money = this.moneyView(actor);
    const res = await this.calendarOf(id => (top ? !!id : id === actor.id), from, to, id => id === actor.id);
    return {
      ...res,
      money,
      items: res.items.map(({ own, ...it }) => ({
        ...it,
        amount: money === 'all' || (money === 'own' && own) ? it.amount : null,
      })),
    };
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

  /** Деньги клиентов менеджеров под want за [from, to] (решение владельца
   *  14.11.2026): полученная оплата — тому, кто отвечал за клиента в день
   *  оплаты, и у архивных клиентов тоже; ожидаемая и прогноз — текущему
   *  ответственному. Так «получено за месяц» на «Панели» и факт плана
   *  продаж — одни и те же деньги, а смена менеджера не переносит прошлое. */
  private async calendarOf(want: Want, from: string, to: string, own: Want = want) {
    const today = todayDushanbe();
    const all = await this.clients();
    const projects = await this.allSmmProjects();
    const scope = [...payScope(projects.map(ownerProject), all).values()].filter(x => mayOwn(x.owner, want));
    if (!scope.length) return { today, from, to, clients: 0, items: [] as OwnedCalendarPayItem[] };

    const { plans, txs } = await this.moneyOf(scope.map(x => x.client.id), from, to, today);
    const items: OwnedCalendarPayItem[] = [];
    for (const { client, name, projectId, owner } of scope) {
      const pays = ownedPays(calendarPays(client, plans, txs, from, to, today), owner, want);
      // Оплата «своего» клиента — по тому же правилу владения (15.11.2026).
      const mine = new Set(ownedPays(pays, owner, own).map(it => it.key));
      for (const it of pays) {
        items.push({ ...it, name, projectId, direction: client.direction, own: mine.has(it.key) });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ru') || a.partNo - b.partNo);
    // «Своих клиентов пока нет» — про тех, кого менеджер ведёт сейчас.
    return { today, from, to, clients: scope.filter(x => want(x.owner.current)).length, items };
  }

  /** Плановые оплаты и поступления клиентов для окна [from, to]. */
  private async moneyOf(clientIds: string[], from: string, to: string, today: string) {
    // Окно запросов шире календаря: текущий месяц нужен всегда (прогноз и
    // «Просрочено»), месяц до окна — для оплат, полученных позже своего месяца.
    const lo = [from, today].sort()[0];
    const hi = [to, today].sort()[1];
    const [plans, txs] = await Promise.all([this.calendarPlans(clientIds, lo), this.incomeTxs(clientIds, lo, hi)]);
    return { plans, txs };
  }

  /** Колонка «Оплата» в «Контроле» за месяц: состояние клиента каждого
   *  проекта по тем же оплатам, что на «Панели» и в «Планировании». */
  async monthStates(projects: Project[], month: string): Promise<Map<string, 'late' | 'wait' | 'paid'>> {
    const out = new Map<string, 'late' | 'wait' | 'paid'>();
    if (!projects.length) return out;
    const today = todayDushanbe();
    const from = `${month}-01`;
    const to = monthEnd(from);
    const links = resolveFinanceLinks(projects.map(p => ({ id: p.id, name: p.name, financeProjectId: linkOf(p) })), await this.clients());
    const ids = [...new Set([...links.values()].map(l => l.client.id))];
    if (!ids.length) return out;
    const { plans, txs } = await this.moneyOf(ids, from, to, today);
    for (const [projectId, { client }] of links) {
      const st = monthPayState(calendarPays(client, plans, txs, from, to, today), from, to);
      if (st) out.set(projectId, st);
    }
    return out;
  }

  /** Плановые оплаты для календаря: все ожидаемые (просрочка) и любые с
   *  месяцем или сроком не раньше месяца до окна. */
  private async calendarPlans(clientIds: string[], lo: string): Promise<FinPlan[]> {
    const rows: any[] = await this.ds.query(
      `SELECT pp.id, pp."projectId" AS "projectId", pp.ym, pp."partNo" AS "partNo", pp.status,
              to_char(pp."dueDate", 'YYYY-MM-DD') AS "dueDate", pp.amount::float AS amount,
              CASE WHEN COALESCE(tx.status, 'completed') <> 'cancelled' THEN to_char(tx.date, 'YYYY-MM-DD') END AS "paidAt",
              pp."receivedTxId" AS "receivedTxId"
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
    const link = resolveFinanceLinks([{ id: p.id, name: p.name, financeProjectId: linkOf(p) }], await this.clients()).get(p.id) || null;
    let next: ProjectPayItem | null = null;
    let lastPaid: ProjectPayItem | null = null;
    if (link) {
      // Те же оплаты, что на «Панели»: неделя назад — для «оплачено», год
      // вперёд — чтобы ближайший срок нашёлся всегда.
      const from = addDays(today, -7);
      const to = monthEnd(`${shiftMonth(today, 12)}-01`);
      const { plans, txs } = await this.moneyOf([link.client.id], from, to, today);
      const pick = cardPays(calendarPays(link.client, plans, txs, from, to, today), today);
      const wrap = (it: CalPay | null): ProjectPayItem | null =>
        (it ? { ...toPayItem(it), key: `${p.id}:${it.key}`, projectId: p.id, projectName: p.name } : null);
      next = wrap(pick.next);
      lastPaid = wrap(pick.lastPaid);
    }
    return {
      visible: true,
      canLink: top,
      today,
      client: link ? { id: link.client.id, name: link.client.name, by: link.by, active: isEarning(link.client) } : null,
      // Ближайшее неоплаченное — главное; последняя оплата — для «оплачено».
      next,
      lastPaid,
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
        // Разработка (17.10.2026), дизайн и обслуживание (14.11.2026):
        // менеджер хранится у клиента в «Финансах», связь с проектом CRM не нужна.
        ...all
          .filter(c => DIRECT_DIRECTIONS.includes(c.direction || '') && !c.archived)
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
    // Точечная правка smmData одним UPDATE (15.11.2026): раньше smmData
    // перезаписывался целиком и затирал параллельные правки карточки проекта.
    for (const p of projects) {
      if (linkOf(p) !== financeProjectId || p.id === projectId) continue;
      await patchSmmData(this.ds.manager, p.id, {}, ['financeProjectId']);
    }
    if (target) {
      await patchSmmData(this.ds.manager, target.id, { financeProjectId });
    }
    return this.financeManagers(actor);
  }

  /** Менеджер клиента разработки, дизайна или обслуживания в «Доходе» (null — снять).
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
    // История назначений (14.11.2026): прошлые оплаты остаются за тем, кто
    // вёл клиента в день оплаты.
    const history = withManagerChange(client.salesManagerHistory, client.salesManagerId, userId, todayDushanbe(), client.contractDate);
    await this.ds.query(
      `UPDATE finance_projects SET "salesManagerId" = $1, "salesManagerHistory" = $2::jsonb WHERE id = $3`,
      [userId, history.length ? JSON.stringify(history) : null, financeProjectId],
    );
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
    // Точечная правка smmData (15.11.2026) — без перезаписи всего объекта.
    if (financeProjectId) await patchSmmData(this.ds.manager, projectId, { financeProjectId });
    else await patchSmmData(this.ds.manager, projectId, {}, ['financeProjectId']);
    return this.project(projectId, actor);
  }
}
