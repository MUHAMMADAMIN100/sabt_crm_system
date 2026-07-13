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
      phone varchar(60), instagram varchar(120), look text, rate numeric(15,2),
      note text, "createdAt" timestamptz NOT NULL DEFAULT now())`);
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
    models: ['name', 'phone', 'instagram', 'look', 'rate', 'note'],
    places: ['name', 'address', 'contact', 'price', 'link', 'note'],
  };

  private sanitize(kind: string, dto: any): Record<string, any> {
    const out: Record<string, any> = {};
    for (const f of OrganizerDirectoryService.FIELDS[kind]) {
      if (dto[f] === undefined) continue;
      if (f === 'rate' || f === 'price') {
        const n = Number(dto[f]);
        out[f] = dto[f] === null || dto[f] === '' ? null : (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
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
    return rows.map((r: any) => ({
      ...r,
      ...(r.rate !== undefined ? { rate: r.rate === null ? null : Number(r.rate) } : {}),
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
