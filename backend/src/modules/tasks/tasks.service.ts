import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task, TaskStatus, TaskPriority, TASK_CLOSED_FOR_OVERDUE } from './task.entity';
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
import { TaskResultsService } from '../task-results/task-results.service';
import { DailyReport } from '../reports/daily-report.entity';
import { getSalesSegment, isSalesManager } from '../../common/sales-segment';

const PM_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR];
const WORKER_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.VIDEO_EDITOR, UserRole.ORGANIZER, UserRole.STORYMAKER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV, UserRole.VIDEOGRAPHER, UserRole.SCRIPTWRITER, UserRole.QA, UserRole.PUBLISHER, UserRole.TARGETOLOGIST, UserRole.EMPLOYEE];

@Injectable()
export class TasksService {
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
    if (role && PM_ROLES.includes(role as UserRole)) return true;
    if (!projectId) return false;
    const proj = await this.projectRepo.findOne({
      where: { id: projectId },
      select: ['id', 'managerId'] as any,
    });
    return !!proj && proj.managerId === userId;
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
        `📋 ${task.title}\n` +
        `👤 Предыдущий шаг сделал: ${user.name || 'Исполнитель'}\n` +
        `\n👉 ${this.telegramService.appUrl}/tasks/${taskId}`,
      ).catch(() => {});
    }

    // Авто-переход в DONE когда все исполнители отметили свою часть.
    // Pipeline статусов упрощён до 4 (Wave 11) — промежуточного «review»
    // больше нет. Когда все стороны закончили — задача сразу DONE.
    if (allDone && task.status !== TaskStatus.DONE && task.status !== TaskStatus.CANCELLED) {
      await this.repo.update(taskId, { status: TaskStatus.DONE });

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

    this.gateway.broadcast('tasks:changed', { projectId: task.projectId });
    const fresh = await this.findOne(taskId);
    return { task: fresh, allDone };
  }

  /** Получить список assignees задачи (публично, для одной задачи). */
  async getAssignees(taskId: string) {
    await this.findOne(taskId);
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
    /** Фильтр по scope: 'personal' | 'business' | 'general'. */
    scope?: 'personal' | 'business' | 'general';
    /** ID текущего пользователя — нужен для скрытия чужих PERSONAL-задач. */
    viewerId?: string;
    /** Роль текущего пользователя — нужна для сегментации МП по продажам. */
    viewerRole?: string;
  }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoinAndSelect('t.project', 'project');

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

    // Фильтр по scope: явный фильтр от клиента.
    if (filters.scope) {
      qb.andWhere('t.scope = :scope', { scope: filters.scope });
    }

    // Скрываем чужие PERSONAL-задачи: даже founder/admin не видит личные
    // заметки других людей. Личная задача — приватная по определению.
    if (filters.viewerId) {
      qb.andWhere(
        `(t.scope <> 'personal' OR t."createdById" = :viewerId)`,
        { viewerId: filters.viewerId },
      );
    }

    // Сегментация менеджеров продаж: МП видит только задачи проектов
    // своего направления. Задачи без проекта видны, если они созданы им,
    // назначены ему или это общие задачи (scope='general').
    const salesSegment = getSalesSegment(filters.viewerRole);
    if (salesSegment) {
      qb.andWhere(
        `(project.projectType = :salesProjType
          OR (t.projectId IS NULL AND (
            t."createdById" = :salesViewerId
            OR t.assigneeId = :salesViewerId
            OR t.scope = 'general'
          )))`,
        {
          salesProjType: salesSegment.projectType,
          salesViewerId: filters.viewerId ?? null,
        },
      );
    }

    const tasks = await qb.orderBy('t.createdAt', 'DESC').getMany();
    if (tasks.length > 0) {
      const map = await this.loadAssignees(tasks.map(t => t.id));
      for (const t of tasks) (t as any).assignees = map.get(t.id) || [];
    }
    return tasks;
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
      const isPm = task.project
        ? await this.hasPmPowersOnProject(viewer.id, viewer.role, task.projectId)
        : (viewer.role ? PM_ROLES.includes(viewer.role as UserRole) : false);
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
   *  для comments/files/time-tracker IDOR-фильтров. */
  async assertCanAccessTask(taskId: string, viewer: { id: string; role?: string }): Promise<void> {
    if (viewer.role && PM_ROLES.includes(viewer.role as UserRole)) return;
    const task = await this.repo.findOne({
      where: { id: taskId },
      relations: ['project', 'project.members'],
      select: { id: true, assigneeId: true, createdById: true, projectId: true } as any,
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assigneeId === viewer.id) return;
    if (task.createdById === viewer.id) return;
    const coAssignees = await this.assigneesRepo.find({ where: { taskId, userId: viewer.id } });
    if (coAssignees.length > 0) return;
    if (task.project?.managerId === viewer.id) return;
    if ((task.project?.members || []).some((m: any) => m.id === viewer.id)) return;
    throw new ForbiddenException('Нет доступа к этой задаче');
  }

  async create(dto: CreateTaskDto, userId: string, userRole?: string) {
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

    // МП по продажам может прикреплять задачу только к проекту своего
    // направления — findOne бросит 403, если проект чужого сегмента.
    if (dto.projectId && isSalesManager(userRole)) {
      await this.projectsService.findOne(dto.projectId, userRole);
    }

    const scope = (dto as any).scope as 'personal' | 'business' | 'general' | undefined;
    const isPersonal = scope === 'personal';
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
    for (const aid of notifyIds) {
      try {
        const assignee = await this.userRepo.findOne({ where: { id: aid } });
        // Если задача назначена основателю/со-основателю не им самим — это
        // отдельный важный кейс. Хотим, чтобы он чётко знал: «У вас задача
        // от <имя сотрудника>» по всем трём каналам с одинаковым tone.
        const toFounder = !!assignee && [UserRole.FOUNDER, UserRole.CO_FOUNDER].includes(assignee.role as UserRole);

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
          const full = await this.findOne(saved.id);
          const deadline = saved.deadline ? new Date(saved.deadline).toLocaleDateString('ru-RU') : undefined;
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
            `📋 ${saved.title}` +
            (isGeneral && isFromFounder
              ? `\n👥 Для всей команды`
              : isFromFounder
                ? `\n👤 От: ${creator?.name || 'Основатель'}`
                : toFounder
                  ? `\n👤 От: ${creator?.name || 'Сотрудник'}`
                  : (full.project?.name ? `\n📁 ${full.project.name}` : '')) +
            (saved.priority ? `\n🔥 Приоритет: ${priorityLabels[saved.priority] || saved.priority}` : '') +
            (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/tasks/${saved.id}`,
            botButtons,
          );
        }
      } catch (e: any) {
        console.warn('notify failed for', aid, e?.message);
      }
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
    this.gateway.broadcast('tasks:changed', { projectId: dto.projectId });
    return this.findOne(saved.id);
  }

  /** Inline-кнопки управления статусом задачи в Telegram. */
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

    // Workers can only update tasks assigned to them OR created by them
    // (МП по продажам создаёт задачи в календаре — должен их редактировать).
    // Исключение: если пользователь — реальный менеджер проекта задачи,
    // он имеет PM-полномочия и может редактировать любую задачу в нём.
    const isPmHere = await this.hasPmPowersOnProject(user.id, user.role, task.projectId);
    if (
      !isPmHere &&
      WORKER_ROLES.includes(user.role as UserRole) &&
      task.assigneeId !== user.id &&
      task.createdById !== user.id
    ) {
      throw new ForbiddenException('Not allowed');
    }

    // SCOPE менять может ТОЛЬКО основатель/сооснователь (это их фича
    // редактирования типа задачи). Для остальных ролей попытка смены
    // scope тихо игнорируется — поле убирается из dto, без 403.
    // Смена scope НЕ рассылает ретроспективных уведомлений.
    if ((dto as any).scope && (dto as any).scope !== task.scope) {
      const canChangeScope =
        user.role === 'founder' ||
        user.role === 'co_founder' ||
        isSalesManager(user.role);
      if (!canChangeScope) {
        delete (dto as any).scope;
      }
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
    // at least one result file/note. SMM-специалист и автор-исполнитель
    // собственной задачи могут закрывать без файлов.
    if (
      dto.status === TaskStatus.DONE &&
      WORKER_ROLES.includes(user.role as UserRole) &&
      !isSmmSpecialist &&
      !isSelfCreated
    ) {
      const resultCount = await this.taskResultsService.countByTask(id);
      if (resultCount === 0) {
        throw new BadRequestException('Загрузите результат работы перед тем как отметить задачу выполненной');
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
    await this.repo.update(id, patchForRepo);
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
            `📋 ${task.title}\n` +
            `📊 Статус: <b>${statusLabel}</b>` +
            (user.name ? `\n👤 Изменил: ${user.name}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
          );
          const recipient = await this.userRepo.findOne({ where: { id: notifyId } });
          if (recipient?.email) {
            await this.mailService.sendGenericNotification(
              recipient.email, recipient.name || 'Сотрудник',
              `${isDone ? '✅' : '🔄'} ${isDone ? 'Задача выполнена' : 'Статус изменён'}: ${task.title}`,
              `Задача <strong>«${task.title}»</strong> изменила статус на <strong>${statusLabel}</strong>${user.name ? ` (изменил: ${user.name})` : ''}.<br><br>👉 Откройте задачу в системе, чтобы посмотреть детали.`,
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
          `📋 ${task.title}` +
          (full.project?.name ? `\n📁 ${full.project.name}` : '') +
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
    this.gateway.broadcast('tasks:changed', { projectId: task.projectId });
    return this.findOne(id);
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
    await this.repo.remove(task);
    await this.notificationsService.deleteByLink(`/tasks/${id}`);
    await this.projectsService.updateProgress(projectId);
    this.gateway.broadcast('tasks:changed', { projectId });
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
    const isPM = await this.hasPmPowersOnProject(user.id, user.role, task.projectId);
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
    await this.repo.remove(task);
    await this.notificationsService.deleteByLink(`/tasks/${id}`);
    await this.projectsService.updateProgress(projectId);
    this.gateway.broadcast('tasks:changed', { projectId });
    return { message: 'Task deleted' };
  }

  /** «Мои задачи» для сотрудника:
   *   - задачи где он assigneeId (legacy single-assignee)
   *   - задачи где он в task_assignees (multi-assignee workflow)
   *   - его личные заметки из календаря (scope=personal, createdById=я)
   *  Сортировка по дедлайну (NULL в конце). */
  async getMyTasks(userId: string) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoinAndSelect('t.project', 'project')
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

  getOverdueTasks(viewer?: { id: string; role: string }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoinAndSelect('t.project', 'project')
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
    // video_director видит только задачи СВОИХ проектов (где он manager
    // или member), а не всё подряд.
    const role = viewer?.role || '';
    const isSmmRole = ['smm_director', 'smm_specialist', 'storymaker'].includes(role);
    const isPm = role === 'video_director';
    if (isSmmRole) {
      qb.andWhere(`(t.scope <> 'personal' OR t.scope IS NULL)`);
      qb.andWhere(`(project."projectType" IS NULL OR project."projectType" = 'SMM')`);
    } else if (isPm && viewer?.id) {
      qb.andWhere(
        `(project."managerId" = :uid OR project.id IN (
          SELECT pm."projectsId" FROM project_members pm WHERE pm."usersId" = :uid
        ))`,
        { uid: viewer.id },
      );
    }
    // admin / founder / co_founder — без фильтров (видят всё).
    return qb.getMany();
  }

  async approveTask(id: string, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);
    const isPM = await this.hasPmPowersOnProject(user.id, user.role, task.projectId);
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
    this.gateway.broadcast('tasks:changed', { projectId: task.projectId });
    return this.findOne(id);
  }

  async returnTask(id: string, user: { id: string; role: string; name?: string }, reason: string) {
    const taskRaw = await this.repo
      .createQueryBuilder('t')
      .select(['t.id', 't.title', 't.status', 't.assigneeId', 't.projectId', 't.reworkCount'])
      .where('t.id = :id', { id })
      .getRawOne();
    if (!taskRaw) throw new NotFoundException('Task not found');
    const isPM = await this.hasPmPowersOnProject(user.id, user.role, taskRaw.t_projectId);
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
        `🔁 <b>Задача возвращена в работу</b>\n\n📋 ${taskTitle}\n💬 ${reason}\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
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
    this.gateway.broadcast('tasks:changed', { projectId });

    return { id, status: 'returned', returnReason: reason, title: taskTitle };
  }

  getStats(projectId?: string) {
    const qb = this.repo.createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status');
    if (projectId) qb.where('t.projectId = :projectId', { projectId });
    // КП-задачи не учитываются в общих счётчиках.
    qb.andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`);
    return qb.getRawMany();
  }

  async bulkAction(
    ids: string[],
    action: 'status' | 'delete' | 'assign',
    value: string | undefined,
    user: { id: string; role: string; name?: string },
  ): Promise<{ affected: number }> {
    if (!ids?.length) return { affected: 0 };
    if (!PM_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Массовые действия доступны только менеджерам');
    }

    if (action === 'delete') {
      // Wave 3: причина удаления обязательна и для bulk-операции.
      // Передаём её через `value` — для delete оно ранее не использовалось.
      const reason = (value ?? '').trim();
      if (!reason) {
        throw new BadRequestException('Укажите причину массового удаления задач');
      }
      const tasks = await this.repo.findByIds(ids);
      // Помечаем все задачи причиной перед удалением — чтобы reason
      // отразился в любых глобальных хуках/триггерах.
      for (const t of tasks) t.deletionReason = reason;
      if (tasks.length) await this.repo.save(tasks);
      await this.repo.remove(tasks);
      return { affected: tasks.length };
    }

    if (action === 'status' && value) {
      await this.repo.createQueryBuilder()
        .update(Task)
        .set({ status: value as TaskStatus })
        .whereInIds(ids)
        .execute();
      return { affected: ids.length };
    }

    if (action === 'assign' && value) {
      await this.repo.createQueryBuilder()
        .update(Task)
        .set({ assigneeId: value })
        .whereInIds(ids)
        .execute();
      return { affected: ids.length };
    }

    return { affected: 0 };
  }
}
