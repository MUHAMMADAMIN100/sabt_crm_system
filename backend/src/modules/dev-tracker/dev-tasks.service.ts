import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import * as http from 'http';
import * as https from 'https';
import { createHmac } from 'crypto';
import { DevTask, DevTaskStatus, DevTaskPriority, DevTaskType } from './dev-task.entity';
import { DevTaskComment } from './dev-task-comment.entity';
import { DevTaskHistory } from './dev-task-history.entity';
import { DevSprint, DevSprintStatus } from './dev-sprint.entity';
import { DevBoardView, DEV_BOARD_VIEW_GROUP_BY } from './dev-board-view.entity';
import { DevWebhookSubscription, DEV_WEBHOOK_EVENTS } from './dev-webhook-subscription.entity';
import { DevWebhookDelivery } from './dev-webhook-delivery.entity';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { CreateDevTaskDto } from './dto/create-dev-task.dto';
import { UpdateDevTaskDto } from './dto/update-dev-task.dto';
import { BulkDevTaskAction } from './dto/bulk-dev-task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { AppGateway } from '../gateway/app.gateway';
import { DEV_PROJECT_TYPES } from '../../common/sales-segment';
import {
  formatDevReportMarkdown,
  DevReportBlocker,
  DevReportMember,
  DevReportStats,
} from './dev-report.format';

/** Подписи статусов для текстов уведомлений. */
const STATUS_LABELS: Record<DevTaskStatus, string> = {
  [DevTaskStatus.BACKLOG]: 'Бэклог',
  [DevTaskStatus.TODO]: 'К выполнению',
  [DevTaskStatus.IN_PROGRESS]: 'В работе',
  [DevTaskStatus.IN_REVIEW]: 'На ревью',
  [DevTaskStatus.TESTING]: 'Тестирование',
  [DevTaskStatus.DONE]: 'Готово',
};

/** Порядок колонок канбана. Нужен, чтобы findAll сортировал задачи
 *  сначала по колонке (backlog → done), а уже внутри — по position:
 *  фронту доски удобно получать готовый порядок без пересортировки. */
const STATUS_ORDER: DevTaskStatus[] = [
  DevTaskStatus.BACKLOG,
  DevTaskStatus.TODO,
  DevTaskStatus.IN_PROGRESS,
  DevTaskStatus.IN_REVIEW,
  DevTaskStatus.TESTING,
  DevTaskStatus.DONE,
];

  /** Пороги SLA для открытых задач БЕЗ дедлайна (контракт I): максимальный
 *  возраст задачи от createdAt по приоритету. Задача старше порога считается
 *  нарушившей SLA (slaBreached в getKpi().team). Открытые задачи С дедлайном
 *  нарушают SLA ровно когда просрочены (deadline < начала СЕГОДНЯШНЕГО дня
 *  по Asia/Dushanbe — та же граница, что overdue в getKpi и scheduler) —
 *  независимо от приоритета. Значения — продуктовое решение, менять осознанно. */
export const DEV_SLA_THRESHOLDS_DAYS: Record<DevTaskPriority, number> = {
  [DevTaskPriority.CRITICAL]: 1,
  [DevTaskPriority.HIGH]: 3,
  [DevTaskPriority.MEDIUM]: 7,
  [DevTaskPriority.LOW]: 14,
};

/** Дневные бакеты KPI режутся по Asia/Dushanbe — как scheduler
 *  (dev-deadline.scheduler.ts) и triageOverdue: Душанбе = UTC+5 круглый
 *  год, без DST, поэтому полночь выражаем явным офсетом +05:00.
 *  UTC-срезы (toISOString) сдвигали задачи на ±1 день для Душанбе (+05:00):
 *  00:30 ночи по Душанбе — это ещё прошлые сутки по UTC. */
const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;
const DUSHANBE_TZ = 'Asia/Dushanbe';

/** Календарный день instant'а по Душанбе ('YYYY-MM-DD'). */
function dushanbeDayKey(d: Date | string | number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DUSHANBE_TZ }).format(new Date(d));
}

/** Начало сегодняшнего дня по Душанбе (instant). Та же граница, что
 *  в dev-deadline.scheduler.ts и triageOverdue. */
function dushanbeTodayStart(now: Date): Date {
  return new Date(`${dushanbeDayKey(now)}T00:00:00+05:00`);
}

/** Конец календарного дня Душанбе (instant, ms). */
function dushanbeEndOfDay(day: string): number {
  return new Date(`${day}T23:59:59.999+05:00`).getTime();
}

/** Понедельник недели (календарь Душанбе) для instant'а, 'YYYY-MM-DD'.
 *  Офсет фиксированный (+5, без DST), поэтому душанбинскую дату получаем
 *  сдвигом instant'а на +5ч и обычной UTC-арифметикой по понедельникам. */
function dushanbeMondayOf(d: Date): string {
  const shifted = new Date(d.getTime() + DUSHANBE_OFFSET_MS);
  const x = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = понедельник
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

/** Безопасные storyPoints для сумм velocity: finite число, иначе 0.
 *  `?? 0` пропускал NaN — одна битая задача отравляла неделю в NaN. */
function safeStoryPoints(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Таймаут доставки одного вебхука (контракт E). Нативный http/https,
 *  без axios — чтобы outbox не тянул новую зависимость. */
const DEV_WEBHOOK_TIMEOUT_MS = 8000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Лимиты DoS для JSONB-фильтров views (контракт D): непрозрачный объект фронта,
 *  но безлимитный JSONB — это простыня в БД. Кап по ключам/размеру/глубине. */
const DEV_VIEW_FILTERS_MAX_KEYS = 20;
const DEV_VIEW_FILTERS_MAX_JSON_BYTES = 10 * 1024;
/** Лимит тегов фильтра ?tags= (DoS: ILIKE ANY с простынёй тегов). */
const DEV_TAGS_FILTER_MAX = 20;
/** Лимит детей при clone withSubtasks (DoS: родитель с 1000 детьми = 1000 INSERT). */
const DEV_CLONE_MAX_SUBTASKS = 100;

/** SSRF-блок для webhook-URL (контракт E): только публичные http(s)-хосты.
 *  manage-право не должно превращаться в сканер внутренней сети / читалку
 *  metadata (169.254.169.254) через outbox. Проверяем литеральные IP,
 *  localhost и userinfo; DNS-rebinding остаётся остаточным риском (см. отчёт). */
function isBlockedWebhookHostname(hostname: string): boolean {
  const h = (hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  // Unit-тесты (jest) поднимают локальный http-сервер на 127.0.0.1 для проверки
  // HMAC-подписи postWebhook: loopback разрешаем ТОЛЬКО под jest
  // (JEST_WORKER_ID выставлен раннером). В проде loopback блокируется как SSRF.
  // Metadata-IP блокируем всегда, даже под jest.
  const isJest = typeof process !== 'undefined' && !!process.env.JEST_WORKER_ID;
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  if (isJest && (h === '127.0.0.1' || h === 'localhost')) return false;
  if (h === 'localhost') return true;
  if (h === '::1' || h === '::' || h === '0.0.0.0') return true;
  // IPv4-литерал?
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const p = v4.slice(1).map(Number);
    if (p.some(n => n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 127) return !isJest; // loopback 127/8: в проде блок, в jest — сервер HMAC-теста
    if (a === 10) return true; // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 0) return true; // 0/8
    return false;
  }
  // IPv6 с двоеточием без резолва: блокируем только очевидный loopback.
  if (h.includes(':')) return h === '::1';
  // Обычный DNS-хост: точечные блокировки выше не применимы без резолва.
  if (h === '169.254.169.254') return true;
  return false;
}

/** Единая проверка webhook-URL: http/https, без userinfo, хост не приватный.
 *  Возвращает нормализованный (trim) URL или кидает 400. */
function assertPublicWebhookUrl(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new BadRequestException('Некорректный URL вебхука');
  }
  const url = raw.trim();
  if (!url || url.length > 2000) {
    throw new BadRequestException('Некорректный URL вебхука');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('URL вебхука должен начинаться с http:// или https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('URL вебхука должен начинаться с http:// или https://');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException('URL вебхука не должен содержать credentials');
  }
  if (isBlockedWebhookHostname(parsed.hostname)) {
    throw new BadRequestException('URL вебхука указывает на внутренний адрес (запрещено)');
  }
  return url;
}

/** Валидация непрозрачных filters saved view: plain object, без прототипных
 *  ключей, кап по ключам/размеру/глубине. Иначе 400 вместо простыни в JSONB. */
function assertViewFilters(filters: unknown): Record<string, any> {
  const f: any = (filters as any) ?? {};
  if (typeof f !== 'object' || f === null || Array.isArray(f)) {
    throw new BadRequestException('Фильтры должны быть объектом');
  }
  const proto = Object.getPrototypeOf(f);
  if (proto !== Object.prototype && proto !== null) {
    throw new BadRequestException('Фильтры должны быть объектом');
  }
  const keys = Object.keys(f);
  if (keys.length > DEV_VIEW_FILTERS_MAX_KEYS) {
    throw new BadRequestException(
      `Слишком много фильтров (макс. ${DEV_VIEW_FILTERS_MAX_KEYS})`,
    );
  }
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      throw new BadRequestException('Некорректные фильтры');
    }
    if (k.length > 100) {
      throw new BadRequestException('Некорректные фильтры');
    }
  }
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(f), 'utf8');
  } catch {
    throw new BadRequestException('Некорректные фильтры');
  }
  if (size > DEV_VIEW_FILTERS_MAX_JSON_BYTES) {
    throw new BadRequestException('Фильтры слишком большие (макс. 10 КБ)');
  }
  // Глубина ≤ 5: рекурсивно, массивы тоже считаем уровнем.
  const depth = (v: any, d: number): number => {
    if (d > 5) return d;
    if (Array.isArray(v)) {
      let m = d;
      for (const el of v.slice(0, 50)) m = Math.max(m, depth(el, d + 1));
      return m;
    }
    if (v && typeof v === 'object') {
      let m = d;
      for (const k of Object.keys(v).slice(0, 50)) m = Math.max(m, depth(v[k], d + 1));
      return m;
    }
    return d;
  };
  if (depth(f, 0) > 5) {
    throw new BadRequestException('Фильтры слишком вложенные');
  }
  return f as Record<string, any>;
}

/** Санитизация тегов задачи: trim, drop пустых, дедуп, кап 10×50.
 *  null/undefined — не менять/дефолт (как раньше), иначе обязаны быть массивом. */
function sanitizeTaskTags(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new BadRequestException('Некорректные теги');
  }
  if (value.length > 10) {
    throw new BadRequestException('Слишком много тегов (макс. 10)');
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new BadRequestException('Некорректные теги');
    }
    const t = raw.trim();
    if (!t) continue;
    if (t.length > 50) {
      throw new BadRequestException('Тег слишком длинный (макс. 50 символов)');
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Валидация attachments: массив ≤10, каждый http(s)-URL ≤2000.
 *  javascript:/data:/vbscript: — stored-XSS через <a href>, поэтому только
 *  http/https (как у вебхуков). null/undefined — как раньше. */
function sanitizeTaskAttachments(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new BadRequestException('Некорректные вложения');
  }
  if (value.length > 10) {
    throw new BadRequestException('Слишком много вложений (макс. 10)');
  }
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new BadRequestException('Некорректные вложения');
    }
    const u = raw.trim();
    if (!u || u.length > 2000) {
      throw new BadRequestException('Некорректные вложения');
    }
    let protocol = '';
    try {
      protocol = new URL(u).protocol;
    } catch {
      throw new BadRequestException('Вложение должно быть http(s)-URL');
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new BadRequestException('Вложение должно быть http(s)-URL');
    }
    out.push(u);
  }
  return out;
}

export interface DevTaskFilters {
  status?: DevTaskStatus;
  assigneeId?: string;
  search?: string;
  /** Фильтр по проекту «Разработка» (связка /dev/projects ↔ доска). */
  projectId?: string;
  /** Фильтр по тегам (ANY): задача подходит, если совпал хотя бы один тег. */
  tags?: string[];
  /** Фильтр блокера (контракт A): ?blocked=true — только заблокированные,
   *  ?blocked=false — только незаблокированные, absent — без фильтра. */
  blocked?: boolean;
  /** Фильтр спринта (контракт H): UUID — задачи спринта, null (?sprint=none) —
   *  задачи вне спринтов, undefined — без фильтра. */
  sprintId?: string | null;
}

/** Задача доски + агрегаты по её подзадачам. Это контракт ответа
 *  GET /dev-tracker: фронт рисует на карточке «2/3» (сделано/всего). */
export interface DevTaskWithStats extends DevTask {
  subtasksCount: number;
  subtasksDone: number;
}

/** Детальная карточка: сама задача с агрегатами, лента комментариев и
 *  массив подзадач (контракт ответа GET /dev-tracker/:id). Каждая подзадача
 *  тоже несёт stats-поля — унифицировано с карточками на доске. */
export interface DevTaskDetail extends DevTaskWithStats {
  comments: DevTaskComment[];
  subtasks: DevTaskWithStats[];
}

@Injectable()
export class DevTasksService {
  constructor(
    @InjectRepository(DevTask)
    private readonly taskRepo: Repository<DevTask>,
    @InjectRepository(DevTaskComment)
    private readonly commentRepo: Repository<DevTaskComment>,
    @InjectRepository(DevTaskHistory)
    private readonly historyRepo: Repository<DevTaskHistory>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(DevSprint)
    private readonly sprintRepo: Repository<DevSprint>,
    @InjectRepository(DevBoardView)
    private readonly viewRepo: Repository<DevBoardView>,
    @InjectRepository(DevWebhookSubscription)
    private readonly webhookRepo: Repository<DevWebhookSubscription>,
    @InjectRepository(DevWebhookDelivery)
    private readonly deliveryRepo: Repository<DevWebhookDelivery>,
    private readonly notifications: NotificationsService,
    private readonly gateway: AppGateway,
  ) {}

  /** Имя пользователя для текстов уведомлений (без тяжёлых связей). */
  private async userName(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return user?.name ?? 'Кто-то';
  }

  /** Уведомление-обёртка: ошибка доставки не должна ронять мутацию доски. */
  private async notifySafe(dto: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link: string;
  }) {
    try {
      await this.notifications.create(dto);
    } catch {
      // Уведомление — вторично по отношению к самой операции доски.
    }
  }

  /** Дедуплицированное уведомление-обёртка: дубль или ошибка доставки
   *  не должны ронять мутацию доски. Для STATUS_CHANGE при drag-and-drop. */
  private async notifyDedupSafe(
    dto: {
      userId: string;
      type: NotificationType;
      title: string;
      message: string;
      link: string;
      data: { alertKey: string };
    },
    dedupHours: number,
  ) {
    try {
      await this.notifications.createIfNotRecent(dto, dedupHours);
    } catch {
      // Уведомление — вторично по отношению к самой операции доски.
    }
  }

  /** Валидация исполнителя (единая для create/update/triage): не UUID или
   *  пользователь не найден → 400 'Исполнитель не найден' (assigneeId —
   *  поле запроса, поэтому ошибка клиента, а не 404/500). Не-строка
   *  (число/объект из прямых вызовов) → 400, а не RegExp-коэрсия/500. */
  private async assertAssignee(assigneeId: string): Promise<void> {
    if (typeof assigneeId !== 'string' || !UUID_RE.test(assigneeId)) {
      throw new BadRequestException('Исполнитель не найден');
    }
    const assignee = await this.userRepo.findOne({ where: { id: assigneeId } });
    if (!assignee) throw new BadRequestException('Исполнитель не найден');
  }

  /** Уведомление исполнителю о том, что ему поставили/назначили задачу
   *  (единое для create/update/clone). Актору самому — не шлём.
   *  kind 'created' — задачу поставили, 'assigned' — переназначили. */
  private async notifyTaskAssigned(
    assigneeId: string | null | undefined,
    actorId: string,
    task: { id: string; title: string },
    kind: 'created' | 'assigned',
  ): Promise<void> {
    if (!assigneeId || assigneeId === actorId) return;
    const actor = await this.userName(actorId);
    await this.notifySafe({
      userId: assigneeId,
      type: NotificationType.NEW_TASK,
      title: kind === 'created' ? 'Новая задача на доске разработки' : 'Вам назначили задачу',
      message:
        kind === 'created'
          ? `${actor} поставил(а) вам задачу: «${task.title}»`
          : `${actor} назначил(а) вам задачу: «${task.title}»`,
      link: `/dev-board/task/${task.id}`,
    });
  }

  /** Уведомление автора задачи о её завершении (единое для update/move).
   *  Актору самому — не шлём; у задачи без автора — некому. */
  private async notifyTaskDone(
    task: { id: string; title: string; createdById: string | null },
    actorId: string,
  ): Promise<void> {
    if (!task.createdById || task.createdById === actorId) return;
    const actor = await this.userName(actorId);
    await this.notifySafe({
      userId: task.createdById,
      type: NotificationType.TASK_COMPLETED,
      title: 'Задача завершена',
      message: `${actor} завершил(а) задачу: «${task.title}»`,
      link: `/dev-board/task/${task.id}`,
    });
  }

  /** История изменений — вторична: ошибка записи глотается как notifySafe,
   *  мутацию доски не роняет. */
  private async logHistory(
    taskId: string,
    actorId: string | null | undefined,
    field: string,
    from: string | null,
    to: string | null,
  ) {
    try {
      const row = this.historyRepo.create({
        taskId,
        actorId: actorId ?? null,
        field,
        from,
        to,
      });
      await this.historyRepo.save(row);
    } catch {
      // История — вторична по отношению к самой операции доски.
    }
  }

  /** Дата для истории строкой (ISO), null — нет значения. */
  private historyDateStr(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    try {
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(dt.getTime())) return String(d);
      return dt.toISOString();
    } catch {
      return String(d);
    }
  }

  /** Санитизация mentions: массив UUID, max 20, дедуп (case-insensitive).
   *  Формат проверяем общим UUID_RE (не локальной копией regex). */
  private sanitizeMentions(mentions?: string[]): string[] {
    if (!Array.isArray(mentions)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of mentions) {
      if (typeof m !== 'string') continue;
      const v = m.trim();
      if (!UUID_RE.test(v)) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= 20) break;
    }
    return out;
  }

  /** Безопасная публичная ссылка на пользователя: только id/имя/аватар.
   *  ВАЖНО: раньше здесь был спред всей сущности User, а eager-связи
   *  assignee/createdBy тянут hash пароля, twoFactorSecret и токены сброса —
   *  они уходили в JSON ответов доски. Наружу — только белый список. */
  private mapAvatar<T>(user: T): T {
    if (!user || typeof user !== 'object') return user;
    const u = user as any;
    const avatar = u.avatar ?? u.avatarUrl ?? null;
    return {
      id: u.id,
      name: u.name,
      avatar,
      avatarUrl: avatar,
    } as unknown as T;
  }

  private mapTaskAvatars<T extends { assignee?: any; createdBy?: any }>(task: T): T {
    const t = task as any;
    if (t.assignee) t.assignee = this.mapAvatar(t.assignee);
    if (t.createdBy) t.createdBy = this.mapAvatar(t.createdBy);
    return task;
  }

  /** Чистим уведомления удалённой задачи, чтобы не висели битые ссылки
   *  `/dev-board/task/<id>`. Ошибка чистки не роняет само удаление. */
  private async cleanupNotifications(taskId: string) {
    try {
      await this.notifications.deleteByLink(`/dev-board/task/${taskId}`);
    } catch {
      // Чистка уведомлений — вторична по отношению к удалению задачи.
    }
  }

  /** Сигнал «доска изменилась»: у всех открытых досок обновятся данные
   *  без F5 (фронт слушает 'dev-tracker:changed' в useSocket). */
  private broadcast() {
    try {
      this.gateway.broadcast('dev-tracker:changed', { at: Date.now() });
    } catch {
      // Сокет не поднят — операции доски это не волнует.
    }
  }

  /** Список задач доски с фильтрами. Сортировка: колонка канбана → позиция
   *  внутри колонки. Eager-связи (assignee/createdBy) подтягиваются сами.
   *  Каждой задаче досчитываем subtasksCount/subtasksDone по этому же массиву.
   *  Query-фильтры идут мимо DTO (сырые @Query контроллера), поэтому enum/UUID
   *  валидируем здесь: мусор → 400, а не пустой ответ (?status) или 500
   *  Postgres (?sprint — uuid-колонка). Пустые строки трактуем как absent. */
  async findAll(filters: DevTaskFilters = {}): Promise<DevTaskWithStats[]> {
    if (filters.status && !(Object.values(DevTaskStatus) as string[]).includes(filters.status)) {
      throw new BadRequestException('Неизвестный статус');
    }
    if (filters.assigneeId && !UUID_RE.test(filters.assigneeId)) {
      throw new BadRequestException('Некорректный assigneeId (нужен UUID)');
    }
    if (filters.projectId && !UUID_RE.test(filters.projectId)) {
      throw new BadRequestException('Некорректный projectId (нужен UUID)');
    }
    // Сырые фильтры мимо DTO обязаны быть своих типов, иначе 500:
    // tags.map/search.trim/boolean-bind в Postgres падали бы на мусоре.
    if (filters.tags !== undefined && filters.tags !== null && !Array.isArray(filters.tags)) {
      throw new BadRequestException('Некорректные теги');
    }
    if (filters.search !== undefined && filters.search !== null && typeof filters.search !== 'string') {
      throw new BadRequestException('Некорректный поисковый запрос');
    }
    if (filters.blocked !== undefined && filters.blocked !== null && typeof filters.blocked !== 'boolean') {
      throw new BadRequestException('Некорректный фильтр blocked');
    }
    if (
      filters.sprintId !== undefined &&
      filters.sprintId !== null &&
      filters.sprintId !== '' &&
      !UUID_RE.test(filters.sprintId)
    ) {
      throw new BadRequestException('Некорректный sprintId (нужен UUID или "none")');
    }
    const qb = this.taskRepo.createQueryBuilder('task');

    if (filters.status) {
      qb.andWhere('task.status = :status', { status: filters.status });
    }
    if (filters.assigneeId) {
      qb.andWhere('task.assigneeId = :assigneeId', { assigneeId: filters.assigneeId });
    }
    if (filters.projectId) {
      // Связка с проектом «Разработка»: /dev/projects/:id → его задачи на доске.
      qb.andWhere('task.projectId = :projectId', { projectId: filters.projectId });
    }
    if (filters.search?.trim()) {
      // ILIKE — регистронезависимый поиск по заголовку и описанию.
      // % и _ экранируем: иначе «100%» ищется как «100» + любой символ.
      // Поиск обрезаем до 200 символов — ILIKE '%...%' полным сканом,
      // простыня в query не должна вешать доску. ESCAPE явный: дефолт
      // Postgres — backslash, но без ESCAPE '\\' экранирование не гарантировано
      // на всех конфигурациях.
      const q = filters.search.trim().slice(0, 200);
      const escaped = q.replace(/[\\%_]/g, '\\$&');
      qb.andWhere("(task.title ILIKE :search ESCAPE '\\' OR task.description ILIKE :search ESCAPE '\\')", {
        search: `%${escaped}%`,
      });
    }
    if (filters.tags?.length) {
      // ANY-совпадение по text[] через overlap-оператор &&.
      // Пустые/пробельные теги игнорируем; если после чистки пусто — фильтр не применяем.
      // DoS-кап: простыня тегов в query режется до 20 (остальное игнорируем).
      const clean = [...new Set(filters.tags.map(t => (t ?? '').toString().trim()).filter(Boolean))].slice(
        0,
        DEV_TAGS_FILTER_MAX,
      );
      if (clean.length > 0) {
        qb.andWhere('task.tags && :tags', { tags: clean });
      }
    }
    if (filters.blocked !== undefined) {
      // Контракт A: ?blocked=true — только заблокированные.
      qb.andWhere('task.isBlocked = :blocked', { blocked: filters.blocked });
    }
    if (filters.sprintId !== undefined && filters.sprintId !== '' && filters.sprintId !== null) {
      // Контракт H: UUID — задачи спринта (валидность проверена выше).
      qb.andWhere('task.sprintId = :sprintId', { sprintId: filters.sprintId });
    } else if (filters.sprintId === null) {
      // null (?sprint=none) — задачи вне спринтов.
      qb.andWhere('task.sprintId IS NULL');
    }

    // Имя проекта подтягиваем частично (id/name/projectType) — на карточках
    // и в фильтрах больше не нужно, а весь проект со связями тянуть дорого.
    qb.leftJoin('task.project', 'project')
      .addSelect(['project.id', 'project.name', 'project.projectType']);

    // ВАЖНО: QueryBuilder НЕ подтягивает eager-связи (в отличие от find*) —
    // раньше доска получала assignee/createdBy = null, и всё выглядело как
    // «Без исполнителя». Join'им вручную и ТОЛЬКО безопасные колонки
    // (id/name/avatar): целиком User содержит hash пароля и секреты
    // (наружу их не отдаёт mapAvatar ниже).
    qb.leftJoin('task.assignee', 'assignee')
      .addSelect(['assignee.id', 'assignee.name', 'assignee.avatar']);
    qb.leftJoin('task.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.avatar']);

    const tasks = await qb.getMany();
    const order = (s: DevTaskStatus) => STATUS_ORDER.indexOf(s);
    tasks.sort(
      (a, b) => order(a.status) - order(b.status) || a.position - b.position,
    );
    return this.withSubtaskStats(tasks);
  }

  /** Задача с комментариями (по возрастанию даты — лента обсуждения) и
   *  подзадачами (по position). Подзадачи грузим вручную: OneToMany-связи
   *  для них нет (иначе рискуем рекурсией при сериализации), а порядок и
   *  агрегаты нужны свои. Комментарии — отдельным запросом с take 500:
   *  лента одной задачи без пагинации иначе растянет ответ. */
  async findOne(id: string): Promise<DevTaskDetail> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');

    // Связанный проект «Разработка» — частично (id/name/projectType): на
    // карточке задачи достаточно ссылки на проект, без его связей.
    if (task.projectId) {
      (task as any).project = await this.projectRepo.findOne({
        where: { id: task.projectId },
        select: ['id', 'name', 'projectType'],
      });
    }

    const subtasksRaw = await this.taskRepo.find({
      where: { parentTaskId: id },
      order: { position: 'ASC' },
    });
    // Вложенность ограничена 1 уровнем, поэтому у самих подзадач
    // subtasksCount/subtasksDone всегда будут 0 — это ожидаемо.
    const subtasks = this.withSubtaskStats(subtasksRaw);

    const mapped = this.mapTaskAvatars({ ...task });
    // Автор комментария — тоже белым списком: eager-связь comment.author
    // иначе отдаёт всю сущность User (hash пароля, twoFactorSecret).
    const comments = (await this.commentRepo.find({
      where: { taskId: id },
      order: { createdAt: 'ASC' },
      take: 500,
    })).map(c => ({
      ...c,
      author: (c as any).author ? this.mapAvatar((c as any).author) : null,
    }));
    return {
      ...mapped,
      subtasksCount: subtasks.length,
      subtasksDone: subtasks.filter(s => s.status === DevTaskStatus.DONE).length,
      comments,
      subtasks,
    };
  }

  /** Досчитывает агрегаты по подзадачам для уже загруженного списка задач.
   *  Группируем в JS, а не отдельными SQL-агрегациями: объём доски
   *  разработки — сотни задач, а код так читается и тестируется проще. */
  private withSubtaskStats(tasks: DevTask[]): DevTaskWithStats[] {
    const count = new Map<string, number>();
    const done = new Map<string, number>();
    for (const task of tasks) {
      if (!task.parentTaskId) continue;
      count.set(task.parentTaskId, (count.get(task.parentTaskId) ?? 0) + 1);
      if (task.status === DevTaskStatus.DONE) {
        done.set(task.parentTaskId, (done.get(task.parentTaskId) ?? 0) + 1);
      }
    }
    return tasks.map(task => {
      const mapped = this.mapTaskAvatars({ ...task });
      return {
        ...mapped,
        subtasksCount: count.get(task.id) ?? 0,
        subtasksDone: done.get(task.id) ?? 0,
      };
    });
  }

  /** Инварианты enum для прямых вызовов сервиса (HTTP-слой уже отсекает
   *  мусор через class-validator → 400; здесь — страховка от 500 из Postgres
   *  при обходе DTO). Неизвестное значение → 400, а не QueryFailedError. */
  private assertTaskEnums(dto: { status?: unknown; priority?: unknown; taskType?: unknown }): void {
    if (dto.status !== undefined && !(Object.values(DevTaskStatus) as string[]).includes(dto.status as string)) {
      throw new BadRequestException('Неизвестный статус');
    }
    if (dto.priority !== undefined && !(Object.values(DevTaskPriority) as string[]).includes(dto.priority as string)) {
      throw new BadRequestException('Неизвестный приоритет');
    }
    if (dto.taskType !== undefined && !(Object.values(DevTaskType) as string[]).includes(dto.taskType as string)) {
      throw new BadRequestException('Неизвестный тип задачи');
    }
  }

  /** Позиция канбана — целое ≥ 0. Отрицательная ломает порядок колонки,
   *  null — 400 (у NOT NULL-колонки нет detached-состояния; раньше null
   *  долетал до Postgres 500-ой, т.к. @IsOptional пропускает явный null). */
  private assertPosition(position: number | null | undefined): void {
    if (position === undefined) return;
    if (position === null || !Number.isInteger(position) || position < 0) {
      throw new BadRequestException('Некорректная позиция');
    }
  }

  /** tags/attachments из прямых вызовов: null/undefined — ок (не менять /
   *  дефолт колонки), иначе — строгая санитизация с DoS-капами
   *  (10 шт, теги ≤50, вложения — http(s) ≤2000). Раньше проверялся только
   *  Array.isArray, и прямые вызовы обходили DTO-лимиты. */
  private assertTags(tags: string[] | null | undefined): void {
    sanitizeTaskTags(tags as unknown);
  }

  private assertAttachments(attachments: string[] | null | undefined): void {
    sanitizeTaskAttachments(attachments as unknown);
  }

  /** Описание: optional string ≤10000 (DTO-кап). Прямые вызовы с числом/
   *  объектом раньше уходили в text-колонку без 400. */
  private assertDescription(value: unknown): void {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') {
      throw new BadRequestException('Некорректное описание задачи');
    }
    if (value.length > 10000) {
      throw new BadRequestException('Описание слишком длинное (макс. 10000 символов)');
    }
  }

  /** Защита NOT NULL-скаляров от 500 (прямые вызовы мимо DTO: class-validator
   *  @IsOptional пропускает явный null, и он долетал бы до Postgres как
   *  NULL в NOT NULL-колонку). null/не-строка/пустое/>200 → 400. */
  private assertTitle(value: unknown, required: boolean): void {
    if (value === undefined) {
      if (required) throw new BadRequestException('Некорректное название задачи');
      return;
    }
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new BadRequestException('Некорректное название задачи');
    }
  }

  /** position/storyPoints — int в NOT NULL-колонках: detached-состояния нет
   *  (в отличие от nullable deadline/sprint), поэтому null → 400, а не
   *  молчаливый сброс в 0 (сюрприз для порядка колонки и оценки). */
  private assertIntField(value: unknown, field: string, min: number, max?: number): void {
    if (value === undefined) return;
    if (value === null || !Number.isInteger(value) || (value as number) < min) {
      throw new BadRequestException(`Некорректное значение поля ${field}`);
    }
    if (max !== undefined && (value as number) > max) {
      throw new BadRequestException(`Некорректное значение поля ${field}`);
    }
  }

  /** isBlocked — boolean в NOT NULL-колонке: null/не-boolean → 400
   *  (иначе Postgres дал бы 500 invalid input syntax for type boolean). */
  private assertBooleanField(value: unknown, field: string): void {
    if (value === undefined) return;
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`Некорректное значение поля ${field}`);
    }
  }

  /** Проверки родителя для подзадачи при create/update.
   *  excludeId — id самой задачи: она не может быть родителем самой себе
   *  (актуально только для update, на create id ещё не существует).
   *  Вложенность ограничена одним уровнем: у родителя не должно быть
   *  своего родителя, иначе получится подзадача третьего уровня. */
  private async validateParent(parentTaskId: string, excludeId: string | null): Promise<void> {
    if (typeof parentTaskId !== 'string') {
      throw new BadRequestException('Некорректный id родительской задачи');
    }
    if (excludeId && parentTaskId === excludeId) {
      throw new BadRequestException('Задача не может быть подзадачей самой себя');
    }
    // parentTaskId — uuid-колонка: мусор формата дал бы 500
    // (invalid input syntax for type uuid), поэтому 400 до запроса.
    if (!UUID_RE.test(parentTaskId)) {
      throw new BadRequestException('Некорректный id родительской задачи');
    }
    const parent = await this.taskRepo.findOne({ where: { id: parentTaskId } });
    if (!parent) throw new NotFoundException('Родительская задача не найдена');
    if (parent.parentTaskId) {
      throw new BadRequestException('Подзадачи третьего уровня не поддерживаются');
    }
  }

  /** Санитизация причины блокировки (контракт A): trim, пустая → null,
   *  длиннее 500 → 400. Единая для create/update/bulk. Не-строка (число/
   *  объект из прямых вызовов) → 400, а не String()-коэрсия в БД. */
  private sanitizeBlockedReason(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return value ?? null;
    if (typeof value !== 'string') {
      throw new BadRequestException('Некорректная причина блокировки');
    }
    const trimmed = value.trim();
    if (trimmed.length > 500) {
      throw new BadRequestException('Причина блокировки слишком длинная (макс. 500 символов)');
    }
    return trimmed === '' ? null : trimmed;
  }

  /** Конвертация startDate/deadline из DTO: строка → Date, null/'' → null.
   *  Мусор → 400 (DTO IsDateString ловит это на HTTP-слое, здесь — страховка
   *  для прямых вызовов сервиса). Date-only 'YYYY-MM-DD' проверяем строгим
   *  round-trip: `new Date('2026-02-30')` молча откатывается в 2 марта,
   *  такая «дата» обязана дать 400, а не уехать в БД сдвинутой. */
  private parseStartDate(value: string | null | undefined, fieldName = 'startDate'): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string') {
      throw new BadRequestException(`Некорректная дата в поле ${fieldName}`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Некорректная дата в поле ${fieldName}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`Некорректная дата в поле ${fieldName}`);
    }
    return parsed;
  }

  /** Строгая дата спринта: тот же календарный round-trip, что parseStartDate
   *  ('2026-02-30' → 400, а не откат в март), но поле обязательное —
   *  null/undefined/''/мусор тоже 400 (у границ спринта нет detach-семантики).
   *  Сообщение задаёт вызывающий, чтобы create/update сохранили свои тексты. */
  private parseSprintDate(value: unknown, message: string): Date {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }
    const s = value.trim();
    const parsed = new Date(s);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(message);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && parsed.toISOString().slice(0, 10) !== s) {
      throw new BadRequestException(message);
    }
    return parsed;
  }

  /** Инвариант границ спринта: начало не позже окончания, иначе 400.
   *  Перевёрнутый спринт ломал бы burndown/period отчётов. */
  private assertSprintRange(start: Date, end: Date): void {
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('Дата начала спринта позже даты окончания');
    }
  }

  /** Проверка существования спринта для привязки задачи (контракт H).
   *  null/undefined — без привязки (ок), иначе спринт обязан существовать. */
  private async validateSprint(sprintId: string | null | undefined): Promise<void> {
    if (sprintId === undefined || sprintId === null) return;
    // sprintId — uuid-колонка: мусор формата дал бы 500, поэтому 400 до запроса.
    // Не-строка (число/объект) — тоже 400, а не RegExp-коэрсия.
    if (typeof sprintId !== 'string' || !UUID_RE.test(sprintId)) {
      throw new BadRequestException('Некорректный id спринта');
    }
    const sprint = await this.sprintRepo.findOne({ where: { id: sprintId } });
    if (!sprint) throw new BadRequestException('Спринт не найден');
  }

  async create(dto: CreateDevTaskDto, userId: string): Promise<DevTask> {
    // Прямые вызовы мимо DTO: null-тело/мусор в скалярах/enum/position/massive → 400 вместо 500.
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Некорректные данные задачи');
    }
    this.assertTaskEnums(dto);
    this.assertTitle(dto.title, true);
    this.assertDescription((dto as any).description);
    this.assertPosition(dto.position);
    this.assertIntField(dto.storyPoints, 'storyPoints', 0, 100);
    this.assertBooleanField(dto.isBlocked, 'isBlocked');
    this.assertTags(dto.tags);
    this.assertAttachments(dto.attachments);
    // parentTaskId: undefined/null — верхнеуровневая; '' и мусор → 400
    // (раньше '' пропускал `if (dto.parentTaskId)` и уходил в uuid-колонку 500-ой).
    if (dto.parentTaskId !== undefined && dto.parentTaskId !== null) {
      await this.validateParent(dto.parentTaskId, null);
    }
    // assigneeId/projectId: '' — тоже мусор формата → 400, а не тихая запись ''.
    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      await this.assertAssignee(dto.assigneeId);
    }
    // Связь с проектом «Разработка» — проверяем существование, чтобы
    // задача не повисла на несуществующем проекте, и тип проекта.
    if (dto.projectId !== undefined && dto.projectId !== null) {
      if (typeof dto.projectId !== 'string' || !UUID_RE.test(dto.projectId)) {
        throw new BadRequestException('Проект не найден');
      }
      const project = await this.projectRepo.findOne({ where: { id: dto.projectId } });
      if (!project) throw new BadRequestException('Проект не найден');
      if (!DEV_PROJECT_TYPES.includes(project.projectType)) {
        throw new BadRequestException('Проект не является проектом разработки');
      }
    }
    await this.validateSprint(dto.sprintId ?? null);
    // Санитизированные копии: tags trim/дедуп, attachments trim.
    const cleanTags = sanitizeTaskTags(dto.tags as unknown) as string[] | null;
    const cleanAttachments = sanitizeTaskAttachments(dto.attachments as unknown) as string[] | null;
    const task = this.taskRepo.create({
      ...dto,
      title: typeof dto.title === 'string' ? (dto.title as string).trim() : dto.title,
      description: typeof (dto as any).description === 'string'
        ? ((dto as any).description as string)
        : (dto as any).description,
      tags: cleanTags as any,
      // attachments NOT NULL в БД: null трактуем как «очистить» ([]),
      // а не роняем save 500-ой. Даты идут через строгий парсер:
      // '2026-02-30' даёт 400, а не откат в март.
      attachments: (cleanAttachments as any) === null ? [] : cleanAttachments,
      deadline: this.parseStartDate(dto.deadline ?? undefined, 'deadline') ?? null,
      startDate: this.parseStartDate(dto.startDate ?? undefined) ?? null,
      blockedReason: this.sanitizeBlockedReason(dto.blockedReason ?? undefined),
      sprintId: dto.sprintId ?? null,
      // Создание сразу в done (импорт/ретро-учёт): фиксируем дату
      // завершения, иначе задача не попадёт в KPI «в срок/не в срок».
      completedAt: dto.status === DevTaskStatus.DONE ? new Date() : null,
      createdById: userId,
    });
    const saved = await this.taskRepo.save(task);

    // Поставили задачу человеку — он должен узнать сразу, а не когда
    // случайно заглянет на доску.
    await this.notifyTaskAssigned(saved.assigneeId, userId, saved, 'created');
    this.broadcast();
    // Перечитываем, чтобы eager-связи (assignee/createdBy) вернулись заполненными.
    const detail = await this.findOne(saved.id);
    // Outbox вебхуков (контракт E): тихо, мутацию не роняет.
    await this.emitDevEvent('task.created', detail);
    return detail;
  }

  async update(id: string, dto: UpdateDevTaskDto, actorId?: string): Promise<DevTask> {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Некорректные данные задачи');
    }
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');

    // Прямые вызовы мимо DTO: скаляры/enum/position/massive/FK-формат → 400 вместо 500.
    this.assertTaskEnums(dto);
    this.assertTitle(dto.title, false);
    this.assertDescription((dto as any).description);
    this.assertPosition(dto.position);
    this.assertIntField((dto as any).storyPoints, 'storyPoints', 0, 100);
    this.assertBooleanField((dto as any).isBlocked, 'isBlocked');
    this.assertTags(dto.tags);
    this.assertAttachments(dto.attachments);
    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      await this.assertAssignee(dto.assigneeId);
    }
    if (dto.projectId !== undefined && dto.projectId !== null) {
      if (typeof dto.projectId !== 'string' || !UUID_RE.test(dto.projectId)) {
        throw new BadRequestException('Проект не найден');
      }
    }

    const oldAssigneeId = task.assigneeId;
    const wasDone = task.status === DevTaskStatus.DONE;

    // deadline/startDate в DTO — строки (IsDateString), в entity — Date:
    // исключаем их, parentTaskId, projectId, sprintId и blockedReason из
    // спреда и конвертируем отдельно.
    // undefined = поле не передано (не менять), null = открепить/сбросить.
    const { deadline, startDate, parentTaskId, projectId, sprintId, blockedReason, tags, attachments, title, ...rest } = dto as any;
    const patch: Partial<DevTask> = { ...rest };
    // title trim перед записью (assertTitle уже проверил непустоту после trim).
    if (title !== undefined) {
      (patch as any).title = typeof title === 'string' ? title.trim() : title;
    }
    // tags/attachments — санитизированные копии (trim/дедуп/капы/URL),
    // иначе грязные теги оседали бы в text[] как есть.
    if (tags !== undefined) {
      (patch as any).tags = sanitizeTaskTags(tags) as any;
    }
    // attachments NOT NULL в БД: null = «очистить» ([]), undefined = не менять.
    if (attachments !== undefined) {
      const clean = sanitizeTaskAttachments(attachments) as any;
      (patch as any).attachments = clean === null ? [] : clean;
    }
    if (deadline !== undefined) {
      // Строгий парсер: мусор/невозможный календарный день → 400, ''/null → detach.
      patch.deadline = this.parseStartDate(deadline as string | null, 'deadline');
    }
    if (startDate !== undefined) {
      patch.startDate = this.parseStartDate(startDate);
    }
    if (blockedReason !== undefined) {
      patch.blockedReason = this.sanitizeBlockedReason(blockedReason);
    }
    if (sprintId !== undefined) {
      if (sprintId === null) {
        patch.sprintId = null;
      } else {
        await this.validateSprint(sprintId);
        patch.sprintId = sprintId;
      }
    }
    if (parentTaskId !== undefined) {
      if (parentTaskId === null) {
        patch.parentTaskId = null;
      } else {
        await this.validateParent(parentTaskId, id);
        patch.parentTaskId = parentTaskId;
      }
    }
    if (projectId !== undefined) {
      if (projectId === null) {
        patch.projectId = null;
      } else {
        const project = await this.projectRepo.findOne({ where: { id: projectId } });
        if (!project) throw new BadRequestException('Проект не найден');
        if (!DEV_PROJECT_TYPES.includes(project.projectType)) {
          throw new BadRequestException('Проект не является проектом разработки');
        }
        patch.projectId = projectId;
      }
    }
    // Смена статуса через обычный PATCH тоже обязана вести completedAt,
    // иначе часть задач «завершится» мимо KPI.
    if (dto.status !== undefined && dto.status !== task.status) {
      patch.completedAt = dto.status === DevTaskStatus.DONE ? new Date() : null;
    }
    await this.taskRepo.update(id, patch);

    // История изменений (тихо, не роняет мутацию): status/assignee/priority/deadline/title.
    // from/to — строкой, для assignee — id или null, для deadline — ISO или null.
    if (dto.status !== undefined && dto.status !== task.status) {
      await this.logHistory(id, actorId ?? null, 'status', task.status, dto.status);
    }
    if ((dto as any).assigneeId !== undefined) {
      const fromA = (task.assigneeId ?? null) as string | null;
      const toA = ((dto as any).assigneeId ?? null) as string | null;
      if (fromA !== toA) {
        await this.logHistory(id, actorId ?? null, 'assignee', fromA, toA);
      }
    }
    if ((dto as any).priority !== undefined && (dto as any).priority !== task.priority) {
      await this.logHistory(id, actorId ?? null, 'priority', String(task.priority), String((dto as any).priority));
    }
    if (deadline !== undefined) {
      const fromD = this.historyDateStr(task.deadline);
      const toD = deadline ? this.historyDateStr(new Date(deadline as string)) : null;
      if (fromD !== toD) {
        await this.logHistory(id, actorId ?? null, 'deadline', fromD, toD);
      }
    }
    if ((dto as any).title !== undefined && (dto as any).title !== task.title) {
      await this.logHistory(id, actorId ?? null, 'title', task.title, String((dto as any).title));
    }
    // Контракт A: смена флага блокировки — поле 'blocked', from/to 'да'/'нет'.
    if ((dto as any).isBlocked !== undefined && (dto as any).isBlocked !== (task as any).isBlocked) {
      await this.logHistory(
        id, actorId ?? null, 'blocked',
        (task as any).isBlocked ? 'да' : 'нет',
        (dto as any).isBlocked ? 'да' : 'нет',
      );
    }
    // Контракт H: смена спринта — поле 'sprint', from/to — id или null.
    if (sprintId !== undefined) {
      const fromS = ((task as any).sprintId ?? null) as string | null;
      const toS = (sprintId ?? null) as string | null;
      if (fromS !== toS) {
        await this.logHistory(id, actorId ?? null, 'sprint', fromS, toS);
      }
    }

    // Уведомления о переназначении и завершении (актору самому — не шлём).
    if (actorId) {
      if (dto.assigneeId && dto.assigneeId !== oldAssigneeId) {
        await this.notifyTaskAssigned(dto.assigneeId, actorId, task, 'assigned');
      }
      if (!wasDone && patch.completedAt) {
        await this.notifyTaskDone(task, actorId);
      }
    }
    this.broadcast();
    const updated = await this.findOne(id);
    // Outbox вебхуков (контракт E): переход в done через PATCH — task.done.
    // Прочие PATCH-правки отдельного события не имеют и не рассылаются.
    // Статус подмешиваем явно — payload отражает именно этот переход.
    if (!wasDone && (dto as any).status === DevTaskStatus.DONE) {
      await this.emitDevEvent('task.done', { ...updated, status: DevTaskStatus.DONE });
    }
    return updated;
  }

  /** Перемещение карточки канбана (drag-and-drop): новая колонка + позиция.
   *  Отдельный метод, а не PATCH, потому что это единственная операция,
   *  доступная исполнителю без права dev-tracker.manage. */
  async move(id: string, status: DevTaskStatus, position?: number, actorId?: string): Promise<DevTask> {
    if (status === undefined || status === null) {
      throw new BadRequestException('Статус обязателен');
    }
    if (!(Object.values(DevTaskStatus) as string[]).includes(status)) {
      throw new BadRequestException('Неизвестный статус');
    }
    if (position !== undefined) {
      if (!Number.isInteger(position) || position < 0) {
        throw new BadRequestException('Некорректная позиция');
      }
    }
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');
    const oldStatus = task.status;

    const patch: Partial<DevTask> = { status };
    if (position !== undefined) {
      patch.position = position;
    }
    if (status === DevTaskStatus.DONE && task.status !== DevTaskStatus.DONE) {
      // Фиксируем факт завершения — база для KPI «в срок/не в срок».
      patch.completedAt = new Date();
    } else if (status !== DevTaskStatus.DONE && task.status === DevTaskStatus.DONE) {
      // Переоткрытие: сбрасываем дату завершения, иначе задача навсегда
      // останется «выполненной» в статистике.
      patch.completedAt = null;
    }
    await this.taskRepo.update(id, patch);

    // История смены статуса (тихо).
    if (oldStatus !== status) {
      await this.logHistory(id, actorId ?? null, 'status', oldStatus, status);
    }

    // Исполнителю полезно знать, что его задачу кто-то подвинул (например,
    // руководитель взял на ревью или вернул из тестирования). Автору задачи —
    // что её завершили. Самому актору уведомления не нужны.
    if (actorId && oldStatus !== status) {
      if (status === DevTaskStatus.DONE) {
        await this.notifyTaskDone(task, actorId);
      } else if (task.assigneeId && task.assigneeId !== actorId) {
        const actor = await this.userName(actorId);
        // Дедуп drag туда-сюда: часовой бакет в ключе + окно 1 час,
        // иначе каждое перетаскивание спамит исполнителю.
        const hourKey = new Date().toISOString().slice(0, 13);
        await this.notifyDedupSafe(
          {
            userId: task.assigneeId,
            type: NotificationType.STATUS_CHANGE,
            title: 'Статус задачи обновлён',
            message: `${actor}: «${task.title}» → ${STATUS_LABELS[status] ?? status}`,
            link: `/dev-board/task/${task.id}`,
            data: { alertKey: `dev-move-${task.id}-${status}-${hourKey}` },
          },
          1,
        );
      }
    }
    this.broadcast();
    const moved = await this.findOne(id);
    // Outbox вебхуков (контракт E): переход в done — task.done, иначе task.moved.
    // Новый статус подмешиваем явно: перечитанный detail в теории уже свежий,
    // но payload обязан отражать именно этот переход, а не гонку чтения.
    await this.emitDevEvent(
      status === DevTaskStatus.DONE && oldStatus !== DevTaskStatus.DONE ? 'task.done' : 'task.moved',
      { ...moved, status },
    );
    return moved;
  }

  async addComment(
    taskId: string,
    authorId: string,
    text: string,
    mentions?: string[],
  ): Promise<DevTaskComment & { mentions: string[] }> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');

    // Пустые комментарии и простыни — не пропускаем. typeof вместо
    // (text ?? ''): число/объект роняли бы .trim() 500-ой вместо 400.
    if (typeof text !== 'string' || !text.trim()) {
      throw new BadRequestException('Комментарий не может быть пустым');
    }
    const clean = text.trim();
    if (clean.length > 5000) throw new BadRequestException('Комментарий слишком длинный (макс. 5000 символов)');

    // mentions санитизируем: массив UUID, max 20. Ответ содержит mentions как пришёл
    // (после санитизации) — отдельного столбца нет, только эхо в ответе + уведомления.
    const cleanMentions = this.sanitizeMentions(mentions);

    const comment = this.commentRepo.create({ taskId, authorId, text: clean });
    const saved = await this.commentRepo.save(comment);

    // Уведомляем исполнителя, автора задачи и упомянутых (кроме самого комментатора).
    // Дедуп через Set: одному человеку — одно уведомление, даже если он и
    // исполнитель, и упомянутый.
    const recipients = new Set<string>();
    if (task.assigneeId) recipients.add(task.assigneeId);
    if (task.createdById) recipients.add(task.createdById);
    for (const m of cleanMentions) recipients.add(m);
    recipients.delete(authorId);
    if (recipients.size > 0) {
      const author = await this.userName(authorId);
      for (const userId of recipients) {
        await this.notifySafe({
          userId,
          type: NotificationType.TASK_COMMENT,
          title: 'Новый комментарий',
          message: `${author} — «${task.title}»: ${clean.slice(0, 120)}`,
          link: `/dev-board/task/${taskId}`,
        });
      }
    }
    this.broadcast();
    // Outbox вебхуков (контракт E): новый комментарий — task.commented.
    await this.emitDevEvent('task.commented', task);
    // Автор — безопасной ссылкой (id/имя/аватар), не всей сущностью User:
    // у comment.author стоит eager, иначе наружу утекал бы hash пароля.
    return {
      ...saved,
      author: (saved as any).author ? this.mapAvatar((saved as any).author) : null,
      mentions: cleanMentions,
    };
  }

  /** Массовые операции из табличного вида (Notion-style bulk edit).
   *  Только для dev-tracker.manage: массово менять чужие карточки —
   *  действие руководителя. */
  async bulk(
    ids: string[],
    action: 'status' | 'priority' | 'assignee' | 'deadline' | 'blocked' | 'delete',
    value: string,
    actorId?: string,
  ): Promise<{ updated: number; deleted: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Не выбраны задачи');
    }
    if (ids.length > 100) throw new BadRequestException('За раз можно изменить не более 100 задач');
    // ids — uuid-колонка: мусор формата дал бы 500 (invalid input syntax for
    // type uuid), поэтому 400 до запроса. Дедуп: дубли не должны раздувать
    // работу (N update на один id) и путают подсчёт updated.
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        throw new BadRequestException('Некорректный id задачи');
      }
    }
    // value обязан быть строкой (detach — ''/null/undefined для assignee/
    // deadline/blocked). Число/объект из прямых вызовов → 400, а не коэрсия.
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new BadRequestException('Некорректное значение');
    }
    // Несуществующие id игнорируются (частичный успех): updated/deleted
    // считают только реально затронутые строки, 404 на пачку не кидаем.
    // Неатомарно: каждая задача обновляется своим UPDATE (см. остаточные риски).
    const normIds = uniqueIds;

    if (action === 'delete') {
      const res = await this.taskRepo.delete({ id: In(normIds) });
      // Чистка уведомлений вторична и идемпотентна — параллельно,
      // исход удаления не меняет, мутацию не роняет.
      await Promise.allSettled(normIds.map(delId => this.cleanupNotifications(delId)));
      this.broadcast();
      return { updated: 0, deleted: res.affected ?? 0 };
    }

    if (action === 'status') {
      if (typeof value !== 'string' || !(Object.values(DevTaskStatus) as string[]).includes(value)) {
        throw new BadRequestException('Неизвестный статус');
      }
      const status = value as DevTaskStatus;
      const now = new Date();
      // completedAt ведём так же, как в move: ставим при завершении,
      // сбрасываем при переоткрытии, не трогаем при прочих переходах.
      const tasks = await this.taskRepo.find({ where: { id: In(normIds) } });
      let updated = 0;
      const changedIds = new Set<string>();
      for (const task of tasks) {
        if (task.status === status) continue;
        const completedAt =
          status === DevTaskStatus.DONE ? now
          : task.status === DevTaskStatus.DONE ? null
          : task.completedAt;
        await this.taskRepo.update(task.id, { status, completedAt });
        // История по каждой найденной задаче, тихо (logHistory глотает ошибки).
        await this.logHistory(task.id, actorId ?? null, 'status', task.status, status);
        changedIds.add(task.id);
        updated++;
      }
      // bulk intentionally quiet — не спамим уведомлениями при массовых
      // сменах статуса (иначе N задач × получатели = спам); сводное
      // уведомление для bulk done — на усмотрение фронта по ответу { updated }.
      this.broadcast();
      // Outbox вебхуков (контракт E): переход в done — task.done, иначе task.moved.
      // Подписки читаем один раз на весь bulk: иначе N задач × find — N+1.
      const subs = await this.fetchActiveSubs();
      const ev = status === DevTaskStatus.DONE ? 'task.done' : 'task.moved';
      await Promise.all(
        (tasks ?? [])
          .filter(t => t?.id && changedIds.has(t.id))
          .map(t => this.deliverEvent(ev, { ...t, status }, subs)),
      );
      return { updated, deleted: 0 };
    }

    if (action === 'assignee') {
      // '' = снять исполнителя (null), иначе — UUID исполнителя.
      // bulk intentionally quiet — без уведомлений при массовых назначениях.
      // Историю пишем по каждой найденной задаче, тихо.
      if (value === '' || value === undefined || value === null) {
        const found = await this.taskRepo.find({ where: { id: In(normIds) } });
        const res = await this.taskRepo.update({ id: In(normIds) }, { assigneeId: null });
        for (const t of found) {
          if ((t.assigneeId ?? null) !== null) {
            await this.logHistory(t.id, actorId ?? null, 'assignee', t.assigneeId ?? null, null);
          }
        }
        this.broadcast();
        return { updated: res.affected ?? 0, deleted: 0 };
      }
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        throw new BadRequestException('Исполнитель не найден');
      }
      const assignee = await this.userRepo.findOne({ where: { id: value } });
      if (!assignee) throw new BadRequestException('Исполнитель не найден');
      const foundA = await this.taskRepo.find({ where: { id: In(normIds) } });
      const res = await this.taskRepo.update({ id: In(normIds) }, { assigneeId: value });
      for (const t of foundA) {
        if ((t.assigneeId ?? null) !== value) {
          await this.logHistory(t.id, actorId ?? null, 'assignee', t.assigneeId ?? null, value);
        }
      }
      this.broadcast();
      return { updated: res.affected ?? 0, deleted: 0 };
    }

    if (action === 'deadline') {
      // '' = очистить дедлайн (null), иначе — 'YYYY-MM-DD'.
      // bulk intentionally quiet — без уведомлений при массовых сменах дедлайна.
      // Историю пишем по каждой найденной задаче, тихо.
      if (value === '' || value === undefined || value === null) {
        const found = await this.taskRepo.find({ where: { id: In(normIds) } });
        const res = await this.taskRepo.update({ id: In(normIds) }, { deadline: null });
        for (const t of found) {
          const fromD = this.historyDateStr(t.deadline);
          if (fromD !== null) {
            await this.logHistory(t.id, actorId ?? null, 'deadline', fromD, null);
          }
        }
        this.broadcast();
        return { updated: res.affected ?? 0, deleted: 0 };
      }
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('Некорректная дата');
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException('Некорректная дата');
      }
      const foundD = await this.taskRepo.find({ where: { id: In(normIds) } });
      const res = await this.taskRepo.update({ id: In(normIds) }, { deadline: parsed });
      const toD = this.historyDateStr(parsed);
      for (const t of foundD) {
        const fromD = this.historyDateStr(t.deadline);
        if (fromD !== toD) {
          await this.logHistory(t.id, actorId ?? null, 'deadline', fromD, toD);
        }
      }
      this.broadcast();
      return { updated: res.affected ?? 0, deleted: 0 };
    }

    if (action === 'blocked') {
      // Контракт A: '' (после trim) = снять блокировку, иначе строка-причина.
      // Длиннее 500 → 400. История — поле 'blocked', from/to 'да'/'нет'.
      // bulk intentionally quiet — без уведомлений, только история.
      const reason = this.sanitizeBlockedReason((value as any) ?? '');
      const found = await this.taskRepo.find({ where: { id: In(normIds) } });
      if (reason === null) {
        const res = await this.taskRepo.update(
          { id: In(normIds) },
          { isBlocked: false, blockedReason: null } as Partial<DevTask>,
        );
        for (const t of found ?? []) {
          if ((t as any).isBlocked) {
            await this.logHistory(t.id, actorId ?? null, 'blocked', 'да', 'нет');
          }
        }
        this.broadcast();
        return { updated: res.affected ?? 0, deleted: 0 };
      }
      const res = await this.taskRepo.update(
        { id: In(normIds) },
        { isBlocked: true, blockedReason: reason } as Partial<DevTask>,
      );
      for (const t of found ?? []) {
        if (!(t as any).isBlocked) {
          await this.logHistory(t.id, actorId ?? null, 'blocked', 'нет', 'да');
        }
      }
      this.broadcast();
      return { updated: res.affected ?? 0, deleted: 0 };
    }

    // priority — единственный оставшийся экшен: неизвестную строку
    // отклоняем явным 400 (раньше она проваливалась в проверку приоритета
    // с вводящим в заблуждение текстом «Неизвестный приоритет»).
    if ((action as string) !== BulkDevTaskAction.PRIORITY) {
      throw new BadRequestException('Неизвестное действие');
    }
    if (typeof value !== 'string' || !(Object.values(DevTaskPriority) as string[]).includes(value)) {
      throw new BadRequestException('Неизвестный приоритет');
    }
    const res = await this.taskRepo.update({ id: In(normIds) }, { priority: value as DevTaskPriority });
    this.broadcast();
    return { updated: res.affected ?? 0, deleted: 0 };
  }

  async remove(id: string): Promise<{ message: string }> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.taskRepo.remove(task);
    await this.cleanupNotifications(id);
    this.broadcast();
    return { message: 'Задача удалена' };
  }

  /** История изменений задачи — контракт GET /dev-tracker/:id/history:
   *  [{id, field, from, to, actor: {id,name}|null, createdAt}], сортировка ASC.
   *  Читаем последние 1000 (DESC + take), отдаём в хронологическом порядке:
   *  без лимита одна «долгоживущая» задача растянет ответ. */
  async getHistory(taskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    const rows = await this.historyRepo.find({
      where: { taskId },
      order: { createdAt: 'DESC' },
      take: 1000,
      relations: { actor: true },
    });
    const asc = [...(rows ?? [])].reverse();
    return asc.map(r => ({
      id: r.id,
      field: r.field,
      from: r.from ?? null,
      to: r.to ?? null,
      actor: (r as any).actor ? { id: (r as any).actor.id, name: (r as any).actor.name } : null,
      createdAt: r.createdAt,
    }));
  }

  /** Клонирование задачи: новая задача с title `<orig> (копия)`, status backlog,
   *  completedAt null, остальные поля — как у оригинала. withSubtasks — копии
   *  прямых детей новыми id (title те же, parent=new). Возврат — detail как findOne.
   *  DoS-кап: детей больше DEV_CLONE_MAX_SUBTASKS → 400 (иначе 1000 INSERT). */
  async clone(id: string, userId: string, withSubtasks?: boolean): Promise<DevTaskDetail> {
    if (withSubtasks !== undefined && typeof withSubtasks !== 'boolean') {
      throw new BadRequestException('Некорректный флаг withSubtasks');
    }
    const orig = await this.taskRepo.findOne({ where: { id } });
    if (!orig) throw new NotFoundException('Задача не найдена');
    const copy = this.taskRepo.create({
      title: `${orig.title} (копия)`,
      description: orig.description,
      status: DevTaskStatus.BACKLOG,
      priority: orig.priority,
      taskType: (orig as any).taskType,
      position: 0,
      // safeStoryPoints: битая оценка оригинала (NaN) не должна ронять INSERT
      // 500-ой на int-колонке — копия стартует с 0.
      storyPoints: safeStoryPoints((orig as any).storyPoints),
      tags: (orig as any).tags ? [...(orig as any).tags] : (orig as any).tags,
      attachments: (orig as any).attachments ? [...(orig as any).attachments] : [],
      deadline: orig.deadline,
      startDate: (orig as any).startDate ?? null,
      // Копия — новая работа: блокер не переносим, спринт сохраняем.
      isBlocked: false,
      blockedReason: null,
      sprintId: (orig as any).sprintId ?? null,
      completedAt: null,
      assigneeId: orig.assigneeId,
      projectId: (orig as any).projectId ?? null,
      parentTaskId: null,
      createdById: userId,
    } as Partial<DevTask>);
    const saved = await this.taskRepo.save(copy);

    if (withSubtasks) {
      const children = (await this.taskRepo.find({ where: { parentTaskId: id } })) ?? [];
      if (children.length > DEV_CLONE_MAX_SUBTASKS) {
        throw new BadRequestException(
          `Слишком много подзадач для клонирования (макс. ${DEV_CLONE_MAX_SUBTASKS})`,
        );
      }
      for (const child of children) {
        // Копия ребёнка — тоже новая работа: статус backlog, completedAt null,
        // блокер снят (как у родительской копии). Спринт/startDate сохраняем
        // с самого ребёнка, иначе копия теряет его планирование.
        const childCopy = this.taskRepo.create({
          title: child.title,
          description: child.description,
          status: DevTaskStatus.BACKLOG,
          priority: child.priority,
          taskType: (child as any).taskType,
          position: (child as any).position ?? 0,
          // safeStoryPoints — как у родительской копии выше.
          storyPoints: safeStoryPoints((child as any).storyPoints),
          tags: (child as any).tags ? [...(child as any).tags] : (child as any).tags,
          attachments: (child as any).attachments ? [...(child as any).attachments] : [],
          deadline: child.deadline,
          startDate: (child as any).startDate ?? null,
          isBlocked: false,
          blockedReason: null,
          sprintId: (child as any).sprintId ?? null,
          completedAt: null,
          assigneeId: child.assigneeId,
          projectId: (child as any).projectId ?? null,
          parentTaskId: (saved as any).id,
          createdById: userId,
        } as Partial<DevTask>);
        await this.taskRepo.save(childCopy);
      }
    }

    // Уведомление исполнителю копии — как в create (ему поставили задачу).
    await this.notifyTaskAssigned(
      (saved as any).assigneeId,
      userId,
      { id: (saved as any).id, title: (saved as any).title },
      'created',
    );
    this.broadcast();
    return this.findOne((saved as any).id);
  }

  /** KPI по исполнителям + общие итоги по команде.
   *
   *  Считаем в JS, а не SQL-агрегациями: объём доски разработки — сотни
   *  задач, а так код метрик читается и тестируется проще, чем raw SQL.
   *
   *  Метрики:
   *   - total / done / inProgress (строго статус in_progress — как pie
   *     на фронте: done / inProgress / остальные; review/testing сидят
   *     в «остальных») / overdue (дедлайн РАНЬШЕ начала СЕГОДНЯШНЕГО дня
   *     по Asia/Dushanbe — та же граница, что scheduler/triageOverdue
   *     и фронт isDevTaskOverdue (день < сегодня); статус ≠ done)
   *   - doneOnTime (день завершения по Душанбе ≤ дня дедлайна по Душанбе:
   *     день дедлайна — включительно) / doneLate
   *   - onTimeRate — доля завершённых в срок среди завершённых с дедлайном
   *     (валидные даты; иначе null)
   *   - avgCycleDays — среднее (completedAt − createdAt) по задачам,
   *     завершённым за последние 30 дней (валидные даты; иначе null).
   *   - velocity: 6 недель по completedAt — [{week (понедельник YYYY-MM-DD
   *     ПО ДУШАНБЕ), points (сумма storyPoints), count}]. Недели — последние
   *     6 включая текущую.
   *   - burndown: 30 дней по Душанбе — [{day (YYYY-MM-DD), created (дневные
   *     по createdAt), done (дневные по completedAt, только DONE),
   *     open (НАКОПИТЕЛЬНЫЙ: создано на/до дня минус завершено на/до дня,
   *     не ниже 0)}]. created/done — дневные, open — накопительный,
   *     фронт может сам накапливать created/done, но open уже посчитан для удобства. */
  async getKpi() {
    const tasks = await this.taskRepo.find();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // Граница «сегодня» — по Душанбе, как в dev-deadline.scheduler.ts
    // и triageOverdue: deadline < todayStart = просрочка.
    const todayStart = dushanbeTodayStart(now);

    const buildStats = (list: DevTask[]) => {
      const total = list.length;
      const done = list.filter(t => t.status === DevTaskStatus.DONE).length;
      const inProgress = list.filter(t => t.status === DevTaskStatus.IN_PROGRESS).length;
      const overdue = list.filter(t => {
        if (!t.deadline || t.status === DevTaskStatus.DONE) return false;
        const d = new Date(t.deadline).getTime();
        return !Number.isNaN(d) && d < todayStart.getTime();
      }).length;

      // «В срок/не в срок» имеет смысл только для задач, у которых был
      // дедлайн — без дедлайна сравнивать не с чем. Битые даты из
      // знаменателя исключаем: судить «в срок» по мусору нельзя
      // (раньше мусор падал в doneLate).
      const doneWithDeadline = list.filter(t => {
        if (t.status !== DevTaskStatus.DONE || !t.deadline || !t.completedAt) return false;
        const d = new Date(t.deadline).getTime();
        const c = new Date(t.completedAt).getTime();
        return !Number.isNaN(d) && !Number.isNaN(c);
      });
      // Граница «в срок» — календарный день по Душанбе: завершение в день
      // дедлайна (включительно) считается в срок. Instant-сравнение
      // (completedAt ≤ deadline) метило late любую задачу с date-only
      // дедлайном (полночь UTC), закрытую в течение дня дедлайна.
      const doneOnTime = doneWithDeadline.filter(
        t => dushanbeDayKey(t.completedAt) <= dushanbeDayKey(t.deadline),
      ).length;
      const doneLate = doneWithDeadline.length - doneOnTime;
      const onTimeRate = doneWithDeadline.length
        ? Math.round((doneOnTime / doneWithDeadline.length) * 100)
        : null;

      // Цикл «создание → завершение» — только по свежим (30 дней) задачам,
      // чтобы старые задачи не тянули среднее при изменении процессов.
      // Битые даты отсекаем: раньше один битый createdAt отравлял всё
      // среднее в NaN (контракт обещает number|null).
      const recentDone = list.filter(t => {
        if (t.status !== DevTaskStatus.DONE || !t.completedAt) return false;
        const c = new Date(t.completedAt).getTime();
        return !Number.isNaN(c) && c >= thirtyDaysAgo.getTime();
      });
      const cycleBase = recentDone.filter(
        t => !Number.isNaN(new Date(t.createdAt).getTime()),
      );
      let avgCycleDays: number | null = null;
      if (cycleBase.length) {
        const raw =
          Math.round(
            (cycleBase.reduce(
              (sum, t) => sum + (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()),
              0,
            ) / cycleBase.length / (24 * 60 * 60 * 1000)) * 10,
          ) / 10;
        avgCycleDays = Number.isFinite(raw) ? raw : null;
      }

      return { total, done, inProgress, overdue, doneOnTime, doneLate, onTimeRate, avgCycleDays };
    };

    // Группировка по исполнителю. Задачи без исполнителя в разрез людей
    // не попадают, но учитываются в общих итогах команды.
    const byAssignee = new Map<string, DevTask[]>();
    for (const task of tasks) {
      if (!task.assigneeId) continue;
      const list = byAssignee.get(task.assigneeId) || [];
      list.push(task);
      byAssignee.set(task.assigneeId, list);
    }

    // Контракт с фронтом: массив members с полем avatarUrl (в сущности User
    // колонка называется avatar — мапим здесь, чтобы фронт не знал про это).
    const members = [...byAssignee.entries()].map(([assigneeId, list]) => {
      const user = list[0].assignee; // eager-связь: имя и аватар уже здесь
      return {
        assigneeId,
        name: user?.name ?? null,
        avatarUrl: user?.avatar ?? null,
        ...buildStats(list),
      };
    });

    // velocity: 6 недель по completedAt (только DONE с completedAt).
    // week — понедельник недели (YYYY-MM-DD ПО ДУШАНБЕ), points — сумма
    // storyPoints (битые → 0, иначе NaN травил неделю), count — число
    // завершённых. Пустые недели — нули, на пустых задачах — 6 нулей.
    const mondayOf = dushanbeMondayOf;
    const velocityWeeks: string[] = (() => {
      const base = new Date(mondayOf(now) + 'T00:00:00.000Z');
      const arr: string[] = [];
      for (let i = 5; i >= 0; i--) {
        arr.push(new Date(base.getTime() - i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      }
      return arr;
    })();
    const velocityMap = new Map<string, { points: number; count: number }>();
    for (const w of velocityWeeks) velocityMap.set(w, { points: 0, count: 0 });
    for (const t of tasks) {
      if (t.status !== DevTaskStatus.DONE || !t.completedAt) continue;
      try {
        const wk = mondayOf(new Date(t.completedAt));
        const entry = velocityMap.get(wk);
        if (entry) {
          entry.count += 1;
          entry.points += safeStoryPoints((t as any).storyPoints);
        }
      } catch {
        // битая дата — пропускаем задачу в velocity
      }
    }
    const velocity = velocityWeeks.map(week => ({
      week,
      points: velocityMap.get(week)!.points,
      count: velocityMap.get(week)!.count,
    }));

    // burndown: 30 дней по Душанбе. created/done — ДНЕВНЫЕ
    // (по createdAt/completedAt в календаре Asia/Dushanbe), open —
    // НАКОПИТЕЛЬНЫЙ (создано на/до дня минус завершено на/до дня, не ниже 0,
    // включая задачи вне окна — иначе старые задачи исказили бы базу).
    // done считаем только для DONE: несброшенный completedAt у открытой
    // задачи (legacy/гонка) — не завершение. Битые даты пропускаем.
    const burndownDays: string[] = (() => {
      const todayStartUtc = new Date(dushanbeDayKey(now) + 'T00:00:00.000Z');
      const arr: string[] = [];
      for (let i = 29; i >= 0; i--) {
        arr.push(new Date(todayStartUtc.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      }
      return arr;
    })();
    const createdByDay = new Map<string, number>();
    const doneByDay = new Map<string, number>();
    for (const d of burndownDays) {
      createdByDay.set(d, 0);
      doneByDay.set(d, 0);
    }
    let createdBefore = 0;
    let doneBefore = 0;
    const firstDay = burndownDays[0];
    for (const t of tasks) {
      try {
        if ((t as any).createdAt) {
          const k = dushanbeDayKey((t as any).createdAt);
          if (k < firstDay) createdBefore++;
          else if (createdByDay.has(k)) createdByDay.set(k, createdByDay.get(k)! + 1);
        }
        if ((t as any).status === DevTaskStatus.DONE && (t as any).completedAt) {
          const k = dushanbeDayKey((t as any).completedAt);
          if (k < firstDay) doneBefore++;
          else if (doneByDay.has(k)) doneByDay.set(k, doneByDay.get(k)! + 1);
        }
      } catch {
        // битая дата — пропускаем в burndown
      }
    }
    let cumCreated = createdBefore;
    let cumDone = doneBefore;
    const burndown = burndownDays.map(day => {
      cumCreated += createdByDay.get(day)!;
      cumDone += doneByDay.get(day)!;
      return {
        day,
        created: createdByDay.get(day)!,
        done: doneByDay.get(day)!,
        open: Math.max(0, cumCreated - cumDone),
      };
    });

    // Контракт I: slaBreached — открытые задачи, нарушившие SLA.
    // Добавляем только в team: старые ключи KPI (включая members) не трогаем.
    const slaBreached = tasks.filter(t => this.isSlaBreached(t, now)).length;

    return { team: { ...buildStats(tasks), slaBreached }, members, velocity, burndown };
  }

  /** Нарушила ли открытая задача SLA (контракт I).
   *  DONE — никогда (закрыта). С дедлайном — нарушает ровно когда просрочена
   *  (deadline < начала СЕГОДНЯШНЕГО дня по Asia/Dushanbe — та же граница,
   *  что overdue в getKpi, scheduler и фронт isDevTaskOverdue).
   *  Без дедлайна — когда возраст от createdAt превысил порог приоритета
   *  DEV_SLA_THRESHOLDS_DAYS. Битые даты — не считаем нарушением. */
  private isSlaBreached(task: DevTask, now: Date): boolean {
    if (!task || task.status === DevTaskStatus.DONE) return false;
    if ((task as any).deadline) {
      const d = new Date((task as any).deadline).getTime();
      if (Number.isNaN(d)) return false;
      return d < dushanbeTodayStart(now).getTime();
    }
    if (!(task as any).createdAt) return false;
    const created = new Date((task as any).createdAt).getTime();
    if (Number.isNaN(created)) return false;
    const threshold =
      DEV_SLA_THRESHOLDS_DAYS[(task as any).priority] ?? DEV_SLA_THRESHOLDS_DAYS[DevTaskPriority.MEDIUM];
    return (now.getTime() - created) / (24 * 60 * 60 * 1000) > threshold;
  }

  /** Триаж просрочки (контракт C): назначает просроченные задачи на assigneeId
   *  (default — актор). Просрочка = deadline < начала СЕГОДНЯШНЕГО дня
   *  Asia/Dushanbe, status != done. Тихо: без уведомлений, но с logHistory
   *  (поле 'assignee'). Невалидный assigneeId (не UUID или нет юзера) → 400.
   *  Право manage проверяет контроллер. Возврат — {assigned}. */
  async triageOverdue(
    opts: { assigneeId?: string; projectId?: string },
    actorId: string,
  ): Promise<{ assigned: number }> {
    // opts обязан быть объектом: строка/массив из прямых вызовов → 400,
    // а не молчаливое использование actorId.
    if (opts !== undefined && opts !== null && (typeof opts !== 'object' || Array.isArray(opts))) {
      throw new BadRequestException('Некорректные параметры триажа');
    }
    const rawAssignee = (opts as any)?.assigneeId ?? actorId ?? '';
    // Не-строка (число/объект) раньше роняла .trim() 500-ой.
    if (typeof rawAssignee !== 'string') {
      throw new BadRequestException('Исполнитель не найден');
    }
    const target = rawAssignee.trim();
    if (!target) {
      throw new BadRequestException('Исполнитель не найден');
    }
    await this.assertAssignee(target);
    // projectId — опциональный скоуп: мусор формата → 400, а не тихий assigned:0.
    const rawProject = (opts as any)?.projectId;
    let scopeProjectId: string | null = null;
    if (rawProject !== undefined && rawProject !== null && rawProject !== '') {
      if (typeof rawProject !== 'string' || !UUID_RE.test(rawProject)) {
        throw new BadRequestException('Некорректный projectId (нужен UUID)');
      }
      scopeProjectId = rawProject;
    }

    // Граница «сегодня» — по Душанбе, как в dev-deadline.scheduler.ts:
    // Asia/Dushanbe = UTC+5 круглый год (без DST), полночь выражаем явным
    // офсетом +05:00 для корректного сравнения instant'ов. Общий хелпер
    // dushanbeTodayStart вместо локального дубликата Intl (та же формула).
    const now = new Date();
    const todayStart = dushanbeTodayStart(now);

    // Фильтр и в запросе, и в JS: реальная БД отфильтрует сразу, а моки
    // репозитория в юнит-тестах where игнорируют — JS-фильтр страхует тесты.
    const candidates =
      (await this.taskRepo.find({ where: { status: Not(DevTaskStatus.DONE) } })) ?? [];
    let assigned = 0;
    for (const t of candidates) {
      if (!t || (t as any).status === DevTaskStatus.DONE) continue;
      if (!(t as any).deadline) continue;
      const d = new Date((t as any).deadline).getTime();
      if (Number.isNaN(d) || d >= todayStart.getTime()) continue;
      if (scopeProjectId && (t as any).projectId !== scopeProjectId) continue;
      if ((t as any).assigneeId === target) continue;
      await this.taskRepo.update(t.id, { assigneeId: target });
      await this.logHistory(t.id, actorId ?? null, 'assignee', (t as any).assigneeId ?? null, target);
      assigned++;
    }
    this.broadcast();
    return { assigned };
  }

  /** Свои saved views, ORDER createdAt (контракт D). */
  async listViews(ownerId: string): Promise<DevBoardView[]> {
    return this.viewRepo.find({ where: { ownerId }, order: { createdAt: 'ASC' } });
  }

  /** Создание saved view (контракт D, право view): name 1..100 (trim),
   *  filters — непрозрачный объект фронта, но с DoS-капами (≤20 ключей,
   *  ≤10 КБ JSON, глубина ≤5, без __proto__), groupBy — status/priority/
   *  assignee (default status), иначе 400. */
  async createView(
    ownerId: string,
    dto: { name: string; filters?: Record<string, any>; groupBy?: string },
  ): Promise<DevBoardView> {
    // Не-строка (число/объект) раньше роняла .trim() 500-ой.
    if (typeof dto?.name !== 'string') {
      throw new BadRequestException('Название представления должно быть от 1 до 100 символов');
    }
    const name = dto.name.trim();
    if (!name || name.length > 100) {
      throw new BadRequestException('Название представления должно быть от 1 до 100 символов');
    }
    const groupBy = (dto as any)?.groupBy ?? 'status';
    if (typeof groupBy !== 'string' || !(DEV_BOARD_VIEW_GROUP_BY as readonly string[]).includes(groupBy)) {
      throw new BadRequestException('Некорректная группировка (status/priority/assignee)');
    }
    const filters = assertViewFilters((dto as any)?.filters ?? {});
    const row = this.viewRepo.create({ ownerId, name, filters, groupBy });
    return this.viewRepo.save(row);
  }

  /** Удаление view (контракт D): владелец или dev-tracker.manage.
   *  canManage вычисляет контроллер через hasGrant(req.user, ...). */
  async deleteView(id: string, requesterId: string, canManage: boolean): Promise<{ message: string }> {
    const view = await this.viewRepo.findOne({ where: { id } });
    if (!view) throw new NotFoundException('Представление не найдено');
    if (view.ownerId !== requesterId && !canManage) {
      throw new ForbiddenException('Недостаточно прав для удаления чужого представления');
    }
    await this.viewRepo.remove(view);
    return { message: 'Представление удалено' };
  }

  /** Список спринтов (контракт H, право view), ORDER createdAt. */
  async listSprints(): Promise<DevSprint[]> {
    return this.sprintRepo.find({ order: { createdAt: 'ASC' } });
  }

  /** Исполнители для селектов доски (модалка создания, фильтры, карточка).
   *  GET /users закрыт правом employees.view (у PM его нет → 403 и пустой
   *  список), поэтому отдаём скоупнутый список здесь по праву view доски:
   *  только активные dev-роли. Фронт ходит сюда первым, usersApi — fallback. */
  async listAssignees(): Promise<
    { id: string; name: string; role: string; avatar: string | null; avatarUrl: string | null }[]
  > {
    const users = await this.userRepo.find({
      where: {
        isActive: true,
        role: In(['developer', 'pm_dev', 'dev_director', 'founder', 'co_founder', 'admin'] as any),
      },
      order: { name: 'ASC' },
    });
    return users.map((u: any) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      avatar: u.avatar ?? null,
      avatarUrl: u.avatar ?? u.avatarUrl ?? null,
    }));
  }

  /** Создание спринта (контракт H, право manage): name 1..120 (trim),
   *  startDate/endDate — IsDateString (мусор → 400), goal optional string ≤2000. */
  async createSprint(
    dto: { name: string; goal?: string | null; startDate: string; endDate: string },
    userId: string,
  ): Promise<DevSprint> {
    // Не-строка (число/объект) раньше роняла .trim() 500-ой.
    if (typeof dto?.name !== 'string') {
      throw new BadRequestException('Название спринта должно быть от 1 до 120 символов');
    }
    const name = dto.name.trim();
    if (!name || name.length > 120) {
      throw new BadRequestException('Название спринта должно быть от 1 до 120 символов');
    }
    if (dto?.goal !== undefined && dto.goal !== null) {
      if (typeof dto.goal !== 'string') {
        throw new BadRequestException('Некорректная цель спринта');
      }
      if (dto.goal.length > 2000) {
        throw new BadRequestException('Цель спринта слишком длинная (макс. 2000 символов)');
      }
    }
    const start = this.parseSprintDate(dto?.startDate, 'Некорректные даты спринта');
    const end = this.parseSprintDate(dto?.endDate, 'Некорректные даты спринта');
    this.assertSprintRange(start, end);
    const row = this.sprintRepo.create({
      name,
      goal: dto?.goal ?? null,
      startDate: start,
      endDate: end,
      status: DevSprintStatus.ACTIVE,
      createdById: userId,
    });
    return this.sprintRepo.save(row);
  }

  /** Обновление спринта (контракт H, право manage): все поля опциональны,
   *  status — только 'active'|'done', иначе 400. */
  async updateSprint(
    id: string,
    dto: { name?: string; goal?: string | null; startDate?: string; endDate?: string; status?: string },
  ): Promise<DevSprint> {
    const sprint = await this.sprintRepo.findOne({ where: { id } });
    if (!sprint) throw new NotFoundException('Спринт не найден');
    const patch: Partial<DevSprint> = {};
    if (dto?.name !== undefined) {
      if (typeof dto.name !== 'string') {
        throw new BadRequestException('Название спринта должно быть от 1 до 120 символов');
      }
      const name = dto.name.trim();
      if (!name || name.length > 120) {
        throw new BadRequestException('Название спринта должно быть от 1 до 120 символов');
      }
      patch.name = name;
    }
    if (dto?.goal !== undefined) {
      if (dto.goal !== null) {
        if (typeof dto.goal !== 'string') {
          throw new BadRequestException('Некорректная цель спринта');
        }
        if (dto.goal.length > 2000) {
          throw new BadRequestException('Цель спринта слишком длинная (макс. 2000 символов)');
        }
      }
      patch.goal = dto.goal ?? null;
    }
    if (dto?.startDate !== undefined) {
      patch.startDate = this.parseSprintDate(dto.startDate, 'Некорректная дата начала спринта');
    }
    if (dto?.endDate !== undefined) {
      patch.endDate = this.parseSprintDate(dto.endDate, 'Некорректная дата окончания спринта');
    }
    if (dto?.status !== undefined) {
      if (dto.status !== DevSprintStatus.ACTIVE && dto.status !== DevSprintStatus.DONE) {
        throw new BadRequestException("Некорректный статус спринта ('active'|'done')");
      }
      patch.status = dto.status as DevSprintStatus;
    }
    if (Object.keys(patch).length > 0) {
      // Границы проверяем по эффективной паре (патч поверх stored): правим
      // только когда даты реально меняются, чтобы rename legacy-перевёрнутого
      // спринта не упирался в 400.
      if (patch.startDate !== undefined || patch.endDate !== undefined) {
        const effStart = patch.startDate ?? (sprint as any).startDate;
        const effEnd = patch.endDate ?? (sprint as any).endDate;
        if (effStart && effEnd && !Number.isNaN(new Date(effStart).getTime()) && !Number.isNaN(new Date(effEnd).getTime())) {
          this.assertSprintRange(new Date(effStart), new Date(effEnd));
        }
      }
      await this.sprintRepo.update(id, patch);
    }
    return this.sprintRepo.findOne({ where: { id } });
  }

  /** Завершение спринта (контракт H, право manage): открытые задачи
   *  (status != done) уходят в backlog (moveTo 'backlog' → sprintId null)
   *  или в указанный спринт (несуществующий UUID → 400), затем спринт —
   *  в done. Каждую смену sprintId пишем в историю (поле 'sprint',
   *  from/to — id или null). Возврат — {id, status: 'done', moved}. */
  async completeSprint(
    id: string,
    moveTo: string,
    actorId?: string,
  ): Promise<{ id: string; status: string; moved: number }> {
    const sprint = await this.sprintRepo.findOne({ where: { id } });
    if (!sprint) throw new NotFoundException('Спринт не найден');
    let targetSprintId: string | null;
    if (moveTo === 'backlog') {
      targetSprintId = null;
    } else if (moveTo === id) {
      // Завершаем «в себя»: двигать некуда, задачи остаются, спринт — в done.
      targetSprintId = id;
    } else if (typeof moveTo === 'string' && UUID_RE.test(moveTo)) {
      const target = await this.sprintRepo.findOne({ where: { id: moveTo } });
      if (!target) throw new BadRequestException('Спринт-приёмник не найден');
      targetSprintId = target.id;
    } else {
      throw new BadRequestException("Некорректное назначение (moveTo: 'backlog' | UUID спринта)");
    }
    // Фильтр и в запросе, и в JS (моки where игнорируют — см. triageOverdue).
    const inSprint = (await this.taskRepo.find({ where: { sprintId: id } })) ?? [];
    const open = inSprint.filter(t => t && (t as any).status !== DevTaskStatus.DONE);
    // moved — фактически перепривязанные задачи. При moveTo «в себя»
    // (fromS === target) апдейтов нет и moved 0, а не open.length.
    let moved = 0;
    for (const t of open) {
      const fromS = ((t as any).sprintId ?? null) as string | null;
      if (fromS !== targetSprintId) {
        await this.taskRepo.update(t.id, { sprintId: targetSprintId } as Partial<DevTask>);
        await this.logHistory(t.id, actorId ?? null, 'sprint', fromS, targetSprintId);
        moved++;
      }
    }
    await this.sprintRepo.update(id, { status: DevSprintStatus.DONE });
    this.broadcast();
    return { id, status: DevSprintStatus.DONE, moved };
  }

  /** Лёгкое превью карточки для hover/popover (контракт G): без комментариев
   *  и тяжёлого проекта — только id/name связей и счётчики подзадач. */
  async getPreview(id: string): Promise<{
    id: string;
    title: string;
    status: DevTaskStatus;
    priority: DevTaskPriority;
    assignee: { id: string; name: string | null } | null;
    deadline: Date | null;
    project: { id: string; name: string | null } | null;
    subtasksDone: number;
    subtasksCount: number;
  }> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Задача не найдена');
    const t = task as any;
    // Проект — частично (id/name), как в findOne: карточке достаточно ссылки.
    let project: { id: string; name: string | null } | null = null;
    if (t.projectId) {
      if (t.project?.id) {
        project = { id: t.project.id, name: t.project.name ?? null };
      } else {
        const p = await this.projectRepo.findOne({
          where: { id: t.projectId },
          select: ['id', 'name'],
        });
        project = p ? { id: (p as any).id, name: (p as any).name ?? null } : null;
      }
    }
    const assignee = t.assigneeId
      ? { id: t.assigneeId, name: t.assignee?.name ?? null }
      : null;
    const subtasksCount = await this.taskRepo.count({ where: { parentTaskId: id } });
    const subtasksDone = await this.taskRepo.count({
      where: { parentTaskId: id, status: DevTaskStatus.DONE },
    });
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee,
      deadline: t.deadline ?? null,
      project,
      subtasksDone,
      subtasksCount,
    };
  }

  /**
   * CFD-поток по дням (контракт F): [{day: 'YYYY-MM-DD', backlog, todo,
   * in_progress, in_review, testing, done}]. days 7..90, default 30.
   *
   * ДОПУЩЕНИЯ (метод приближённый — точного event-sourcing нет):
   *  1. Внутридневные переходы схлопываются до статуса на конец дня
   *     (EOD по Asia/Dushanbe): точное время переходов внутри суток
   *     не восстанавливаем.
   *  2. Стартовый статус задачи берём из earliest history.from; если истории
   *     нет вообще — считаем, что задача всегда была в текущем статусе;
   *     если from пустой — 'backlog'.
   *  3. До дня своего создания (createdAt, календарь Душанбе) задача
   *     не считается нигде.
   *  4. Удалённые задачи в реконструкции отсутствуют (их истории уже нет).
   *  5. Дневные бакеты — календарные сутки Asia/Dushanbe ('YYYY-MM-DD'),
   *     как scheduler и остальные KPI-агрегации (UTC-срезы сдвигали задачи
   *     на ±1 день для Душанбе +05:00).
   */
  async getFlow(days = 30): Promise<Array<Record<string, string | number>>> {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 7 || n > 90) {
      throw new BadRequestException('Параметр days должен быть целым от 7 до 90');
    }
    const now = new Date();
    const todayStartUtc = new Date(dushanbeDayKey(now) + 'T00:00:00.000Z');
    const dayList: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      dayList.push(new Date(todayStartUtc.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    const tasks = ((await this.taskRepo.find()) ?? []) as any[];
    const hist =
      ((await this.historyRepo.find({
        where: { field: 'status' },
        order: { createdAt: 'ASC' },
      })) ?? []) as any[];
    // Таймлайны переходов по задаче (отсортированы по времени).
    const transitions = new Map<string, Array<{ at: number; from: string | null; to: string }>>();
    for (const h of hist) {
      if (!h || h.field !== 'status' || !h.taskId) continue;
      const at = new Date(h.createdAt).getTime();
      if (Number.isNaN(at)) continue;
      const arr = transitions.get(h.taskId) ?? [];
      arr.push({ at, from: h.from ?? null, to: h.to });
      transitions.set(h.taskId, arr);
    }
    for (const arr of transitions.values()) arr.sort((a, b) => a.at - b.at);

    const KNOWN = [
      DevTaskStatus.BACKLOG, DevTaskStatus.TODO, DevTaskStatus.IN_PROGRESS,
      DevTaskStatus.IN_REVIEW, DevTaskStatus.TESTING, DevTaskStatus.DONE,
    ] as string[];
    return dayList.map(day => {
      const eod = dushanbeEndOfDay(day);
      const row: Record<string, string | number> = {
        day, backlog: 0, todo: 0, in_progress: 0, in_review: 0, testing: 0, done: 0,
      };
      for (const t of tasks) {
        if (!t?.id) continue;
        // Задача ещё не создана на этот день (календарь Душанбе) — не считаем.
        let createdDay: string | null = null;
        try {
          createdDay = t.createdAt ? dushanbeDayKey(t.createdAt) : null;
        } catch {
          createdDay = null;
        }
        if (createdDay && day < createdDay) continue;
        const arr = transitions.get(t.id) ?? [];
        let status: string | null = null;
        for (const tr of arr) {
          if (tr.at <= eod) status = tr.to;
          else break;
        }
        if (status === null) {
          status = arr.length > 0 ? (arr[0].from ?? DevTaskStatus.BACKLOG) : t.status;
        }
        if (KNOWN.includes(status)) {
          row[status] = (row[status] as number) + 1;
        }
      }
      return row;
    });
  }

  /** Шаблонные отчёты для CEO (без LLM, template-based markdown).
   *
   *  GET /dev-tracker/reports?type=week&days=7
   *    | type=sprint&sprintId=<uuid> | type=project&projectId=<uuid>.
   *  Право manage проверяет контроллер.
   *
   *  Валидация (400): type enum week/sprint/project; days целое 1..31
   *  (default 7); sprintId/projectId — UUID когда нужны. Несуществующие
   *  спринт/проект → 404.
   *
   *  Семантика:
   *   - week: срез за N дней — created (createdAt в окне) и done/doneOnTime
   *     (completedAt в окне); open/overdue/blocked/slaBreached — ТЕКУЩИЕ
   *     (с учётом projectId если дан). members.done — в окне, open/overdue —
   *     текущие. period={from,to}.
   *   - sprint: scope спринта (задачи с sprintId). created=всего в scope,
   *     done/остаток по scope, блокеры scope. period — даты спринта.
   *   - project: scope проекта без окна — все метрики текущие по scope.
   *     period=null.
   *
   *  velocity — сумма storyPoints по завершённым (окно для week, scope для
   *  sprint/project). Старые ключи KPI не трогаем — здесь свой stats-набор.
   *  Все чтения — через taskRepo (+sprintRepo/projectRepo для 404-проверок),
   *  агрегации в JS как в getKpi (объём доски — сотни задач). */
  async getReport(query: {
    type?: string;
    days?: number | string;
    sprintId?: string;
    projectId?: string;
  }): Promise<{
    title: string;
    period: { from: string; to: string } | null;
    stats: DevReportStats;
    blockers: DevReportBlocker[];
    members: DevReportMember[];
    velocity: number;
    markdown: string;
  }> {
    const type = typeof query?.type === 'string' ? query.type.trim() : '';
    if (type !== 'week' && type !== 'sprint' && type !== 'project') {
      throw new BadRequestException('Некорректный тип отчёта (type: week|sprint|project)');
    }

    let days: number;
    if (query?.days === undefined || query?.days === null || query?.days === '') {
      days = 7;
    } else {
      days = Number(query.days);
    }
    if (!Number.isInteger(days) || days < 1 || days > 31) {
      throw new BadRequestException('Параметр days должен быть целым от 1 до 31');
    }

    const now = new Date();
    // Границы «просрочено»/«в срок» — те же, что в getKpi (и на фронте):
    // просрочка = дедлайн раньше начала СЕГОДНЯШНЕГО дня по Душанбе
    // (а не «прямо сейчас»), «в срок» = день завершения ≤ дня дедлайна
    // в календаре Душанбе (instant-сравнение метило late любую задачу
    // с date-only дедлайном, закрытую в течение дня дедлайна).
    const todayStart = dushanbeTodayStart(now).getTime();
    const isOverdue = (t: any): boolean => {
      if (!t?.deadline || t?.status === DevTaskStatus.DONE) return false;
      const d = new Date(t.deadline).getTime();
      return !Number.isNaN(d) && d < todayStart;
    };
    const isOpen = (t: any): boolean => t?.status !== DevTaskStatus.DONE;
    const isDone = (t: any): boolean => t?.status === DevTaskStatus.DONE;
    const doneOnTimeOf = (list: any[]): number =>
      list.filter(
        t =>
          isDone(t) &&
          t?.deadline &&
          t?.completedAt &&
          !Number.isNaN(new Date(t.completedAt).getTime()) &&
          !Number.isNaN(new Date(t.deadline).getTime()) &&
          dushanbeDayKey(t.completedAt) <= dushanbeDayKey(t.deadline),
      ).length;

    const buildBlockers = (scope: any[]): DevReportBlocker[] =>
      scope
        .filter(t => t && (t as any).isBlocked)
        .map(t => ({
          id: (t as any).id,
          title: (t as any).title ?? '(без названия)',
          reason: (t as any).blockedReason ?? null,
          assignee: (t as any).assignee?.name ?? null,
          status: (t as any).status,
        }));

    const buildMembers = (
      scope: any[],
      doneInScope: (t: any) => boolean,
    ): DevReportMember[] => {
      const groups = new Map<string, any[]>();
      for (const t of scope) {
        if (!t || !(t as any).assigneeId) continue;
        const list = groups.get((t as any).assigneeId) ?? [];
        list.push(t);
        groups.set((t as any).assigneeId, list);
      }
      return [...groups.entries()].map(([assigneeId, list]) => ({
        assigneeId,
        name: (list[0] as any)?.assignee?.name ?? null,
        done: list.filter(doneInScope).length,
        open: list.filter(isOpen).length,
        overdue: list.filter(isOverdue).length,
      }));
    };

    const buildCurrentStats = (scope: any[], created: number, doneList: any[]): DevReportStats => ({
      created,
      done: doneList.length,
      doneOnTime: doneOnTimeOf(doneList),
      overdue: scope.filter(isOverdue).length,
      blocked: scope.filter(t => t && (t as any).isBlocked).length,
      open: scope.filter(isOpen).length,
      slaBreached: scope.filter(t => this.isSlaBreached(t, now)).length,
    });

    // ── sprint: scope спринта ──────────────────────────────────────
    if (type === 'sprint') {
      const sprintId = typeof query?.sprintId === 'string' ? query.sprintId.trim() : '';
      if (!sprintId || !UUID_RE.test(sprintId)) {
        throw new BadRequestException('Некорректный sprintId (нужен UUID)');
      }
      const sprint = await this.sprintRepo.findOne({ where: { id: sprintId } });
      if (!sprint) throw new NotFoundException('Спринт не найден');
      const all = ((await this.taskRepo.find()) ?? []) as any[];
      const scope = all.filter(t => t && (t as any).sprintId === sprintId);
      const doneList = scope.filter(isDone);
      const stats = buildCurrentStats(scope, scope.length, doneList);
      const blockers = buildBlockers(scope);
      const members = buildMembers(scope, isDone);
      // safeStoryPoints: `?? 0` пропускал NaN — одна битая оценка отравляла
      // velocity отчёта в NaN (как в getKpi().velocity до фикса).
      const velocity = doneList.reduce((s, t) => s + safeStoryPoints((t as any).storyPoints), 0);
      const unassignedOpen = scope.filter(t => t && !(t as any).assigneeId && isOpen(t)).length;
      const title = `Отчёт по спринту «${(sprint as any)?.name ?? sprintId}»`;
      let period: { from: string; to: string } | null = null;
      try {
        const from = (sprint as any)?.startDate ? new Date((sprint as any).startDate).toISOString() : null;
        const to = (sprint as any)?.endDate ? new Date((sprint as any).endDate).toISOString() : null;
        period = from && to ? { from, to } : null;
      } catch {
        period = null;
      }
      const markdown = formatDevReportMarkdown({ title, period, stats, blockers, members, velocity, unassignedOpen });
      return { title, period, stats, blockers, members, velocity, markdown };
    }

    // ── project: scope проекта без окна ────────────────────────────
    if (type === 'project') {
      const projectId = typeof query?.projectId === 'string' ? query.projectId.trim() : '';
      if (!projectId || !UUID_RE.test(projectId)) {
        throw new BadRequestException('Некорректный projectId (нужен UUID)');
      }
      const project = await this.projectRepo.findOne({ where: { id: projectId } });
      if (!project) throw new NotFoundException('Проект не найден');
      const all = ((await this.taskRepo.find()) ?? []) as any[];
      const scope = all.filter(t => t && (t as any).projectId === projectId);
      const doneList = scope.filter(isDone);
      const stats = buildCurrentStats(scope, scope.length, doneList);
      const blockers = buildBlockers(scope);
      const members = buildMembers(scope, isDone);
      // safeStoryPoints — см. sprint-ветку выше: NaN-оценка не должна травить сумму.
      const velocity = doneList.reduce((s, t) => s + safeStoryPoints((t as any).storyPoints), 0);
      const unassignedOpen = scope.filter(t => t && !(t as any).assigneeId && isOpen(t)).length;
      const title = `Отчёт по проекту «${(project as any)?.name ?? projectId}»`;
      const period = null;
      const markdown = formatDevReportMarkdown({ title, period, stats, blockers, members, velocity, unassignedOpen });
      return { title, period, stats, blockers, members, velocity, markdown };
    }

    // ── week: срез за N дней (+опциональный projectId-скоуп) ───────
    let scopeProjectId: string | null = null;
    let scopeProjectName: string | null = null;
    const rawProjectId = typeof query?.projectId === 'string' ? query.projectId.trim() : '';
    if (rawProjectId) {
      if (!UUID_RE.test(rawProjectId)) {
        throw new BadRequestException('Некорректный projectId (нужен UUID)');
      }
      const project = await this.projectRepo.findOne({ where: { id: rawProjectId } });
      if (!project) throw new NotFoundException('Проект не найден');
      scopeProjectId = rawProjectId;
      scopeProjectName = (project as any)?.name ?? null;
    }
    const to = now;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const inWindow = (d: any): boolean => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return !Number.isNaN(t) && t >= from.getTime() && t <= to.getTime();
    };
    const all = ((await this.taskRepo.find()) ?? []) as any[];
    const scoped = scopeProjectId ? all.filter(t => t && (t as any).projectId === scopeProjectId) : all;
    const created = scoped.filter(t => t && inWindow((t as any).createdAt)).length;
    const doneList = scoped.filter(t => t && isDone(t) && inWindow((t as any).completedAt));
    const stats = buildCurrentStats(scoped, created, doneList);
    const blockers = buildBlockers(scoped);
    const members = buildMembers(scoped, t => isDone(t) && inWindow((t as any).completedAt));
    // safeStoryPoints — см. sprint-ветку выше: NaN-оценка не должна травить сумму.
    const velocity = doneList.reduce((s, t) => s + safeStoryPoints((t as any).storyPoints), 0);
    const unassignedOpen = scoped.filter(t => t && !(t as any).assigneeId && isOpen(t)).length;
    const title = scopeProjectName
      ? `Отчёт за неделю (${days} дн.) — проект «${scopeProjectName}»`
      : `Отчёт за неделю (${days} дн.)`;
    const period = { from: from.toISOString(), to: to.toISOString() };
    const markdown = formatDevReportMarkdown({ title, period, stats, blockers, members, velocity, unassignedOpen });
    return { title, period, stats, blockers, members, velocity, markdown };
  }

  /** Список подписок на вебхуки (контракт E, право manage). Новые — первыми.
   *  ВАЖНО: secret наружу не отдаём (утечка HMAC-секрета позволяла бы ковать
   *  подписи X-Dev-Signature от имени доски). Фронту для списка достаточно
   *  url/events/scope/флагов; secret виден только создателю в ответе create. */
  async listWebhooks(): Promise<Array<Omit<DevWebhookSubscription, 'secret'>>> {
    const rows = await this.webhookRepo.find({ order: { createdAt: 'DESC' } });
    return (rows ?? []).map(({ secret, ...rest }: any) => rest);
  }

  /** Создание подписки (контракт E, право manage): валидируем url
   *  (публичный http/https ≤2000, без credentials/приватных хостов — SSRF-блок)
   *  и events (непустое подмножество DEV_WEBHOOK_EVENTS), иначе 400.
   *  projectId null = все проекты; заданный обязан быть UUID существующего
   *  проекта (иначе подписка-немая: subMatches никогда не совпадёт, а мусор
   *  формата раньше молча сохранялся). */
  async createWebhook(
    dto: { projectId?: string | null; url: string; secret?: string | null; events: string[]; isActive?: boolean },
    userId: string,
  ): Promise<DevWebhookSubscription> {
    const projectId = dto?.projectId ?? null;
    if (projectId !== null && projectId !== undefined) {
      if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
        throw new BadRequestException('Некорректный projectId (нужен UUID)');
      }
      const project = await this.projectRepo.findOne({ where: { id: projectId } });
      if (!project) throw new NotFoundException('Проект не найден');
    }
    // assertPublicWebhookUrl: не-строка → 400 (раньше (123).trim() давал 500),
    // приватный хост/metadata/localhost → 400 (SSRF).
    const url = assertPublicWebhookUrl(dto?.url);
    const events = Array.isArray(dto?.events) ? [...new Set(dto.events)] : [];
    if (
      events.length === 0 ||
      events.length > 10 ||
      !events.every(e => typeof e === 'string' && (DEV_WEBHOOK_EVENTS as readonly string[]).includes(e))
    ) {
      throw new BadRequestException(
        `События должны быть подмножеством: ${(DEV_WEBHOOK_EVENTS as readonly string[]).join(', ')}`,
      );
    }
    const secret = dto?.secret ?? null;
    if (secret !== null && secret !== undefined) {
      if (typeof secret !== 'string') {
        throw new BadRequestException('Некорректный секрет вебхука');
      }
      if (secret.length > 500) {
        throw new BadRequestException('Секрет слишком длинный (макс. 500 символов)');
      }
    }
    if (dto?.isActive !== undefined && typeof dto.isActive !== 'boolean') {
      throw new BadRequestException('Некорректный флаг isActive');
    }
    const row = this.webhookRepo.create({
      projectId,
      url,
      secret: secret ?? null,
      events,
      isActive: dto?.isActive ?? true,
      createdById: userId,
    });
    return this.webhookRepo.save(row);
  }

  /** Удаление подписки (контракт E, право manage). Журнал доставок сносится
   *  каскадом (FK ON DELETE CASCADE). */
  async deleteWebhook(id: string): Promise<{ message: string }> {
    const sub = await this.webhookRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Подписка не найдена');
    await this.webhookRepo.remove(sub);
    return { message: 'Подписка удалена' };
  }

  /** Журнал доставок подписки (контракт E, право manage): последние 20, DESC. */
  async getWebhookDeliveries(subscriptionId: string): Promise<DevWebhookDelivery[]> {
    const sub = await this.webhookRepo.findOne({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException('Подписка не найдена');
    return this.deliveryRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  /** Тестовая доставка (контракт E, право manage): шлёт тестовый task.done
   *  в подписку и возвращает {ok, status}. Доставка пишется в журнал
   *  как обычно, но без фоновых ретраев (тест должен отвечать быстро). */
  async testWebhook(id: string): Promise<{ ok: boolean; status: number }> {
    const sub = await this.webhookRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Подписка не найдена');
    const payload = this.buildDevPayload('task.done', {
      id: 'test',
      title: 'Тестовая задача (проверка вебхука)',
      status: DevTaskStatus.DONE,
      priority: DevTaskPriority.MEDIUM,
      assignee: null,
      assigneeId: null,
      deadline: null,
      projectId: (sub as any).projectId ?? null,
      project: null,
    });
    return this.deliverToSubscription(sub, 'task.done', payload, false);
  }

  /** Плоский payload вебхука (контракт E, top-level): event/taskId/title/
   *  status/priority/assignee/assigneeId/deadline/projectId/project/url/at.
   *  assignee/project — имена (или null), deadline — ISO (или null),
   *  url — абсолютный: APP_URL + '/dev-board/task/:id'. */
  private buildDevPayload(event: string, task: any): Record<string, any> {
    const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
    let deadline: string | null = null;
    try {
      deadline = task?.deadline ? new Date(task.deadline).toISOString() : null;
    } catch {
      deadline = null;
    }
    return {
      event,
      taskId: task?.id ?? null,
      title: task?.title ?? null,
      status: task?.status ?? null,
      priority: task?.priority ?? null,
      assignee: task?.assignee?.name ?? null,
      assigneeId: task?.assigneeId ?? null,
      deadline,
      projectId: task?.projectId ?? null,
      project: task?.project?.name ?? null,
      url: `${base}/dev-board/task/${task?.id}`,
      at: new Date().toISOString(),
    };
  }

  /** Активные подписки одним запросом. Ошибка чтения — пустой список:
   *  outbox вторичен, отсутствие подписок не роняет мутацию. */
  private async fetchActiveSubs(): Promise<DevWebhookSubscription[]> {
    try {
      return (await this.webhookRepo.find({ where: { isActive: true } })) ?? [];
    } catch {
      return [];
    }
  }

  /** Совпадение подписки с событием: активна, событие в её events,
   *  проектный скоуп (null = все проекты) покрывает задачу. */
  private subMatches(sub: any, event: string, task: any): boolean {
    return (
      !!sub &&
      sub.isActive !== false &&
      Array.isArray(sub.events) &&
      sub.events.includes(event) &&
      (!sub.projectId || sub.projectId === task?.projectId)
    );
  }

  /** Доставка события заранее выбранным подпискам (best-effort, параллельно).
   *  Никогда не кидает: ретраи внутри deliverWithRetry тоже best-effort. */
  private async deliverEvent(
    event: string,
    task: any,
    subs: DevWebhookSubscription[],
  ): Promise<void> {
    try {
      const matched = ((subs as any[]) ?? []).filter(s => this.subMatches(s, event, task));
      if (matched.length === 0) return;
      const payload = this.buildDevPayload(event, task);
      await Promise.all(
        matched.map(sub =>
          this.deliverWithRetry(sub, event, payload).catch(() => ({
            ok: false as const,
            status: 0,
          })),
        ),
      );
    } catch {
      // Outbox — вторичен по отношению к мутации доски.
    }
  }

  /** Веерная рассылка события подпискам (контракт E). Подписка срабатывает,
   *  если (projectId null или равен задаче) И событие в её events (и она
   *  активна). Вся функция best-effort: outbox никогда не роняет мутацию. */
  private async emitDevEvent(event: string, task: any): Promise<void> {
    await this.deliverEvent(event, task, await this.fetchActiveSubs());
  }

  /** Доставка с ретраями (контракт E): сразу + через ~1 мин и ~5 мин.
   *  Ретраи — setTimeout, best-effort: живут в памяти процесса.
   *  MULTI-INSTANCE: в multi-instance деплое ретрай выполнит тот инстанс,
   *  что делал мутацию; рестарт/падение инстанса до срабатывания таймера
   *  ретрай теряет. Для строгих гарантий нужен персистентный outbox
   *  (таблица очереди + cron-воркер) — здесь осознанный компромисс. */
  private async deliverWithRetry(
    sub: DevWebhookSubscription,
    event: string,
    payload: Record<string, any>,
  ): Promise<{ ok: boolean; status: number }> {
    return this.deliverToSubscription(sub, event, payload, true);
  }

  /** Одна доставка: создаёт строку журнала и делает HTTP-попытку, затем
   *  обновляет её status/error. withRetries=true — планирует фоновые ретраи
   *  (~1 мин, затем ~5 мин от мутации). Ошибки журнала глотаются: журнал
   *  вторичен, мутацию он ронять не должен. */
  private async deliverToSubscription(
    sub: DevWebhookSubscription,
    event: string,
    payload: Record<string, any>,
    withRetries: boolean,
  ): Promise<{ ok: boolean; status: number }> {
    let delivery: DevWebhookDelivery | null = null;
    try {
      delivery = await this.deliveryRepo.save(
        this.deliveryRepo.create({
          subscriptionId: (sub as any).id,
          event,
          payload,
          status: 0,
          error: null,
        }),
      );
    } catch {
      delivery = null;
    }
    const attempt = async (): Promise<{ ok: boolean; status: number }> => {
      try {
        const res = await this.postWebhook((sub as any).url, payload, (sub as any).secret);
        const ok = res.status >= 200 && res.status < 300;
        if (delivery) {
          try {
            await this.deliveryRepo.update(delivery.id, {
              status: res.status,
              error: ok ? null : `HTTP ${res.status}`,
            });
          } catch {
            // Журнал вторичен.
          }
        }
        return { ok, status: res.status };
      } catch (e: any) {
        if (delivery) {
          try {
            await this.deliveryRepo.update(delivery.id, {
              status: 0,
              error: String(e?.message ?? e).slice(0, 500),
            });
          } catch {
            // Журнал вторичен.
          }
        }
        return { ok: false, status: 0 };
      }
    };
    const first = await attempt();
    if (!first.ok && withRetries) {
      // Цепочка: через ~1 мин, и если снова неуспех — ещё через ~4 мин
      // (итого ~5 мин от мутации). unref — чтобы таймеры не держали процесс
      // (jest и graceful shutdown).
      const schedule = (delayMs: number, then?: () => void) => {
        try {
          const timer = setTimeout(() => {
            attempt()
              .then(r => {
                if (!r.ok && then) then();
              })
              .catch(() => {
                // best-effort.
              });
          }, delayMs);
          const t = timer as unknown as { unref?: () => void };
          if (typeof t.unref === 'function') t.unref();
        } catch {
          // best-effort.
        }
      };
      schedule(60_000, () => schedule(4 * 60_000));
    }
    return first;
  }

  /** Низкоуровневый POST JSON с таймаутом 8с и подписью
   *  X-Dev-Signature: HMAC-SHA256(secret, rawBody) — только если secret задан.
   *  Отдельный метод (а не инлайн), чтобы юнит-тесты могли подменить сеть
   *  через (service as any).postWebhook без jest.mock модулей.
   *  Defense-in-depth SSRF: приватные хосты/credentials режутся и здесь
   *  (stored-URL из БД до фикса, обход createWebhook прямым save). */
  private postWebhook(
    url: string,
    payload: Record<string, any>,
    secret?: string | null,
  ): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      let rawBody: string;
      try {
        rawBody = JSON.stringify(payload);
      } catch (e) {
        reject(e);
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (e) {
        reject(e);
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error('Only http/https webhook URLs are allowed'));
        return;
      }
      if (parsed.username || parsed.password) {
        reject(new Error('Webhook URL with credentials is blocked'));
        return;
      }
      if (isBlockedWebhookHostname(parsed.hostname)) {
        reject(new Error('Webhook URL to internal address is blocked (SSRF)'));
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(rawBody)),
      };
      if (secret) {
        headers['X-Dev-Signature'] = createHmac('sha256', secret).update(rawBody).digest('hex');
      }
      const lib = parsed.protocol === 'https:' ? https : http;
      let req: http.ClientRequest;
      try {
        req = lib.request(
          {
            hostname: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : undefined,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'POST',
            headers,
            timeout: DEV_WEBHOOK_TIMEOUT_MS,
          },
          res => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
          },
        );
      } catch (e) {
        reject(e);
        return;
      }
      req.on('timeout', () => req.destroy(new Error('Webhook timeout')));
      req.on('error', reject);
      req.write(rawBody);
      req.end();
    });
  }
}

