import {
  DELEGATE_ROLES, REVIEW_WINDOW_DAYS, delegateRoleOf, hasOtherAssignee, isAwaitingReview, isSmmSpecialistUser,
} from './task-delegation';

/** Задачи от SMM-специалиста команде и «Ждёт проверки» (17.11.2026,
 *  docs/SMM_DELEGATION_SPEC.md §1). */
describe('делегирование задач SMM-специалистом', () => {
  it('SMM-специалист — основной или второй ролью', () => {
    expect(isSmmSpecialistUser({ role: 'smm_specialist' })).toBe(true);
    expect(isSmmSpecialistUser({ role: 'designer', secondaryRole: 'smm_specialist' })).toBe(true);
    expect(isSmmSpecialistUser({ role: 'smm_director' })).toBe(false);
    expect(isSmmSpecialistUser(null)).toBe(false);
  });

  it('кому можно: дизайнер, продюсер, монтажёр, видеограф — основная роль в приоритете', () => {
    expect(DELEGATE_ROLES).toEqual(['designer', 'producer', 'video_editor', 'videographer']);
    expect(delegateRoleOf({ role: 'designer' })).toBe('designer');
    expect(delegateRoleOf({ role: 'employee', secondaryRole: 'videographer' })).toBe('videographer');
    expect(delegateRoleOf({ role: 'video_editor', secondaryRole: 'producer' })).toBe('video_editor');
    expect(delegateRoleOf({ role: 'sales_manager_smm' })).toBeNull();
    expect(delegateRoleOf({ role: 'smm_specialist', secondaryRole: null })).toBeNull();
  });

  it('есть ли исполнитель, кроме автора — основной или в очереди', () => {
    expect(hasOtherAssignee({ assigneeId: 'a' }, 'a')).toBe(false);
    expect(hasOtherAssignee({ assigneeId: 'a', assignees: [{ userId: 'a' }, { userId: 'b' }] }, 'a')).toBe(true);
    expect(hasOtherAssignee({ assigneeId: null, assignees: [] }, 'a')).toBe(false);
    expect(hasOtherAssignee({ assigneeId: 'b' }, null)).toBe(false);
  });
});

describe('«Ждёт проверки»', () => {
  const NOW = new Date('2026-11-17T10:00:00Z');
  const base = {
    status: 'done', createdById: 'smm', assigneeId: 'des',
    reviewedAt: null, completedAt: '2026-11-16T10:00:00Z',
  };

  it('сдано другим, не принято, за последние 14 дней — ждёт', () => {
    expect(REVIEW_WINDOW_DAYS).toBe(14);
    expect(isAwaitingReview(base, NOW)).toBe(true);
  });

  it('принята, ещё в работе или без даты сдачи — не ждёт', () => {
    expect(isAwaitingReview({ ...base, reviewedAt: '2026-11-16T12:00:00Z' }, NOW)).toBe(false);
    expect(isAwaitingReview({ ...base, status: 'in_progress' }, NOW)).toBe(false);
    expect(isAwaitingReview({ ...base, completedAt: null }, NOW)).toBe(false);
  });

  it('граница окна: ровно 14 дней назад — ждёт, на секунду раньше — уже нет', () => {
    expect(isAwaitingReview({ ...base, completedAt: '2026-11-03T10:00:00Z' }, NOW)).toBe(true);
    expect(isAwaitingReview({ ...base, completedAt: '2026-11-03T09:59:59Z' }, NOW)).toBe(false);
  });

  it('автор — единственный исполнитель — проверять нечего', () => {
    expect(isAwaitingReview({ ...base, assigneeId: 'smm' }, NOW)).toBe(false);
    expect(isAwaitingReview({ ...base, assigneeId: 'smm', assignees: [{ userId: 'smm' }, { userId: 'des' }] }, NOW)).toBe(true);
  });
});
