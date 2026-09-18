import { MigrationInterface, QueryRunner } from 'typeorm';

/** Съёмки — на руководителя видеографии (решение владельца, 18.09.2026).
 *
 *  Раньше система сама угадывала видеографа: назначенный на проекте, иначе
 *  «единственный в агентстве». Когда видеографов несколько, съёмка оставалась
 *  ничьей. Теперь за реализацию отвечает руководитель видеографии, а он уже
 *  передаёт съёмку дальше, если не успевает.
 *
 *  Разово переводим на него БУДУЩИЕ незакрытые съёмки — иначе правило
 *  подействовало бы только на новые карточки, а текущие остались бы
 *  разобранными по старой логике. Прошедшие и закрытые не трогаем: там работа
 *  уже сделана или идёт, перекидывать её задним числом незачем.
 *
 *  Съёмки проектов, где руководитель закрепил видеографа
 *  (smmData.videographerIds), оставляем как есть — это его же решение.
 *
 *  Если активных руководителей видеографии ноль или несколько, ничего не
 *  делаем: угадывать, кто из них главный, миграция не должна. */
export class ShootsToVideoDirector1798000000000 implements MigrationInterface {
  name = 'ShootsToVideoDirector1798000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const heads: any[] = await queryRunner.query(`
      SELECT u.id FROM "users" u
      WHERE u."isActive" = true
        AND (u.role = 'video_director' OR u."secondaryRole" = 'video_director')
    `);
    if (heads.length !== 1) {
      console.log(`Съёмки на руководителя видеографии: пропущено (подходящих руководителей — ${heads.length})`);
      return;
    }
    const headId = heads[0].id;

    const moved: any[] = await queryRunner.query(`
      UPDATE "content_plan_items" ci
      SET "assigneeId" = $1
      FROM "projects" p
      WHERE p.id = ci."projectId"
        AND ci."prepStage" = 'shoot'
        AND ci."publishDate" IS NOT NULL
        AND ci."publishDate"::date >= CURRENT_DATE
        AND ci.status NOT IN ('published', 'cancelled')
        AND ci."assigneeId" IS DISTINCT FROM $1
        -- CASE, а не jsonb_array_length напрямую: если в поле окажется не
        -- массив, функция упала бы и уронила миграцию вместе с деплоем.
        AND (CASE WHEN jsonb_typeof(p."smmData"->'videographerIds') = 'array'
                  THEN jsonb_array_length(p."smmData"->'videographerIds')
                  ELSE 0 END) = 0
      RETURNING ci.id
    `, [headId]);
    console.log(`Съёмки на руководителя видеографии: переведено ${Array.isArray(moved) ? moved.length : 0}`);
  }

  async down(): Promise<void> {
    // Возврата нет: кто именно снимал до перевода, схема не помнит.
    // Руководитель распределяет съёмки заново кнопкой «Передать».
  }
}
