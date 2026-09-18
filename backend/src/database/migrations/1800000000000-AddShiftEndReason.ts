import { MigrationInterface, QueryRunner } from 'typeorm';

/** Пауза в смене (решение владельца, 18.09.2026).
 *
 *  Время по-прежнему считается отрезками: пауза закрывает текущий отрезок,
 *  продолжение открывает новый. Но «ушёл на обед» и «закончил день» — разные
 *  вещи, и в сводке у основателя они должны выглядеть по-разному. Поэтому у
 *  отрезка появляется причина закрытия:
 *    pause — человек на паузе, день не закончен;
 *    stop  — смена завершена;
 *    auto  — закрыл ночной крон (забыли нажать).
 *
 *  Старым записям ставим stop: они закрыты вручную кнопкой «Завершить». */
export class AddShiftEndReason1800000000000 implements MigrationInterface {
  name = 'AddShiftEndReason1800000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "work_shifts" ADD COLUMN IF NOT EXISTS "endReason" varchar(8) NULL
    `);
    await queryRunner.query(`
      UPDATE "work_shifts"
      SET "endReason" = CASE WHEN "autoClosed" THEN 'auto' ELSE 'stop' END
      WHERE "endedAt" IS NOT NULL AND "endReason" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_shifts" DROP COLUMN IF EXISTS "endReason"`);
  }
}
