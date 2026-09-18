import { MigrationInterface, QueryRunner } from 'typeorm';

/** «Основной видеограф» (решение владельца, 18.09.2026).
 *
 *  Видеографов в агентстве двое, и примерно 80% съёмок делает один и тот же
 *  человек. Поэтому съёмки по умолчанию закрепляются за ним, а он передаёт
 *  их напарнику, когда не успевает.
 *
 *  Кто именно основной — настройка, а не имя в коде: флаг на пользователе,
 *  переключается в кабинете руководителя видеографии. Так смена человека
 *  не требует правок и деплоя.
 *
 *  Колонку только заводим. Назначение флага и разовый перевод будущих
 *  съёмок делает сам переключатель — в миграции угадывать, кто основной,
 *  нечем. */
export class AddDefaultVideographer1798000000000 implements MigrationInterface {
  name = 'AddDefaultVideographer1798000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isDefaultVideographer" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "isDefaultVideographer"`);
  }
}
