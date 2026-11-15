import { isLeadTop, leadDirectionOf, ownerCandidateError, salesDirectionsOf } from './lead-access';

// Кто может вести лид (15.11.2026): МП передаёт только МП своего
// направления; руководство — менеджеру направления лида или руководству.

const smm1 = { id: 'S1', role: 'sales_manager_smm' };
const smm2 = { id: 'S2', role: 'sales_manager_smm', isActive: true, isBlocked: false };
const dev = { id: 'D1', role: 'sales_manager_dev' };
const designerWithSmm = { id: 'X', role: 'designer', secondaryRole: 'sales_manager_smm' };
const designer = { id: 'Y', role: 'designer' };
const founder = { id: 'F', role: 'founder' };
const adminByRole2 = { id: 'A', role: 'smm_director', secondaryRole: 'admin' };

describe('роли', () => {
  it('руководство — основной или второй ролью', () => {
    expect(isLeadTop(founder)).toBe(true);
    expect(isLeadTop(adminByRole2)).toBe(true);
    expect(isLeadTop(smm1)).toBe(false);
  });

  it('направления продаж — по обеим ролям, основная важнее', () => {
    expect(salesDirectionsOf(designerWithSmm)).toEqual(['smm']);
    expect(salesDirectionsOf({ role: 'sales_manager_dev', secondaryRole: 'sales_manager_smm' })).toEqual(['development', 'smm']);
    expect(leadDirectionOf({ role: 'sales_manager_dev', secondaryRole: 'sales_manager_smm' })).toBe('development');
    expect(leadDirectionOf(founder)).toBeNull();
  });
});

describe('ownerCandidateError — кому можно отдать лид', () => {
  it('МП → другому МП своего направления (в т.ч. второй ролью) — можно', () => {
    expect(ownerCandidateError(smm1, smm2, 'smm')).toBeNull();
    expect(ownerCandidateError(smm1, designerWithSmm, 'smm')).toBeNull();
    // Лид без направления — по направлению самого МП.
    expect(ownerCandidateError(smm1, smm2, null)).toBeNull();
  });

  it('МП → МП другого направления, дизайнеру или руководителю — нельзя', () => {
    expect(ownerCandidateError(smm1, dev, 'smm')).toMatch(/СММ/);
    expect(ownerCandidateError(smm1, dev, null)).toMatch(/СММ/);
    expect(ownerCandidateError(smm1, designer, 'smm')).toMatch(/менеджеру продаж/);
    expect(ownerCandidateError(smm1, founder, 'smm')).toMatch(/менеджеру продаж/);
  });

  it('руководство: себе/руководству, МП направления лида; не продажнику и не тому направлению — нет', () => {
    expect(ownerCandidateError(founder, founder, 'smm')).toBeNull();
    expect(ownerCandidateError(founder, adminByRole2, 'development')).toBeNull();
    expect(ownerCandidateError(founder, dev, 'development')).toBeNull();
    expect(ownerCandidateError(founder, dev, null)).toBeNull();
    expect(ownerCandidateError(founder, dev, 'smm')).toMatch(/СММ/);
    expect(ownerCandidateError(founder, designer, 'smm')).toMatch(/менеджер продаж или руководство/);
  });

  it('нет такого или заблокирован — нельзя', () => {
    expect(ownerCandidateError(founder, null, 'smm')).toBe('Сотрудник не найден');
    expect(ownerCandidateError(founder, { ...smm2, isBlocked: true }, 'smm')).toMatch(/заблокирован/);
    expect(ownerCandidateError(founder, { ...smm2, isActive: false }, 'smm')).toMatch(/неактивен/);
  });
});
