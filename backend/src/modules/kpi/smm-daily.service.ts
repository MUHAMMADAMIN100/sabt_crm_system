import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { KpiService, STAGE_LABELS } from './kpi.service';

/** Роли СММ-отдела: производство контента + ведение проектов. Учитываем и
 *  вторую роль сотрудника (видеограф/монтажёр и т.п.). Список — по составу
 *  SMM-доски + роли, названные основателем. */
export const SMM_TEAM_ROLES = [
  'smm_director', 'smm_specialist', 'storymaker', 'designer',
  'videographer', 'video_editor', 'scriptwriter', 'qa',
  'publisher', 'organizer', 'targetologist',
];

/** Русские названия ролей для письма/уведомления (копия ROLE_LABELS
 *  из employees.service — тот const не экспортируется). */
export const SMM_ROLE_LABELS: Record<string, string> = {
  smm_director: 'Руководитель SMM',
  smm_specialist: 'SMM специалист',
  storymaker: 'Сторисмейкер',
  designer: 'Дизайнер',
  videographer: 'Видеограф',
  video_editor: 'Монтажёр',
  scriptwriter: 'Сценарист / SMM-менеджер',
  qa: 'Контролёр качества',
  publisher: 'Публикатор',
  organizer: 'Организатор',
  targetologist: 'Таргетолог',
};

export interface SmmDailyItem {
  /** ISO-время события (для сортировки и показа «во сколько»). */
  at: string;
  /** stage — этап доски; return — возврат на доработку; task — задача;
   *  story — истории (время условное, конец дня). */
  kind: 'stage' | 'return' | 'task' | 'story';
  text: string;
  project: string | null;
  /** Для этапов доски: уложился ли в дедлайн карточки (null — дедлайна нет). */
  onTime: boolean | null;
  /** Сколько минут работа провела у исполнителя: от попадания на его этап
   *  (или назначения задачи) до продвижения вперёд. null — начало неизвестно.
   *  Время календарное: ночь и выходные не вычитаются. */
  spentMinutes: number | null;
}

export interface SmmDailyEmployee {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  secondaryRole: string | null;
  stagesDone: number;
  returns: number;
  storiesTotal: number;
  tasksDone: number;
  hours: number;
  /** Суммарное время на закрытые за день этапы/задачи, минут. */
  spentMinutes: number;
  items: SmmDailyItem[];
}

export interface SmmDailyReport {
  date: string; // YYYY-MM-DD (Душанбе)
  employees: SmmDailyEmployee[];
  totals: { stagesDone: number; storiesTotal: number; tasksDone: number; activeCount: number };
}

/** Сегодняшняя дата по Душанбе — сервер (Railway) живёт в UTC. */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

/** Календарная дата (Душанбе) для timestamp'а — для сравнения с дедлайном. */
function dushanbeDate(ts: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date(ts));
}

/** Минуты между двумя timestamp'ами (>=0), null если старт неизвестен. */
function minutesBetween(from: string | Date | null | undefined, to: string | Date): number | null {
  if (!from) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60_000));
}

/**
 * Ежедневный автоотчёт по СММ-команде: что каждый сотрудник сделал за день.
 * Ничего не заполняется руками — собираем из журналов, которые уже пишутся:
 *   1) unit_events — движения карточек по доске (та же CTE-база, что у KPI);
 *   2) unit_events qa_rework/client_revisions — возвраты на доработку;
 *   3) story_logs — истории за день;
 *   4) activity_logs TASK_STATUS→done + task_assignees.doneAt — задачи;
 *   5) work_sessions — часы в системе.
 */
@Injectable()
export class SmmDailyService {
  private readonly logger = new Logger(SmmDailyService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private kpi: KpiService,
  ) {}

  /** Сбой одного источника не валит отчёт, но обязан быть виден в логах —
   *  иначе дрейф прод-схемы давал бы «уверенные нули» без единого сигнала. */
  private fallback(source: string) {
    return (e: any): any[] => {
      this.logger.warn(`smm-daily: запрос «${source}» упал: ${String(e?.message || e).slice(0, 200)}`);
      return [];
    };
  }

  async getDaily(dateArg?: string): Promise<SmmDailyReport> {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateArg || '') ? (dateArg as string) : todayISO();
    // Границы дня D по Душанбе как абсолютные моменты времени. Драйвер pg
    // передаёт Date с оффсетом, сессия БД приводит к своим часам — сравнение
    // с createdAt (заполняется NOW() той же БД) корректно и в проде (UTC),
    // и на локальном стенде.
    const dayStart = new Date(`${date}T00:00:00.000+05:00`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    // ─── Состав СММ-команды (основная ИЛИ вторая роль) ───────────────────
    const roster = await this.userRepo.createQueryBuilder('u')
      .where('(u.role IN (:...roles) OR u.secondaryRole IN (:...roles))', { roles: SMM_TEAM_ROLES })
      .andWhere('u.isActive = true')
      .andWhere('u.isBlocked = false')
      .orderBy('u.name', 'ASC')
      .getMany();
    if (roster.length === 0) {
      return { date, employees: [], totals: { stagesDone: 0, storiesTotal: 0, tasksDone: 0, activeCount: 0 } };
    }
    const ids = roster.map(u => u.id);
    const manager = this.projectRepo.manager;

    // Все источники — параллельно; сбой одного не валит отчёт целиком.
    const [stages, returns, stories, taskCloses, taskSteps, sessions] = await Promise.all([
      // 1) Этапы доски (KPI-совместимая база: forward-переходы + обложки, дедуп
      //    внутри дня). dl отдаём ::text — иначе pg-драйвер вернёт JS Date и
      //    сравнение с 'YYYY-MM-DD' строкой было бы всегда истинным.
      //    Конец окна -1мс: BETWEEN в CTE включает обе границы, без поправки
      //    событие ровно в полночь попало бы в два соседних дня.
      manager.query(
        `${this.kpi.boardEventsCte()}
         SELECT ev.uid, ev."fromStage", ev."toStage", ev.title, ev.units, ev.at, ev.dl::text AS dl,
                p.name AS project,
                entered."createdAt" AS entered_at
         FROM ev
         LEFT JOIN unit_events ue ON ue.id = ev.id
         LEFT JOIN workflow_cards wc ON wc.id = ue."cardId"
         LEFT JOIN projects p ON p.id = wc."projectId"
         -- Когда карточка ПОПАЛА на закрываемый этап (последний вход до
         -- продвижения): с этого момента считается время работы исполнителя.
         LEFT JOIN LATERAL (
           SELECT e2."createdAt"
           FROM unit_events e2
           WHERE e2."cardId" = ue."cardId"
             AND e2.action = 'stage_enter'
             AND e2."toStage" = ev."fromStage"
             AND e2."createdAt" < ev.at
           ORDER BY e2."createdAt" DESC
           LIMIT 1
         ) entered ON true
         WHERE ev.uid = ANY($1::text[])
         ORDER BY ev.at ASC`,
        [ids, dayStart, new Date(dayEnd.getTime() - 1)],
      ).catch(this.fallback('этапы доски')),
      // 2) Возвраты на доработку (активность QA/руководителя — не в зачёт этапов).
      manager.query(
        `SELECT e."actorId"::text AS uid, e.action, e."createdAt" AS at,
                c.title, p.name AS project
         FROM unit_events e
         LEFT JOIN workflow_cards c ON c.id = e."cardId"
         LEFT JOIN projects p ON p.id = c."projectId"
         WHERE e.action IN ('qa_rework', 'client_revisions')
           AND e."actorId" IS NOT NULL
           AND e."actorId" = ANY($1::uuid[])
           AND e."createdAt" >= $2 AND e."createdAt" < $3
         ORDER BY e."createdAt" ASC`,
        [ids, dayStart, dayEnd],
      ).catch(this.fallback('возвраты на доработку')),
      // 3) Истории за день (дата в story_logs — уже календарная строка).
      manager.query(
        `SELECT s."employeeId"::text AS uid, s."storiesCount"::int AS cnt, p.name AS project
         FROM story_logs s
         LEFT JOIN projects p ON p.id = s."projectId"
         WHERE s.date = $1::date AND s."employeeId" = ANY($2::uuid[]) AND s."storiesCount" > 0`,
        [date, ids],
      ).catch(this.fallback('истории')),
      // 4а) Задачи, закрытые сотрудником (по журналу действий — кто перевёл в done).
      //     task_created — старт таймера, если у закрывшего нет своего шага.
      manager.query(
        `SELECT al."userId"::text AS uid,
                COALESCE(t.title, al."entityName", 'Задача') AS title,
                al."createdAt" AS at, p.name AS project, al."entityId" AS task_id,
                t."createdAt" AS task_created
         FROM activity_logs al
         LEFT JOIN tasks t ON t.id::text = al."entityId"
         LEFT JOIN projects p ON p.id = t."projectId"
         WHERE al.action = 'TASK_STATUS'
           AND al.details->>'to' = 'done'
           AND al."userId" = ANY($1::uuid[])
           AND al."createdAt" >= $2 AND al."createdAt" < $3
         ORDER BY al."createdAt" ASC`,
        [ids, dayStart, dayEnd],
      ).catch(this.fallback('закрытые задачи')),
      // 4б) Выполненные ШАГИ задач (multi-assignee: «моя часть готова»).
      //     started_at — когда работа дошла до этого шага: doneAt предыдущего
      //     шага, а для первого шага — создание задачи.
      manager.query(
        `SELECT ta."userId"::text AS uid, t.title, ta."doneAt" AS at,
                p.name AS project, ta."taskId"::text AS task_id,
                COALESCE(prev."prevDone", t."createdAt") AS started_at
         FROM task_assignees ta
         JOIN tasks t ON t.id = ta."taskId"
         LEFT JOIN projects p ON p.id = t."projectId"
         LEFT JOIN LATERAL (
           SELECT MAX(p2."doneAt") AS "prevDone"
           FROM task_assignees p2
           WHERE p2."taskId" = ta."taskId" AND p2.position < ta.position AND p2."isDone" = true
         ) prev ON true
         WHERE ta."userId" = ANY($1::uuid[])
           AND ta."isDone" = true
           AND ta."doneAt" >= $2 AND ta."doneAt" < $3
         ORDER BY ta."doneAt" ASC`,
        [ids, dayStart, dayEnd],
      ).catch(this.fallback('шаги задач')),
      // 5) Часы в системе за день.
      manager.query(
        `SELECT "userId"::text AS uid,
                COALESCE(SUM("durationHours"), 0)::float AS hours
         FROM work_sessions
         WHERE date::date = $1::date AND "userId" = ANY($2::uuid[])
         GROUP BY "userId"`,
        [date, ids],
      ).catch(this.fallback('часы работы')),
    ]);

    const hoursBy = new Map<string, number>(sessions.map((s: any) => [s.uid, Math.round(s.hours * 10) / 10]));
    // Финальное закрытие задачи «съедает» дубль от шага той же задачи тем же
    // человеком (последний шаг = закрытие: оба журнала пишут одно действие).
    const closedKeys = new Set(taskCloses.map((r: any) => `${r.uid}:${r.task_id}`));
    // Длительность СВОЕГО шага закрывшего — точнее, чем «от создания задачи»
    // (в полное время входила бы работа предыдущих исполнителей).
    const stepSpent = new Map<string, number | null>(
      taskSteps.map((r: any) => [`${r.uid}:${r.task_id}`, minutesBetween(r.started_at, r.at)]),
    );

    const byUser = new Map<string, SmmDailyEmployee>();
    for (const u of roster) {
      byUser.set(u.id, {
        id: u.id, name: u.name, avatar: (u as any).avatar ?? null,
        role: u.role, secondaryRole: (u as any).secondaryRole ?? null,
        stagesDone: 0, returns: 0, storiesTotal: 0, tasksDone: 0,
        hours: hoursBy.get(u.id) ?? 0, spentMinutes: 0, items: [],
      });
    }
    const push = (uid: string, item: SmmDailyItem) => {
      const e = byUser.get(uid);
      if (!e) return;
      e.items.push(item);
      e.spentMinutes += item.spentMinutes ?? 0;
    };

    for (const r of stages) {
      const e = byUser.get(r.uid); if (!e) continue;
      const units = Number(r.units) || 1;
      e.stagesDone += units;
      const fromLabel = STAGE_LABELS[r.fromStage] ?? null;
      const toLabel = STAGE_LABELS[r.toStage] ?? r.toStage;
      push(r.uid, {
        at: new Date(r.at).toISOString(), kind: 'stage',
        text: `«${r.title || 'Карточка'}» — ${fromLabel ? `${fromLabel} → ` : ''}${toLabel}${units > 1 ? ` · ${units} шт` : ''}`,
        project: r.project ?? null,
        onTime: r.dl ? dushanbeDate(r.at) <= String(r.dl).slice(0, 10) : null,
        spentMinutes: minutesBetween(r.entered_at, r.at),
      });
    }

    for (const r of returns) {
      const e = byUser.get(r.uid); if (!e) continue;
      e.returns += 1;
      push(r.uid, {
        at: new Date(r.at).toISOString(), kind: 'return',
        text: `«${r.title || 'Карточка'}» — ${r.action === 'qa_rework' ? 'вернул(а) на доработку с проверки' : 'зафиксировал(а) правки клиента'}`,
        project: r.project ?? null, onTime: null, spentMinutes: null,
      });
    }

    for (const r of stories) {
      const e = byUser.get(r.uid); if (!e) continue;
      const cnt = Number(r.cnt) || 0;
      e.storiesTotal += cnt;
      push(r.uid, {
        // Историям время не пишется — ставим конец дня, чтобы шли после этапов.
        at: new Date(dayEnd.getTime() - 1).toISOString(), kind: 'story',
        text: `Истории — ${cnt} шт`,
        project: r.project ?? null, onTime: null, spentMinutes: null,
      });
    }

    for (const r of taskCloses) {
      const e = byUser.get(r.uid); if (!e) continue;
      e.tasksDone += 1;
      // Свой шаг закрывшего — точный таймер; иначе от создания задачи.
      const own = stepSpent.get(`${r.uid}:${r.task_id}`);
      push(r.uid, {
        at: new Date(r.at).toISOString(), kind: 'task',
        text: `Задача «${r.title}» выполнена`,
        project: r.project ?? null, onTime: null,
        spentMinutes: own ?? minutesBetween(r.task_created, r.at),
      });
    }

    for (const r of taskSteps) {
      if (closedKeys.has(`${r.uid}:${r.task_id}`)) continue;
      const e = byUser.get(r.uid); if (!e) continue;
      e.tasksDone += 1;
      push(r.uid, {
        at: new Date(r.at).toISOString(), kind: 'task',
        text: `Задача «${r.title}» — своя часть выполнена`,
        project: r.project ?? null, onTime: null,
        spentMinutes: minutesBetween(r.started_at, r.at),
      });
    }

    const employees = [...byUser.values()];
    for (const e of employees) e.items.sort((a, b) => a.at.localeCompare(b.at));
    // Активные — сверху (по объёму сделанного), внутри групп — по имени.
    const weight = (e: SmmDailyEmployee) => e.stagesDone + e.storiesTotal + e.tasksDone + e.returns;
    employees.sort((a, b) => (weight(b) - weight(a)) || a.name.localeCompare(b.name, 'ru'));

    return {
      date,
      employees,
      totals: {
        stagesDone: employees.reduce((s, e) => s + e.stagesDone, 0),
        storiesTotal: employees.reduce((s, e) => s + e.storiesTotal, 0),
        tasksDone: employees.reduce((s, e) => s + e.tasksDone, 0),
        activeCount: employees.filter(e => weight(e) > 0).length,
      },
    };
  }
}
