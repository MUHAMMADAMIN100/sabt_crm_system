import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkflowService } from './workflow.service';
import { WorkflowCard } from './workflow-card.entity';
import { ShootSession } from './shoot-session.entity';
import { UnitEvent } from './unit-event.entity';
import { Project, ProjectStatus } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { AppGateway } from '../gateway/app.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { MailService } from '../mail/mail.service';

// «Одноразовый дизайн/съёмка»: карточка без клиентского проекта складывается
// в служебный find-or-create проект (private WorkflowService#oneOffProjectId,
// sentinel projectId='one-off' резолвится в create()). Юнит-тесты бьют
// напрямую по приватному методу — так проверяем ядро логики (идемпотентность,
// анти-дубль-проект race, автовосстановление из архива) без раздувания мока
// на весь конвейер create()/logEvent()/notify*.
const mockRepo = () => ({
  manager: { query: jest.fn() },
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((x) => x),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe('WorkflowService — служебный проект «Одноразовые съёмки»', () => {
  let service: WorkflowService;
  let projectRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: getRepositoryToken(WorkflowCard), useFactory: mockRepo },
        { provide: getRepositoryToken(ShootSession), useFactory: mockRepo },
        { provide: getRepositoryToken(UnitEvent), useFactory: mockRepo },
        { provide: getRepositoryToken(Project), useFactory: mockRepo },
        { provide: getRepositoryToken(User), useFactory: mockRepo },
        { provide: getRepositoryToken(SmmTariff), useFactory: mockRepo },
        { provide: AppGateway, useValue: { broadcastToProject: jest.fn(), broadcastToUser: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: TelegramService, useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) } },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
    projectRepo = module.get(getRepositoryToken(Project));
  });

  const call = () => (service as any).oneOffProjectId() as Promise<string>;

  it('creates the service project (isOneOffSystem=true) on first use when none exists', async () => {
    projectRepo.findOne.mockResolvedValueOnce(null); // ничего не найдено
    projectRepo.save.mockResolvedValueOnce({ id: 'svc-1', isOneOffSystem: true, isArchived: false });

    const id = await call();

    expect(id).toBe('svc-1');
    expect(projectRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isOneOffSystem: true, status: ProjectStatus.IN_PROGRESS, storiesArchived: true }),
    );
    expect(projectRepo.save).toHaveBeenCalledTimes(1);
  });

  it('reuses the EXISTING service project on subsequent calls — no duplicate project is ever created', async () => {
    projectRepo.findOne.mockResolvedValueOnce({ id: 'svc-existing', isOneOffSystem: true, isArchived: false });

    const id = await call();

    expect(id).toBe('svc-existing');
    expect(projectRepo.save).not.toHaveBeenCalled();
    expect(projectRepo.create).not.toHaveBeenCalled();
  });

  it('un-archives the service project if it was manually archived, so new one-off cards stay visible on the board', async () => {
    projectRepo.findOne.mockResolvedValueOnce({ id: 'svc-archived', isOneOffSystem: true, isArchived: true });
    projectRepo.update.mockResolvedValueOnce(undefined);

    const id = await call();

    expect(id).toBe('svc-archived');
    expect(projectRepo.update).toHaveBeenCalledWith('svc-archived', { isArchived: false });
  });

  it('handles the concurrent-create race: save() throws (unique index collision) but a re-read finds the winner — returns its id instead of failing', async () => {
    projectRepo.findOne
      .mockResolvedValueOnce(null)                                       // первая проверка: ничего нет
      .mockResolvedValueOnce({ id: 'svc-winner', isOneOffSystem: true }); // повторное чтение после гонки: другой запрос уже создал
    projectRepo.save.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "ux_projects_one_off_system"'));

    const id = await call();

    expect(id).toBe('svc-winner');
  });

  it('surfaces a clean BadRequestException if the race-recovery re-read ALSO comes up empty (should not happen, but must not crash with a raw DB error)', async () => {
    projectRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    projectRepo.save.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

    await expect(call()).rejects.toThrow(BadRequestException);
  });
});
