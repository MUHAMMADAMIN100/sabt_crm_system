import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Смонтировано — значит снято (09.11.2026). К этому дню монтажёр отметил
 * готовым почти весь ноябрь, а съёмки тех же рилсов так и стояли «в работе»
 * на будущих днях: видеографу и продюсеру шли «съёмки на завтра» по давно
 * снятому. Разово закрываем такие съёмки. Дальше это делает сервис, когда
 * монтажёр отмечает монтаж (ContentPlanService.closeShootAfterEdit).
 *
 * День съёмки, если он позже дня монтажа, переносим на день монтажа: снята
 * она точно не позже. Время правки берём у монтажа — тогда у видеографа не
 * появится «закрыто 9 нояб, план был 6 нояб» на десятках карточек.
 * Отменённые и уже закрытые съёмки не трогаем. Откатить нельзя: прежние
 * даты нигде не хранятся, а смысла в них не было.
 */
export class CloseEditedShoots1825000000000 implements MigrationInterface {
  name = 'CloseEditedShoots1825000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH ed AS (
        SELECT DISTINCT ON (e."shootForItemId")
               e."shootForItemId" AS reel,
               e."updatedAt" AS at,
               ((e."updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dushanbe')::date AS day
          FROM content_plan_items e
         WHERE e."prepStage" = 'edit' AND e.status::text = 'published' AND e."shootForItemId" IS NOT NULL
         ORDER BY e."shootForItemId", e."updatedAt" DESC
      )
      UPDATE content_plan_items s
         SET status = 'published',
             "publishDate" = CASE
               WHEN s."publishDate" IS NOT NULL AND s."publishDate"::date > ed.day THEN ed.day::timestamp
               ELSE s."publishDate" END,
             "updatedAt" = ed.at
        FROM ed
       WHERE s."shootForItemId" = ed.reel
         AND COALESCE(s."prepStage", 'shoot') = 'shoot'
         AND s.status::text NOT IN ('published', 'cancelled')`);
  }

  async down(): Promise<void> {
    // Разовая уборка данных — обратного шага нет (см. комментарий выше).
  }
}
