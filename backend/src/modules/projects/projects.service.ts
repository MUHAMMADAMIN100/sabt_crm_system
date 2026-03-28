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

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private repo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
  ) {}

  findAll(search?: string, status?: ProjectStatus, managerId?: string, archived = false) {
    const qb = this.repo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manager', 'manager')
      .leftJoinAndSelect('p.members', 'members')
      .leftJoinAndSelect('p.tasks', 'tasks')
      .where('p.isArchived = :archived', { archived });

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
      members: dto.memberIds?.map(id => ({ id })) as any,
    });
    const saved = await this.repo.save(project);

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
          await this.mailService.sendProjectAssigned(
            member.email,
            member.name,
            saved.name,
            `/projects/${saved.id}`,
            saved.description || undefined,
            saved.endDate ? new Date(saved.endDate).toLocaleDateString('ru-RU') : undefined,
            manager?.name || undefined,
          );
        }
      }
    }
    return saved;
  }

  async update(id: string, dto: UpdateProjectDto, user: any) {
    const project = await this.findOne(id);
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Not allowed');
    }

    if (dto.memberIds !== undefined) {
      project.members = dto.memberIds.map(id => ({ id })) as any;
    }

    Object.assign(project, {
      ...dto,
      members: project.members,
    });

    return this.repo.save(project);
  }

  async archive(id: string) {
    await this.repo.update(id, { isArchived: true, status: ProjectStatus.ARCHIVED });
    return this.findOne(id);
  }

  async restore(id: string) {
    await this.repo.update(id, { isArchived: false, status: ProjectStatus.COMPLETED });
    return this.findOne(id);
  }

  async remove(id: string) {
    const p = await this.findOne(id);
    await this.repo.remove(p);
    return { message: 'Project deleted' };
  }

  async updateProgress(id: string) {
    const project = await this.repo.findOne({ where: { id }, relations: ['tasks'] });
    if (!project || !project.tasks.length) return;

    // Weight per status: new=0%, in_progress=30%, review=70%, done=100%, cancelled=excluded
    const statusWeight: Record<string, number> = {
      new: 0,
      in_progress: 30,
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
