import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { GRANTABLE } from '../auth/permissions';
import { encryptSecret } from '../../common/secret-box';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

/** Решения владельца 14.11.2026: менеджер по продажам проекты не создаёт,
 *  не правит и не удаляет; пароль клиента видит только менеджер ЭТОГО
 *  проекта, и приезжает пароль отдельным запросом. */
function make(smmData: any, clientAccess: any = null) {
  const row: any = { id: 'p', name: 'Lola', projectType: 'SMM', smmData, clientAccess };
  const svc: any = Object.create(ProjectsService.prototype);
  const qb: any = {
    select: () => qb, addSelect: () => qb, where: () => qb,
    getOne: jest.fn(async () => row),
  };
  svc.repo = {
    createQueryBuilder: () => qb,
    findOne: jest.fn(async () => row),
    update: jest.fn(async (_id: string, set: any) => Object.assign(row, set)),
  };
  svc.activityLog = { log: jest.fn(async () => undefined) };
  svc.gateway = { broadcast: jest.fn() };
  return { svc: svc as ProjectsService, row };
}

const SALES = (id: string, role = 'sales_manager_smm') => ({ id, role });

describe('Права менеджера по продажам на проекты', () => {
  it('нативно у менеджеров нет создания, правки и удаления проектов', () => {
    for (const key of ['projects.create', 'projects.edit', 'projects.delete']) {
      expect(GRANTABLE[key].roles).not.toContain('sales_manager_smm');
      expect(GRANTABLE[key].roles).not.toContain('sales_manager_dev');
    }
    // Бриф и запрос оплаты им по-прежнему доступны.
    expect(GRANTABLE['projects.brief.manage'].roles).toContain('sales_manager_smm');
  });

  it('удалить SMM-проект менеджер не может', async () => {
    const { svc } = make({});
    (svc as any).findOne = jest.fn(async () => ({ id: 'p', projectType: 'SMM' }));
    await expect(svc.remove('p', { id: 'm', role: 'sales_manager_smm' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('править проект своего направления менеджер больше не может', async () => {
    const { svc } = make({});
    (svc as any).findOne = jest.fn(async () => ({ id: 'p', projectType: 'SMM', managerId: 'other' }));
    await expect(svc.update('p', { name: 'X' } as any, { id: 'm', role: 'sales_manager_smm' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Логин и пароль клиента', () => {
  const access = () => ({ login: '@lola', password: encryptSecret('s3cret'), note: '2FA на почте' });

  it('менеджер этого проекта видит логин, а пароль — отдельным запросом', async () => {
    const { svc } = make({ salesManagerId: 'm1' }, access());
    const a: any = await svc.getClientAccess('p', SALES('m1'));
    expect(a.login).toBe('@lola');
    expect(a.hasPassword).toBe(true);
    expect(a).not.toHaveProperty('password');
    await expect(svc.getClientAccessPassword('p', SALES('m1'))).resolves.toEqual({ password: 's3cret' });
  });

  it('другой менеджер по продажам не видит ни логин, ни пароль', async () => {
    const { svc } = make({ salesManagerId: 'm1' }, access());
    await expect(svc.getClientAccess('p', SALES('m2'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getClientAccessPassword('p', SALES('m2'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('менеджер разработки, если проект его, тоже видит', async () => {
    const { svc } = make({ salesManagerId: 'd1' }, access());
    await expect(svc.getClientAccessPassword('p', SALES('d1', 'sales_manager_dev'))).resolves.toEqual({ password: 's3cret' });
  });

  it('руководитель СММ, основатель и специалист проекта — как раньше', async () => {
    const { svc } = make({ salesManagerId: 'm1', smmSpecialistIds: ['s1'] }, access());
    for (const u of [{ id: 'x', role: 'smm_director' }, { id: 'y', role: 'founder' }, { id: 's1', role: 'smm_specialist' }]) {
      await expect(svc.getClientAccessPassword('p', u)).resolves.toEqual({ password: 's3cret' });
    }
    await expect(svc.getClientAccess('p', { id: 's2', role: 'smm_specialist' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('сохранение без пароля оставляет прежний пароль', async () => {
    const { svc, row } = make({ salesManagerId: 'm1' }, access());
    await svc.saveClientAccess('p', { login: '@lola.new', note: '' }, { id: 'm1', role: 'sales_manager_smm', name: 'Фарух' });
    expect(row.clientAccess.login).toBe('@lola.new');
    await expect(svc.getClientAccessPassword('p', SALES('m1'))).resolves.toEqual({ password: 's3cret' });
  });

  it('пустой пароль в запросе — пароль удалён', async () => {
    const { svc, row } = make({ salesManagerId: 'm1' }, access());
    await svc.saveClientAccess('p', { login: '@lola', password: '', note: '' }, { id: 'm1', role: 'sales_manager_smm' });
    expect(row.clientAccess.password).toBe('');
  });
});
