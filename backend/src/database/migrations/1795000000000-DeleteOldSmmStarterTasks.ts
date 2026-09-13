import { MigrationInterface, QueryRunner } from 'typeorm';

/** Разовая уборка (решение владельца, сентябрь 2026): удалить стартовые
 *  автозадачи SMM-проектов со сроком РАНЬШЕ 1 сентября 2026.
 *
 *  Это шесть названий, которые система создаёт сама при запуске SMM-проекта
 *  с тарифом (generateStarterTasksFromTariff). Задачи, заведённые руками,
 *  не трогаем: отбор идёт по точному совпадению названия И типу проекта SMM.
 *
 *  Берём только НЕЗАКРЫТЫЕ задачи (new, in_progress). Выполненные и отменённые
 *  остаются: они уже попали в KPI прошлых месяцев, и удаление сдвинуло бы
 *  историю за периоды, которые давно закрыты.
 *
 *  Порядок важен: у daily_reports внешний ключ на задачу БЕЗ каскада, поэтому
 *  сначала отвязываем отчёты, иначе удаление упало бы на связности. Остальные
 *  потомки (исполнители, чек-листы, комментарии, результаты, файлы, тайм-логи)
 *  уходят каскадом сами. */
export class DeleteOldSmmStarterTasks1795000000000 implements MigrationInterface {
  name = 'DeleteOldSmmStarterTasks1795000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE "_old_smm_tasks" ON COMMIT DROP AS
      SELECT t.id
      FROM "tasks" t
      JOIN "projects" p ON p.id = t."projectId"
      WHERE p."projectType" = 'SMM'
        AND t.deadline IS NOT NULL
        AND t.deadline < '2026-09-01'
        AND t.status IN ('new', 'in_progress')
        AND t.title IN (
          'Брифинг с клиентом и сбор материалов',
          'Запросить и проверить доступы',
          'Подготовить контент-стратегию на месяц',
          'Согласовать контент-план с клиентом',
          'Запланировать первую съёмку',
          'Подготовить шаблон ежемесячного отчёта'
        )
    `);

    const [{ count }] = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "_old_smm_tasks"`);
    if (!count) {
      console.log('Старые стартовые задачи СММ: удалять нечего');
      return;
    }

    // Отчёты: ссылка обнуляется, сам отчёт остаётся в истории.
    await queryRunner.query(`
      UPDATE "daily_reports" SET "taskId" = NULL
      WHERE "taskId" IN (SELECT id FROM "_old_smm_tasks")
    `);
    // Контент-план: обычная колонка без внешнего ключа, чистим, чтобы не
    // осталось ссылок в никуда.
    await queryRunner.query(`
      UPDATE "content_plan_items" SET "taskId" = NULL
      WHERE "taskId" IN (SELECT id FROM "_old_smm_tasks")
    `);
    // Уведомления привязаны к задаче текстовой ссылкой, внешнего ключа нет.
    await queryRunner.query(`
      DELETE FROM "notifications"
      WHERE "link" IN (SELECT '/tasks/' || id FROM "_old_smm_tasks")
    `);

    await queryRunner.query(`DELETE FROM "tasks" WHERE id IN (SELECT id FROM "_old_smm_tasks")`);
    console.log(`Старые стартовые задачи СММ: удалено ${count}`);
  }

  async down(): Promise<void> {
    // Необратимо: задачи удалены вместе с потомками, восстановить их из
    // схемы невозможно. Откат не выполняем осознанно.
  }
}
