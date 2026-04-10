import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
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
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private gateway: AppGateway,
  ) {}

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

    // RBAC: filter by role
    if (requestUser) {
      const { id: userId, role } = requestUser;
      if (role === 'project_manager') {
        // PM sees only projects they manage or are members of
        qb.andWhere('(p.managerId = :userId OR members.id = :userId)', { userId });
      } else if (!['admin', 'founder'].includes(role)) {
        // All other roles (SMM, designer, etc.) see only projects they are members of
        qb.andWhere('members.id = :userId', { userId });
      }
      // admin & founder see all — no extra filter
    }

    if (status) qb.andWhere('p.status = :status', { status });
    if (managerId) qb.andWhere('p.managerId = :managerId', { managerId });
    if (search) qb.andWhere('p.name ILIKE :search', { search: `%${search}%` });

    return qb.orderBy('p.createdAt', 'DESC').getMany();
  }

  async findOne(id: string) {
    const project = await this.repo.findOne({
      where: { id },
      relations: ['manager', 'members', 'tasks', 'tasks.assignee', 'files'],
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async create(dto: CreateProjectDto, userId: string) {
    const project = this.repo.create({
      ...dto,
      managerId: dto.managerId || userId,
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
    const canEdit = ['admin', 'founder'].includes(user.role) ||
      (user.role === 'project_manager' && project.managerId === user.id);
    if (!canEdit) {
      throw new ForbiddenException('Not allowed');
    }

    const oldMemberIds = project.members?.map(m => m.id) || [];

    if (dto.memberIds !== undefined) {
      project.members = dto.memberIds.map(id => ({ id })) as unknown as User[];
    }

    // If managerId is being changed, clear the cached manager object
    // so TypeORM uses the new managerId instead of the stale relation
    if (dto.managerId !== undefined && dto.managerId !== project.managerId) {
      (project as any).manager = null;
      project.managerId = dto.managerId as any;
    }

    Object.assign(project, {
      ...dto,
      members: project.members,
    });

    const saved = await this.repo.save(project);

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: dto,
    });

    // Log member additions
    if (dto.memberIds !== undefined) {
      const newMemberIds = dto.memberIds.filter(mid => !oldMemberIds.includes(mid));
      for (const memberId of newMemberIds) {
        await this.activityLog.log({
          userId: user.id,
          userName: user.name,
          action: ActivityAction.MEMBER_ADD,
          entity: 'project',
          entityId: id,
          entityName: project.name,
          details: { memberId },
        });
      }
      const removedMemberIds = oldMemberIds.filter(mid => !dto.memberIds.includes(mid));
      for (const memberId of removedMemberIds) {
        await this.activityLog.log({
          userId: user.id,
          userName: user.name,
          action: ActivityAction.MEMBER_REMOVE,
          entity: 'project',
          entityId: id,
          entityName: project.name,
          details: { memberId },
        });
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

  async remove(id: string) {
    const p = await this.findOne(id);
    await this.activityLog.log({
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
    if (!project || !project.tasks.length) return;

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
}
