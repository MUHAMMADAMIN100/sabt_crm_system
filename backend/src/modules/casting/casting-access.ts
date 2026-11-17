/**
 * Доступ к кастингу (17.11.2026, docs/CASTING_SPEC.md). Роль основная или
 * вторая — как везде (project-access.hasAnyRole).
 *
 *  - видят базу: основатель, админ, руководитель SMM, продюсер,
 *    SMM-специалисты, видеографы;
 *  - добавляют и правят: основатель, админ, руководитель SMM, продюсер;
 *  - импорт: основатель, админ, руководитель SMM;
 *  - ставят людей в съёмку, меняют статус, убирают: кто правит кастинг и
 *    SMM-специалист проекта этой съёмки.
 */
import { AccessProject, AccessUser, hasAnyRole, isOwnProject, smmSpecialistIdsOf } from '../projects/project-access';

export const CASTING_VIEW_ROLES = ['founder', 'admin', 'smm_director', 'producer', 'smm_specialist', 'videographer'] as const;
export const CASTING_EDIT_ROLES = ['founder', 'admin', 'smm_director', 'producer'] as const;
export const CASTING_IMPORT_ROLES = ['founder', 'admin', 'smm_director'] as const;

export function canViewCasting(u: AccessUser | null | undefined): boolean {
  return hasAnyRole(u, CASTING_VIEW_ROLES);
}

export function canEditCasting(u: AccessUser | null | undefined): boolean {
  return hasAnyRole(u, CASTING_EDIT_ROLES);
}

export function canImportCasting(u: AccessUser | null | undefined): boolean {
  return hasAnyRole(u, CASTING_IMPORT_ROLES);
}

/** SMM-специалист проекта: назначен в smmData.smmSpecialistIds или — с ролью
 *  SMM-специалиста — менеджер/участник проекта. */
export function isProjectSmm(
  u: AccessUser | null | undefined,
  project: Pick<AccessProject, 'managerId' | 'smmData'> | null | undefined,
  memberIds: readonly string[] = [],
): boolean {
  if (!u?.id || !project) return false;
  if (smmSpecialistIdsOf(project.smmData).includes(u.id)) return true;
  return hasAnyRole(u, ['smm_specialist']) && isOwnProject(u, project, memberIds);
}

/** Ставить людей в съёмку и менять их статус. */
export function canBookForShoot(
  u: AccessUser | null | undefined,
  project: Pick<AccessProject, 'managerId' | 'smmData'> | null | undefined,
  memberIds: readonly string[] = [],
): boolean {
  return canEditCasting(u) || isProjectSmm(u, project, memberIds);
}
