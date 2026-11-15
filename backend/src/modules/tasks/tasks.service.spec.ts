import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { Task, TaskStatus, TaskPriority, TaskScope } from './task.entity';
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
    // Массовые операции (UPDATE через QueryBuilder) и счётчики со скоупом.
    leftJoin: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
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
  let assigneesRepo: any;
  let projectRepo: any;

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
        { provide: getRepositoryToken(Project), useValue: {
          findOne: jest.fn().mockResolvedValue(null),
          // Участник проекта (project_members) — по умолчанию нет.
          manager: { query: jest.fn().mockResolvedValue([]) },
        } },
        { provide: AppGateway, useValue: { emitToAll: jest.fn(), emitToUser: jest.fn(), emitToUsers: jest.fn(), server: { emit: jest.fn() } } },
        { provide: TaskResultsService, useValue: { countByTask: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    taskRepo = module.get(getRepositoryToken(Task));
    notificationsService = module.get(NotificationsService);
    projectsService = module.get(ProjectsService);
    activityLog = module.get(ActivityLogService);
    assigneesRepo = module.get(getRepositoryToken(TaskAssignee));
    projectRepo = module.get(getRepositoryToken(Project));
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

  // 15.11.2026: без PM-полномочий правка ограничена — лишние поля тихо
  // отбрасываются, оценка качества — только approve/return.
  describe('update — что можно без PM-полномочий', () => {
    const employeeUser = { id: 'user-1', role: UserRole.EMPLOYEE, name: 'Employee' };

    it('исполнитель меняет только статус: срок, название и оценка отброшены', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask({ assigneeId: 'user-1', createdById: 'admin-1' }));
      await service.update('task-1', {
        status: TaskStatus.IN_PROGRESS, title: 'Hack', deadline: '2030-01-01T10:00:00Z', qualityScore: 10,
      } as any, employeeUser);
      expect(taskRepo.update).toHaveBeenCalledWith('task-1', { status: TaskStatus.IN_PROGRESS, completedAt: null });
    });

    it('исполнитель прислал только чужие поля — UPDATE не выполняется (без 403)', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask({ assigneeId: 'user-1', createdById: 'admin-1' }));
      await service.update('task-1', { title: 'Hack', assigneeIds: ['user-1', 'x'] } as any, employeeUser);
      expect(taskRepo.update).not.toHaveBeenCalled();
      expect(assigneesRepo.save).not.toHaveBeenCalled();
    });

    it('автор не двигает срок уже сданной задачи', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask({ assigneeId: 'other', createdById: 'user-1', status: TaskStatus.DONE }));
      await service.update('task-1', { title: 'Новое', deadline: '2030-01-01T10:00:00Z', acceptedOnFirstTry: true } as any, employeeUser);
      expect(taskRepo.update).toHaveBeenCalledWith('task-1', { title: 'Новое' });
    });

    it('со-исполнитель не закрывает задачу в обход очереди «Моя часть готова»', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask({ assigneeId: 'other', createdById: 'admin-1' }));
      assigneesRepo.createQueryBuilder().getCount.mockResolvedValueOnce(1);
      assigneesRepo.find.mockResolvedValue([
        { taskId: 'task-1', userId: 'other', position: 0, isDone: false, user: null },
        { taskId: 'task-1', userId: 'user-2', position: 1, isDone: false, user: null },
      ]);
      await expect(
        service.update('task-1', { status: TaskStatus.DONE }, { id: 'user-2', role: UserRole.EMPLOYEE }),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('МП не делает задачу «общей» через PATCH, а личной — может', async () => {
      const sm = { id: 'sm-1', role: UserRole.SALES_MANAGER_SMM, name: 'МП' };
      taskRepo.findOne.mockResolvedValue(makeTask({ assigneeId: 'sm-1', createdById: 'sm-1', scope: TaskScope.BUSINESS } as any));
      await service.update('task-1', { scope: TaskScope.GENERAL } as any, sm);
      expect(taskRepo.update).not.toHaveBeenCalled();
      await service.update('task-1', { scope: TaskScope.PERSONAL } as any, sm);
      expect(taskRepo.update).toHaveBeenCalledWith('task-1', { scope: TaskScope.PERSONAL });
    });

    it('разработчик — PM только в dev-проекте, где он участник', async () => {
      const dev = { id: 'dev-1', role: UserRole.DEVELOPER, name: 'Dev' };
      taskRepo.findOne.mockResolvedValue(makeTask({ assigneeId: 'other', createdById: 'pm' }));
      projectRepo.findOne.mockResolvedValue({ id: 'project-1', managerId: 'pm', projectType: 'Лендинг' });
      await expect(service.update('task-1', { title: 'X' }, dev)).rejects.toThrow(ForbiddenException);
      projectRepo.manager.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await service.update('task-1', { title: 'X' }, dev);
      expect(taskRepo.update).toHaveBeenCalledWith('task-1', { title: 'X' });
    });
  });

  // 15.11.2026: повтор недели падал с 500 (String(Date) → NaN), терял
  // соисполнителей и не видел задачи воскресенья.
  describe('repeatWeek', () => {
    it('копирует задачу на +7 дней с тем же временем и всей очередью исполнителей', async () => {
      const src = makeTask({ deadline: new Date('2026-11-15T13:00:00Z'), assigneeId: 'user-1' });
      taskRepo.find.mockResolvedValue([src]);
      taskRepo.findOne.mockResolvedValue(null);
      taskRepo.create.mockImplementation((v: any) => v);
      taskRepo.save.mockImplementation(async (v: any) => ({ ...v, id: 'copy-1' }));
      assigneesRepo.find
        .mockResolvedValueOnce([
          { taskId: 'task-1', userId: 'user-1', position: 0, isDone: true, user: null },
          { taskId: 'task-1', userId: 'user-2', position: 1, isDone: false, user: null },
        ])
        .mockResolvedValueOnce([]);

      const res = await service.repeatWeek('2026-11-16', 'admin-1');

      expect(res).toEqual({ week: '2026-11-16', created: 1, skipped: 0 });
      // Неделя — с начала понедельника до конца воскресенья по Душанбе.
      const range = (taskRepo.find.mock.calls[0][0] as any).where.deadline.value;
      expect(range.map((d: Date) => d.toISOString())).toEqual(['2026-11-08T19:00:00.000Z', '2026-11-15T18:59:59.999Z']);
      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        deadline: new Date('2026-11-22T13:00:00Z'), repeatedFromId: 'task-1', status: TaskStatus.NEW,
      }));
      expect(assigneesRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ taskId: 'copy-1', userId: 'user-1', position: 0, isDone: false }),
        expect.objectContaining({ taskId: 'copy-1', userId: 'user-2', position: 1, isDone: false }),
      ]);
    });

    it('копия на этот день уже есть — пропуск', async () => {
      taskRepo.find.mockResolvedValue([makeTask({ deadline: new Date('2026-11-10T05:00:00Z') })]);
      taskRepo.findOne.mockResolvedValue({ id: 'copy-0' });
      const res = await service.repeatWeek('2026-11-16', 'admin-1');
      expect(res).toMatchObject({ created: 0, skipped: 1 });
      expect(taskRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('bulkAction', () => {
    const admin = { id: 'admin-1', role: UserRole.ADMIN, name: 'Admin' };
    const ID = '00000000-0000-4000-8000-000000000001';

    it('статус — только один из четырёх', async () => {
      taskRepo.find.mockResolvedValue([makeTask({ id: ID })]);
      await expect(service.bulkAction([ID], 'status', 'review', admin)).rejects.toThrow(BadRequestException);
    });

    it('DONE ставит completedAt, как одиночная правка', async () => {
      taskRepo.find.mockResolvedValue([makeTask({ id: ID, status: TaskStatus.IN_PROGRESS })]);
      const res = await service.bulkAction([ID], 'status', TaskStatus.DONE, admin);
      expect(res).toEqual({ affected: 1 });
      expect(taskRepo.createQueryBuilder().set)
        .toHaveBeenCalledWith({ status: TaskStatus.DONE, completedAt: expect.any(Date) });
    });

    it('удаление — через отвязку отчётов в транзакции', async () => {
      taskRepo.find.mockResolvedValue([makeTask({ id: ID })]);
      const res = await service.bulkAction([ID], 'delete', 'дубли', admin);
      expect(res).toEqual({ affected: 1 });
      expect(taskRepo.manager.transaction).toHaveBeenCalled();
      expect(taskRepo.remove).not.toHaveBeenCalled();
    });

    it('мусорные id отбрасываются', async () => {
      expect(await service.bulkAction(['1; drop'], 'status', TaskStatus.DONE, admin)).toEqual({ affected: 0 });
      expect(taskRepo.find).not.toHaveBeenCalled();
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
