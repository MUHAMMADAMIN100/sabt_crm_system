import { BadRequestException, GoneException, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { SHOOT_CHANGED, ShootChangedEvent } from '../content-plan/content-plan.service';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import {
  NeedShoot, ProducerShoot, ShootSnapshot, addDays, changeHead, changeMessage, dailyMessage, groupShoots, handedOverMessage,
  isAnnounced, mapLink, missingTimeMessage, nextWeek, phoneOf, producerNoonMessage, readScriptToken, ruLongDay, ruRange,
  scriptToken, takenAwayMessage, todaySummary, weeklyMessage,
} from './producer.logic';
import { STUDIO_LABEL, shootPlaceKind } from '../../common/shoot-place';

const TZ = 'Asia/Dushanbe';
const dushanbeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dushanbeHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
/** Правки съёмки копим минуту и шлём одним сообщением: время часто
 *  двигают несколько раз подряд. */
const CHANGE_DELAY_MS = 60_000;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Съёмка как она есть в базе: что разослать и с чем сравнить правку. */
type ShootRow = ProducerShoot & { snapshot: ShootSnapshot; stage: string | null; parentType: string | null };

/** Поля съёмки для всех выборок: проект, адрес, место, видеограф. Съёмка —
 *  карточка подготовки этапа «съёмка»; у старых карточек без этапа съёмкой
 *  считается всё, что не обложка поста (как в кабинете производства). */
const SHOOT_SELECT = `
  SELECT ci.id, to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS date, ci."publishTime" AS time,
         ci.status::text AS status, ci."shootPlace" AS place, ci."prepStage" AS stage,
         p.id AS "projectId", p.name AS "projectName", p."smmData" AS "smmData",
         COALESCE(parent.topic, ci.topic) AS title, parent."contentType"::text AS "parentType",
         au.name AS videographer, ci."assigneeId" AS "assigneeId",
         COALESCE(parent.id, ci.id) AS "scriptItemId",
         btrim(COALESCE(CASE WHEN parent.id IS NOT NULL THEN parent."scriptText" ELSE ci."scriptText" END, '')) <> '' AS "hasScript",
         ci.status::text = 'published' AS done,
         EXISTS (SELECT 1 FROM content_plan_items e
                  WHERE ci."shootForItemId" IS NOT NULL AND e."shootForItemId" = ci."shootForItemId"
                    AND e."prepStage" = 'edit' AND e.status::text = 'published') AS edited
    FROM content_plan_items ci
    JOIN projects p ON p.id = ci."projectId"
    LEFT JOIN content_plan_items parent ON parent.id = ci."shootForItemId"
    LEFT JOIN users au ON au.id = ci."assigneeId"`;
const IS_SHOOT = `(ci."prepStage" = 'shoot'
       OR (ci."prepStage" IS NULL AND ci."shootForItemId" IS NOT NULL
           AND COALESCE(parent."contentType"::text, '') <> 'post'))`;

/** Продюсер (29.10.2026, вариант А): съёмки всех SMM-проектов — ему, без
 *  назначения на проект (продюсер в команде один, как видеограф). Видеограф
 *  получает те же сообщения, но только о своих съёмках — в утренней сводке
 *  9:00 их больше нет. Отдельный модуль по той же причине, что и сводка
 *  производству: Telegram в зависимостях ContentPlanModule замкнул бы
 *  кольцо модулей. */
@Injectable()
export class ProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(ProducerService.name);
  /** Отложенные «съёмка изменилась»: id → как было до первой правки. */
  private pending = new Map<string, { timer: NodeJS.Timeout; before: ShootSnapshot; actorId: string | null }>();

  constructor(
    private ds: DataSource,
    private telegram: TelegramService,
    private notifications: NotificationsService,
  ) {}

  private get secret() {
    return process.env.JWT_SECRET || 'dev-secret';
  }

  scriptUrl(s: Pick<ProducerShoot, 'scriptItemId'>) {
    return `${this.telegram.appUrl}/public/script/${scriptToken(s.scriptItemId, this.secret)}`;
  }

  /** Строки выборки → съёмки: место — студия, адрес клиента или «Другое»,
   *  СММ — имена специалистов проекта. */
  private async toShoots(rows: any[]): Promise<ShootRow[]> {
    const idsOf = (sd: any): string[] =>
      Array.isArray(sd?.smmSpecialistIds) ? sd.smmSpecialistIds.filter((x: any) => typeof x === 'string') : [];
    const allIds = [...new Set(rows.flatMap(r => idsOf(r.smmData)))];
    const names = new Map<string, string>();
    if (allIds.length) {
      const users: Array<{ id: string; name: string }> = await this.ds.query(
        `SELECT id, name FROM users WHERE id = ANY($1::uuid[]) AND "isActive" = true`, [allIds],
      ).catch(() => []);
      for (const u of users) names.set(u.id, u.name);
    }
    return rows.map(r => {
      const sd = r.smmData || {};
      const place = str(r.place);
      const kind = shootPlaceKind(place);
      const smmIds = idsOf(sd).filter(id => names.has(id));
      return {
        id: r.id, date: r.date, time: r.time || null, projectName: r.projectName || 'Проект',
        title: r.title || null, videographer: r.videographer || null, assigneeId: r.assigneeId || null,
        scriptItemId: r.scriptItemId, hasScript: !!r.hasScript, done: !!r.done, edited: !!r.edited,
        placeKind: kind,
        address: kind === 'studio' ? STUDIO_LABEL : kind === 'client' ? str(sd.shootAddress) : place,
        otherPlace: kind === 'other',
        mapUrl: kind === 'client' ? str(sd.shootMapUrl) : null, contact: str(sd.shootContact),
        smm: smmIds.map(id => names.get(id)).join(', ') || null,
        projectId: r.projectId, smmIds,
        stage: r.stage || null, parentType: r.parentType || null,
        snapshot: { date: r.date || null, time: r.time || null, place, assigneeId: r.assigneeId || null, status: r.status || '' },
      };
    });
  }

  /** Съёмки SMM-проектов за дни «с — по». */
  async shoots(from: string, to: string): Promise<ShootRow[]> {
    const rows: any[] = await this.ds.query(
      `${SHOOT_SELECT}
        WHERE p."projectType" = 'SMM' AND COALESCE(p."isArchived", false) = false
          AND COALESCE(p.status::text, '') <> 'archived'
          AND ci."publishDate" IS NOT NULL
          AND ci."publishDate"::date >= ($1)::date AND ci."publishDate"::date <= ($2)::date
          AND ci.status::text <> 'cancelled'
          AND COALESCE(parent.status::text, '') <> 'cancelled'
          AND ${IS_SHOOT}
        ORDER BY ci."publishDate" ASC, ci."publishTime" ASC NULLS LAST, ci."createdAt" ASC`,
      [from, to],
    );
    return this.toShoots(rows);
  }

  /** Одна съёмка — какой бы она ни была сейчас (без даты, отменённая). */
  private async shootById(id: string): Promise<ShootRow | null> {
    const rows: any[] = await this.ds.query(
      `${SHOOT_SELECT}
        WHERE ci.id = $1 AND p."projectType" = 'SMM' AND ${IS_SHOOT}`,
      [id],
    );
    return (await this.toShoots(rows))[0] || null;
  }

  /** Панель продюсера: съёмки недели — только посмотреть. */
  async shootsForPanel(from: string, to: string) {
    const isIso = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isIso(from) || !isIso(to) || from > to) throw new BadRequestException('Некорректный период');
    const items = await this.shoots(from, to).catch((e: any) => {
      this.logger.warn(`producer shoots failed: ${e?.message || e}`);
      return [] as ProducerShoot[];
    });
    return {
      from, to,
      items: items.map(s => ({
        id: s.id, date: s.date, time: s.time, projectName: s.projectName, title: s.title,
        videographer: s.videographer, hasScript: s.hasScript, done: s.done,
        address: s.address || null, mapUrl: mapLink(s), contact: s.contact || null, smm: s.smm || null,
      })),
    };
  }

  /** Кому слать: все действующие продюсеры (основная или вторая роль). */
  private async producers(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.ds.query(
      `SELECT id FROM users WHERE "isActive" = true AND (role = 'producer' OR "secondaryRole" = 'producer')`,
    ).catch(() => []);
    return rows.map(r => r.id);
  }

  private async deliver(users: string[], text: string, title: string, message: string, link = '/') {
    for (const userId of users) {
      await this.telegram.sendToUser(userId, text);
      try {
        await this.notifications.create({ userId, type: NotificationType.NEW_TASK, title, message, link });
      } catch (e) {
        this.logger.warn(`Уведомление о съёмках не создано ${userId}: ${(e as Error).message}`);
      }
    }
  }

  /** Видеографам — каждому его съёмки: сообщение «Ваши съёмки…» строит build. */
  private async deliverOwn(
    list: ProducerShoot[], build: (own: ProducerShoot[]) => string | null, title: (n: number) => string, message: string,
  ) {
    const byUser = new Map<string, ProducerShoot[]>();
    for (const s of list) {
      if (!s.assigneeId || s.done) continue;
      byUser.set(s.assigneeId, [...(byUser.get(s.assigneeId) || []), s]);
    }
    for (const [userId, own] of byUser) {
      const text = build(own);
      if (text) await this.deliver([userId], text, title(groupShoots(own).length), message);
    }
    return byUser.size;
  }

  /** 18:00 накануне: съёмки на завтра — продюсеру все, видеографу свои.
   *  Продюсеру сверху ещё «Сегодня»: какие съёмки отмечены снятыми — он
   *  организует их, сам не присутствуя (09.11.2026). */
  @Cron('0 18 * * *', { timeZone: TZ })
  async notifyTomorrow() {
    try {
      const today = dushanbeToday();
      const day = addDays(today, 1);
      const both = await this.shoots(today, day);
      const list = both.filter(s => s.date === day);
      const link = (s: ProducerShoot) => this.scriptUrl(s);
      const text = dailyMessage(day, list, this.telegram.appUrl, link);
      const summary = todaySummary(today, both);
      if (!text && !summary) return;
      const n = groupShoots(list.filter(s => !s.done)).length;
      const producers = await this.producers();
      const forProducer = [summary, text || '🎬 Съёмок на завтра нет'].filter(Boolean).join('\n\n');
      await this.deliver(producers, forProducer, text ? `Съёмки на завтра — ${n}` : 'Съёмки за сегодня', ruLongDay(text ? day : today), '/smm');
      const crew = text ? await this.deliverOwn(list, own => dailyMessage(day, own, this.telegram.appUrl, link, { own: true }),
        k => `Ваши съёмки на завтра — ${k}`, ruLongDay(day)) : 0;
      this.logger.log(`Съёмки на ${day}: ${n} (продюсеров ${producers.length}, видеографов ${crew})`);
    } catch (e: any) {
      this.logger.warn(`Съёмки на завтра не отправлены: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Суббота, 18:00: съёмки на следующую неделю — продюсеру все, видеографу свои. */
  @Cron('0 18 * * 6', { timeZone: TZ })
  async notifyNextWeek() {
    try {
      const { from, to } = nextWeek(dushanbeToday());
      const list = await this.shoots(from, to);
      const link = (s: ProducerShoot) => this.scriptUrl(s);
      const text = weeklyMessage(from, to, list, this.telegram.appUrl, link);
      if (!text) return;
      const n = groupShoots(list.filter(s => !s.done)).length;
      const range = ruRange(from, addDays(to, -1));
      const producers = await this.producers();
      await this.deliver(producers, text, `Съёмки на неделю — ${n}`, range, '/smm');
      const crew = await this.deliverOwn(list, own => weeklyMessage(from, to, own, this.telegram.appUrl, link, { own: true }),
        k => `Ваши съёмки на неделю — ${k}`, range);
      this.logger.log(`Съёмки на неделю ${from}…${to}: ${n} (продюсеров ${producers.length}, видеографов ${crew})`);
    } catch (e: any) {
      this.logger.warn(`Съёмки на неделю не отправлены: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Рилсы с выходом в ближайшие дни, у которых нет съёмки: её отменили или
   *  не ставили, а монтаж ещё не готов. Их и нужно назначить продюсеру. */
  async needShoots(from: string, to: string): Promise<NeedShoot[]> {
    const rows: any[] = await this.ds.query(
      `SELECT p.name AS "projectName", r.topic AS title, to_char(r."publishDate"::date, 'YYYY-MM-DD') AS date,
              EXISTS (SELECT 1 FROM content_plan_items c
                       WHERE c."shootForItemId" = r.id AND COALESCE(c."prepStage", 'shoot') = 'shoot'
                         AND c.status::text = 'cancelled') AS cancelled
         FROM content_plan_items r
         JOIN projects p ON p.id = r."projectId"
        WHERE p."projectType" = 'SMM' AND COALESCE(p."isArchived", false) = false
          AND COALESCE(p.status::text, '') <> 'archived'
          AND r."shootForItemId" IS NULL AND r."contentType"::text = 'reel'
          AND r.status::text NOT IN ('published', 'cancelled')
          AND r."publishDate" IS NOT NULL
          AND r."publishDate"::date >= ($1)::date AND r."publishDate"::date <= ($2)::date
          AND NOT EXISTS (SELECT 1 FROM content_plan_items s
                           WHERE s."shootForItemId" = r.id AND COALESCE(s."prepStage", 'shoot') = 'shoot'
                             AND s.status::text <> 'cancelled' AND s."publishDate" IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM content_plan_items e
                           WHERE e."shootForItemId" = r.id AND e."prepStage" = 'edit' AND e.status::text = 'published')
        ORDER BY r."publishDate" ASC, p.name ASC`,
      [from, to],
    );
    return rows.map(r => ({ projectName: r.projectName || 'Проект', title: r.title || null, date: r.date, cancelled: !!r.cancelled }));
  }

  /** 12:00: что назначить. С 09.11.2026 съёмки назначает продюсер — ему
   *  рилсы ближайших трёх дней без съёмки и завтрашние съёмки без времени.
   *  Продюсера в команде нет — как раньше, СММ-специалистам проекта. */
  @Cron('0 12 * * *', { timeZone: TZ })
  async remindMissingTime() {
    try {
      const today = dushanbeToday();
      const day = addDays(today, 1);
      const producers = await this.producers();
      if (producers.length) {
        const [tomorrow, need] = await Promise.all([this.shoots(day, day), this.needShoots(today, addDays(today, 3))]);
        const text = producerNoonMessage(day, tomorrow, need, this.telegram.appUrl);
        if (!text) return;
        const noTime = groupShoots(tomorrow.filter(s => !s.done && !s.time)).length;
        await this.deliver(producers, text, `Нужно назначить — ${need.length + noTime}`, ruLongDay(day), '/smm');
        this.logger.log(`Назначить: без съёмки ${need.length}, без времени ${noTime} (продюсеров ${producers.length})`);
        return;
      }
      const list = (await this.shoots(day, day)).filter(s => !s.done && !s.time);
      if (!list.length) return;
      // Кому: СММ-специалисты проекта; нет их — менеджер проекта.
      const managers = new Map<string, string>();
      const noSmm = [...new Set(list.filter(s => !s.smmIds?.length).map(s => s.projectId!))];
      if (noSmm.length) {
        const rows: Array<{ id: string; managerId: string | null }> = await this.ds.query(
          `SELECT p.id, p."managerId" FROM projects p JOIN users u ON u.id = p."managerId" AND u."isActive" = true
            WHERE p.id = ANY($1::uuid[])`, [noSmm],
        ).catch(() => []);
        for (const r of rows) if (r.managerId) managers.set(r.id, r.managerId);
      }
      const byUser = new Map<string, ProducerShoot[]>();
      for (const s of list) {
        const to = s.smmIds?.length ? s.smmIds : (managers.get(s.projectId!) ? [managers.get(s.projectId!)!] : []);
        for (const u of to) byUser.set(u, [...(byUser.get(u) || []), s]);
      }
      for (const [userId, own] of byUser) {
        const text = missingTimeMessage(day, own, this.telegram.appUrl);
        if (text) await this.deliver([userId], text, `Укажите время съёмок на завтра — ${own.length}`, ruLongDay(day));
      }
      this.logger.log(`Съёмки без времени на ${day}: ${list.length} (напомнили ${byUser.size})`);
    } catch (e: any) {
      this.logger.warn(`Напоминание о времени съёмок не отправлено: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Съёмку поправили в CRM. Копим правки минуту, потом сравниваем с тем,
   *  что было до первой, и, если видеограф уже знает о съёмке (сегодня или
   *  завтра после 18:00), шлём ему и продюсеру, что изменилось. */
  @OnEvent(SHOOT_CHANGED)
  onShootChanged(ev: ShootChangedEvent) {
    if (!ev?.itemId || !ev.before) return;
    const prev = this.pending.get(ev.itemId);
    if (prev) clearTimeout(prev.timer);
    const before = prev?.before || ev.before;
    const actorId = ev.actorId ?? prev?.actorId ?? null;
    const timer = setTimeout(() => {
      this.pending.delete(ev.itemId);
      this.sendShootChange(ev.itemId, before, actorId).catch(e =>
        this.logger.warn(`«Съёмка изменилась» не отправлено: ${String(e?.message || e).slice(0, 160)}`));
    }, CHANGE_DELAY_MS);
    timer.unref?.();
    this.pending.set(ev.itemId, { timer, before, actorId });
  }

  onModuleDestroy() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  private async sendShootChange(itemId: string, before: ShootSnapshot, actorId: string | null) {
    const s = await this.shootById(itemId);
    if (!s) return;
    const after = s.snapshot;
    const today = dushanbeToday(), hour = dushanbeHour();
    if (!isAnnounced(before.date, today, hour) && !isAnnounced(after.date, today, hour)) return;
    if (s.done) return;
    const link = (x: ProducerShoot) => this.scriptUrl(x);
    const head = changeHead(before, after);
    const producers = await this.producers();
    const notMe = (id: string | null | undefined) => !!id && id !== actorId;

    if (head) {
      const brief = `${s.projectName}${s.title ? ` · «${s.title}»` : ''}`;
      await this.deliver(producers.filter(notMe), changeMessage(head, before, s, link), head, brief);
      // Видеограф, у которого съёмка сейчас: если его только что назначили,
      // ему уйдёт «Вам передали съёмку» ниже — со всеми новыми данными.
      if (notMe(s.assigneeId) && s.assigneeId === before.assigneeId) {
        await this.deliver([s.assigneeId!], changeMessage(head, before, s, link, { own: true }), head, brief);
      }
    }
    if (before.assigneeId !== after.assigneeId && !(after.status === 'cancelled' || !after.date)) {
      const brief = `${s.projectName}${s.title ? ` · «${s.title}»` : ''}`;
      if (notMe(after.assigneeId)) await this.deliver([after.assigneeId!], handedOverMessage(s, link), 'Вам передали съёмку', brief);
      if (notMe(before.assigneeId)) await this.deliver([before.assigneeId!], takenAwayMessage(s), 'Съёмку передали другому видеографу', brief);
    }
  }

  /** Страница сценария по ссылке — без входа. Ссылка живёт, пока рилс не
   *  вышел: опубликован, отменён или удалён — «ссылка больше не работает». */
  async publicScript(token: string) {
    const id = readScriptToken(token, this.secret);
    if (!id) throw new NotFoundException('Ссылка не найдена');
    const rows: any[] = await this.ds.query(
      `SELECT ci.id, ci.topic AS title, ci."scriptText" AS script, ci.status::text AS status,
              ci."prepStage" AS stage,
              to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS "publishDate",
              ci."updatedAt" AS "updatedAt", p.name AS "projectName", p."smmData" AS "smmData"
         FROM content_plan_items ci
         JOIN projects p ON p.id = ci."projectId"
        WHERE ci.id = $1`,
      [id],
    );
    const item = rows[0];
    if (!item || item.status === 'published' || item.status === 'cancelled') {
      throw new GoneException('Ссылка больше не работает');
    }
    // Сама ссылка ведёт на рилс; съёмку берём его — ближайшую не отменённую.
    // Ссылка на одиночную съёмку (без рилса) — она сама и есть съёмка.
    const shootRows: any[] = item.stage === 'shoot' ? [{ id: item.id }] : await this.ds.query(
      `SELECT s.id FROM content_plan_items s
        WHERE s."shootForItemId" = $1 AND s.status::text <> 'cancelled'
          AND COALESCE(s."prepStage", 'shoot') = 'shoot'
        ORDER BY s."publishDate" ASC NULLS LAST, s."createdAt" ASC LIMIT 1`,
      [id],
    );
    let shoot: { date: string | null; time: string | null; videographer: string | null } | null = null;
    let place: string | null = null;
    if (shootRows[0]) {
      const sr: any[] = await this.ds.query(
        `SELECT to_char(s."publishDate"::date, 'YYYY-MM-DD') AS date, s."publishTime" AS time, u.name AS videographer,
                s."shootPlace" AS place
           FROM content_plan_items s LEFT JOIN users u ON u.id = s."assigneeId" WHERE s.id = $1`,
        [shootRows[0].id],
      );
      if (sr[0]) {
        shoot = { date: sr[0].date || null, time: sr[0].time || null, videographer: sr[0].videographer || null };
        place = str(sr[0].place);
      }
    }
    // О проекте (07.11.2026): куда ехать, кто встретит, у кого уточнять.
    const sd = item.smmData || {};
    const smmIds: string[] = Array.isArray(sd.smmSpecialistIds) ? sd.smmSpecialistIds.filter((x: any) => typeof x === 'string') : [];
    const smmRows: Array<{ name: string }> = smmIds.length ? await this.ds.query(
      `SELECT name FROM users WHERE id = ANY($1::uuid[]) AND "isActive" = true ORDER BY name`, [smmIds],
    ).catch(() => []) : [];
    // Где снимаем (09.11.2026): студия — без карты, у клиента — адрес проекта.
    const kind = shootPlaceKind(place);
    const address = kind === 'studio' ? STUDIO_LABEL : kind === 'client' ? str(sd.shootAddress) : place;
    const contact = str(sd.shootContact);
    return {
      title: item.title || null,
      projectName: item.projectName || null,
      project: {
        address,
        otherPlace: kind === 'other',
        placeKind: kind,
        mapUrl: kind === 'studio' ? null : mapLink({ address, otherPlace: kind === 'other', mapUrl: str(sd.shootMapUrl) }),
        contact,
        phone: phoneOf(contact),
        pageUrl: str(sd.pageUrl),
        smm: smmRows.map(r => r.name).join(', ') || null,
        preferences: str(sd.preferences),
      },
      shoot,
      publishDate: item.stage === 'shoot' ? null : item.publishDate || null,
      script: (item.script || '').trim() || null,
      updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
    };
  }
}
