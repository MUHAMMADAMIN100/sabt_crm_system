import { ProjectsService } from './projects.service';

/** История ответственного менеджера SMM-проекта (14.11.2026): оплата
 *  засчитывается тому, кто вёл проект в день оплаты. */
function make(smmData: any = {}) {
  const project: any = { id: 'p', name: 'Chrono', projectType: 'SMM', createdAt: new Date('2026-06-01T05:00:00Z'), smmData };
  const svc: any = Object.create(ProjectsService.prototype);
  svc.repo = {
    findOne: jest.fn(async () => project),
    update: jest.fn(async (_id: string, set: any) => Object.assign(project, set)),
    // 15.11.2026: smmData пишется атомарно (patchSmmData) — имитируем слияние.
    manager: {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (/UPDATE projects/.test(sql)) {
          const set = JSON.parse(params[0]);
          const unset: string[] = params[2] || [];
          project.smmData = { ...(project.smmData || {}), ...set };
          for (const k of unset) delete project.smmData[k];
        }
        return [];
      }),
    },
  };
  svc.userRepo = { findOne: jest.fn(async ({ where }: any) => ({ id: where.id, role: 'sales_manager_smm', isActive: true })) };
  return { svc: svc as ProjectsService, project };
}

describe('Ответственный менеджер SMM-проекта — история', () => {
  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-11-15T06:00:00Z') }); });
  afterAll(() => { jest.useRealTimers(); });

  it('первая смена записывает и прежнего менеджера — с даты создания проекта', async () => {
    const { svc, project } = make({ salesManagerId: 'A' });
    await svc.setSmmManager('p', 'B');
    expect(project.smmData.salesManagerId).toBe('B');
    expect(project.smmData.salesManagerHistory).toEqual([
      { managerId: 'A', from: '2026-06-01' },
      { managerId: 'B', from: '2026-11-15' },
    ]);
  });

  it('следующая смена дописывается; тот же менеджер — без записи', async () => {
    const { svc, project } = make({ salesManagerId: 'B', salesManagerHistory: [{ managerId: 'A', from: '2026-06-01' }, { managerId: 'B', from: '2026-10-01' }] });
    await svc.setSmmManager('p', 'B');
    expect(project.smmData.salesManagerHistory).toHaveLength(2);
    await svc.setSmmManager('p', null);
    expect(project.smmData.salesManagerId).toBeNull();
    expect(project.smmData.salesManagerHistory[2]).toEqual({ managerId: null, from: '2026-11-15' });
  });

  it('первое назначение без прежнего менеджера', async () => {
    const { svc, project } = make({});
    await svc.setSmmManager('p', 'B');
    expect(project.smmData.salesManagerHistory).toEqual([{ managerId: 'B', from: '2026-11-15' }]);
  });
});
