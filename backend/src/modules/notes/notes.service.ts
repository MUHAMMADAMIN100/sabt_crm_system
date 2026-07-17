import {
  Injectable, NotFoundException, BadRequestException, OnModuleInit, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonalNote } from './personal-note.entity';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Личные заметки: CRUD строго в пределах владельца. userId всегда берётся
 *  из JWT (req.user.id) — из тела запроса он не принимается никогда. */
@Injectable()
export class NotesService implements OnModuleInit {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(PersonalNote) private repo: Repository<PersonalNote>,
  ) {}

  // На проде synchronize отключён — таблицу создаём идемпотентным DDL.
  async onModuleInit() {
    try {
      await this.repo.manager.query(`CREATE TABLE IF NOT EXISTS personal_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        text text NOT NULL,
        date date,
        done boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now())`);
      await this.repo.manager.query(
        `CREATE INDEX IF NOT EXISTS idx_personal_notes_user_date ON personal_notes ("userId", date)`,
      );
    } catch (e: any) {
      this.logger.warn(`personal_notes DDL skipped: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Нормализация даты: 'YYYY-MM-DD' | null. Мусор и календарно-невалидные
   *  даты ('2026-02-31') — ошибка 400, иначе Postgres упал бы с 500. */
  private parseDate(raw: any): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const s = String(raw).slice(0, 10);
    if (!DATE_RE.test(s)) throw new BadRequestException('Дата — в формате YYYY-MM-DD');
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      throw new BadRequestException('Такой даты не существует');
    }
    return s;
  }

  list(userId: string) {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async create(userId: string, dto: { text?: string; date?: string | null }) {
    const text = String(dto?.text || '').trim().slice(0, 2000);
    if (!text) throw new BadRequestException('Текст заметки обязателен');
    return this.repo.save(this.repo.create({
      userId,
      text,
      date: this.parseDate(dto?.date),
    }));
  }

  async update(id: string, userId: string, dto: { text?: string; date?: string | null; done?: boolean }) {
    // Поиск СРАЗУ по (id, userId): чужая заметка неотличима от несуществующей.
    const note = await this.repo.findOne({ where: { id, userId } });
    if (!note) throw new NotFoundException('Заметка не найдена');
    if (dto?.text !== undefined) {
      const text = String(dto.text || '').trim().slice(0, 2000);
      if (!text) throw new BadRequestException('Текст заметки обязателен');
      note.text = text;
    }
    if (dto?.date !== undefined) note.date = this.parseDate(dto.date);
    if (dto?.done !== undefined) note.done = !!dto.done;
    return this.repo.save(note);
  }

  async remove(id: string, userId: string) {
    const res = await this.repo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Заметка не найдена');
    return { ok: true };
  }
}
