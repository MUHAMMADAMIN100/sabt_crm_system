import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/** TikTok у проекта (14.11.2026): по умолчанию у всех, выключает руководство. */
function make(smmData: any = {}) {
  const project: any = { id: 'p', name: 'Chrono', projectType: 'SMM', smmData };
  const svc: any = Object.create(ProjectsService.prototype);
  svc.repo = {
    findOne: jest.fn(async () => project),
    update: jest.fn(async (_id: string, set: any) => Object.assign(project, set)),
  };
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

  it('СММ-специалист выключить не может', async () => {
    const { svc, project } = make();
    await expect(svc.setSmmProfile('p', { tiktok: false }, { id: 's', role: 'smm_specialist' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(project.smmData.tiktokOff).toBeUndefined();
  });
});
