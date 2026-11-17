import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs/promises';
import { join } from 'path';
import { CASTING_DDL } from '../../database/migrations/1837000000000-Casting';
import { escapeHtml } from '../../common/html-escape';
import { ClientLeadDirection, ClientLeadStatus } from '../clients/client-lead.entity';
import { ClientsService } from '../clients/clients.service';
import { NotificationType } from '../notifications/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessUser, loadAccessRow } from '../projects/project-access';
import { TelegramService } from '../telegram/telegram.service';
import { canBookForShoot, canEditCasting, canImportCasting, canViewCasting } from './casting-access';
import { CastingTalent } from './casting.entity';
import {
  BOOKING_STATUSES, TalentRow, ageOf, bookingProblem, cleanBooking, cleanText, countTalents, dushanbeToday, isUuid,
  matchesSearch, matchesTab, parseImportData, parseListQuery, photoKey, talentPatch, toListItem, toPublicTalent,
} from './casting.logic';
import type {
  BookingStatus, ImportResult, PublicTalent, ShootTalentsView, TalentDetail, TalentListView, TalentRequest, TalentShoot,
} from './casting.types';
import { CASTING_DIR, CASTING_URL_PREFIX, isJsonFile, isPhotoFile, storedNameOf, storedPhotoName } from './casting-upload';

/** Кто действует: req.user (id, роли, имя). */
export type CastingUser = AccessUser & { id: string; name?: string | null };

/** Фото у одного человека — не больше. */
const MAX_PHOTOS_PER_TALENT = 40;

/** Поля человека для списка, карточки и каталога: даты строкой, фото — пути по порядку. */
const TALENT_SELECT = `
  SELECT t.id, t.name, t.categories, t.city, t.height,
         to_char(t."birthDate", 'YYYY-MM-DD') AS "birthDate",
         t."ageBase", to_char(t."ageBaseAt", 'YYYY-MM-DD') AS "ageBaseAt",
         t.tags, t.experience, t.links, t.phone, t.telegram, t.rate, t.notes,
         t."isPublic", t."isArchived", t."sortOrder",
         COALESCE((SELECT array_agg(p.path::text ORDER BY p."sortOrder" ASC, p."createdAt" ASC)
                     FROM casting_photos p WHERE p."talentId" = t.id), '{}'::text[]) AS photos
    FROM casting_talents t`;

const iso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

const statusOf = (v: unknown): BookingStatus =>
  ((BOOKING_STATUSES as readonly string[]).includes(String(v)) ? String(v) : 'invited') as BookingStatus;

/**
 * Кастинг WeBrand (17.11.2026, docs/CASTING_SPEC.md): база людей для съёмок,
 * импорт из артефакта, участие в съёмках, публичный каталог и заявки
 * клиентов (лид в «Продажах»). Формы ответов — casting.types.ts, права —
 * casting-access.ts, правила без базы — casting.logic.ts.
 */
@Injectable()
export class CastingService implements OnModuleInit {
  private readonly logger = new Logger(CastingService.name);

  constructor(
    @InjectRepository(CastingTalent) private talentRepo: Repository<CastingTalent>,
    private ds: DataSource,
    private clients: ClientsService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  /** Схема — как миграция 1837: на проде synchronize выключен, и если
   *  миграция отстала, страница не должна падать. Всё идемпотентно. */
  async onModuleInit() {
    for (const sql of CASTING_DDL) {
      await this.ds.query(sql).catch((e: any) => this.logger.warn(`casting DDL failed: ${String(e?.message || e).slice(0, 200)}`));
    }
  }

  // ─── Права ──────────────────────────────────────────────────────────────

  private assertView(user: CastingUser) {
    if (!canViewCasting(user)) throw new ForbiddenException('Нет доступа к кастингу');
  }

  private assertEdit(user: CastingUser) {
    if (!canEditCasting(user)) throw new ForbiddenException('Править кастинг могут основатель, админ, руководитель SMM и продюсер');
  }

  // ─── Список и карточка ──────────────────────────────────────────────────

  /** GET /casting/talents: счётчики вкладок — после поиска и чипов, но до
   *  самой вкладки (категории / «Дети»). */
  async list(user: CastingUser, query: Record<string, unknown>): Promise<TalentListView> {
    this.assertView(user);
    const f = parseListQuery(query);
    const rows: TalentRow[] = await this.ds.query(
      `${TALENT_SELECT} WHERE t."isArchived" = $1 ORDER BY t."sortOrder" ASC, t.name ASC`,
      [f.archived],
    );
    const today = dushanbeToday();
    const base = rows.map(r => toListItem(r, today)).filter(it => matchesSearch(it, f));
    return { items: base.filter(it => matchesTab(it, f)), counts: countTalents(base) };
  }

  async detail(user: CastingUser, id: string): Promise<TalentDetail> {
    this.assertView(user);
    return this.loadDetail(user, id);
  }

  private async loadDetail(user: CastingUser, id: string): Promise<TalentDetail> {
    if (!isUuid(id)) throw new NotFoundException('Человек не найден');
    const rows: any[] = await this.ds.query(`${TALENT_SELECT} WHERE t.id = $1`, [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Человек не найден');
    const today = dushanbeToday();
    const [photos, shoots, requests] = await Promise.all([
      this.ds.query(
        `SELECT id, path FROM casting_photos WHERE "talentId" = $1 ORDER BY "sortOrder" ASC, "createdAt" ASC`, [id],
      ) as Promise<Array<{ id: string; path: string }>>,
      this.talentShoots(id),
      this.talentRequests(id),
    ]);
    return {
      ...toListItem(row, today),
      birthDate: row.birthDate ?? null,
      experience: row.experience ?? null,
      links: Array.isArray(row.links) ? row.links : [],
      phone: row.phone ?? null,
      telegram: row.telegram ?? null,
      rate: row.rate ?? null,
      notes: row.notes ?? null,
      photos: photos.map(p => ({ id: p.id, path: p.path })),
      shoots,
      requests,
      canEdit: canEditCasting(user),
    };
  }

  /** История съёмок человека — новые сверху. */
  private async talentShoots(talentId: string): Promise<TalentShoot[]> {
    const rows: any[] = await this.ds.query(
      `SELECT b.id AS "bookingId", b."contentItemId", b.status, b.note,
              to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS date,
              p.id AS "projectId", p.name AS "projectName",
              COALESCE(parent.topic, ci.topic) AS title
         FROM casting_bookings b
         JOIN content_plan_items ci ON ci.id = b."contentItemId"
         LEFT JOIN content_plan_items parent ON parent.id = ci."shootForItemId"
         LEFT JOIN projects p ON p.id = ci."projectId"
        WHERE b."talentId" = $1
        ORDER BY ci."publishDate" DESC NULLS LAST, b."createdAt" DESC`,
      [talentId],
    ).catch((e: any) => {
      this.logger.warn(`casting shoots failed: ${String(e?.message || e).slice(0, 160)}`);
      return [];
    });
    return rows.map(r => ({
      bookingId: r.bookingId,
      contentItemId: r.contentItemId,
      projectId: r.projectId ?? null,
      date: r.date ?? null,
      projectName: r.projectName ?? null,
      title: r.title ?? null,
      status: statusOf(r.status),
      note: r.note ?? null,
    }));
  }

  /** Заявки клиентов с каталога — новые сверху. */
  private async talentRequests(talentId: string): Promise<TalentRequest[]> {
    const rows: any[] = await this.ds.query(
      `SELECT r."leadId", l.name AS "leadName", r."createdAt"
         FROM casting_requests r
         LEFT JOIN client_leads l ON l.id = r."leadId"
        WHERE r."talentId" = $1
        ORDER BY r."createdAt" DESC
        LIMIT 50`,
      [talentId],
    ).catch((e: any) => {
      this.logger.warn(`casting requests failed: ${String(e?.message || e).slice(0, 160)}`);
      return [];
    });
    return rows.map(r => ({ leadId: r.leadId ?? null, leadName: r.leadName ?? null, createdAt: iso(r.createdAt) }));
  }

  // ─── Правка ─────────────────────────────────────────────────────────────

  async create(user: CastingUser, body: Record<string, any>): Promise<TalentDetail> {
    this.assertEdit(user);
    const { patch, error } = talentPatch(body, { today: dushanbeToday(), creating: true });
    if (error) throw new BadRequestException(error);
    if (patch.sortOrder === undefined) {
      const max: any[] = await this.ds.query(`SELECT COALESCE(MAX("sortOrder"), -1) AS m FROM casting_talents`);
      patch.sortOrder = Number(max?.[0]?.m ?? -1) + 1;
    }
    const saved = await this.talentRepo.save(this.talentRepo.create({ ...patch, createdById: user.id }));
    return this.loadDetail(user, saved.id);
  }

  async update(user: CastingUser, id: string, body: Record<string, any>): Promise<TalentDetail> {
    this.assertEdit(user);
    if (!isUuid(id)) throw new NotFoundException('Человек не найден');
    const current = await this.talentRepo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Человек не найден');
    const { patch, error } = talentPatch(body, {
      today: dushanbeToday(),
      creating: false,
      current: { birthDate: current.birthDate, ageBase: current.ageBase, ageBaseAt: current.ageBaseAt },
    });
    if (error) throw new BadRequestException(error);
    if (Object.keys(patch).length) await this.talentRepo.update(id, patch);
    return this.loadDetail(user, id);
  }

  // ─── Фото ───────────────────────────────────────────────────────────────

  /** Удалить файлы с диска; ошибки — в лог (файла уже нет — не ошибка). */
  private async unlinkQuiet(paths: Array<string | null | undefined>) {
    for (const p of paths) {
      if (!p) continue;
      try {
        await fs.unlink(p);
      } catch (e: any) {
        if (e?.code !== 'ENOENT') this.logger.warn(`casting: не удалён файл ${p}: ${e?.message || e}`);
      }
    }
  }

  async addPhotos(user: CastingUser, talentId: string, files: Express.Multer.File[] = []): Promise<TalentDetail> {
    const list = Array.isArray(files) ? files : [];
    try {
      this.assertEdit(user);
      if (!isUuid(talentId)) throw new NotFoundException('Человек не найден');
      if (!list.length) throw new BadRequestException('Выберите фото');
      const rows: any[] = await this.ds.query(
        `SELECT t.id, (SELECT COUNT(*)::int FROM casting_photos p WHERE p."talentId" = t.id) AS n,
                (SELECT COALESCE(MAX(p."sortOrder"), -1) FROM casting_photos p WHERE p."talentId" = t.id) AS "maxOrder"
           FROM casting_talents t WHERE t.id = $1`,
        [talentId],
      );
      if (!rows[0]) throw new NotFoundException('Человек не найден');
      if (Number(rows[0].n) + list.length > MAX_PHOTOS_PER_TALENT) {
        throw new BadRequestException(`У одного человека — не больше ${MAX_PHOTOS_PER_TALENT} фото`);
      }
      let order = Number(rows[0].maxOrder ?? -1) + 1;
      for (const f of list) {
        await this.ds.query(
          `INSERT INTO casting_photos ("talentId", path, "sortOrder") VALUES ($1, $2, $3)`,
          [talentId, `${CASTING_URL_PREFIX}${f.filename}`, order++],
        );
      }
    } catch (e) {
      // Отказ — файлы, которые multer уже положил на диск, не оставляем.
      await this.unlinkQuiet(list.map(f => f.path));
      throw e;
    }
    await this.touch(talentId);
    return this.loadDetail(user, talentId);
  }

  /** Порядок фото: перечисленные — по списку, остальные — следом, как были. */
  async reorderPhotos(user: CastingUser, talentId: string, ids: string[]): Promise<TalentDetail> {
    this.assertEdit(user);
    if (!isUuid(talentId)) throw new NotFoundException('Человек не найден');
    const photos: Array<{ id: string }> = await this.ds.query(
      `SELECT id FROM casting_photos WHERE "talentId" = $1 ORDER BY "sortOrder" ASC, "createdAt" ASC`, [talentId],
    );
    const exists: any[] = await this.ds.query(`SELECT 1 FROM casting_talents WHERE id = $1`, [talentId]);
    if (!exists.length) throw new NotFoundException('Человек не найден');
    const own = new Set(photos.map(p => String(p.id).toLowerCase()));
    const wanted = (Array.isArray(ids) ? ids : []).map(x => String(x).toLowerCase()).filter((x, i, a) => own.has(x) && a.indexOf(x) === i);
    const rest = photos.map(p => String(p.id).toLowerCase()).filter(x => !wanted.includes(x));
    const order = [...wanted, ...rest];
    for (let i = 0; i < order.length; i++) {
      await this.ds.query(`UPDATE casting_photos SET "sortOrder" = $2 WHERE id = $1`, [order[i], i]);
    }
    await this.touch(talentId);
    return this.loadDetail(user, talentId);
  }

  async deletePhoto(user: CastingUser, photoId: string): Promise<TalentDetail> {
    this.assertEdit(user);
    if (!isUuid(photoId)) throw new NotFoundException('Фото не найдено');
    const rows: Array<{ talentId: string; path: string }> = await this.ds.query(
      `SELECT "talentId", path FROM casting_photos WHERE id = $1`, [photoId],
    );
    const photo = rows[0];
    if (!photo) throw new NotFoundException('Фото не найдено');
    await this.ds.query(`DELETE FROM casting_photos WHERE id = $1`, [photoId]);
    const name = storedNameOf(photo.path);
    if (name) await this.unlinkQuiet([join(CASTING_DIR, name)]);
    await this.touch(photo.talentId);
    return this.loadDetail(user, photo.talentId);
  }

  private async touch(talentId: string) {
    await this.ds.query(`UPDATE casting_talents SET "updatedAt" = now() WHERE id = $1`, [talentId]).catch(() => undefined);
  }

  // ─── Импорт ─────────────────────────────────────────────────────────────

  /**
   * POST /casting/import (§2): data.json + фото. Человек с уже известным
   * sourceKey — «пропущен», но недостающие фото к нему добавляются. Фото
   * сопоставляются по имени файла, порядок — как в data.json. Файлы, не
   * попавшие ни к кому, и сам data.json с диска удаляются.
   */
  async importData(
    user: CastingUser, dataFile: Express.Multer.File | undefined, dataText: unknown, files: Express.Multer.File[] = [],
  ): Promise<ImportResult> {
    const uploads = Array.isArray(files) ? files : [];
    const kept = new Set<string>();
    try {
      if (!canImportCasting(user)) throw new ForbiddenException('Импорт — основатель, админ или руководитель SMM');
      // data.json — своим полем; если выбрали всю папку, он мог прийти среди files.
      const jsonFiles = uploads.filter(f => !isPhotoFile(f) && isJsonFile(f));
      const source = dataFile
        || jsonFiles.find(f => String(f.originalname || '').toLowerCase().endsWith('data.json'))
        || jsonFiles[0];
      const photos = uploads.filter(f => isPhotoFile(f));
      let raw: string | null = null;
      if (source?.path) raw = await fs.readFile(source.path, 'utf8');
      else if (typeof dataText === 'string' && dataText.trim()) raw = dataText;
      if (!raw) throw new BadRequestException('Добавьте файл data.json');
      let json: unknown;
      try {
        json = JSON.parse(raw.replace(/^\uFEFF/, ''));
      } catch {
        throw new BadRequestException('data.json не читается — это не JSON');
      }
      const items = parseImportData(json);
      if (!items.length) throw new BadRequestException('В data.json нет ни одного человека');

      // Файл по имени: первый с таким именем, регистр не важен.
      const byName = new Map<string, Express.Multer.File>();
      for (const f of photos) {
        const key = photoKey(f.originalname);
        if (key && !byName.has(key)) byName.set(key, f);
      }

      const today = dushanbeToday();
      const max: any[] = await this.ds.query(`SELECT COALESCE(MAX("sortOrder"), -1) AS m FROM casting_talents`);
      let nextOrder = Number(max?.[0]?.m ?? -1) + 1;
      const result: ImportResult = { created: 0, skipped: 0, photos: 0, missingPhotos: [] };

      for (const it of items) {
        const inserted: Array<{ id: string }> = await this.ds.query(
          `INSERT INTO casting_talents
             (name, categories, city, height, "ageBase", "ageBaseAt", tags, experience, links, "sortOrder", "sourceKey", "createdById")
           VALUES ($1, $2::text[], $3, $4, $5, $6::date, $7::text[], $8, $9::text[], $10, $11, $12)
           ON CONFLICT ("sourceKey") DO NOTHING
           RETURNING id`,
          [
            it.name, it.categories, it.city, it.height, it.age, it.age === null ? null : today,
            it.tags, it.experience, it.links, nextOrder, it.sourceKey, isUuid(user.id) ? user.id : null,
          ],
        );
        let talentId: string;
        let isNew = false;
        if (inserted?.[0]?.id) {
          talentId = inserted[0].id;
          isNew = true;
          nextOrder += 1;
          result.created += 1;
        } else {
          const found: Array<{ id: string }> = await this.ds.query(
            `SELECT id FROM casting_talents WHERE "sourceKey" = $1`, [it.sourceKey],
          );
          if (!found[0]) continue;
          talentId = found[0].id;
          result.skipped += 1;
        }

        // Какие фото уже есть (по имени из импорта) и с какого номера дописывать.
        const have: Array<{ sourceName: string | null; sortOrder: number }> = isNew ? [] : await this.ds.query(
          `SELECT "sourceName", "sortOrder" FROM casting_photos WHERE "talentId" = $1`, [talentId],
        );
        const haveNames = new Set(have.map(r => String(r.sourceName || '').toLowerCase()).filter(Boolean));
        let order = have.reduce((m, r) => Math.max(m, Number(r.sortOrder) || 0), -1) + 1;

        for (const src of it.photos) {
          const key = src.toLowerCase();
          if (haveNames.has(key)) continue;
          const file = byName.get(key);
          if (!file) {
            result.missingPhotos.push(src);
            continue;
          }
          const path = await this.claimFile(file, kept);
          await this.ds.query(
            `INSERT INTO casting_photos ("talentId", path, "sourceName", "sortOrder") VALUES ($1, $2, $3, $4)`,
            [talentId, path, src.slice(0, 200), order++],
          );
          haveNames.add(key);
          result.photos += 1;
        }
      }
      this.logger.log(`casting import: создано ${result.created}, пропущено ${result.skipped}, фото ${result.photos}, нет фото ${result.missingPhotos.length}`);
      return result;
    } finally {
      await this.unlinkQuiet([dataFile?.path, ...uploads.filter(f => !kept.has(f.path)).map(f => f.path)]);
    }
  }

  /** Загруженный файл → путь для базы. Тот же файл у второго человека —
   *  копия под новым именем: удаление фото у одного не трогает другого. */
  private async claimFile(file: Express.Multer.File, kept: Set<string>): Promise<string> {
    if (!kept.has(file.path)) {
      kept.add(file.path);
      return `${CASTING_URL_PREFIX}${file.filename}`;
    }
    const name = storedPhotoName(file.originalname);
    await fs.copyFile(file.path, join(CASTING_DIR, name));
    return `${CASTING_URL_PREFIX}${name}`;
  }

  // ─── Съёмки ─────────────────────────────────────────────────────────────

  /** Карточка съёмки и её проект: можно ли ставить людей. */
  private async shootAccess(user: CastingUser, contentItemId: string): Promise<{ canEdit: boolean }> {
    if (!isUuid(contentItemId)) throw new NotFoundException('Съёмка не найдена');
    const rows: Array<{ projectId: string | null }> = await this.ds.query(
      `SELECT "projectId" FROM content_plan_items WHERE id = $1`, [contentItemId],
    );
    if (!rows[0]) throw new NotFoundException('Съёмка не найдена');
    if (canEditCasting(user)) return { canEdit: true };
    const project = rows[0].projectId ? await loadAccessRow(this.ds.manager, rows[0].projectId) : null;
    return { canEdit: canBookForShoot(user, project, project?.memberIds || []) };
  }

  private async shootTalents(contentItemId: string, canEdit: boolean): Promise<ShootTalentsView> {
    const rows: any[] = await this.ds.query(
      `SELECT b.id AS "bookingId", b.status, b.note,
              t.id, t.name, t.categories,
              to_char(t."birthDate", 'YYYY-MM-DD') AS "birthDate",
              t."ageBase", to_char(t."ageBaseAt", 'YYYY-MM-DD') AS "ageBaseAt",
              (SELECT p.path FROM casting_photos p WHERE p."talentId" = t.id
                ORDER BY p."sortOrder" ASC, p."createdAt" ASC LIMIT 1) AS photo
         FROM casting_bookings b
         JOIN casting_talents t ON t.id = b."talentId"
        WHERE b."contentItemId" = $1
        ORDER BY b."createdAt" ASC`,
      [contentItemId],
    );
    const today = dushanbeToday();
    return {
      items: rows.map(r => ({
        bookingId: r.bookingId,
        status: statusOf(r.status),
        note: r.note ?? null,
        talent: {
          id: r.id,
          name: r.name,
          photo: r.photo ?? null,
          categories: Array.isArray(r.categories) ? r.categories : [],
          age: ageOf(r, today),
        },
      })),
      canEdit,
    };
  }

  async shootList(user: CastingUser, contentItemId: string): Promise<ShootTalentsView> {
    const { canEdit } = await this.shootAccess(user, contentItemId);
    if (!canEdit && !canViewCasting(user)) throw new ForbiddenException('Нет доступа к кастингу');
    return this.shootTalents(contentItemId, canEdit);
  }

  async addToShoot(user: CastingUser, contentItemId: string, body: { talentId?: string; note?: string | null }): Promise<ShootTalentsView> {
    const { canEdit } = await this.shootAccess(user, contentItemId);
    if (!canEdit) throw new ForbiddenException('Ставить людей в съёмку может продюсер, руководство или SMM-специалист проекта');
    const talentId = body?.talentId;
    if (!isUuid(talentId)) throw new BadRequestException('Выберите человека');
    const t: Array<{ isArchived: boolean }> = await this.ds.query(
      `SELECT "isArchived" FROM casting_talents WHERE id = $1`, [talentId],
    );
    if (!t[0]) throw new NotFoundException('Человек не найден');
    if (t[0].isArchived) throw new BadRequestException('Человек в архиве — сначала верните его из архива');
    await this.ds.query(
      `INSERT INTO casting_bookings ("talentId", "contentItemId", status, note, "createdById")
       VALUES ($1, $2, 'invited', $3, $4)
       ON CONFLICT ("talentId", "contentItemId") DO NOTHING`,
      [talentId, contentItemId, cleanText(body?.note, 500), isUuid(user.id) ? user.id : null],
    );
    return this.shootTalents(contentItemId, true);
  }

  /** Бронь → её съёмка и право её менять. */
  private async bookingAccess(user: CastingUser, bookingId: string): Promise<{ contentItemId: string }> {
    if (!isUuid(bookingId)) throw new NotFoundException('Запись не найдена');
    const rows: Array<{ contentItemId: string }> = await this.ds.query(
      `SELECT "contentItemId" FROM casting_bookings WHERE id = $1`, [bookingId],
    );
    if (!rows[0]) throw new NotFoundException('Запись не найдена');
    const { canEdit } = await this.shootAccess(user, rows[0].contentItemId);
    if (!canEdit) throw new ForbiddenException('Менять людей в съёмке может продюсер, руководство или SMM-специалист проекта');
    return { contentItemId: rows[0].contentItemId };
  }

  async updateBooking(user: CastingUser, bookingId: string, body: { status?: string; note?: string | null }): Promise<ShootTalentsView> {
    const { contentItemId } = await this.bookingAccess(user, bookingId);
    const sets: string[] = [];
    const params: any[] = [bookingId];
    if (body && body.status !== undefined) {
      if (!(BOOKING_STATUSES as readonly string[]).includes(String(body.status))) {
        throw new BadRequestException('Статус: invited, confirmed или declined');
      }
      params.push(String(body.status));
      sets.push(`status = $${params.length}`);
    }
    if (body && body.note !== undefined) {
      params.push(cleanText(body.note, 500));
      sets.push(`note = $${params.length}`);
    }
    if (sets.length) await this.ds.query(`UPDATE casting_bookings SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.shootTalents(contentItemId, true);
  }

  async removeBooking(user: CastingUser, bookingId: string): Promise<ShootTalentsView> {
    const { contentItemId } = await this.bookingAccess(user, bookingId);
    await this.ds.query(`DELETE FROM casting_bookings WHERE id = $1`, [bookingId]);
    return this.shootTalents(contentItemId, true);
  }

  // ─── Публичный каталог ──────────────────────────────────────────────────

  async publicCatalog(): Promise<{ items: PublicTalent[] }> {
    const rows: TalentRow[] = await this.ds.query(
      `${TALENT_SELECT} WHERE t."isPublic" = true AND t."isArchived" = false ORDER BY t."sortOrder" ASC, t.name ASC`,
    );
    const today = dushanbeToday();
    return { items: rows.map(r => toPublicTalent(r, today)) };
  }

  /**
   * «Забронировать» (§4): лид в «Продажах» (новый, источник casting,
   * направление SMM, без владельца), строки casting_requests и уведомление
   * основателю и МП по SMM. Дубли лидов не проверяем: клиенту с сайта 409
   * не покажешь, похожие лиды менеджер сольёт сам.
   */
  async publicBook(body: Record<string, any>): Promise<{ ok: true }> {
    const check = cleanBooking(body);
    if (check.spam) return { ok: true };
    if (check.error || !check.value) throw new BadRequestException(check.error || 'Проверьте заявку');
    const v = check.value;

    const rows: Array<{ id: string; name: string }> = await this.ds.query(
      `SELECT id, name FROM casting_talents
        WHERE id = ANY($1::uuid[]) AND "isPublic" = true AND "isArchived" = false`,
      [v.talentIds],
    );
    const byId = new Map(rows.map(r => [String(r.id).toLowerCase(), r] as const));
    const talents = v.talentIds.map(id => byId.get(id)).filter((r): r is { id: string; name: string } => !!r);
    if (!talents.length) throw new BadRequestException('Выбранных людей уже нет в каталоге — обновите страницу');

    const lead = await this.clients.create(
      {
        name: v.name,
        contactPhone: v.phone,
        status: ClientLeadStatus.NEW,
        leadSource: 'casting',
        direction: ClientLeadDirection.SMM,
        problem: bookingProblem(talents, v.comment, this.telegram.appUrl),
      },
      null,
      undefined,
      { via: 'site', force: true },
    );
    const leadId: string | null = lead?.id ?? null;
    for (const t of talents) {
      await this.ds.query(
        `INSERT INTO casting_requests ("talentId", "leadId") VALUES ($1, $2)`, [t.id, leadId],
      ).catch((e: any) => this.logger.warn(`casting request not saved: ${String(e?.message || e).slice(0, 160)}`));
    }
    // Уведомления — не задерживаем ответ клиенту.
    this.notifyRequest(leadId, v.name, v.phone, v.comment, talents)
      .catch((e: any) => this.logger.warn(`casting notify failed: ${String(e?.message || e).slice(0, 160)}`));
    return { ok: true };
  }

  /** Колокольчик и Telegram: действующие основатели и МП по SMM (основная или вторая роль). */
  private async notifyRequest(
    leadId: string | null, client: string, phone: string, comment: string | null, talents: Array<{ id: string; name: string }>,
  ) {
    const users: Array<{ id: string }> = await this.ds.query(
      `SELECT id FROM users
        WHERE "isActive" = true
          AND (role::text IN ('founder', 'sales_manager_smm') OR "secondaryRole"::text IN ('founder', 'sales_manager_smm'))`,
    ).catch(() => []);
    if (!users.length) return;
    const names = talents.map(t => t.name).join(', ');
    const title = 'Заявка с кастинга';
    const message = `${client} (${phone}) — ${names}`;
    const link = leadId ? `/clients?id=${leadId}` : '/clients';
    const url = `${this.telegram.appUrl}${link}`;
    const text = [
      `🎭 <b>${escapeHtml(title)}</b>`,
      `Клиент: ${escapeHtml(client)}, ${escapeHtml(phone)}`,
      `Кого хочет: ${escapeHtml(names)}`,
      comment ? `Комментарий: ${escapeHtml(comment)}` : null,
      '',
      `👉 <a href="${escapeHtml(url)}">Открыть лид</a>`,
    ].filter(x => x !== null).join('\n');
    for (const u of users) {
      try {
        await this.notifications.create({ userId: u.id, type: NotificationType.STATUS_CHANGE, title, message, link });
      } catch (e: any) {
        this.logger.warn(`casting bell failed for ${u.id}: ${String(e?.message || e).slice(0, 160)}`);
      }
      await this.telegram.sendToUser(u.id, text).catch(() => undefined);
    }
  }
}
