import { ForbiddenException } from '@nestjs/common';
import { SmmControlService } from './smm-control.service';

/** «Контроль» SMM (15.11.2026, SALES_SPEC §6): отметки ставят руководство
 *  и менеджер по продажам SMM — только по своим проектам. */
function make(project: any) {
  const svc: any = Object.create(SmmControlService.prototype);
  svc.projectRepo = { findOne: jest.fn(async () => project), manager: { query: jest.fn(async () => []) } };
  svc.repo = {
    findOne: jest.fn(async () => null),
    create: jest.fn((x: any) => ({ ...x })),
    save: jest.fn(async (x: any) => x),
  };
  return svc as SmmControlService;
}

const PROJECT = {
  id: 'p', name: 'Chrono', projectType: 'SMM', managerId: 'spec',
  smmData: { salesManagerId: 'm1', smmSpecialistIds: ['spec'] },
};
const MARK = { ym: '2026-11', contact: true };

describe('«Контроль»: кто ставит отметки', () => {
  it('МП по SMM — по своему проекту можно, по чужому — 403', async () => {
    await expect(make(PROJECT).update('p', MARK, { id: 'm1', role: 'sales_manager_smm' }))
      .resolves.toMatchObject({ contact: true, contactById: 'm1' });
    await expect(make(PROJECT).update('p', MARK, { id: 'm2', role: 'sales_manager_smm' }))
      .rejects.toThrow('Отмечать можно только по своим проектам');
  });

  it('МП по SMM второй ролью — тоже по своему', async () => {
    await expect(make(PROJECT).update('p', MARK, { id: 'm1', role: 'videographer', secondaryRole: 'sales_manager_smm' }))
      .resolves.toBeTruthy();
  });

  it('МП разработки не отмечает; SMM-специалист — только по своему проекту', async () => {
    const project = { ...PROJECT, smmData: { salesManagerId: 'd1', smmSpecialistIds: ['spec'] } };
    await expect(make(project).update('p', MARK, { id: 'd1', role: 'sales_manager_dev' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(make(project).update('p', MARK, { id: 'other', role: 'smm_specialist' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(make(project).update('p', MARK, { id: 'spec', role: 'smm_specialist' })).resolves.toBeTruthy();
  });

  it('руководитель SMM отмечает любой проект, как и раньше', async () => {
    await expect(make(PROJECT).update('p', MARK, { id: 'dir', role: 'smm_director' })).resolves.toBeTruthy();
  });

  it('основатель и админ — по любому проекту, и рекламу тоже', async () => {
    await expect(make(PROJECT).update('p', MARK, { id: 'f', role: 'founder' })).resolves.toBeTruthy();
    const svc = make(PROJECT);
    await expect(svc.update('p', { ym: '2026-11', ads: true }, { id: 'a', role: 'admin' }))
      .resolves.toMatchObject({ ads: { running: true } });
  });
});
