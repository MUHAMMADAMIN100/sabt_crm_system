import { Injectable, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, Not } from 'typeorm';
import { Task, TaskStatus, TaskPriority, TaskKind, TaskScope, TASK_CLOSED_FOR_OVERDUE } from './task.entity';

/** Вся компания живёт по Душанбе — даты в напоминаниях считаем в этой зоне. */
const DUSHANBE_TZ = 'Asia/Dushanbe';
import { TaskAssignee } from './task-assignee.entity';
import { Project } from '../projects/project.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { ProjectsService } from '../projects/projects.service';
import { UserRole, User } from '../users/user.entity';
import { MailService } from '../mail/mail.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TelegramService } from '../telegram/telegram.service';
import { AppGateway } from '../gateway/app.gateway';
import { emitTasksChanged, TasksChangedPayload } from '../gateway/tasks-changed';
import { TaskResultsService } from '../task-results/task-results.service';
import { DailyReport } from '../reports/daily-report.entity';
import { getSalesSegmentOfUser, isSalesManager, salesRoleOf, DEV_PROJECT_TYPES } from '../../common/sales-segment';
import { directionScopeOf } from '../../common/direction-scope';
import { projectListFields } from '../../common/project-list-fields';
import { escapeHtml } from '../../common/html-escape';
import { dushanbeDay, dushanbeDayEnd, dushanbeDayStart } from '../clients/sales-kpi.logic';
import { assertTaskReadable } from './task-access';

// PM_DEV здесь же: проект-менеджер по разработке ставит задачи команде, а не
// только себе. Раньше он мог назначать других лишь внутри dev-проекта — задача
// без проекта молча переназначалась на него самого. Область видимости при этом
// ограничена направлением (outOfDirection + directionScopeOf), поэтому SMM ему
// по-прежнему недоступен.
const PM_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.SMM_DIRECTOR, UserRole.DEV_DIRECTOR, UserRole.PM_DEV];

/** PM-полномочия учитывают и ВТОРУЮ роль: руководитель разработки назначен
 *  Сабрине второй ролью поверх менеджера продаж, и без этого проверки ниже
 *  видели бы только основную. Контроллеры передают req.user целиком, поэтому
 *  secondaryRole в объекте есть, хоть и не описан в узком типе параметра. */
const isPmUser = (u: { role?: string; secondaryRole?: string | null } | undefined | null): boolean =>
  !!u && (PM_ROLES.includes(u.role as UserRole) || PM_ROLES.includes((u as any).secondaryRole as UserRole));

/** PM-полномочия руководителя направления действуют ТОЛЬКО в его сфере.
 *  Без этой отсечки isPmUser открывал бы Сабрине любую задачу компании по
 *  прямому id (включая SMM) — на чтение, правку и массовые действия. */
const outOfDirection = (
  u: { role?: string; secondaryRole?: string | null } | undefined | null,
  projectType?: string | null,
): boolean => {
  const dir = directionScopeOf(u as any);
  if (!dir) return false;
  // Безпроектные задачи направлением не ограничены: это личные поручения,
  // их видимость решают другие проверки (исполнитель/автор/общая).
  if (!projectType) return false;
  return !dir.projectTypes.includes(projectType);
};
/** Управляющие роли — их задачи попадают в раздел «Задачи от руководителя».
 *  Массив строк: подставляется в SQL-параметр (u.role = ANY(...)). */
const MANAGEMENT_ROLES: string[] = [
  UserRole.ADMIN, UserRole.FOUNDER,
  UserRole.SMM_DIRECTOR, UserRole.DEV_DIRECTOR,
];
/** Кто вправе ставить задачу «от основателя» и рассылать общую задачу всей
 *  компании (сайт + email + Telegram каждому активному сотруднику). */
const BROADCAST_ROLES: string[] = [
  UserRole.ADMIN, UserRole.FOUNDER,
];
const WORKER_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.VIDEO_EDITOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV, UserRole.VIDEOGRAPHER, UserRole.TARGETOLOGIST, UserRole.EMPLOYEE];

/** Что исполнитель/со-исполнитель (не автор и без PM-полномочий) может менять
 *  в задаче через PATCH (15.11.2026): статус и рабочие поля карточки —
 *  отметки критериев приёмки, тех. ссылки, теги/оценка. Срок, исполнители,
 *  оценка качества и прочее — нет: раньше исполнитель мог сдвинуть срок уже
 *  сданной задачи, и просрочка в KPI становилась «в срок». Лишние поля тихо
 *  отбрасываются (без 403), чтобы нынешние формы продолжали работать. */
const ASSIGNEE_EDITABLE = new Set(['status', 'acceptanceCriteria', 'techMeta', 'tags', 'storyPoints']);
/** Поля оценки качества — только через approve/return (или PM-правкой). */
const QUALITY_FIELDS = ['reworkCount', 'qualityScore', 'acceptedOnFirstTry'];
/** Сколько писем/сообщений рассылки общей задачи отправляем одновременно. */
const BROADCAST_CONCURRENCY = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Обработать список с ограниченной параллельностью (порядок не важен). */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly logger = new Logger(TasksService.name);

  /** Идемпотентный DDL (на проде synchronize off): этап dev-доски у задач.
   *  Миграция AddTaskDevStage дублирует это для чистого деплоя. */
  async onModuleInit() {
    try {
      // Вид записи (задача/встреча) и место встречи. На проде synchronize
      // выключен, поэтому колонки добавляем идемпотентным DDL.
      await this.repo.manager.query(
        `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'task'`,
      );
      await this.repo.manager.query(
        `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "location" varchar(300)`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE tasks kind/location failed: ${e?.message || e}`);
    }
    try {
      await this.repo.manager.query(
        `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "devStage" int`,
      );
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn(`ALTER TABLE tasks devStage failed: ${e?.message || e}`);
    }
    try {
      // Фактический момент закрытия задачи — база для KPI «сдано в срок».
      await this.repo.manager.query(
        `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "completedAt" timestamp`,
      );
      // Разовый бэкфилл уже закрытых задач: лучшая доступная оценка —
      // время проверки, иначе время последнего изменения записи.
      await this.repo.manager.query(
        `UPDATE tasks SET "completedAt" = COALESCE("reviewedAt", "updatedAt")
         WHERE status::text = 'done' AND "completedAt" IS NULL`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE tasks completedAt failed: ${e?.message || e}`);
    }
  }

  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    @InjectRepository(TaskAssignee) private assigneesRepo: Repository<TaskAssignee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private notificationsService: NotificationsService,
    private projectsService: ProjectsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private gateway: AppGateway,
    private taskResultsService: TaskResultsService,
  ) {}

  /** «Задачи изменились» для фронта (08.11.2026). Личные задачи видит только
   *  владелец — событие уходит лишь ему (вторая вкладка, телефон, задача из
   *  Telegram), остальные ради чужой заметки ничего не перезапрашивают.
   *  Публичный — им же пользуются расписания (напоминание об оплате, повтор
   *  недели), чтобы созданные ими задачи тоже появлялись без опроса. */
  notifyTasksChanged(payload: TasksChangedPayload, personalOwnerIds?: Array<string | null | undefined>) {
    emitTasksChanged(this.gateway, payload, personalOwnerIds);
  }

  /** Является ли пользователь PM в контексте конкретного проекта.
   *  Возвращает true если:
   *    - у пользователя «глобальная» PM-роль (admin/founder/co_founder/
   *      smm_director/video_director), ИЛИ
   *    - он назначен менеджером ИМЕННО этого проекта (project.managerId) —
   *      менеджером может быть сотрудник ЛЮБОЙ роли, назначение даёт
   *      руководство проектом без отдельной роли.
   *  Без projectId — только проверка роли. */
  private async hasPmPowersOnProject(
    userId: string,
    role: string | undefined,
    projectId: string | null | undefined,
  ): Promise<boolean> {
    const globalPm = !!role && PM_ROLES.includes(role as UserRole);
    // Руководитель направления (dev_director / pm_dev) — PM только в своей
    // сфере (15.11.2026): раньше ранний return давал ему PM-права и в
    // SMM-проектах, в обход outOfDirection.
    const dir = globalPm ? directionScopeOf({ role }) : null;
    if (globalPm && !dir) return true;
    if (!projectId) return globalPm;
    const proj = await this.projectRepo.findOne({
      where: { id: projectId },
      select: ['id', 'managerId', 'projectType'] as any,
    });
    if (!proj) return false;
    if (dir && dir.projectTypes.includes(proj.projectType as string)) return true;
    if (proj.managerId === userId) return true;
    // Разработчик — PM-полномочия только в dev-проектах, где он участник
    // (15.11.2026, SYSTEM_PROMPT §3: «исполнитель dev-проектов, где он
    // участник»). Раньше — во всех dev-проектах компании.
    if (role === UserRole.DEVELOPER && DEV_PROJECT_TYPES.includes(proj.projectType as string)) {
      return this.isProjectMember(projectId, userId);
    }
    return false;
  }

  /** Участник проекта (project_members). */
  private async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    try {
      const rows: any[] = await this.projectRepo.manager.query(
        `SELECT 1 FROM project_members WHERE "projectsId" = $1 AND "usersId" = $2 LIMIT 1`,
        [projectId, userId],
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  /** Auto-create a daily_report row when a task transitions to DONE. */
  private async autoReportFromTask(task: Task) {
    if (!task.assigneeId) return;
    try {
      await this.reportRepo.save(this.reportRepo.create({
        employeeId: task.assigneeId,
        projectId: task.projectId || null,
        taskId: task.id,
        date: new Date(),
        description: `✅ Выполнена задача "${task.title}"`,
        timeSpent: Number(task.loggedHours || 0),
        comments: task.description || null,
      }));
    } catch (err: any) {
      // Non-critical — just log. Missing reportRepo or schema issues shouldn't
      // block the task completion flow.
      // eslint-disable-next-line no-console
      console.warn('autoReportFromTask failed:', err?.message);
    }
  }

  // ─── Multi-assignee helpers ────────────────────────────────────────

  /** Загружает assignees для одной/нескольких задач (с user-объектами).
   *  Сортируем по position — это важный sequential порядок workflow. */
  private async loadAssignees(taskIds: string[]): Promise<Map<string, any[]>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.assigneesRepo.find({
      where: { taskId: In(taskIds) },
      relations: ['user'],
      order: { taskId: 'ASC', position: 'ASC' },
    });
    const map = new Map<string, any[]>();
    for (const id of taskIds) map.set(id, []);
    for (const r of rows) {
      const arr = map.get(r.taskId) || [];
      arr.push({
        position: r.position,
        userId: r.userId,
        isDone: r.isDone,
        doneAt: r.doneAt,
        note: r.note,
        user: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar } : null,
      });
      map.set(r.taskId, arr);
    }
    return map;
  }

  /** Синхронизирует список исполнителей в виде упорядоченной цепочки.
   *  userIds — массив, порядок которого = порядок шагов workflow.
   *  Один user может встречаться несколько раз (на разных шагах).
   *
   *  Если задача ещё «свежая» (никто не отметил готовность) — полная
   *  замена. Если есть прогресс — менять очередь нельзя (упадёт 400),
   *  чтобы не сломать историю. */
  private async syncAssignees(
    taskId: string,
    userIds: string[],
    force = false,
  ): Promise<void> {
    const ordered = (userIds || []).filter(Boolean);
    const existing = await this.assigneesRepo.find({ where: { taskId } });
    const hasProgress = existing.some(r => r.isDone);

    // Если кто-то уже сдал — реordering запрещён. Молча игнорируем,
    // если новый список совпадает с существующим (по userId+order),
    // иначе бросаем 400.
    // force=true — основатель меняет ТИП задачи (scope): защиту очереди
    // обходим, исполнителей очищаем/заменяем принудительно.
    if (hasProgress && !force) {
      const existingOrdered = [...existing].sort((a, b) => a.position - b.position).map(r => r.userId);
      const same = existingOrdered.length === ordered.length
        && existingOrdered.every((u, i) => u === ordered[i]);
      if (!same) {
        throw new BadRequestException(
          'Нельзя менять очередь исполнителей — кто-то уже отметил готовность',
        );
      }
      return; // ничего не меняем
    }

    // Чистая задача — полностью заменяем.
    if (existing.length > 0) {
      await this.assigneesRepo.remove(existing);
    }
    if (ordered.length === 0) return;
    const fresh = ordered.map((userId, idx) => this.assigneesRepo.create({
      taskId, userId, position: idx, isDone: false,
    }));
    await this.assigneesRepo.save(fresh);
  }

  /** Извлекает массив assigneeIds из dto (поддерживает legacy assigneeId). */
  private extractAssigneeIds(dto: any): string[] | undefined {
    if (Array.isArray(dto?.assigneeIds)) return dto.assigneeIds;
    if (dto?.assigneeId) return [dto.assigneeId];
    return undefined;
  }

  /** Sequential workflow: только текущий по очереди исполнитель (первый
   *  с isDone=false) может отметить «свою часть готовой». Остальные ждут.
   *  Когда последний шаг отмечен → задача автоматически в REVIEW (или DONE
   *  для SMM-специалиста). При смене этапа — уведомление следующему. */
  async markMyPartDone(
    taskId: string,
    user: { id: string; role: string; name?: string },
    note?: string,
  ): Promise<{ task: Task; allDone: boolean }> {
    const task = await this.findOne(taskId);
    const all = await this.assigneesRepo.find({
      where: { taskId },
      order: { position: 'ASC' },
    });
    if (all.length === 0) {
      throw new ForbiddenException('У задачи нет исполнителей');
    }

    // Текущий шаг — первый невыполненный по position
    const current = all.find(r => !r.isDone);
    if (!current) {
      // Все уже готовы — идемпотентно
      return { task, allDone: true };
    }
    if (current.userId !== user.id) {
      throw new ForbiddenException('Сейчас задача не у вас. Дождитесь своей очереди.');
    }

    // Отмечаем текущий шаг
    current.isDone = true;
    current.doneAt = new Date();
    if (note) current.note = note;
    await this.assigneesRepo.save(current);

    // Перезагружаем после save
    const updated = await this.assigneesRepo.find({
      where: { taskId },
      relations: ['user'],
      order: { position: 'ASC' },
    });
    const allDone = updated.every(r => r.isDone);
    const next = updated.find(r => !r.isDone);

    // Уведомление PM — короткое о прогрессе
    const doneNum = updated.filter(r => r.isDone).length;
    if (task.createdById && task.createdById !== user.id) {
      this.notificationsService.create({
        userId: task.createdById,
        type: NotificationType.STATUS_CHANGE,
        title: `✓ Шаг ${doneNum}/${updated.length} завершён`,
        message: `${user.name || 'Исполнитель'} завершил свой шаг в задаче "${task.title}"`,
        link: `/tasks/${taskId}`,
      }).catch(() => {});
    }

    // Передача следующему — отдельное уведомление + email + telegram
    if (next && next.userId !== user.id) {
      const nextUser = next.user;
      this.notificationsService.create({
        userId: next.userId,
        type: NotificationType.NEW_TASK,
        title: '➡️ Вам передали задачу',
        message: `${user.name || 'Предыдущий исполнитель'} завершил свой шаг — теперь ваша очередь в задаче "${task.title}"`,
        link: `/tasks/${taskId}`,
      }).catch(() => {});
      if (nextUser?.email) {
        const deadline = task.deadline ? new Date(task.deadline).toLocaleDateString('ru-RU') : undefined;
        this.mailService.sendTaskAssigned(
          nextUser.email, nextUser.name, task.title, taskId,
          task.project?.name, deadline, task.priority, task.description || undefined,
        ).catch(() => {});
      }
      this.telegramService.sendToUser(
        next.userId,
        `➡️ <b>Вам передали задачу</b>\n\n` +
        `📋 ${escapeHtml(task.title)}\n` +
        `👤 Предыдущий шаг сделал: ${escapeHtml(user.name || 'Исполнитель')}\n` +
        `\n👉 ${this.telegramService.appUrl}/tasks/${taskId}`,
      ).catch(() => {});
    }

    // Авто-переход в DONE когда все исполнители отметили свою часть.
    // Pipeline статусов упрощён до 4 (Wave 11) — промежуточного «review»
    // больше нет. Когда все стороны закончили — задача сразу DONE.
    if (allDone && task.status !== TaskStatus.DONE && task.status !== TaskStatus.CANCELLED) {
      await this.repo.update(taskId, { status: TaskStatus.DONE, completedAt: new Date() });

      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_STATUS,
        entity: 'task',
        entityId: taskId,
        entityName: task.title,
        details: { from: task.status, to: TaskStatus.DONE, reason: 'all_assignees_done' },
      }).catch(() => {});

      await this.autoReportFromTask({ ...task, status: TaskStatus.DONE } as Task);

      // Уведомляем создателя (если это не сам пользователь — анти-self-notify)
      if (task.createdById && task.createdById !== user.id) {
        this.notificationsService.create({
          userId: task.createdById,
          type: NotificationType.STATUS_CHANGE,
          title: 'Задача выполнена',
          message: `Задача "${task.title}" отмечена как выполненная.`,
          link: `/tasks/${taskId}`,
        }).catch(() => {});
      }
    }

    this.notifyTasksChanged({
      projectId: task.projectId ?? null, taskId, actorId: user.id,
      // Последний шаг закрыл задачу — меняется прогресс проекта.
      kind: allDone ? 'status' : 'edit',
    });
    const fresh = await this.findOne(taskId);
    return { task: fresh, allDone };
  }

  /** Получить список assignees задачи. С viewer — та же проверка доступа,
   *  что у карточки задачи (15.11.2026: раньше отдавали любой задаче по id). */
  async getAssignees(taskId: string, viewer?: { id: string; role?: string } | null) {
    await this.findOne(taskId, viewer);
    const rows = await this.assigneesRepo.find({
      where: { taskId },
      relations: ['user'],
      order: { position: 'ASC' },
    });
    return rows.map(r => ({
      position: r.position,
      userId: r.userId,
      isDone: r.isDone,
      doneAt: r.doneAt,
      note: r.note,
      user: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email, avatar: r.user.avatar } : null,
    }));
  }

  async findAll(filters: {
    projectId?: string;
    assigneeId?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    search?: string;
    deadlineBefore?: string;
    /** Нижняя граница срока (YYYY-MM-DD) — для недельной сетки. */
    deadlineFrom?: string;
    /** Фильтр по scope: 'personal' | 'business' | 'general'. */
    scope?: 'personal' | 'business' | 'general';
    /** ID текущего пользователя — нужен для скрытия чужих PERSONAL-задач. */
    viewerId?: string;
    /** Роль текущего пользователя — нужна для сегментации МП по продажам. */
    viewerRole?: string;
    /** Вторая роль: dev_director поверх МП снимает продажную сегментацию. */
    viewerSecondaryRole?: string | null;
  }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoin('t.project', 'project').addSelect(projectListFields('project'));

    // КП-задачи живут только в Онбординге на колонке «КП». В общих списках
    // задач/календаря их быть не должно. Применяем глобально.
    qb.andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`);

    if (filters.projectId) qb.andWhere('t.projectId = :projectId', { projectId: filters.projectId });
    // Поддержка multi-assignee: фильтр по assigneeId покрывает и legacy
    // assigneeId на самой задаче, и членство в task_assignees.
    if (filters.assigneeId) {
      qb.andWhere(
        `(t.assigneeId = :assigneeId OR EXISTS (
          SELECT 1 FROM task_assignees ta
          WHERE ta."taskId" = t.id AND ta."userId" = :assigneeId
        ))`,
        { assigneeId: filters.assigneeId },
      );
    }
    if (filters.status) qb.andWhere('t.status = :status', { status: filters.status });
    if (filters.priority) qb.andWhere('t.priority = :priority', { priority: filters.priority });
    if (filters.search) qb.andWhere('t.title ILIKE :search', { search: `%${filters.search}%` });
    if (filters.deadlineBefore) qb.andWhere('t.deadline <= :deadline', { deadline: filters.deadlineBefore });
    if (filters.deadlineFrom) qb.andWhere('t.deadline >= :deadlineFrom', { deadlineFrom: filters.deadlineFrom });

    // Фильтр по scope: явный фильтр от клиента.
    if (filters.scope) {
      qb.andWhere('t.scope = :scope', { scope: filters.scope });
    }

    this.applyViewerScope(qb, {
      id: filters.viewerId,
      role: filters.viewerRole,
      secondaryRole: filters.viewerSecondaryRole,
    });

    const tasks = await qb.orderBy('t.createdAt', 'DESC').getMany();
    if (tasks.length > 0) {
      const map = await this.loadAssignees(tasks.map(t => t.id));
      for (const t of tasks) (t as any).assignees = map.get(t.id) || [];
    }
    return tasks;
  }

  /** Кто какие задачи видит в общих списках (список, CSV, счётчики).
   *  qb — задачи 't' с присоединённым проектом 'project'. */
  private applyViewerScope(
    qb: any,
    viewer: { id?: string | null; role?: string | null; secondaryRole?: string | null },
  ): void {
    // Скрываем чужие PERSONAL-задачи: даже founder/admin не видит личные
    // заметки других людей. Личная задача — приватная по определению.
    if (viewer.id) {
      qb.andWhere(
        `(t.scope <> 'personal' OR t."createdById" = :viewerId)`,
        { viewerId: viewer.id },
      );
    }

    // Руководитель направления (в т.ч. второй ролью — dev_director у Сабрины)
    // видит ВСЕ задачи своей сферы, а не только свои: задачи проектов
    // направления плюс безпроектные поручения внутри его команды. Чужое
    // направление (SMM) при этом остаётся скрытым.
    const dirScope = directionScopeOf({ role: viewer.role, secondaryRole: viewer.secondaryRole });
    if (dirScope) {
      qb.andWhere(
        `(project.projectType IN (:...dirTypes)
          OR (t.projectId IS NULL AND (
            t."createdById" IN (SELECT id FROM users WHERE role IN (:...dirRoles) OR "secondaryRole" IN (:...dirRoles))
            OR t.assigneeId IN (SELECT id FROM users WHERE role IN (:...dirRoles) OR "secondaryRole" IN (:...dirRoles))
            OR t.scope = 'general'
          )))`,
        { dirTypes: dirScope.projectTypes, dirRoles: dirScope.teamRoles },
      );
    }

    // Сегментация менеджеров продаж: МП видит только задачи проектов
    // своего направления. Задачи без проекта видны, если они созданы им,
    // назначены ему или это общие задачи (scope='general').
    // Управляющая роль на ЛЮБОЙ из двух позиций (например «МП + руководитель
    // SMM») тоже снимает продажную сегментацию — иначе такой сотрудник терял
    // бы доступ, который ему уже дали. МП второй ролью — тоже МП (15.11.2026).
    const hasPmPowers = isPmUser({ role: viewer.role || undefined, secondaryRole: viewer.secondaryRole });
    const salesSegment = (dirScope || hasPmPowers)
      ? null
      : getSalesSegmentOfUser({ role: viewer.role, secondaryRole: viewer.secondaryRole });
    if (salesSegment) {
      // ВСЕ типы сегмента, а не один дефолтный: у МП по разработке их пять
      // (Лендинг, Телеграм бот, CRM, Интернет магазин, legacy «Web сайт») —
      // иначе он не видел задачи по своим же проектам других подтипов.
      qb.andWhere(
        `(project.projectType IN (:...salesProjTypes)
          OR (t.projectId IS NULL AND (
            t."createdById" = :salesViewerId
            OR t.assigneeId = :salesViewerId
            OR t.scope = 'general'
          )))`,
        {
          salesProjTypes: salesSegment.projectTypes,
          salesViewerId: viewer.id ?? null,
        },
      );
    }

    // Остальные роли (исполнители, разработчик, сотрудник…) — только «свои»
    // задачи (15.11.2026): исполнитель, со-исполнитель, автор, задачи
    // проектов, где он менеджер/участник/назначенный SMM-специалист, и общие
    // задачи от основателя. Раньше /tasks и CSV отдавали всю компанию.
    if (!dirScope && !hasPmPowers && !salesSegment) {
      qb.andWhere(
        `(t."assigneeId" = :ownId
          OR t."createdById" = :ownId
          OR EXISTS (SELECT 1 FROM task_assignees ta_own WHERE ta_own."taskId" = t.id AND ta_own."userId" = :ownId)
          OR (t."projectId" IS NOT NULL AND (
            project."managerId" = :ownId
            OR EXISTS (SELECT 1 FROM project_members pm_own
                       WHERE pm_own."projectsId" = t."projectId" AND pm_own."usersId" = :ownId)
            OR jsonb_exists(COALESCE(project."smmData"->'smmSpecialistIds', '[]'::jsonb), CAST(:ownId AS text))
          ))
          OR (t.scope = 'general' AND t."fromFounder" = true))`,
        // Без пользователя — пустой список, а не вся компания.
        { ownId: viewer.id || '00000000-0000-0000-0000-000000000000' },
      );
    }
  }

  async findOne(id: string, viewer?: { id: string; role?: string } | null) {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'createdBy', 'project', 'project.members', 'comments', 'comments.author', 'timeLogs', 'files'],
    });
    if (!task) throw new NotFoundException('Task not found');
    const map = await this.loadAssignees([id]);
    (task as any).assignees = map.get(id) || [];

    // ─── IDOR-защита: можно читать задачу если ────────────────────────
    //   - PM-роль (admin/founder/co_founder/smm_director/video_director)
    //   - назначен исполнителем (legacy assigneeId или multi-assignee)
    //   - создатель задачи
    //   - менеджер проекта
    //   - участник проекта (project.members)
    //   - GENERAL-задача от основателя (видна всей компании)
    if (viewer) {
      // Руководитель направления — PM только в своей сфере: чужое направление
      // не открывается даже по прямой ссылке.
      const isPm = (isPmUser(viewer as any) && !outOfDirection(viewer as any, task.project?.projectType))
        || (task.project
          ? await this.hasPmPowersOnProject(viewer.id, viewer.role, task.projectId)
          : false);
      const isAssignee = task.assigneeId === viewer.id;
      const isCoAssignee = ((task as any).assignees || []).some((a: any) => a.userId === viewer.id);
      const isCreator = task.createdById === viewer.id;
      const isProjectMember = (task.project?.members || []).some((m: any) => m.id === viewer.id);
      const isManager = task.project?.managerId === viewer.id;
      const isGeneralFromFounder = (task as any).scope === 'general' && task.fromFounder;
      const canView = isPm || isAssignee || isCoAssignee || isCreator || isProjectMember || isManager || isGeneralFromFounder;
      if (!canView) {
        throw new ForbiddenException('Нет доступа к этой задаче');
      }
    }

    return task;
  }

  /** Лёгкая проверка доступа к задаче без полной загрузки relations —
   *  для comments/files/time-tracker IDOR-фильтров. Правило — общее с
   *  чек-листом, результатами и учётом времени (task-access.ts, 15.11.2026). */
  async assertCanAccessTask(taskId: string, viewer: { id: string; role?: string; secondaryRole?: string | null }): Promise<void> {
    await assertTaskReadable(this.repo.manager, taskId, viewer);
  }

  async create(dto: CreateTaskDto, userId: string, userRole?: string) {
    if (!dto.deadline) {
      throw new BadRequestException('Укажите дедлайн задачи');
    }
    // Workers (non-PM) can only create tasks assigned to themselves.
    // НО: если пользователь — реальный менеджер целевого проекта (по
    // project.managerId), он тоже может назначать на других, даже когда
    // его «глобальная» роль не PM (его повысили только в этом проекте).
    const isPmHere = await this.hasPmPowersOnProject(userId, userRole, dto.projectId);
    // МП по продажам тоже могут назначать задачи на других сотрудников
    // (фича календаря «как у основателя»).
    const canAssignOthers = isPmHere || isSalesManager(userRole);
    if (!canAssignOthers) {
      dto.assigneeId = userId;
      // Multi-assignee тоже ограничиваем — только сам себе
      (dto as any).assigneeIds = [userId];
    }
    // Оценку качества при создании ставит только PM (15.11.2026), дальше —
    // approve/return: иначе «принято с первого раза» выставлялось себе сразу.
    if (!isPmHere) {
      for (const k of QUALITY_FIELDS) delete (dto as any)[k];
    }

    // МП по продажам может прикреплять задачу только к проекту своего
    // направления — findOne бросит 403, если проект чужого сегмента.
    if (dto.projectId && isSalesManager(userRole)) {
      await this.projectsService.findOne(dto.projectId, userRole);
    }

    const scope = (dto as any).scope as 'personal' | 'business' | 'general' | undefined;
    const isPersonal = scope === 'personal';

    // «Общая задача от основателя» уходит рассылкой ВСЕЙ компании сразу по
    // трём каналам (сайт, email, Telegram) и становится видна каждому. Форму
    // с этим типом видят только основатель и со-основатель, но раньше сервер
    // принимал scope='general' и fromFounder от кого угодно — любой сотрудник
    // мог разослать компании письмо «от основателя» напрямую по API. Роль
    // решает сервер, а не форма.
    if (!BROADCAST_ROLES.includes(userRole || '')) {
      if (scope === 'general') {
        throw new ForbiddenException('Общие задачи может ставить только руководство');
      }
      dto.fromFounder = false;
    }

    const isGeneral = scope === 'general';
    const isFromFounder = !!dto.fromFounder;

    // PERSONAL — всегда принадлежит только создателю, никаких уведомлений.
    if (isPersonal) {
      dto.assigneeId = userId;
      (dto as any).assigneeIds = [userId];
      dto.projectId = undefined;
      dto.fromFounder = false;
    }

    // GENERAL от founder — общая задача для всей компании, без специфического
    // assignee. Видна всем через scope-фильтр в findAll. Уведомления — каждому
    // активному сотруднику параллельно по 3 каналам.
    if (isGeneral && isFromFounder) {
      dto.assigneeId = undefined as any;
      (dto as any).assigneeIds = undefined;
      dto.projectId = undefined;
    }

    // BUSINESS без выбранного исполнителя — задача на самого создателя.
    // Раньше форма требовала участника и сохранить без него было нельзя;
    // без хозяина задача не попала бы ни в чей календарь и потерялась бы.
    // Уведомлений не будет: себя в рассылку не включаем (см. ниже).
    if (scope === 'business' && !(this.extractAssigneeIds(dto)?.length)) {
      dto.assigneeId = userId;
      (dto as any).assigneeIds = [userId];
    }

    // Multi-assignee: вычисляем итоговый список + основного исполнителя
    const incomingAssigneeIds = this.extractAssigneeIds(dto);
    if (incomingAssigneeIds && incomingAssigneeIds.length > 0) {
      // assigneeId (legacy) ставим первым из списка для совместимости
      dto.assigneeId = incomingAssigneeIds[0];
    }

    const task = this.repo.create({ ...dto, createdById: userId });
    const saved = await this.repo.save(task);

    // Синхронизация многих исполнителей в task_assignees
    if (incomingAssigneeIds && incomingAssigneeIds.length > 0) {
      await this.syncAssignees(saved.id, incomingAssigneeIds);
    }

    const creator = await this.userRepo.findOne({ where: { id: userId } });

    // ─── Определяем кому слать уведомления ────────────────────────────
    // PERSONAL — никому. GENERAL+fromFounder — всем активным сотрудникам
    // параллельно. BUSINESS+fromFounder с multi-assignee — всем выбранным
    // параллельно (не sequential, founder отдаёт распоряжение каждому
    // независимо). Остальное — классический sequential (только первый).
    let notifyIds: string[] = [];
    if (isPersonal) {
      notifyIds = [];
    } else if (isGeneral && isFromFounder) {
      const allUsers = await this.userRepo.find({
        where: { isActive: true, isBlocked: false },
      });
      notifyIds = allUsers.map(u => u.id).filter(id => id !== userId);
    } else if (isFromFounder && incomingAssigneeIds && incomingAssigneeIds.length > 0) {
      // Founder + business: уведомляем ВСЕХ выбранных (не sequential).
      notifyIds = incomingAssigneeIds.filter(id => id !== userId);
    } else {
      // Обычный sequential — только первый исполнитель
      const firstAssigneeId = incomingAssigneeIds && incomingAssigneeIds.length > 0
        ? incomingAssigneeIds[0]
        : dto.assigneeId;
      notifyIds = (firstAssigneeId && firstAssigneeId !== userId) ? [firstAssigneeId] : [];
    }
    const totalSteps = incomingAssigneeIds?.length || (dto.assigneeId ? 1 : 0);
    // Рассылка — с ограниченной параллельностью (15.11.2026): общая задача
    // уходит всей компании, и последовательные await уведомления, письма и
    // Telegram на каждого держали запрос минутами. Что и кому шлём — как
    // раньше; карточку задачи (для имени проекта в письме) грузим один раз.
    let fullForMail: Promise<Task> | null = null;
    const loadFull = (): Promise<Task> => {
      if (!fullForMail) fullForMail = this.findOne(saved.id);
      return fullForMail;
    };
    await forEachLimited(notifyIds, BROADCAST_CONCURRENCY, async (aid) => {
      try {
        const assignee = await this.userRepo.findOne({ where: { id: aid } });
        // Если задача назначена основателю/со-основателю не им самим — это
        // отдельный важный кейс. Хотим, чтобы он чётко знал: «У вас задача
        // от <имя сотрудника>» по всем трём каналам с одинаковым tone.
        const toFounder = !!assignee && [UserRole.FOUNDER].includes(assignee.role as UserRole);

        await this.notificationsService.create({
          userId: aid,
          type: NotificationType.NEW_TASK,
          title: isGeneral && isFromFounder
            ? '👑 Общая задача от основателя'
            : isFromFounder
              ? '👑 Задача от основателя'
              : toFounder
                ? '📨 Задача для вас от сотрудника'
                : 'Новая задача',
          message: isGeneral && isFromFounder
            ? `${creator?.name || 'Основатель'} поставил задачу всей команде: "${saved.title}"`
            : isFromFounder
              ? `${creator?.name || 'Основатель'} назначил вам прямую задачу: "${saved.title}"`
              : toFounder
                ? `${creator?.name || 'Сотрудник'} назначил вам задачу: "${saved.title}"`
                : `Вам назначена задача: "${saved.title}"${totalSteps > 1 ? ` (этап 1 из ${totalSteps})` : ''}`,
          link: `/tasks/${saved.id}`,
        });
        if (assignee?.email) {
          const full = await loadFull();
          const deadline = saved.deadline ? new Date(saved.deadline).toLocaleDateString('ru-RU', { timeZone: DUSHANBE_TZ }) : undefined;
          const titleForMail = isGeneral && isFromFounder
            ? `👑 Общая задача от основателя (${creator?.name || ''}): ${saved.title}`
            : isFromFounder
              ? `👑 От основателя (${creator?.name || ''}): ${saved.title}`
              : toFounder
                ? `📨 Задача для вас от ${creator?.name || 'сотрудника'}: ${saved.title}`
                : saved.title;
          await this.mailService.sendTaskAssigned(
            assignee.email, assignee.name, titleForMail, saved.id,
            isGeneral && isFromFounder
              ? 'Общая задача от основателя — для всей команды'
              : isFromFounder
                ? 'Прямая задача от основателя'
                : toFounder
                  ? `Задача от сотрудника: ${creator?.name || ''}`
                  : full.project?.name,
            deadline, saved.priority, saved.description || undefined,
          );
          const priorityLabels: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный', critical: 'Критический' };
          // Общая задача (для всей команды) — без персональных кнопок «Готово»
          // (нет одного исполнителя). Личные/бизнес — с кнопками управления
          // статусом прямо из бота.
          const botButtons = (isGeneral && isFromFounder) ? undefined : this.taskBotButtons(saved.id);
          await this.telegramService.sendToUser(
            aid,
            (isGeneral && isFromFounder
              ? `👑 <b>Общая задача от основателя</b>\n\n`
              : isFromFounder
                ? `👑 <b>Задача от основателя</b>\n\n`
                : toFounder
                  ? `📨 <b>Задача для вас от сотрудника</b>\n\n`
                  : `✅ <b>Вам назначена задача</b>\n\n`) +
            `📋 ${escapeHtml(saved.title)}` +
            (isGeneral && isFromFounder
              ? `\n👥 Для всей команды`
              : isFromFounder
                ? `\n👤 От: ${escapeHtml(creator?.name || 'Основатель')}`
                : toFounder
                  ? `\n👤 От: ${escapeHtml(creator?.name || 'Сотрудник')}`
                  : (full.project?.name ? `\n📁 ${escapeHtml(full.project.name)}` : '')) +
            (saved.priority ? `\n🔥 Приоритет: ${priorityLabels[saved.priority] || saved.priority}` : '') +
            (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/tasks/${saved.id}`,
            botButtons,
          );
        }
      } catch (e: any) {
        console.warn('notify failed for', aid, e?.message);
      }
    });

    // Задача или встреча, поставленная САМОМУ СЕБЕ: раньше подтверждения не
    // было вообще (рассылка идёт только другим исполнителям), и человек не
    // видел в боте, что запись создалась. Шлём короткое подтверждение —
    // с кнопками управления статусом, чтобы закрыть прямо из Telegram.
    const selfAssigned = (dto.assigneeId === userId)
      || (incomingAssigneeIds?.length === 1 && incomingAssigneeIds[0] === userId);
    if (selfAssigned && !notifyIds.includes(userId)) {
      this.telegramService.sendToUser(
        userId,
        this.calendarEntryMessage(saved, 'created'),
        this.taskBotButtons(saved.id),
      ).catch(() => {});
    }

    await this.activityLog.log({
      userId,
      userName: creator?.name,
      action: ActivityAction.TASK_CREATE,
      entity: 'task',
      entityId: saved.id,
      entityName: saved.title,
      details: { projectId: dto.projectId, priority: dto.priority, assigneeId: dto.assigneeId },
    });

    // Прямые задачи от основателя могут не иметь проекта — updateProgress
    // только если projectId задан.
    if (dto.projectId) {
      await this.projectsService.updateProgress(dto.projectId);
    }
    // Личная задача касается только автора. Рассылка «задачи изменились»
    // заставляла КАЖДОГО сотрудника в сети перезапрашивать задачи, проекты и
    // аналитику ради чужой заметки — и тормозила самого автора. Теперь о ней
    // узнаёт лишь сам автор (другие его вкладки и устройства).
    this.notifyTasksChanged(
      { projectId: dto.projectId ?? null, taskId: saved.id, actorId: userId, kind: 'create' },
      isPersonal ? [userId] : undefined,
    );
    return this.findOne(saved.id);
  }

  /** Inline-кнопки управления статусом задачи в Telegram. */
  /** Единый текст для записи календаря (задача или встреча) во всех
   *  каналах: подтверждение при создании, утренняя сводка, напоминание за
   *  час, вечерний разбор. Один формат — чтобы человек узнавал сообщение. */
  calendarEntryMessage(
    task: { id: string; title: string; kind?: string | null; location?: string | null; deadline?: Date | string | null; description?: string | null },
    mode: 'created' | 'today' | 'soon' | 'unfinished',
  ): string {
    const isMeeting = (task.kind || 'task') === TaskKind.MEETING;
    const when = task.deadline ? new Date(task.deadline) : null;
    const dateStr = when
      ? when.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: DUSHANBE_TZ })
      : null;
    const timeStr = when
      ? when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: DUSHANBE_TZ })
      : null;

    const head = isMeeting
      ? {
        created: '🤝 <b>Встреча в календаре</b>',
        today: '🤝 <b>Сегодня встреча</b>',
        soon: '⏰ <b>Встреча через час</b>',
        unfinished: '🤝 <b>Встреча не закрыта</b>',
      }[mode]
      : {
        created: '📝 <b>Задача в календаре</b>',
        today: '📌 <b>Задача на сегодня</b>',
        soon: '⏰ <b>Задача через час</b>',
        unfinished: '🌙 <b>Задача не закрыта</b>',
      }[mode];

    return (
      `${head}\n\n` +
      `📋 ${escapeHtml(task.title)}` +
      (dateStr ? `\n📅 ${dateStr}${timeStr ? ` в ${timeStr}` : ''}` : '') +
      (isMeeting && task.location ? `\n📍 ${escapeHtml(task.location)}` : '') +
      (task.description ? `\n\n<i>${escapeHtml(task.description.slice(0, 300))}</i>` : '') +
      `\n\n👉 ${this.telegramService.appUrl}/tasks/${task.id}`
    );
  }

  /** Те же кнопки «Готово / В работу» для внешних потребителей (крон
   *  напоминаний) — чтобы человек закрывал запись прямо из Telegram. */
  publicTaskButtons(taskId: string) {
    return this.taskBotButtons(taskId);
  }

  private taskBotButtons(taskId: string): { text: string; callback_data: string }[][] {
    return [[
      { text: '✅ Готово', callback_data: `t:done:${taskId}` },
      { text: '▶️ В работу', callback_data: `t:progress:${taskId}` },
    ]];
  }

  /** Обработка нажатия кнопки в боте: исполнитель меняет статус задачи
   *  («✅ Готово» → done, «▶️ В работу» → in_progress). Переиспользует update,
   *  поэтому автоматически уведомляет назначившего и обновляет проект/доски.
   *  Возвращает текст для ответа боту. */
  async handleBotAction(taskId: string, action: 'done' | 'progress', userId: string): Promise<{ text: string }> {
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) return { text: 'Задача не найдена' };

    // Разрешаем действие только исполнителю (основному или из task_assignees)
    // или создателю задачи.
    const assignees = await this.assigneesRepo.find({ where: { taskId } }).catch(() => [] as any[]);
    const isAssignee = task.assigneeId === userId || assignees.some((a: any) => a.userId === userId);
    if (!isAssignee && task.createdById !== userId) {
      return { text: 'Это не ваша задача' };
    }
    if (task.status === TaskStatus.DONE && action === 'done') {
      return { text: 'Задача уже отмечена выполненной' };
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });

    // Задача на нескольких исполнителей (очередь шагов): «✅ Готово» из
    // Telegram = «моя часть готова» (15.11.2026). Иначе update() теперь
    // отказывает, пока свои шаги не отметили остальные, и кнопка ломалась.
    // Свой открытый шаг есть — всегда через «моя часть готова», даже если он
    // последний: markMyPartDone сам закроет задачу и отметит шаг (иначе шаг
    // оставался isDone=false у закрытой задачи).
    if (action === 'done' && assignees.length > 1 && assignees.some((a: any) => a.userId === userId && !a.isDone)) {
      try {
        const { allDone } = await this.markMyPartDone(taskId, {
          id: userId, role: user?.role || '', name: user?.name,
        });
        return { text: allDone ? '✅ Задача отмечена выполненной' : '✅ Ваша часть отмечена — задача ушла дальше по очереди' };
      } catch (e: any) {
        return { text: String(e?.message || 'Не удалось отметить. Откройте задачу в системе.') };
      }
    }

    const status = action === 'done' ? TaskStatus.DONE : TaskStatus.IN_PROGRESS;
    try {
      await this.update(taskId, { status } as UpdateTaskDto, {
        id: userId, role: user?.role || '', name: user?.name,
      });
    } catch (e: any) {
      return { text: 'Не удалось изменить статус. Откройте задачу в системе.' };
    }
    return { text: action === 'done' ? '✅ Задача отмечена выполненной' : '▶️ Задача взята в работу' };
  }

  async update(id: string, dto: UpdateTaskDto, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);

    // Дедлайн нельзя очистить — только перенести на другую дату.
    if ('deadline' in (dto as any) && !(dto as any).deadline) {
      throw new BadRequestException('Дедлайн нельзя очистить');
    }

    // Workers can only update tasks assigned to them OR created by them
    // (МП по продажам создаёт задачи в календаре — должен их редактировать).
    // Исключение: если пользователь — реальный менеджер проекта задачи,
    // он имеет PM-полномочия и может редактировать любую задачу в нём.
    // Проверка deny-by-default: ограничение действует на ВСЕХ, у кого нет
    // PM-полномочий в этом проекте. Раньше здесь был список WORKER_ROLES, и
    // роли вне него (developer, pm_dev) обходили проверку целиком — правили
    // любую чужую задачу.
    const isPmHere = (isPmUser(user as any) && !outOfDirection(user as any, task.project?.projectType))
      || await this.hasPmPowersOnProject(user.id, user.role, task.projectId);
    const isCreator = task.createdById === user.id;
    if (
      !isPmHere &&
      task.assigneeId !== user.id &&
      !isCreator
    ) {
      // Со-исполнитель (в task_assignees, но не первый/основной) — тоже
      // исполнитель СВОЕЙ задачи: раньше получал «Not allowed» при попытке
      // двигать её статус вперёд.
      const isCoAssignee = await this.assigneesRepo
        .createQueryBuilder('ta')
        .where('ta."taskId" = :id AND ta."userId" = :uid', { id, uid: user.id })
        .getCount();
      if (!isCoAssignee) {
        throw new ForbiddenException('У вас нет доступа к этой задаче — вы не её исполнитель и не автор');
      }
    }

    // ─── Что можно менять без PM-полномочий (15.11.2026) ──────────────
    // Лишние поля тихо отбрасываем (без 403) — формы шлют их целиком.
    if (!isPmHere) {
      const patch = dto as any;
      // Оценка качества — только через approve/return.
      for (const k of QUALITY_FIELDS) delete patch[k];
      if (isCreator) {
        // Автор (не PM) правит свою задачу, но исполнителей — по правилу
        // создания: МП по продажам — любых, остальные — только себя.
        const ids = this.extractAssigneeIds(patch);
        if (ids !== undefined && !salesRoleOf(user as any)
          && !(ids.length === 1 && ids[0] === user.id)) {
          delete patch.assigneeIds;
          delete patch.assigneeId;
        }
        // Срок сданной задачи не двигаем: иначе просрочка в KPI задним
        // числом становится «в срок».
        if (task.status === TaskStatus.DONE) delete patch.deadline;
      } else {
        // Исполнитель / со-исполнитель — только статус и рабочие поля.
        for (const k of Object.keys(patch)) {
          if (!ASSIGNEE_EDITABLE.has(k)) delete patch[k];
        }
        // Очередь исполнителей: закрыть задачу целиком нельзя, пока свою
        // часть не отметили остальные («Моя часть готова»).
        if (patch.status === TaskStatus.DONE && task.status !== TaskStatus.DONE) {
          const chain = await this.assigneesRepo.find({ where: { taskId: id } });
          const othersPending = chain.length > 1 && chain.some(r => !r.isDone && r.userId !== user.id);
          if (othersPending) {
            throw new BadRequestException(
              'У задачи несколько исполнителей — отметьте свою часть кнопкой «Моя часть готова», задача закроется, когда отметят все',
            );
          }
        }
      }
    }

    // SCOPE менять может основатель и МП по продажам (в т.ч. второй ролью).
    // Для остальных ролей попытка смены scope тихо игнорируется — поле
    // убирается из dto, без 403. «Общую» (рассылка всей компании) ставит
    // только руководство — как на создании (15.11.2026: МП мог сделать это
    // вторым запросом PATCH). Смена scope НЕ рассылает ретроспективных
    // уведомлений.
    if ((dto as any).scope && (dto as any).scope !== task.scope) {
      const canChangeScope =
        user.role === 'founder' ||
        !!salesRoleOf(user as any);
      const generalDenied = (dto as any).scope === TaskScope.GENERAL && !BROADCAST_ROLES.includes(user.role);
      if (!canChangeScope || generalDenied) {
        delete (dto as any).scope;
      }
    }
    // Пометку «от основателя» на правке тоже ставит только руководство —
    // иначе гейт на создании обходится вторым запросом PATCH.
    if ((dto as any).fromFounder !== undefined && !BROADCAST_ROLES.includes(user.role)) {
      delete (dto as any).fromFounder;
    }

    // Смена типа задачи основателем — разрешаем принудительно очистить
    // исполнителей (иначе защита очереди syncAssignees бросит 400).
    const scopeChanged =
      !!(dto as any).scope && (dto as any).scope !== task.scope;

    // МП по продажам может переносить задачу только в проект своего
    // направления — findOne бросит 403, если проект чужого сегмента.
    if (
      (dto as any).projectId &&
      isSalesManager(user.role) &&
      (dto as any).projectId !== task.projectId
    ) {
      await this.projectsService.findOne((dto as any).projectId, user.role);
    }

    // SMM specialists have full status control over their own tasks
    const isSmmSpecialist = user.role === UserRole.SMM_SPECIALIST;
    // Сам себе поставил — управляет полностью (статус, дедлайн, описание).
    // Это его собственная задача-заметка, через review её гонять не надо.
    const isSelfCreated = task.createdById === user.id && task.assigneeId === user.id;

    // Workers (except SMM) cannot directly set status to DONE without uploading
    // at least one result file/note. SMM-специалист, автор-исполнитель
    // собственной задачи и поручения ОТ РУКОВОДСТВА могут закрывать без файлов
    // (последнее — раздел «Задачи от руководителя»: это поручения, а не
    // производственные работы с артефактом).
    if (
      dto.status === TaskStatus.DONE &&
      WORKER_ROLES.includes(user.role as UserRole) &&
      // Руководитель (в т.ч. второй ролью — dev_director у Сабрины) принимает
      // работу прямой сменой статуса, требование файла-результата не для него.
      !isPmUser(user as any) &&
      !isSmmSpecialist &&
      !isSelfCreated
    ) {
      // Роль автора запрашиваем ЛЕНИВО — только когда правило иначе сработает,
      // чтобы не ходить в users на каждом апдейте статуса.
      let isFromManagement = false;
      if (task.createdById && task.createdById !== user.id) {
        const creator = await this.userRepo.findOne({
          where: { id: task.createdById },
          select: ['id', 'role', 'secondaryRole'] as any,
        }).catch(() => null);
        isFromManagement = !!creator && (
          MANAGEMENT_ROLES.includes(creator.role as string)
          || MANAGEMENT_ROLES.includes((creator as any).secondaryRole as string)
        );
      }
      if (!isFromManagement) {
        const resultCount = await this.taskResultsService.countByTask(id);
        if (resultCount === 0) {
          throw new BadRequestException('Загрузите результат работы перед тем как отметить задачу выполненной');
        }
      }
    }

    const oldStatus = task.status;
    const oldAssigneeId = task.assigneeId;

    // Multi-assignee sync: если массив пришёл — синхронизируем + ставим
    // assigneeId первым из списка для обратной совместимости.
    const incomingAssigneeIds = this.extractAssigneeIds(dto);
    if (Array.isArray((dto as any).assigneeIds)) {
      // Для PATCH update передавали именно массив (а не legacy assigneeId)
      if (incomingAssigneeIds && incomingAssigneeIds.length > 0) {
        dto.assigneeId = incomingAssigneeIds[0];
      } else {
        dto.assigneeId = null as any;
      }
    }
    // Чистим assigneeIds из dto перед update — это не колонка
    const { assigneeIds: _aIds, ...patchForRepo } = dto as any;
    // Фактический момент закрытия — фиксируем ровно при переходе в DONE и
    // сбрасываем, если задачу переоткрыли. По нему KPI решает, сдано в срок
    // или нет; время последнего изменения записи для этого не годится —
    // любая поздняя правка делала бы сданное вовремя просроченным.
    if (dto.status && dto.status !== oldStatus) {
      patchForRepo.completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
    }
    // После отсева полей менять может быть нечего — пустой UPDATE TypeORM
    // не пропускает.
    if (Object.keys(patchForRepo).length > 0) {
      await this.repo.update(id, patchForRepo);
    }
    if (Array.isArray((dto as any).assigneeIds)) {
      await this.syncAssignees(id, incomingAssigneeIds || [], scopeChanged);
    }

    // Notify on status change
    if (dto.status && dto.status !== oldStatus) {
      // Auto-generate daily report when a task becomes DONE
      if (dto.status === TaskStatus.DONE) {
        await this.autoReportFromTask({ ...task, ...dto } as Task);
      }
      // Кого уведомить: создателя, если статус сменил не он сам; иначе — исполнителя.
      // ВАЖНО: никогда не шлём уведомление самому действующему пользователю
      // («Я сам сменил статус → мне же пришло сообщение об этом») —
      // только другим заинтересованным сторонам.
      const candidate = task.createdById !== user.id ? task.createdById : task.assigneeId;
      const notifyId = candidate && candidate !== user.id ? candidate : null;
      if (notifyId) {
        const STATUS_LABELS: Record<string, string> = { new: 'Новая', in_progress: 'В работе', done: 'Готово', cancelled: 'Отмена' };
        const statusLabel = STATUS_LABELS[dto.status] || dto.status;
        const isDone = dto.status === TaskStatus.DONE;
        await this.notificationsService.create({
          userId: notifyId,
          type: NotificationType.STATUS_CHANGE,
          title: isDone ? '✅ Задача выполнена' : 'Статус задачи изменён',
          message: `Задача "${task.title}" изменила статус на "${statusLabel}"${user.name ? ` (${user.name})` : ''}`,
          link: `/tasks/${id}`,
        });
        // Тот, кто назначил задачу, узнаёт об изменении статуса по 3 каналам:
        // in-app (выше) + Telegram + Email.
        try {
          await this.telegramService.sendToUser(
            notifyId,
            `${isDone ? '✅' : '🔄'} <b>${isDone ? 'Задача выполнена' : 'Статус задачи изменён'}</b>\n\n` +
            `📋 ${escapeHtml(task.title)}\n` +
            `📊 Статус: <b>${statusLabel}</b>` +
            (user.name ? `\n👤 Изменил: ${escapeHtml(user.name)}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
          );
          const recipient = await this.userRepo.findOne({ where: { id: notifyId } });
          if (recipient?.email) {
            await this.mailService.sendGenericNotification(
              recipient.email, recipient.name || 'Сотрудник',
              `${isDone ? '✅' : '🔄'} ${isDone ? 'Задача выполнена' : 'Статус изменён'}: ${task.title}`,
              `Задача <strong>«${escapeHtml(task.title)}»</strong> изменила статус на <strong>${statusLabel}</strong>${user.name ? ` (изменил: ${escapeHtml(user.name)})` : ''}.<br><br>👉 Откройте задачу в системе, чтобы посмотреть детали.`,
            );
          }
        } catch (e: any) {
          console.warn('status-change notify failed for', notifyId, e?.message);
        }
      }
      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_STATUS,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: { from: oldStatus, to: dto.status },
      });
    }

    // Notify on new assignee — но не самого автора действия (если он
    // назначил задачу себе, лишние сообщения не приходят).
    if (dto.assigneeId && dto.assigneeId !== oldAssigneeId && dto.assigneeId !== user.id) {
      await this.notificationsService.create({
        userId: dto.assigneeId,
        type: NotificationType.NEW_TASK,
        title: 'Вам назначена задача',
        message: `Задача "${task.title}" теперь назначена вам`,
        link: `/tasks/${id}`,
      });

      // Email + Telegram notification
      const assignee = await this.userRepo.findOne({ where: { id: dto.assigneeId } });
      if (assignee?.email) {
        const full = await this.findOne(id);
        const deadline = task.deadline ? new Date(task.deadline).toLocaleDateString('ru-RU') : undefined;
        const priority = dto.priority || task.priority;
        await this.mailService.sendTaskAssigned(
          assignee.email,
          assignee.name,
          task.title,
          id,
          full.project?.name,
          deadline,
          priority,
          task.description || undefined,
        );
        const priorityLabels: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный', critical: 'Критический' };
        await this.telegramService.sendToUser(
          dto.assigneeId,
          `✅ <b>Вам назначена задача</b>\n\n` +
          `📋 ${escapeHtml(task.title)}` +
          (full.project?.name ? `\n📁 ${escapeHtml(full.project.name)}` : '') +
          (priority ? `\n🔥 Приоритет: ${priorityLabels[priority] || priority}` : '') +
          (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
          `\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
        );
      }
      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_ASSIGN,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: { assigneeId: dto.assigneeId },
      });
    }

    // Log generic update if neither status nor assignee changed
    if (!dto.status && !dto.assigneeId) {
      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_UPDATE,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: dto,
      });
    }

    await this.projectsService.updateProgress(task.projectId);
    // Личная задача (и до, и после правки) — без общей рассылки, см. create().
    const stayedPersonal = task.scope === TaskScope.PERSONAL
      && (!(dto as any).scope || (dto as any).scope === TaskScope.PERSONAL);
    // Вид правки решает, нужен ли фронту тяжёлый список проектов (счётчики
    // задач, прогресс): переименование и срок его не меняют.
    const movedProject = 'projectId' in (dto as any)
      && ((dto as any).projectId ?? null) !== (task.projectId ?? null);
    const statusChanged = !!dto.status && dto.status !== oldStatus;
    this.notifyTasksChanged(
      {
        // Перенесли в другой проект — затронуты оба, пусть фронт обновит все.
        ...(movedProject ? {} : { projectId: task.projectId ?? null }),
        taskId: id,
        actorId: user.id,
        kind: movedProject || scopeChanged ? 'move' : statusChanged ? 'status' : 'edit',
      },
      stayedPersonal ? [task.createdById] : undefined,
    );
    return this.findOne(id);
  }

  /** Удаление задачи вместе с отвязкой её авто-отчётов.
   *  Закрытая задача порождает запись в daily_reports с внешним ключом на
   *  tasks — без каскада удаление падало с 500. Отчёт сотрудника сохраняем
   *  (в нём его часы и описание), обнуляем только ссылку на задачу. Обе
   *  операции — одной транзакцией: если параллельно кто-то закроет задачу и
   *  создаст новый отчёт, откатится всё, и не останется отчётов с оборванной
   *  ссылкой на живую задачу. */
  private async deleteTaskWithReports(task: Task) {
    await this.repo.manager.transaction(async trx => {
      await trx.query(`UPDATE daily_reports SET "taskId" = NULL WHERE "taskId" = $1`, [task.id]);
      await trx.remove(task);
    });
  }

  async remove(id: string) {
    const task = await this.findOne(id);
    const projectId = task.projectId;
    await this.activityLog.log({
      action: ActivityAction.TASK_DELETE,
      entity: 'task',
      entityId: id,
      entityName: task.title,
    });
    await this.deleteTaskWithReports(task);
    await this.notificationsService.deleteByLink(`/tasks/${id}`);
    await this.projectsService.updateProgress(projectId);
    this.notifyTasksChanged(
      { projectId: projectId ?? null, taskId: id, kind: 'delete' },
      task.scope === TaskScope.PERSONAL ? [task.createdById] : undefined,
    );
    return { message: 'Task deleted' };
  }

  async removeWithAuth(id: string, user: { id: string; role: string; name?: string }, reason?: string) {
    // Wave 3: причина удаления обязательна. Без неё блокируем операцию.
    const cleanReason = (reason ?? '').trim();
    if (!cleanReason) {
      throw new BadRequestException('Укажите причину удаления задачи');
    }

    const task = await this.findOne(id);
    // Workers (any non-PM role) can only delete their own tasks (assigned to them or created by them).
    // Менеджер целевого проекта тоже может удалять задачи в своём проекте.
    const isPM = (isPmUser(user as any) && !outOfDirection(user as any, task.project?.projectType))
      || await this.hasPmPowersOnProject(user.id, user.role, task.projectId);
    if (!isPM && task.assigneeId !== user.id && task.createdById !== user.id) {
      throw new ForbiddenException('Not allowed');
    }
    const projectId = task.projectId;
    // Сохраняем причину в самой записи перед удалением — на будущее (soft-delete).
    // Сейчас задача всё равно удаляется, но в activity log фигурирует reason.
    task.deletionReason = cleanReason;
    await this.repo.save(task);

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.TASK_DELETE,
      entity: 'task',
      entityId: id,
      entityName: task.title,
      details: { reason: cleanReason },
    });
    await this.deleteTaskWithReports(task);
    await this.notificationsService.deleteByLink(`/tasks/${id}`);
    await this.projectsService.updateProgress(projectId);
    this.notifyTasksChanged(
      { projectId: projectId ?? null, taskId: id, actorId: user.id, kind: 'delete' },
      task.scope === TaskScope.PERSONAL ? [task.createdById] : undefined,
    );
    return { message: 'Task deleted' };
  }

  /** «Мои задачи» для сотрудника:
   *   - задачи где он assigneeId (legacy single-assignee)
   *   - задачи где он в task_assignees (multi-assignee workflow)
   *   - его личные заметки из календаря (scope=personal, createdById=я)
   *  Сортировка по дедлайну (NULL в конце). */
  /** Дата + n дней, обе стороны в 'YYYY-MM-DD'. Сроки у задач — DATE, без
   *  времени и часового пояса, поэтому и считаем по строке. */
  private shiftDate(d: string, days: number): string {
    const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, dd));
    x.setUTCDate(x.getUTCDate() + days);
    return x.toISOString().slice(0, 10);
  }

  /** Понедельник недели, в которую попадает дата. */
  private mondayOf(d: string): string {
    const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, dd));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  }

  /**
   * Копия задачи на неделю вперёд. Возвращает null, если копия уже есть —
   * повтор запускается и кнопкой, и по расписанию, и дважды создавать одно
   * и то же нельзя.
   *
   * Корень цепочки (repeatedFromId) сохраняется у всех копий: так задача,
   * повторённая двадцать раз, остаётся одной цепочкой, а не деревом.
   */
  private async cloneToNextWeek(task: Task, createdById: string): Promise<Task | null> {
    if (!task.deadline) return null;
    // Срок — timestamp (драйвер отдаёт Date): сдвигаем момент ровно на 7×24 ч,
    // время сохраняется (15.11.2026). Раньше String(Date) → «Mon Nov 09…» →
    // NaN → RangeError, и повтор недели всегда падал с 500.
    const src = new Date(task.deadline as any);
    if (isNaN(src.getTime())) return null;
    const deadline = new Date(src.getTime() + 7 * 86400_000);
    const rootId = task.repeatedFromId || task.id;

    // Копия этой цепочки на тот же день (по Душанбе) уже есть — не дублируем,
    // даже если у неё потом поправили время.
    const day = dushanbeDay(deadline);
    const exists = await this.repo.findOne({
      where: { repeatedFromId: rootId, deadline: Between(dushanbeDayStart(day), dushanbeDayEnd(day)) as any },
      select: ['id'] as any,
    });
    if (exists) return null;

    const copy = this.repo.create({
      title: task.title,
      description: task.description,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
      priority: task.priority,
      scope: task.scope,
      kind: task.kind,
      fromFounder: task.fromFounder,
      repeatWeekly: task.repeatWeekly,
      repeatedFromId: rootId,
      deadline,
      status: TaskStatus.NEW,
      createdById,
    });
    const saved = await this.repo.save(copy);
    // Соисполнители переносятся вместе с задачей: без них копия достаётся
    // одному человеку, хотя на прошлой неделе работали вдвоём. Очередь — в
    // прежнем порядке. loadAssignees отдаёт { userId, ... }: раньше брали
    // несуществующий u.id, и соисполнители терялись (15.11.2026).
    const helpers = await this.loadAssignees([task.id]);
    const ids = (helpers.get(task.id) || []).map((u: any) => u.userId).filter(Boolean) as string[];
    if (ids.length) await this.syncAssignees(saved.id, ids);
    return saved;
  }

  /** Неделя для повтора: с начала понедельника до КОНЦА воскресенья по
   *  Душанбе (15.11.2026). Between('пн', 'вс') по timestamp обрывался на
   *  полуночи воскресенья, и задачи воскресенья не копировались. */
  private weekRange(fromIso: string, toIso: string) {
    return Between(dushanbeDayStart(fromIso), dushanbeDayEnd(toIso));
  }

  /**
   * «Повторить прошлую неделю» — кнопка в сетке «Задачи недели».
   * Копирует задачи предыдущей недели на указанную (weekStart — понедельник
   * целевой недели). Отменённые не копируем: их закрыли намеренно.
   */
  async repeatWeek(weekStart: string, actorId: string) {
    const target = this.mondayOf(weekStart);
    const from = this.shiftDate(target, -7);
    const to = this.shiftDate(target, -1);

    const source = await this.repo.find({
      where: { deadline: this.weekRange(from, to) as any, status: Not(TaskStatus.CANCELLED) },
    });
    let created = 0, skipped = 0;
    for (const t of source) {
      if (!t.assigneeId) { skipped += 1; continue; }
      const copy = await this.cloneToNextWeek(t, actorId);
      if (copy) created += 1; else skipped += 1;
    }
    this.logger.log(`repeatWeek ${from}..${to} → ${target}: создано ${created}, пропущено ${skipped}`);
    // Раньше копии появлялись у остальных только по опросу страницы задач.
    if (created > 0) this.notifyTasksChanged({ actorId, kind: 'bulk' });
    return { week: target, created, skipped };
  }

  /**
   * Еженедельный повтор: задачи с галочкой «повторять каждую неделю»
   * переносятся на новую неделю. Запускается по понедельникам.
   */
  async runWeeklyRepeats(today: string) {
    const thisMonday = this.mondayOf(today);
    const from = this.shiftDate(thisMonday, -7);
    const to = this.shiftDate(thisMonday, -1);

    const source = await this.repo.find({
      where: { repeatWeekly: true, deadline: this.weekRange(from, to) as any, status: Not(TaskStatus.CANCELLED) },
    });
    let created = 0;
    for (const t of source) {
      if (!t.assigneeId) continue;
      const copy = await this.cloneToNextWeek(t, t.createdById);
      if (copy) created += 1;
    }
    // Понедельничный повтор — тоже событие, иначе копии видны только по опросу.
    if (created > 0) this.notifyTasksChanged({ kind: 'bulk' });
    return { week: thisMonday, created, source: source.length };
  }

  /** Свои (личные) задачи сотрудника для календаря кабинета — лёгкий список.
   *  Календарю нужны только id, название, срок и статус; общий /tasks/my
   *  тянет все задачи человека с проектами и исполнителями, и перезапрос его
   *  после каждой заметки делал добавление задачи заметно медленным.
   *  Открытые отдаём все (незакрытая переезжает на сегодня), закрытые —
   *  за последние четыре месяца: дальше календарь не листают. */
  async getOwnTasks(userId: string) {
    const since = new Date(Date.now() - 120 * 86400_000);
    return this.repo.createQueryBuilder('t')
      .select(['t.id', 't.title', 't.deadline', 't.status', 't.completedAt'])
      .where('t.scope = :scope', { scope: TaskScope.PERSONAL })
      .andWhere('t."createdById" = :uid', { uid: userId })
      .andWhere('t.status <> :cancelled', { cancelled: TaskStatus.CANCELLED })
      .andWhere('(t.status <> :done OR t.deadline >= :since)', { done: TaskStatus.DONE, since })
      .orderBy('t.deadline', 'ASC', 'NULLS LAST')
      .getMany();
  }

  async getMyTasks(userId: string) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      // Проект — только имя и тип: целая строка проекта несёт jsonb-поля
      // (бриф, профиль клиента, правила авторасстановки), и у человека с
      // сотней задач ответ раздувался в разы. Экраны берут отсюда лишь имя.
      .leftJoin('t.project', 'project')
      .addSelect(projectListFields('project'))
      .where(
        `(t."assigneeId" = :uid
          OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = t.id AND ta."userId" = :uid)
          OR (t.scope = 'personal' AND t."createdById" = :uid))`,
        { uid: userId },
      )
      // КП-задачи скрыты из общих списков — они только в Онбординге.
      .andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`)
      .orderBy('t.deadline', 'ASC', 'NULLS LAST');

    const tasks = await qb.getMany();
    if (tasks.length > 0) {
      const map = await this.loadAssignees(tasks.map(t => t.id));
      for (const t of tasks) (t as any).assignees = map.get(t.id) || [];
    }
    return tasks;
  }

  /** Задачи ОТ РУКОВОДСТВА, назначенные сотруднику. Раздел «Задачи от
   *  руководителя»: основатель/сооснователь/админ/руководители направлений
   *  ставят задачу — сотрудник видит её и меняет статус. Личные задачи,
   *  созданные самим сотрудником, и задачи от коллег сюда не попадают. */
  async getTasksFromManagement(userId: string) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoin('t.project', 'project').addSelect(projectListFields('project'))
      .where(
        `(t."assigneeId" = :uid
          OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId" = t.id AND ta."userId" = :uid))`,
        { uid: userId },
      )
      // Автор — управляющая роль и это не сам сотрудник. Фильтруем по уже
      // присоединённому createdBy, без отдельного подзапроса к users.
      .andWhere(`t."createdById" IS NOT NULL AND t."createdById" <> :uid`)
      .andWhere(
        // Синтаксис СВОЙСТВ TypeORM (createdBy.secondaryRole), не сырые
        // кавычки: иначе алиас не резолвится и запрос падает.
        `(createdBy.role = ANY(:mgmt) OR createdBy.secondaryRole = ANY(:mgmt))`,
        { mgmt: MANAGEMENT_ROLES },
      )
      .andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`)
      .orderBy('t.deadline', 'ASC', 'NULLS LAST');
    const tasks = await qb.getMany();
    if (tasks.length > 0) {
      const map = await this.loadAssignees(tasks.map(t => t.id));
      for (const t of tasks) (t as any).assignees = map.get(t.id) || [];
    }
    return tasks;
  }

  /** Задачи, которые ВЫДАЛ текущий пользователь (вкладка «Я выдал») — чтобы
   *  видеть, на каком статусе задача у каждого сотрудника. */
  async getTasksAssignedByMe(userId: string) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoin('t.project', 'project').addSelect(projectListFields('project'))
      .where('t."createdById" = :uid', { uid: userId })
      // Свои личные заметки-задачи в этот список не тянем.
      .andWhere(`t.scope <> 'personal'`)
      .andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`)
      .orderBy('t.deadline', 'ASC', 'NULLS LAST');
    const tasks = await qb.getMany();
    if (tasks.length > 0) {
      const map = await this.loadAssignees(tasks.map(t => t.id));
      for (const t of tasks) (t as any).assignees = map.get(t.id) || [];
    }
    return tasks;
  }

  getOverdueTasks(viewer?: { id: string; role: string }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoin('t.project', 'project').addSelect(projectListFields('project'))
      .where('t.deadline < NOW()')
      // Закрытые для overdue — done/cancelled.
      .andWhere('t.status NOT IN (:...statuses)', { statuses: TASK_CLOSED_FOR_OVERDUE })
      // КП-задачи скрыты из «Просроченных».
      .andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`)
      // «Истории» из контент-плана не показываем в «Просроченных» — они
      // ведутся во вкладке «Контент-план» проекта и засоряют виджет
      // (десятки штук). Тот же двойной фильтр, что в Календаре:
      //   1) связь с content_plan_items типа 'story';
      //   2) фолбэк по заголовку «История:» (старые задачи без связи).
      .andWhere(`NOT EXISTS (
        SELECT 1 FROM content_plan_items cpi
        WHERE cpi."taskId" = t.id AND cpi."contentType" = 'story'
      )`)
      .andWhere(`t.title NOT ILIKE 'История:%'`);

    // SMM-роли (smm_director / smm_specialist / storymaker) НЕ должны
    // видеть sales-задачи в «Просроченных». Это автозадачи-встречи
    // менеджеров продаж (scope=personal, без project'а) — они к
    // SMM-сегменту не относятся, мешают читать виджет.
    const role = viewer?.role || '';
    const isSmmRole = ['smm_director', 'smm_specialist'].includes(role);
    if (isSmmRole) {
      qb.andWhere(`(t.scope <> 'personal' OR t.scope IS NULL)`);
      qb.andWhere(`(project."projectType" IS NULL OR project."projectType" = 'SMM')`);
    }
    // admin / founder — без фильтров (видят всё).
    // Руководитель направления видит просрочки только своей сферы: грант
    // tasks.overdue.view приходит вместе со второй ролью, а веток по этой
    // роли в фильтрах выше нет — без отсечки он получал бы всю компанию.
    const overdueDir = directionScopeOf(viewer as any);
    if (overdueDir) {
      qb.andWhere(
        '(project."projectType" IN (:...dirTypes) OR t."projectId" IS NULL)',
        { dirTypes: overdueDir.projectTypes },
      );
    }

    return qb.getMany();
  }

  async approveTask(id: string, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);
    const isPM = (isPmUser(user as any) && !outOfDirection(user as any, task.project?.projectType))
      || await this.hasPmPowersOnProject(user.id, user.role, task.projectId);
    if (!isPM) {
      throw new ForbiddenException('Only project managers can approve tasks');
    }
    // С 4-статусной моделью «approve» = подтвердить выполнение из IN_PROGRESS.
    if (task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('Задача уже закрыта');
    }

    await this.repo.update(id, {
      status: TaskStatus.DONE,
      reviewedById: user.id,
      reviewedAt: new Date(),
      completedAt: new Date(),
    });

    // Уведомление исполнителя — только если это другой пользователь.
    if (task.assigneeId && task.assigneeId !== user.id) {
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.TASK_COMPLETED,
        title: 'Задача подтверждена',
        message: `Задача "${task.title}" принята и закрыта`,
        link: `/tasks/${id}`,
      });
    }

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.TASK_REVIEW_APPROVE,
      entity: 'task',
      entityId: id,
      entityName: task.title,
    });

    await this.projectsService.updateProgress(task.projectId);
    await this.autoReportFromTask(task);
    this.notifyTasksChanged({ projectId: task.projectId ?? null, taskId: id, actorId: user.id, kind: 'status' });
    return this.findOne(id);
  }

  async returnTask(id: string, user: { id: string; role: string; name?: string }, reason: string) {
    const taskRaw = await this.repo
      .createQueryBuilder('t')
      .leftJoin('t.project', 'p')
      .select(['t.id', 't.title', 't.status', 't.assigneeId', 't.projectId', 't.reworkCount'])
      // Тип проекта нужен, чтобы руководитель направления не мог вернуть на
      // доработку задачу чужой сферы по прямому id.
      .addSelect('p.projectType', 'p_projectType')
      .where('t.id = :id', { id })
      .getRawOne();
    if (!taskRaw) throw new NotFoundException('Task not found');
    const isPM = (isPmUser(user as any) && !outOfDirection(user as any, taskRaw.p_projectType))
      || await this.hasPmPowersOnProject(user.id, user.role, taskRaw.t_projectId);
    if (!isPM) {
      throw new ForbiddenException('Only project managers can return tasks');
    }
    // В новой 4-статусной модели «return» = вернуть в IN_PROGRESS из
    // любого активного состояния. Финальные (DONE/CANCELLED) нельзя.
    if (taskRaw.t_status === TaskStatus.CANCELLED) {
      throw new BadRequestException('Нельзя вернуть отменённую задачу');
    }

    // Wave 3+6: инкрементируем счётчик возвратов, обновляем acceptedOnFirstTry.
    const newReworkCount = (Number(taskRaw.t_reworkCount) || 0) + 1;
    await this.repo.update(id, {
      status: TaskStatus.IN_PROGRESS,
      returnReason: reason,
      reworkCount: newReworkCount,
      acceptedOnFirstTry: false,
    });

    // Fire-and-forget: notifications, telegram, activity log
    const taskTitle = taskRaw.t_title;
    const assigneeId = taskRaw.t_assigneeId;
    const projectId = taskRaw.t_projectId;

    // Wave 6: если задача возвращена 2+ раз — отправляем алерт PM-у проекта.
    if (newReworkCount >= 2 && projectId) {
      this.repo.manager
        .query(`SELECT "managerId" FROM projects WHERE id = $1`, [projectId])
        .then((rows: Array<{ managerId: string }>) => {
          const pmId = rows?.[0]?.managerId;
          if (!pmId) return;
          this.notificationsService.createIfNotRecent({
            userId: pmId,
            type: NotificationType.TASK_DOUBLE_RETURN,
            title: '⚠️ Задача возвращается повторно',
            message: `"${taskTitle}" возвращена ${newReworkCount}-й раз. Стоит разобраться.`,
            link: `/tasks/${id}`,
            data: { alertKey: `task-double-return:${id}`, taskId: id, reworkCount: newReworkCount },
          }, 24).catch(() => {});
        })
        .catch(() => {});
    }

    if (assigneeId) {
      this.notificationsService.create({
        userId: assigneeId,
        type: NotificationType.TASK_RETURNED,
        title: 'Задача возвращена в работу',
        message: `"${taskTitle}": ${reason}`,
        link: `/tasks/${id}`,
        data: { reason },
      }).catch(() => {});

      this.telegramService.sendToUser(
        assigneeId,
        `🔁 <b>Задача возвращена в работу</b>\n\n📋 ${escapeHtml(taskTitle)}\n💬 ${escapeHtml(reason)}\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
      ).catch(() => {});
    }

    this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.TASK_REVIEW_RETURN,
      entity: 'task',
      entityId: id,
      entityName: taskTitle,
      details: { reason },
    }).catch(() => {});

    this.projectsService.updateProgress(projectId).catch(() => {});
    this.notifyTasksChanged({ projectId: projectId ?? null, taskId: id, actorId: user.id, kind: 'status' });

    return { id, status: 'returned', returnReason: reason, title: taskTitle };
  }

  getStats(projectId?: string, viewer?: { id: string; role?: string; secondaryRole?: string | null } | null) {
    const qb = this.repo.createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status');
    if (projectId) qb.where('t.projectId = :projectId', { projectId });
    // КП-задачи не учитываются в общих счётчиках.
    qb.andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`);
    // Счётчики — по тем же задачам, что видны в списке (15.11.2026): раньше
    // любой сотрудник получал разбивку по всей компании или чужому проекту.
    if (viewer) {
      qb.leftJoin('t.project', 'project');
      this.applyViewerScope(qb, viewer);
    }
    return qb.getRawMany();
  }

  async bulkAction(
    ids: string[],
    action: 'status' | 'delete' | 'assign',
    value: string | undefined,
    user: { id: string; role: string; name?: string },
  ): Promise<{ affected: number }> {
    // Только uuid: мусорный id ронял запрос в 500 (15.11.2026).
    ids = (Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string' && UUID_RE.test(x));
    if (!ids.length) return { affected: 0 };
    if (!isPmUser(user as any)) {
      throw new ForbiddenException('Массовые действия доступны только менеджерам');
    }
    // Руководитель направления действует только в своей сфере: массовая
    // операция по чужим id (в т.ч. массовое удаление) должна отклоняться
    // целиком, а не выполняться частично.
    const dirScope = directionScopeOf(user as any);
    if (dirScope) {
      const foreign = await this.repo
        .createQueryBuilder('t')
        .leftJoin('t.project', 'p')
        .where('t.id IN (:...ids)', { ids })
        .andWhere('t."projectId" IS NOT NULL')
        .andWhere('p."projectType" NOT IN (:...dirTypes)', { dirTypes: dirScope.projectTypes })
        .getCount();
      if (foreign > 0) {
        throw new ForbiddenException('В списке есть задачи чужого направления');
      }
    }

    // Задачи грузим один раз: дальше — те же правила, что у одиночной
    // правки (15.11.2026). Раньше массовый статус не трогал completedAt (KPI
    // «в срок» брал время правки), назначение не синхронизировало очередь
    // task_assignees, а удаление шло мимо отвязки отчётов (500 на FK).
    const tasks = await this.repo.find({ where: { id: In(ids) } });
    if (!tasks.length) return { affected: 0 };
    const projectIds = [...new Set(tasks.map(t => t.projectId).filter(Boolean))] as string[];
    const refreshProjects = async () => {
      for (const pid of projectIds) {
        await this.projectsService.updateProgress(pid).catch(() => undefined);
      }
    };

    if (action === 'delete') {
      // Wave 3: причина удаления обязательна и для bulk-операции.
      // Передаём её через `value` — для delete оно ранее не использовалось.
      const reason = (value ?? '').trim();
      if (!reason) {
        throw new BadRequestException('Укажите причину массового удаления задач');
      }
      for (const t of tasks) {
        // Причина — в записи и в журнале, как при одиночном удалении.
        t.deletionReason = reason;
        await this.repo.save(t);
        await this.activityLog.log({
          userId: user.id,
          userName: user.name,
          action: ActivityAction.TASK_DELETE,
          entity: 'task',
          entityId: t.id,
          entityName: t.title,
          details: { reason, bulk: true },
        }).catch(() => undefined);
        await this.deleteTaskWithReports(t);
        await this.notificationsService.deleteByLink(`/tasks/${t.id}`).catch(() => undefined);
      }
      await refreshProjects();
      // Задач много и проекты разные: kind 'bulk', без projectId — фронт
      // обновит всё, как при старом событии.
      this.notifyTasksChanged({ actorId: user.id, kind: 'bulk' });
      return { affected: tasks.length };
    }

    if (action === 'status' && value) {
      // Только четыре нынешних статуса.
      if (!(Object.values(TaskStatus) as string[]).includes(value)) {
        throw new BadRequestException('Недопустимый статус');
      }
      const status = value as TaskStatus;
      const changed = tasks.filter(t => t.status !== status);
      if (changed.length) {
        // completedAt — как в update(): ставим при переходе в DONE, сбрасываем
        // при переоткрытии.
        await this.repo.createQueryBuilder()
          .update(Task)
          .set({ status, completedAt: status === TaskStatus.DONE ? new Date() : null })
          .whereInIds(changed.map(t => t.id))
          .execute();
        for (const t of changed) {
          if (status === TaskStatus.DONE) await this.autoReportFromTask({ ...t, status } as Task);
          await this.activityLog.log({
            userId: user.id,
            userName: user.name,
            action: ActivityAction.TASK_STATUS,
            entity: 'task',
            entityId: t.id,
            entityName: t.title,
            details: { from: t.status, to: status, bulk: true },
          }).catch(() => undefined);
        }
        await refreshProjects();
      }
      // Уведомления об изменении статуса массово не шлём: десятки писем и
      // сообщений за один клик. Достаточно живого обновления списков.
      this.notifyTasksChanged({ actorId: user.id, kind: 'bulk' });
      return { affected: changed.length };
    }

    if (action === 'assign' && value) {
      if (!UUID_RE.test(value)) throw new BadRequestException('Некорректный исполнитель');
      const assignee = await this.userRepo.findOne({ where: { id: value } });
      if (!assignee || assignee.isActive === false || assignee.isBlocked) {
        throw new BadRequestException('Исполнитель не найден или неактивен');
      }
      await this.repo.createQueryBuilder()
        .update(Task)
        .set({ assigneeId: value })
        .whereInIds(tasks.map(t => t.id))
        .execute();
      // Очередь исполнителей — тоже на нового (принудительно: руководитель
      // переназначает задачу целиком).
      for (const t of tasks) await this.syncAssignees(t.id, [value], true);
      const reassigned = tasks.filter(t => t.assigneeId !== value);
      for (const t of reassigned) {
        await this.activityLog.log({
          userId: user.id,
          userName: user.name,
          action: ActivityAction.TASK_ASSIGN,
          entity: 'task',
          entityId: t.id,
          entityName: t.title,
          details: { assigneeId: value, bulk: true },
        }).catch(() => undefined);
      }
      // Одно сводное уведомление новому исполнителю (не на каждую задачу).
      if (reassigned.length && value !== user.id) {
        this.notificationsService.create({
          userId: value,
          type: NotificationType.NEW_TASK,
          title: 'Вам назначены задачи',
          message: reassigned.length === 1
            ? `Задача "${reassigned[0].title}" теперь назначена вам`
            : `${user.name || 'Руководитель'} назначил вам задач: ${reassigned.length}`,
          link: reassigned.length === 1 ? `/tasks/${reassigned[0].id}` : '/tasks',
        }).catch(() => undefined);
      }
      this.notifyTasksChanged({ actorId: user.id, kind: 'bulk' });
      return { affected: tasks.length };
    }

    return { affected: 0 };
  }
}
