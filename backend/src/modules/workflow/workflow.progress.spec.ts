import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkflowService } from './workflow.service';
import { WorkflowCard } from './workflow-card.entity';
import { ShootSession } from './shoot-session.entity';
import { UnitEvent } from './unit-event.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { AppGateway } from '../gateway/app.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { MailService } from '../mail/mail.service';

// Прогресс карточек доски (progressPct): единая шкала общего порядка этапов
// (WorkflowService#computeProgressMap / stageProgressPct, приватные — тест
// бьёт напрямую по (service as any) без раздувания мока на весь конвейер).
// content_plan 0 · organization 14 · shooting 29 · editing/design 43 ·
// internal_review 57 · client_approval 71 · ready_to_publish 86 · published/ads 100.
const mockRepo = () => ({
  manager: { query: jest.fn() },
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((x: any) => x),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

// Минимальная карточка — только поля, которые читает computeProgressMap.
const card = (over: Partial<WorkflowCard> & { id: string }): WorkflowCard => ({
  projectId: 'p1',
  kind: null,
  type: null,
  stage: 'content_plan',
  items: null,
  ...over,
} as WorkflowCard);

describe('WorkflowService — прогресс карточек (computeProgressMap)', () => {
  let service: WorkflowService;

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
  });

  const compute = (cards: WorkflowCard[]): Map<string, number> =>
    (service as any).computeProgressMap(cards);

  it('одиночная/групповая карточка — процент по шкале ранга своего этапа', () => {
    const cards = [
      card({ id: 'a', stage: 'content_plan' }),
      card({ id: 'b', stage: 'organization' }),
      card({ id: 'c', stage: 'shooting' }),
      card({ id: 'd', stage: 'editing' }),
      card({ id: 'e', stage: 'design' }),
      card({ id: 'f', stage: 'internal_review' }),
      card({ id: 'g', stage: 'client_approval' }),
      card({ id: 'h', stage: 'ready_to_publish' }),
      card({ id: 'i', stage: 'published' }),
      card({ id: 'j', stage: 'ads' }),
    ];
    const map = compute(cards);
    expect(map.get('a')).toBe(0);
    expect(map.get('b')).toBe(14);
    expect(map.get('c')).toBe(29);
    expect(map.get('d')).toBe(43);
    expect(map.get('e')).toBe(43); // editing и design — один ранг
    expect(map.get('f')).toBe(57);
    expect(map.get('g')).toBe(71);
    expect(map.get('h')).toBe(86);
    expect(map.get('i')).toBe(100);
    expect(map.get('j')).toBe(100); // ads — тот же ранг, что и published
  });

  it('неизвестный/пустой этап не роняет расчёт — 0%', () => {
    const map = compute([card({ id: 'x', stage: 'no-such-stage' })]);
    expect(map.get('x')).toBe(0);
  });

  it('КП = среднее по всем единицам содержимого проекта: 4 рилса (shooting=29) + 3 макета (design=43) → 35%', () => {
    const reels = card({
      id: 'reels-group', kind: 'reels', stage: 'shooting',
      items: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }] as any,
    });
    const macros = card({
      id: 'macros-group', kind: 'macros', stage: 'design',
      items: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] as any,
    });
    const kp = card({ id: 'kp-1', kind: 'kp', stage: 'content_plan' });
    const map = compute([reels, macros, kp]);
    expect(map.get('reels-group')).toBe(29);
    expect(map.get('macros-group')).toBe(43);
    // (4*29 + 3*43) / 7 = 245/7 = 35 — веса по количеству единиц, а НЕ простое
    // среднее групп ((29+43)/2=36, это была бы ошибка).
    expect(map.get('kp-1')).toBe(35);
  });

  it('все единицы дошли до «Опубликовано» → КП 100%, ни на процент меньше', () => {
    const reels = card({ id: 'r', kind: 'reels', stage: 'published', items: [{ id: 'r1' }, { id: 'r2' }] as any });
    const macros = card({ id: 'm', kind: 'macros', stage: 'published', items: [{ id: 'm1' }] as any });
    const kp = card({ id: 'kp', kind: 'kp', stage: 'content_plan' });
    const map = compute([reels, macros, kp]);
    expect(map.get('kp')).toBe(100);
  });

  it('обложка (type=cover) НЕ учитывается как единица КП, но получает свой собственный процент', () => {
    const reel = card({ id: 'reel', stage: 'organization' }); // 14%
    const cover = card({ id: 'cover', type: 'cover', stage: 'design' }); // 43% — но не единица
    const kp = card({ id: 'kp', kind: 'kp', stage: 'content_plan' });
    const map = compute([reel, cover, kp]);
    expect(map.get('cover')).toBe(43); // сам процент считается
    // КП должен учитывать ТОЛЬКО reel (14%), а не среднее (14+43)/2=28.5→29.
    expect(map.get('kp')).toBe(14);
  });

  it('КП без единиц содержимого проекта → 0% (не NaN, не падает)', () => {
    const kp = card({ id: 'kp-empty', kind: 'kp', stage: 'content_plan' });
    const map = compute([kp]);
    expect(map.get('kp-empty')).toBe(0);
  });

  it('проект без КП: одиночные карточки получают свой процент, расчёт не падает', () => {
    const cards = [
      card({ id: 's1', stage: 'shooting' }),
      card({ id: 's2', stage: 'client_approval' }),
    ];
    const map = compute(cards);
    expect(map.get('s1')).toBe(29);
    expect(map.get('s2')).toBe(71);
  });

  it('элемент, вынесенный из группы (advanceItem), не задваивается и не теряется в среднем КП', () => {
    // Группа изначально: 3 элемента на shooting (29%). Один вынесен в
    // отдельную карточку на editing (43%) — как после advanceItem.
    const groupAfter = card({
      id: 'reels-group', kind: 'reels', stage: 'shooting',
      items: [{ id: 'r2' }, { id: 'r3' }] as any, // осталось 2 из 3
    });
    const spawned = card({ id: 'r1-spawned', stage: 'editing' }); // вынесенный элемент
    const kp = card({ id: 'kp', kind: 'kp', stage: 'content_plan' });
    const map = compute([groupAfter, spawned, kp]);
    // (29 + 29 + 43) / 3 = 101/3 = 33.67 → round 34; НЕ (29*3+43)/4 (задвоение)
    // и НЕ (29*2+43)/3=33.67 с потерянным элементом по ошибке — тут элементов
    // ровно 3: 2 в группе + 1 вынесенный.
    expect(map.get('kp')).toBe(34);
  });

  it('изолирует единицы РАЗНЫХ проектов друг от друга при расчёте КП (нет утечки между проектами)', () => {
    const kpA = card({ id: 'kp-A', projectId: 'projA', kind: 'kp', stage: 'content_plan' });
    const unitA = card({ id: 'unit-A', projectId: 'projA', stage: 'published' }); // 100%
    const kpB = card({ id: 'kp-B', projectId: 'projB', kind: 'kp', stage: 'content_plan' });
    const unitB = card({ id: 'unit-B', projectId: 'projB', stage: 'content_plan' }); // 0%
    const map = compute([kpA, unitA, kpB, unitB]);
    expect(map.get('kp-A')).toBe(100);
    expect(map.get('kp-B')).toBe(0);
  });

  it('пустая группа (items=[]) считается как минимум 1 единица (защита от деления на 0 / потери карточки)', () => {
    const emptyGroup = card({ id: 'g', kind: 'reels', stage: 'organization', items: [] as any });
    const kp = card({ id: 'kp', kind: 'kp', stage: 'content_plan' });
    const map = compute([emptyGroup, kp]);
    expect(map.get('g')).toBe(14);
    expect(map.get('kp')).toBe(14);
  });
});
