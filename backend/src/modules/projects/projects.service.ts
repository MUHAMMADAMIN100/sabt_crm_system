import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
import { ProjectPayment } from './payment.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UserRole, User } from '../users/user.entity';
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
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private gateway: AppGateway,
  ) {}

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
           AND CURRENT_DATE BETWEEN "startDate" AND "endDate"`,
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
    const saved = await this.repo.save(project);

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

    const saved = await this.repo.save(project);

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
