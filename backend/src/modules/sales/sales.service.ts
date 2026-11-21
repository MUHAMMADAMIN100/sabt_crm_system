import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger,
  NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClientLead, ClientLeadStatus } from '../clients/client-lead.entity';
import { ClientsService } from '../clients/clients.service';
import { recordLeadEvent } from '../clients/lead-events';
import { leadLink } from '../clients/lead-agenda';
import { addDaysIso, dushanbeDay } from '../clients/sales-kpi.logic';
import { Task, TaskPriority, TaskScope, TaskStatus } from '../tasks/task.entity';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';
import { AppGateway } from '../gateway/app.gateway';
import { escapeHtml } from '../../common/html-escape';
import { salesRoleOf } from '../../common/sales-segment';
import {
  CallDto, CommentDto, EmailDto, HandoffDto, LinkProjectDto, MeetingResultDto,
} from './dto/sales.dto';
import {
  SalesUser, canActOnLead, canViewLead, directorRoleFor, handoffDirectionsFor, isSalesOwner, isSalesTop,
} from './sales-access';
import { AGENDA_ACTIVE_STATUSES, Agenda, buildAgenda } from './sales-agenda.logic';
import { ActionPlan, PlannedEvent, callPlan, emailPlan, meetingPlan } from './sales-actions.logic';
import {
  HandoffData, HandoffView, LinkProjectRow, directionLabel, fmtDayRu, fmtSomoni, handoffDataOf,
  handoffTaskDescription, handoffViewOf, salesManagerPatch,
} from './sales-handoff.logic';
import { patchSmmData } from '../projects/project-access';
import { withManagerChange } from '../smm-control/smm-payments.logic';

/** Лид в ответе API: владелец — только { id, name } (SALES_SPEC §2). */
export type LeadView = Omit<ClientLead, 'owner'> & { owner: { id: string; name: string } | null };

export interface LeadEventView {
  id: string;
  kind: string;
  data: Record<string, any> | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

/** Предел лидов для «Сегодня» — защита от «всех лидов компании» у МП. */
const AGENDA_MAX_LEADS = 3000;
const EVENTS_LIMIT = 200;

export function toLeadView(lead: ClientLead): LeadView {
  const { owner, ...rest } = lead as ClientLead & { owner?: User | null };
  return { ...(rest as Omit<ClientLead, 'owner'>), owner: owner ? { id: owner.id, name: owner.name } : null };
}

/** manager.query для UPDATE/DELETE отдаёт [rows, count], для остального —
 *  rows. Нужны строки RETURNING в обоих случаях. */
export function rowsOf(res: unknown): any[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return Array.isArray(res) ? res : [];
}

/**
 * Продажи, этап 2 (15.11.2026): действия менеджера над лидом, «Сегодня»,
 * лента событий и «Передать в работу». Договор — docs/SALES_SPEC.md §5.
 *
 * Этап лида меняем только через ClientsService.updateWithAuth — там вехи
 * воронки (KPI «Продвижения») и событие «stage». Остальные поля пишем сами
 * и сами же кладём события в lead_events: ClientsService об этих правках не
 * знает, поэтому двойных событий нет.
 */
@Injectable()
export class SalesService implements OnModuleInit {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectRepository(ClientLead) private leadRepo: Repository<ClientLead>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private clients: ClientsService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    private gateway: AppGateway,
  ) {}

  /** Таблицы ленты и настроек — как в миграции 1834: на базе разработчика
   *  миграции могли не прогнать, а без lead_events не работает ни одно
   *  действие. DDL идентичен миграции, IF NOT EXISTS — повтор безвреден. */
  async onModuleInit(): Promise<void> {
    const m = this.leadRepo.manager;
    try {
      await m.query(`
        CREATE TABLE IF NOT EXISTS lead_events (
          id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          lead_id    uuid NOT NULL,
          user_id    uuid NULL,
          kind       varchar(32) NOT NULL,
          data       jsonb NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await m.query(`CREATE INDEX IF NOT EXISTS idx_lead_events_lead_date ON lead_events (lead_id, created_at DESC)`);
      await m.query(`
        CREATE TABLE IF NOT EXISTS sales_settings (
          key        varchar(64) PRIMARY KEY,
          value      jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          updated_by uuid NULL
        )
      `);
    } catch (e: any) {
      this.logger.error(`ensure lead_events/sales_settings failed: ${e?.message || e}`);
    }
  }

  // ─── Общее ─────────────────────────────────────────────────────────────

  /** Лид для действия ('act') или чтения ленты ('view'): 404 / 403. */
  async leadFor(id: string, user: SalesUser, mode: 'act' | 'view' = 'act'): Promise<ClientLead> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Лид не найден');
    const ok = mode === 'view' ? canViewLead(user, lead) : canActOnLead(user, lead);
    if (!ok) {
      throw new ForbiddenException(mode === 'view' ? 'Нет доступа к этому лиду' : 'Это лид другого менеджера');
    }
    return lead;
  }

  /** Свежий лид с владельцем { id, name } — ответ всех действий. */
  async view(id: string): Promise<LeadView> {
    const lead = await this.leadRepo.findOne({ where: { id }, relations: ['owner'] });
    if (!lead) throw new NotFoundException('Лид не найден');
    return toLeadView(lead);
  }

  /** Экраны продаж (доска, список, «Сегодня», KPI) обновляются по сокету —
   *  то же событие, что шлёт ClientsService. */
  private broadcast(leadId: string, ownerId?: string | null): void {
    try { this.gateway.broadcast('leads:changed', { leadId, ownerId: ownerId ?? null }); } catch { /* сокет не критичен */ }
  }

  /** События — второстепенны: сбой журнала действие не отменяет. */
  private async writeEvents(leadId: string, userId: string | null, events: PlannedEvent[]): Promise<void> {
    for (const e of events) {
      try {
        await recordLeadEvent(this.leadRepo.manager, { leadId, userId, kind: e.kind, data: e.data });
      } catch (err: any) {
        this.logger.warn(`lead event ${e.kind} for ${leadId} failed: ${err?.message || err}`);
      }
    }
  }

  /** Кому зачёт KPI: владелец-МП (его воронка, даже если звонил
   *  руководитель), иначе — тот, кто сделал (как ClientsService.maybeLogProgress). */
  async creditUserId(lead: Pick<ClientLead, 'ownerId'>, actor: SalesUser): Promise<string> {
    if (lead.ownerId && lead.ownerId !== actor.id) {
      const owner = await this.userRepo.findOne({
        where: { id: lead.ownerId },
        select: ['id', 'role', 'secondaryRole'] as any,
      }).catch(() => null);
      if (owner && salesRoleOf(owner)) return owner.id;
    }
    return actor.id;
  }

  /**
   * KPI-событие в lead_actions — так, как его считает ClientsService.kpi:
   *  - cold_call — по created_at, не чаще 1 на лид в день на менеджера
   *    (как logColdCall);
   *  - email — по created_at, 1 на лид в день (как отметка «Написал» через
   *    PATCH: два пути не дают двух писем за день);
   *  - meeting — по "at" (= момент отметки «состоялась»), 1 на лид в день.
   * Дни — по Душанбе. Best-effort: ошибка журнала действие не отменяет.
   */
  private async logKpi(kind: 'cold_call' | 'email' | 'meeting', userId: string, leadId: string, at?: Date): Promise<void> {
    const m = this.leadRepo.manager;
    try {
      if (kind === 'cold_call') {
        await m.query(
          `INSERT INTO lead_actions (user_id, lead_id, kind)
           SELECT $1::uuid, $2::uuid, 'cold_call'
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_actions
             WHERE user_id = $1::uuid AND lead_id = $2::uuid AND kind = 'cold_call'
               AND (created_at AT TIME ZONE 'Asia/Dushanbe')::date = (NOW() AT TIME ZONE 'Asia/Dushanbe')::date)`,
          [userId, leadId],
        );
      } else if (kind === 'email') {
        await m.query(
          `INSERT INTO lead_actions (user_id, lead_id, kind)
           SELECT $1::uuid, $2::uuid, 'email'
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_actions
             WHERE lead_id = $2::uuid AND kind = 'email'
               AND (created_at AT TIME ZONE 'Asia/Dushanbe')::date = (NOW() AT TIME ZONE 'Asia/Dushanbe')::date)`,
          [userId, leadId],
        );
      } else {
        await m.query(
          `INSERT INTO lead_actions (user_id, lead_id, kind, "at")
           SELECT $1::uuid, $2::uuid, 'meeting', $3::timestamptz
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_actions
             WHERE lead_id = $2::uuid AND kind = 'meeting'
               AND ("at" AT TIME ZONE 'Asia/Dushanbe')::date = ($3::timestamptz AT TIME ZONE 'Asia/Dushanbe')::date)`,
          [userId, leadId, at ?? new Date()],
        );
      }
    } catch (e: any) {
      this.logger.warn(`lead_actions ${kind} for ${leadId} failed: ${e?.message || e}`);
    }
  }

  /** Применить план действия: поля → события → KPI → этап → сокет. */
  private async applyPlan(lead: ClientLead, plan: ActionPlan, user: SalesUser): Promise<LeadView> {
    if (Object.keys(plan.patch).length) {
      await this.leadRepo.update(lead.id, plan.patch as any);
    }
    await this.writeEvents(lead.id, user.id, plan.events);
    if (plan.kpi) {
      await this.logKpi(plan.kpi.kind, await this.creditUserId(lead, user), lead.id, plan.kpi.at);
    }
    if (plan.stageTo && plan.stageTo !== lead.status) {
      // Этап — побочный эффект: звонок/встреча уже записаны, поэтому сбой
      // смены этапа не превращаем в ошибку всего действия.
      try {
        await this.clients.updateWithAuth(lead.id, { status: plan.stageTo as ClientLeadStatus }, user as any);
      } catch (e: any) {
        this.logger.warn(`stage ${lead.status}→${plan.stageTo} for ${lead.id} failed: ${e?.message || e}`);
      }
    }
    this.broadcast(lead.id, lead.ownerId);
    return this.view(lead.id);
  }

  // ─── «Сегодня» ─────────────────────────────────────────────────────────

  /** Лента «Просрочено / Сегодня / Завтра» и «Требует внимания» по своим
   *  лидам. Оплаты и свои задачи фронт берёт из существующих API. */
  async agenda(user: SalesUser): Promise<Agenda> {
    const leads = await this.leadRepo.find({
      where: {
        ownerId: user.id,
        status: In(AGENDA_ACTIVE_STATUSES as ClientLeadStatus[]),
        onHold: false,
      },
      select: [
        'id', 'name', 'status', 'onHold', 'nextContactAt', 'meetingResult', 'repeatCallAt',
        'nextStepAt', 'nextStep', 'contactPhone', 'dealPotential', 'lastActivityAt', 'lastContactAt', 'createdAt',
      ],
      take: AGENDA_MAX_LEADS,
    });
    return buildAgenda(leads as any[], new Date());
  }

  // ─── Действия ──────────────────────────────────────────────────────────

  async logCall(id: string, dto: CallDto, user: SalesUser): Promise<LeadView> {
    const lead = await this.leadFor(id, user);
    return this.applyPlan(lead, callPlan(lead, dto, new Date()), user);
  }

  async logEmail(id: string, dto: EmailDto, user: SalesUser): Promise<LeadView> {
    const lead = await this.leadFor(id, user);
    return this.applyPlan(lead, emailPlan(lead, dto || {}, new Date()), user);
  }

  async meetingResult(id: string, dto: MeetingResultDto, user: SalesUser): Promise<LeadView> {
    const lead = await this.leadFor(id, user);
    return this.applyPlan(lead, meetingPlan(lead, dto, new Date()), user);
  }

  // ─── Лента событий и комментарии ───────────────────────────────────────

  async events(id: string, user: SalesUser): Promise<LeadEventView[]> {
    await this.leadFor(id, user, 'view');
    const rows: any[] = await this.leadRepo.manager.query(
      `SELECT e.id, e.kind, e.data, e.created_at AS "createdAt", e.user_id AS "userId", u.name AS "userName"
         FROM lead_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.lead_id = $1
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${EVENTS_LIMIT}`,
      [id],
    );
    return (rows || []).map(r => ({
      id: r.id,
      kind: r.kind,
      data: r.data ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      // Удалённый сотрудник — без имени: показываем «система», а не «undefined».
      user: r.userId && r.userName ? { id: r.userId, name: r.userName } : null,
    }));
  }

  async addComment(id: string, dto: CommentDto, user: SalesUser): Promise<LeadEventView> {
    const lead = await this.leadFor(id, user);
    const text = String(dto?.text ?? '').trim();
    if (!text) throw new BadRequestException('Комментарий пустой');
    // Не recordLeadEvent: ответу нужна сама запись (id, время) — RETURNING.
    const rows = rowsOf(await this.leadRepo.manager.query(
      `INSERT INTO lead_events (lead_id, user_id, kind, data)
       VALUES ($1, $2, 'comment', $3::jsonb)
       RETURNING id, kind, data, created_at AS "createdAt"`,
      [id, user.id, JSON.stringify({ text })],
    ));
    const row = rows[0] || {};
    this.broadcast(lead.id, lead.ownerId);
    return {
      id: row.id,
      kind: 'comment',
      data: row.data ?? { text },
      createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
      user: { id: user.id, name: user.name || '' },
    };
  }

  // ─── «Передать в работу» ───────────────────────────────────────────────

  /**
   * Сделка выиграна: этап «Выиграно» через ClientsService (веха воронки),
   * данные передачи в лиде, событие «handoff», уведомления основателю,
   * админам (бывший сооснователь — admin) и руководителю направления в CRM
   * и Telegram, задача «Создать проект» руководителю (нет — основателю).
   * Повторная передача — 409.
   */
  async handoff(id: string, dto: HandoffDto, user: SalesUser): Promise<LeadView> {
    const lead = await this.leadFor(id, user);
    if (lead.handoffAt) throw new ConflictException('Клиент уже передан в работу');
    const data = handoffDataOf(dto);
    if (!data.product) throw new BadRequestException('Укажите, что продано');
    const m = this.leadRepo.manager;

    // Занимаем передачу одним UPDATE … WHERE "handoffAt" IS NULL: два
    // одновременных клика не дадут двух задач и двух рассылок.
    const claimed = rowsOf(await m.query(
      `UPDATE client_leads
          SET "handoffAt" = $2, "handoffById" = $3, "handoffData" = $4::jsonb
        WHERE id = $1 AND "handoffAt" IS NULL
        RETURNING id`,
      [id, new Date(), user.id, JSON.stringify(data)],
    ));
    if (!claimed.length) throw new ConflictException('Клиент уже передан в работу');

    if (lead.status !== ClientLeadStatus.WON) {
      try {
        await this.clients.updateWithAuth(id, { status: ClientLeadStatus.WON }, user as any);
      } catch (e) {
        // Этап не сменился — передачи не было: снимаем отметку, ошибку отдаём.
        await m.query(
          `UPDATE client_leads SET "handoffAt" = NULL, "handoffById" = NULL, "handoffData" = NULL WHERE id = $1`,
          [id],
        ).catch(() => undefined);
        throw e;
      }
    }

    await this.writeEvents(id, user.id, [{ kind: 'handoff', data: { ...data } }]);

    const created = await this.createHandoffTask(lead, data, user).catch((e: any) => {
      this.logger.warn(`handoff task for ${id} failed: ${e?.message || e}`);
      return null;
    });
    const task = created?.task ?? null;
    if (task) {
      // id задачи — в данных передачи: при связи с проектом задачу закроем.
      await m.query(
        `UPDATE client_leads SET "handoffData" = COALESCE("handoffData", '{}'::jsonb) || jsonb_build_object('taskId', $2::text) WHERE id = $1`,
        [id, task.id],
      ).catch(() => undefined);
    }
    await this.notifyHandoff(lead, data, user, created).catch((e: any) =>
      this.logger.warn(`handoff notify for ${id} failed: ${e?.message || e}`));

    this.broadcast(id, lead.ownerId);
    return this.view(id);
  }

  /** Руководитель направления (основной ролью — первым), нет — основатель. */
  private async handoffAssignee(direction: string): Promise<User | null> {
    const role = directorRoleFor(direction) as UserRole;
    const directors = await this.userRepo.find({
      where: [
        { role, isActive: true, isBlocked: false },
        { secondaryRole: role, isActive: true, isBlocked: false },
      ],
      order: { name: 'ASC' },
    });
    const primary = directors.find(u => u.role === role);
    if (primary || directors[0]) return primary || directors[0];
    const founders = await this.userRepo.find({
      where: { role: UserRole.FOUNDER, isActive: true, isBlocked: false },
      order: { name: 'ASC' },
    });
    return founders[0] ?? null;
  }

  private async createHandoffTask(
    lead: ClientLead, data: HandoffData, user: SalesUser,
  ): Promise<{ task: Task; assignee: User } | null> {
    const assignee = await this.handoffAssignee(data.direction);
    if (!assignee) return null;
    const tomorrow = addDaysIso(dushanbeDay(new Date()), 1);
    const task = this.taskRepo.create({
      title: `Создать проект: ${lead.name}`,
      description: handoffTaskDescription(lead, data, user.name || ''),
      // Срок — завтра, конец рабочего дня по Душанбе.
      deadline: new Date(`${tomorrow}T18:00:00+05:00`),
      priority: TaskPriority.HIGH,
      status: TaskStatus.NEW,
      scope: TaskScope.BUSINESS,
      createdById: user.id,
      assigneeId: assignee.id,
    });
    return { task: await this.taskRepo.save(task), assignee };
  }

  private async notifyHandoff(
    lead: ClientLead, data: HandoffData, user: SalesUser, created: { task: Task; assignee: User } | null,
  ): Promise<void> {
    const task = created?.task ?? null;
    const dirRole = directorRoleFor(data.direction) as UserRole;
    const people = await this.userRepo.find({
      where: [
        // Админу — нет (21.11.2026): «Продажи» и заявки — только основателю.
        { role: UserRole.FOUNDER, isActive: true, isBlocked: false },
        { role: dirRole, isActive: true, isBlocked: false },
        { secondaryRole: dirRole, isActive: true, isBlocked: false },
      ],
    });
    const seen = new Set<string>([user.id]);
    const manager = user.name || 'Менеджер продаж';
    const title = '🤝 Клиент передан в работу';
    const message = `${manager}: «${lead.name}» — ${data.product}, ${fmtSomoni(data.amount)}, `
      + `первая оплата ${fmtDayRu(data.firstPaymentAt)} (${directionLabel(data.direction)}).`;
    const html = [
      `🤝 <b>Клиент передан в работу</b>`,
      `<b>${escapeHtml(lead.name)}</b> — ${escapeHtml(data.product)}, ${escapeHtml(fmtSomoni(data.amount))}`,
      `Направление: ${escapeHtml(directionLabel(data.direction))}`,
      `Первая оплата: ${escapeHtml(fmtDayRu(data.firstPaymentAt))}`,
      `Менеджер: ${escapeHtml(manager)}`,
      data.note ? `Комментарий: ${escapeHtml(data.note)}` : '',
      created ? `Задача «Создать проект»: ${escapeHtml(created.assignee.name)}` : '',
    ].filter(Boolean).join('\n');
    for (const p of people) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      // Руководство открывает карточку лида; директор (без доступа к
      // «Клиентам») — задачу «Создать проект».
      const link = task && task.assigneeId === p.id
        ? `/tasks/${task.id}`
        : isSalesTop(p) ? leadLink(lead.id) : (task ? `/tasks/${task.id}` : '/projects');
      await this.notifications.create({
        userId: p.id,
        type: NotificationType.STATUS_CHANGE,
        title,
        message,
        link,
        data: { kind: 'sales_handoff', leadId: lead.id, taskId: task?.id ?? null },
      }).catch((e: any) => this.logger.warn(`handoff notification to ${p.id} failed: ${e?.message || e}`));
      this.telegram.sendToUser(p.id, html).catch(() => undefined);
    }
  }

  /** «Заявки от продаж»: open — проекта ещё нет, done — проект связан. */
  async handoffs(user: SalesUser, status?: string): Promise<HandoffView[]> {
    const dirs = handoffDirectionsFor(user);
    if (dirs && !dirs.length) {
      throw new ForbiddenException('Заявки от продаж видят основатель и руководители направлений');
    }
    if (status !== undefined && status !== '' && status !== 'open' && status !== 'done') {
      throw new BadRequestException('status — open или done');
    }
    const done = status === 'done';
    const params: any[] = [];
    let where = `c."handoffAt" IS NOT NULL AND c."projectId" IS ${done ? 'NOT ' : ''}NULL`;
    if (dirs) {
      params.push(dirs);
      where += ` AND COALESCE(c."handoffData"->>'direction', c.direction::text) = ANY($${params.length}::text[])`;
    }
    const rows: any[] = await this.leadRepo.manager.query(
      `SELECT c.id, c.name, c."handoffAt", c."handoffData", c."projectId", c.direction::text AS direction,
              c."contactPerson", c."contactPhone", c."contactInstagram",
              COALESCE(hb.id::text, ow.id::text) AS "managerId",
              COALESCE(hb.name, ow.name) AS "managerName"
         FROM client_leads c
         LEFT JOIN users hb ON hb.id = c."handoffById"
         LEFT JOIN users ow ON ow.id::text = c."ownerId"::text
        WHERE ${where}
        ORDER BY c."handoffAt" DESC
        LIMIT 500`,
      params,
    );
    return (rows || []).map(handoffViewOf);
  }

  /**
   * Связать лид с проектом (основатель, 21.11.2026): client_leads.projectId и
   * projects.leadId — у проекта один лид, у лида один проект. Событие
   * «project_linked», менеджеру — «Проект создан», задача «Создать проект»
   * закрывается.
   */
  async linkProject(leadId: string, dto: LinkProjectDto, user: SalesUser): Promise<LeadView> {
    if (!isSalesOwner(user)) throw new ForbiddenException('Связать заявку с проектом может только основатель');
    const lead = await this.leadRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Лид не найден');
    const m = this.leadRepo.manager;
    const projects: Array<LinkProjectRow & { id: string; name: string; leadId: string | null }> = await m.query(
      `SELECT id, name, "leadId", "projectType", "salesManagerId"::text AS "salesManagerId", "smmData"
         FROM projects WHERE id = $1`,
      [dto.projectId],
    );
    const project = projects?.[0];
    if (!project) throw new NotFoundException('Проект не найден');
    if (project.leadId && project.leadId !== leadId) {
      throw new ConflictException('Проект уже связан с другим клиентом');
    }
    if (lead.projectId === project.id && project.leadId === leadId) return this.view(leadId);

    // Кто продал — тот и ответственный менеджер проекта, если его ещё нет.
    const seller = await this.sellerOf(lead);
    const assign = salesManagerPatch(project, seller, dushanbeDay(new Date()), withManagerChange);

    await m.transaction(async tx => {
      if (lead.projectId && lead.projectId !== project.id) {
        await tx.query(`UPDATE projects SET "leadId" = NULL WHERE id = $1 AND "leadId" = $2`, [lead.projectId, leadId]);
      }
      await tx.query(`UPDATE client_leads SET "projectId" = $2 WHERE id = $1`, [leadId, project.id]);
      await tx.query(`UPDATE projects SET "leadId" = $1 WHERE id = $2`, [leadId, project.id]);
      if (assign.column) {
        await tx.query(`UPDATE projects SET "salesManagerId" = $2 WHERE id = $1 AND "salesManagerId" IS NULL`, [project.id, seller]);
      }
      // Атомарная правка двух ключей smmData — как PATCH /projects/:id/smm-manager.
      if (assign.smm) await patchSmmData(tx, project.id, assign.smm);
    });

    await this.writeEvents(leadId, user.id, [
      { kind: 'project_linked', data: { projectId: project.id, projectName: project.name } },
    ]);
    await this.closeHandoffTask(lead).catch(() => undefined);

    const managerId = lead.handoffById || lead.ownerId;
    if (managerId && managerId !== user.id) {
      const message = `По клиенту «${lead.name}» создан проект «${project.name}».`;
      await this.notifications.create({
        userId: managerId,
        type: NotificationType.STATUS_CHANGE,
        title: '✅ Проект создан',
        message,
        link: `/projects/${project.id}`,
        data: { kind: 'sales_project_linked', leadId, projectId: project.id },
      }).catch((e: any) => this.logger.warn(`project linked notification failed: ${e?.message || e}`));
      this.telegram.sendToUser(
        managerId,
        `✅ <b>Проект создан</b>\nПо клиенту <b>${escapeHtml(lead.name)}</b> создан проект «${escapeHtml(project.name)}».`,
      ).catch(() => undefined);
    }

    this.broadcast(leadId, lead.ownerId);
    return this.view(leadId);
  }

  /** Продавший менеджер: владелец лида, если он МП, иначе тот, кто
   *  передал в работу (если МП). Руководство ответственным не ставим. */
  private async sellerOf(lead: Pick<ClientLead, 'ownerId' | 'handoffById'>): Promise<string | null> {
    for (const id of [lead.ownerId, lead.handoffById]) {
      if (!id) continue;
      const u = await this.userRepo.findOne({
        where: { id },
        select: ['id', 'role', 'secondaryRole', 'isActive'] as any,
      }).catch(() => null);
      if (u && u.isActive !== false && salesRoleOf(u)) return u.id;
    }
    return null;
  }

  /** Проект заведён — задача «Создать проект» выполнена. */
  private async closeHandoffTask(lead: ClientLead): Promise<void> {
    const taskId = typeof lead.handoffData?.taskId === 'string' ? lead.handoffData.taskId : null;
    if (!taskId) return;
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task || task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED) return;
    await this.taskRepo.update(taskId, { status: TaskStatus.DONE, completedAt: new Date() });
  }
}
