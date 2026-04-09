import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
  ) {}

  async getEvents(from: string, to: string, employeeId?: string, projectId?: string) {
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

    const projectQb = this.projectRepo
      .createQueryBuilder('p')
      .where('(p.startDate BETWEEN :from AND :to OR p.endDate BETWEEN :from AND :to)', { from, to })
      .andWhere('p.isArchived = false');

    if (projectId) projectQb.andWhere('p.id = :projectId', { projectId });

    const [tasks, projects] = await Promise.all([taskQb.getMany(), projectQb.getMany()]);

    const taskEvents = tasks.map(t => ({
      id: `task-${t.id}`,
      title: t.title,
      date: t.deadline,
      startDate: t.startDate || new Date(t.createdAt).toISOString().split('T')[0],
      type: 'task',
      status: t.status,
      priority: t.priority,
      projectName: t.project?.name,
      assigneeName: t.assignee?.name,
      link: `/tasks/${t.id}`,
    }));

    const projectStartEvents = projects
      .filter(p => p.startDate)
      .map(p => ({
        id: `project-start-${p.id}`,
        title: `Старт: ${p.name}`,
        date: p.startDate,
        type: 'project_start',
        status: p.status,
        link: `/projects/${p.id}`,
      }));

    const projectEndEvents = projects
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
