import { canBookForShoot, canEditCasting, canImportCasting, canViewCasting, isProjectSmm } from './casting-access';

describe('casting-access — кто видит, правит и ставит в съёмку', () => {
  it('видят: руководство, продюсер, SMM-специалисты, видеографы (и второй ролью)', () => {
    for (const role of ['founder', 'admin', 'smm_director', 'producer', 'smm_specialist', 'videographer']) {
      expect(canViewCasting({ id: 'u', role })).toBe(true);
    }
    expect(canViewCasting({ id: 'u', role: 'designer' })).toBe(false);
    expect(canViewCasting({ id: 'u', role: 'sales_manager_smm' })).toBe(false);
    expect(canViewCasting({ id: 'u', role: 'employee', secondaryRole: 'videographer' })).toBe(true);
    expect(canViewCasting(null)).toBe(false);
  });

  it('правят: основатель, админ, руководитель SMM, продюсер', () => {
    expect(canEditCasting({ id: 'u', role: 'producer' })).toBe(true);
    expect(canEditCasting({ id: 'u', role: 'designer', secondaryRole: 'smm_director' })).toBe(true);
    expect(canEditCasting({ id: 'u', role: 'smm_specialist' })).toBe(false);
    expect(canEditCasting({ id: 'u', role: 'videographer' })).toBe(false);
  });

  it('импорт: основатель, админ, руководитель SMM — без продюсера', () => {
    expect(canImportCasting({ id: 'u', role: 'founder' })).toBe(true);
    expect(canImportCasting({ id: 'u', role: 'admin' })).toBe(true);
    expect(canImportCasting({ id: 'u', role: 'smm_director' })).toBe(true);
    expect(canImportCasting({ id: 'u', role: 'producer' })).toBe(false);
  });

  it('SMM-специалист проекта этой съёмки', () => {
    const project = { managerId: 'm1', smmData: { smmSpecialistIds: ['s1'] } };
    expect(isProjectSmm({ id: 's1', role: 'designer' }, project)).toBe(true);
    expect(isProjectSmm({ id: 's2', role: 'smm_specialist' }, project, ['s2'])).toBe(true);
    expect(isProjectSmm({ id: 's3', role: 'smm_specialist' }, project, ['s2'])).toBe(false);
    expect(isProjectSmm({ id: 'v1', role: 'videographer' }, project, ['v1'])).toBe(false);
    expect(isProjectSmm({ id: 's1', role: 'smm_specialist' }, null)).toBe(false);
  });

  it('ставить в съёмку: кто правит кастинг или SMM-специалист проекта', () => {
    const project = { managerId: 'm1', smmData: { smmSpecialistIds: ['s1'] } };
    expect(canBookForShoot({ id: 'p', role: 'producer' }, null)).toBe(true);
    expect(canBookForShoot({ id: 's1', role: 'smm_specialist' }, project)).toBe(true);
    expect(canBookForShoot({ id: 's9', role: 'smm_specialist' }, project)).toBe(false);
    expect(canBookForShoot({ id: 'v1', role: 'videographer' }, project, ['v1'])).toBe(false);
  });
});
