import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чистка списка должностей (25.09.2026, решение владельца).
 *
 * Убраны семь ролей: co_founder, video_director, storymaker, organizer,
 * scriptwriter, qa, publisher.
 *
 * Куда переносим людей (и основную роль, и вторую):
 *   video_director → videographer     (видеограф у нас один, руководить некем)
 *   storymaker     → smm_specialist   (сторис ведут SMM-специалисты)
 *   co_founder     → admin            (страховка: на 25.09.2026 роль пустая)
 *   organizer / scriptwriter / qa / publisher → employee
 *     (у этих ролей своих прав не было — только строка в списке должностей)
 *
 * Отдельно: кто был «сторисмейкером» — получает флаг employees.isStoryMaker,
 * он и открывает все активные SMM-проекты для отметки историй. Так доступ
 * не теряется вместе с ролью.
 *
 * users.role — varchar, схему менять не нужно.
 */
export class RemoveUnusedRoles1809000000000 implements MigrationInterface {
  name = 'RemoveUnusedRoles1809000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Сторисмейкеры (основная роль или вторая) — сохраняем доступ флагом.
    await queryRunner.query(
      `UPDATE employees e SET "isStoryMaker" = true
         FROM users u
        WHERE u.id = e."userId"
          AND (u.role::text = 'storymaker' OR u."secondaryRole"::text = 'storymaker')`,
    );

    // 2) Перенос основной роли.
    const MAP: Array<[string, string]> = [
      ['video_director', 'videographer'],
      ['storymaker', 'smm_specialist'],
      ['co_founder', 'admin'],
      ['organizer', 'employee'],
      ['scriptwriter', 'employee'],
      ['qa', 'employee'],
      ['publisher', 'employee'],
    ];
    for (const [from, to] of MAP) {
      await queryRunner.query(
        `UPDATE users SET role = $1 WHERE role::text = $2`, [to, from],
      );
      await queryRunner.query(
        `UPDATE users SET "secondaryRole" = $1 WHERE "secondaryRole"::text = $2`, [to, from],
      );
    }

    // 3) Вторая роль могла совпасть с основной — убираем дубль.
    await queryRunner.query(
      `UPDATE users SET "secondaryRole" = NULL
        WHERE "secondaryRole" IS NOT NULL AND "secondaryRole"::text = role::text`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Обратный перенос невозможен — исходные роли не сохраняются.
  }
}
