import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientLead, ClientLeadStatus, ClientLeadInterest, ClientLeadDirection } from './client-lead.entity';
import { Task, TaskScope, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction, ActivityLog } from '../activity-log/activity-log.entity';

/** Порядок продвижения лида по статусу — для подсчёта «прогрессий вперёд». */
const STATUS_ORDER: Record<string, number> = {
  new:         0,
  waiting:     1,
  negotiating: 2,
  proposal:    3,
  won:         4,
  // терминальные — не считаются прогрессом
  lost:        -1,
  on_hold:     -1,
};

/** Порядок этапов онбординга. */
const STAGE_ORDER: Record<string, number> = {
  negotiation:    1,
  meeting:        2,
  kp_creation:    3,
  contract:       4,
  implementation: 5,
};

export interface ListFilters {
  search?: string;
  status?: ClientLeadStatus;
  interest?: ClientLeadInterest;
  sphere?: string;
  ownerId?: string;
  source?: string;
  /** Направление МП — лиды чужого направления скрываются. */
  direction?: ClientLeadDirection;
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(ClientLead) private repo: Repository<ClientLead>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(ActivityLog) private activityRepo: Repository<ActivityLog>,
    private activityLog: ActivityLogService,
  ) {}

  /** Если статус ИЛИ этап онбординга у лида продвинулись «вперёд» — пишем
   *  отдельное событие LEAD_PROGRESS. Используется для KPI продаж. */
  private async maybeLogProgress(
    before: { status?: string | null; onboardingStage?: string | null; name?: string; ownerId?: string | null },
    after: { status?: string | null; onboardingStage?: string | null; name?: string; ownerId?: string | null },
    actor: { id: string; name?: string },
  ): Promise<void> {
    const advancedStatus =
      after.status && after.status !== before.status &&
      (STATUS_ORDER[after.status] ?? -1) > (STATUS_ORDER[before.status || ''] ?? 0);
    const advancedStage =
      after.onboardingStage && after.onboardingStage !== before.onboardingStage &&
      (STAGE_ORDER[after.onboardingStage] ?? 0) > (STAGE_ORDER[before.onboardingStage || ''] ?? 0);
    if (!advancedStatus && !advancedStage) return;
    try {
      await this.activityLog.log({
        userId: actor.id,
        userName: actor.name,
        action: ActivityAction.LEAD_PROGRESS,
        entity: 'client_lead',
        entityId: undefined,
        entityName: after.name,
        details: {
          ownerId: after.ownerId,
          statusFrom: before.status ?? null,
          statusTo: after.status ?? null,
          stageFrom: before.onboardingStage ?? null,
          stageTo: after.onboardingStage ?? null,
          advancedStatus: !!advancedStatus,
          advancedStage: !!advancedStage,
        },
      });
    } catch {
      // best-effort
    }
  }

  async findAll(f: ListFilters) {
    const qb = this.repo.createQueryBuilder('c')
      .leftJoinAndSelect('c.owner', 'owner');
    if (f.search) {
      qb.andWhere(
        `(c.name ILIKE :s OR c.sphere ILIKE :s OR c.contactPerson ILIKE :s
          OR c.contactInfo ILIKE :s OR c.contactPhone ILIKE :s
          OR c.contactInstagram ILIKE :s OR c.contactEmail ILIKE :s
          OR c.address ILIKE :s)`,
        { s: `%${f.search}%` },
      );
    }
    if (f.status) qb.andWhere('c.status = :st', { st: f.status });
    if (f.interest) qb.andWhere('c.interest = :it', { it: f.interest });
    if (f.sphere) qb.andWhere('c.sphere = :sp', { sp: f.sphere });
    if (f.ownerId) qb.andWhere('c.ownerId = :oid', { oid: f.ownerId });
    if (f.source) qb.andWhere('c.leadSource = :src', { src: f.source });
    // Направление: лиды своего направления + старые лиды без направления.
    if (f.direction) {
      qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: f.direction });
    }
    qb.orderBy('c.updatedAt', 'DESC');
    return qb.getMany();
  }

  async findOne(id: string, requesterDirection?: ClientLeadDirection) {
    const lead = await this.repo.findOne({ where: { id }, relations: ['owner'] });
    if (!lead) throw new NotFoundException('Client lead not found');
    // Лид чужого направления открывать нельзя (старые лиды без направления — можно).
    if (requesterDirection && lead.direction && lead.direction !== requesterDirection) {
      throw new ForbiddenException('Лид не относится к вашему направлению');
    }
    return lead;
  }

  async create(dto: Partial<ClientLead>, ownerId?: string) {
    const lead = this.repo.create({ ...dto, ownerId: dto.ownerId ?? ownerId });
    const saved = await this.repo.save(lead);
    // Если при создании указана дата встречи — авто-генерируем личную задачу
    // для владельца лида. Она появится в его календаре и в задачах под «Мои».
    await this.syncMeetingTask(saved);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: Partial<ClientLead>) {
    const existing = await this.findOne(id);
    // meetingTaskId — внутреннее поле, выставляется только сервером.
    const { meetingTaskId: _ignored, ...safe } = dto as any;
    await this.repo.update(id, safe);
    const updated = await this.findOne(id);
    // Авто-синхронизация задачи-встречи: создать / обновить / удалить
    // в зависимости от изменений nextContactAt, name, onboardingStage.
    await this.syncMeetingTask(updated, existing);
    return this.findOne(updated.id);
  }

  /** Update с ownership-проверкой. Менеджер продаж может править ТОЛЬКО
   *  свои лиды. Админ/основатель/сооснователь — любые.
   *  Дополнительно логирует прогрессии воронки в activity_log → KPI. */
  async updateWithAuth(
    id: string,
    dto: Partial<ClientLead>,
    user: { id: string; role: string; name?: string },
  ) {
    const isAdmin = ['admin', 'founder', 'co_founder'].includes(user.role);
    const before = await this.repo.findOne({ where: { id } });
    if (!before) throw new NotFoundException('Client lead not found');
    if (!isAdmin && before.ownerId && before.ownerId !== user.id) {
      throw new ForbiddenException('Вы можете редактировать только своих лидов');
    }
    const updated = await this.update(id, dto);
    // KPI: лог прогрессий вперёд по status / onboardingStage.
    await this.maybeLogProgress(
      { status: before.status, onboardingStage: before.onboardingStage, name: before.name, ownerId: before.ownerId },
      { status: updated.status, onboardingStage: updated.onboardingStage, name: updated.name, ownerId: updated.ownerId },
      user,
    );
    return updated;
  }

  async remove(id: string) {
    const lead = await this.findOne(id);
    // Если у лида была привязанная задача-встреча — удаляем её тоже.
    if (lead.meetingTaskId) {
      try { await this.taskRepo.delete(lead.meetingTaskId); } catch { /* ignore */ }
    }
    await this.repo.remove(lead);
    return { message: 'Lead deleted' };
  }

  /** Remove с ownership-проверкой. */
  async removeWithAuth(id: string, user: { id: string; role: string }) {
    const isAdmin = ['admin', 'founder', 'co_founder'].includes(user.role);
    if (!isAdmin) {
      const lead = await this.repo.findOne({ where: { id } });
      if (!lead) throw new NotFoundException('Client lead not found');
      if (lead.ownerId && lead.ownerId !== user.id) {
        throw new ForbiddenException('Вы можете удалять только своих лидов');
      }
    }
    return this.remove(id);
  }

  /**
   * KPI менеджера продаж за период.
   * Wave 11: ключевая метрика — «прогрессии воронки», т.е. сколько раз МП
   * сдвинул лидов на шаг вперёд по status или onboardingStage. Считается
   * из activity_logs (action = LEAD_PROGRESS).
   *
   * Дополнительные показатели остаются для контекста:
   *  - новые компании в базе (createdAt в окне)
   *  - холодные звонки (channel ∈ call/whatsapp/telegram, updatedAt в окне)
   *  - персональные письма (channel=email или есть contactEmail, lastContactAt)
   *  - встречи / созвоны (nextContactAt в ближайшем горизонте)
   */
  async kpi(ownerId: string, direction?: ClientLeadDirection, from?: string, to?: string) {
    // Окно по умолчанию — сегодняшний день. Если переданы from/to (YYYY-MM-DD),
    // считаем за указанный интервал. Конец дня всегда захватываем целиком.
    const today = new Date();
    const parseLocalDate = (s: string) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };
    const periodFrom = from ? parseLocalDate(from) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    periodFrom.setHours(0, 0, 0, 0);
    const periodTo = to ? parseLocalDate(to) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    periodTo.setHours(23, 59, 59, 999);
    // Встречи смотрим вперёд: от выбранного начала окна до конца окна или
    // ближайших 14 дней — что наступит позже.
    const horizon = new Date(periodTo);
    if (horizon.getTime() - periodFrom.getTime() < 14 * 86400_000) {
      horizon.setTime(periodFrom.getTime() + 14 * 86400_000);
    }

    const base = () => {
      const qb = this.repo.createQueryBuilder('c').where('c.ownerId = :oid', { oid: ownerId });
      if (direction) qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: direction });
      return qb;
    };

    const safeCount = async (build: () => Promise<number>) => {
      try { return await build(); } catch { return 0; }
    };

    const newCompanies = await safeCount(() => base()
      .andWhere('c.createdAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    const coldCalls = await safeCount(() => base()
      .andWhere(`LOWER(COALESCE(c.channel, '')) IN ('call', 'phone', 'whatsapp', 'telegram')`)
      .andWhere('c.updatedAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    const personalEmails = await safeCount(() => base()
      .andWhere(`(LOWER(COALESCE(c.channel, '')) = 'email' OR COALESCE(c.contactEmail, '') <> '')`)
      .andWhere('c.lastContactAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
      .getCount());

    const meetings = await safeCount(() => base()
      .andWhere('c.nextContactAt BETWEEN :now AND :horizon', { now: periodFrom, horizon })
      .getCount());

    // Wave 11 — главная метрика: сколько раз МП двинул лидов вперёд по
    // воронке (status или onboardingStage). Берём из activity_logs.
    const progressCount = await safeCount(() =>
      this.activityRepo
        .createQueryBuilder('a')
        .where('a.userId = :uid', { uid: ownerId })
        .andWhere('a.action = :act', { act: ActivityAction.LEAD_PROGRESS })
        .andWhere('a.createdAt BETWEEN :from AND :to', { from: periodFrom, to: periodTo })
        .getCount(),
    );

    const items = [
      { key: 'funnel_progress', label: 'Продвижения по воронке',  target: 20, value: progressCount },
      { key: 'new_companies',   label: 'Новые компании в базе',   target: 30, value: newCompanies },
      { key: 'cold_calls',      label: 'Холодные звонки',         target: 10, value: coldCalls },
      { key: 'personal_emails', label: 'Персональные письма',     target: 10, value: personalEmails },
      { key: 'meetings',        label: 'Встречи / созвоны',       target: 2,  value: meetings },
    ].map(i => ({
      ...i,
      percent: i.target > 0 ? Math.min(100, Math.round((i.value / i.target) * 100)) : 0,
      done: i.value >= i.target,
    }));

    const overall = Math.round(items.reduce((acc, i) => acc + (i.value / i.target) * 100, 0) / items.length);
    return {
      periodFrom: periodFrom.toISOString(),
      periodTo: periodTo.toISOString(),
      overallPercent: Math.min(100, Math.max(0, overall)),
      items,
    };
  }

  /** Aggregated counters for the Clients page header */
  async stats(direction?: ClientLeadDirection) {
    // Условие направления: свои лиды + старые без направления.
    const dirSql = '(c.direction = :dir OR c.direction IS NULL)';

    const statusQb = this.repo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status');
    if (direction) statusQb.where(dirSql, { dir: direction });
    const statusRows = await statusQb.getRawMany();
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = Number(r.count);

    const interestQb = this.repo
      .createQueryBuilder('c')
      // c.interest — Postgres enum. COALESCE требует одинаковых типов,
      // и 'none' НЕ существует в enum'е → каст в text спасает.
      .select('COALESCE(c.interest::text, \'none\')', 'interest')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.interest');
    if (direction) interestQb.where(dirSql, { dir: direction });
    const interestRows = await interestQb.getRawMany();
    const byInterest: Record<string, number> = {};
    for (const r of interestRows) byInterest[r.interest] = Number(r.count);

    const potentialQb = this.repo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.dealPotential), 0)', 'total')
      .where('c.status NOT IN (:...bad)', { bad: ['lost'] });
    if (direction) potentialQb.andWhere(dirSql, { dir: direction });
    const totalPotentialRow = await potentialQb.getRawOne();

    return {
      byStatus,
      byInterest,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      openPotential: Number(totalPotentialRow?.total || 0),
    };
  }

  // ─── Авто-синхронизация задачи в Календаре МП ────────────────────────
  /** Поддерживает 1:1 связь между ClientLead и личной задачей менеджера
   *  (scope='personal'). Любое касание клиента сразу видно в Календаре МП.
   *
   *  Logic:
   *   - закрытая сделка (won/lost) или нет владельца → удалить задачу;
   *   - есть nextContactAt → задача-встреча на этот момент времени;
   *   - нет nextContactAt → follow-up задача на сегодня 10:00, чтобы лид
   *     не «потерялся» и МП помнил перезвонить;
   *   - имя клиента / этап онбординга / контакты меняются — заголовок и
   *     описание задачи синхронизируются.
   *
   *  Best-effort: ошибки логируются, CRUD клиента не валится. */
  private async syncMeetingTask(lead: ClientLead, previous?: ClientLead): Promise<void> {
    try {
      const hasOwner = !!lead.ownerId;
      if (!hasOwner) return;

      // Закрытая сделка — задача в календаре больше не нужна, удаляем.
      const isClosed = lead.status === ClientLeadStatus.WON || lead.status === ClientLeadStatus.LOST;
      if (isClosed) {
        if (lead.meetingTaskId) {
          await this.taskRepo.delete(lead.meetingTaskId).catch(() => {});
          await this.repo.update(lead.id, { meetingTaskId: null });
        }
        return;
      }

      const nextDate = lead.nextContactAt ? new Date(lead.nextContactAt) : null;
      const isScheduled = !!nextDate;

      let deadline: Date;
      let title: string;

      if (isScheduled) {
        // Точное время nextContactAt. Если пришла голая дата (00:00) —
        // ставим 12:00 как разумный дефолт.
        deadline = new Date(nextDate as Date);
        if (deadline.getHours() === 0 && deadline.getMinutes() === 0) {
          deadline.setHours(12, 0, 0, 0);
        }
        title = this.buildMeetingTaskTitle(lead);
      } else {
        // Follow-up по новому/активному лиду. Дедлайн — сегодня 10:00.
        // Если задача уже существовала, её дедлайн НЕ перезаписываем (МП
        // мог сам перетащить в календаре), просто обновляем title/desc.
        deadline = new Date();
        deadline.setHours(10, 0, 0, 0);
        title = this.buildFollowUpTaskTitle(lead);
      }

      const description = this.buildMeetingTaskDescription(lead);

      // Запоминаем этап клиента в задаче — нужно, чтобы фронт/бэк могли
      // скрывать КП-задачи из общих списков (они должны быть видны только
      // в Онбординге на колонке «КП»).
      const originStage = lead.onboardingStage || null;

      if (lead.meetingTaskId) {
        const exists = await this.taskRepo.findOne({ where: { id: lead.meetingTaskId } });
        if (exists) {
          // Дату обновляем только если у клиента есть конкретное расписание
          // (nextContactAt). Иначе сохраняем то, куда МП утащил задачу руками.
          const patch: any = { title, description, assigneeId: lead.ownerId, originStage };
          if (isScheduled) patch.deadline = deadline;
          await this.taskRepo.update(lead.meetingTaskId, patch);
          return;
        }
      }

      const created = this.taskRepo.create({
        title,
        description,
        deadline,
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.NEW,
        scope: TaskScope.PERSONAL,
        originStage,
        createdById: lead.ownerId,
        assigneeId: lead.ownerId,
      });
      const saved = await this.taskRepo.save(created);
      await this.repo.update(lead.id, { meetingTaskId: saved.id });
    } catch (err: any) {
      // Не валим CRUD клиента из-за проблем с авто-задачей.
      // eslint-disable-next-line no-console
      console.warn('syncMeetingTask failed:', err?.message);
    }
  }

  private buildMeetingTaskTitle(lead: ClientLead): string {
    const stage = lead.onboardingStage ? this.stageLabel(lead.onboardingStage) : null;
    if (stage) return `${stage} с клиентом: ${lead.name}`;
    return `Встреча с клиентом: ${lead.name}`;
  }

  /** Заголовок follow-up задачи (когда у лида нет назначенной встречи). */
  private buildFollowUpTaskTitle(lead: ClientLead): string {
    const stage = lead.onboardingStage ? this.stageLabel(lead.onboardingStage) : null;
    if (stage) return `${stage}: ${lead.name}`;
    return `Новый лид: ${lead.name}`;
  }

  private buildMeetingTaskDescription(lead: ClientLead): string {
    const lines: string[] = [];
    if (lead.sphere) lines.push(`Сфера: ${lead.sphere}`);
    if (lead.contactPerson) lines.push(`ЛПР: ${lead.contactPerson}`);
    if (lead.contactPhone)     lines.push(`Телефон: ${lead.contactPhone}`);
    if (lead.contactInstagram) lines.push(`Instagram: ${lead.contactInstagram}`);
    if (lead.contactEmail)     lines.push(`Email: ${lead.contactEmail}`);
    // Старое поле — для тех лидов, которые ещё не переразложили.
    if (lead.contactInfo && !lead.contactPhone && !lead.contactInstagram && !lead.contactEmail) {
      lines.push(`Контакты: ${lead.contactInfo}`);
    }
    if (lead.problem) lines.push(`Задача: ${lead.problem}`);
    if (lead.channel) lines.push(`Канал: ${lead.channel}`);
    return lines.join('\n');
  }

  private stageLabel(stage: string): string {
    const map: Record<string, string> = {
      negotiation:    'Переговор',
      meeting:        'Встреча',
      kp_creation:    'КП',
      contract:       'Договор',
      implementation: 'Реализация',
    };
    return map[stage] || 'Встреча';
  }
}
