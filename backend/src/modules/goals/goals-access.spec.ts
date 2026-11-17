import {
  accessOf, canCheckinKr, canEditDepartment, canEditKr, canManageCompany, canManageSettings, canReadDepartment,
  canSeeDetails, copyScope, isTopActor, leadsMember,
} from './goals-access';
import { DeptUser, departmentOfRole, leadsOf, membersOf, pickLeaders } from './departments';

describe('goals-access — кто что видит и правит', () => {
  const founder = accessOf({ id: 'f', role: 'founder' }, ['sales', 'management']);
  const admin = accessOf({ id: 'a', role: 'admin' }, []);
  const smmLead = accessOf({ id: 's', role: 'smm_director' }, ['smm']);
  const specialist = accessOf({ id: 'x', role: 'smm_specialist' }, []);
  const secondTop = accessOf({ id: 'y', role: 'employee', secondaryRole: 'admin' }, []);

  it('isTop — основатель или админ, в том числе второй ролью', () => {
    expect(isTopActor({ id: '1', role: 'founder' })).toBe(true);
    expect(isTopActor({ id: '1', role: 'developer', secondaryRole: 'admin' })).toBe(true);
    expect(isTopActor({ id: '1', role: 'smm_director' })).toBe(false);
    expect(secondTop.isTop).toBe(true);
  });

  it('details — руководство и руководители отделов', () => {
    expect(canSeeDetails(founder)).toBe(true);
    expect(canSeeDetails(admin)).toBe(true);
    expect(canSeeDetails(smmLead)).toBe(true);
    expect(canSeeDetails(specialist)).toBe(false);
    expect(specialist.department).toBe('smm');
  });

  it('цели и КР компании правит только руководство', () => {
    expect(canManageCompany(admin)).toBe(true);
    expect(canManageCompany(smmLead)).toBe(false);
    expect(canEditKr(admin, { level: 'company', department: null })).toBe(true);
    expect(canEditKr(smmLead, { level: 'company', department: null })).toBe(false);
  });

  it('КР отдела: читают details и члены отдела, правит руководитель', () => {
    expect(canReadDepartment(specialist, 'smm')).toBe(true);
    expect(canReadDepartment(specialist, 'dev')).toBe(false);
    expect(canReadDepartment(smmLead, 'dev')).toBe(true);
    expect(canEditDepartment(smmLead, 'smm')).toBe(true);
    expect(canEditDepartment(smmLead, 'dev')).toBe(false);
    expect(canEditDepartment(admin, 'dev')).toBe(true);
    expect(canEditKr(smmLead, { level: 'department', department: 'smm' })).toBe(true);
    expect(canEditKr(specialist, { level: 'department', department: 'smm' })).toBe(false);
  });

  it('отметка недели: КР компании — руководство и ответственный', () => {
    expect(canCheckinKr(specialist, { level: 'company', department: null, ownerId: 'x' })).toBe(true);
    expect(canCheckinKr(specialist, { level: 'company', department: null, ownerId: 'z' })).toBe(false);
    expect(canCheckinKr(admin, { level: 'company', department: null, ownerId: null })).toBe(true);
    expect(canCheckinKr(smmLead, { level: 'department', department: 'smm' })).toBe(true);
    expect(canCheckinKr(smmLead, { level: 'department', department: 'sales' })).toBe(false);
    expect(canCheckinKr(founder, { level: 'department', department: 'dev' })).toBe(true);
  });

  it('перенос месяца и настройки', () => {
    expect(copyScope(admin)).toEqual({ company: true, departments: ['sales', 'smm', 'dev', 'management'] });
    expect(copyScope(smmLead)).toEqual({ company: false, departments: ['smm'] });
    expect(canManageSettings(smmLead)).toBe(false);
    expect(canManageSettings(founder)).toBe(true);
  });

  it('руководитель ставит цели членам своего отдела, но не себе и не руководству', () => {
    expect(leadsMember({ id: 's' }, ['smm'], { id: 'x', role: 'designer' })).toBe(true);
    expect(leadsMember({ id: 's' }, ['smm'], { id: 'd', role: 'developer' })).toBe(false);
    expect(leadsMember({ id: 's' }, ['smm'], { id: 's', role: 'smm_director' })).toBe(false);
    expect(leadsMember({ id: 'f' }, ['management'], { id: 'a', role: 'admin' })).toBe(false);
    expect(leadsMember({ id: 'f' }, ['management'], { id: 'e', role: 'employee' })).toBe(true);
  });
});

describe('departments — отделы и руководители', () => {
  const users: DeptUser[] = [
    { id: 'f', name: 'Фарход', role: 'founder' },
    { id: 's2', name: 'Яна', role: 'smm_specialist', secondaryRole: 'smm_director' },
    { id: 's1', name: 'Анна', role: 'smm_director' },
    { id: 'd1', name: 'Сабрина', role: 'pm_dev', secondaryRole: 'dev_director' },
    { id: 'm1', name: 'Мурод', role: 'sales_manager_smm' },
    { id: 'old', name: 'Борис', role: 'smm_director', isActive: false },
  ];

  it('отдел — по основной роли', () => {
    expect(departmentOfRole('sales_manager_dev')).toBe('sales');
    expect(departmentOfRole('videographer')).toBe('smm');
    expect(departmentOfRole('developer')).toBe('dev');
    expect(departmentOfRole('employee')).toBe('management');
    expect(departmentOfRole('unknown')).toBeNull();
    expect(departmentOfRole(null)).toBeNull();
  });

  it('руководители по умолчанию: роль (и второй ролью), первый по имени, иначе основатель', () => {
    const leaders = pickLeaders(users, {});
    expect(leaders.sales?.id).toBe('f');
    expect(leaders.management?.id).toBe('f');
    expect(leaders.smm?.id).toBe('s1');
    expect(leaders.dev?.id).toBe('d1');
    expect(leadsOf({ id: 'f' }, leaders)).toEqual(['sales', 'management']);
  });

  it('ручное назначение сильнее; недействующий не назначается', () => {
    expect(pickLeaders(users, { sales: 'm1' }).sales?.id).toBe('m1');
    expect(pickLeaders(users, { smm: 'old' }).smm?.id).toBe('s1');
  });

  it('нет никого — null', () => {
    const leaders = pickLeaders([], {});
    expect(leaders.sales).toBeNull();
    expect(leadsOf({ id: 'f' }, leaders)).toEqual([]);
  });

  it('члены отдела — действующие по основной роли', () => {
    expect(membersOf(users, 'smm').map(u => u.id)).toEqual(['s1', 's2']);
    expect(membersOf(users, 'sales').map(u => u.id)).toEqual(['m1']);
  });
});
