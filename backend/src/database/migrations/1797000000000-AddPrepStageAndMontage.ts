import { MigrationInterface, QueryRunner } from 'typeorm';

/** Этап «Монтаж» в цепочке производства рилса (решение владельца, 17.09.2026).
 *
 *  Было: Съёмка → Публикация. Монтажёру нечего было получить — его работа
 *  не существовала как отдельная карточка со своим сроком.
 *  Стало: Съёмка → Монтаж → Публикация.
 *
 *  Карточки подготовки и раньше жили в content_plan_items со ссылкой
 *  shootForItemId на родителя; отличить съёмку от дизайна можно было только
 *  по типу родителя. Теперь этап хранится явно в "prepStage":
 *    shoot  — съёмка (видеограф),
 *    edit   — монтаж (монтажёр),
 *    design — макет/дизайн (дизайнер).
 *  Явное поле нужно потому, что у рилса теперь ДВЕ карточки подготовки,
 *  и тип родителя их больше не различает.
 *
 *  Монтаж дозаполняем только для БУДУЩИХ рилсов (дата выхода от сегодня):
 *  заводить монтаж на уже вышедшие ролики бессмысленно — работа сделана. */
export class AddPrepStageAndMontage1797000000000 implements MigrationInterface {
  name = 'AddPrepStageAndMontage1797000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_plan_items" ADD COLUMN IF NOT EXISTS "prepStage" varchar(8) NULL
    `);

    // Существующие карточки подготовки: тип родителя даёт этап однозначно.
    await queryRunner.query(`
      UPDATE "content_plan_items"
      SET "prepStage" = CASE WHEN "contentType" = 'post' THEN 'design' ELSE 'shoot' END
      WHERE "shootForItemId" IS NOT NULL AND "prepStage" IS NULL
    `);

    // Монтаж под будущие рилсы — за день до выхода. Если карточка монтажа
    // уже есть (повторный прогон миграции), не дублируем.
    const inserted = await queryRunner.query(`
      INSERT INTO "content_plan_items"
        ("projectId", "contentType", "topic", "shootForItemId", "prepStage", "publishDate", "status")
      SELECT r."projectId", r."contentType", 'Монтаж', r.id, 'edit',
             (r."publishDate" - INTERVAL '1 day'), 'planned'
      FROM "content_plan_items" r
      WHERE r."shootForItemId" IS NULL
        AND r."contentType" = 'reel'
        AND r."publishDate" IS NOT NULL
        AND r."publishDate"::date >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM "content_plan_items" e
          WHERE e."shootForItemId" = r.id AND e."prepStage" = 'edit'
        )
      RETURNING id
    `);
    console.log(`Этап «Монтаж»: заведено карточек — ${Array.isArray(inserted) ? inserted.length : 0}`);

    // Разовая раздача исполнителей: если в агентстве ровно один человек с
    // ролью этапа (у нас так с дизайнером), все его карточки уходят ему.
    // Дальше новые карточки получают исполнителя при создании.
    await queryRunner.query(`
      WITH sole AS (
        SELECT 'shoot' AS stage, (array_agg(u.id))[1] AS uid FROM "users" u
        WHERE u."isActive" = true AND (u.role = 'videographer' OR u."secondaryRole" = 'videographer')
        HAVING COUNT(*) = 1
        UNION ALL
        SELECT 'edit', (array_agg(u.id))[1] FROM "users" u
        WHERE u."isActive" = true AND (u.role = 'video_editor' OR u."secondaryRole" = 'video_editor')
        HAVING COUNT(*) = 1
        UNION ALL
        SELECT 'design', (array_agg(u.id))[1] FROM "users" u
        WHERE u."isActive" = true AND (u.role = 'designer' OR u."secondaryRole" = 'designer')
        HAVING COUNT(*) = 1
      )
      UPDATE "content_plan_items" ci
      SET "assigneeId" = sole.uid
      FROM sole
      WHERE ci."prepStage" = sole.stage
        AND ci."assigneeId" IS NULL
        AND ci."publishDate" IS NOT NULL
        AND ci."publishDate"::date >= CURRENT_DATE - INTERVAL '30 days'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cpi_prep_stage"
      ON "content_plan_items" ("shootForItemId", "prepStage")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Возврат к схеме без монтажа: удаляем карточки монтажа и саму колонку.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cpi_prep_stage"`);
    await queryRunner.query(`DELETE FROM "content_plan_items" WHERE "prepStage" = 'edit'`);
    await queryRunner.query(`ALTER TABLE "content_plan_items" DROP COLUMN IF EXISTS "prepStage"`);
  }
}
