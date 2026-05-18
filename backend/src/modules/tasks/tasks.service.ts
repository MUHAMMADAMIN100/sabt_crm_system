import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task, TaskStatus, TaskPriority } from './task.entity';
import { TaskAssignee } from './task-assignee.entity';
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

const PM_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM];
const WORKER_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.MARKETER, UserRole.TARGETOLOGIST, UserRole.SALES_MANAGER, UserRole.EMPLOYEE];

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    @InjectRepository(TaskAssignee) private assigneesRepo: Repository<TaskAssignee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
    private notificationsService: NotificationsService,
    private projectsService: ProjectsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private gateway: AppGateway,
    private taskResultsService: TaskResultsService,
  ) {}

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
  private async syncAssignees(taskId: string, userIds: string[]): Promise<void> {
    const ordered = (userIds || []).filter(Boolean);
    const existing = await this.assigneesRepo.find({ where: { taskId } });
    const hasProgress = existing.some(r => r.isDone);

    // Если кто-то уже сдал — реordering запрещён. Молча игнорируем,
    // если новый список совпадает с существующим (по userId+order),
    // иначе бросаем 400.
    if (hasProgress) {
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

    // Авто-переход в REVIEW когда все готовы
    const inProgressLike: TaskStatus[] = [
      TaskStatus.NEW, TaskStatus.IN_PROGRESS, TaskStatus.ACCEPTED,
      TaskStatus.RETURNED, TaskStatus.ON_REWORK,
    ];
    if (allDone && inProgressLike.includes(task.status)) {
      const isSmm = user.role === UserRole.SMM_SPECIALIST;
      const newStatus = isSmm ? TaskStatus.DONE : TaskStatus.REVIEW;
      await this.repo.update(taskId, { status: newStatus });

      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_STATUS,
        entity: 'task',
        entityId: taskId,
        entityName: task.title,
        details: { from: task.status, to: newStatus, reason: 'all_assignees_done' },
      }).catch(() => {});

      if (newStatus === TaskStatus.DONE) {
        await this.autoReportFromTask({ ...task, status: newStatus } as Task);
      }
      if (task.createdById) {
        this.notificationsService.create({
          userId: task.createdById,
          type: NotificationType.REVIEW_NEEDED,
          title: '🎯 Задача готова к проверке',
          message: `Все этапы завершены в задаче "${task.title}". Нужна ваша проверка.`,
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
  }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoinAndSelect('t.project', 'project');

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

    const tasks = await qb.orderBy('t.createdAt', 'DESC').getMany();
    if (tasks.length > 0) {
      const map = await this.loadAssignees(tasks.map(t => t.id));
      for (const t of tasks) (t as any).assignees = map.get(t.id) || [];
    }
    return tasks;
  }

  async findOne(id: string) {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'createdBy', 'project', 'comments', 'comments.author', 'timeLogs', 'files'],
    });
    if (!task) throw new NotFoundException('Task not found');
    const map = await this.loadAssignees([id]);
    (task as any).assignees = map.get(id) || [];
    return task;
  }

  async create(dto: CreateTaskDto, userId: string, userRole?: string) {
    // Workers (non-PM) can only create tasks assigned to themselves
    const isPM = userRole && PM_ROLES.includes(userRole as UserRole);
    if (!isPM) {
      dto.assigneeId = userId;
      // Multi-assignee тоже ограничиваем — только сам себе
      (dto as any).assigneeIds = [userId];
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
        await this.notificationsService.create({
          userId: aid,
          type: NotificationType.NEW_TASK,
          title: isGeneral && isFromFounder
            ? '👑 Общая задача от основателя'
            : isFromFounder ? '👑 Задача от основателя' : 'Новая задача',
          message: isGeneral && isFromFounder
            ? `${creator?.name || 'Основатель'} поставил задачу всей команде: "${saved.title}"`
            : isFromFounder
              ? `${creator?.name || 'Основатель'} назначил вам прямую задачу: "${saved.title}"`
              : `Вам назначена задача: "${saved.title}"${totalSteps > 1 ? ` (этап 1 из ${totalSteps})` : ''}`,
          link: `/tasks/${saved.id}`,
        });
        const assignee = await this.userRepo.findOne({ where: { id: aid } });
        if (assignee?.email) {
          const full = await this.findOne(saved.id);
          const deadline = saved.deadline ? new Date(saved.deadline).toLocaleDateString('ru-RU') : undefined;
          const titleForMail = isGeneral && isFromFounder
            ? `👑 Общая задача от основателя (${creator?.name || ''}): ${saved.title}`
            : isFromFounder
              ? `👑 От основателя (${creator?.name || ''}): ${saved.title}`
              : saved.title;
          await this.mailService.sendTaskAssigned(
            assignee.email, assignee.name, titleForMail, saved.id,
            isGeneral && isFromFounder
              ? 'Общая задача от основателя — для всей команды'
              : isFromFounder ? 'Прямая задача от основателя' : full.project?.name,
            deadline, saved.priority, saved.description || undefined,
          );
          const priorityLabels: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный', critical: 'Критический' };
          await this.telegramService.sendToUser(
            aid,
            (isGeneral && isFromFounder
              ? `👑 <b>Общая задача от основателя</b>\n\n`
              : isFromFounder
                ? `👑 <b>Задача от основателя</b>\n\n`
                : `✅ <b>Вам назначена задача</b>\n\n`) +
            `📋 ${saved.title}` +
            (isGeneral && isFromFounder
              ? `\n👥 Для всей команды`
              : isFromFounder
                ? `\n👤 От: ${creator?.name || 'Основатель'}`
                : (full.project?.name ? `\n📁 ${full.project.name}` : '')) +
            (saved.priority ? `\n🔥 Приоритет: ${priorityLabels[saved.priority] || saved.priority}` : '') +
            (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/tasks/${saved.id}`,
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

  async update(id: string, dto: UpdateTaskDto, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);

    // Workers can only update their own tasks
    if (WORKER_ROLES.includes(user.role as UserRole) && task.assigneeId !== user.id) {
      throw new ForbiddenException('Not allowed');
    }

    // SCOPE менять может ТОЛЬКО основатель/сооснователь (это их фича
    // редактирования типа задачи). Для остальных ролей попытка смены
    // scope тихо игнорируется — поле убирается из dto, без 403.
    // Смена scope НЕ рассылает ретроспективных уведомлений.
    if ((dto as any).scope && (dto as any).scope !== task.scope) {
      if (user.role !== 'founder' && user.role !== 'co_founder') {
        delete (dto as any).scope;
      }
    }

    // SMM specialists have full status control over their own tasks
    const isSmmSpecialist = user.role === UserRole.SMM_SPECIALIST;

    // Workers (except SMM) cannot directly set status to DONE — must go through review
    if (WORKER_ROLES.includes(user.role as UserRole) && !isSmmSpecialist && dto.status === TaskStatus.DONE) {
      throw new ForbiddenException('Only a project manager can confirm task completion');
    }

    // Require at least one result before sending to review (workers only, except SMM)
    if (dto.status === TaskStatus.REVIEW && WORKER_ROLES.includes(user.role as UserRole) && !isSmmSpecialist) {
      const resultCount = await this.taskResultsService.countByTask(id);
      if (resultCount === 0) {
        throw new BadRequestException('Загрузите результат работы перед отправкой на проверку');
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
      await this.syncAssignees(id, incomingAssigneeIds || []);
    }

    // Notify on status change
    if (dto.status && dto.status !== oldStatus) {
      // Auto-generate daily report when a task becomes DONE
      if (dto.status === TaskStatus.DONE) {
        await this.autoReportFromTask({ ...task, ...dto } as Task);
      }
      const notifyId = task.createdById !== user.id ? task.createdById : task.assigneeId;
      if (notifyId) {
        await this.notificationsService.create({
          userId: notifyId,
          type: NotificationType.STATUS_CHANGE,
          title: 'Статус задачи изменён',
          message: `Задача "${task.title}" изменила статус на "${dto.status}"`,
          link: `/tasks/${id}`,
        });
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

    // Notify on new assignee
    if (dto.assigneeId && dto.assigneeId !== oldAssigneeId) {
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
    // Workers (any non-PM role) can only delete their own tasks (assigned to them or created by them)
    const isPM = PM_ROLES.includes(user.role as UserRole);
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

  getMyTasks(userId: string) {
    return this.repo.find({
      where: { assigneeId: userId },
      relations: ['project', 'createdBy'],
      order: { deadline: 'ASC' },
    });
  }

  getOverdueTasks() {
    return this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.deadline < NOW()')
      .andWhere('t.status NOT IN (:...statuses)', { statuses: [TaskStatus.DONE, TaskStatus.CANCELLED] })
      .getMany();
  }

  async approveTask(id: string, user: { id: string; role: string; name?: string }) {
    if (!PM_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only project managers can approve tasks');
    }
    const task = await this.findOne(id);
    if (task.status !== TaskStatus.REVIEW) {
      throw new BadRequestException('Задача должна быть на проверке');
    }

    await this.repo.update(id, {
      status: TaskStatus.DONE,
      reviewedById: user.id,
      reviewedAt: new Date(),
    });

    if (task.assigneeId) {
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
    if (!PM_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only project managers can return tasks');
    }

    const taskRaw = await this.repo
      .createQueryBuilder('t')
      .select(['t.id', 't.title', 't.status', 't.assigneeId', 't.projectId', 't.reworkCount'])
      .where('t.id = :id', { id })
      .getRawOne();
    if (!taskRaw) throw new NotFoundException('Task not found');
    if (taskRaw.t_status !== TaskStatus.REVIEW) {
      throw new BadRequestException('Задача должна быть на проверке');
    }

    // Wave 3+6: инкрементируем счётчик возвратов, обновляем acceptedOnFirstTry.
    const newReworkCount = (Number(taskRaw.t_reworkCount) || 0) + 1;
    await this.repo.update(id, {
      status: TaskStatus.RETURNED,
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
