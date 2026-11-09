import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentPlanService, isShootOrganizerOnly } from './content-plan.service';
import { ContentPlanStatus } from './content-plan-item.entity';
import { dushanbeToday } from '../employees/vacation';

/** Съёмки (09.11.2026): «смонтировано — значит снято» и продюсер в умном
 *  календаре. Сервис без базы: репозиторий — заглушка в памяти. */
function make(items: any[]) {
  const byId = new Map(items.map(i => [i.id, { ...i }]));
  const updates: Array<{ id: string; set: any }> = [];
  const repo: any = {
    findOne: async ({ where: { id } }: any) => (byId.has(id) ? { ...byId.get(id) } : null),
    update: async (id: string, set: any) => { updates.push({ id, set }); Object.assign(byId.get(id), set); },
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
    { id: 'reel', projectId: 'p', status: 'planned', publishDate: day(addDays(today, 5)), shootForItemId: null, prepStage: null },
    { id: 'shoot', projectId: 'p', status: 'planned', publishDate: day(addDays(today, 3)), shootForItemId: 'reel', prepStage: 'shoot' },
    { id: 'edit', projectId: 'p', status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'reel', prepStage: 'edit', assigneeId: 'azam' },
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
    await svc.smartUpdateItem('edit', { status: ContentPlanStatus.PUBLISHED }, { id: 'u', role: 'smm_specialist' });
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

describe('продюсер в умном календаре', () => {
  const producer = { id: 'umrona', role: 'producer', secondaryRole: null };
  const items = () => [
    { id: 'reel', projectId: 'p', status: 'planned', publishDate: day(addDays(today, 6)), shootForItemId: null, prepStage: null },
    { id: 'shoot', projectId: 'p', status: 'planned', publishDate: day(addDays(today, 4)), shootForItemId: 'reel', prepStage: 'shoot' },
    { id: 'edit', projectId: 'p', status: 'planned', publishDate: day(addDays(today, 5)), shootForItemId: 'reel', prepStage: 'edit' },
  ];

  it('кто считается продюсером без СММ-прав', () => {
    expect(isShootOrganizerOnly({ role: 'producer' })).toBe(true);
    expect(isShootOrganizerOnly({ role: 'videographer', secondaryRole: 'producer' })).toBe(true);
    expect(isShootOrganizerOnly({ role: 'producer', secondaryRole: 'smm_specialist' })).toBe(false);
    expect(isShootOrganizerOnly({ role: 'founder' })).toBe(false);
  });

  it('меняет у съёмки день, время и место', async () => {
    const { svc, byId } = make(items());
    const d = addDays(today, 1);
    await svc.smartUpdateItem('shoot', { publishDate: d, publishTime: '10:00', shootPlace: '@client' }, producer);
    expect(byId.get('shoot').publishTime).toBe('10:00');
    expect(byId.get('shoot').shootPlace).toBe('@client');
  });

  it('рилс, монтаж и отметку «снято» не трогает', async () => {
    const { svc } = make(items());
    await expect(svc.smartUpdateItem('reel', { publishDate: addDays(today, 2) }, producer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.smartUpdateItem('edit', { publishDate: addDays(today, 2) }, producer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.smartUpdateItem('shoot', { status: ContentPlanStatus.PUBLISHED }, producer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.smartUpdateItem('shoot', { publishDate: null }, producer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('не в прошлое и не позже выхода рилса', async () => {
    const { svc } = make(items());
    await expect(svc.smartUpdateItem('shoot', { publishDate: addDays(today, -1) }, producer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.smartUpdateItem('shoot', { publishDate: addDays(today, 7) }, producer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('отменённую съёмку назначили на день — она снова в работе', async () => {
    const list = items();
    list[1].status = 'cancelled';
    const { svc, byId } = make(list);
    await svc.smartUpdateItem('shoot', { publishDate: addDays(today, 1) }, producer);
    expect(byId.get('shoot').status).toBe(ContentPlanStatus.PLANNED);
  });
});
