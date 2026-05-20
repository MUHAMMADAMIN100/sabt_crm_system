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
        '(c.name ILIKE :s OR c.sphere ILIKE :s OR c.contactPerson ILIKE :s OR c.contactInfo ILIKE :s OR c.address ILIKE :s)',
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

  // ─── Авто-синхронизация задачи-встречи ───────────────────────────────
  /** Поддерживает 1:1 связь между ClientLead.nextContactAt и личной задачей
   *  в tasks (scope='personal'). Logic:
   *   - nextContactAt пустой → удалить связанную задачу, обнулить meetingTaskId
   *   - nextContactAt задан, задачи нет → создать новую (scope=personal)
   *   - nextContactAt задан, задача есть → обновить title/deadline/desc
   *
   *  Best-effort: ошибки логируются, но не валят апдейт клиента. Задача
   *  принадлежит ownerId, deadline = nextContactAt в 12:00 (как у фондера). */
  private async syncMeetingTask(lead: ClientLead, previous?: ClientLead): Promise<void> {
    try {
      const nextDate = lead.nextContactAt ? new Date(lead.nextContactAt) : null;
      const hasOwner = !!lead.ownerId;

      // Без даты или без владельца — удаляем существующую задачу (если была)
      // и обнуляем связь.
      if (!nextDate || !hasOwner) {
        if (lead.meetingTaskId) {
          await this.taskRepo.delete(lead.meetingTaskId).catch(() => {});
          await this.repo.update(lead.id, { meetingTaskId: null });
        }
        return;
      }

      // Дедлайн = 12:00 указанной даты (чтобы не зависеть от tz).
      const deadline = new Date(nextDate);
      deadline.setHours(12, 0, 0, 0);

      const title = this.buildMeetingTaskTitle(lead);
      const description = this.buildMeetingTaskDescription(lead);

      if (lead.meetingTaskId) {
        // Обновляем существующую задачу. Если она удалена вручную —
        // снова создадим новую.
        const exists = await this.taskRepo.findOne({ where: { id: lead.meetingTaskId } });
        if (exists) {
          await this.taskRepo.update(lead.meetingTaskId, {
            title,
            description,
            deadline,
            assigneeId: lead.ownerId,
          });
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

  private buildMeetingTaskDescription(lead: ClientLead): string {
    const lines: string[] = [];
    if (lead.sphere) lines.push(`Сфера: ${lead.sphere}`);
    if (lead.contactPerson) lines.push(`ЛПР: ${lead.contactPerson}`);
    if (lead.contactInfo) lines.push(`Контакты: ${lead.contactInfo}`);
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
