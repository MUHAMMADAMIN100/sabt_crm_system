import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DevTasksService } from './dev-tasks.service';
import { DevTask, DevTaskStatus, DevTaskPriority, DevTaskType } from './dev-task.entity';
import { DevTaskComment } from './dev-task-comment.entity';
import { DevTaskHistory } from './dev-task-history.entity';
import { DevSprint } from './dev-sprint.entity';
import { DevBoardView } from './dev-board-view.entity';
import { DevWebhookSubscription } from './dev-webhook-subscription.entity';
import { DevWebhookDelivery } from './dev-webhook-delivery.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AppGateway } from '../gateway/app.gateway';
import { Project } from '../projects/project.entity';

const mockTaskRepo = () => ({
  createQueryBuilder: jest.fn().mockReturnValue({
    andWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  }),
  findOne: jest.fn(),
  // findOne()/findAll() сервиса зовут find() для загрузки подзадач,
  // поэтому по умолчанию отдаём пустой массив, а не undefined.
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  delete: jest.fn(),
  // getPreview считает подзадачи через count — по умолчанию нули.
  count: jest.fn().mockResolvedValue(0),
});

const mockProjectRepo = () => ({
  findOne: jest.fn(),
});

const mockCommentRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  // findOne() сервиса грузит ленту комментариев отдельным запросом с take 500.
  find: jest.fn().mockResolvedValue([]),
});

const mockUserRepo = () => ({
  findOne: jest.fn(),
});

const mockHistoryRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
});

// Новые репозитории контрактов C–H: дефолты пустые, чтобы старые тесты
// (create/move/update/bulk) не ходили в сеть и не падали на DI.
const mockSprintRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
});

const mockViewRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockWebhookRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockDeliveryRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
});

const makeTask = (overrides: Partial<DevTask> = {}): DevTask => ({
  id: 'dev-task-1',
  title: 'Тестовая задача',
  description: null,
  status: DevTaskStatus.BACKLOG,
  priority: DevTaskPriority.MEDIUM,
  taskType: DevTaskType.FEATURE,
  position: 0,
  storyPoints: 0,
  tags: null,
  attachments: [],
  deadline: null,
  completedAt: null,
  // Контракты A/B/H: новые поля сущности (default'ы как в БД).
  startDate: null,
  isBlocked: false,
  blockedReason: null,
  sprintId: null,
  assigneeId: 'user-1',
  assignee: { id: 'user-1', name: 'Иван', avatar: 'ava.png' } as User,
  createdById: 'admin-1',
  createdBy: null,
  parent: null,
  parentTaskId: null,
  comments: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as DevTask);

describe('DevTasksService', () => {
  let service: DevTasksService;
  let taskRepo: ReturnType<typeof mockTaskRepo>;
  let commentRepo: ReturnType<typeof mockCommentRepo>;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let projectRepo: ReturnType<typeof mockProjectRepo>;
  let historyRepo: ReturnType<typeof mockHistoryRepo>;
  let sprintRepo: ReturnType<typeof mockSprintRepo>;
  let viewRepo: ReturnType<typeof mockViewRepo>;
  let webhookRepo: ReturnType<typeof mockWebhookRepo>;
  let deliveryRepo: ReturnType<typeof mockDeliveryRepo>;
  let notifications: { create: jest.Mock; createIfNotRecent: jest.Mock; deleteByLink: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevTasksService,
        { provide: getRepositoryToken(DevTask), useFactory: mockTaskRepo },
        { provide: getRepositoryToken(DevTaskComment), useFactory: mockCommentRepo },
        { provide: getRepositoryToken(DevTaskHistory), useFactory: mockHistoryRepo },
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(Project), useFactory: mockProjectRepo },
        { provide: getRepositoryToken(DevSprint), useFactory: mockSprintRepo },
        { provide: getRepositoryToken(DevBoardView), useFactory: mockViewRepo },
        { provide: getRepositoryToken(DevWebhookSubscription), useFactory: mockWebhookRepo },
        { provide: getRepositoryToken(DevWebhookDelivery), useFactory: mockDeliveryRepo },
        // Уведомления и сокет — моки: доска не должна зависеть от их реального
        // поведения в юнит-тестах сервиса.
        {
          provide: NotificationsService,
          useValue: {
            create: jest.fn().mockResolvedValue({}),
            createIfNotRecent: jest.fn().mockResolvedValue(true),
            deleteByLink: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AppGateway, useValue: { broadcast: jest.fn(), notifyUser: jest.fn() } },
      ],
    }).compile();

    service = module.get<DevTasksService>(DevTasksService);
    taskRepo = module.get(getRepositoryToken(DevTask));
    commentRepo = module.get(getRepositoryToken(DevTaskComment));
    userRepo = module.get(getRepositoryToken(User));
    projectRepo = module.get(getRepositoryToken(Project));
    historyRepo = module.get(getRepositoryToken(DevTaskHistory));
    notifications = module.get(NotificationsService);
    sprintRepo = module.get(getRepositoryToken(DevSprint));
    viewRepo = module.get(getRepositoryToken(DevBoardView));
    webhookRepo = module.get(getRepositoryToken(DevWebhookSubscription));
    deliveryRepo = module.get(getRepositoryToken(DevWebhookDelivery));
    // Outbox по умолчанию пуст: мутации в старых тестах не должны ходить в сеть.
    webhookRepo.find.mockResolvedValue([]);
    deliveryRepo.create.mockImplementation((dto: any) => dto);
    deliveryRepo.save.mockImplementation(async (e: any) => ({ id: 'del-1', ...e }));
    // Проверки assignee/projectType в create/update требуют найденных сущностей —
    // по умолчанию отдаём исполнителя и dev-проект, иначе все create с
    // assigneeId падают BadRequestException «Исполнитель не найден».
    userRepo.findOne.mockResolvedValue({ id: 'user-1', name: 'Иван' });
    projectRepo.findOne.mockResolvedValue({ id: 'proj-1', projectType: 'Web сайт' });
  });

  describe('create', () => {
    it('создаёт задачу с автором и возвращает её с eager-связями', async () => {
      const task = makeTask();
      taskRepo.create.mockReturnValue(task);
      taskRepo.save.mockResolvedValue(task);
      taskRepo.findOne.mockResolvedValue(task);

      const result = await service.create({ title: 'Тестовая задача' }, 'admin-1');

      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Тестовая задача', createdById: 'admin-1' }),
      );
      // toMatchObject, а не toEqual: findOne добавляет stats-поля и subtasks.
      expect(result).toMatchObject(task);
      expect(result).toMatchObject({ subtasksCount: 0, subtasksDone: 0, subtasks: [] });
    });

    it('создаёт подзадачу после успешной проверки родителя', async () => {
      // id родителя — валидный UUID: сервис отклоняет мусор формата 400-кой
      // до запроса (иначе Postgres дал бы 500 invalid input syntax for uuid).
      const PARENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const parent = makeTask({ id: PARENT, parentTaskId: null });
      const child = makeTask({ id: 'child-1', parentTaskId: PARENT });
      // 1-й findOne — валидация родителя, 2-й — перечитывание созданной задачи.
      taskRepo.findOne.mockResolvedValueOnce(parent).mockResolvedValueOnce(child);
      taskRepo.create.mockReturnValue(child);
      taskRepo.save.mockResolvedValue(child);
      taskRepo.find.mockResolvedValue([]);

      const result = await service.create(
        { title: 'Подзадача', parentTaskId: PARENT },
        'admin-1',
      );

      expect(taskRepo.findOne).toHaveBeenNthCalledWith(1, { where: { id: PARENT } });
      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentTaskId: PARENT }),
      );
      expect(result.id).toBe('child-1');
      expect(result).toMatchObject({ subtasksCount: 0, subtasksDone: 0 });
    });

    it('отклоняет создание подзадачи, если родитель не найден', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({ title: 'x', parentTaskId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(taskRepo.create).not.toHaveBeenCalled();
    });

    it('отклоняет создание подзадачи с мусорным id родителя (400, не 500)', async () => {
      await expect(
        service.create({ title: 'x', parentTaskId: 'missing' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.create).not.toHaveBeenCalled();
    });

    it('отклоняет создание подзадачи третьего уровня', async () => {
      // У родителя уже есть свой родитель — глубина стала бы 2.
      const PARENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const parent = makeTask({ id: PARENT, parentTaskId: 'grand-1' });
      taskRepo.findOne.mockResolvedValue(parent);

      await expect(
        service.create({ title: 'x', parentTaskId: PARENT }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
  });


  describe('findAll', () => {
    it('проставляет subtasksCount/subtasksDone по всем задачам', async () => {
      const parent = makeTask({ id: 'p1', position: 0 });
      const childDone = makeTask({
        id: 'c1', parentTaskId: 'p1', status: DevTaskStatus.DONE, position: 1,
      });
      const childTodo = makeTask({
        id: 'c2', parentTaskId: 'p1', status: DevTaskStatus.TODO, position: 2,
      });
      // createQueryBuilder возвращает один и тот же мок-объект на каждый вызов.
      taskRepo.createQueryBuilder().getMany.mockResolvedValue([parent, childDone, childTodo]);

      const result = await service.findAll();

      const p = result.find(t => t.id === 'p1');
      expect(p?.subtasksCount).toBe(2);
      expect(p?.subtasksDone).toBe(1);
      // сами подзадачи остаются без вложенных подзадач
      const c = result.find(t => t.id === 'c1');
      expect(c?.subtasksCount).toBe(0);
      expect(c?.subtasksDone).toBe(0);
    });

    it('для задач без подзадач ставит нули', async () => {
      const solo = makeTask({ id: 'solo-1' });
      taskRepo.createQueryBuilder().getMany.mockResolvedValue([solo]);

      const result = await service.findAll();

      expect(result[0]).toMatchObject({ subtasksCount: 0, subtasksDone: 0 });
    });

    it('фильтрует по тегам через overlap (ANY-совпадение)', async () => {
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);

      await service.findAll({ tags: ['frontend', 'urgent'] });

      expect(qb.andWhere).toHaveBeenCalledWith('task.tags && :tags', {
        tags: ['frontend', 'urgent'],
      });
    });

    it('игнорирует пустые/пробельные теги и не применяет фильтр', async () => {
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      (qb.andWhere as jest.Mock).mockClear();

      await service.findAll({ tags: ['  ', '', '   '] });

      const calls = (qb.andWhere as jest.Mock).mock.calls;
      expect(calls.some((c: any[]) => c[0] === 'task.tags && :tags')).toBe(false);
    });

    it('чистит теги (trim + уникальные) перед фильтром', async () => {
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      (qb.andWhere as jest.Mock).mockClear();

      await service.findAll({ tags: [' frontend ', 'frontend', 'urgent  '] });

      expect(qb.andWhere).toHaveBeenCalledWith('task.tags && :tags', {
        tags: ['frontend', 'urgent'],
      });
    });
  });

  describe('findOne', () => {
    it('возвращает задачу с комментариями и подзадачами', async () => {
      const task = makeTask({ id: 'p1' });
      const sub1 = makeTask({ id: 'c1', parentTaskId: 'p1', position: 0 });
      const sub2 = makeTask({
        id: 'c2', parentTaskId: 'p1', position: 1, status: DevTaskStatus.DONE,
      });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([sub1, sub2]);

      const result = await service.findOne('p1');

      expect(taskRepo.find).toHaveBeenCalledWith({
        where: { parentTaskId: 'p1' },
        order: { position: 'ASC' },
      });
      expect(result.subtasks).toHaveLength(2);
      expect(result.subtasksCount).toBe(2);
      expect(result.subtasksDone).toBe(1);
      // у подзадач своих подзадач нет — stats-поля нулевые
      expect(result.subtasks[0]).toMatchObject({ subtasksCount: 0, subtasksDone: 0 });
      expect(result.comments).toEqual([]);
    });
  });

  describe('update', () => {
    it('обновляет поля задачи', async () => {
      const task = makeTask();
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('dev-task-1', { title: 'Новое название' });

      expect(taskRepo.update).toHaveBeenCalledWith('dev-task-1', { title: 'Новое название' });
    });

    it('кидает NotFoundException для несуществующей задачи', async () => {
      taskRepo.findOne.mockResolvedValue(null);
      await expect(service.update('missing', { title: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('отклоняет попытку сделать задачу подзадачей самой себя', async () => {
      const task = makeTask({ id: 'dev-task-1' });
      taskRepo.findOne.mockResolvedValue(task);

      await expect(
        service.update('dev-task-1', { parentTaskId: 'dev-task-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('отклоняет смену родителя на задачу, у которой уже есть родитель', async () => {
      const PARENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const task = makeTask({ id: 'dev-task-1' });
      const parent = makeTask({ id: PARENT, parentTaskId: 'grand-1' });
      taskRepo.findOne.mockResolvedValueOnce(task).mockResolvedValueOnce(parent);

      await expect(
        service.update('dev-task-1', { parentTaskId: PARENT }),
      ).rejects.toThrow('Подзадачи третьего уровня не поддерживаются');
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('применяет смену родителя, если родитель верхнего уровня', async () => {
      const PARENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const task = makeTask({ id: 'dev-task-1' });
      const parent = makeTask({ id: PARENT, parentTaskId: null });
      taskRepo.findOne
        .mockResolvedValueOnce(task)   // проверка существования задачи
        .mockResolvedValueOnce(parent) // валидация родителя
        .mockResolvedValue(task);      // перечитывание после update
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('dev-task-1', { parentTaskId: PARENT });

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ parentTaskId: PARENT }),
      );
    });

    it('ставит completedAt при смене статуса на done через PATCH', async () => {
      const task = makeTask({ status: DevTaskStatus.IN_PROGRESS });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('dev-task-1', { status: DevTaskStatus.DONE });

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ status: DevTaskStatus.DONE, completedAt: expect.any(Date) }),
      );
    });
  });

  describe('move', () => {
    it('ставит completedAt при переходе в колонку done', async () => {
      const task = makeTask({ status: DevTaskStatus.TESTING });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.move('dev-task-1', DevTaskStatus.DONE, 0);

      const patch = taskRepo.update.mock.calls[0][1];
      expect(patch.status).toBe(DevTaskStatus.DONE);
      expect(patch.position).toBe(0);
      expect(patch.completedAt).toBeInstanceOf(Date);
    });

    it('сбрасывает completedAt при переоткрытии (выход из done)', async () => {
      const task = makeTask({ status: DevTaskStatus.DONE, completedAt: new Date() });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.move('dev-task-1', DevTaskStatus.IN_PROGRESS, 1);

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ status: DevTaskStatus.IN_PROGRESS, position: 1, completedAt: null }),
      );
    });

    it('не трогает completedAt при перемещении между обычными колонками', async () => {
      const task = makeTask({ status: DevTaskStatus.TODO });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.move('dev-task-1', DevTaskStatus.IN_PROGRESS, 2);

      const patch = taskRepo.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('completedAt');
    });
  });

  describe('addComment', () => {
    it('добавляет комментарий к задаче', async () => {
      const task = makeTask();
      const comment = { id: 'c-1', taskId: task.id, authorId: 'user-1', text: 'Привет' };
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.create.mockReturnValue(comment);
      commentRepo.save.mockResolvedValue(comment);

      const result = await service.addComment(task.id, 'user-1', 'Привет');

      expect(commentRepo.create).toHaveBeenCalledWith({ taskId: task.id, authorId: 'user-1', text: 'Привет' });
      expect(result).toMatchObject(comment);
      expect((result as any).mentions).toEqual([]);
    });
  });

  describe('getKpi', () => {
    it('считает onTimeRate и остальные метрики правильно', async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

      taskRepo.find.mockResolvedValue([
        // done в срок: дедлайн был вчера, закрыта позавчера
        makeTask({
          id: 't1', status: DevTaskStatus.DONE,
          deadline: dayAgo, completedAt: twoDaysAgo,
          createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        }),
        // done с опозданием: дедлайн был 2 дня назад, закрыта вчера
        makeTask({
          id: 't2', status: DevTaskStatus.DONE,
          deadline: twoDaysAgo, completedAt: dayAgo,
          createdAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        }),
        // просроченная в работе
        makeTask({ id: 't3', status: DevTaskStatus.IN_PROGRESS, deadline: dayAgo }),
        // непросроченная
        makeTask({ id: 't4', status: DevTaskStatus.TODO, deadline: inTwoDays }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.members).toHaveLength(1);
      const stats = kpi.members[0];
      expect(stats.assigneeId).toBe('user-1');
      expect(stats.name).toBe('Иван');
      expect(stats.avatarUrl).toBe('ava.png');
      expect(stats.total).toBe(4);
      expect(stats.done).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.overdue).toBe(1);
      expect(stats.doneOnTime).toBe(1);
      expect(stats.doneLate).toBe(1);
      expect(stats.onTimeRate).toBe(50); // 1 из 2 завершённых с дедлайном
      // цикл: (3 дня + 5 дней) / 2 = 4
      expect(stats.avgCycleDays).toBe(4);

      // общие итоги команды совпадают (все задачи одного исполнителя)
      expect(kpi.team.total).toBe(4);
      expect(kpi.team.onTimeRate).toBe(50);
    });

    it('возвращает onTimeRate=null, если нет завершённых задач с дедлайном', async () => {
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 't1', status: DevTaskStatus.DONE, deadline: null, completedAt: new Date() }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.members[0].onTimeRate).toBeNull();
      expect(kpi.members[0].done).toBe(1);
    });

    it('задачи без исполнителя не попадают в members, но учитываются в team', async () => {
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 't1', assigneeId: null, assignee: null }),
        makeTask({ id: 't2' }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.members).toHaveLength(1);
      expect(kpi.team.total).toBe(2);
    });
  });

  // ─── Уведомления, bulk, валидация комментариев ─────────────────────────

  describe('notifications', () => {
    it('уведомляет исполнителя при постановке задачи ему', async () => {
      // assigneeId — валидный UUID: сервис проверяет формат до запроса.
      const UID = '123e4567-e89b-12d3-a456-426614174001';
      const task = makeTask({ id: 'dev-task-1', assigneeId: UID });
      taskRepo.create.mockReturnValue(task);
      taskRepo.save.mockResolvedValue(task);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);

      await service.create({ title: 'Тестовая задача', assigneeId: UID } as any, 'admin-1');

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: UID, type: 'new_task' }),
      );
    });

    it('НЕ уведомляет, если задача поставлена самому себе', async () => {
      const SELF = '11111111-2222-3333-4444-555555555555';
      const task = makeTask({ id: 'dev-task-1', assigneeId: SELF });
      taskRepo.create.mockReturnValue(task);
      taskRepo.save.mockResolvedValue(task);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);

      await service.create({ title: 'Тестовая задача', assigneeId: SELF } as any, SELF);

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('уведомляет исполнителя при смене статуса чужой задачи (дедуп)', async () => {
      const task = makeTask({ id: 'dev-task-1', status: DevTaskStatus.TODO, assigneeId: 'user-1' });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue({});
      taskRepo.find.mockResolvedValue([]);

      await service.move('dev-task-1', DevTaskStatus.IN_PROGRESS, 0, 'admin-1');

      // Drag туда-сюда дедуплицируется: STATUS_CHANGE идёт через
      // createIfNotRecent с часовым окном, а не через прямой create.
      expect(notifications.createIfNotRecent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'status_change',
          data: expect.objectContaining({
            alertKey: expect.stringContaining('dev-move-dev-task-1-in_progress-'),
          }),
        }),
        1,
      );
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('не шлёт уведомление об исполнителе, когда он сам двигает задачу', async () => {
      const task = makeTask({ id: 'dev-task-1', status: DevTaskStatus.TODO, assigneeId: 'user-1' });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue({});
      taskRepo.find.mockResolvedValue([]);

      await service.move('dev-task-1', DevTaskStatus.IN_PROGRESS, 0, 'user-1');

      expect(notifications.create).not.toHaveBeenCalled();
      expect(notifications.createIfNotRecent).not.toHaveBeenCalled();
    });

    it('уведомляет автора задачи о завершении её исполнителем', async () => {
      const task = makeTask({
        id: 'dev-task-1',
        status: DevTaskStatus.IN_PROGRESS,
        assigneeId: 'user-1',
        createdById: 'admin-1',
      });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue({});
      taskRepo.find.mockResolvedValue([]);

      await service.move('dev-task-1', DevTaskStatus.DONE, 0, 'user-1');

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1', type: 'task_completed' }),
      );
    });

    it('уведомляет исполнителя и автора о новом комментарии', async () => {
      const task = makeTask({ id: 'dev-task-1', assigneeId: 'user-1', createdById: 'admin-1' });
      const saved = { id: 'c1', taskId: 'dev-task-1', authorId: 'user-2', text: 'Привет' };
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.create.mockReturnValue(saved);
      commentRepo.save.mockResolvedValue(saved);

      await service.addComment('dev-task-1', 'user-2', 'Привет');

      const recipients = notifications.create.mock.calls.map((c: any[]) => c[0].userId).sort();
      expect(recipients).toEqual(['admin-1', 'user-1']);
    });
  });

  describe('bulk', () => {
    // Bulk ids — uuid-колонка: сервис валидирует формат до запроса (400 вместо
    // 500 invalid input syntax for type uuid). Поэтому в тестах — валидные UUID.
    const BT1 = '11111111-1111-4111-8111-111111111111';
    const BT2 = '22222222-2222-4222-8222-222222222222';
    it('меняет статус у выбранных задач и ведёт completedAt', async () => {
      const t1 = makeTask({ id: BT1, status: DevTaskStatus.TODO });
      const t2 = makeTask({ id: BT2, status: DevTaskStatus.TODO });
      taskRepo.find.mockResolvedValue([t1, t2]);
      taskRepo.update.mockResolvedValue({});

      const res = await service.bulk([BT1, BT2], 'status', DevTaskStatus.DONE);

      expect(res.updated).toBe(2);
      expect(taskRepo.update).toHaveBeenCalledWith(
        BT1,
        expect.objectContaining({ status: DevTaskStatus.DONE }),
      );
    });

    it('удаляет выбранные задачи', async () => {
      taskRepo.delete.mockResolvedValue({ affected: 2 });

      const res = await service.bulk([BT1, BT2], 'delete', '');

      expect(res.deleted).toBe(2);
    });

    it('отклоняет пустой список и неизвестный статус', async () => {
      await expect(service.bulk([], 'status', 'done')).rejects.toThrow(BadRequestException);
      await expect(service.bulk([BT1], 'status', 'weird')).rejects.toThrow(BadRequestException);
    });

    it('bulk assignee: назначает исполнителя одним update', async () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      userRepo.findOne.mockResolvedValue({ id: uuid, name: 'Иван' });
      taskRepo.update.mockResolvedValue({ affected: 2 });

      const res = await service.bulk([BT1, BT2], 'assignee', uuid);

      expect(res).toEqual({ updated: 2, deleted: 0 });
      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: uuid } });
      expect(taskRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
        { assigneeId: uuid },
      );
    });

    it('bulk assignee: снимает исполнителя по пустой строке', async () => {
      taskRepo.update.mockResolvedValue({ affected: 2 });

      const res = await service.bulk([BT1, BT2], 'assignee', '');

      expect(res).toEqual({ updated: 2, deleted: 0 });
      expect(taskRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
        { assigneeId: null },
      );
    });

    it('bulk assignee: 400 на несуществующего исполнителя', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      taskRepo.update.mockClear();

      await expect(
        service.bulk([BT1], 'assignee', '123e4567-e89b-12d3-a456-426614174000'),
      ).rejects.toThrow('Исполнитель не найден');
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('bulk assignee: 400 на не-UUID значение', async () => {
      taskRepo.update.mockClear();

      await expect(service.bulk([BT1], 'assignee', 'not-a-uuid')).rejects.toThrow(
        BadRequestException,
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('bulk deadline: ставит дату одним update', async () => {
      taskRepo.update.mockResolvedValue({ affected: 2 });

      const res = await service.bulk([BT1, BT2], 'deadline', '2026-05-01');

      expect(res).toEqual({ updated: 2, deleted: 0 });
      const patch = taskRepo.update.mock.calls[0][1];
      expect(patch.deadline).toBeInstanceOf(Date);
      expect((patch.deadline as Date).toISOString().slice(0, 10)).toBe('2026-05-01');
    });

    it('bulk deadline: очищает дедлайн по пустой строке', async () => {
      taskRepo.update.mockResolvedValue({ affected: 2 });

      const res = await service.bulk([BT1], 'deadline', '');

      expect(res).toEqual({ updated: 2, deleted: 0 });
      expect(taskRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
        { deadline: null },
      );
    });

    it('bulk deadline: 400 на мусорную дату', async () => {
      taskRepo.update.mockClear();

      await expect(service.bulk([BT1], 'deadline', 'мусор')).rejects.toThrow(
        'Некорректная дата',
      );
      await expect(service.bulk([BT1], 'deadline', '2026-02-30')).rejects.toThrow(
        'Некорректная дата',
      );
      await expect(service.bulk([BT1], 'deadline', '2026-13-01')).rejects.toThrow(
        'Некорректная дата',
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('addComment валидация', () => {
    it('отклоняет пустой комментарий', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask());
      await expect(service.addComment('dev-task-1', 'user-2', '   ')).rejects.toThrow(BadRequestException);
    });

    it('отклоняет комментарий длиннее 5000 символов', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask());
      await expect(service.addComment('dev-task-1', 'user-2', 'x'.repeat(5001))).rejects.toThrow(BadRequestException);
    });
  });

  describe('history', () => {
    it('move пишет status в историю', async () => {
      const task = makeTask({ id: 'h1', status: DevTaskStatus.TODO });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);
      taskRepo.find.mockResolvedValue([]);
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockImplementation(async (e: any) => ({ id: 'hist-1', ...e }));

      await service.move('h1', DevTaskStatus.IN_PROGRESS, 0, 'actor-1');

      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'h1', field: 'status', from: DevTaskStatus.TODO, to: DevTaskStatus.IN_PROGRESS }),
      );
      expect(historyRepo.save).toHaveBeenCalled();
    });

    it('update пишет title/assignee/priority/deadline/status', async () => {
      const task = makeTask({
        id: 'h2',
        title: 'Старое',
        status: DevTaskStatus.TODO,
        priority: DevTaskPriority.MEDIUM,
        assigneeId: null,
        deadline: null,
      });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'x' });

      await service.update(
        'h2',
        {
          title: 'Новое',
          status: DevTaskStatus.IN_PROGRESS,
          priority: DevTaskPriority.HIGH,
        } as any,
        'actor-1',
      );

      const fields = historyRepo.create.mock.calls.map((c: any[]) => c[0].field).sort();
      expect(fields).toEqual(expect.arrayContaining(['title', 'status', 'priority']));
    });

    it('getHistory возвращает контракт с actor join: последние 1000 DESC, наружу ASC', async () => {
      const task = makeTask({ id: 'h3' });
      taskRepo.findOne.mockResolvedValue(task);
      // БД отдаёт DESC (свежая первая) — мок отдаёт в этом порядке.
      historyRepo.find.mockResolvedValue([
        { id: 'a', field: 'status', from: 'todo', to: 'done', actor: { id: 'u1', name: 'Иван', avatar: 'x' }, createdAt: new Date('2026-01-02') },
        { id: 'b', field: 'title', from: 'a', to: 'b', actor: null, createdAt: new Date('2026-01-01') },
      ] as any);

      const res = await service.getHistory('h3');

      expect(historyRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: 'h3' }, order: { createdAt: 'DESC' }, take: 1000 }),
      );
      // Контракт наружу — ASC: старая (b) первая.
      expect(res.map(r => r.id)).toEqual(['b', 'a']);
      expect(res[1]).toHaveProperty('id');
      expect(res[1]).toHaveProperty('field');
      expect(res[1]).toHaveProperty('from');
      expect(res[1]).toHaveProperty('to');
      expect(res[1]).toHaveProperty('actor');
      expect(res[1]).toHaveProperty('createdAt');
      expect(res[1].actor).toEqual({ id: 'u1', name: 'Иван' });
      expect(res[0].actor).toBeNull();
    });
  });

  describe('clone', () => {
    it('копирует задачу: title (копия), status backlog, completedAt null', async () => {
      const orig = makeTask({
        id: 'orig-1',
        title: 'Оригинал',
        status: DevTaskStatus.DONE,
        completedAt: new Date(),
        storyPoints: 5,
        tags: ['a'],
        attachments: ['http://x/y.png'],
      });
      taskRepo.findOne.mockImplementation(async (opts: any) => {
        if (opts?.where?.id === 'orig-1') return orig;
        // перечитывание копии через findOne: отдаём сохранённую
        return { ...orig, id: 'new-1', title: 'Оригинал (копия)', status: DevTaskStatus.BACKLOG, completedAt: null, comments: [] };
      });
      let n = 0;
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: `new-${++n}` }));
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.find.mockResolvedValue([]);

      const res = await service.clone('orig-1', 'admin-1', false);

      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Оригинал (копия)', status: DevTaskStatus.BACKLOG, completedAt: null }),
      );
      expect(res.id).toBe('new-1');
    });

    it('withSubtasks=true копирует прямых детей новыми id, без флага — нет', async () => {
      const orig = makeTask({ id: 'orig-2', title: 'Родитель' });
      const child = makeTask({ id: 'child-1', parentTaskId: 'orig-2', title: 'Подзадача' });
      taskRepo.findOne.mockImplementation(async (opts: any) => {
        if (opts?.where?.id === 'orig-2') return orig;
        return { ...orig, id: 'new-10', title: 'Родитель (копия)', comments: [] };
      });
      const created: any[] = [];
      let n = 10;
      taskRepo.create.mockImplementation((dto: any) => {
        const e = { ...dto, id: `new-${++n}` };
        created.push(e);
        return e;
      });
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.find.mockImplementation(async (opts: any) => {
        if (opts?.where?.parentTaskId === 'orig-2') return [child];
        return [];
      });

      await service.clone('orig-2', 'admin-1', true);

      const childCopy = created.find(c => c.parentTaskId === 'new-11');
      expect(childCopy).toBeDefined();
      expect(childCopy.title).toBe('Подзадача');
      expect(childCopy.id).not.toBe('child-1');

      // без флага — детей не копируем
      created.length = 0;
      taskRepo.create.mockClear();
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: 'new-99' }));
      await service.clone('orig-2', 'admin-1', false);
      // только 1 create (сама копия), без детских
      expect(taskRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('mentions', () => {
    const MENTIONED = '123e4567-e89b-12d3-a456-426614174000';
    it('уведомляет упомянутого task_comment и возвращает mentions', async () => {
      const task = makeTask({ id: 'm1', assigneeId: 'user-1', createdById: 'admin-1' });
      const saved = { id: 'c9', taskId: 'm1', authorId: 'user-2', text: 'Привет' };
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.create.mockReturnValue(saved);
      commentRepo.save.mockResolvedValue(saved);
      (notifications.create as jest.Mock).mockClear();

      const res = await service.addComment('m1', 'user-2', 'Привет @all', [MENTIONED]);

      expect((res as any).mentions).toEqual([MENTIONED]);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: MENTIONED, type: 'task_comment' }),
      );
    });

    it('дедуп: упомянутый = исполнитель — одно уведомление', async () => {
      const task = makeTask({ id: 'm2', assigneeId: MENTIONED, createdById: 'admin-1' });
      const saved = { id: 'c10', taskId: 'm2', authorId: 'user-2', text: 'x' };
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.create.mockReturnValue(saved);
      commentRepo.save.mockResolvedValue(saved);
      (notifications.create as jest.Mock).mockClear();

      await service.addComment('m2', 'user-2', 'x', [MENTIONED]);

      const calls = (notifications.create as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0].userId === MENTIONED,
      );
      expect(calls).toHaveLength(1);
    });

    it('автор-упомянутый не получает уведомления', async () => {
      const task = makeTask({ id: 'm3', assigneeId: 'user-1', createdById: 'admin-1' });
      const saved = { id: 'c11', taskId: 'm3', authorId: 'user-2', text: 'x' };
      taskRepo.findOne.mockResolvedValue(task);
      commentRepo.create.mockReturnValue(saved);
      commentRepo.save.mockResolvedValue(saved);
      (notifications.create as jest.Mock).mockClear();

      await service.addComment('m3', 'user-2', 'x', ['user-2', MENTIONED]);

      const toAuthor = (notifications.create as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0].userId === 'user-2',
      );
      expect(toAuthor).toHaveLength(0);
    });
  });

  describe('kpi новые ключи', () => {
    it('возвращает velocity (6 недель) и burndown (30 дней), не падает на пустых', async () => {
      taskRepo.find.mockResolvedValue([]);

      const kpi = await service.getKpi();

      expect(kpi.velocity).toHaveLength(6);
      expect(kpi.burndown).toHaveLength(30);
      expect(kpi.velocity[0]).toHaveProperty('week');
      expect(kpi.velocity[0]).toHaveProperty('points');
      expect(kpi.velocity[0]).toHaveProperty('count');
      expect(kpi.burndown[0]).toHaveProperty('day');
      expect(kpi.burndown[0]).toHaveProperty('created');
      expect(kpi.burndown[0]).toHaveProperty('done');
      expect(kpi.burndown[0]).toHaveProperty('open');
      // старые ключи на месте
      expect(kpi.team).toBeDefined();
      expect(kpi.members).toBeDefined();
    });

    it('velocity считает points/count по completedAt', async () => {
      const now = new Date();
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'v1', status: DevTaskStatus.DONE, completedAt: now, storyPoints: 5 } as any),
        makeTask({ id: 'v2', status: DevTaskStatus.TODO, storyPoints: 8 } as any),
      ]);

      const kpi = await service.getKpi();

      const totalCount = kpi.velocity.reduce((s: number, w: any) => s + w.count, 0);
      const totalPoints = kpi.velocity.reduce((s: number, w: any) => s + w.points, 0);
      expect(totalCount).toBe(1);
      expect(totalPoints).toBe(5);
    });
  });

  describe('attachments валидация DTO', () => {
    it('11 шт → ошибка (фронт получит 400 через ValidationPipe)', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { CreateDevTaskDto } = await import('./dto/create-dev-task.dto');
      const dto = plainToInstance(CreateDevTaskDto, {
        title: 'x',
        attachments: Array(11).fill('http://example.com/a.png'),
      });
      const errors = await validate(dto as any);
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).toContain('attachments');
    });

    it('каждая ≤2000 символов', async () => {
      const { validate } = await import('class-validator');
      const { plainToInstance } = await import('class-transformer');
      const { CreateDevTaskDto } = await import('./dto/create-dev-task.dto');
      const dto = plainToInstance(CreateDevTaskDto, {
        title: 'x',
        attachments: ['x'.repeat(2001)],
      });
      const errors = await validate(dto as any);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ─── Контракты A–I ────────────────────────────────────────────────

  describe('blocked (A)', () => {
    const BB1 = '11111111-1111-4111-8111-111111111111';
    it('bulk ставит блокировку с причиной и пишет историю нет→да', async () => {
      const t = makeTask({ id: BB1, isBlocked: false, blockedReason: null });
      taskRepo.find.mockResolvedValue([t]);
      taskRepo.update.mockResolvedValue({ affected: 1 });
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'h' });

      const res = await service.bulk([BB1], 'blocked' as any, 'нужен доступ');

      expect(res).toEqual({ updated: 1, deleted: 0 });
      expect(taskRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
        { isBlocked: true, blockedReason: 'нужен доступ' },
      );
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: BB1, field: 'blocked', from: 'нет', to: 'да' }),
      );
    });

    it('bulk снимает блокировку по пустой строке (история да→нет)', async () => {
      const t = makeTask({ id: BB1, isBlocked: true, blockedReason: 'ждали' });
      taskRepo.find.mockResolvedValue([t]);
      taskRepo.update.mockResolvedValue({ affected: 1 });
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'h' });

      const res = await service.bulk([BB1], 'blocked' as any, '');

      expect(res).toEqual({ updated: 1, deleted: 0 });
      expect(taskRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
        { isBlocked: false, blockedReason: null },
      );
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: BB1, field: 'blocked', from: 'да', to: 'нет' }),
      );
    });

    it('bulk blocked: 400 на причину длиннее 500', async () => {
      taskRepo.update.mockClear();

      await expect(service.bulk([BB1], 'blocked' as any, 'x'.repeat(501))).rejects.toThrow(
        BadRequestException,
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('PATCH isBlocked пишет историю да/нет', async () => {
      const task = makeTask({ isBlocked: false });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'h' });

      await service.update('dev-task-1', { isBlocked: true } as any, 'actor-1');

      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ field: 'blocked', from: 'нет', to: 'да' }),
      );
    });
  });

  describe('startDate PATCH (B)', () => {
    it('конвертирует строку в Date', async () => {
      const task = makeTask({ startDate: null });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('dev-task-1', { startDate: '2026-09-01' } as any);

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ startDate: expect.any(Date) }),
      );
      const patch = taskRepo.update.mock.calls[0][1];
      expect((patch.startDate as Date).toISOString().slice(0, 10)).toBe('2026-09-01');
    });

    it('null очищает дату', async () => {
      const task = makeTask({ startDate: new Date('2026-09-01') });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('dev-task-1', { startDate: null } as any);

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ startDate: null }),
      );
    });
  });

  describe('triage-overdue (C)', () => {
    const TARGET = '123e4567-e89b-12d3-a456-426614174000';
    const SELF = '11111111-2222-3333-4444-555555555555';
    const ago = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const ahead = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    it('назначает только просроченные (не done, дедлайн раньше сегодня)', async () => {
      const overdue = makeTask({ id: 'o1', status: DevTaskStatus.TODO, deadline: ago(3), assigneeId: null });
      const future = makeTask({ id: 'f1', status: DevTaskStatus.TODO, deadline: ahead(3), assigneeId: null });
      const doneOld = makeTask({ id: 'd1', status: DevTaskStatus.DONE, deadline: ago(5), assigneeId: null });
      const noDeadline = makeTask({ id: 'n1', status: DevTaskStatus.TODO, deadline: null, assigneeId: null });
      const already = makeTask({ id: 'a1', status: DevTaskStatus.TODO, deadline: ago(2), assigneeId: TARGET });
      taskRepo.find.mockResolvedValue([overdue, future, doneOld, noDeadline, already]);
      taskRepo.update.mockResolvedValue(undefined);
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'h' });

      const res = await service.triageOverdue({ assigneeId: TARGET }, 'actor-1');

      expect(res).toEqual({ assigned: 1 });
      expect(taskRepo.update).toHaveBeenCalledWith('o1', { assigneeId: TARGET });
      expect(taskRepo.update).toHaveBeenCalledTimes(1);
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'o1', field: 'assignee', to: TARGET }),
      );
      // Тихо: уведомлений нет.
      expect(notifications.create).not.toHaveBeenCalled();
      expect(notifications.createIfNotRecent).not.toHaveBeenCalled();
    });

    it('default — текущий пользователь, скоуп projectId', async () => {
      const P1 = '44444444-5555-4666-8666-444444444444';
      const P2 = '55555555-6666-4777-8777-555555555555';
      const t1 = makeTask({ id: 'p1', status: DevTaskStatus.TODO, deadline: ago(2), assigneeId: null, projectId: P1 } as any);
      const t2 = makeTask({ id: 'p2', status: DevTaskStatus.TODO, deadline: ago(2), assigneeId: null, projectId: P2 } as any);
      taskRepo.find.mockResolvedValue([t1, t2]);
      taskRepo.update.mockResolvedValue(undefined);

      const res = await service.triageOverdue({ projectId: P1 }, SELF);

      expect(res).toEqual({ assigned: 1 });
      expect(taskRepo.update).toHaveBeenCalledWith('p1', { assigneeId: SELF });
    });

    it('400 на невалидный assigneeId (мусор и неизвестный UUID)', async () => {
      taskRepo.update.mockClear();

      await expect(service.triageOverdue({ assigneeId: 'not-a-uuid' }, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      userRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.triageOverdue({ assigneeId: TARGET }, 'actor-1'),
      ).rejects.toThrow('Исполнитель не найден');
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('views (D)', () => {
    it('create+list: свои, ORDER createdAt', async () => {
      viewRepo.create.mockImplementation((dto: any) => ({ id: 'v1', ...dto }));
      viewRepo.save.mockImplementation(async (e: any) => e);
      viewRepo.find.mockResolvedValue([
        { id: 'v1', ownerId: 'me', name: 'Моё', filters: { status: 'todo' }, groupBy: 'status' },
      ]);

      const created = await service.createView('me', { name: 'Моё', filters: { status: 'todo' } });

      expect(created).toMatchObject({ ownerId: 'me', name: 'Моё', groupBy: 'status' });
      const list = await service.listViews('me');
      expect(viewRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'me' }, order: { createdAt: 'ASC' } }),
      );
      expect(list).toHaveLength(1);
    });

    it('create: 400 на пустое имя, длинное имя, плохой groupBy и не-объект filters', async () => {
      await expect(service.createView('me', { name: '   ' })).rejects.toThrow(BadRequestException);
      await expect(service.createView('me', { name: 'x'.repeat(101) })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createView('me', { name: 'ok', groupBy: 'color' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.createView('me', { name: 'ok', filters: ['not', 'object'] as any }),
      ).rejects.toThrow(BadRequestException);
      expect(viewRepo.save).not.toHaveBeenCalled();
    });

    it('delete: чужое без manage → 403, с manage или своё — ок', async () => {
      viewRepo.findOne.mockResolvedValue({ id: 'v9', ownerId: 'other' });
      viewRepo.remove.mockResolvedValue({});

      await expect(service.deleteView('v9', 'me', false)).rejects.toThrow(ForbiddenException);
      expect(viewRepo.remove).not.toHaveBeenCalled();

      await service.deleteView('v9', 'me', true);
      expect(viewRepo.remove).toHaveBeenCalled();

      viewRepo.findOne.mockResolvedValue({ id: 'v1', ownerId: 'me' });
      await service.deleteView('v1', 'me', false);
      expect(viewRepo.remove).toHaveBeenCalledTimes(2);
    });

    it('delete: 404 на несуществующее', async () => {
      viewRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteView('missing', 'me', true)).rejects.toThrow(NotFoundException);
    });
  });

  describe('sprints (H)', () => {
    const S1 = '22222222-3333-4444-5555-666666666666';
    const S2 = '33333333-4444-5555-6666-777777777777';

    it('complete в backlog: открытые отвязываются, done остаются, спринт done', async () => {
      const open = makeTask({ id: 's-t1', status: DevTaskStatus.TODO, sprintId: S1 });
      const done = makeTask({ id: 's-t2', status: DevTaskStatus.DONE, sprintId: S1 });
      sprintRepo.findOne.mockResolvedValue({ id: S1, status: 'active' });
      taskRepo.find.mockResolvedValue([open, done]);
      taskRepo.update.mockResolvedValue(undefined);
      sprintRepo.update.mockResolvedValue(undefined);
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'h' });

      const res = await service.completeSprint(S1, 'backlog', 'actor-1');

      expect(res).toEqual({ id: S1, status: 'done', moved: 1 });
      expect(taskRepo.update).toHaveBeenCalledWith('s-t1', { sprintId: null });
      expect(taskRepo.update).not.toHaveBeenCalledWith('s-t2', expect.anything());
      expect(sprintRepo.update).toHaveBeenCalledWith(S1, { status: 'done' });
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 's-t1', field: 'sprint', from: S1, to: null }),
      );
    });

    it('complete с переносом в другой спринт', async () => {
      const open = makeTask({ id: 's-t3', status: DevTaskStatus.IN_PROGRESS, sprintId: S1 });
      sprintRepo.findOne.mockImplementation(async (opts: any) => {
        if (opts?.where?.id === S1) return { id: S1, status: 'active' };
        if (opts?.where?.id === S2) return { id: S2, status: 'active' };
        return null;
      });
      taskRepo.find.mockResolvedValue([open]);
      taskRepo.update.mockResolvedValue(undefined);
      sprintRepo.update.mockResolvedValue(undefined);

      const res = await service.completeSprint(S1, S2, 'actor-1');

      expect(res).toEqual({ id: S1, status: 'done', moved: 1 });
      expect(taskRepo.update).toHaveBeenCalledWith('s-t3', { sprintId: S2 });
    });

    it('complete: 400 на неизвестный спринт-приёмник и мусор', async () => {
      sprintRepo.findOne.mockImplementation(async (opts: any) => {
        if (opts?.where?.id === S1) return { id: S1, status: 'active' };
        return null;
      });

      await expect(service.completeSprint(S1, S2, 'actor-1')).rejects.toThrow(BadRequestException);
      await expect(service.completeSprint(S1, 'мусор', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(sprintRepo.update).not.toHaveBeenCalled();
    });

    it('update задачи со sprintId пишет историю sprint', async () => {
      const task = makeTask({ sprintId: null });
      taskRepo.findOne.mockResolvedValue(task);
      sprintRepo.findOne.mockResolvedValue({ id: S1, status: 'active' });
      taskRepo.update.mockResolvedValue(undefined);
      historyRepo.create.mockImplementation((dto: any) => dto);
      historyRepo.save.mockResolvedValue({ id: 'h' });

      await service.update('dev-task-1', { sprintId: S1 } as any, 'actor-1');

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ sprintId: S1 }),
      );
      expect(historyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ field: 'sprint', from: null, to: S1 }),
      );
    });

    it('update задачи с несуществующим спринтом → 400', async () => {
      const task = makeTask({ sprintId: null });
      taskRepo.findOne.mockResolvedValue(task);
      sprintRepo.findOne.mockResolvedValue(null);

      await expect(service.update('dev-task-1', { sprintId: S1 } as any)).rejects.toThrow(
        'Спринт не найден',
      );
    });
  });

  describe('flow (F)', () => {
    it('возвращает shape дня и считает колонки из истории + снапшота', async () => {
      const now = new Date();
      const created = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'f1', status: DevTaskStatus.DONE, createdAt: created } as any),
        makeTask({ id: 'f2', status: DevTaskStatus.TODO, createdAt: created } as any),
      ]);
      // f1: todo → done 5 дней назад; f2 без истории (всегда todo).
      historyRepo.find.mockResolvedValue([
        {
          id: 'h1', taskId: 'f1', field: 'status', from: 'todo', to: 'done',
          createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        },
      ]);

      const flow = await service.getFlow(7);

      expect(flow).toHaveLength(7);
      for (const row of flow) {
        expect(Object.keys(row).sort()).toEqual(
          ['backlog', 'day', 'done', 'in_progress', 'in_review', 'testing', 'todo'].sort(),
        );
        expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // Последний день: f1 done, f2 todo.
      const last = flow[flow.length - 1] as any;
      expect(last.done).toBe(1);
      expect(last.todo).toBe(1);
      // Первый день окна (6 дней назад): переход f1 уже был 5 дней назад…
      // проверяем инвариант: сумма колонок = числу созданных к этому дню задач.
      for (const row of flow as any[]) {
        const sum = row.backlog + row.todo + row.in_progress + row.in_review + row.testing + row.done;
        expect(sum).toBe(2);
      }
    });

    it('400 на days вне 7..90', async () => {
      await expect(service.getFlow(5)).rejects.toThrow(BadRequestException);
      await expect(service.getFlow(100)).rejects.toThrow(BadRequestException);
      await expect(service.getFlow(Number.NaN)).rejects.toThrow(BadRequestException);
    });
  });

  describe('preview (G)', () => {
    it('возвращает точный shape', async () => {
      const task = makeTask({
        id: 'pv-1',
        title: 'Превью',
        status: DevTaskStatus.IN_PROGRESS,
        priority: DevTaskPriority.HIGH,
        assigneeId: 'user-1',
        assignee: { id: 'user-1', name: 'Иван' } as User,
        deadline: new Date('2026-10-01'),
        projectId: 'proj-1',
      } as any);
      taskRepo.findOne.mockResolvedValue(task);
      projectRepo.findOne.mockResolvedValue({ id: 'proj-1', name: 'Сайт' });
      taskRepo.count
        .mockResolvedValueOnce(4) // subtasksCount
        .mockResolvedValueOnce(1); // subtasksDone

      const res = await service.getPreview('pv-1');

      expect(res).toEqual({
        id: 'pv-1',
        title: 'Превью',
        status: DevTaskStatus.IN_PROGRESS,
        priority: DevTaskPriority.HIGH,
        assignee: { id: 'user-1', name: 'Иван' },
        deadline: new Date('2026-10-01'),
        project: { id: 'proj-1', name: 'Сайт' },
        subtasksDone: 1,
        subtasksCount: 4,
      });
    });

    it('null-связи и 404', async () => {
      const task = makeTask({ id: 'pv-2', assigneeId: null, assignee: null, projectId: null });
      taskRepo.findOne.mockResolvedValue(task);

      const res = await service.getPreview('pv-2');

      expect(res.assignee).toBeNull();
      expect(res.project).toBeNull();

      taskRepo.findOne.mockResolvedValue(null);
      await expect(service.getPreview('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('SLA (I)', () => {
    it('team.slaBreached считает просрочку + возраст без дедлайна по порогам', async () => {
      const now = Date.now();
      const ago = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);
      taskRepo.find.mockResolvedValue([
        // просрочена с дедлайном → breach
        makeTask({ id: 's1', status: DevTaskStatus.TODO, deadline: ago(1), createdAt: ago(2) }),
        // без дедлайна, medium, возраст 10д > 7 → breach
        makeTask({ id: 's2', status: DevTaskStatus.TODO, deadline: null, priority: DevTaskPriority.MEDIUM, createdAt: ago(10) }),
        // без дедлайна, medium, возраст 1д → ок
        makeTask({ id: 's3', status: DevTaskStatus.TODO, deadline: null, priority: DevTaskPriority.MEDIUM, createdAt: ago(1) }),
        // done просрочена → не breach
        makeTask({ id: 's4', status: DevTaskStatus.DONE, deadline: ago(5), completedAt: ago(1), createdAt: ago(6) }),
        // без дедлайна, critical, возраст 2д > 1 → breach
        makeTask({ id: 's5', status: DevTaskStatus.IN_PROGRESS, deadline: null, priority: DevTaskPriority.CRITICAL, createdAt: ago(2) }),
        // без дедлайна, low, возраст 5д < 14 → ок
        makeTask({ id: 's6', status: DevTaskStatus.TODO, deadline: null, priority: DevTaskPriority.LOW, createdAt: ago(5) }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.team.slaBreached).toBe(3);
      // Старые ключи на месте.
      expect(kpi.team.total).toBe(6);
      expect(kpi.team).toHaveProperty('overdue');
      expect(kpi).toHaveProperty('members');
      expect(kpi).toHaveProperty('velocity');
      expect(kpi).toHaveProperty('burndown');
    });
  });

  describe('webhooks outbox (E)', () => {
    const SUB = {
      id: 'sub-1', projectId: null, url: 'https://hooks.example.com/dev',
      secret: 's3cr3t', events: ['task.done'], isActive: true,
    };

    it('createWebhook: 400 на плохой url и события, ок на корректном', async () => {
      webhookRepo.create.mockImplementation((dto: any) => ({ id: 'sub-9', ...dto }));
      webhookRepo.save.mockImplementation(async (e: any) => e);

      await expect(
        service.createWebhook({ url: 'ftp://x/y', events: ['task.done'] }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createWebhook({ url: 'not-a-url', events: ['task.done'] }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createWebhook({ url: 'https://hooks.example.com/x', events: ['nope'] }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createWebhook({ url: 'https://hooks.example.com/x', events: [] }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);

      const ok = await service.createWebhook(
        { url: 'https://hooks.example.com/x', events: ['task.done', 'task.created'] },
        'admin-1',
      );
      expect(ok).toMatchObject({ url: 'https://hooks.example.com/x', isActive: true });
    });

    it('move в done шлёт плоский payload task.done; сеть упала — мутация жива', async () => {
      const task = makeTask({ id: 'w1', status: DevTaskStatus.TESTING, title: 'Вебхук' });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);
      taskRepo.find.mockResolvedValue([]);
      webhookRepo.find.mockResolvedValue([SUB]);
      const post = jest.fn().mockRejectedValue(new Error('net down'));
      (service as any).postWebhook = post;

      const res = await service.move('w1', DevTaskStatus.DONE, 0, 'actor-1');

      expect(res).toBeDefined();
      expect(post).toHaveBeenCalledTimes(1);
      const [url, payload, secret] = post.mock.calls[0];
      expect(url).toBe(SUB.url);
      expect(secret).toBe(SUB.secret);
      // Плоский top-level payload по контракту.
      expect(payload).toMatchObject({
        event: 'task.done', taskId: 'w1', title: 'Вебхук', status: 'done',
      });
      expect(payload).toHaveProperty('assignee');
      expect(payload).toHaveProperty('assigneeId');
      expect(payload).toHaveProperty('deadline');
      expect(payload).toHaveProperty('projectId');
      expect(payload).toHaveProperty('project');
      expect(payload).toHaveProperty('url', expect.stringContaining('/dev-board/task/w1'));
      expect(payload).toHaveProperty('at');
      // Доставка записана со status 0 и текстом ошибки.
      expect(deliveryRepo.save).toHaveBeenCalled();
      expect(deliveryRepo.update).toHaveBeenCalledWith('del-1', expect.objectContaining({ status: 0 }));
    });

    it('подписка со своим projectId чужие задачи игнорирует', async () => {
      const task = makeTask({ id: 'w2', status: DevTaskStatus.TODO, projectId: 'proj-A' } as any);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);
      taskRepo.find.mockResolvedValue([]);
      webhookRepo.find.mockResolvedValue([{ ...SUB, events: ['task.moved'], projectId: 'proj-B' }]);
      const post = jest.fn().mockResolvedValue({ status: 200 });
      (service as any).postWebhook = post;

      await service.move('w2', DevTaskStatus.IN_PROGRESS, 0, 'actor-1');

      expect(post).not.toHaveBeenCalled();
    });

    it('test шлёт тестовый task.done и возвращает {ok, status}', async () => {
      webhookRepo.findOne.mockResolvedValue(SUB);
      const post = jest.fn().mockResolvedValue({ status: 200 });
      (service as any).postWebhook = post;

      const res = await service.testWebhook('sub-1');

      expect(res).toEqual({ ok: true, status: 200 });
      expect(post).toHaveBeenCalledWith(
        SUB.url,
        expect.objectContaining({ event: 'task.done', taskId: 'test' }),
        SUB.secret,
      );
    });

    it('deliveries: последние 20 DESC; delete 404 на чужой id', async () => {
      webhookRepo.findOne.mockResolvedValue(SUB);
      deliveryRepo.find.mockResolvedValue([{ id: 'd1' }]);

      const rows = await service.getWebhookDeliveries('sub-1');

      expect(deliveryRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subscriptionId: 'sub-1' }, order: { createdAt: 'DESC' }, take: 20 }),
      );
      expect(rows).toEqual([{ id: 'd1' }]);

      webhookRepo.findOne.mockResolvedValue(null);
      await expect(service.getWebhookDeliveries('missing')).rejects.toThrow(NotFoundException);
      await expect(service.deleteWebhook('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Аудит: валидация входов, detach, clone-дети, complete-в-себя, лимиты ──

  describe('findAll валидация фильтров', () => {
    it('400 на неизвестный status', async () => {
      await expect(service.findAll({ status: 'weird' as any })).rejects.toThrow(BadRequestException);
      // qb не трогаем: в БД с мусором не ходим.
      expect(taskRepo.createQueryBuilder().getMany).not.toHaveBeenCalled();
    });

    it('400 на мусорные sprint/assignee/project UUID', async () => {
      await expect(service.findAll({ sprintId: 'мусор' })).rejects.toThrow(BadRequestException);
      await expect(service.findAll({ assigneeId: 'not-a-uuid' })).rejects.toThrow(BadRequestException);
      await expect(service.findAll({ projectId: '123' })).rejects.toThrow(BadRequestException);
    });

    it('sprint=null → задачи вне спринтов (IS NULL), пустой sprint — без фильтра, без 400', async () => {
      taskRepo.createQueryBuilder().getMany.mockResolvedValue([]);

      await expect(service.findAll({ sprintId: null })).resolves.toEqual([]);
      await expect(service.findAll({ sprintId: '' as any })).resolves.toEqual([]);
    });
  });

  describe('create/update защита от 500', () => {
    it('create: 400 на мусорные FK-форматы, позицию и enum', async () => {
      taskRepo.create.mockClear();

      await expect(
        service.create({ title: 'x', assigneeId: 'nope' } as any, 'admin-1'),
      ).rejects.toThrow('Исполнитель не найден');
      await expect(
        service.create({ title: 'x', projectId: 'nope' } as any, 'admin-1'),
      ).rejects.toThrow('Проект не найден');
      await expect(
        service.create({ title: 'x', sprintId: 'bad' } as any, 'admin-1'),
      ).rejects.toThrow('Некорректный id спринта');
      await expect(
        service.create({ title: 'x', position: -1 } as any, 'admin-1'),
      ).rejects.toThrow('Некорректная позиция');
      await expect(
        service.create({ title: 'x', status: 'weird' } as any, 'admin-1'),
      ).rejects.toThrow('Неизвестный статус');
      await expect(
        service.create({ title: 'x', priority: 'weird' } as any, 'admin-1'),
      ).rejects.toThrow('Неизвестный приоритет');
      expect(taskRepo.create).not.toHaveBeenCalled();
    });

    it('update: 400 на неизвестный enum и негативную позицию', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask());
      taskRepo.update.mockClear();

      await expect(service.update('dev-task-1', { status: 'weird' } as any)).rejects.toThrow(
        'Неизвестный статус',
      );
      await expect(service.update('dev-task-1', { priority: 'weird' } as any)).rejects.toThrow(
        'Неизвестный приоритет',
      );
      await expect(service.update('dev-task-1', { position: -5 } as any)).rejects.toThrow(
        'Некорректная позиция',
      );
      await expect(
        service.update('dev-task-1', { assigneeId: 'not-a-uuid' } as any),
      ).rejects.toThrow('Исполнитель не найден');
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('update: attachments null → [] (NOT NULL в БД, а не 500)', async () => {
      const task = makeTask();
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);

      await service.update('dev-task-1', { attachments: null } as any);

      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ attachments: [] }),
      );
    });
  });

  describe('bulk неизвестное действие', () => {
    it('400 Неизвестное действие (а не вводящий в заблуждение приоритет)', async () => {
      taskRepo.update.mockClear();

      await expect(
        service.bulk(['11111111-1111-4111-8111-111111111111'], 'weird' as any, 'x'),
      ).rejects.toThrow('Неизвестное действие');
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('clone дети — новая работа', () => {
    it('withSubtasks сбрасывает статус/completedAt/блокер детей, спринт хранит', async () => {
      const S1 = '22222222-3333-4444-5555-666666666666';
      const orig = makeTask({ id: 'orig-9', title: 'Родитель' });
      const childDone = makeTask({
        id: 'ch-1', parentTaskId: 'orig-9', title: 'Готовая подзадача',
        status: DevTaskStatus.DONE, completedAt: new Date('2026-01-05'),
        isBlocked: true, blockedReason: 'ждали', sprintId: S1,
      } as any);
      taskRepo.findOne.mockImplementation(async (opts: any) => {
        if (opts?.where?.id === 'orig-9') return orig;
        return { ...orig, id: 'new-21', title: 'Родитель (копия)', comments: [] };
      });
      const created: any[] = [];
      let n = 21;
      taskRepo.create.mockImplementation((dto: any) => {
        const e = { ...dto, id: `new-${++n}` };
        created.push(e);
        return e;
      });
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.find.mockImplementation(async (opts: any) => {
        if (opts?.where?.parentTaskId === 'orig-9') return [childDone];
        return [];
      });

      await service.clone('orig-9', 'admin-1', true);

      const childCopy = created.find(c => c.parentTaskId === 'new-22');
      expect(childCopy).toBeDefined();
      // Копия — новая работа, а не слепок старого done.
      expect(childCopy.status).toBe(DevTaskStatus.BACKLOG);
      expect(childCopy.completedAt).toBeNull();
      expect(childCopy.isBlocked).toBe(false);
      expect(childCopy.blockedReason).toBeNull();
      // Своё планирование ребёнка сохраняем.
      expect(childCopy.sprintId).toBe(S1);
      expect(childCopy.id).not.toBe('ch-1');
    });
  });

  describe('completeSprint в себя', () => {
    it('moved 0 без апдейтов задач, спринт уходит в done', async () => {
      const S1 = '22222222-3333-4444-5555-666666666666';
      const open = makeTask({ id: 's-t9', status: DevTaskStatus.TODO, sprintId: S1 });
      sprintRepo.findOne.mockResolvedValue({ id: S1, status: 'active' });
      taskRepo.find.mockResolvedValue([open]);
      taskRepo.update.mockClear();
      sprintRepo.update.mockResolvedValue(undefined);

      const res = await service.completeSprint(S1, S1, 'actor-1');

      expect(res).toEqual({ id: S1, status: 'done', moved: 0 });
      expect(taskRepo.update).not.toHaveBeenCalled();
      expect(sprintRepo.update).toHaveBeenCalledWith(S1, { status: 'done' });
    });
  });

  describe('лимиты лент', () => {
    it('findOne грузит комментарии отдельным запросом с take 500', async () => {
      const task = makeTask({ id: 'lim-1' });
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);
      (commentRepo.find as jest.Mock).mockResolvedValue([]);

      const res = await service.findOne('lim-1');

      expect(commentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: 'lim-1' }, take: 500 }),
      );
      expect(res.comments).toEqual([]);
    });
  });

  describe('formatDevSlackMessage', () => {
    it('возвращает текст + структурированные поля', async () => {
      const { formatDevSlackMessage } = await import('./dev-slack-format');
      const msg = formatDevSlackMessage(
        { id: 't1', title: 'Починить баг', status: 'done', priority: 'high', assignee: 'Иван', url: 'http://x/dev-board/task/t1' },
        'task.done',
      );

      expect(typeof msg.text).toBe('string');
      expect(msg.text).toContain('Починить баг');
      expect(Array.isArray(msg.blocks)).toBe(true);
      expect(JSON.stringify(msg.blocks)).toContain('Иван');
    });
  });

  // ─── KPI-аудит: TZ Asia/Dushanbe, границы on-time/overdue, null/NaN ───
  // Все ожидания посчитаны в календаре Душанбе (+05:00, без DST) и потому
  // детерминированы независимо от TZ хоста, где гоняется jest.

  describe('kpi аудит: TZ Душанбе, границы, null/NaN', () => {
    const dushanbeDay = (d: Date | string | number): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date(d));
    const dushanbeStartOfToday = (): Date =>
      new Date(`${dushanbeDay(new Date())}T00:00:00+05:00`);
    const dushanbeMondayOf = (d: Date): string => {
      const shifted = new Date(d.getTime() + 5 * 60 * 60 * 1000);
      const x = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x.toISOString().slice(0, 10);
    };

    it('overdue: дедлайн сегодня по Душанбе — не просрочка; вчера — просрочка; done исключены', async () => {
      const start = dushanbeStartOfToday();
      taskRepo.find.mockResolvedValue([
        // сегодня 00:01 по Душанбе: instant-сравнение (< now) уже дало бы overdue
        makeTask({ id: 'today', status: DevTaskStatus.TODO, deadline: new Date(start.getTime() + 60 * 1000) }),
        // ровно полночь Душанбе — граница включительно, не просрочка
        makeTask({ id: 'edge', status: DevTaskStatus.TODO, deadline: new Date(start.getTime()) }),
        makeTask({ id: 'yest', status: DevTaskStatus.IN_PROGRESS, deadline: new Date(start.getTime() - 1) }),
        // done с прошедшим дедлайном — не overdue
        makeTask({
          id: 'done-old', status: DevTaskStatus.DONE,
          deadline: new Date(start.getTime() - 24 * 60 * 60 * 1000), completedAt: new Date(),
        }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.team.total).toBe(4);
      expect(kpi.team.overdue).toBe(1);
    });

    it('doneOnTime: завершение в день дедлайна по Душанбе — в срок (instant давал бы late)', async () => {
      // deadline 20.09 23:00 UTC = 21.09 04:00 Душанбе,
      // completed 21.09 01:00 UTC = 21.09 06:00 Душанбе:
      // как instant'ы completedAt > deadline, но день Душанбе один.
      taskRepo.find.mockResolvedValue([
        makeTask({
          id: 't1', status: DevTaskStatus.DONE,
          deadline: new Date('2026-09-20T23:00:00.000Z'),
          completedAt: new Date('2026-09-21T01:00:00.000Z'),
          createdAt: new Date('2026-09-10T00:00:00.000Z'),
        }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.team.doneOnTime).toBe(1);
      expect(kpi.team.doneLate).toBe(0);
      expect(kpi.team.onTimeRate).toBe(100);
    });

    it('doneOnTime: битые даты исключаются из счёта (не late, onTimeRate null)', async () => {
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'b1', status: DevTaskStatus.DONE, deadline: 'мусор' as any, completedAt: new Date() }),
        makeTask({ id: 'b2', status: DevTaskStatus.DONE, deadline: new Date(), completedAt: 'мусор' as any }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.team.doneOnTime).toBe(0);
      expect(kpi.team.doneLate).toBe(0);
      expect(kpi.team.onTimeRate).toBeNull();
    });

    it('avgCycleDays: битый createdAt даёт null, а не NaN; валидные считаются', async () => {
      const now = new Date();
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'c1', status: DevTaskStatus.DONE, completedAt: now, createdAt: 'мусор' as any }),
      ]);

      expect((await service.getKpi()).team.avgCycleDays).toBeNull();

      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'c1', status: DevTaskStatus.DONE, completedAt: now, createdAt: 'мусор' as any }),
        makeTask({
          id: 'c2', status: DevTaskStatus.DONE,
          completedAt: now,
          createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        }),
      ]);

      expect((await service.getKpi()).team.avgCycleDays).toBe(4);
    });

    it('velocity: неделя режется по Душанбе (пн 00:30 +05 = вс 19:30 UTC)', async () => {
      const mondayKey = dushanbeMondayOf(new Date());
      // Понедельник 00:30 по Душанбе — воскресенье 19:30 UTC (прошлая UTC-неделя).
      const completedAt = new Date(`${mondayKey}T00:30:00+05:00`);
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'v-dush', status: DevTaskStatus.DONE, completedAt, storyPoints: 3 } as any),
      ]);

      const kpi = await service.getKpi();
      const weeks = kpi.velocity as any[];
      const week = weeks.find(w => w.week === mondayKey);

      expect(week).toBeDefined();
      expect(week.count).toBe(1);
      expect(week.points).toBe(3);
      expect(weeks.reduce((s, w) => s + w.count, 0)).toBe(1);
    });

    it('velocity: битые storyPoints (NaN/null) не травят points в NaN', async () => {
      const now = new Date();
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 's1', status: DevTaskStatus.DONE, completedAt: now, storyPoints: NaN }),
        makeTask({ id: 's2', status: DevTaskStatus.DONE, completedAt: now, storyPoints: null as any } as any),
      ]);

      const kpi = await service.getKpi();
      const weeks = kpi.velocity as any[];

      expect(weeks.reduce((s, w) => s + w.count, 0)).toBe(2);
      const totalPoints = weeks.reduce((s, w) => s + w.points, 0);
      expect(totalPoints).toBe(0);
      expect(Number.isFinite(totalPoints)).toBe(true);
    });

    it('burndown: бакеты по Душанбе; done только для DONE; open не уходит в минус', async () => {
      const start = dushanbeStartOfToday();
      const todayKey = dushanbeDay(new Date());
      taskRepo.find.mockResolvedValue([
        // создано сегодня 00:30 Душанбе (= вчера 19:30 UTC)
        makeTask({ id: 'c1', status: DevTaskStatus.TODO, createdAt: new Date(start.getTime() + 30 * 60 * 1000) } as any),
        // открытая задача с несброшенным completedAt — в done не идёт
        makeTask({
          id: 'c2', status: DevTaskStatus.TODO,
          createdAt: new Date(start.getTime() - 10 * 24 * 60 * 60 * 1000),
          completedAt: new Date(),
        } as any),
        // completed раньше created (битые данные): done до окна, created в окне
        makeTask({
          id: 'c3', status: DevTaskStatus.DONE,
          createdAt: new Date(start.getTime() - 5 * 24 * 60 * 60 * 1000),
          completedAt: new Date(start.getTime() - 40 * 24 * 60 * 60 * 1000),
        } as any),
      ]);

      const kpi = await service.getKpi();
      const days = kpi.burndown as any[];
      const byDay = new Map(days.map(d => [d.day, d]));

      expect(byDay.get(todayKey).created).toBe(1);
      expect(days.reduce((s, d) => s + d.done, 0)).toBe(0);
      for (const d of days) {
        expect(d.open).toBeGreaterThanOrEqual(0);
      }
    });

    it('flow: дневные бакеты по Душанбе (создание)', async () => {
      const start = dushanbeStartOfToday();
      const todayKey = dushanbeDay(new Date());
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 'f1', status: DevTaskStatus.TODO, createdAt: new Date(start.getTime() + 30 * 60 * 1000) } as any),
      ]);
      historyRepo.find.mockResolvedValue([]);

      const flow = await service.getFlow(7);

      expect(flow).toHaveLength(7);
      expect(flow[flow.length - 1].day).toBe(todayKey);
      expect((flow[flow.length - 1] as any).todo).toBe(1);
      // вчера по Душанбе задача ещё не была создана
      const prev = flow[flow.length - 2] as any;
      expect(prev.todo).toBe(0);
      expect(prev.backlog + prev.in_progress + prev.in_review + prev.testing + prev.done).toBe(0);
    });

    it('flow: переход в 00:10 по Душанбе относится к сегодняшнему дню', async () => {
      const start = dushanbeStartOfToday();
      // сегодня 00:10 Душанбе = вчера 19:10 UTC: UTC-EOD уже отнёс бы переход ко вчера
      const at = new Date(start.getTime() + 10 * 60 * 1000);
      taskRepo.find.mockResolvedValue([
        makeTask({
          id: 'f2', status: DevTaskStatus.DONE,
          createdAt: new Date(start.getTime() - 10 * 24 * 60 * 60 * 1000),
        } as any),
      ]);
      historyRepo.find.mockResolvedValue([
        { id: 'h1', taskId: 'f2', field: 'status', from: 'todo', to: 'done', createdAt: at },
      ]);

      const flow = await service.getFlow(7);
      const prev = flow[flow.length - 2] as any;
      const last = flow[flow.length - 1] as any;

      expect(prev.todo).toBe(1);
      expect(prev.done).toBe(0);
      expect(last.done).toBe(1);
    });

    it('slaBreached: дедлайн ровно в полночь Душанбе — не breach; минутой раньше — breach', async () => {
      const start = dushanbeStartOfToday();
      const old = new Date(start.getTime() - 10 * 24 * 60 * 60 * 1000);
      taskRepo.find.mockResolvedValue([
        makeTask({ id: 's1', status: DevTaskStatus.TODO, deadline: new Date(start.getTime()), createdAt: old }),
        makeTask({ id: 's2', status: DevTaskStatus.TODO, deadline: new Date(start.getTime() - 1), createdAt: old }),
      ]);

      const kpi = await service.getKpi();

      expect(kpi.team.slaBreached).toBe(1);
      expect(kpi.team.overdue).toBe(1);
    });
  });

  // ─── Аудит-фиксы (ревью 2026-09): каждый фикс сервиса покрыт тестом ниже ──

  describe('аудит: report velocity не травится NaN', () => {
    const SPRINT = '22222222-3333-4444-5555-666666666666';
    const PROJECT = '44444444-5555-6666-7777-888888888888';
    const doneNaN = (overrides: any = {}) =>
      makeTask({
        status: DevTaskStatus.DONE,
        completedAt: new Date(),
        storyPoints: NaN,
        ...overrides,
      } as any);

    it('week: NaN/null storyPoints дают 0, а не NaN', async () => {
      taskRepo.find.mockResolvedValue([
        doneNaN({ id: 'w1' }),
        doneNaN({ id: 'w2', storyPoints: null }),
        doneNaN({ id: 'w3', storyPoints: 5 }),
      ]);

      const rep = await service.getReport({ type: 'week', days: 7 });

      expect(rep.stats.done).toBe(3);
      expect(rep.velocity).toBe(5);
      expect(Number.isFinite(rep.velocity)).toBe(true);
    });

    it('sprint: velocity scope считается через safeStoryPoints', async () => {
      sprintRepo.findOne.mockResolvedValue({ id: SPRINT, name: 'S1' });
      taskRepo.find.mockResolvedValue([
        doneNaN({ id: 's1', sprintId: SPRINT }),
        doneNaN({ id: 's2', sprintId: 'other-sprint', storyPoints: 8 }),
      ]);

      const rep = await service.getReport({ type: 'sprint', sprintId: SPRINT });

      expect(rep.stats.done).toBe(1);
      expect(rep.velocity).toBe(0);
    });

    it('project: velocity scope считается через safeStoryPoints', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT, name: 'P1' });
      taskRepo.find.mockResolvedValue([
        doneNaN({ id: 'p1', projectId: PROJECT }),
      ]);

      const rep = await service.getReport({ type: 'project', projectId: PROJECT });

      expect(rep.stats.done).toBe(1);
      expect(rep.velocity).toBe(0);
      expect(Number.isFinite(rep.velocity)).toBe(true);
    });
  });

  describe('аудит: createWebhook projectId', () => {
    const PROJECT = '44444444-5555-6666-7777-888888888888';

    beforeEach(() => {
      webhookRepo.create.mockImplementation((dto: any) => ({ id: 'sub-9', ...dto }));
      webhookRepo.save.mockImplementation(async (e: any) => e);
    });

    it('400 на мусорный projectId (молчаливая немая подписка раньше сохранялась)', async () => {
      projectRepo.findOne.mockClear();

      await expect(
        service.createWebhook({ url: 'https://hooks.example.com/x', events: ['task.done'], projectId: 'мусор' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(projectRepo.findOne).not.toHaveBeenCalled();
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });

    it('404 на несуществующий проект', async () => {
      projectRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.createWebhook({ url: 'https://hooks.example.com/x', events: ['task.done'], projectId: PROJECT }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });

    it('ок на существующий проект и на null (все проекты)', async () => {
      projectRepo.findOne.mockResolvedValue({ id: PROJECT, name: 'P1' });

      const scoped = await service.createWebhook(
        { url: 'https://hooks.example.com/x', events: ['task.done'], projectId: PROJECT },
        'admin-1',
      );
      expect(scoped).toMatchObject({ projectId: PROJECT });

      projectRepo.findOne.mockClear();
      const all = await service.createWebhook(
        { url: 'https://hooks.example.com/x', events: ['task.done'], projectId: null },
        'admin-1',
      );
      expect(all).toMatchObject({ projectId: null });
      expect(projectRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('аудит: строгие даты спринта', () => {
    const S = '22222222-3333-4444-5555-666666666666';

    it("create: '2026-02-30' → 400 (раньше откатывалось в 2 марта)", async () => {
      sprintRepo.create.mockClear();

      await expect(
        service.createSprint({ name: 'S', startDate: '2026-02-30', endDate: '2026-03-05' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(sprintRepo.create).not.toHaveBeenCalled();
    });

    it('create: start позже end → 400', async () => {
      sprintRepo.create.mockClear();

      await expect(
        service.createSprint({ name: 'S', startDate: '2026-03-10', endDate: '2026-03-05' }, 'admin-1'),
      ).rejects.toThrow('позже даты окончания');
      expect(sprintRepo.create).not.toHaveBeenCalled();
    });

    it('create: валидные даты проходят', async () => {
      sprintRepo.create.mockImplementation((dto: any) => ({ id: S, ...dto }));
      sprintRepo.save.mockImplementation(async (e: any) => e);

      const s = await service.createSprint({ name: 'S', startDate: '2026-03-01', endDate: '2026-03-14' }, 'admin-1');

      expect(s).toMatchObject({ name: 'S' });
      expect(sprintRepo.save).toHaveBeenCalled();
    });

    it('update: невозможный день и инверсия диапазона → 400', async () => {
      sprintRepo.findOne.mockResolvedValue({
        id: S, startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'),
      });
      sprintRepo.update.mockClear();

      await expect(service.updateSprint(S, { startDate: '2026-02-30' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.updateSprint(S, { endDate: '2025-12-31' })).rejects.toThrow(
        'позже даты окончания',
      );
      expect(sprintRepo.update).not.toHaveBeenCalled();
    });

    it('update: rename без касания дат не упирается в диапазон', async () => {
      sprintRepo.findOne.mockResolvedValue({
        id: S, startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'),
      });
      sprintRepo.update.mockResolvedValue(undefined);

      await service.updateSprint(S, { name: 'Новое' });

      expect(sprintRepo.update).toHaveBeenCalledWith(S, expect.objectContaining({ name: 'Новое' }));
    });
  });

  describe('аудит: строгие даты задачи (deadline/startDate)', () => {
    it("create/update: '2026-02-30' → 400, а не откат в март", async () => {
      taskRepo.create.mockClear();

      await expect(
        service.create({ title: 'x', deadline: '2026-02-30' }, 'admin-1'),
      ).rejects.toThrow('Некорректная дата в поле deadline');
      expect(taskRepo.create).not.toHaveBeenCalled();

      taskRepo.findOne.mockResolvedValue(makeTask());
      taskRepo.update.mockClear();

      await expect(service.update('dev-task-1', { deadline: '2026-02-30' } as any)).rejects.toThrow(
        'Некорректная дата в поле deadline',
      );
      await expect(service.update('dev-task-1', { startDate: '2026-02-30' } as any)).rejects.toThrow(
        'Некорректная дата в поле startDate',
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('datetime с временем проходит, пустая строка открепляет', async () => {
      const task = makeTask();
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: 'dt-1' }));
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);

      await service.create({ title: 'x', deadline: '2026-05-01T10:00:00.000Z' }, 'admin-1');

      const arg = taskRepo.create.mock.calls[0][0];
      expect(arg.deadline).toBeInstanceOf(Date);
      expect((arg.deadline as Date).toISOString()).toBe('2026-05-01T10:00:00.000Z');

      taskRepo.update.mockResolvedValue(undefined);
      await service.update('dev-task-1', { deadline: '' } as any);
      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ deadline: null }),
      );
    });
  });

  describe('аудит: NOT NULL скаляры (title/position/storyPoints/isBlocked)', () => {
    it('create: пустой title, null storyPoints/position/isBlocked → 400 без save', async () => {
      taskRepo.create.mockClear();

      await expect(service.create({ title: '   ' }, 'admin-1')).rejects.toThrow(
        'Некорректное название задачи',
      );
      await expect(service.create({} as any, 'admin-1')).rejects.toThrow(
        'Некорректное название задачи',
      );
      await expect(service.create({ title: 'x', storyPoints: null } as any, 'admin-1')).rejects.toThrow(
        'storyPoints',
      );
      await expect(service.create({ title: 'x', storyPoints: 101 } as any, 'admin-1')).rejects.toThrow(
        'storyPoints',
      );
      await expect(service.create({ title: 'x', position: null } as any, 'admin-1')).rejects.toThrow(
        'Некорректная позиция',
      );
      await expect(service.create({ title: 'x', isBlocked: 'yes' } as any, 'admin-1')).rejects.toThrow(
        'isBlocked',
      );
      expect(taskRepo.create).not.toHaveBeenCalled();
    });

    it('update: title/isBlocked null, storyPoints 1.5 → 400 без update', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask());
      taskRepo.update.mockClear();

      await expect(service.update('dev-task-1', { title: null } as any)).rejects.toThrow(
        'Некорректное название задачи',
      );
      await expect(service.update('dev-task-1', { isBlocked: null } as any)).rejects.toThrow(
        'isBlocked',
      );
      await expect(service.update('dev-task-1', { storyPoints: 1.5 } as any)).rejects.toThrow(
        'storyPoints',
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });

    it('create/update: null-тело → 400 (а не TypeError 500)', async () => {
      taskRepo.findOne.mockClear();

      await expect(service.create(null as any, 'admin-1')).rejects.toThrow(BadRequestException);
      await expect(service.update('dev-task-1', null as any)).rejects.toThrow(BadRequestException);
      expect(taskRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('аудит: findAll гарды типов', () => {
    it('tags не-массив, search не-строка, blocked не-boolean → 400', async () => {
      await expect(service.findAll({ tags: 'nope' as any })).rejects.toThrow('Некорректные теги');
      await expect(service.findAll({ search: 5 as any })).rejects.toThrow(
        'Некорректный поисковый запрос',
      );
      await expect(service.findAll({ blocked: 'yes' as any })).rejects.toThrow(
        'Некорректный фильтр blocked',
      );
      expect(taskRepo.createQueryBuilder().getMany).not.toHaveBeenCalled();
    });
  });

  describe('аудит: addComment тип текста', () => {
    it('не-строка → 400 (раньше .trim() ронял 500)', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask());
      commentRepo.create.mockClear();

      await expect(service.addComment('dev-task-1', 'user-2', 5 as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(commentRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('аудит: sprint=null/пустой фильтры (контракт H)', () => {
    it('null → IS NULL (вне спринтов), пустой → без sprint-фильтра', async () => {
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      (qb.andWhere as jest.Mock).mockClear();

      await service.findAll({ sprintId: null });
      expect(qb.andWhere).toHaveBeenCalledWith('task.sprintId IS NULL');

      (qb.andWhere as jest.Mock).mockClear();
      await service.findAll({ sprintId: '' as any });
      const calls = (qb.andWhere as jest.Mock).mock.calls;
      expect(calls.some((c: any[]) => String(c[0]).includes('sprintId'))).toBe(false);
    });
  });

  describe('аудит: webhook HMAC-подпись', () => {
    it('secret → X-Dev-Signature = hex(HMAC-SHA256(secret, rawBody)); без secret — без заголовка', async () => {
      const http = await import('http');
      const { createHmac } = await import('crypto');
      let lastHeaders: Record<string, any> = {};
      let lastBody = '';
      const server = http.createServer((req, res) => {
        lastHeaders = req.headers as Record<string, any>;
        let buf = '';
        req.on('data', (c: any) => { buf += c; });
        req.on('end', () => { lastBody = buf; res.statusCode = 200; res.end('ok'); });
      });
      await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
      const port = (server.address() as any).port;
      try {
        const url = `http://127.0.0.1:${port}/hook`;
        const payload = { event: 'task.done', taskId: 't1' };

        const r1 = await (service as any).postWebhook(url, payload, 's3cr3t');
        expect(r1).toEqual({ status: 200 });
        const expected = createHmac('sha256', 's3cr3t').update(JSON.stringify(payload)).digest('hex');
        expect(lastHeaders['x-dev-signature']).toBe(expected);
        // Подпись считается именно от rawBody, ушедшего по сети.
        expect(lastHeaders['x-dev-signature']).toBe(
          createHmac('sha256', 's3cr3t').update(lastBody).digest('hex'),
        );

        const r2 = await (service as any).postWebhook(url, payload, null);
        expect(r2).toEqual({ status: 200 });
        expect(lastHeaders['x-dev-signature']).toBeUndefined();
      } finally {
        await new Promise(r => server.close(r));
      }
    });
  });

  describe('аудит: webhook ретраи (best-effort ~1 и ~5 мин)', () => {
    it('первая неудача планирует повторы через 60с и ещё через 4 мин', async () => {
      jest.useFakeTimers();
      try {
        const post = jest.fn()
          .mockRejectedValueOnce(new Error('down-1'))
          .mockRejectedValueOnce(new Error('down-2'))
          .mockResolvedValue({ status: 200 });
        (service as any).postWebhook = post;

        const first = await (service as any).deliverWithRetry(
          { id: 's1', url: 'http://127.0.0.1/hook', secret: null },
          'task.done',
          { event: 'task.done' },
        );

        expect(first).toEqual({ ok: false, status: 0 });
        expect(post).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(60_000);
        expect(post).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(4 * 60_000);
        expect(post).toHaveBeenCalledTimes(3);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ─── QA-аудит 2026-09-25: баги/уязвимости (каждый фикс сервиса покрыт) ──

  describe('QA 2026-09-25: bulk ids UUID + дедуп + тип value', () => {
    const B1 = '11111111-1111-4111-8111-111111111111';
    const B2 = '22222222-2222-4222-8222-222222222222';
    it('400 на мусорный id (раньше 500 invalid input syntax for type uuid)', async () => {
      taskRepo.delete.mockClear();
      await expect(service.bulk(['мусор'], 'delete', '')).rejects.toThrow('Некорректный id задачи');
      await expect(service.bulk([B1, 'not-a-uuid'], 'delete', '')).rejects.toThrow(
        'Некорректный id задачи',
      );
      await expect(service.bulk([123 as any], 'delete', '')).rejects.toThrow(
        'Некорректный id задачи',
      );
      expect(taskRepo.delete).not.toHaveBeenCalled();
    });
    it('дедуп: дубли не раздувают работу', async () => {
      const t = makeTask({ id: B1, status: DevTaskStatus.TODO });
      taskRepo.find.mockResolvedValue([t]);
      taskRepo.update.mockResolvedValue({});
      const res = await service.bulk([B1, B1, B1], 'status', DevTaskStatus.DONE);
      expect(res.updated).toBe(1);
      expect(taskRepo.update).toHaveBeenCalledTimes(1);
    });
    it('400 на не-строку value (раньше коэрсия/500)', async () => {
      taskRepo.update.mockClear();
      await expect(service.bulk([B1], 'status', 5 as any)).rejects.toThrow(
        'Некорректное значение',
      );
      await expect(service.bulk([B1], 'priority' as any, { x: 1 } as any)).rejects.toThrow(
        'Некорректное значение',
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
    it('частичность: несуществующие id игнорируются, updated считает найденные', async () => {
      const t = makeTask({ id: B1, status: DevTaskStatus.TODO });
      taskRepo.find.mockResolvedValue([t]); // B2 отсутствует в БД
      taskRepo.update.mockResolvedValue({});
      const res = await service.bulk([B1, B2], 'status', DevTaskStatus.DONE);
      expect(res).toEqual({ updated: 1, deleted: 0 });
    });
  });

  describe('QA 2026-09-25: triage гарды типов', () => {
    it('400 на не-строку assigneeId (раньше .trim() давал 500)', async () => {
      taskRepo.update.mockClear();
      await expect(service.triageOverdue({ assigneeId: 5 as any }, 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
    it('400 на не-объект opts (раньше молча брал actorId)', async () => {
      await expect(service.triageOverdue('x' as any, 'actor-1')).rejects.toThrow(
        'Некорректные параметры триажа',
      );
    });
    it('400 на мусорный projectId-скоуп (раньше тихий assigned:0)', async () => {
      taskRepo.update.mockClear();
      const ACTOR = '123e4567-e89b-12d3-a456-426614174000';
      await expect(service.triageOverdue({ projectId: 'мусор' }, ACTOR)).rejects.toThrow(
        'Некорректный projectId',
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('QA 2026-09-25: create FK пустые строки', () => {
    it("create: parentTaskId '' → 400 (раньше 500 в uuid-колонку)", async () => {
      taskRepo.create.mockClear();
      await expect(service.create({ title: 'x', parentTaskId: '' } as any, 'admin-1')).rejects.toThrow(
        'Некорректный id родительской задачи',
      );
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it("create: assigneeId '' → 400 (раньше тихая запись '')", async () => {
      taskRepo.create.mockClear();
      await expect(service.create({ title: 'x', assigneeId: '' } as any, 'admin-1')).rejects.toThrow(
        'Исполнитель не найден',
      );
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it("create: projectId '' → 400", async () => {
      taskRepo.create.mockClear();
      await expect(service.create({ title: 'x', projectId: '' } as any, 'admin-1')).rejects.toThrow(
        'Проект не найден',
      );
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it('create: title trim перед записью', async () => {
      const task = makeTask();
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: 'n1' }));
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);
      await service.create({ title: '  spaced  ' }, 'admin-1');
      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'spaced' }));
    });
  });

  describe('QA 2026-09-25: tags/attachments/description/blockedReason лимиты', () => {
    it('create: 11 тегов → 400 (обход DTO через прямой вызов)', async () => {
      taskRepo.create.mockClear();
      await expect(
        service.create({ title: 'x', tags: Array(11).fill('a') } as any, 'admin-1'),
      ).rejects.toThrow('Слишком много тегов');
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it('create: тег >50 и не-строка → 400', async () => {
      taskRepo.create.mockClear();
      await expect(service.create({ title: 'x', tags: ['x'.repeat(51)] } as any, 'admin-1')).rejects.toThrow(
        'Тег слишком длинный',
      );
      await expect(service.create({ title: 'x', tags: [5] } as any, 'admin-1')).rejects.toThrow(
        'Некорректные теги',
      );
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it('create: tags trim+дедуп перед записью', async () => {
      const task = makeTask();
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: 'n2' }));
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);
      await service.create({ title: 'x', tags: [' b ', 'b', 'a', ''] } as any, 'admin-1');
      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ tags: ['b', 'a'] }));
    });
    it('create: attachments javascript:/не-http → 400 (stored-XSS)', async () => {
      taskRepo.create.mockClear();
      await expect(
        service.create({ title: 'x', attachments: ['javascript:alert(1)'] } as any, 'admin-1'),
      ).rejects.toThrow('http(s)-URL');
      await expect(
        service.create({ title: 'x', attachments: ['data:text/html,hi'] } as any, 'admin-1'),
      ).rejects.toThrow('http(s)-URL');
      await expect(
        service.create({ title: 'x', attachments: Array(11).fill('https://a/b.png') } as any, 'admin-1'),
      ).rejects.toThrow('Слишком много вложений');
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it('create: attachments trim, http проходит', async () => {
      const task = makeTask();
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: 'n3' }));
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.find.mockResolvedValue([]);
      await service.create(
        { title: 'x', attachments: ['  https://example.com/a.png  '] } as any,
        'admin-1',
      );
      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: ['https://example.com/a.png'] }),
      );
    });
    it('create/update: description >10000 и не-строка → 400', async () => {
      taskRepo.create.mockClear();
      await expect(
        service.create({ title: 'x', description: 'y'.repeat(10001) } as any, 'admin-1'),
      ).rejects.toThrow('Описание');
      await expect(service.create({ title: 'x', description: 5 } as any, 'admin-1')).rejects.toThrow(
        'Некорректное описание',
      );
      expect(taskRepo.create).not.toHaveBeenCalled();
      taskRepo.findOne.mockResolvedValue(makeTask());
      taskRepo.update.mockClear();
      await expect(service.update('dev-task-1', { description: 5 } as any)).rejects.toThrow(
        'Некорректное описание',
      );
      expect(taskRepo.update).not.toHaveBeenCalled();
    });
    it('blockedReason не-строка → 400 (раньше String()-коэрсия)', async () => {
      taskRepo.create.mockClear();
      await expect(
        service.create({ title: 'x', blockedReason: 5 } as any, 'admin-1'),
      ).rejects.toThrow('Некорректная причина блокировки');
      expect(taskRepo.create).not.toHaveBeenCalled();
    });
    it('update: tags санитизируются в patch', async () => {
      const task = makeTask();
      taskRepo.findOne.mockResolvedValue(task);
      taskRepo.update.mockResolvedValue(undefined);
      await service.update('dev-task-1', { tags: [' x ', 'x'] } as any);
      expect(taskRepo.update).toHaveBeenCalledWith(
        'dev-task-1',
        expect.objectContaining({ tags: ['x'] }),
      );
    });
  });

  describe('QA 2026-09-25: views фильтры и имена', () => {
    it('createView: имя числом → 400 (раньше .trim() давал 500)', async () => {
      viewRepo.save.mockClear();
      await expect(service.createView('me', { name: 5 as any })).rejects.toThrow(
        'Название представления',
      );
      expect(viewRepo.save).not.toHaveBeenCalled();
    });
    it('createView: groupBy числом → 400', async () => {
      await expect(service.createView('me', { name: 'ok', groupBy: 5 as any })).rejects.toThrow(
        'Некорректная группировка',
      );
    });
    it('createView: >20 ключей → 400', async () => {
      const filters: any = {};
      for (let i = 0; i < 21; i++) filters[`k${i}`] = 1;
      await expect(service.createView('me', { name: 'ok', filters })).rejects.toThrow(
        'Слишком много фильтров',
      );
    });
    it('createView: __proto__ и глубокая вложенность → 400', async () => {
      // { __proto__: 1 } литералом прототип не создаёт own-key — берём через JSON.parse.
      const protoPollution = JSON.parse('{"__proto__":1}');
      await expect(
        service.createView('me', { name: 'ok', filters: protoPollution }),
      ).rejects.toThrow(BadRequestException);
      let deep: any = { a: 1 };
      for (let i = 0; i < 7; i++) deep = { nest: deep };
      await expect(service.createView('me', { name: 'ok', filters: deep })).rejects.toThrow(
        'слишком вложенные',
      );
    });
    it('createView: >10КБ JSON → 400', async () => {
      await expect(
        service.createView('me', { name: 'ok', filters: { big: 'x'.repeat(11 * 1024) } }),
      ).rejects.toThrow('слишком большие');
    });
  });

  describe('QA 2026-09-25: спринты типы', () => {
    it('createSprint: имя числом → 400 (раньше .trim() давал 500)', async () => {
      sprintRepo.create.mockClear();
      await expect(
        service.createSprint({ name: 5 as any, startDate: '2026-03-01', endDate: '2026-03-14' }, 'a'),
      ).rejects.toThrow('Название спринта');
      expect(sprintRepo.create).not.toHaveBeenCalled();
    });
    it('create/updateSprint: goal числом → 400 (раньше String()-коэрсия в text)', async () => {
      sprintRepo.create.mockClear();
      await expect(
        service.createSprint(
          { name: 'S', goal: 5 as any, startDate: '2026-03-01', endDate: '2026-03-14' },
          'a',
        ),
      ).rejects.toThrow('Некорректная цель');
      expect(sprintRepo.create).not.toHaveBeenCalled();
      sprintRepo.findOne.mockResolvedValue({ id: 's', startDate: new Date(), endDate: new Date() });
      sprintRepo.update.mockClear();
      await expect(service.updateSprint('s', { goal: 5 as any })).rejects.toThrow(
        'Некорректная цель',
      );
      await expect(service.updateSprint('s', { name: 5 as any })).rejects.toThrow(
        'Название спринта',
      );
      expect(sprintRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('QA 2026-09-25: webhooks SSRF + типы + secret', () => {
    beforeEach(() => {
      webhookRepo.create.mockImplementation((dto: any) => ({ id: 'sub-9', ...dto }));
      webhookRepo.save.mockImplementation(async (e: any) => e);
    });
    it('createWebhook: url числом → 400 (раньше .trim() давал 500)', async () => {
      webhookRepo.save.mockClear();
      await expect(
        service.createWebhook({ url: 5 as any, events: ['task.done'] }, 'a'),
      ).rejects.toThrow('Некорректный URL');
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });
    it('createWebhook: приватные хосты/metadata/userinfo → 400 (SSRF)', async () => {
      webhookRepo.save.mockClear();
      await expect(
        service.createWebhook({ url: 'http://169.254.169.254/latest', events: ['task.done'] }, 'a'),
      ).rejects.toThrow('внутренний адрес');
      await expect(
        service.createWebhook({ url: 'http://10.0.0.5/hook', events: ['task.done'] }, 'a'),
      ).rejects.toThrow('внутренний адрес');
      await expect(
        service.createWebhook({ url: 'http://192.168.1.1/hook', events: ['task.done'] }, 'a'),
      ).rejects.toThrow('внутренний адрес');
      await expect(
        service.createWebhook({ url: 'http://user:pass@example.com/hook', events: ['task.done'] }, 'a'),
      ).rejects.toThrow('credentials');
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });
    it('createWebhook: secret числом и isActive строкой → 400', async () => {
      webhookRepo.save.mockClear();
      await expect(
        service.createWebhook(
          { url: 'https://hooks.example.com/x', events: ['task.done'], secret: 5 as any },
          'a',
        ),
      ).rejects.toThrow('Некорректный секрет');
      await expect(
        service.createWebhook(
          { url: 'https://hooks.example.com/x', events: ['task.done'], isActive: 'yes' as any },
          'a',
        ),
      ).rejects.toThrow('isActive');
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });
    it('listWebhooks: secret наружу не отдаём', async () => {
      webhookRepo.find.mockResolvedValue([
        { id: 's1', url: 'https://a/b', secret: 's3cr3t', events: ['task.done'] },
      ] as any);
      const rows = await service.listWebhooks();
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).secret).toBeUndefined();
      expect((rows[0] as any).url).toBe('https://a/b');
    });
    it('postWebhook: metadata-IP режется и на низком уровне', async () => {
      await expect(
        (service as any).postWebhook('http://169.254.169.254/x', { a: 1 }, null),
      ).rejects.toThrow('internal address');
    });
  });

  describe('QA 2026-09-25: search ESCAPE + tags кап + clone гарды', () => {
    it('findAll: ILIKE с явным ESCAPE (экранирование %_ стабильно)', async () => {
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      (qb.andWhere as jest.Mock).mockClear();
      await service.findAll({ search: '100%_test\\x' });
      const calls = (qb.andWhere as jest.Mock).mock.calls;
      const searchCall = calls.find((c: any[]) => String(c[0]).includes('ILIKE'));
      expect(searchCall).toBeDefined();
      expect(String(searchCall[0])).toContain("ESCAPE '\\'");
      expect(searchCall[1].search).toBe('%100\\%\\_test\\\\x%');
    });
    it('findAll: простыня тегов режется до 20', async () => {
      const qb = taskRepo.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      (qb.andWhere as jest.Mock).mockClear();
      await service.findAll({ tags: Array(30).fill('a').map((v, i) => `${v}${i}`) });
      const calls = (qb.andWhere as jest.Mock).mock.calls;
      const tagsCall = calls.find((c: any[]) => c[0] === 'task.tags && :tags');
      expect(tagsCall).toBeDefined();
      expect(tagsCall[1].tags).toHaveLength(20);
    });
    it('clone: withSubtasks строкой → 400 (раньше truthy "false" клонировал)', async () => {
      taskRepo.findOne.mockResolvedValue(makeTask({ id: 'orig-1' }));
      await expect(service.clone('orig-1', 'a', 'false' as any)).rejects.toThrow(
        'withSubtasks',
      );
    });
    it('clone: >100 детей → 400 (DoS-кап)', async () => {
      const orig = makeTask({ id: 'orig-1' });
      taskRepo.findOne.mockResolvedValue(orig);
      taskRepo.create.mockImplementation((dto: any) => ({ ...dto, id: 'new-1' }));
      taskRepo.save.mockImplementation(async (e: any) => e);
      taskRepo.find.mockResolvedValue(
        Array(101).fill(null).map((_, i) => makeTask({ id: `c${i}`, parentTaskId: 'orig-1' })),
      );
      await expect(service.clone('orig-1', 'a', true)).rejects.toThrow('Слишком много подзадач');
    });
  });
});
