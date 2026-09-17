import { MigrationInterface, QueryRunner } from 'typeorm';

/** Разовая уборка (решение владельца, 17.09.2026): убрать из кабинетов СММ
 *  ВСЕ незакрытые задачи со сроком раньше 1 сентября 2026 — июньские,
 *  июльские и августовские хвосты, которые висят в списке «Мои задачи».
 *
 *  Прошлая уборка (1795000000000) брала только шесть стартовых автозадач по
 *  названию; здесь отбор по сроку, названия не важны.
 *
 *  Границы (согласованы с владельцем):
 *    • задачи SMM-проектов;
 *    • плюс задачи БЕЗ проекта, если исполнитель — сотрудник СММ
 *      (smm_specialist / smm_director / storymaker / scriptwriter),
 *      включая тех, у кого это вторая роль;
 *    • только незакрытые (new, in_progress). Выполненные и отменённые
 *      остаются: они уже посчитаны в KPI закрытых месяцев;
 *    • разработка не затрагивается вообще.
 *
 *  Порядок важен: у daily_reports внешний ключ на задачу БЕЗ каскада, поэтому
 *  сначала отвязываем отчёты. Остальные потомки (исполнители, чек-листы,
 *  комментарии, результаты, файлы, тайм-логи) уходят каскадом сами. */
export class DeleteOldSmmTasksBeforeSeptember1796000000000 implements MigrationInterface {
  name = 'DeleteOldSmmTasksBeforeSeptember1796000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE "_old_smm_tasks_sep" ON COMMIT DROP AS
      SELECT t.id
      FROM "tasks" t
      LEFT JOIN "projects" p ON p.id = t."projectId"
      LEFT JOIN "users" u ON u.id = t."assigneeId"
      WHERE t.deadline IS NOT NULL
        AND t.deadline < '2026-09-01'
        AND t.status IN ('new', 'in_progress')
        AND (
          p."projectType" = 'SMM'
          OR (
            t."projectId" IS NULL
            AND (
              u.role IN ('smm_specialist', 'smm_director', 'storymaker', 'scriptwriter')
              OR u."secondaryRole" IN ('smm_specialist', 'smm_director', 'storymaker', 'scriptwriter')
            )
          )
        )
    `);

    const [{ count }] = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "_old_smm_tasks_sep"`);
    if (!count) {
      console.log('Старые задачи СММ до 1 сентября: удалять нечего');
      return;
    }

    // Отчёты: ссылка обнуляется, сам отчёт остаётся в истории.
    await queryRunner.query(`
      UPDATE "daily_reports" SET "taskId" = NULL
      WHERE "taskId" IN (SELECT id FROM "_old_smm_tasks_sep")
    `);
    // Контент-план: обычная колонка без внешнего ключа. Карточка в календаре
    // остаётся, отвязываем только зеркальную задачу.
    await queryRunner.query(`
      UPDATE "content_plan_items" SET "taskId" = NULL
      WHERE "taskId" IN (SELECT id FROM "_old_smm_tasks_sep")
    `);
    // Уведомления привязаны к задаче текстовой ссылкой, внешнего ключа нет.
    await queryRunner.query(`
      DELETE FROM "notifications"
      WHERE "link" IN (SELECT '/tasks/' || id FROM "_old_smm_tasks_sep")
    `);

    await queryRunner.query(`DELETE FROM "tasks" WHERE id IN (SELECT id FROM "_old_smm_tasks_sep")`);
    console.log(`Старые задачи СММ до 1 сентября: удалено ${count}`);
  }

  async down(): Promise<void> {
    // Необратимо: задачи удалены вместе с потомками, восстановить их из
    // схемы невозможно. Откат не выполняем осознанно.
  }
}
