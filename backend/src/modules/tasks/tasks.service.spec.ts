import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { Task, TaskStatus, TaskPriority } from './task.entity';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { MailService } from '../mail/mail.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { TelegramService } from '../telegram/telegram.service';
import { TaskAssignee } from './task-assignee.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Project } from '../projects/project.entity';
import { AppGateway } from '../gateway/app.gateway';
import { TaskResultsService } from '../task-results/task-results.service';

const mockTaskRepo = () => ({
  createQueryBuilder: jest.fn().mockReturnValue({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  // Удаление идёт в транзакции: отвязать отчёты, затем удалить задачу.
  manager: {
    transaction: jest.fn(async (cb: (trx: any) => unknown) => cb({ query: jest.fn(), remove: jest.fn() })),
  },
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  find: jest.fn(),
});

const mockUserRepo = () => ({
  findOne: jest.fn(),
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  description: null,
  projectId: 'project-1',
  project: null,
  assigneeId: 'user-1',
  assignee: null,
  createdById: 'admin-1',
  createdBy: null,
  priority: TaskPriority.MEDIUM,
  status: TaskStatus.NEW,
  deadline: null,
  estimatedHours: 0,
  loggedHours: 0,
  comments: [],
  timeLogs: [],
  files: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as Task);

describe('TasksService', () => {
  let service: TasksService;
  let taskRepo: ReturnType<typeof mockTaskRepo>;
  let notificationsService: { create: jest.Mock };
  let projectsService: { updateProgress: jest.Mock };
  let activityLog: { log: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useFactory: mockTaskRepo },
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: NotificationsService, useValue: {
          create: jest.fn().mockResolvedValue(undefined), deleteByLink: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: ProjectsService, useValue: { updateProgress: jest.fn().mockResolvedValue(undefined) } },
        { provide: MailService, useValue: { sendTaskAssigned: jest.fn().mockResolvedValue(undefined) } },
        { provide: ActivityLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: TelegramService, useValue: { sendToUser: jest.fn().mockResolvedValue(undefined), appUrl: 'http://localhost' } },
        // Зависимости, добавленные в сервис позже: соисполнители, отчёты,
        // проект, живые обновления и результаты задачи.
        { provide: getRepositoryToken(TaskAssignee), useValue: {
          find: jest.fn().mockResolvedValue([]), create: jest.fn((v) => v),
          save: jest.fn(async (v) => v), remove: jest.fn().mockResolvedValue(undefined),
          // «Соисполнитель ли он?» — по умолчанию нет.
          createQueryBuilder: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnThis(), getCount: jest.fn().mockResolvedValue(0),
          }),
        } },
        { provide: getRepositoryToken(DailyReport), useValue: { save: jest.fn(async (v) => v) } },
        { provide: getRepositoryToken(Project), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: AppGateway, useValue: { emitToAll: jest.fn(), emitToUser: jest.fn(), emitToUsers: jest.fn(), server: { emit: jest.fn() } } },
        { provide: TaskResultsService, useValue: { countByTask: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    taskRepo = module.get(getRepositoryToken(Task));
    notificationsService = module.get(NotificationsService);
    projectsService = module.get(ProjectsService);
    activityLog = module.get(ActivityLogService);
  });

  describe('findOne', () => {
    it('should return task when found', async () => {
      const task = makeTask();
      taskRepo.findOne.mockResolvedValue(task);

      const result = await service.findOne('task-1');
      expect(result).toEqual(task);
    });

    it('should throw NotFoundException when task not found', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const adminUser = { id: 'admin-1', role: UserRole.ADMIN, name: 'Admin' };
    const employeeUser = { id: 'user-1', role: UserRole.EMPLOYEE, name: 'Employee' };
    const otherEmployee = { id: 'other-user', role: UserRole.EMPLOYEE, name: 'Other' };

    it('should allow admin to update any task', async () => {
      const task = makeTask({ assigneeId: 'user-1' });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('task-1', { title: 'Updated' }, adminUser);

      expect(taskRepo.update).toHaveBeenCalledWith('task-1', { title: 'Updated' });
    });

    it('should allow employee to update their own task', async () => {
      const task = makeTask({ assigneeId: 'user-1' });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('task-1', { status: TaskStatus.IN_PROGRESS }, employeeUser);

      expect(taskRepo.update).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when employee tries to update another user\'s task', async () => {
      const task = makeTask({ assigneeId: 'user-1' });
      taskRepo.findOne.mockResolvedValue(task);

      await expect(
        service.update('task-1', { title: 'Hack' }, otherEmployee),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should send notification on status change', async () => {
      const task = makeTask({ assigneeId: 'user-1', createdById: 'admin-1', status: TaskStatus.NEW });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('task-1', { status: TaskStatus.DONE }, adminUser);

      expect(notificationsService.create).toHaveBeenCalled();
      expect(activityLog.log).toHaveBeenCalled();
    });
  });

  describe('removeWithAuth', () => {
    it('should require a deletion reason', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask());

      await expect(
        service.removeWithAuth('task-1', { id: 'admin-1', role: UserRole.ADMIN }, '  '),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('should allow admin to delete any task', async () => {
      const task = makeTask();
      taskRepo.findOne.mockResolvedValue(task);

      const result = await service.removeWithAuth('task-1', {
        id: 'admin-1', role: UserRole.ADMIN,
      }, 'дубль');

      expect(result).toEqual({ message: 'Task deleted' });
      expect(taskRepo.save).toHaveBeenCalledWith(expect.objectContaining({ deletionReason: 'дубль' }));
      expect(taskRepo.manager.transaction).toHaveBeenCalled();
      expect(projectsService.updateProgress).toHaveBeenCalledWith('project-1');
    });

    it('should throw ForbiddenException when employee tries to delete task not assigned to them', async () => {
      const task = makeTask({ assigneeId: 'other-user', createdById: 'another-user' });
      taskRepo.findOne.mockResolvedValue(task);

      await expect(
        service.removeWithAuth('task-1', { id: 'user-1', role: UserRole.EMPLOYEE }, 'не нужна'),
      ).rejects.toThrow(ForbiddenException);
      expect(taskRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('should allow employee to delete their own created task', async () => {
      const task = makeTask({ assigneeId: 'other', createdById: 'user-1' });
      taskRepo.findOne.mockResolvedValue(task);

      const result = await service.removeWithAuth('task-1', {
        id: 'user-1', role: UserRole.EMPLOYEE,
      }, 'создал по ошибке');

      expect(result).toEqual({ message: 'Task deleted' });
    });
  });

  describe('getStats', () => {
    it('should return tasks grouped by status', async () => {
      // Группировка — в SQL (GROUP BY status), задачи КП не считаются.
      const qb = taskRepo.createQueryBuilder();
      qb.getRawMany.mockResolvedValue([
        { status: TaskStatus.NEW, count: 2 },
        { status: TaskStatus.DONE, count: 1 },
      ]);

      const result = await service.getStats();
      expect(qb.groupBy).toHaveBeenCalledWith('t.status');
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('kp_creation'));

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: TaskStatus.NEW, count: 2 }),
          expect.objectContaining({ status: TaskStatus.DONE, count: 1 }),
        ]),
      );
    });
  });
});
