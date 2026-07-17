import { MigrationInterface, QueryRunner } from 'typeorm';

/** FCM-токены устройств мобильного приложения (пуш-уведомления).
 *  Идемпотентно — колонка также добавляется в auth.service.onModuleInit. */
export class AddUserFcmTokens1784400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fcmTokens" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "fcmTokens"`);
  }
}
