import { FindOperator } from 'typeorm';
import { ContentPlanService } from './content-plan.service';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';

/** Уволенный сотрудник и карточки подготовки (21.11.2026). Случай с прода:
 *  дизайнера сделали неактивным, его 20 макетов остались на нём, и их не
 *  видел ни один дизайнер. Сервис без базы: репозитории — заглушки в памяти,
 *  условия where (включая In / Not(IsNull())) разбираются честно. */

const U = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const SAF = U(1);   // дизайнер, уходит
const AZAM = U(2);  // монтажёр, второй ролью дизайнер
const TEST = U(3);  // ещё один дизайнер
const BEH = U(4);   // видеограф, основной
const P1 = U(11);
const P2 = U(12);

const opMatch = (val: any, cond: any): boolean => {
  if (cond instanceof FindOperator) {
    switch (cond.type) {
      case 'in': return (cond.value as any[]).includes(val);
      case 'isNull': return val == null;
      case 'not': return !opMatch(val, cond.value);
      default: throw new Error(`оператор ${cond.type} в заглушке не описан`);
    }
  }
  return val === cond;
};
const matches = (row: any, where: any) => Object.entries(where).every(([k, c]) => opMatch(row[k], c));
const anyOf = (rows: any[], where: any) =>
  rows.filter(r => (Array.isArray(where) ? where : [where]).some((w: any) => matches(r, w)));

interface Setup {
  users: any[];
  items?: any[];
  projects?: any[];
  away?: string[];
}

function make({ users, items = [], projects = [], away = [] }: Setup) {
  const rows = items.map(i => ({ ...i }));
  const userRepo = {
    find: async ({ where, take }: any) => anyOf(users, where).slice(0, take ?? Infinity).map(u => ({ ...u })),
    findOne: async ({ where }: any) => anyOf(users, where)[0] ?? null,
  };
  const projectRepo = {
    findOne: async ({ where: { id } }: any) => projects.find(p => p.id === id) ?? null,
  };
  const repo: any = {
    find: jest.fn(async ({ where }: any) => anyOf(rows, where).map(r => ({ ...r }))),
    update: jest.fn(async (id: string, set: any) => { Object.assign(rows.find(r => r.id === id), set); }),
    manager: {
      // Отпуск: usersOnVacation спрашивает employees сырым SQL.
      query: async (sql: string) => (/FROM employees e/.test(sql) ? away.map(userId => ({ userId })) : []),
      getRepository: (E: any) => {
        if (E === User) return userRepo;
        if (E === Project) return projectRepo;
        throw new Error(`репозиторий ${E?.name} в заглушке не описан`);
      },
    },
  };
  const svc: any = Object.create(ContentPlanService.prototype);
  svc.repo = repo;
  svc.logger = { warn: jest.fn(), log: jest.fn() };
  svc.emitTasksChanged = jest.fn();
  svc.shootChanged = jest.fn();
  const byId = (id: string) => rows.find(r => r.id === id);
  return { svc: svc as ContentPlanService, raw: svc, repo, byId };
}

const designer = (id: string, extra: any = {}) => ({ id, role: 'designer', secondaryRole: null, isActive: true, ...extra });
const azam = (extra: any = {}) => ({ id: AZAM, role: 'video_editor', secondaryRole: 'designer', isActive: true, ...extra });
const beh = () => ({ id: BEH, role: 'videographer', secondaryRole: null, isActive: true, isDefaultVideographer: true });

describe('кому уходит карточка подготовки (21.11.2026)', () => {
  const resolve = (s: any, stage: string, project: any, exclude?: string) =>
    s.raw.resolvePrepAssignee(stage, project, exclude);

  it('уволенного из команды проекта пропускаем — макет уходит единственному дизайнеру', async () => {
    const s = make({ users: [designer(SAF, { isActive: false }), azam()] });
    await expect(resolve(s, 'design', { id: P1, smmData: { designerIds: [SAF] } })).resolves.toBe(AZAM);
  });

  it('работающий из команды проекта получает, как раньше, — даже если дизайнеров несколько', async () => {
    const s = make({ users: [designer(SAF, { isActive: false }), azam(), designer(TEST)] });
    await expect(resolve(s, 'design', { id: P1, smmData: { designerIds: [SAF, AZAM] } })).resolves.toBe(AZAM);
  });

  it('в команде только уволенный, а дизайнеров двое — без исполнителя, не уволенному', async () => {
    const s = make({ users: [designer(SAF, { isActive: false }), azam(), designer(TEST)] });
    await expect(resolve(s, 'design', { id: P1, smmData: { designerIds: [SAF] } })).resolves.toBeNull();
  });

  it('мусор в списке команды не ломает выбор', async () => {
    const s = make({ users: [azam()] });
    await expect(resolve(s, 'design', { id: P1, smmData: { designerIds: ['', 'не-uuid', 7] } })).resolves.toBe(AZAM);
  });

  it('уходящий (ещё активный при удалении) в счёт «единственного» не идёт', async () => {
    const s = make({ users: [designer(SAF), azam()] });
    await expect(resolve(s, 'design', null)).resolves.toBeNull();
    await expect(resolve(s, 'design', null, SAF)).resolves.toBe(AZAM);
  });
});

describe('сотрудник ушёл — его карточки переходят дальше (21.11.2026)', () => {
  const parents = [
    { id: 'post', projectId: P1, contentType: 'post', shootForItemId: null, prepStage: null, status: 'planned' },
    { id: 'reel', projectId: P2, contentType: 'reel', shootForItemId: null, prepStage: null, status: 'planned' },
  ];
  const card = (id: string, extra: any) =>
    ({ id, projectId: P1, contentType: 'post', shootForItemId: 'post', prepStage: 'design', status: 'planned', assigneeId: SAF, ...extra });

  it('открытые макеты, легаси-карточка и съёмка — преемникам; готовые и отменённые остаются', async () => {
    const s = make({
      users: [designer(SAF, { isActive: false }), azam(), beh()],
      projects: [{ id: P1, smmData: {} }, { id: P2, smmData: {} }],
      items: [
        ...parents,
        card('d1', {}),
        card('d-done', { status: 'published' }),
        card('d-cancel', { status: 'cancelled' }),
        card('legacy', { prepStage: null }),
        card('shoot', { projectId: P2, contentType: 'reel', shootForItemId: 'reel', prepStage: 'shoot' }),
        card('edit-azam', { projectId: P2, shootForItemId: 'reel', prepStage: 'edit', assigneeId: AZAM }),
      ],
    });
    await expect(s.svc.handOverPrepCards(SAF)).resolves.toEqual({ total: 3, reassigned: 3 });
    expect(s.byId('d1').assigneeId).toBe(AZAM);
    expect(s.byId('legacy').assigneeId).toBe(AZAM);
    expect(s.byId('shoot').assigneeId).toBe(BEH);
    expect(s.byId('d-done').assigneeId).toBe(SAF);
    expect(s.byId('d-cancel').assigneeId).toBe(SAF);
    expect(s.byId('edit-azam').assigneeId).toBe(AZAM);
    // Продюсер узнаёт о смене только по съёмке, и один сигнал экранам.
    expect(s.raw.shootChanged).toHaveBeenCalledTimes(1);
    expect(s.raw.shootChanged.mock.calls[0][0]).toMatchObject({ id: 'shoot', assigneeId: SAF });
    expect(s.raw.emitTasksChanged).toHaveBeenCalledTimes(1);
  });

  it('уволенный стоит в команде проекта — карточка всё равно уходит другому', async () => {
    const s = make({
      users: [designer(SAF, { isActive: false }), azam()],
      projects: [{ id: P1, smmData: { designerIds: [SAF] } }],
      items: [...parents, card('d1', {})],
    });
    await s.svc.handOverPrepCards(SAF);
    expect(s.byId('d1').assigneeId).toBe(AZAM);
  });

  it('преемника нет — карточка без исполнителя (её назначит руководство), а не на уволенном', async () => {
    const s = make({
      users: [designer(SAF, { isActive: false }), azam(), designer(TEST)],
      projects: [{ id: P1, smmData: {} }],
      items: [...parents, card('d1', {})],
    });
    await expect(s.svc.handOverPrepCards(SAF)).resolves.toEqual({ total: 1, reassigned: 0 });
    expect(s.byId('d1').assigneeId).toBeNull();
  });

  it('единственный преемник в отпуске — не назначаем', async () => {
    const s = make({
      users: [designer(SAF, { isActive: false }), azam()],
      projects: [{ id: P1, smmData: {} }],
      items: [...parents, card('d1', {})],
      away: [AZAM],
    });
    await s.svc.handOverPrepCards(SAF);
    expect(s.byId('d1').assigneeId).toBeNull();
  });

  it('открытых карточек нет — ничего не трогаем и не шлём', async () => {
    const s = make({ users: [azam()], items: [...parents, card('d-done', { status: 'published' })] });
    await expect(s.svc.handOverPrepCards(SAF)).resolves.toEqual({ total: 0, reassigned: 0 });
    expect(s.repo.update).not.toHaveBeenCalled();
    expect(s.raw.emitTasksChanged).not.toHaveBeenCalled();
  });

  it('мусорный id — ничего не делаем', async () => {
    const s = make({ users: [azam()], items: [...parents, card('d1', {})] });
    await expect(s.svc.handOverPrepCards('не-uuid')).resolves.toEqual({ total: 0, reassigned: 0 });
    expect(s.repo.find).not.toHaveBeenCalled();
  });

  it('сбой при передаче не роняет уход сотрудника — только запись в лог', async () => {
    const s = make({ users: [azam()] });
    s.repo.find.mockRejectedValueOnce(new Error('db down'));
    await expect(s.svc.onUserLeaving({ userId: SAF })).resolves.toBeUndefined();
    expect(s.raw.logger.warn).toHaveBeenCalled();
  });
});
