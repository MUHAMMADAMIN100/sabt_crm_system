import { DEV_PROJECT_TYPES } from '../../common/sales-segment';
import {
  canEditSmmProject, canViewProject, crewProjectSql, directionTypesOf, inDirection, isOwnProject,
} from './project-access';

/** Доступ к проекту (15.11.2026): одно правило для чтения и правки. */
const smm = (extra: any = {}) => ({ id: 'p', projectType: 'SMM', managerId: 'm', smmData: {}, ...extra });
const dev = (extra: any = {}) => ({ id: 'd', projectType: 'Лендинг', managerId: 'm', smmData: {}, ...extra });

describe('Свой SMM-проект', () => {
  it('менеджер, участник или назначенный специалист', () => {
    const p = smm({ smmData: { smmSpecialistIds: ['s'] } });
    expect(isOwnProject({ id: 'm' }, p)).toBe(true);
    expect(isOwnProject({ id: 'u' }, p, ['u'])).toBe(true);
    expect(isOwnProject({ id: 's' }, p)).toBe(true);
    expect(isOwnProject({ id: 'x' }, p, ['u'])).toBe(false);
  });

  it('руководство SMM правит любой проект — и второй ролью тоже', () => {
    const p = smm();
    expect(canEditSmmProject({ id: 'x', role: 'smm_specialist' }, p)).toBe(false);
    expect(canEditSmmProject({ id: 'x', role: 'employee', secondaryRole: 'smm_director' }, p)).toBe(true);
    expect(canEditSmmProject({ id: 'x', role: 'founder' }, p)).toBe(true);
  });
});

describe('Направление пользователя', () => {
  it('руководство и роли без направления — без ограничений', () => {
    expect(directionTypesOf({ id: 'a', role: 'admin' })).toBeNull();
    expect(directionTypesOf({ id: 'e', role: 'employee' })).toBeNull();
  });

  it('две роли — объединение направлений', () => {
    expect(directionTypesOf({ id: 'x', role: 'smm_specialist', secondaryRole: 'sales_manager_dev' }))
      .toEqual(expect.arrayContaining(['SMM', ...DEV_PROJECT_TYPES]));
    const sabrina = { id: 's', role: 'sales_manager_dev', secondaryRole: 'dev_director' };
    expect(inDirection(sabrina, 'SMM')).toBe(false);
    expect(inDirection(sabrina, 'Лендинг')).toBe(true);
  });

  it('МП второй ролью ограничен своим сегментом', () => {
    expect(inDirection({ id: 'x', role: 'employee', secondaryRole: 'sales_manager_smm' }, 'Лендинг')).toBe(false);
  });
});

describe('Кто видит проект', () => {
  it('SMM открыт обоим МП на просмотр, «Дизайн» — нет', () => {
    const mp = { id: 'x', role: 'sales_manager_dev' };
    expect(canViewProject(mp, smm())).toBe(true);
    expect(canViewProject(mp, dev())).toBe(true);
    expect(canViewProject(mp, { id: 'z', projectType: 'Дизайн', managerId: 'm' })).toBe(false);
  });

  it('руководитель SMM не видит разработку даже с грантом просмотра', () => {
    expect(canViewProject({ id: 'x', role: 'smm_director', extraPermissions: ['projects.view'] }, dev())).toBe(false);
  });

  it('проект-менеджер разработки видит SMM-проект, только если он в нём участник', () => {
    const pm = { id: 'x', role: 'pm_dev' };
    expect(canViewProject(pm, smm())).toBe(false);
    expect(canViewProject(pm, smm(), { memberIds: ['x'] })).toBe(true);
  });

  it('видеограф команды и исполнитель карточки открывают проект', () => {
    expect(canViewProject({ id: 'v', role: 'videographer' }, smm({ smmData: { videographerIds: ['v'] } }))).toBe(true);
    expect(canViewProject({ id: 'v', role: 'videographer' }, smm())).toBe(false);
    expect(canViewProject({ id: 'v', role: 'videographer' }, smm(), { hasWork: true })).toBe(true);
  });

  it('грант просмотра у роли без направления — все проекты', () => {
    expect(canViewProject({ id: 'e', role: 'employee', extraPermissions: ['projects.view'] }, dev())).toBe(true);
    expect(canViewProject({ id: 'e', role: 'employee' }, dev())).toBe(false);
  });

  it('сторисмейкер видит SMM-проекты', () => {
    expect(canViewProject({ id: 'e', role: 'employee' }, smm(), { isStoryMaker: true })).toBe(true);
  });
});

describe('Съёмочная группа в списках', () => {
  it('условие покрывает видеографа, монтажёра и дизайнера', () => {
    const sql = crewProjectSql('project', 'uid');
    for (const k of ['videographerIds', 'videoEditorIds', 'designerIds']) {
      expect(sql).toContain(`project."smmData"->'${k}'`);
    }
    expect(sql).toContain(':uid');
  });
});
