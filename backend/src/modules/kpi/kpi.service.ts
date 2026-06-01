import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { Task } from '../tasks/task.entity';
import { WorkSession } from '../auth/work-session.entity';
import { StoryLog } from '../stories/story.entity';
import { Project } from '../projects/project.entity';
import { ClientsService } from '../clients/clients.service';

/** Универсальная KPI-метрика. */
export interface KpiItem {
  key: string;
  label: string;
  target: number;
  value: number;
  percent: number;
  done: boolean;
}

/** Сводный ответ KPI одного юзера. */
export interface UserKpi {
  userId: string;
  role: string;
  periodFrom: string;
  periodTo: string;
  overallPercent: number;
  items: KpiItem[];
}

const TOP_ROLES = new Set<string>([
  UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
]);
const PM_ROLES = new Set<string>([
  UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM, UserRole.SMM_DIRECTOR,
]);
const SALES_ROLES = new Set<string>([
  UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV,
]);
const SMM_ROLES = new Set<string>([
  UserRole.SMM_SPECIALIST, UserRole.HEAD_SMM,
]);

/** Базовые таргеты на 30-дневный период. Для других периодов скейлим
 *  пропорционально (см. scaleTarget ниже). */
interface RoleTargets {
  tasksDone: number;
  hoursLogged: number;
  deadlineRate: number; // % — НЕ скейлится, это качественная метрика
  activityDays: number;
  storiesPosted?: number;
  projectsManaged?: number; // НЕ скейлится — это snapshot
}

function targetsFor(role: string): RoleTargets {
  if (PM_ROLES.has(role)) {
    return {
      tasksDone: 30, hoursLogged: 160, deadlineRate: 95, activityDays: 22,
      projectsManaged: 5,
    };
  }
  if (SALES_ROLES.has(role)) {
    return { tasksDone: 10, hoursLogged: 160, deadlineRate: 85, activityDays: 22 };
  }
  if (SMM_ROLES.has(role)) {
    return {
      tasksDone: 25, hoursLogged: 160, deadlineRate: 90, activityDays: 22,
      storiesPosted: 80,
    };
  }
  // Любая «рабочая» роль (designer / marketer / targetologist / developer /
  // employee) — стандартный набор.
  return { tasksDone: 20, hoursLogged: 160, deadlineRate: 90, activityDays: 22 };
}

@Injectable()
export class KpiService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(WorkSession) private sessionRepo: Repository<WorkSession>,
    @InjectRepository(StoryLog) private storyRepo: Repository<StoryLog>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private clientsService: ClientsService,
  ) {}

  /** Разрезаем строку YYYY-MM-DD в локальную полночь без UTC-сдвига. */
  private parseDate(s?: string): Date | undefined {
    if (!s) return undefined;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  private periodRange(from?: string, to?: string) {
    const now = new Date();
    const periodFrom = this.parseDate(from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
    periodFrom.setHours(0, 0, 0, 0);
    const periodTo = this.parseDate(to) ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
    periodTo.setHours(23, 59, 59, 999);
    const days = Math.max(1, Math.ceil((periodTo.getTime() - periodFrom.getTime()) / 86400_000) + 1);
    return { periodFrom, periodTo, days };
  }

  /** Скейлинг таргета: базовые числа даны на 30 дней. Для другого
   *  периода — пропорционально, минимум 1. */
  private scaleTarget(base: number, days: number): number {
    return Math.max(1, Math.round(base * days / 30));
  }

  /** KPI одного юзера. Внутри использует bulk-методы (с массивом из одного
   *  id) — переиспользуем код. */
  async getUserKpi(userId: string, from?: string, to?: string): Promise<UserKpi | null> {
    const list = await this.bulkKpi([userId], from, to);
    return list[0] || null;
  }

  /** KPI всех активных не-top сотрудников. Для дашборда основателя.
   *  Делает 5 групповых SQL-агрегаций → быстро даже на 100+ юзерах. */
  async getAllKpi(from?: string, to?: string): Promise<UserKpi[]> {
    // Выбираем всех активных юзеров кроме admin/founder/co_founder.
    const users = await this.userRepo.find({
      where: { isActive: true, isBlocked: false },
      order: { name: 'ASC' },
    });
    const candidates = users.filter(u => !TOP_ROLES.has(u.role));
    if (candidates.length === 0) return [];
    return this.bulkKpi(candidates.map(u => u.id), from, to, candidates);
  }

  /** Эффективный bulk-расчёт KPI для списка userId. */
  private async bulkKpi(
    userIds: string[],
    from?: string,
    to?: string,
    preloadedUsers?: User[],
  ): Promise<UserKpi[]> {
    if (userIds.length === 0) return [];
    const { periodFrom, periodTo, days } = this.periodRange(from, to);

    // 1) Юзеры — если не передали, грузим сами
    const users = preloadedUsers
      ?? await this.userRepo.find({ where: { id: In(userIds) } });
    const userMap = new Map(users.map(u => [u.id, u]));

    // 2) Параллельно гонимся за всеми агрегациями.
    // Wave 14: убрали запрос hours/time_logs — метрика «Часов залогировано»
    // выпилена, считать её больше не нужно.
    const [tasksRows, sessionRows, storyRows, projectRows] = await Promise.all([
      this.taskRepo.manager.query(
        `SELECT "assigneeId" AS uid,
                COUNT(*)::int AS done_count,
                COUNT(*) FILTER (
                  WHERE deadline IS NULL OR COALESCE("reviewedAt", "updatedAt") <= deadline
                )::int AS on_time_count
         FROM tasks
         WHERE "assigneeId" = ANY($1::uuid[])
           AND status::text = 'done'
           AND "updatedAt" BETWEEN $2 AND $3
         GROUP BY "assigneeId"`,
        [userIds, periodFrom, periodTo],
      ),
      this.sessionRepo.manager.query(
        `SELECT "userId" AS uid, COUNT(DISTINCT date)::int AS days
         FROM work_sessions
         WHERE "userId" = ANY($1::uuid[])
           AND date::date BETWEEN $2::date AND $3::date
         GROUP BY "userId"`,
        [userIds, periodFrom, periodTo],
      ),
      this.storyRepo.manager.query(
        `SELECT "employeeId" AS uid, COALESCE(SUM("storiesCount"), 0)::int AS total
         FROM story_logs
         WHERE "employeeId" = ANY($1::uuid[])
           AND date BETWEEN $2 AND $3
         GROUP BY "employeeId"`,
        [userIds, periodFrom, periodTo],
      ).catch(() => [] as any[]),
      this.projectRepo.manager.query(
        `SELECT "managerId" AS uid, COUNT(*)::int AS cnt
         FROM projects
         WHERE "managerId" = ANY($1::uuid[])
           AND "isArchived" = false
         GROUP BY "managerId"`,
        [userIds],
      ),
    ]);

    // 3) Индексируем по userId для быстрого доступа
    const tasksByUid = new Map<string, { done: number; onTime: number }>();
    for (const r of tasksRows) {
      tasksByUid.set(r.uid, { done: Number(r.done_count) || 0, onTime: Number(r.on_time_count) || 0 });
    }
    const activityByUid = new Map<string, number>();
    for (const r of sessionRows) activityByUid.set(r.uid, Number(r.days) || 0);
    const storiesByUid = new Map<string, number>();
    for (const r of storyRows) storiesByUid.set(r.uid, Number(r.total) || 0);
    const projectsByUid = new Map<string, number>();
    for (const r of projectRows) projectsByUid.set(r.uid, Number(r.cnt) || 0);

    // 4) Для МП — запросы к ClientsService, параллельно
    const salesIds = userIds.filter(uid => {
      const u = userMap.get(uid);
      return u && SALES_ROLES.has(u.role);
    });
    const salesKpis = new Map<string, any>();
    await Promise.all(salesIds.map(async (uid) => {
      const u = userMap.get(uid)!;
      const direction = u.role === UserRole.SALES_MANAGER_SMM ? 'smm' as any
        : u.role === UserRole.SALES_MANAGER_DEV ? 'development' as any
        : undefined;
      const kpi = await this.clientsService.kpi(uid, direction, from, to).catch(() => null);
      if (kpi) salesKpis.set(uid, kpi);
    }));

    // 5) Собираем финальный результат для каждого userId
    return userIds.map(uid => {
      const user = userMap.get(uid);
      if (!user || TOP_ROLES.has(user.role)) {
        return null;
      }
      const targets = targetsFor(user.role);
      const t = tasksByUid.get(uid) || { done: 0, onTime: 0 };
      const actDays = activityByUid.get(uid) || 0;
      const stories = storiesByUid.get(uid) || 0;
      const projects = projectsByUid.get(uid) || 0;

      const items: KpiItem[] = [];

      // Wave 14: убрали tasks_done и hours_logged — они показывали 0 за период
      // и читались как баг рассинхрона с БД (StatCard рядом считает по всему
      // времени и показывает другие числа). Оставляем только deadline_rate
      // и activity_days как универсальные. Подсчёт `t.done`/`hours` ниже
      // всё ещё нужен для deadline_rate.

      // Deadline rate: %, не скейлим. Если done=0 → null/100 чтобы не штрафовать.
      const deadlineRate = t.done > 0 ? Math.round((t.onTime / t.done) * 100) : 0;
      items.push({
        key: 'deadline_rate',
        label: 'Соблюдено дедлайнов',
        target: targets.deadlineRate,
        value: deadlineRate,
        percent: t.done > 0 ? Math.min(100, Math.round(deadlineRate / targets.deadlineRate * 100)) : 0,
        done: t.done > 0 && deadlineRate >= targets.deadlineRate,
      });

      const activityTarget = Math.min(days, this.scaleTarget(targets.activityDays, days));
      items.push({
        key: 'activity_days',
        label: 'Активных дней',
        target: activityTarget,
        value: actDays,
        percent: Math.min(100, Math.round(actDays / activityTarget * 100)),
        done: actDays >= activityTarget,
      });

      // Бонус-метрики по роли
      if (SMM_ROLES.has(user.role) && targets.storiesPosted) {
        const storiesTarget = this.scaleTarget(targets.storiesPosted, days);
        items.push({
          key: 'stories_posted',
          label: 'Историй опубликовано',
          target: storiesTarget,
          value: stories,
          percent: Math.min(100, Math.round(stories / storiesTarget * 100)),
          done: stories >= storiesTarget,
        });
      }

      if (PM_ROLES.has(user.role) && targets.projectsManaged) {
        items.push({
          key: 'projects_managed',
          label: 'Проектов под управлением',
          target: targets.projectsManaged,
          value: projects,
          percent: Math.min(100, Math.round(projects / targets.projectsManaged * 100)),
          done: projects >= targets.projectsManaged,
        });
      }

      if (SALES_ROLES.has(user.role)) {
        const salesKpi = salesKpis.get(uid);
        if (salesKpi?.items) {
          // Префиксуем sales-ключи чтобы не пересекались с универсальными.
          for (const it of salesKpi.items as KpiItem[]) {
            items.push({ ...it, key: `sales_${it.key}` });
          }
        }
      }

      // Overall: среднее процентов всех метрик
      const overall = items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.percent, 0) / items.length)
        : 0;

      return {
        userId: uid,
        role: user.role,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        overallPercent: Math.min(100, Math.max(0, overall)),
        items,
      } as UserKpi;
    }).filter(Boolean) as UserKpi[];
  }
}
