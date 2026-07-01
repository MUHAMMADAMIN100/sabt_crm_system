import { db } from './db';
import { DEFAULT_CATEGORIES } from '../lib/constants';

// Сид = только структурная таксономия категорий (на их фиксированные id ссылается код
// при создании операций: cat-smm, cat-salary, cat-debt и т.д.).
// Реальные данные — счета, клиенты, сотрудники, аренда/подписки, долги, операции —
// с нуля. Добавляются вручную после деплоя или импортом резервной копии
// (Настройки → Импорт JSON).

let seedPromise: Promise<void> | null = null;
export function seedIfEmpty(): Promise<void> {
  if (!seedPromise) seedPromise = runSeed();
  return seedPromise;
}

async function runSeed(): Promise<void> {
  if (await db.meta.get('seeded')) return;

  await db.transaction('rw', [db.categories, db.meta], async () => {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
    await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
  });
}
