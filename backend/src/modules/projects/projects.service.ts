import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Project, ProjectStatus, ProjectBillingType, ProjectPaymentStatus } from './project.entity';
import { ProjectPayment } from './payment.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UserRole, User } from '../users/user.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { ContentPlanService } from '../content-plan/content-plan.service';
import { ContentItemType, ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { Task, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { Team } from '../teams/team.entity';
import {
  LAUNCH_KEYS, MANUAL_LAUNCH_KEYS, LAUNCH_LABELS,
  computeLaunchState, LaunchState, LaunchSignals,
} from './launch-checklist.helper';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TelegramService } from '../telegram/telegram.service';
import { AppGateway } from '../gateway/app.gateway';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private repo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(ProjectPayment) private paymentRepo: Repository<ProjectPayment>,
    @InjectRepository(SmmTariff) private tariffRepo: Repository<SmmTariff>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Team) private teamRepo: Repository<Team>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private gateway: AppGateway,
    private contentPlanService: ContentPlanService,
  ) {}

  /** Заполняет проект полями из выбранного тарифа (snapshot имени и цены).
   *  Не перезаписывает уже заданные monthlyFee / billingType — клиент мог
   *  указать индивидуальную скидку. Используется в create() и при смене
   *  tariffId в update(). */
  private async applyTariffSnapshot(
    target: Partial<Project>,
    tariffId: string,
  ): Promise<void> {
    const tariff = await this.tariffRepo.findOne({ where: { id: tariffId } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    target.tariffId = tariff.id;
    target.tariffNameSnapshot = tariff.name;
    target.tariffPriceSnapshot = tariff.monthlyPrice;
    if (target.monthlyFee == null) target.monthlyFee = tariff.monthlyPrice;
    if (target.billingType == null) target.billingType = ProjectBillingType.MONTHLY;
  }

  // ─── Wave 7: Launch Setup checklist ──────────────────────────────────

  /** Собирает сигналы из БД для расчёта состояния чеклиста. */
  private async collectLaunchSignals(projectId: string, project: Project): Promise<LaunchSignals> {
    // 1) есть ли в команде SMM-специалист или head_smm
    const smmRows: Array<{ cnt: string }> = await this.repo.manager.query(
      `SELECT COUNT(*) AS cnt
       FROM project_members pm
       JOIN users u ON u.id = pm."usersId"
       WHERE pm."projectsId" = $1
         AND u.role IN ('smm_specialist','head_smm')`,
      [projectId],
    );
    const hasSmmMember = Number(smmRows?.[0]?.cnt || 0) > 0;

    // 2) общее число позиций контент-плана и сколько в первую неделю
    //    (от startBillingDate или createdAt)
    const start = project.startBillingDate
      ? new Date(project.startBillingDate)
      : new Date(project.createdAt || Date.now());
    const weekEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    const cpiRows: Array<{ total: string; firstWeek: string }> = await this.repo.manager.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN "publishDate" BETWEEN $2 AND $3 THEN 1 ELSE 0 END) AS "firstWeek"
       FROM content_plan_items
       WHERE "projectId" = $1`,
      [projectId, start.toISOString(), weekEnd.toISOString()],
    );

    // 3) число задач
    const taskRows: Array<{ cnt: string }> = await this.repo.manager.query(
      `SELECT COUNT(*) AS cnt FROM tasks WHERE "projectId" = $1`,
      [projectId],
    );

    return {
      hasSmmMember,
      contentPlanCount: Number(cpiRows?.[0]?.total || 0),
      contentPlanFirstWeekCount: Number(cpiRows?.[0]?.firstWeek || 0),
      taskCount: Number(taskRows?.[0]?.cnt || 0),
    };
  }

  /** Возвращает текущее состояние launch-чеклиста проекта. */
  async getLaunchChecklist(projectId: string): Promise<LaunchState> {
    const project = await this.findOne(projectId);
    const signals = await this.collectLaunchSignals(projectId, project);
    return computeLaunchState(project, signals);
  }

  /** Переключает ручной пункт чеклиста (materials_received / accesses_received). */
  async setManualLaunchItem(projectId: string, itemKey: string, value: boolean): Promise<LaunchState> {
    if (!MANUAL_LAUNCH_KEYS.includes(itemKey)) {
      throw new ForbiddenException(
        `Пункт "${itemKey}" вычисляется автоматически и не может быть переключён вручную`,
      );
    }
    const project = await this.findOne(projectId);
    const checklist = { ...(project.launchChecklist || {}) };
    checklist[itemKey] = !!value;
    await this.repo.update(projectId, { launchChecklist: checklist });
    this.gateway.broadcast('projects:changed', {});
    return this.getLaunchChecklist(projectId);
  }

  // ─── Wave 13: автопересчёт финансовых полей ─────────────────────────

  /** Список финансовых полей, изменять которые могут только founder/co_founder. */
  private readonly FINANCE_FIELDS = [
    'totalContractValue',
    'outstandingAmount',
    'internalCostEstimate',
    'marginEstimate',
    'tariffLimitOveruseCost',
    // paidAmount гвардится отдельно ниже (исторически был раньше)
  ] as const;

  /** Пересчитывает производные финансовые поля:
   *  - outstandingAmount = totalContractValue − paidAmount
   *  - marginEstimate    = totalContractValue − internalCostEstimate
   *  - tariffLimitOveruseCost — best-effort оценка по перерасходу * unit price
   *
   *  Не перезаписывает явно переданные значения если они отличаются от
   *  пересчёта (manual override имеет приоритет). */
  private async recomputeFinancials(
    target: Partial<Project>,
    existing: Partial<Project>,
    explicit: Set<string>,
  ): Promise<void> {
    const total = Number(
      target.totalContractValue ?? existing.totalContractValue ?? 0,
    );
    const paid = Number(target.paidAmount ?? existing.paidAmount ?? 0);
    const internalCost = Number(
      target.internalCostEstimate ?? existing.internalCostEstimate ?? 0,
    );

    if (!explicit.has('outstandingAmount') && total > 0) {
      target.outstandingAmount = Math.max(0, total - paid);
    }
    if (!explicit.has('marginEstimate') && total > 0) {
      target.marginEstimate = total - internalCost;
    }

    // Перерасход тарифа: считаем только если есть тариф и проект SMM.
    if (!explicit.has('tariffLimitOveruseCost')) {
      const tariffId = (target.tariffId ?? existing.tariffId) as string | undefined;
      const projectType = (target.projectType ?? existing.projectType) as string | undefined;
      const projectId = (existing.id ?? target.id) as string | undefined;
      if (tariffId && projectType === 'SMM' && projectId) {
        const tariff = await this.tariffRepo.findOne({ where: { id: tariffId } });
        if (tariff) {
          const totalPlanned =
            (tariff.storiesPerMonth || 0) +
            (tariff.reelsPerMonth || 0) +
            (tariff.postsPerMonth || 0) +
            (tariff.designsPerMonth || 0);
          if (totalPlanned > 0) {
            const unitPrice = Number(tariff.monthlyPrice || 0) / totalPlanned;
            const overuseRows: Array<{ overuse: string }> = await this.repo.manager.query(
              `SELECT GREATEST(0,
                 SUM(CASE WHEN c.status = 'published' THEN 1 ELSE 0 END)
                 - $2::int
               ) AS overuse
               FROM content_plan_items c
               WHERE c."projectId" = $1
               GROUP BY c."contentType"`,
              [projectId, 0],
            );
            // Грубая оценка: для каждого type считаем published > limit
            // но т.к. лимиты разные, делаем точнее ниже:
            let totalOveruseUnits = 0;
            const types: Array<[string, number]> = [
              ['story', tariff.storiesPerMonth || 0],
              ['reel', tariff.reelsPerMonth || 0],
              ['post', tariff.postsPerMonth || 0],
              ['design', tariff.designsPerMonth || 0],
            ];
            for (const [type, limit] of types) {
              if (limit <= 0) continue;
              const r: Array<{ cnt: string }> = await this.repo.manager.query(
                `SELECT COUNT(*) AS cnt FROM content_plan_items
                 WHERE "projectId" = $1 AND "contentType" = $2 AND status = 'published'`,
                [projectId, type],
              );
              const published = Number(r?.[0]?.cnt || 0);
              totalOveruseUnits += Math.max(0, published - limit);
            }
            target.tariffLimitOveruseCost = Math.round(totalOveruseUnits * unitPrice * 100) / 100;
            void overuseRows; // подавляем unused
          }
        }
      }
    }
  }

  /** Авто-генерация шаблонного контент-плана из тарифа.
   *  Запускается ОДИН раз для проекта (флаг isAutoGeneratedFromTariff).
   *  Раскладывает deliverables (stories/reels/posts/designs) равномерно
   *  по durationDays тарифа от startBillingDate (или от createdAt). */
  private async generateContentPlanFromTariff(project: Project): Promise<void> {
    if (!project.tariffId || project.isAutoGeneratedFromTariff) return;
    if (project.projectType !== 'SMM') return;

    const tariff = await this.tariffRepo.findOne({ where: { id: project.tariffId } });
    if (!tariff) return;

    const buckets: Array<{ type: ContentItemType; count: number; label: string }> = [
      { type: ContentItemType.STORY,  count: tariff.storiesPerMonth || 0, label: 'История' },
      { type: ContentItemType.REEL,   count: tariff.reelsPerMonth || 0,   label: 'Reels' },
      { type: ContentItemType.POST,   count: tariff.postsPerMonth || 0,   label: 'Пост' },
      { type: ContentItemType.DESIGN, count: tariff.designsPerMonth || 0, label: 'Дизайн' },
    ];

    const totalUnits = buckets.reduce((s, b) => s + b.count, 0);
    if (totalUnits === 0) return;

    const startDate = project.startBillingDate
      ? new Date(project.startBillingDate)
      : new Date(project.createdAt || Date.now());
    const durationMs = (tariff.durationDays || 30) * 24 * 60 * 60 * 1000;

    const items: Partial<ContentPlanItem>[] = [];
    for (const bucket of buckets) {
      if (bucket.count <= 0) continue;
      const stepMs = durationMs / bucket.count;
      for (let i = 0; i < bucket.count; i++) {
        const publishDate = new Date(startDate.getTime() + Math.round(stepMs * (i + 0.5)));
        const preparationDeadline = new Date(publishDate.getTime() - 24 * 60 * 60 * 1000);
        items.push({
          projectId: project.id,
          contentType: bucket.type,
          topic: `${bucket.label} #${i + 1}`,
          publishDate,
          preparationDeadline,
          pmId: project.managerId,
        });
      }
    }

    try {
      await this.contentPlanService.createMany(items);
      // Стартовые задачи запуска SMM-проекта (TZ п.2)
      await this.generateStarterTasksFromTariff(project, tariff);
      await this.repo.update(project.id, { isAutoGeneratedFromTariff: true });
    } catch (e: any) {
      // Авто-генерация не должна блокировать создание проекта.
      // eslint-disable-next-line no-console
      console.warn('content plan auto-generation failed:', e?.message);
    }
  }

  /** Wave 18: создаёт стартовый набор задач для нового SMM-проекта с тарифом.
   *  Это последняя необработанная часть TZ п.2 («автоматически создаётся
   *  стартовый набор задач»). Задачи назначаются на менеджера проекта. */
  private async generateStarterTasksFromTariff(
    project: Project,
    tariff: SmmTariff,
  ): Promise<void> {
    const start = project.startBillingDate
      ? new Date(project.startBillingDate)
      : new Date(project.createdAt || Date.now());
    const day = (n: number) => {
      const d = new Date(start);
      d.setDate(d.getDate() + n);
      return d;
    };

    const templates: Array<Partial<Task>> = [
      {
        title: 'Брифинг с клиентом и сбор материалов',
        description: 'Провести стартовую встречу, собрать референсы, бренд-материалы, фото/видео.',
        priority: TaskPriority.HIGH,
        deadline: day(2),
        estimatedHours: 2,
      },
      {
        title: 'Запросить и проверить доступы',
        description: 'Доступы к Instagram, TikTok, Facebook, рекламным кабинетам.',
        priority: TaskPriority.HIGH,
        deadline: day(3),
        estimatedHours: 1,
      },
      {
        title: 'Подготовить контент-стратегию на месяц',
        description: `Тариф "${tariff.name}": ${tariff.storiesPerMonth} stories, ${tariff.reelsPerMonth} reels, ${tariff.postsPerMonth} posts, ${tariff.designsPerMonth} дизайнов в месяц.`,
        priority: TaskPriority.HIGH,
        deadline: day(5),
        estimatedHours: 4,
      },
      {
        title: 'Согласовать контент-план с клиентом',
        description: 'Отправить план на согласование, собрать правки, утвердить.',
        priority: TaskPriority.MEDIUM,
        deadline: day(7),
        estimatedHours: 2,
      },
    ];

    if ((tariff.shootingDaysPerMonth || 0) > 0) {
      templates.push({
        title: 'Запланировать первую съёмку',
        description: `По тарифу полагается ${tariff.shootingDaysPerMonth} съёмочных дней в месяц.`,
        priority: TaskPriority.MEDIUM,
        deadline: day(10),
        estimatedHours: 1,
      });
    }

    if ((tariff.reportsPerMonth || 0) > 0) {
      templates.push({
        title: 'Подготовить шаблон ежемесячного отчёта',
        description: `Клиент ожидает ${tariff.reportsPerMonth} отчётов в месяц.`,
        priority: TaskPriority.LOW,
        deadline: day(14),
        estimatedHours: 1,
      });
    }

    const tasks = templates.map(t => this.taskRepo.create({
      ...t,
      projectId: project.id,
      assigneeId: project.managerId,
      createdById: project.managerId,
      status: TaskStatus.NEW,
      deliveryType: 'task',
    }));

    if (tasks.length === 0) return;

    try {
      await this.taskRepo.save(tasks);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('starter tasks generation failed:', e?.message);
    }
  }

  /** Remove actual money-paid field (paidAmount) from project(s) for users
   *  who shouldn't see it. Founder + sales_manager need to see paid amount
   *  to manage collections; everyone else gets it stripped.
   *  Budget, salesManager stay visible for regular managers too. */
  stripFinance<T extends Project | Project[]>(data: T, role?: string): T {
    if (role === 'founder' || role === 'co_founder' || role === 'sales_manager') return data;
    const strip = (p: any) => {
      if (!p) return p;
      delete p.paidAmount;
      return p;
    };
    return Array.isArray(data) ? (data.map(strip) as T) : (strip(data) as T);
  }

  async findAll(
    search?: string,
    status?: ProjectStatus,
    managerId?: string,
    archived = false,
    requestUser?: { id: string; role: string },
  ) {
    const qb = this.repo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manager', 'manager')
      .leftJoinAndSelect('p.members', 'members')
      .loadRelationCountAndMap('p.taskCount', 'p.tasks')
      .loadRelationCountAndMap('p.doneTaskCount', 'p.tasks', 'doneTask', qb =>
        qb.where('doneTask.status = :s', { s: 'done' }),
      )
      .where('p.isArchived = :archived', { archived });

    // RBAC: filter by role using SUBQUERY (not the joined members table)
    // so leftJoinAndSelect still loads ALL members in the result
    if (requestUser) {
      const { id: userId, role } = requestUser;
      if (role === 'project_manager') {
        qb.andWhere(
          `(p.managerId = :userId OR p.id IN (
            SELECT pm."projectsId" FROM project_members pm
            WHERE pm."usersId" = :userId
          ))`,
          { userId },
        );
      } else if (role === 'head_smm') {
        // head_smm owns SMM specifically — only see SMM projects they manage or
        // are members of. Non-SMM projects are not visible at all.
        qb.andWhere('p.projectType = :smmType', { smmType: 'SMM' });
        qb.andWhere(
          `(p.managerId = :userId OR p.id IN (
            SELECT pm."projectsId" FROM project_members pm
            WHERE pm."usersId" = :userId
          ))`,
          { userId },
        );
      } else if (!['admin', 'founder', 'co_founder', 'sales_manager'].includes(role)) {
        // All other roles see only projects they are members of
        qb.andWhere(
          `p.id IN (
            SELECT pm."projectsId" FROM project_members pm
            WHERE pm."usersId" = :userId
          )`,
          { userId },
        );
      }
      // admin, founder & sales_manager see all — no extra filter
    }

    if (status) qb.andWhere('p.status = :status', { status });
    if (managerId) qb.andWhere('p.managerId = :managerId', { managerId });
    if (search) qb.andWhere('p.name ILIKE :search', { search: `%${search}%` });

    const projects = await qb.orderBy('p.createdAt', 'DESC').getMany();

    // Annotate SMM projects with active-ad status. Today must fall inside
    // [startDate, endDate] of at least one ad for the project to be "live".
    const smmIds = projects.filter(p => p.projectType === 'SMM').map(p => p.id);
    let activeMap: Record<string, boolean> = {};
    if (smmIds.length > 0) {
      const rows = await this.repo.manager.query(
        `SELECT DISTINCT "projectId" FROM project_ads
         WHERE "projectId" = ANY($1::uuid[])
           AND NOW() BETWEEN "startDate" AND "endDate"`,
        [smmIds],
      );
      activeMap = Object.fromEntries((rows as Array<{ projectId: string }>).map(r => [r.projectId, true]));
    }
    for (const p of projects) {
      if (p.projectType === 'SMM') {
        (p as any).hasActiveAd = !!activeMap[p.id];
      }
    }

    return this.stripFinance(projects, requestUser?.role);
  }

  async findOne(id: string, requestUserRole?: string) {
    const project = await this.repo.findOne({
      where: { id },
      relations: ['manager', 'members', 'tasks', 'tasks.assignee', 'files'],
    });
    if (!project) throw new NotFoundException('Project not found');
    return requestUserRole ? this.stripFinance(project, requestUserRole) : project;
  }

  /** Guard: head_smm can only be manager of SMM projects. */
  private async validateManagerAssignment(managerId: string | undefined, projectType: string | undefined) {
    if (!managerId) return;
    const mgr = await this.userRepo.findOne({ where: { id: managerId } });
    if (!mgr) return;
    if (mgr.role === UserRole.HEAD_SMM && projectType !== 'SMM') {
      throw new ForbiddenException(
        'Главный SMM специалист может быть менеджером только SMM-проектов',
      );
    }
  }

  async create(dto: CreateProjectDto, userId: string, userRole?: string) {
    // head_smm can only create SMM projects
    if (userRole === UserRole.HEAD_SMM && dto.projectType !== 'SMM') {
      throw new ForbiddenException('Главный SMM специалист может создавать только SMM-проекты');
    }
    await this.validateManagerAssignment(dto.managerId, dto.projectType);
    const project = this.repo.create({
      ...dto,
      managerId: dto.managerId || userId,
      salesManagerId: dto.salesManagerId || undefined,
      members: dto.memberIds?.map(id => ({ id })) as unknown as User[],
    });
    // If a tariff was selected → snapshot its name+price into the project so
    // future tariff renames/deletions don't rewrite history.
    if (dto.tariffId) {
      await this.applyTariffSnapshot(project, dto.tariffId);
    }

    // Team — snapshot имени, чтобы переименование/удаление команды
    // не ломало карточку проекта.
    if (dto.teamId) {
      const team = await this.teamRepo.findOne({ where: { id: dto.teamId } });
      if (team) {
        project.teamId = team.id;
        project.teamNameSnapshot = team.name;
      }
    }

    // Wave 13: при создании пересчитываем outstanding/margin (overuse_cost
    // в этот момент 0 — контент-плана ещё нет).
    const explicitOnCreate = new Set<string>();
    for (const f of this.FINANCE_FIELDS) {
      if ((dto as any)[f] != null) explicitOnCreate.add(f);
    }
    await this.recomputeFinancials(project, project, explicitOnCreate);

    const saved = await this.repo.save(project);

    // Авто-генерация контент-плана для SMM-проекта с тарифом.
    // Best-effort — ошибка не должна валить создание проекта.
    await this.generateContentPlanFromTariff(saved);

    // Wave 6: алерт «SMM-проект создан без тарифа» — менеджеру проекта.
    if (saved.projectType === 'SMM' && !saved.tariffId && saved.managerId) {
      this.notificationsService.createIfNotRecent({
        userId: saved.managerId,
        type: NotificationType.PROJECT_NO_TARIFF,
        title: '⚠️ Проект без тарифа',
        message: `SMM-проект "${saved.name}" создан без выбранного тарифа. Привяжите тариф в настройках проекта.`,
        link: `/projects/${saved.id}`,
        data: { alertKey: `project-no-tariff:${saved.id}`, projectId: saved.id },
      }, 72).catch(() => {});
    }

    const creator = await this.userRepo.findOne({ where: { id: userId } });

    // Notify members (in-app + email)
    if (dto.memberIds?.length) {
      for (const memberId of dto.memberIds) {
        await this.notificationsService.create({
          userId: memberId,
          type: NotificationType.PROJECT_ASSIGNED,
          title: 'Вы добавлены в проект',
          message: `Вас добавили в проект "${saved.name}"`,
          link: `/projects/${saved.id}`,
        });
        // Send email notification with project details
        const member = await this.userRepo.findOne({ where: { id: memberId } });
        if (member?.email) {
          const manager = dto.managerId
            ? await this.userRepo.findOne({ where: { id: dto.managerId || userId } })
            : null;
          const deadline = saved.endDate ? new Date(saved.endDate).toLocaleDateString('ru-RU') : undefined;
          await this.mailService.sendProjectAssigned(
            member.email,
            member.name,
            saved.name,
            `/projects/${saved.id}`,
            saved.description || undefined,
            deadline,
            manager?.name || undefined,
          );
          await this.telegramService.sendToUser(
            memberId,
            `📁 <b>Вас добавили в проект</b>\n\n` +
            `📌 ${saved.name}` +
            (manager?.name ? `\n👤 Менеджер: ${manager.name}` : '') +
            (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/projects/${saved.id}`,
          );
        }
      }
    }

    await this.activityLog.log({
      userId,
      userName: creator?.name,
      action: ActivityAction.PROJECT_CREATE,
      entity: 'project',
      entityId: saved.id,
      entityName: saved.name,
      details: { memberIds: dto.memberIds, status: saved.status },
    });

    this.gateway.broadcast('projects:changed', {});
    return saved;
  }

  async update(id: string, dto: UpdateProjectDto, user: { id: string; role: string; name?: string }) {
    const project = await this.findOne(id);
    const canEdit = ['admin', 'founder', 'co_founder'].includes(user.role) ||
      ((user.role === 'project_manager' || user.role === 'head_smm') && project.managerId === user.id);
    if (!canEdit) {
      throw new ForbiddenException('Not allowed');
    }

    // Wave 7: блок перевода проекта в IN_PROGRESS пока launch-чеклист не закрыт.
    // Не применяется если проект уже в IN_PROGRESS — мы блокируем только переход.
    if (
      dto.status === ProjectStatus.IN_PROGRESS &&
      project.status !== ProjectStatus.IN_PROGRESS
    ) {
      const state = await this.getLaunchChecklist(id);
      if (!state.isComplete) {
        const missing = state.items.filter(i => !i.done).map(i => i.label).join(', ');
        throw new ForbiddenException(
          `Нельзя перевести проект в работу: не закрыты пункты launch-чеклиста — ${missing}`,
        );
      }
    }
    // Only founder can change paidAmount (actual money paid).
    // Other fields (budget, salesManager assignment, project manager) are
    // project-management concerns — admin/PM can edit.
    // If a non-founder submits paidAmount unchanged (form re-submit), silently
    // drop it instead of erroring. Reject only real changes.
    if ('paidAmount' in dto && !['founder', 'co_founder'].includes(user.role)) {
      const sameValue = Number(dto.paidAmount ?? 0) === Number(project.paidAmount ?? 0);
      if (!sameValue) {
        throw new ForbiddenException('Только основатель или сооснователь может изменять сумму оплаты');
      }
      delete (dto as any).paidAmount;
    }

    // Wave 13: финансовые поля могут менять только founder/co_founder.
    // Если не founder — молча отбрасываем поля с реальными изменениями.
    const isFinanceRole = ['founder', 'co_founder'].includes(user.role);
    if (!isFinanceRole) {
      for (const field of this.FINANCE_FIELDS) {
        if (field in dto) {
          const incoming = Number((dto as any)[field] ?? 0);
          const current = Number((project as any)[field] ?? 0);
          if (incoming !== current) {
            throw new ForbiddenException('Только основатель или сооснователь может изменять финансовые поля');
          }
          delete (dto as any)[field];
        }
      }
    }

    // Guard: head_smm may only manage SMM projects.
    // Considers both: assigning a new head_smm manager to non-SMM project,
    // and changing projectType of a project currently managed by head_smm.
    const nextManagerId = 'managerId' in dto ? dto.managerId : project.managerId;
    const nextType = 'projectType' in dto ? dto.projectType : project.projectType;
    await this.validateManagerAssignment(nextManagerId as string | undefined, nextType as string | undefined);

    // Track paidAmount change as a Payment record (delta-based)
    let paymentDelta: number | null = null;
    if ('paidAmount' in dto && ['founder', 'co_founder'].includes(user.role)) {
      const oldPaid = Number(project.paidAmount ?? 0);
      const newPaid = Number(dto.paidAmount ?? 0);
      if (newPaid !== oldPaid) {
        paymentDelta = newPaid - oldPaid;
      }
    }

    const oldMemberIds = project.members?.map(m => m.id) || [];
    const oldManagerId = project.managerId;
    const managerChanged = dto.managerId !== undefined && dto.managerId !== oldManagerId;

    // Tariff change handling: re-snapshot when tariffId changes,
    // wipe snapshot when tariff is detached.
    if ('tariffId' in dto && dto.tariffId !== project.tariffId) {
      if (dto.tariffId) {
        await this.applyTariffSnapshot(dto as unknown as Partial<Project>, dto.tariffId);
      } else {
        (dto as any).tariffNameSnapshot = null;
        (dto as any).tariffPriceSnapshot = null;
      }
    }

    // Team change — пересохраняем snapshot или обнуляем если отвязали.
    if ('teamId' in (dto as any) && (dto as any).teamId !== project.teamId) {
      if ((dto as any).teamId) {
        const team = await this.teamRepo.findOne({ where: { id: (dto as any).teamId } });
        if (team) (dto as any).teamNameSnapshot = team.name;
      } else {
        (dto as any).teamNameSnapshot = null;
      }
    }

    if (dto.memberIds !== undefined) {
      project.members = dto.memberIds.map(id => ({ id })) as unknown as User[];
    }

    // If managerId is being changed, clear the cached manager object
    // so TypeORM uses the new managerId instead of the stale relation
    if (managerChanged) {
      (project as any).manager = null;
      project.managerId = dto.managerId as any;
    }

    Object.assign(project, {
      ...dto,
      members: project.members,
    });

    // Wave 13: пересчёт финансов до save. Поля из dto имеют приоритет
    // (manual override), производные авто-перезаписываются если их явно
    // не передавали.
    const explicitOnUpdate = new Set<string>()
    for (const f of this.FINANCE_FIELDS) {
      if (f in dto) explicitOnUpdate.add(f)
    }
    if ('paidAmount' in dto || 'totalContractValue' in dto || 'internalCostEstimate' in dto || 'tariffId' in dto) {
      await this.recomputeFinancials(project, project, explicitOnUpdate)
    }

    const saved = await this.repo.save(project);

    // Если тариф только что привязан к SMM-проекту впервые (раньше его не было),
    // и контент-план ещё не сгенерирован — генерируем сейчас.
    // Флаг isAutoGeneratedFromTariff в самом методе предотвратит двойную генерацию.
    const tariffJustAttached = 'tariffId' in dto && dto.tariffId && saved.tariffId === dto.tariffId;
    if (tariffJustAttached && !saved.isAutoGeneratedFromTariff) {
      await this.generateContentPlanFromTariff(saved);
    }

    // Record payment delta if paidAmount changed
    if (paymentDelta !== null) {
      await this.paymentRepo.save(this.paymentRepo.create({
        projectId: saved.id,
        amount: paymentDelta,
        paidAt: new Date(),
        recordedById: user.id,
        note: paymentDelta > 0 ? 'Оплата получена' : 'Корректировка',
      }));
    }

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: dto,
    });

    const deadlineStr = saved.endDate ? new Date(saved.endDate).toLocaleDateString('ru-RU') : undefined;
    const projectLink = `/projects/${saved.id}`;

    // ── Manager change notifications ──────────────────────────────
    if (managerChanged) {
      // Notify NEW manager (if set)
      if (dto.managerId) {
        const newManager = await this.userRepo.findOne({ where: { id: dto.managerId } }).catch(() => null);
        if (newManager && newManager.id !== user.id) {
          try {
            await this.notificationsService.create({
              userId: newManager.id,
              type: NotificationType.MANAGER_ASSIGNED,
              title: '👑 Вы — менеджер проекта',
              message: `Вас назначили менеджером проекта "${saved.name}"`,
              link: projectLink,
              data: { projectId: saved.id, actorId: user.id, actorName: user.name },
            });
          } catch (e: any) { console.warn('manager-assigned in-app failed:', e?.message); }
          if (newManager.email) {
            await this.mailService
              .sendManagerAssigned(
                newManager.email, newManager.name, saved.name, saved.id,
                saved.description || undefined, deadlineStr, user.name,
              )
              .catch((e: any) => console.warn('manager-assigned mail failed:', e?.message));
          }
          await this.telegramService
            .sendToUser(
              newManager.id,
              `👑 <b>Вы — менеджер проекта</b>\n\n` +
              `📌 ${saved.name}\n` +
              (user.name ? `👤 Назначил: ${user.name}\n` : '') +
              (deadlineStr ? `📅 Дедлайн: ${deadlineStr}\n` : '') +
              `\n👉 ${this.telegramService.appUrl}${projectLink}`,
            )
            .catch((e: any) => console.warn('manager-assigned telegram failed:', e?.message));
        }
      }
      // Notify OLD manager (if they had one and still exist)
      if (oldManagerId && oldManagerId !== user.id) {
        const oldManager = await this.userRepo.findOne({ where: { id: oldManagerId } }).catch(() => null);
        if (oldManager) {
          try {
            await this.notificationsService.create({
              userId: oldManager.id,
              type: NotificationType.MANAGER_REMOVED,
              title: '📋 Смена менеджера проекта',
              message: `Вы больше не менеджер проекта "${saved.name}"`,
              link: projectLink,
              data: { projectId: saved.id, actorId: user.id, actorName: user.name },
            });
          } catch (e: any) { console.warn('manager-removed in-app failed:', e?.message); }
          if (oldManager.email) {
            await this.mailService
              .sendManagerRemoved(oldManager.email, oldManager.name, saved.name, saved.id, user.name)
              .catch((e: any) => console.warn('manager-removed mail failed:', e?.message));
          }
          await this.telegramService
            .sendToUser(
              oldManager.id,
              `📋 <b>Смена менеджера проекта</b>\n\n` +
              `Вы больше не менеджер проекта <b>${saved.name}</b>` +
              (user.name ? `\n\n👤 Изменение сделал: ${user.name}` : ''),
            )
            .catch((e: any) => console.warn('manager-removed telegram failed:', e?.message));
        }
      }
    }

    // ── Member add/remove notifications ───────────────────────────
    if (dto.memberIds !== undefined) {
      const newMemberIds = dto.memberIds.filter(mid => !oldMemberIds.includes(mid));
      const removedMemberIds = oldMemberIds.filter(mid => !dto.memberIds.includes(mid));

      for (const memberId of newMemberIds) {
        // Notifications are best-effort — never block the member-add itself.
        try {
          await this.activityLog.log({
            userId: user.id,
            userName: user.name,
            action: ActivityAction.MEMBER_ADD,
            entity: 'project',
            entityId: id,
            entityName: project.name,
            details: { memberId },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-add activity log failed:', e?.message);
        }

        if (memberId === user.id) continue;
        const member = await this.userRepo.findOne({ where: { id: memberId } }).catch(() => null);
        if (!member) continue;

        try {
          await this.notificationsService.create({
            userId: memberId,
            type: NotificationType.PROJECT_ASSIGNED,
            title: '👥 Вас добавили в проект',
            message: `Вас добавили в проект "${saved.name}"`,
            link: projectLink,
            data: { projectId: saved.id, actorId: user.id, actorName: user.name },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-add in-app notification failed:', e?.message);
        }
        if (member.email) {
          await this.mailService
            .sendProjectAssigned(
              member.email, member.name, saved.name, projectLink,
              saved.description || undefined, deadlineStr, user.name,
            )
            .catch((e: any) => console.warn('member-add mail failed:', e?.message));
        }
        await this.telegramService
          .sendToUser(
            memberId,
            `👥 <b>Вас добавили в проект</b>\n\n` +
            `📌 ${saved.name}` +
            (user.name ? `\n👤 Добавил: ${user.name}` : '') +
            (deadlineStr ? `\n📅 Дедлайн: ${deadlineStr}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}${projectLink}`,
          )
          .catch((e: any) => console.warn('member-add telegram failed:', e?.message));
      }

      for (const memberId of removedMemberIds) {
        // Notifications are best-effort — a failing email/telegram/enum-not-yet-
        // migrated-on-DB must not roll back the actual member removal.
        try {
          await this.activityLog.log({
            userId: user.id,
            userName: user.name,
            action: ActivityAction.MEMBER_REMOVE,
            entity: 'project',
            entityId: id,
            entityName: project.name,
            details: { memberId },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-remove activity log failed:', e?.message);
        }

        if (memberId === user.id) continue;
        const member = await this.userRepo.findOne({ where: { id: memberId } }).catch(() => null);
        if (!member) continue;

        try {
          await this.notificationsService.create({
            userId: memberId,
            type: NotificationType.MEMBER_REMOVED,
            title: '👥 Вас убрали из проекта',
            message: `Вас больше нет в составе проекта "${saved.name}"`,
            link: projectLink,
            data: { projectId: saved.id, actorId: user.id, actorName: user.name },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-remove in-app notification failed:', e?.message);
        }
        if (member.email) {
          await this.mailService
            .sendMemberRemoved(member.email, member.name, saved.name, user.name)
            .catch((e: any) => console.warn('member-remove mail failed:', e?.message));
        }
        await this.telegramService
          .sendToUser(
            memberId,
            `👥 <b>Вас убрали из проекта</b>\n\n` +
            `📌 ${saved.name}` +
            (user.name ? `\n👤 Изменение сделал: ${user.name}` : ''),
          )
          .catch((e: any) => console.warn('member-remove telegram failed:', e?.message));
      }
    }

    this.gateway.broadcast('projects:changed', {});
    // Return fresh project with relations loaded
    return this.findOne(id);
  }

  async archive(id: string) {
    const project = await this.findOne(id);
    await this.repo.update(id, { isArchived: true, status: ProjectStatus.ARCHIVED });
    await this.activityLog.log({
      action: ActivityAction.PROJECT_ARCHIVE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
    });
    this.gateway.broadcast('projects:changed', {});
    return this.findOne(id);
  }

  async restore(id: string) {
    const project = await this.findOne(id);
    await this.repo.update(id, { isArchived: false, status: ProjectStatus.COMPLETED });
    await this.activityLog.log({
      action: ActivityAction.PROJECT_RESTORE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
    });
    this.gateway.broadcast('projects:changed', {});
    return this.findOne(id);
  }

  async remove(id: string, user?: { id: string; role: string; name?: string }) {
    const p = await this.findOne(id);

    // Only admin and founder can delete projects. PM / head_smm manage
    // their projects but cannot remove them — deletion is an irreversible
    // operation that wipes tasks, files and activity, reserved for top roles.
    if (user && !['admin', 'founder', 'co_founder'].includes(user.role)) {
      throw new ForbiddenException('Удалять проекты могут только администратор, основатель и сооснователь');
    }

    await this.activityLog.log({
      userId: user?.id,
      userName: user?.name,
      action: ActivityAction.PROJECT_DELETE,
      entity: 'project',
      entityId: id,
      entityName: p.name,
    });
    await this.repo.remove(p);
    this.gateway.broadcast('projects:changed', {});
    return { message: 'Project deleted' };
  }

  async updateProgress(id: string) {
    const project = await this.repo.findOne({ where: { id }, relations: ['tasks'] });
    if (!project) return;

    // No tasks → progress = 0
    if (!project.tasks || !project.tasks.length) {
      if (project.progress !== 0) {
        project.progress = 0;
        await this.repo.save(project);
      }
      return;
    }

    // Weight per status: new=0%, in_progress=30%, returned=25%, review=70%, done=100%, cancelled=excluded
    const statusWeight: Record<string, number> = {
      new: 0,
      in_progress: 30,
      returned: 25,
      review: 70,
      done: 100,
    };

    const activeTasks = project.tasks.filter(t => t.status !== 'cancelled');
    if (!activeTasks.length) {
      project.progress = 0;
      return this.repo.save(project);
    }

    const totalWeight = activeTasks.reduce((sum, t) => sum + (statusWeight[t.status] ?? 0), 0);
    project.progress = Math.round(totalWeight / activeTasks.length);

    // Auto-update project status based on task completion
    const allDone = activeTasks.every(t => t.status === 'done');
    if (allDone && project.status !== ProjectStatus.ARCHIVED) {
      project.status = ProjectStatus.COMPLETED;
    } else if (!allDone && project.status === ProjectStatus.COMPLETED) {
      project.status = ProjectStatus.IN_PROGRESS;
    }

    return this.repo.save(project);
  }

  getStats() {
    return this.repo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('p.isArchived = false')
      .groupBy('p.status')
      .getRawMany();
  }

  /** Send a payment-request email to the project's client.
   *  Available to founder, admin and sales_manager. */
  async sendPaymentRequest(
    id: string,
    actor: { id: string; name?: string; role: string },
    customMessage?: string,
  ) {
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');

    const clientInfo = (project.clientInfo || {}) as any;
    const clientEmail: string | undefined = clientInfo.email;
    const clientName: string = clientInfo.contactPerson || clientInfo.name || 'Клиент';
    if (!clientEmail) {
      throw new ForbiddenException('У проекта не указан email клиента. Добавьте его во вкладке "О клиенте".');
    }

    const budget = Number(project.budget || 0);
    const paid = Number(project.paidAmount || 0);
    const remaining = Math.max(0, budget - paid);

    if (remaining <= 0) {
      throw new ForbiddenException('По этому проекту нет задолженности');
    }

    const ok = await this.mailService.sendPaymentRequestToClient(
      clientEmail,
      clientName,
      project.name,
      budget,
      paid,
      remaining,
      actor.name || 'Менеджер по продажам',
      customMessage,
    );

    await this.activityLog.log({
      userId: actor.id,
      userName: actor.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: { kind: 'payment_request_sent', to: clientEmail, remaining, byRole: actor.role },
    });

    return { sent: ok, to: clientEmail, remaining };
  }
}
