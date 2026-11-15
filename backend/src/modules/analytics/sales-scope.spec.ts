import { AnalyticsService } from './analytics.service';

/** Панель «Продажи» (15.11.2026, SALES_SPEC §6): менеджер продаж видит
 *  только свои проекты — где он ответственный — и их суммы. */
function make(projects: any[]) {
  const svc: any = Object.create(AnalyticsService.prototype);
  svc.projectRepo = { find: jest.fn(async () => projects), manager: { query: jest.fn(async () => []) } };
  const qb: any = {
    select: () => qb, addSelect: () => qb, where: () => qb, groupBy: () => qb, orderBy: () => qb,
    andWhere: jest.fn(() => qb), getRawMany: jest.fn(async () => []),
  };
  svc.paymentRepo = { createQueryBuilder: () => qb };
  return { svc: svc as AnalyticsService, qb };
}

const PROJECTS = [
  { id: 'a', name: 'Chrono', projectType: 'SMM', smmData: { salesManagerId: 'm1' }, budget: 100, paidAmount: 40 },
  { id: 'b', name: 'Lola', projectType: 'SMM', smmData: { salesManagerId: 'm2' }, budget: 1000, paidAmount: 0 },
  // Свой проект другого направления — тоже его клиент.
  { id: 'c', name: 'Сайт', projectType: 'Лендинг', salesManagerId: 'm1', budget: 10, paidAmount: 10 },
];

describe('AnalyticsService.getSalesStats — деньги только своих', () => {
  it('менеджер продаж: только свои проекты, суммы и выручка по ним', async () => {
    const { svc, qb } = make(PROJECTS);
    const res = await svc.getSalesStats('sales_manager_smm', 'm1', { id: 'm1', role: 'sales_manager_smm' });
    expect(res.scope).toBe('own');
    expect(res.projects.map(p => p.id)).toEqual(['a', 'c']);
    expect(res.totalBudget).toBe(110);
    expect(res.totalPaid).toBe(50);
    expect(qb.andWhere).toHaveBeenCalledWith('pp."projectId" IN (:...ids)', { ids: ['a', 'c'] });
  });

  it('своих проектов нет — пусто, а не чужие', async () => {
    const { svc, qb } = make(PROJECTS);
    const res = await svc.getSalesStats('sales_manager_dev', 'm9', { id: 'm9', role: 'sales_manager_dev' });
    expect(res.projectCount).toBe(0);
    expect(res.totalBudget).toBe(0);
    expect(qb.andWhere).toHaveBeenCalledWith('1 = 0');
  });

  it('руководство — все проекты, как раньше', async () => {
    const { svc } = make(PROJECTS);
    const res = await svc.getSalesStats('founder', 'f', null);
    expect(res.scope).toBe('all');
    expect(res.projectCount).toBe(3);
  });
});
