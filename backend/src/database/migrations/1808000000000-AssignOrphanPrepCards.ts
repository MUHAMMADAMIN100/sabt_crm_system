import { MigrationInterface, QueryRunner } from 'typeorm';

/** Раздать «ничьи» карточки подготовки (решение владельца, 23.09.2026).
 *
 *  Съёмка, монтаж и дизайн уходят исполнителю в момент создания карточки, но
 *  карточки, заведённые ДО появления этого правила, так и остались без
 *  исполнителя. В кабинете видеографа, монтажёра и дизайнера их не видно:
 *  кабинет показывает то, что назначено лично человеку.
 *
 *  Специалист каждой роли у нас один, поэтому раздаём по тому же правилу, что
 *  работает при создании: кто закреплён за проектом → главный видеограф → или
 *  единственный в агентстве человек с ролью этапа. Несколько кандидатов —
 *  не трогаем, угадывать за людей не беремся.
 *
 *  Разово, миграцией, а не при каждом старте: снятого вручную исполнителя
 *  возвращать назад нельзя. */
export class AssignOrphanPrepCards1808000000000 implements MigrationInterface {
  name = 'AssignOrphanPrepCards1808000000000';

  /** Единственный активный сотрудник с ролью (основной или второй).
   *  Несколько или ни одного — NULL. */
  private sole(role: string): string {
    return `(SELECT max(u.id::text)::uuid FROM users u
              WHERE u."isActive" = true
                AND (u.role::text = '${role}' OR u."secondaryRole"::text = '${role}')
             HAVING count(*) = 1)`;
  }

  private async fill(q: QueryRunner, stage: string, field: string, target: string): Promise<number> {
    const res = await q.query(`
      UPDATE content_plan_items ci
         SET "assigneeId" = COALESCE(
               -- 1. закреплён за проектом
               CASE WHEN p."smmData"->'${field}'->>0 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                    THEN (p."smmData"->'${field}'->>0)::uuid END,
               -- 2. правило по умолчанию для этапа
               ${target}
             )
        FROM projects p
       WHERE p.id = ci."projectId"
         AND ci."shootForItemId" IS NOT NULL
         AND ci."prepStage" = '${stage}'
         AND ci."assigneeId" IS NULL
         AND ci.status::text NOT IN ('published', 'cancelled')
         AND COALESCE(
               CASE WHEN p."smmData"->'${field}'->>0 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                    THEN (p."smmData"->'${field}'->>0)::uuid END,
               ${target}
             ) IS NOT NULL
      RETURNING ci.id`);
    return Array.isArray(res) ? res.length : 0;
  }

  async up(q: QueryRunner): Promise<void> {
    // Съёмка: главный видеограф важнее «единственного» — большую часть съёмок
    // делает он, а напарнику передаёт вручную.
    const mainVideographer = `COALESCE(
      (SELECT max(u.id::text)::uuid FROM users u
        WHERE u."isDefaultVideographer" = true AND u."isActive" = true),
      ${this.sole('videographer')},
      ${this.sole('video_director')})`;

    const shoot = await this.fill(q, 'shoot', 'videographerIds', mainVideographer);
    const edit = await this.fill(q, 'edit', 'videoEditorIds', this.sole('video_editor'));
    const design = await this.fill(q, 'design', 'designerIds', this.sole('designer'));
    // eslint-disable-next-line no-console
    console.log(`[1808] Карточки подготовки розданы: съёмка ${shoot}, монтаж ${edit}, дизайн ${design}`);
  }

  async down(): Promise<void> {
    // Обратно обезличивать карточки незачем.
  }
}
