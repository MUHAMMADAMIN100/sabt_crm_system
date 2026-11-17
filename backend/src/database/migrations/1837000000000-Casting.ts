import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Кастинг WeBrand (17.11.2026, docs/CASTING_SPEC.md §1): база людей для
 * съёмок (актёры, блогеры, модели), их фото, участие в съёмках и заявки
 * клиентов с публичного каталога.
 *
 * Всё IF NOT EXISTS: CastingService.onModuleInit дублирует эту схему, чтобы
 * сервер не падал, если миграция отстала. Поля повторяют casting.entity.ts.
 * Персональных данных здесь нет — они приходят через «Импорт» в CRM.
 */
export class Casting1837000000000 implements MigrationInterface {
  name = 'Casting1837000000000';

  async up(q: QueryRunner): Promise<void> {
    for (const sql of CASTING_DDL) await q.query(sql);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS casting_requests`);
    await q.query(`DROP TABLE IF EXISTS casting_bookings`);
    await q.query(`DROP TABLE IF EXISTS casting_photos`);
    await q.query(`DROP TABLE IF EXISTS casting_talents`);
  }
}

/** Схема кастинга — общая для миграции и CastingService.onModuleInit. */
export const CASTING_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS casting_talents (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     name varchar(200) NOT NULL,
     categories text[] NOT NULL DEFAULT '{}',
     city varchar(200) NULL,
     height varchar(20) NULL,
     "birthDate" date NULL,
     "ageBase" int NULL,
     "ageBaseAt" date NULL,
     tags text[] NOT NULL DEFAULT '{}',
     experience text NULL,
     links text[] NOT NULL DEFAULT '{}',
     phone varchar(40) NULL,
     telegram varchar(64) NULL,
     rate varchar(120) NULL,
     notes text NULL,
     "isPublic" boolean NOT NULL DEFAULT true,
     "isArchived" boolean NOT NULL DEFAULT false,
     "sortOrder" int NOT NULL DEFAULT 0,
     "sourceKey" varchar(80) NULL,
     "createdById" uuid NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "updatedAt" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "UQ_casting_talents_source_key" UNIQUE ("sourceKey")
   )`,

  // sourceName — имя файла из импорта (t00_0.jpg): повторный импорт по нему
  // понимает, какие фото у человека уже есть.
  `CREATE TABLE IF NOT EXISTS casting_photos (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "talentId" uuid NOT NULL REFERENCES casting_talents(id) ON DELETE CASCADE,
     path varchar(300) NOT NULL,
     "sourceName" varchar(200) NULL,
     "sortOrder" int NOT NULL DEFAULT 0,
     "createdAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_casting_photos_talent" ON casting_photos ("talentId", "sortOrder")`,

  `CREATE TABLE IF NOT EXISTS casting_bookings (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "talentId" uuid NOT NULL REFERENCES casting_talents(id) ON DELETE CASCADE,
     "contentItemId" uuid NOT NULL REFERENCES content_plan_items(id) ON DELETE CASCADE,
     status varchar(16) NOT NULL DEFAULT 'invited',
     note varchar(500) NULL,
     "createdById" uuid NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "UQ_casting_bookings_talent_item" UNIQUE ("talentId", "contentItemId")
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_casting_bookings_item" ON casting_bookings ("contentItemId")`,

  `CREATE TABLE IF NOT EXISTS casting_requests (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     "talentId" uuid NOT NULL REFERENCES casting_talents(id) ON DELETE CASCADE,
     "leadId" uuid NULL REFERENCES client_leads(id) ON DELETE SET NULL,
     "createdAt" timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_casting_requests_talent" ON casting_requests ("talentId")`,
];
