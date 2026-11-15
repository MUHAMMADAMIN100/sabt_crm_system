import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/** TikTok у проекта (14.11.2026): по умолчанию у всех, выключает руководство.
 *  15.11.2026: профиль правит только «свой» SMM-специалист, smmData пишется
 *  атомарным patchSmmData (UPDATE … smmData || $1 - $3). */
function make(smmData: any = {}, members: Array<{ id: string }> = []) {
  const project: any = { id: 'p', name: 'Chrono', projectType: 'SMM', smmData, members };
  const svc: any = Object.create(ProjectsService.prototype);
  svc.repo = {
    findOne: jest.fn(async () => project),
    update: jest.fn(async (_id: string, set: any) => Object.assign(project, set)),
    manager: {
      // Имитация patchSmmData: слияние верхних ключей и удаление unset.
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
  svc.userRepo = { find: jest.fn(async () => []) };
  svc.activityLog = { log: jest.fn() };
  svc.gateway = { broadcast: jest.fn() };
  svc.getSmmProfile = jest.fn(async () => ({ tiktok: project.smmData?.tiktokOff !== true }));
  return { svc: svc as ProjectsService, project };
}

describe('TikTok у SMM-проекта', () => {
  it('руководство выключает и включает обратно', async () => {
    const { svc, project } = make();
    await expect(svc.setSmmProfile('p', { tiktok: false }, { id: 'f', role: 'founder' })).resolves.toEqual({ tiktok: false });
    expect(project.smmData.tiktokOff).toBe(true);
    await svc.setSmmProfile('p', { tiktok: true }, { id: 'd', role: 'smm_director' });
    expect(project.smmData.tiktokOff).toBeUndefined();
  });

  it('СММ-специалист своего проекта выключить не может', async () => {
    const { svc, project } = make({ smmSpecialistIds: ['s'] });
    await expect(svc.setSmmProfile('p', { tiktok: false }, { id: 's', role: 'smm_specialist' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(project.smmData.tiktokOff).toBeUndefined();
  });
});

describe('Профиль SMM-проекта — свой проект (15.11.2026)', () => {
  it('специалист чужого проекта профиль не правит', async () => {
    const { svc, project } = make({ smmSpecialistIds: ['other'] });
    await expect(svc.setSmmProfile('p', { preferences: 'X' }, { id: 's', role: 'smm_specialist' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(project.smmData.preferences).toBeUndefined();
  });

  it('участник проекта правит, остальные ключи smmData не трогаются', async () => {
    const { svc, project } = make({ cycleStartDay: 5, normReels: 4 }, [{ id: 's' }]);
    await svc.setSmmProfile('p', { preferences: 'Тон — на «вы»' }, { id: 's', role: 'smm_specialist' });
    expect(project.smmData).toEqual({ cycleStartDay: 5, normReels: 4, preferences: 'Тон — на «вы»' });
  });

  it('специалистов проекта переставляет только руководство — и второй ролью тоже', async () => {
    const { svc, project } = make({ smmSpecialistIds: ['s'] });
    (svc as any).userRepo.find = jest.fn(async () => [{ id: 'n', role: 'video_editor', secondaryRole: 'smm_specialist' }]);
    await svc.setSmmProfile('p', { smmSpecialistIds: ['n'] }, { id: 's', role: 'smm_specialist' });
    expect(project.smmData.smmSpecialistIds).toEqual(['s']);
    await svc.setSmmProfile('p', { smmSpecialistIds: ['n'] }, { id: 'x', role: 'employee', secondaryRole: 'smm_director' });
    expect(project.smmData.smmSpecialistIds).toEqual(['n']);
  });

  it('продюсер второй ролью правит только производство', async () => {
    const { svc, project } = make({});
    await svc.setSmmProfile('p', { preferences: 'X', shootAddress: 'Рудаки 10' }, { id: 'pr', role: 'employee', secondaryRole: 'producer' });
    expect(project.smmData).toEqual({ shootAddress: 'Рудаки 10' });
  });
});
