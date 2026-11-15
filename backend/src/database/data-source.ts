import 'dotenv/config';
import { DataSource } from 'typeorm';
import { join } from 'path';

/**
 * Standalone DataSource for TypeORM CLI (migrations).
 * Used by: npm run migration:generate / migration:run / migration:revert
 *
 * The NestJS app uses app.module.ts (TypeOrmModule.forRootAsync) at runtime.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '../**/*.entity.{ts,js}')],
  migrations: [join(__dirname, './migrations/*.{ts,js}')],
  // Как в app.module (15.11.2026): каждая миграция — в своей транзакции.
  // С режимом по умолчанию ('all') TypeORM отказывается запускать миграции
  // с `transaction = false` (ALTER TYPE … ADD VALUE), и CLI падал там, где
  // приложение проходит.
  migrationsTransactionMode: 'each',
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
});
