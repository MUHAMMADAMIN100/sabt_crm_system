import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentPlanService, isProductionOnly } from './content-plan.service';
import { ContentPlanStatus } from './content-plan-item.entity';
import { dushanbeToday } from '../employees/vacation';

/** id проекта — настоящий UUID: проверка доступа отсекает мусорные id. */
const P = '00000000-0000-4000-8000-000000000001';

/** Съёмки (09.11.2026): «смонтировано — значит снято», отменённая съёмка.
 *  Сервис без базы: репозиторий — заглушка в памяти. */
function make(items: any[]) {
  const byId = new Map(items.map(i => [i.id, { ...i }]));
  const updates: Array<{ id: string; set: any }> = [];
  const repo: any = {
    findOne: async ({ where: { id } }: any) => (byId.has(id) ? { ...byId.get(id) } : null),
    update: async (id: string, set: any) => { updates.push({ id, set }); Object.assign(byId.get(id), set); },
    // Доступ к проекту (15.11.2026): эти люди — участники проекта P.
    manager: {
      query: async (sql: string) => (/FROM projects p WHERE p.id/.test(sql)
        ? [{ id: P, projectType: 'SMM', managerId: null, salesManagerId: null, smmData: {}, isOneOffSystem: false,
             memberIds: ['u', 'sabrina', 'umrona', 'pr', 'azam', 'beh'] }]
        : []),
    },
    createQueryBuilder: () => {
      let rid = '';
      const qb: any = {
        where: (_: string, p: any) => { rid = p.rid; return qb; },
        andWhere: () => qb,
        getMany: async () => [...byId.values()].filter(x => x.shootForItemId === rid
          && (x.prepStage ?? 'shoot') === 'shoot' && !['published', 'cancelled'].includes(x.status)),
      };
      return qb;
    },
  };
  const svc: any = Object.create(ContentPlanService.prototype);
  svc.repo = repo;
  svc.logger = { warn: jest.fn(), log: jest.fn() };
  svc.logItemAction = jest.fn();
  svc.emitTasksChanged = jest.fn();
  svc.ensurePrepForItem = jest.fn();
  svc.shootChanged = jest.fn();
  return { svc: svc as ContentPlanService, byId, updates };
}

const day = (iso: string) => new Date(`${iso}T00:00:00`);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const today = dushanbeToday();

describe('съёмки: смонтировано — значит снято', () => {
  const base = () => [
    { id: 'reel', projectId: P, status: 'planned', publishDate: day(addDays(today, 5)), shootForItemId: null, prepStage: null },
    { id: 'shoot', projectId: P, status: 'planned', publishDate: day(addDays(today, 3)), shootForItemId: 'reel', prepStage: 'shoot' },
    { id: 'edit', projectId: P, status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'reel', prepStage: 'edit', assigneeId: 'azam' },
  ];

  it('монтажёр отметил монтаж — съёмка закрыта и встала на сегодня', async () => {
    const { svc, byId } = make(base());
    await svc.updateMyWork('azam', 'edit', { done: true });
    expect(byId.get('shoot').status).toBe(ContentPlanStatus.PUBLISHED);
    expect(byId.get('shoot').publishDate.toISOString()).toBe(day(today).toISOString());
  });

  it('съёмка в прошлом — закрываем, день не трогаем', async () => {
    const items = base();
    items[1].publishDate = day(addDays(today, -3));
    const { svc, byId } = make(items);
    await svc.updateMyWork('azam', 'edit', { done: true });
    expect(byId.get('shoot').status).toBe(ContentPlanStatus.PUBLISHED);
    expect(byId.get('shoot').publishDate.toISOString()).toBe(day(addDays(today, -3)).toISOString());
  });

  it('отменённую съёмку не трогаем; монтаж вернули в работу — съёмку не открываем', async () => {
    const items = base();
    items[1].status = 'cancelled';
    const { svc, byId } = make(items);
    await svc.updateMyWork('azam', 'edit', { done: true });
    expect(byId.get('shoot').status).toBe('cancelled');
    const b = make(base());
    await b.svc.updateMyWork('azam', 'edit', { done: true });
    await b.svc.updateMyWork('azam', 'edit', { done: false });
    expect(b.byId.get('shoot').status).toBe(ContentPlanStatus.PUBLISHED);
  });

  it('отметка из умного календаря тоже закрывает съёмку', async () => {
    const { svc, byId } = make(base());
    await svc.smartUpdateItem('edit', { status: ContentPlanStatus.PUBLISHED }, { id: 'u' });
    expect(byId.get('shoot').status).toBe(ContentPlanStatus.PUBLISHED);
  });

  it('видеограф отметил свою съёмку — больше ничего не меняется', async () => {
    const items = base();
    (items[1] as any).assigneeId = 'beh';
    const { svc, updates } = make(items);
    await svc.updateMyWork('beh', 'shoot', { done: true });
    expect(updates.map(u => u.id)).toEqual(['shoot']);
  });
});

describe('отменённая съёмка', () => {
  it('ей назначили новый день — она снова в работе', async () => {
    const { svc, byId } = make([
      { id: 'reel', projectId: P, status: 'planned', publishDate: day(addDays(today, 6)), shootForItemId: null, prepStage: null },
      { id: 'shoot', projectId: P, status: 'cancelled', publishDate: day(addDays(today, -1)), shootForItemId: 'reel', prepStage: 'shoot' },
    ]);
    await svc.smartUpdateItem('shoot', { publishDate: addDays(today, 1) }, { id: 'umrona' });
    expect(byId.get('shoot').status).toBe(ContentPlanStatus.PLANNED);
  });

  it('отменённый рилс от переноса не оживает', async () => {
    const { svc, byId } = make([
      { id: 'reel', projectId: P, status: 'cancelled', publishDate: day(addDays(today, 6)), shootForItemId: null, prepStage: null },
    ]);
    await svc.smartUpdateItem('reel', { publishDate: addDays(today, 7) }, { id: 'u' });
    expect(byId.get('reel').status).toBe('cancelled');
  });
});

describe('продюсер — полный доступ к производству', () => {
  const producer = { id: 'umrona', role: 'producer', secondaryRole: null };
  const items = () => [
    { id: 'reel', projectId: P, status: 'planned', publishDate: day(addDays(today, 6)), shootForItemId: null, prepStage: null },
    { id: 'shoot', projectId: P, status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'reel', prepStage: 'shoot' },
    { id: 'post', projectId: P, status: 'planned', publishDate: day(addDays(today, 5)), shootForItemId: null, prepStage: null },
    { id: 'design', projectId: P, status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'post', prepStage: 'design' },
  ];

  it('кто считается продюсером без СММ-прав', () => {
    expect(isProductionOnly({ role: 'producer' })).toBe(true);
    expect(isProductionOnly({ role: 'videographer', secondaryRole: 'producer' })).toBe(true);
    expect(isProductionOnly({ role: 'producer', secondaryRole: 'smm_specialist' })).toBe(false);
    expect(isProductionOnly({ role: 'smm_specialist' })).toBe(false);
  });

  it('съёмку и дизайн двигает, меняет время, длительность, отмечает готовой', async () => {
    const { svc, byId } = make(items());
    await svc.smartUpdateItem('shoot', { publishDate: addDays(today, 1), publishTime: '10:00', durationMin: 240 }, producer);
    expect(byId.get('shoot').publishTime).toBe('10:00');
    expect(byId.get('shoot').durationMin).toBe(240);
    await svc.smartUpdateItem('design', { status: ContentPlanStatus.PUBLISHED }, producer);
    expect(byId.get('design').status).toBe(ContentPlanStatus.PUBLISHED);
  });

  it('публикации — рилсы и посты — не трогает', async () => {
    const { svc } = make(items());
    await expect(svc.smartUpdateItem('reel', { publishDate: addDays(today, 2) }, producer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.smartUpdateItem('post', { status: ContentPlanStatus.PUBLISHED }, producer)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TikTok: вторая отметка публикации (14.11.2026)', () => {
  const items = () => [
    { id: 'reel', projectId: P, contentType: 'reel', status: 'published', publishDate: day('2026-11-20'), shootForItemId: null, prepStage: null, tiktokAt: null },
    { id: 'story', projectId: P, contentType: 'story', status: 'planned', publishDate: day('2026-11-20'), shootForItemId: null, prepStage: null, tiktokAt: null },
    { id: 'shoot', projectId: P, contentType: 'reel', status: 'planned', publishDate: day('2026-11-18'), shootForItemId: 'reel', prepStage: 'shoot', tiktokAt: null },
  ];

  it('«выложено в TikTok» ставит и снимает отметку и пишет её в историю', async () => {
    const { svc, byId, updates } = make(items());
    await svc.smartUpdateItem('reel', { tiktok: true }, { id: 'sabrina' });
    expect(byId.get('reel').tiktokAt).toBeInstanceOf(Date);
    expect(byId.get('reel').status).toBe('published');
    expect((svc as any).logItemAction).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ kind: 'tiktok', to: true }), { id: 'sabrina' });
    await svc.smartUpdateItem('reel', { tiktok: false }, { id: 'sabrina' });
    expect(byId.get('reel').tiktokAt).toBeNull();
    expect(updates).toHaveLength(2);
  });

  it('у сторис и у съёмки TikTok не ставится; повторная отметка ничего не меняет', async () => {
    const { svc, byId, updates } = make(items());
    await svc.smartUpdateItem('story', { tiktok: true }, { id: 'u' });
    await svc.smartUpdateItem('shoot', { tiktok: true }, { id: 'u' });
    expect(byId.get('story').tiktokAt).toBeNull();
    expect(byId.get('shoot').tiktokAt).toBeNull();
    await svc.smartUpdateItem('reel', { tiktok: true }, { id: 'u' });
    await svc.smartUpdateItem('reel', { tiktok: true }, { id: 'u' });
    expect(updates).toHaveLength(1);
  });

  it('продюсеру отметка публикации недоступна', async () => {
    const { svc } = make(items());
    await expect(svc.smartUpdateItem('reel', { tiktok: true }, { id: 'pr', role: 'producer' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('свой проект и окно переноса (15.11.2026)', () => {
  const items = () => [
    { id: 'reel', projectId: P, contentType: 'reel', status: 'planned', publishDate: day(addDays(today, 6)), shootForItemId: null, prepStage: null },
    { id: 'shoot', projectId: P, contentType: 'reel', status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'reel', prepStage: 'shoot' },
  ];

  it('SMM-специалист чужого проекта календарь не правит', async () => {
    const { svc, updates } = make(items());
    await expect(svc.smartUpdateItem('reel', { publishDate: addDays(today, 5) }, { id: 'stranger', role: 'smm_specialist' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toHaveLength(0);
  });

  it('руководство SMM правит любой проект', async () => {
    const { svc, byId } = make(items());
    await svc.smartUpdateItem('reel', { publishTime: '18:00' }, { id: 'boss', role: 'employee', secondaryRole: 'smm_director' });
    expect(byId.get('reel').publishTime).toBe('18:00');
  });

  it('продюсер не ставит съёмку в прошлое и позже выхода рилса', async () => {
    const producer = { id: 'umrona', role: 'producer', secondaryRole: null };
    const { svc } = make(items());
    await expect(svc.smartUpdateItem('shoot', { publishDate: addDays(today, -1) }, producer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.smartUpdateItem('shoot', { publishDate: addDays(today, 7) }, producer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.smartUpdateItem('shoot', { publishDate: addDays(today, 5) }, producer)).resolves.toEqual({ ok: true });
  });
});

describe('publishedAt — момент публикации (15.11.2026)', () => {
  it('ставится при переходе в «опубликовано» и снимается при возврате', async () => {
    const { svc, byId } = make([
      { id: 'reel', projectId: P, contentType: 'reel', status: 'planned', publishDate: day(today), shootForItemId: null, prepStage: null },
    ]);
    await svc.smartUpdateItem('reel', { status: ContentPlanStatus.PUBLISHED }, { id: 'u' });
    const at = byId.get('reel').publishedAt;
    expect(at).toBeInstanceOf(Date);
    await svc.smartUpdateItem('reel', { status: ContentPlanStatus.PUBLISHED }, { id: 'u' });
    expect(byId.get('reel').publishedAt).toBe(at);
    await svc.smartUpdateItem('reel', { status: ContentPlanStatus.PLANNED }, { id: 'u' });
    expect(byId.get('reel').publishedAt).toBeNull();
  });

  it('«готово» в «Моих задачах» и закрытие съёмки после монтажа тоже ставят отметку', async () => {
    const { svc, byId } = make([
      { id: 'reel', projectId: P, status: 'planned', publishDate: day(addDays(today, 5)), shootForItemId: null, prepStage: null },
      { id: 'shoot', projectId: P, status: 'planned', publishDate: day(addDays(today, 3)), shootForItemId: 'reel', prepStage: 'shoot' },
      { id: 'edit', projectId: P, status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'reel', prepStage: 'edit', assigneeId: 'azam' },
    ]);
    await svc.updateMyWork('azam', 'edit', { done: true });
    expect(byId.get('edit').publishedAt).toBeInstanceOf(Date);
    expect(byId.get('shoot').publishedAt).toBeInstanceOf(Date);
  });
});

describe('подготовка: готовые карточки не трогаем (15.11.2026)', () => {
  function makePrep(items: any[], project: any) {
    const ctx = make(items);
    const r: any = (ctx.svc as any).repo;
    r.find = async ({ where: { shootForItemId } }: any) =>
      [...ctx.byId.values()].filter((x: any) => x.shootForItemId === shootForItemId).map((x: any) => ({ ...x }));
    r.delete = jest.fn(async (ids: string[]) => { for (const id of ids) ctx.byId.delete(id); });
    r.create = (x: any) => ({ ...x });
    r.save = jest.fn(async (x: any) => x);
    r.manager.getRepository = () => ({ findOne: async () => project });
    (ctx.svc as any).taskRepo = { delete: jest.fn(async () => undefined) };
    (ctx.svc as any).resolvePrepAssignee = jest.fn(async () => null);
    delete (ctx.svc as any).ensurePrepForItem;          // настоящий метод из прототипа
    return { ...ctx, r };
  }

  it('клэмп по старту цикла не сбрасывает статус и не двигает готовую съёмку', async () => {
    const { svc, byId } = makePrep([
      { id: 'shoot', projectId: P, status: 'published', publishDate: day('2026-11-13'), shootForItemId: 'reel', prepStage: 'shoot', assigneeId: 'v' },
      { id: 'edit', projectId: P, status: 'in_production', publishDate: day('2026-11-12'), shootForItemId: 'reel', prepStage: 'edit', assigneeId: 'e' },
    ], { id: 'p', smmData: { cycleStartDay: 15 } });
    await (svc as any).ensurePrepForItem({ id: 'reel', projectId: P, contentType: 'reel', status: 'planned', publishDate: day('2026-11-16'), shootForItemId: null });
    expect(byId.get('shoot').status).toBe('published');
    expect(byId.get('shoot').publishDate.toISOString()).toBe(day('2026-11-13').toISOString());
    expect(byId.get('edit').status).toBe('in_production');
    expect(byId.get('edit').publishDate.getDate()).toBe(15);
  });

  it('родителя вернули в «Не запланировано» — уходят только незакрытые карточки', async () => {
    const { svc, byId } = makePrep([
      { id: 'shoot', projectId: P, status: 'published', publishDate: day('2026-11-13'), shootForItemId: 'reel', prepStage: 'shoot' },
      { id: 'edit', projectId: P, status: 'planned', publishDate: day('2026-11-14'), shootForItemId: 'reel', prepStage: 'edit' },
    ], { id: 'p', smmData: {} });
    await (svc as any).ensurePrepForItem({ id: 'reel', projectId: P, contentType: 'reel', status: 'planned', publishDate: null, shootForItemId: null });
    expect(byId.has('shoot')).toBe(true);
    expect(byId.has('edit')).toBe(false);
  });

  it('под опубликованный рилс подготовку заново не заводим', async () => {
    const { svc, r } = makePrep([], { id: 'p', smmData: {} });
    await (svc as any).ensurePrepForItem({ id: 'reel', projectId: P, contentType: 'reel', status: 'published', publishDate: day('2026-11-16'), shootForItemId: null });
    expect(r.save).not.toHaveBeenCalled();
  });
});
