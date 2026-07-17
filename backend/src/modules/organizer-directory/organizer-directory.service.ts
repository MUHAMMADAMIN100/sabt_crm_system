import { Injectable, OnModuleInit, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, ILike } from 'typeorm';
import { OrgClient, OrgModel, OrgPlace } from './organizer-directory.entity';

/** Справочники организатора съёмок: клиенты / модели / места. Полный CRUD.
 *  Доступ ограничен грантом organizer.directory на уровне контроллера. */
@Injectable()
export class OrganizerDirectoryService implements OnModuleInit {
  private readonly logger = new Logger(OrganizerDirectoryService.name);

  constructor(
    @InjectRepository(OrgClient) private clientRepo: Repository<OrgClient>,
    @InjectRepository(OrgModel) private modelRepo: Repository<OrgModel>,
    @InjectRepository(OrgPlace) private placeRepo: Repository<OrgPlace>,
    private ds: DataSource,
  ) {}

  /** На проде synchronize выключен — таблицы создаём идемпотентным DDL. */
  async onModuleInit() {
    const run = async (sql: string) => {
      try { await this.ds.query(sql); }
      catch (e: any) { this.logger.warn(`organizer DDL skipped: ${String(e?.message || e).slice(0, 160)}`); }
    };
    await run(`CREATE TABLE IF NOT EXISTS org_clients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      company varchar(200), phone varchar(60), instagram varchar(120), telegram varchar(120),
      address varchar(300), note text, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS org_models (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      gender varchar(10), phone varchar(60), instagram varchar(120), look text, rate numeric(15,2),
      note text, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    // Таблица на проде могла быть создана до появления пола.
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "gender" varchar(10)`);
    // Разбили единое поле «Типаж» на возраст / внешность / опыт + фото модели.
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "age" varchar(60)`);
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "appearance" text`);
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "experience" text`);
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "photo" varchar(300)`);
    // «Знание языков» вместо «Заметки» в форме моделей (колонка note остаётся с данными).
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "languages" varchar(200)`);
    // Ссылка на видео с участием модели (портфолио для клиентов).
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "videoLink" varchar(500)`);
    // Несколько ссылок на видео (jsonb-массив). Одиночная legacy-ссылка
    // переносится в массив один раз; sanitize() держит колонки зеркальными
    // (videoLink = videoLinks[0]), поэтому UPDATE не воскрешает удалённое.
    await run(`ALTER TABLE org_models ADD COLUMN IF NOT EXISTS "videoLinks" jsonb`);
    await run(`UPDATE org_models SET "videoLinks" = jsonb_build_array("videoLink")
      WHERE "videoLinks" IS NULL AND "videoLink" IS NOT NULL AND "videoLink" <> ''`);
    // Ставка модели: numeric → varchar(100) — организатору нужны диапазоны
    // («400–600») и текст. Конвертация строго одноразовая (guard по типу
    // колонки), старые числа теряют хвост «.00».
    await run(`DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'org_models' AND column_name = 'rate'
                     AND data_type = 'numeric') THEN
          ALTER TABLE org_models ALTER COLUMN rate TYPE varchar(100)
            USING CASE WHEN rate IS NULL THEN NULL
                       ELSE regexp_replace(rate::text, '\\.?0+$', '') END;
        END IF;
      END $$`);
    // Старые записи: переносим объединённый «Типаж» во «Внешность», чтобы не потерять данные.
    // Миграция самоочищающаяся — обнуляем look в той же строке, иначе onModuleInit
    // на каждом рестарте заново копировал бы look в appearance и воскрешал бы
    // текст, который пользователь намеренно удалил.
    await run(`UPDATE org_models SET "appearance" = "look", "look" = NULL WHERE ("appearance" IS NULL OR "appearance" = '') AND "look" IS NOT NULL AND "look" <> ''`);
    await run(`CREATE TABLE IF NOT EXISTS org_places (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      address varchar(300), contact varchar(200), price numeric(15,2), link varchar(300),
      note text, "createdAt" timestamptz NOT NULL DEFAULT now())`);
  }

  private repoOf(kind: string): Repository<any> {
    if (kind === 'clients') return this.clientRepo;
    if (kind === 'models') return this.modelRepo;
    if (kind === 'places') return this.placeRepo;
    throw new BadRequestException('Неизвестный справочник');
  }

  /** Разрешённые поля каждого справочника — защита от мусора в body. */
  private static FIELDS: Record<string, string[]> = {
    clients: ['name', 'company', 'phone', 'instagram', 'telegram', 'address', 'note'],
    // «note» убран по просьбе организатора — вместо заметки «Знание языков».
    // ВАЖНО: 'videoLinks' идёт ПОСЛЕ 'videoLink' — при отправке обоих полей
    // массив побеждает (перезаписывает зеркало, см. sanitize).
    models: ['name', 'gender', 'phone', 'instagram', 'age', 'appearance', 'experience', 'photo', 'languages', 'rate', 'videoLink', 'videoLinks'],
    places: ['name', 'address', 'contact', 'price', 'link', 'note'],
  };

  /** Нормализация ссылки на видео: в href попадает только http(s)://
   *  (никаких javascript: и прочих схем); без схемы дописываем https://,
   *  чтобы клик вёл точно на видео, а не на относительный путь. */
  private normalizeVideoLink(raw: string): string {
    const s = raw.slice(0, 500);
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
    let valid = false;
    try {
      const u = new URL(withScheme);
      valid = (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && u.hostname.includes('.');
    } catch { valid = false; }
    if (!valid) throw new BadRequestException('Некорректная ссылка на видео — вставьте адрес вида https://…');
    return withScheme.slice(0, 500);
  }

  private sanitize(kind: string, dto: any): Record<string, any> {
    const out: Record<string, any> = {};
    for (const f of OrganizerDirectoryService.FIELDS[kind]) {
      if (dto[f] === undefined) continue;
      if (f === 'price') {
        const n = Number(dto[f]);
        out[f] = dto[f] === null || dto[f] === '' ? null : (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
      } else if (f === 'rate') {
        // Ставка модели — свободный текст («400–600», «договорная»), varchar(100).
        const v = typeof dto[f] === 'string' ? dto[f].trim().slice(0, 100)
          : dto[f] == null ? '' : String(dto[f]).slice(0, 100);
        out[f] = v === '' ? null : v;
      } else if (f === 'gender') {
        out[f] = dto[f] === 'female' || dto[f] === 'male' ? dto[f] : null;
      } else if (f === 'photo') {
        // Только безопасное имя файла (uuid.ext) — из него строится URL
        // /uploads/models/<photo>. Отсекаем пути и traversal (`../`).
        const raw = typeof dto[f] === 'string' ? dto[f].trim() : '';
        out[f] = /^[A-Za-z0-9._-]{1,120}$/.test(raw) ? raw : null;
      } else if (f === 'videoLink') {
        // Legacy-поле одиночной ссылки (старые клиенты API). Зеркалим в
        // массив, если массив в этом же запросе не прислан.
        const raw = typeof dto[f] === 'string' ? dto[f].trim() : '';
        const norm = raw === '' ? null : this.normalizeVideoLink(raw);
        out[f] = norm;
        if (dto.videoLinks === undefined) out.videoLinks = norm ? [norm] : null;
      } else if (f === 'videoLinks') {
        // Несколько ссылок на видео: массив строк, каждая нормализуется
        // (только http(s)://, без схемы дописываем https://), дубли и пустые
        // отбрасываем, максимум 10. Явный мусор — 400, не глотаем молча.
        const arrRaw = Array.isArray(dto[f]) ? dto[f] : (dto[f] == null ? [] : [dto[f]]);
        const seen = new Set<string>();
        const links: string[] = [];
        for (const item of arrRaw) {
          const raw = typeof item === 'string' ? item.trim() : '';
          if (!raw) continue;
          const norm = this.normalizeVideoLink(raw);
          if (!seen.has(norm)) { seen.add(norm); links.push(norm); }
          if (links.length >= 10) break;
        }
        out[f] = links.length ? links : null;
        // Зеркало для legacy-колонки — первая ссылка (или null). Благодаря
        // этому boot-миграция videoLink→videoLinks не воскрешает удалённое.
        out.videoLink = links[0] ?? null;
      } else if (f === 'age' || f === 'languages') {
        // varchar(60)/varchar(200): обрезаем, иначе длинная вставка → Postgres 22001 → 500.
        const max = f === 'age' ? 60 : 200;
        const v = typeof dto[f] === 'string' ? dto[f].trim().slice(0, max) : '';
        out[f] = v === '' ? null : v;
      } else {
        const v = typeof dto[f] === 'string' ? dto[f].trim() : dto[f];
        out[f] = v === '' ? null : v;
      }
    }
    return out;
  }

  async list(kind: string, search?: string) {
    const repo = this.repoOf(kind);
    const where = search?.trim() ? { name: ILike(`%${search.trim()}%`) } : {};
    const rows = await repo.find({ where, order: { createdAt: 'DESC' } });
    // rate моделей — теперь текст, не приводим к числу; price мест — деньги.
    return rows.map((r: any) => ({
      ...r,
      ...(r.price !== undefined ? { price: r.price === null ? null : Number(r.price) } : {}),
    }));
  }

  async create(kind: string, dto: any) {
    const data = this.sanitize(kind, dto);
    if (!data.name) throw new BadRequestException('Название/имя обязательно');
    const repo = this.repoOf(kind);
    return repo.save(repo.create(data));
  }

  async update(kind: string, id: string, dto: any) {
    const repo = this.repoOf(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Запись не найдена');
    const data = this.sanitize(kind, dto);
    if (data.name === null) throw new BadRequestException('Название/имя обязательно');
    Object.assign(row, data);
    return repo.save(row);
  }

  async remove(kind: string, id: string) {
    const repo = this.repoOf(kind);
    const res = await repo.delete(id);
    if (!res.affected) throw new NotFoundException('Запись не найдена');
    return { ok: true };
  }
}
