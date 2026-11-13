import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Директ»: метка «Горячий» и «горячий» — одна и та же (13.11.2026).
 * Проверка в коде и запись шли двумя шагами — два одновременных запроса
 * создавали дубль. Теперь уникальность без учёта регистра держит база.
 * Если дубли уже есть — к ним дописывается номер, иначе индекс не создать.
 */
export class DirectLabelsUniqueCi1829000000000 implements MigrationInterface {
  name = 'DirectLabelsUniqueCi1829000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE direct_labels d SET name = left(d.name, 34) || ' (' || r.rn || ')'
        FROM (SELECT id, row_number() OVER (PARTITION BY lower(name) ORDER BY "createdAt", id) AS rn FROM direct_labels) r
       WHERE r.id = d.id AND r.rn > 1`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_direct_labels_name_ci" ON direct_labels (lower(name))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_direct_labels_name_ci"`);
  }
}
