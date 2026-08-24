import {
  Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import {
  TeamStory, TeamStoryMedia, TeamStoryView, TeamStoryReaction, TeamStoryComment, TeamStoryKind,
} from './team-story.entity';
import { User } from '../users/user.entity';
import { AppGateway } from '../gateway/app.gateway';

/** Набор реакций фиксирован: произвольный emoji означал бы произвольную
 *  строку в интерфейсе и в базе, а пользы от этого никакой. */
export const STORY_EMOJI = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/** Сколько сторис живёт. Как в инстаграме — сутки. */
const TTL_HOURS = 24;
/** Потолок на файл. Фото фронт сжимает сам, видео — снимаем как есть. */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_SEC = 20;

export interface StoryAuthorGroup {
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  stories: any[];
  hasUnseen: boolean;
  lastAt: string;
}

@Injectable()
export class TeamStoriesService implements OnModuleInit {
  private readonly logger = new Logger(TeamStoriesService.name);

  constructor(
    @InjectRepository(TeamStory) private stories: Repository<TeamStory>,
    @InjectRepository(TeamStoryMedia) private media: Repository<TeamStoryMedia>,
    @InjectRepository(TeamStoryView) private views: Repository<TeamStoryView>,
    @InjectRepository(TeamStoryReaction) private reactions: Repository<TeamStoryReaction>,
    @InjectRepository(TeamStoryComment) private comments: Repository<TeamStoryComment>,
    @InjectRepository(User) private users: Repository<User>,
    private gateway: AppGateway,
  ) {}

  /** В проде synchronize выключен — таблицы заводим сами, идемпотентно. */
  async onModuleInit(): Promise<void> {
    const q = (sql: string) => this.stories.manager.query(sql).catch((e: any) =>
      this.logger.warn(`team-stories DDL: ${String(e?.message || e).slice(0, 200)}`));
    await q(`CREATE TABLE IF NOT EXISTS team_stories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "authorId" uuid NOT NULL,
      kind varchar NOT NULL DEFAULT 'photo',
      caption varchar(500) NOT NULL DEFAULT '',
      "mediaKey" varchar NOT NULL,
      "mediaMime" varchar NOT NULL,
      "mediaSize" int NOT NULL DEFAULT 0,
      "durationSec" int NOT NULL DEFAULT 0,
      "expiresAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_team_stories_media_key ON team_stories("mediaKey")`);
    await q(`CREATE INDEX IF NOT EXISTS idx_team_stories_expires ON team_stories("expiresAt")`);
    await q(`CREATE TABLE IF NOT EXISTS team_story_media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "storyId" uuid NOT NULL,
      data bytea NOT NULL
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_team_story_media_story ON team_story_media("storyId")`);
    await q(`CREATE TABLE IF NOT EXISTS team_story_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "storyId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_team_story_views_pair ON team_story_views("storyId","userId")`);
    await q(`CREATE TABLE IF NOT EXISTS team_story_reactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "storyId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      emoji varchar(8) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_team_story_reactions_pair ON team_story_reactions("storyId","userId")`);
    await q(`CREATE TABLE IF NOT EXISTS team_story_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "storyId" uuid NOT NULL,
      "authorId" uuid NOT NULL,
      text varchar(1000) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_team_story_comments_story ON team_story_comments("storyId")`);
  }

  // ─── Лента ──────────────────────────────────────────────────────────
  /** Живые сторис, сгруппированные по авторам: так их показывает лента —
   *  кружок на человека, внутри его сторис по времени. */
  async feed(viewerId: string): Promise<StoryAuthorGroup[]> {
    const rows = await this.stories
      .createQueryBuilder('s')
      .leftJoin(User, 'u', 'u.id = s."authorId"')
      .addSelect(['u.id', 'u.name', 'u.avatar'])
      .where('s."expiresAt" > now()')
      .orderBy('s."createdAt"', 'ASC')
      .getRawMany();
    if (rows.length === 0) return [];

    const ids = rows.map(r => r.s_id);
    const [views, reactions, commentCounts, myViews, myReactions] = await Promise.all([
      this.countBy(this.views, 'storyId', ids),
      this.reactions.find({ where: { storyId: In(ids) } }),
      this.countBy(this.comments, 'storyId', ids),
      this.views.find({ where: { storyId: In(ids), userId: viewerId } }),
      this.reactions.find({ where: { storyId: In(ids), userId: viewerId } }),
    ]);
    const seen = new Set(myViews.map(v => v.storyId));
    const mine = new Map(myReactions.map(r => [r.storyId, r.emoji]));

    // Реакции сворачиваем в счётчики по эмодзи — в ленте нужен только итог.
    const byEmoji = new Map<string, Record<string, number>>();
    for (const r of reactions) {
      const m = byEmoji.get(r.storyId) || {};
      m[r.emoji] = (m[r.emoji] || 0) + 1;
      byEmoji.set(r.storyId, m);
    }

    const groups = new Map<string, StoryAuthorGroup>();
    for (const r of rows) {
      const authorId = r.s_authorId;
      if (!groups.has(authorId)) {
        groups.set(authorId, {
          authorId,
          authorName: r.u_name || 'Сотрудник',
          authorAvatar: r.u_avatar || null,
          stories: [],
          hasUnseen: false,
          lastAt: r.s_createdAt,
        });
      }
      const g = groups.get(authorId)!;
      const id = r.s_id;
      g.stories.push({
        id,
        kind: r.s_kind,
        caption: r.s_caption,
        mediaKey: r.s_mediaKey,
        mediaMime: r.s_mediaMime,
        durationSec: r.s_durationSec,
        createdAt: r.s_createdAt,
        expiresAt: r.s_expiresAt,
        viewsCount: views.get(id) || 0,
        commentsCount: commentCounts.get(id) || 0,
        reactions: byEmoji.get(id) || {},
        myReaction: mine.get(id) || null,
        seen: seen.has(id),
      });
      if (!seen.has(id)) g.hasUnseen = true;
      if (r.s_createdAt > g.lastAt) g.lastAt = r.s_createdAt;
    }

    // Свои сторис — первыми, дальше непросмотренные, дальше по свежести:
    // так лента читается сверху вниз без лишних раздумий.
    return [...groups.values()].sort((a, b) => {
      if (a.authorId === viewerId) return -1;
      if (b.authorId === viewerId) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return String(b.lastAt).localeCompare(String(a.lastAt));
    });
  }

  private async countBy(repo: Repository<any>, field: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, number>();
    const rows = await repo
      .createQueryBuilder('t')
      .select(`t."${field}"`, 'k')
      .addSelect('COUNT(*)::int', 'n')
      .where(`t."${field}" IN (:...ids)`, { ids })
      .groupBy(`t."${field}"`)
      .getRawMany();
    return new Map<string, number>(rows.map(r => [r.k, Number(r.n)]));
  }

  // ─── Публикация ─────────────────────────────────────────────────────
  async create(
    file: Express.Multer.File,
    caption: string,
    durationSec: number,
    user: { id: string; name?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не загружен');
    const mime = file.mimetype || '';
    const isPhoto = PHOTO_MIME.has(mime);
    const isVideo = VIDEO_MIME.has(mime);
    if (!isPhoto && !isVideo) {
      throw new BadRequestException('Можно выложить фото (JPG, PNG, WEBP) или видео (MP4, WEBM, MOV)');
    }
    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (file.buffer.length > limit) {
      throw new BadRequestException(
        `Файл ${Math.round(file.buffer.length / 1024 / 1024)} МБ — это больше ${Math.round(limit / 1024 / 1024)} МБ. Выберите файл полегче.`,
      );
    }
    const dur = Math.max(0, Math.round(Number(durationSec) || 0));
    if (isVideo && dur > MAX_VIDEO_SEC) {
      throw new BadRequestException(`Видео длиннее ${MAX_VIDEO_SEC} секунд — обрежьте ролик.`);
    }

    const story = await this.stories.save(this.stories.create({
      authorId: user.id,
      kind: isVideo ? TeamStoryKind.VIDEO : TeamStoryKind.PHOTO,
      caption: String(caption || '').trim().slice(0, 500),
      mediaKey: uuidv4(),
      mediaMime: mime,
      mediaSize: file.buffer.length,
      durationSec: isVideo ? dur : 0,
      expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000),
    }));
    await this.media.save(this.media.create({ storyId: story.id, data: file.buffer }));

    const author = await this.users.findOne({ where: { id: user.id } });
    const payload = {
      id: story.id,
      authorId: story.authorId,
      authorName: author?.name || user.name || 'Сотрудник',
      authorAvatar: (author as any)?.avatar || null,
      kind: story.kind,
      caption: story.caption,
      mediaKey: story.mediaKey,
      mediaMime: story.mediaMime,
      durationSec: story.durationSec,
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
      viewsCount: 0,
      commentsCount: 0,
      reactions: {},
      myReaction: null,
      seen: false,
    };
    // Лента общая для всей компании — рассылаем всем подключённым.
    this.gateway.broadcast('team-story:new', payload);
    return payload;
  }

  /** Байты медиа по ключу из ссылки. */
  async getMedia(mediaKey: string): Promise<{ mime: string; data: Buffer } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(mediaKey)) return null;
    const story = await this.stories.findOne({ where: { mediaKey } }).catch(() => null);
    if (!story) return null;
    const m = await this.media.findOne({ where: { storyId: story.id } }).catch(() => null);
    if (!m?.data) return null;
    return { mime: story.mediaMime, data: Buffer.from(m.data) };
  }

  private async mustGet(storyId: string): Promise<TeamStory> {
    const s = await this.stories.findOne({ where: { id: storyId } });
    if (!s) throw new NotFoundException('Сторис не найдена или уже исчезла');
    return s;
  }

  // ─── Просмотры, реакции, комментарии ────────────────────────────────
  async markViewed(storyId: string, user: { id: string }) {
    const story = await this.mustGet(storyId);
    // Автору свои сторис в счётчик не пишем — в инстаграме так же.
    if (story.authorId === user.id) return { ok: true, viewsCount: await this.viewsCount(storyId) };
    // ON CONFLICT: два быстрых открытия подряд не должны падать ошибкой.
    await this.views.manager.query(
      `INSERT INTO team_story_views ("storyId", "userId") VALUES ($1, $2)
       ON CONFLICT ("storyId", "userId") DO NOTHING`,
      [storyId, user.id],
    );
    const viewsCount = await this.viewsCount(storyId);
    this.gateway.broadcast('team-story:view', { storyId, viewsCount });
    return { ok: true, viewsCount };
  }

  private async viewsCount(storyId: string): Promise<number> {
    return this.views.count({ where: { storyId } });
  }

  /** Ставит, меняет или снимает реакцию — по одному действию от человека. */
  async react(storyId: string, emoji: string, user: { id: string }) {
    await this.mustGet(storyId);
    if (emoji && !STORY_EMOJI.includes(emoji)) throw new BadRequestException('Неизвестная реакция');
    const existing = await this.reactions.findOne({ where: { storyId, userId: user.id } });
    let myReaction: string | null = emoji || null;
    if (existing && (existing.emoji === emoji || !emoji)) {
      await this.reactions.delete({ id: existing.id });
      myReaction = null;
    } else if (existing) {
      await this.reactions.update({ id: existing.id }, { emoji });
    } else if (emoji) {
      await this.reactions.save(this.reactions.create({ storyId, userId: user.id, emoji }));
    }
    const reactions = await this.reactionMap(storyId);
    this.gateway.broadcast('team-story:reaction', { storyId, reactions, byUserId: user.id, myReaction });
    return { reactions, myReaction };
  }

  private async reactionMap(storyId: string): Promise<Record<string, number>> {
    const rows = await this.reactions
      .createQueryBuilder('r')
      .select('r.emoji', 'emoji')
      .addSelect('COUNT(*)::int', 'n')
      .where('r."storyId" = :storyId', { storyId })
      .groupBy('r.emoji')
      .getRawMany();
    return Object.fromEntries(rows.map(r => [r.emoji, Number(r.n)]));
  }

  async listComments(storyId: string) {
    await this.mustGet(storyId);
    const rows = await this.comments
      .createQueryBuilder('c')
      .leftJoin(User, 'u', 'u.id = c."authorId"')
      .addSelect(['u.name', 'u.avatar'])
      .where('c."storyId" = :storyId', { storyId })
      .orderBy('c."createdAt"', 'ASC')
      .getRawMany();
    return rows.map(r => ({
      id: r.c_id,
      storyId: r.c_storyId,
      authorId: r.c_authorId,
      authorName: r.u_name || 'Сотрудник',
      authorAvatar: r.u_avatar || null,
      text: r.c_text,
      createdAt: r.c_createdAt,
    }));
  }

  async addComment(storyId: string, text: string, user: { id: string; name?: string }) {
    await this.mustGet(storyId);
    const clean = String(text || '').trim().slice(0, 1000);
    if (!clean) throw new BadRequestException('Пустой комментарий');
    const saved = await this.comments.save(this.comments.create({
      storyId, authorId: user.id, text: clean,
    }));
    const author = await this.users.findOne({ where: { id: user.id } });
    const payload = {
      id: saved.id,
      storyId,
      authorId: user.id,
      authorName: author?.name || user.name || 'Сотрудник',
      authorAvatar: (author as any)?.avatar || null,
      text: saved.text,
      createdAt: saved.createdAt,
      commentsCount: await this.comments.count({ where: { storyId } }),
    };
    this.gateway.broadcast('team-story:comment', payload);
    return payload;
  }

  /** Удалить комментарий может его автор и автор сторис. */
  async removeComment(commentId: string, user: { id: string }) {
    const c = await this.comments.findOne({ where: { id: commentId } });
    if (!c) throw new NotFoundException('Комментарий не найден');
    const story = await this.mustGet(c.storyId);
    if (c.authorId !== user.id && story.authorId !== user.id) {
      throw new ForbiddenException('Удалить комментарий может его автор или автор сторис');
    }
    await this.comments.delete({ id: commentId });
    const commentsCount = await this.comments.count({ where: { storyId: c.storyId } });
    this.gateway.broadcast('team-story:comment-removed', {
      storyId: c.storyId, commentId, commentsCount,
    });
    return { ok: true, commentsCount };
  }

  /** Свою сторис удаляет автор; основатель и админ — любую. */
  async remove(storyId: string, user: { id: string; role?: string }) {
    const story = await this.mustGet(storyId);
    const isTop = ['founder', 'co_founder', 'admin'].includes(user.role || '');
    if (story.authorId !== user.id && !isTop) {
      throw new ForbiddenException('Удалить можно только свою сторис');
    }
    await this.wipe([storyId]);
    this.gateway.broadcast('team-story:removed', { storyId, authorId: story.authorId });
    return { ok: true };
  }

  /** Кто посмотрел — видит только автор: это его сторис. */
  async viewers(storyId: string, user: { id: string; role?: string }) {
    const story = await this.mustGet(storyId);
    if (story.authorId !== user.id) throw new ForbiddenException('Список зрителей видит только автор');
    const rows = await this.views
      .createQueryBuilder('v')
      .leftJoin(User, 'u', 'u.id = v."userId"')
      .addSelect(['u.name', 'u.avatar'])
      .where('v."storyId" = :storyId', { storyId })
      .orderBy('v."createdAt"', 'DESC')
      .getRawMany();
    return rows.map(r => ({
      userId: r.v_userId,
      name: r.u_name || 'Сотрудник',
      avatar: r.u_avatar || null,
      at: r.v_createdAt,
    }));
  }

  // ─── Уборка ─────────────────────────────────────────────────────────
  private async wipe(ids: string[]) {
    if (ids.length === 0) return;
    await this.media.delete({ storyId: In(ids) }).catch(() => {});
    await this.views.delete({ storyId: In(ids) }).catch(() => {});
    await this.reactions.delete({ storyId: In(ids) }).catch(() => {});
    await this.comments.delete({ storyId: In(ids) }).catch(() => {});
    await this.stories.delete({ id: In(ids) });
  }

  /** Просроченное убираем вместе с медиа: иначе байты остались бы в базе
   *  навсегда, хотя из ленты сторис давно пропала. */
  @Cron('7 * * * *')
  async cleanupExpired() {
    try {
      const expired = await this.stories.find({
        where: { expiresAt: LessThan(new Date()) },
        select: ['id'],
        take: 500,
      });
      if (expired.length === 0) return;
      await this.wipe(expired.map(s => s.id));
      this.logger.log(`Лента команды: убрано просроченных сторис — ${expired.length}`);
      this.gateway.broadcast('team-story:expired', { ids: expired.map(s => s.id) });
    } catch (e: any) {
      this.logger.warn(`Уборка сторис не удалась: ${e?.message || e}`);
    }
  }
}
