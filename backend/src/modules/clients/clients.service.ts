import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientLead, ClientLeadStatus, ClientLeadInterest, ClientLeadDirection } from './client-lead.entity';
import { Task, TaskScope, TaskStatus, TaskPriority } from '../tasks/task.entity';

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
  ) {}

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
    await this.repo.update(id, dto);
    const updated = await this.findOne(id);
    // Авто-синхронизация задачи-встречи: создать / обновить / удалить
    // в зависимости от изменений nextContactAt, name, onboardingStage.
    await this.syncMeetingTask(updated, existing);
    return this.findOne(updated.id);
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

  /**
   * KPI менеджера продаж — план/факт за текущий календарный месяц.
   * Считается из того, что МП реально делает в CRM:
   *  - база новых компаний → лиды, созданные менеджером в этом месяце
   *  - холодные звонки → лиды с call/телефонным каналом, активные в этом месяце
   *  - персонализированные письма → лиды с email-каналом или contactEmail,
   *    у которых обновлялся lastContactAt в этом месяце
   *  - встречи / созвоны → лиды с nextContactAt в ближайшие 14 дней
   */
  async kpi(ownerId: string, direction?: ClientLeadDirection) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 14);

    const base = () => {
      const qb = this.repo.createQueryBuilder('c').where('c.ownerId = :oid', { oid: ownerId });
      if (direction) qb.andWhere('(c.direction = :dir OR c.direction IS NULL)', { dir: direction });
      return qb;
    };

    // Каждый счётчик отдельно через try/catch: если миграция с новыми
    // колонками (contactEmail) ещё не прошла, отдельный запрос упадёт,
    // но эндпоинт всё равно вернёт остальные значения, а не 500.
    const safeCount = async (build: () => Promise<number>) => {
      try { return await build(); } catch { return 0; }
    };

    const newCompanies = await safeCount(() => base()
      .andWhere('c.createdAt BETWEEN :from AND :to', { from: monthStart, to: monthEnd })
      .getCount());

    const coldCalls = await safeCount(() => base()
      .andWhere(`LOWER(COALESCE(c.channel, '')) IN ('call', 'phone', 'whatsapp', 'telegram')`)
      .andWhere('c.updatedAt BETWEEN :from AND :to', { from: monthStart, to: monthEnd })
      .getCount());

    const personalEmails = await safeCount(() => base()
      .andWhere(`(LOWER(COALESCE(c.channel, '')) = 'email' OR COALESCE(c.contactEmail, '') <> '')`)
      .andWhere('c.lastContactAt BETWEEN :from AND :to', { from: monthStart, to: monthEnd })
      .getCount());

    const meetings = await safeCount(() => base()
      .andWhere('c.nextContactAt BETWEEN :now AND :horizon', { now, horizon })
      .getCount());

    const items = [
      { key: 'new_companies',   label: 'Новые компании в базе', target: 30, value: newCompanies },
      { key: 'cold_calls',      label: 'Холодные звонки',       target: 10, value: coldCalls },
      { key: 'personal_emails', label: 'Персональные письма',   target: 10, value: personalEmails },
      { key: 'meetings',        label: 'Встречи / созвоны',     target: 2,  value: meetings },
    ].map(i => ({
      ...i,
      percent: i.target > 0 ? Math.min(100, Math.round((i.value / i.target) * 100)) : 0,
      done: i.value >= i.target,
    }));

    const overall = Math.round(items.reduce((acc, i) => acc + (i.value / i.target) * 100, 0) / items.length);
    return {
      periodFrom: monthStart.toISOString(),
      periodTo: monthEnd.toISOString(),
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
      .select('COALESCE(c.interest, \'none\')', 'interest')
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
    if (stage) return `📅 ${stage} с клиентом: ${lead.name}`;
    return `📅 Встреча с клиентом: ${lead.name}`;
  }

  /** Заголовок follow-up задачи (когда у лида нет назначенной встречи). */
  private buildFollowUpTaskTitle(lead: ClientLead): string {
    const stage = lead.onboardingStage ? this.stageLabel(lead.onboardingStage) : null;
    if (stage) return `📋 ${stage}: ${lead.name}`;
    return `📋 Новый лид: ${lead.name}`;
  }

  private buildMeetingTaskDescription(lead: ClientLead): string {
    const lines: string[] = [];
    if (lead.sphere) lines.push(`Сфера: ${lead.sphere}`);
    if (lead.contactPerson) lines.push(`ЛПР: ${lead.contactPerson}`);
    if (lead.contactPhone)     lines.push(`📞 ${lead.contactPhone}`);
    if (lead.contactInstagram) lines.push(`📷 ${lead.contactInstagram}`);
    if (lead.contactEmail)     lines.push(`✉️ ${lead.contactEmail}`);
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
