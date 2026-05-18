import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { getSalesSegment } from '../../common/sales-segment';

/** Прогресс задачи в % для отображения на карточке календаря.
 *  Приоритет: 1) доля выполненных подзадач (acceptanceCriteria),
 *  2) если подзадач нет — оценка по статусу. */
function computeTaskProgress(t: Task): number {
  const ac = (t as any).acceptanceCriteria;
  if (Array.isArray(ac) && ac.length > 0) {
    const done = ac.filter((c: any) => c?.done).length;
    return Math.round((done / ac.length) * 100);
  }
  switch (t.status) {
    case 'done':
    case 'approved':
    case 'published':
      return 100;
    case 'review':
    case 'on_pm_review':
    case 'on_client_approval':
      return 60;
    case 'in_progress':
    case 'accepted':
      return 30;
    case 'returned':
    case 'on_rework':
      return 20;
    default:
      return 0; // new / cancelled / rescheduled
  }
}

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
  ) {}

  async getEvents(
    from: string,
    to: string,
    employeeId?: string,
    projectId?: string,
    scope?: 'personal' | 'business' | 'general',
    viewerId?: string,
    viewerRole?: string,
  ) {
    if (from && to && new Date(from) > new Date(to)) {
      throw new BadRequestException('from date must be before to date');
    }
    const taskQb = this.taskRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.deadline IS NOT NULL')
      .andWhere(
        `(t.deadline >= :from AND COALESCE(t."startDate"::date, DATE(t."createdAt")) <= :to)`,
        { from, to },
      );

    if (employeeId) taskQb.andWhere('t.assigneeId = :employeeId', { employeeId });
    if (projectId) taskQb.andWhere('t.projectId = :projectId', { projectId });

    // Явный фильтр по scope (из UI: Личные / Бизнес / Общие)
    if (scope) {
      taskQb.andWhere('t.scope = :scope', { scope });
    }
    // Личные задачи приватны: всегда скрываем чужие PERSONAL.
    if (viewerId) {
      taskQb.andWhere(
        `(t.scope <> 'personal' OR t."createdById" = :viewerId)`,
        { viewerId },
      );
    }

    // Сегментация менеджеров продаж: МП видит только задачи проектов
    // своего направления. Задачи без проекта видны, если они созданы им,
    // назначены ему или это общие задачи (scope='general').
    const salesSegment = getSalesSegment(viewerRole);
    if (salesSegment) {
      taskQb.andWhere(
        `(project.projectType = :salesProjType
          OR (t.projectId IS NULL AND (
            t."createdById" = :salesViewerId
            OR t.assigneeId = :salesViewerId
            OR t.scope = 'general'
          )))`,
        { salesProjType: salesSegment.projectType, salesViewerId: viewerId ?? null },
      );
    }

    const projectQb = this.projectRepo
      .createQueryBuilder('p')
      .where('(p.startDate BETWEEN :from AND :to OR p.endDate BETWEEN :from AND :to)', { from, to })
      .andWhere('p.isArchived = false');

    if (projectId) projectQb.andWhere('p.id = :projectId', { projectId });
    // МП по продажам — старты/концы только проектов своего направления.
    if (salesSegment) {
      projectQb.andWhere('p.projectType = :salesProjType', {
        salesProjType: salesSegment.projectType,
      });
    }
    // Если фильтр по scope активен — не показываем старты/концы проектов
    // (они не относятся к scope задачи).
    const hideProjectEvents = !!scope;

    const [tasks, projects] = await Promise.all([taskQb.getMany(), projectQb.getMany()]);

    const taskEvents = tasks.map(t => ({
      id: `task-${t.id}`,
      taskId: t.id, // для drag-and-drop и быстрого редактирования из модалки
      title: t.title,
      description: t.description,
      date: t.deadline,
      startDate: t.startDate || new Date(t.createdAt).toISOString().split('T')[0],
      type: 'task',
      status: t.status,
      priority: t.priority,
      projectName: t.project?.name,
      assigneeName: t.assignee?.name,
      // Нужны на фронте для фильтра «мои задачи» у founder/co_founder
      // и для других персональных view.
      assigneeId: t.assigneeId,
      createdById: t.createdById,
      fromFounder: (t as any).fromFounder ?? false,
      scope: (t as any).scope ?? 'business',
      // Прогресс задачи в % — по подзадачам (acceptanceCriteria) если
      // они есть, иначе оценка по статусу. Показывается на карточке
      // задачи в календаре.
      progress: computeTaskProgress(t),
      link: `/tasks/${t.id}`,
    }));

    const projectStartEvents = hideProjectEvents ? [] : projects
      .filter(p => p.startDate)
      .map(p => ({
        id: `project-start-${p.id}`,
        title: `Старт: ${p.name}`,
        date: p.startDate,
        type: 'project_start',
        status: p.status,
        link: `/projects/${p.id}`,
      }));

    const projectEndEvents = hideProjectEvents ? [] : projects
      .filter(p => p.endDate)
      .map(p => ({
        id: `project-end-${p.id}`,
        title: `Завершение: ${p.name}`,
        date: p.endDate,
        type: 'project_end',
        status: p.status,
        link: `/projects/${p.id}`,
      }));

    return [...taskEvents, ...projectStartEvents, ...projectEndEvents].sort(
      (a, b) => new Date(a.date as unknown as string).getTime() - new Date(b.date as unknown as string).getTime(),
    );
  }
}
