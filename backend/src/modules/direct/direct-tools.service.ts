import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { DirectConversation, DirectLabel, DirectReminder, DirectTemplate } from './direct.entity';
import { DirectService, contactLabel } from './direct.service';
import { isTop } from './direct-access';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { AppGateway } from '../gateway/app.gateway';

/** Напоминание ставим не дальше, чем на год вперёд. */
const MAX_REMINDER_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
/** Минута назад — ещё «сейчас»: часы браузера могут спешить. */
const REMINDER_PAST_SLACK_MS = 60 * 1000;

const isUniqueViolation = (error: any) => error?.code === '23505' || error?.driverError?.code === '23505';

/**
 * Инструменты «Директа» (13.11.2026): метки чатов, шаблоны быстрых ответов,
 * напоминания «вернуться к клиенту».
 *  - Справочник меток ведёт руководство; ставит метки на чат DirectService.setLabels.
 *  - Шаблоны: общие (ownerId NULL) — руководство, личные — сам сотрудник.
 *  - Напоминание личное: одно активное на чат у сотрудника, новое заменяет старое.
 */
@Injectable()
export class DirectToolsService {
  private readonly logger = new Logger(DirectToolsService.name);

  constructor(
    @InjectRepository(DirectLabel) private readonly labelsRepo: Repository<DirectLabel>,
    @InjectRepository(DirectTemplate) private readonly templatesRepo: Repository<DirectTemplate>,
    @InjectRepository(DirectReminder) private readonly remindersRepo: Repository<DirectReminder>,
    @InjectRepository(DirectConversation) private readonly conversations: Repository<DirectConversation>,
    private readonly direct: DirectService,
    private readonly notifications: NotificationsService,
    private readonly gateway: AppGateway,
  ) {}

  // ─── Метки ──────────────────────────────────────────────────────────

  async labels() {
    const rows = await this.labelsRepo.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.map(l => ({ id: l.id, name: l.name, color: l.color, sortOrder: l.sortOrder }));
  }

  private onlyTop(user: User, what: string): void {
    if (!isTop(user)) throw new ForbiddenException(`${what} — только руководство`);
  }

  async createLabel(user: User, dto: { name: string; color?: string }) {
    this.onlyTop(user, 'Метки создаёт');
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Название метки пустое');
    await this.ensureFreeName(name);
    const [{ next }] = await this.labelsRepo.query(`SELECT COALESCE(max("sortOrder"), 0) + 1 AS next FROM direct_labels`);
    try {
      await this.labelsRepo.save(this.labelsRepo.create({ name, color: dto.color || 'sky', sortOrder: Number(next) || 0 }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Такая метка уже есть');
      throw error;
    }
    this.direct.broadcastChanged();
    return this.labels();
  }

  async updateLabel(user: User, id: string, dto: { name?: string; color?: string; sortOrder?: number }) {
    this.onlyTop(user, 'Метки меняет');
    const label = await this.labelsRepo.findOne({ where: { id } });
    if (!label) throw new NotFoundException('Метка не найдена');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Название метки пустое');
      if (name.toLowerCase() !== label.name.toLowerCase()) await this.ensureFreeName(name);
      label.name = name;
    }
    if (dto.color !== undefined) label.color = dto.color;
    if (dto.sortOrder !== undefined) label.sortOrder = dto.sortOrder;
    try {
      await this.labelsRepo.save(label);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Такая метка уже есть');
      throw error;
    }
    this.direct.broadcastChanged();
    return this.labels();
  }

  async deleteLabel(user: User, id: string) {
    this.onlyTop(user, 'Метки удаляет');
    const res = await this.labelsRepo.delete(id);
    if (!res.affected) throw new NotFoundException('Метка не найдена');
    this.direct.broadcastChanged();
    return this.labels();
  }

  private async ensureFreeName(name: string): Promise<void> {
    const [taken] = await this.labelsRepo.query(`SELECT 1 FROM direct_labels WHERE lower(name) = lower($1) LIMIT 1`, [name]);
    if (taken) throw new ConflictException('Такая метка уже есть');
  }

  // ─── Шаблоны быстрых ответов ────────────────────────────────────────

  /** Общие и мои личные: сначала общие, внутри — по названию. */
  async templates(user: User) {
    const rows = await this.templatesRepo.find({
      where: [{ ownerId: IsNull() }, { ownerId: user.id }],
      order: { title: 'ASC' },
    });
    return rows
      .map(t => ({ id: t.id, title: t.title, text: t.text, shared: !t.ownerId, canEdit: this.canEditTemplate(user, t) }))
      .sort((a, b) => Number(b.shared) - Number(a.shared) || a.title.localeCompare(b.title, 'ru'));
  }

  private canEditTemplate(user: User, t: DirectTemplate): boolean {
    return t.ownerId ? t.ownerId === user.id : isTop(user);
  }

  async createTemplate(user: User, dto: { title: string; text: string; shared?: boolean }) {
    const shared = !!dto.shared;
    if (shared && !isTop(user)) throw new ForbiddenException('Общие шаблоны добавляет руководство — сохраните шаблон как личный');
    const title = dto.title.trim();
    const text = dto.text.trim();
    if (!title || !text) throw new BadRequestException('Заполните название и текст шаблона');
    const saved = await this.templatesRepo.save(this.templatesRepo.create({
      title, text, ownerId: shared ? null : user.id, createdById: user.id,
    }));
    return { id: saved.id };
  }

  async updateTemplate(user: User, id: string, dto: { title?: string; text?: string }) {
    const t = await this.templatesRepo.findOne({ where: { id } });
    // Чужой личный шаблон — как будто его нет.
    if (!t || (t.ownerId && t.ownerId !== user.id)) throw new NotFoundException('Шаблон не найден');
    if (!this.canEditTemplate(user, t)) throw new ForbiddenException('Общие шаблоны меняет руководство');
    if (dto.title !== undefined) {
      if (!dto.title.trim()) throw new BadRequestException('Название шаблона пустое');
      t.title = dto.title.trim();
    }
    if (dto.text !== undefined) {
      if (!dto.text.trim()) throw new BadRequestException('Текст шаблона пустой');
      t.text = dto.text.trim();
    }
    await this.templatesRepo.save(t);
    return { id: t.id };
  }

  async deleteTemplate(user: User, id: string): Promise<void> {
    const t = await this.templatesRepo.findOne({ where: { id } });
    if (!t || (t.ownerId && t.ownerId !== user.id)) throw new NotFoundException('Шаблон не найден');
    if (!this.canEditTemplate(user, t)) throw new ForbiddenException('Общие шаблоны удаляет руководство');
    await this.templatesRepo.delete(t.id);
  }

  // ─── Напоминания ────────────────────────────────────────────────────

  /** Мои активные напоминания — для списка чатов (⏰ и подъём наверх). */
  async myReminders(user: User) {
    const rows = await this.remindersRepo.find({ where: { userId: user.id, doneAt: IsNull() }, order: { remindAt: 'ASC' } });
    return rows.map(r => ({ id: r.id, conversationId: r.conversationId, remindAt: r.remindAt, note: r.note, fired: !!r.firedAt }));
  }

  /** Поставить напоминание. Моё прежнее в этом чате заменяется новым. */
  async setReminder(user: User, conversationId: string, dto: { remindAt: string; note?: string }) {
    const conversation = await this.conversations.findOne({ where: { id: conversationId }, select: ['id'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    const at = new Date(dto.remindAt);
    if (Number.isNaN(at.getTime())) throw new BadRequestException('Неверное время напоминания');
    if (at.getTime() < Date.now() - REMINDER_PAST_SLACK_MS) throw new BadRequestException('Это время уже прошло — выберите время впереди');
    if (at.getTime() > Date.now() + MAX_REMINDER_AHEAD_MS) throw new BadRequestException('Напоминание можно поставить не дальше, чем на год');
    const note = dto.note?.trim() ? dto.note.trim().slice(0, 300) : null;
    await this.remindersRepo.manager.transaction(async (em) => {
      await em.query(
        `UPDATE direct_reminders SET "doneAt" = now() WHERE "conversationId" = $1 AND "userId" = $2 AND "doneAt" IS NULL`,
        [conversationId, user.id],
      );
      const repo = em.getRepository(DirectReminder);
      await repo.save(repo.create({ conversationId, userId: user.id, remindAt: at, note }));
    });
    this.changedFor(user.id, conversationId);
    return this.myReminders(user);
  }

  /** Снять своё напоминание («Готово» или «Убрать»). */
  async removeReminder(user: User, id: string) {
    const reminder = await this.remindersRepo.findOne({ where: { id } });
    if (!reminder || reminder.userId !== user.id) throw new NotFoundException('Напоминание не найдено');
    if (!reminder.doneAt) await this.remindersRepo.update(id, { doneAt: new Date() });
    this.changedFor(user.id, reminder.conversationId);
    return this.myReminders(user);
  }

  /** Раз в минуту: подошёл срок — уведомление и пуш, чат поднимается наверх. */
  @Cron('* * * * *')
  async fireDue(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    // Забираем срабатывание атомарно: две копии сервера не пошлют дважды.
    const res = await this.remindersRepo.query(
      `UPDATE direct_reminders SET "firedAt" = now()
        WHERE id IN (
          SELECT id FROM direct_reminders
           WHERE "doneAt" IS NULL AND "firedAt" IS NULL AND "remindAt" <= now()
           ORDER BY "remindAt" LIMIT 100
           FOR UPDATE SKIP LOCKED)
        RETURNING id, "conversationId", "userId", note`,
    ).catch((e: any) => {
      this.logger.warn(`Напоминания «Директа» не проверены: ${e?.message || e}`);
      return null;
    });
    const rows: { id: string; conversationId: string; userId: string; note: string | null }[] = Array.isArray(res?.[0]) ? res[0] : [];
    if (!rows.length) return;
    const chats = await this.conversations.find({ where: rows.map(r => ({ id: r.conversationId })), select: ['id', 'contactName', 'contactUsername'] });
    const byId = new Map(chats.map(c => [c.id, c]));
    for (const r of rows) {
      const chat = byId.get(r.conversationId);
      if (!chat) continue;
      await this.notifications.create({
        userId: r.userId,
        type: NotificationType.DIRECT_REMINDER,
        title: `Напоминание: ${contactLabel(chat)}`,
        message: r.note || 'Вернуться к клиенту в Директе',
        link: `/direct?c=${r.conversationId}`,
        data: { conversationId: r.conversationId, reminderId: r.id },
      }).catch(e => this.logger.warn(`Уведомление о напоминании не создано: ${e?.message || e}`));
      this.changedFor(r.userId, r.conversationId);
    }
  }

  /** Страницам этого сотрудника: напоминания поменялись — список пересобрать. */
  private changedFor(userId: string, conversationId: string): void {
    this.gateway.notifyUser(userId, 'direct:reminders', { conversationId });
  }
}
