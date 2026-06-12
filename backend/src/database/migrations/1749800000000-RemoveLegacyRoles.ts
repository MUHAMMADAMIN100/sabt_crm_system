import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Реструктуризация ролей (12.06.2026):
 *
 * Удаляются: project_manager, head_smm, targetologist, marketer.
 * Добавляются: video_director, video_editor, organizer, storymaker.
 *
 * Миграция существующих пользователей:
 *   head_smm        → smm_director  (ближайший управленческий аналог)
 *   project_manager → employee      (права на свои проекты сохраняются
 *                                    через project.managerId — менеджер
 *                                    проекта теперь назначается любому
 *                                    сотруднику и даёт руководство этим
 *                                    проектом без отдельной роли)
 *   targetologist   → employee
 *   marketer        → employee
 *
 * users.role — varchar, схему менять не нужно. Новые значения добавляем
 * в legacy enum-типы для подстраховки (как в AddVideographerRole).
 * ALTER TYPE ... ADD VALUE требует transaction = false.
 */
export class RemoveLegacyRoles1749800000000 implements MigrationInterface {
  name = 'RemoveLegacyRoles1749800000000';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Новые значения в legacy enum-типы (если они ещё существуют).
    for (const enumName of ['user_role_enum', 'users_role_enum']) {
      for (const value of ['video_director', 'video_editor', 'organizer', 'storymaker']) {
        try {
          await queryRunner.query(
            `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}'`,
          );
        } catch {
          // Тип не существует — ок.
        }
      }
    }

    // 2) Конвертация пользователей с удалённых ролей.
    await queryRunner.query(
      `UPDATE users SET role = 'smm_director' WHERE role = 'head_smm'`,
    );
    await queryRunner.query(
      `UPDATE users SET role = 'employee'
       WHERE role IN ('project_manager', 'targetologist', 'marketer')`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Обратная конвертация невозможна — исходные роли потеряны.
  }
}
