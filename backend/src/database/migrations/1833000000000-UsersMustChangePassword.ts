import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';

/**
 * users."mustChangePassword" (15.11.2026) + разовая отметка учёток, у которых
 * остался старый общий пароль «Sabt@2024» (его ставили всем новым
 * сотрудникам, и знала вся команда). Такие люди при следующем входе сменят
 * пароль — без ручного сброса каждой учётки.
 *
 * Проверка — сравнением с хешем (bcryptjs, как в User.validatePassword):
 * пароли в базе только хешами. Колонку добавляет и AuthService.onModuleInit,
 * но миграция идёт раньше любого onModuleInit — сущность с новым полем не
 * упадёт при первом чтении users.
 */
export class UsersMustChangePassword1833000000000 implements MigrationInterface {
  name = 'UsersMustChangePassword1833000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('users'))) return;
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false`,
    );
    const rows: Array<{ id: string; password: string | null }> = await queryRunner.query(
      `SELECT id, password FROM users WHERE "mustChangePassword" = false AND password IS NOT NULL`,
    );
    const legacy: string[] = [];
    for (const r of rows) {
      const hash = String(r.password || '');
      if (!/^\$2[aby]\$/.test(hash)) continue;
      try {
        if (await bcrypt.compare('Sabt@2024', hash)) legacy.push(r.id);
      } catch { /* битый хеш — пропускаем */ }
    }
    if (legacy.length) {
      await queryRunner.query(`UPDATE users SET "mustChangePassword" = true WHERE id = ANY($1::uuid[])`, [legacy]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('users'))) return;
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "mustChangePassword"`);
  }
}
