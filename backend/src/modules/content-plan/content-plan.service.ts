import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  ContentPlanItem,
  ContentPlanStatus,
  ContentApprovalStatus,
  ContentItemType,
} from './content-plan-item.entity';
import { Task, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { AppGateway } from '../gateway/app.gateway';

export interface ContentPlanFilters {
  projectId?: string;
  status?: ContentPlanStatus;
  approvalStatus?: ContentApprovalStatus;
  assigneeId?: string;
  contentType?: ContentItemType;
  from?: string;  // YYYY-MM-DD — нижняя граница publishDate
  to?: string;    // YYYY-MM-DD — верхняя граница publishDate
}

const CONTENT_TYPE_LABEL: Record<string, string> = {
  reel: 'Reel',
  story: 'История',
  post: 'Пост',
  design: 'Дизайн',
  ad: 'Реклама',
  video: 'Видео',
  carousel: 'Карусель',
  other: 'Контент',
};

@Injectable()
export class ContentPlanService {
  private readonly logger = new Logger(ContentPlanService.name);

  constructor(
    @InjectRepository(ContentPlanItem) private repo: Repository<ContentPlanItem>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private gateway: AppGateway,
  ) {}

  /** Сообщить фронту что задачи проекта изменились — он перезагрузит
   *  канбан и календарь без F5 (useSocket подписан на tasks:changed). */
  private emitTasksChanged(projectId?: string) {
    try {
      this.gateway.broadcast('tasks:changed', projectId ? { projectId } : {});
    } catch (e) {
      this.logger.warn(`Failed to broadcast tasks:changed: ${(e as Error).message}`);
    }
  }

  /** Собирает payload задачи из элемента контент-плана. */
  private buildTaskPayload(item: ContentPlanItem, createdById?: string): Partial<Task> {
    const typeLabel = CONTENT_TYPE_LABEL[item.contentType] || 'Контент';
    return {
      title: `${typeLabel}: ${item.topic}`,
      description: item.caption || undefined,
      projectId: item.projectId,
      assigneeId: item.assigneeId || undefined,
      createdById: createdById || undefined,
      // Дедлайн задачи = дата публикации; стартовая = дедлайн подготовки.
      deadline: item.publishDate || item.preparationDeadline || undefined,
      startDate: (item.preparationDeadline || item.publishDate || undefined) as any,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.NEW,
    };
  }

  /** Создаёт или обновляет связанную задачу под элемент плана.
   *  Минимальная синхронизация: title/description/assignee/dates. Без
   *  уведомлений и activity-log — это служебная авто-задача от плана. */
  private async syncTaskForItem(item: ContentPlanItem, createdById?: string): Promise<string | null> {
    const hasTopic = !!(item.topic && item.topic.trim());
    const hasDate = !!(item.publishDate || item.preparationDeadline);
    // Без topic ИЛИ без даты задача бесполезна. Если ранее существовала
    // связанная задача (item.taskId) и теперь стало "не задача" — удаляем
    // её, чтобы не оставлять сирот с устаревшими данными в канбане/календаре.
    if (!hasTopic || !hasDate) {
      if (item.taskId) {
        await this.removeTaskForItem(item);
        return null;
      }
      return null;
    }
    const payload = this.buildTaskPayload(item, createdById);
    if (item.taskId) {
      // Обновляем существующую задачу (если она ещё жива).
      const existing = await this.taskRepo.findOne({ where: { id: item.taskId } });
      if (existing) {
        await this.taskRepo.update(item.taskId, {
          title: payload.title,
          description: payload.description,
          assigneeId: payload.assigneeId,
          deadline: payload.deadline,
          startDate: payload.startDate as any,
        });
        return item.taskId;
      }
      // Задача удалена вручную — пересоздадим.
    }
    const task = this.taskRepo.create(payload);
    const saved = await this.taskRepo.save(task);
    return saved.id;
  }

  /** Удаляет авто-задачу под элемент плана (если она была привязана). */
  private async removeTaskForItem(item: ContentPlanItem): Promise<void> {
    if (!item.taskId) return;
    try {
      await this.taskRepo.delete(item.taskId);
    } catch (e) {
      this.logger.warn(`Failed to delete linked task ${item.taskId}: ${(e as Error).message}`);
    }
  }

  async findAll(f: ContentPlanFilters = {}) {
    const qb = this.repo.createQueryBuilder('c')
      .leftJoinAndSelect('c.assignee', 'assignee')
      .leftJoinAndSelect('c.pm', 'pm')
      .leftJoinAndSelect('c.project', 'project');

    if (f.projectId) qb.andWhere('c.projectId = :pid', { pid: f.projectId });
    if (f.status) qb.andWhere('c.status = :st', { st: f.status });
    if (f.approvalStatus) qb.andWhere('c.approvalStatus = :ast', { ast: f.approvalStatus });
    if (f.assigneeId) qb.andWhere('c.assigneeId = :aid', { aid: f.assigneeId });
    if (f.contentType) qb.andWhere('c.contentType = :ct', { ct: f.contentType });
    if (f.from) qb.andWhere('c.publishDate >= :from', { from: f.from });
    if (f.to) qb.andWhere('c.publishDate <= :to', { to: f.to });

    qb.orderBy('c.publishDate', 'ASC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC');
    const items = await qb.getMany();

    // Lazy backfill: при открытии плана конкретного проекта проверяем,
    // что у каждого элемента с датой есть связанная задача. Если нет —
    // создаём задачу-плэйсхолдер. Это гарантирует что элементы, созданные
    // до миграции taskId или сгенерированные авто-генерацией из тарифа
    // без assignee, появятся в канбане задач и в календаре проекта.
    // Делаем синхронно (await), чтобы при следующем переходе на /tasks
    // или /calendar данные уже были на месте — без необходимости F5.
    if (f.projectId) {
      const orphans = items.filter(it =>
        !it.taskId && (it.publishDate || it.preparationDeadline),
      );
      if (orphans.length > 0) {
        await Promise.all(orphans.map(async (it) => {
          try {
            const taskId = await this.syncTaskForItem(it);
            if (taskId && taskId !== it.taskId) {
              await this.repo.update(it.id, { taskId });
              it.taskId = taskId;
            }
          } catch (e) {
            this.logger.warn(`Backfill task for item ${it.id} failed: ${(e as Error).message}`);
          }
        }));
        // Уведомляем фронт чтобы канбан/календарь перерисовались сразу.
        this.emitTasksChanged(f.projectId);
      }
    }

    return items;
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'pm', 'project'],
    });
    if (!item) throw new NotFoundException('Content plan item not found');
    return item;
  }

  async create(dto: Partial<ContentPlanItem>, createdById?: string) {
    const item = this.repo.create(dto);
    const saved = await this.repo.save(item);
    // Авто-создание задачи под этот элемент (если есть assignee + дата).
    const taskId = await this.syncTaskForItem(saved, createdById);
    if (taskId && taskId !== saved.taskId) {
      saved.taskId = taskId;
      await this.repo.update(saved.id, { taskId });
    }
    if (taskId) this.emitTasksChanged(saved.projectId);
    return saved;
  }

  /** Массовое создание — нужно для авто-генерации плана из тарифа. */
  async createMany(items: Partial<ContentPlanItem>[], createdById?: string) {
    if (!items.length) return [];
    const entities = items.map(d => this.repo.create(d));
    const saved = await this.repo.save(entities);
    // Параллельно создаём задачи. Игнорируем ошибки отдельных элементов —
    // план уже сохранён, задачи это вторичный артефакт.
    let createdAny = false;
    await Promise.all(saved.map(async (s) => {
      try {
        const taskId = await this.syncTaskForItem(s, createdById);
        if (taskId && taskId !== s.taskId) {
          s.taskId = taskId;
          await this.repo.update(s.id, { taskId });
          createdAny = true;
        }
      } catch (e) {
        this.logger.warn(`Failed to auto-create task for plan item ${s.id}: ${(e as Error).message}`);
      }
    }));
    if (createdAny) this.emitTasksChanged(saved[0]?.projectId);
    return saved;
  }

  async update(id: string, dto: Partial<ContentPlanItem>, updatedById?: string) {
    const before = await this.findOne(id);
    const { id: _id, createdAt, updatedAt, ...patch } = dto as any;
    await this.repo.update(id, patch);
    const after = await this.findOne(id);
    // Синхронизируем связанную задачу — title/assignee/dates могли измениться.
    // syncTaskForItem может вернуть null (если задача была удалена из-за
    // удаления дат или очистки topic) — тогда обнуляем taskId в БД.
    try {
      const taskId = await this.syncTaskForItem(after, updatedById);
      if (taskId !== after.taskId) {
        after.taskId = taskId as any;
        await this.repo.update(after.id, { taskId: taskId as any });
      }
    } catch (e) {
      this.logger.warn(`Failed to sync task for plan item ${id}: ${(e as Error).message}`);
    }
    this.emitTasksChanged(after.projectId);
    return after;
  }

  /** Умный календарь: привести контент под норму цикла. СУММАРНО за текущий
   *  цикл (незапланированные + поставленные на даты В ОКНЕ цикла) держим ровно
   *  норму: лишние удаляем, недостающие создаём как незапланированные. Так
   *  «в корзине + в календаре» всегда не больше нормы. */
  async smartGenerateStubs(projectId: string, reels: number, posts: number) {
    if (!projectId) return { ok: true };
    const norm = (v: any) => Math.max(0, Math.min(999, Math.trunc(Number(v) || 0)));
    const project = await this.repo.manager.getRepository(Project).findOne({ where: { id: projectId } }).catch(() => null);
    const anchor = Number(project?.smmData?.cycleStartDay);
    const win = (Number.isFinite(anchor) && anchor >= 1) ? this.currentCycleBounds(anchor) : null;
    await this.reconcileStub(projectId, ContentItemType.REEL, 'Рилс', norm(reels), win);
    await this.reconcileStub(projectId, ContentItemType.POST, 'Пост', norm(posts), win);
    return { ok: true };
  }

  /** Довести суммарное число авто-заготовок этого типа за цикл ровно до нормы.
   *  Считаем: без даты ИЛИ с датой в окне цикла [win.start, win.end]. Лишние
   *  удаляем (сначала незапланированные, потом лишние в календаре), недостающие
   *  создаём как незапланированные. Трогаем только авто-заготовки («Рилс N» /
   *  «Пост N») — реальный контент не затрагиваем. */
  private async reconcileStub(projectId: string, type: ContentItemType, label: string, norm: number, win: { start: string; end: string } | null) {
    const params: any[] = [projectId, String(type), label];
    let dateCond = `"publishDate" IS NULL`;
    if (win) {
      params.push(win.start, win.end);
      dateCond = `("publishDate" IS NULL OR ("publishDate"::date >= $4::date AND "publishDate"::date <= $5::date))`;
    }
    // Порядок: сначала оставляем поставленные на дату (в календаре), лишние
    // удаляем начиная с незапланированных.
    const auto: any[] = await this.repo.manager.query(
      `SELECT id FROM content_plan_items
       WHERE "projectId" = $1 AND "contentType"::text = $2
         AND topic ~ ('^' || $3 || ' [0-9]+$') AND ${dateCond}
       ORDER BY ("publishDate" IS NULL), id`,
      params,
    ).catch(() => []);
    if (auto.length > norm) {
      const del = auto.slice(norm).map((r: any) => r.id);
      if (del.length) await this.repo.delete(del).catch(() => {});
    } else if (auto.length < norm) {
      const rows: ContentPlanItem[] = [];
      for (let i = auto.length; i < norm; i++) rows.push(this.repo.create({ projectId, contentType: type, topic: `${label} ${i + 1}`, status: ContentPlanStatus.PLANNED }));
      if (rows.length) await this.repo.save(rows).catch(() => {});
    }
  }

  /** Умный календарь: полностью очистить контент проекта (для сброса теста).
   *  Удаляет ВСЕ элементы content_plan_items проекта. Доску не затрагивает. */
  async smartClearProject(projectId: string) {
    if (!projectId) return { ok: true, deleted: 0 };
    const res = await this.repo.delete({ projectId }).catch(() => ({ affected: 0 } as any));
    return { ok: true, deleted: res?.affected ?? 0 };
  }

  /** Умный календарь: быстрый апдейт позиции (перенос даты / статус) БЕЗ
   *  синхронизации задач и прочих побочных эффектов старой системы —
   *  это отдельный контур, не связанный с «Доской проектов» и канбаном. */
  async smartUpdateItem(id: string, patch: { publishDate?: string | null; status?: ContentPlanStatus }) {
    const set: Partial<ContentPlanItem> = {};
    if ('publishDate' in patch) set.publishDate = patch.publishDate ? new Date(patch.publishDate) : null;
    if ('status' in patch && patch.status) set.status = patch.status;
    if (Object.keys(set).length) await this.repo.update(id, set);
    return { ok: true };
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    // Удаляем связанную задачу (если ещё жива).
    await this.removeTaskForItem(item);
    await this.repo.remove(item);
    if (item.taskId) this.emitTasksChanged(item.projectId);
    return { message: 'Content plan item deleted' };
  }

  /** План-факт по проекту: сколько чего запланировано vs опубликовано.
   *  Используется в Wave 5 (план-факт) и в риск-скоринге. */
  async getPlanFactByProject(projectId: string) {
    const rows = await this.repo
      .createQueryBuilder('c')
      .select('c.contentType', 'contentType')
      .addSelect('COUNT(*)', 'planned')
      .addSelect(`SUM(CASE WHEN c.status = 'published' THEN 1 ELSE 0 END)`, 'published')
      .addSelect(`SUM(CASE WHEN c.status = 'cancelled' THEN 1 ELSE 0 END)`, 'cancelled')
      .where('c.projectId = :pid', { pid: projectId })
      .groupBy('c.contentType')
      .getRawMany();

    return rows.map(r => ({
      contentType: r.contentType,
      planned: Number(r.planned),
      published: Number(r.published),
      cancelled: Number(r.cancelled),
      remaining: Math.max(0, Number(r.planned) - Number(r.published) - Number(r.cancelled)),
    }));
  }

  /** Текущий месяц по бизнес-зоне (Душанбе), формат YYYY-MM. */
  private currentYm(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dushanbe' }).slice(0, 7);
  }

  /** Разовое наполнение хранилища Умного календаря (content_plan_items) из
   *  «Доски проектов» (workflow_cards, kind='kp') — только для проектов, где
   *  своих элементов ещё нет. После копирования системы независимы: правки в
   *  Умном календаре не трогают Доску и наоборот. */
  /** Границы ТЕКУЩЕГО цикла (в котором сегодня) по дню старта anchor. */
  private currentCycleBounds(anchor: number): { start: string; end: string } {
    const today = new Date();
    const dim = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const anchorThis = Math.min(anchor, dim(y, m));
    let sy = y, sm = m;
    if (d < anchorThis) { sm -= 1; if (sm < 0) { sm = 11; sy -= 1; } }
    const sAnchor = Math.min(anchor, dim(sy, sm));
    const start = new Date(sy, sm, sAnchor);
    const nAnchor = Math.min(anchor, dim(start.getFullYear(), start.getMonth() + 1));
    const end = new Date(start.getFullYear(), start.getMonth() + 1, nAnchor);
    end.setDate(end.getDate() - 1);
    const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return { start: iso(start), end: iso(end) };
  }

  /**
   * Календарь производства SMM за месяц: что и когда ПУБЛИКОВАТЬ (из контент-
   * плана, по publishDate) и что и когда СНИМАТЬ (из shoot_sessions, по date).
   * Фокус на проектах руководителя, без KPI. Готовность/цвет считает фронт.
   */
  async smmCalendar(from?: string, to?: string) {
    // Диапазон дат [from, to] (YYYY-MM-DD). По умолчанию — текущий месяц.
    const ym = this.currentYm();
    const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : `${ym}-01`;
    const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : `${ym}-${String(lastDay).padStart(2, '0')}`;

    const projectRepo = this.repo.manager.getRepository(Project);
    const all = await projectRepo.find({ where: { projectType: 'SMM' } });
    const active = all.filter(p => String(p.status) !== 'archived');
    const nameById = new Map(active.map(p => [p.id, p.name] as const));
    // Даты проекта (начало работы / конец) — для окна «Настройки проекта».
    const dOnly = (v: any): string | null =>
      !v ? null : (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));
    const num = (v: any): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
    const projects = active
      .map(p => ({
        id: p.id, name: p.name,
        startDate: dOnly(p.startDate), endDate: dOnly(p.endDate),
        cycleStartDay: p.smmData ? num(p.smmData.cycleStartDay) : null,
        normReels: p.smmData ? num(p.smmData.normReels) : null,
        normPosts: p.smmData ? num(p.smmData.normPosts) : null,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    const ids = active.map(p => p.id);
    if (!ids.length) return { from: f, to: t, events: [], projects, backlog: [] };

    // Умный календарь работает на СВОЁМ хранилище (content_plan_items),
    // отдельном от «Доски проектов». Контент управляется НОРМОЙ цикла
    // (генерируется при сохранении цикла), Доска не копируется.

    // Публикации — из собственного хранилища (content_plan_items), по publishDate.
    const pubs: any[] = await this.repo.manager.query(
      `SELECT ci."projectId" AS "projectId", ci.id AS "itemId",
              ci."contentType" AS "itemKind", ci.topic AS title,
              ci.status AS status, ci."taskId" AS "taskId",
              to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS date
       FROM content_plan_items ci
       WHERE ci."projectId" = ANY($1::uuid[])
         AND ci."contentType" <> 'story'
         AND ci."publishDate" IS NOT NULL
         AND ci."publishDate"::date >= ($2)::date AND ci."publishDate"::date <= ($3)::date`,
      [ids, f, t],
    ).catch((e: any) => { this.logger.warn(`smmCalendar pubs failed: ${e?.message || e}`); return []; });

    // Съёмки — из shoot_sessions.
    const shoots: any[] = await this.repo.manager.query(
      `SELECT s.id, s."projectId" AS "projectId", s.title, s.time, s.location, s.note,
              to_char(s.date::date, 'YYYY-MM-DD') AS date
       FROM shoot_sessions s
       WHERE s.date IS NOT NULL
         AND s."projectId" = ANY($1::uuid[])
         AND s.date::date >= ($2)::date AND s.date::date <= ($3)::date
       ORDER BY s.date ASC`,
      [ids, f, t],
    ).catch((e: any) => { this.logger.warn(`smmCalendar shoots failed: ${e?.message || e}`); return []; });

    // Сторис — из журнала сторисмейкера (story_logs), а не контент-плана.
    // Нужны точками в мини-календарях; в большом календаре сторис скрыты.
    const storyRows: any[] = await this.repo.manager.query(
      `SELECT sl."projectId" AS "projectId", to_char(sl.date::date, 'YYYY-MM-DD') AS date,
              SUM(sl."storiesCount")::int AS cnt
       FROM story_logs sl
       WHERE sl."projectId" = ANY($1::uuid[]) AND sl."storiesCount" > 0
         AND sl.date::date >= ($2)::date AND sl.date::date <= ($3)::date
       GROUP BY sl."projectId", sl.date`,
      [ids, f, t],
    ).catch((e: any) => { this.logger.warn(`smmCalendar stories failed: ${e?.message || e}`); return []; });

    const events = [
      ...shoots.map(s => ({
        id: `shoot:${s.id}`, shootId: s.id, kind: 'shoot', date: s.date,
        projectId: s.projectId, projectName: nameById.get(s.projectId) || '',
        title: s.title || 'Съёмка', time: s.time || null, location: s.location || null, note: s.note || null,
      })),
      ...pubs.map(p => ({
        id: `item:${p.itemId}`, itemId: p.itemId, kind: 'publication', date: p.date,
        projectId: p.projectId, projectName: nameById.get(p.projectId) || '',
        contentType: p.itemKind === 'reel' ? 'reel' : 'design',
        topic: p.title || null, status: p.status || undefined, taskId: p.taskId || null,
      })),
      ...storyRows.map(s => ({
        id: `story:${s.projectId}:${s.date}`, kind: 'publication', date: s.date,
        projectId: s.projectId, projectName: nameById.get(s.projectId) || '',
        contentType: 'story', topic: `Сторис ×${s.cnt}`, status: 'published',
      })),
    ];

    // «Не запланировано» — контент без даты публикации и съёмки без даты
    // (их перетаскивают на календарь из панели сверху). Диапазон не важен.
    const bpubs: any[] = await this.repo.manager.query(
      `SELECT ci."projectId" AS "projectId", ci.id AS "itemId",
              ci."contentType" AS "itemKind", ci.topic AS title
       FROM content_plan_items ci
       WHERE ci."projectId" = ANY($1::uuid[])
         AND ci."contentType" <> 'story' AND ci."publishDate" IS NULL`,
      [ids],
    ).catch((e: any) => { this.logger.warn(`smmCalendar backlog pubs failed: ${e?.message || e}`); return []; });
    const bshoots: any[] = await this.repo.manager.query(
      `SELECT s.id, s."projectId" AS "projectId", s.title, s.location
       FROM shoot_sessions s
       WHERE s."projectId" = ANY($1::uuid[]) AND s.date IS NULL
       ORDER BY s."createdAt" ASC`,
      [ids],
    ).catch((e: any) => { this.logger.warn(`smmCalendar backlog shoots failed: ${e?.message || e}`); return []; });

    const backlog = [
      ...bpubs.map(c => ({
        id: `item:${c.itemId}`, itemId: c.itemId, kind: 'publication',
        projectId: c.projectId, projectName: nameById.get(c.projectId) || '',
        contentType: c.itemKind === 'reel' ? 'reel' : 'design', topic: c.title || null,
      })),
      ...bshoots.map(s => ({
        id: `shoot:${s.id}`, shootId: s.id, kind: 'shoot',
        projectId: s.projectId, projectName: nameById.get(s.projectId) || '',
        title: s.title || 'Съёмка', location: s.location || null,
      })),
    ];

    return { from: f, to: t, events, projects, backlog };
  }
}
