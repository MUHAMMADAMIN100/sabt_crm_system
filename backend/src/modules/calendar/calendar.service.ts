import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { ClientLead } from '../clients/client-lead.entity';
import { getSalesSegment } from '../../common/sales-segment';
import { directionScopeOf } from '../../common/direction-scope';

/** Прогресс задачи в % для отображения на карточке календаря.
 *  Приоритет: 1) доля выполненных подзадач (acceptanceCriteria),
 *  2) если подзадач нет — оценка по статусу. */
function computeTaskProgress(t: Task): number {
  const ac = (t as any).acceptanceCriteria;
  if (Array.isArray(ac) && ac.length > 0) {
    const done = ac.filter((c: any) => c?.done).length;
    return Math.round((done / ac.length) * 100);
  }
  // 4-статусная модель: NEW=0%, IN_PROGRESS=50%, DONE=100%, CANCELLED=0%.
  switch (t.status) {
    case 'done':
      return 100;
    case 'in_progress':
      return 50;
    default:
      return 0; // new / cancelled
  }
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(ClientLead) private leadRepo: Repository<ClientLead>,
  ) {}

  async getEvents(
    from: string,
    to: string,
    employeeId?: string,
    projectId?: string,
    scope?: 'personal' | 'business' | 'general',
    viewerId?: string,
    viewerRole?: string,
    viewerSecondaryRole?: string | null,
  ) {
    if (from && to && new Date(from) > new Date(to)) {
      throw new BadRequestException('from date must be before to date');
    }
    // Фронт присылает границы датами без времени ('2026-07-31'). Postgres
    // трактует такую верхнюю границу как 00:00, из-за чего ВСЁ, что назначено
    // на последний день позже полуночи (встреча в 15:00, повторный звонок,
    // дедлайн задачи), выпадало из выборки. Растягиваем `to` до конца суток.
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to.trim())) {
      to = `${to.trim()} 23:59:59.999`;
    }
    const taskQb = this.taskRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.deadline IS NOT NULL')
      .andWhere(
        `(t.deadline >= :from AND COALESCE(t."startDate"::date, DATE(t."createdAt")) <= :to)`,
        { from, to },
      )
      // КП-задачи (автозадачи клиента на стадии КП) скрываем из Календаря —
      // они должны быть видны только в Онбординге на колонке «КП».
      .andWhere(`(t."originStage" IS NULL OR t."originStage" <> 'kp_creation')`)
      // «Истории» из контент-плана засоряют календарь (десятки в день).
      // Они нужны в самом контент-плане и в Stories-виджете — там их видно.
      // Здесь — прячем. Ловим двумя способами:
      //   1) задача связана с content_plan_items записью типа 'story';
      //   2) фолбэк: заголовок начинается на «История:» (для старых задач,
      //      где связь с content_plan_items могла быть потеряна).
      .andWhere(`NOT EXISTS (
        SELECT 1 FROM content_plan_items cpi
        WHERE cpi."taskId" = t.id AND cpi."contentType" = 'story'
      )`)
      .andWhere(`t.title NOT ILIKE 'История:%'`)
      // Авто-задачи клиентов из Базы клиентов («Новый лид: …», «Встреча
      // с клиентом: …» и т.п.) НЕ показываем в Календаре — встречи идут
      // отдельными событиями client_meeting (из nextContactAt).
      //   1) задача связана с лидом через client_leads.meetingTaskId;
      //   2) фолбэк по заголовку для «осиротевших» старых задач.
      .andWhere(`NOT EXISTS (
        SELECT 1 FROM client_leads cl WHERE cl."meetingTaskId" = t.id
      )`)
      .andWhere(`t.title NOT ILIKE 'Новый лид:%'`);

    if (employeeId) taskQb.andWhere('t.assigneeId = :employeeId', { employeeId });
    if (projectId) taskQb.andWhere('t.projectId = :projectId', { projectId });

    // Явный фильтр по scope (из UI: Личные / Бизнес / Общие)
    if (scope) {
      taskQb.andWhere('t.scope = :scope', { scope });
    }
    // Личные задачи приватны: всегда скрываем чужие PERSONAL.
    if (viewerId) {
      taskQb.andWhere(
        `(t.scope <> 'personal' OR t."createdById" = :viewerId)`,
        { viewerId },
      );
    }

    // Сегментация менеджеров продаж: МП видит только задачи проектов
    // своего направления. Задачи без проекта видны, если они созданы им,
    // назначены ему или это общие задачи (scope='general').
    const salesSegment = getSalesSegment(viewerRole);
    // Руководитель направления (в т.ч. второй ролью — dev_director у Сабрины)
    // видит в календаре задачи и вехи ВСЕХ проектов своего направления и
    // поручения своей команды, но не чужую сферу. Клиентские встречи/лиды
    // ниже остаются по salesSegment — это её продажная часть.
    const dirScope = directionScopeOf({ role: viewerRole, secondaryRole: viewerSecondaryRole });
    if (dirScope) {
      taskQb.andWhere(
        `(project.projectType IN (:...dirTypes)
          OR (t.projectId IS NULL AND (
            t."createdById" IN (SELECT id FROM users WHERE role IN (:...dirRoles) OR "secondaryRole" IN (:...dirRoles))
            OR t.assigneeId IN (SELECT id FROM users WHERE role IN (:...dirRoles) OR "secondaryRole" IN (:...dirRoles))
            OR t.scope = 'general'
          )))`,
        { dirTypes: dirScope.projectTypes, dirRoles: dirScope.teamRoles },
      );
    }
    const taskSegment = dirScope ? null : salesSegment;
    if (taskSegment) {
      // Все типы сегмента, а не один дефолтный (у МП по разработке их пять).
      taskQb.andWhere(
        `(project.projectType IN (:...salesProjTypes)
          OR (t.projectId IS NULL AND (
            t."createdById" = :salesViewerId
            OR t.assigneeId = :salesViewerId
            OR t.scope = 'general'
          )))`,
        { salesProjTypes: taskSegment.projectTypes, salesViewerId: viewerId ?? null },
      );
    }

    const projectQb = this.projectRepo
      .createQueryBuilder('p')
      .where('(p.startDate BETWEEN :from AND :to OR p.endDate BETWEEN :from AND :to)', { from, to })
      .andWhere('p.isArchived = false');

    if (projectId) projectQb.andWhere('p.id = :projectId', { projectId });
    // Вехи проектов — только своего направления. ВСЕ типы сегмента, а не один
    // дефолтный: у направления разработки их пять, иначе видны вехи только
    // «Лендинга» (как уже сделано для задач выше).
    const projTypesFilter = dirScope?.projectTypes ?? taskSegment?.projectTypes;
    if (projTypesFilter) {
      projectQb.andWhere('p.projectType IN (:...salesProjTypesP)', {
        salesProjTypesP: projTypesFilter,
      });
    }
    // Если фильтр по scope активен — не показываем старты/концы проектов
    // (они не относятся к scope задачи).
    const hideProjectEvents = !!scope;

    // Встречи клиентов (nextContactAt). У менеджеров продаж клиенты НЕ
    // создают задач (чтобы не плодить ложные просрочки в «Задачах»),
    // поэтому встречи берём напрямую из client_leads и показываем в
    // календаре по дате/времени, которые поставил менеджер.
    //   • МП видит свои встречи (ownerId = он);
    //   • топ (admin/founder/co_founder) видит все;
    //   • остальным ролям встречи клиентов не показываем.
    // Закрытые сделки (won/lost) и записи без даты — пропускаем.
    const role = viewerRole || '';
    const isTop = ['admin', 'founder', 'co_founder'].includes(role);
    const showClientMeetings = !scope || scope === 'personal';
    let leads: ClientLead[] = [];
    if (showClientMeetings && (salesSegment || isTop)) {
      const leadQb = this.leadRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.owner', 'owner')
        .where('c.nextContactAt IS NOT NULL')
        .andWhere('c.nextContactAt BETWEEN :from AND :to', { from, to })
        .andWhere(`c.status NOT IN ('won', 'lost')`);
      if (salesSegment) {
        // МП — только свои лиды (+ совместимость со старыми без owner — нет).
        leadQb.andWhere('c.ownerId = :leadViewer', { leadViewer: viewerId ?? null });
      } else {
        // Топ — фильтр по конкретному менеджеру, если выбран employeeId.
        if (employeeId) leadQb.andWhere('c.ownerId = :empId', { empId: employeeId });
      }
      leads = await leadQb.getMany();
    }

    // Повторные звонки (repeatCallAt) — отдельные события, рисуются оранжевым.
    // Видимость та же, что у встреч: свои — менеджеру, все — руководству.
    let repeatLeads: ClientLead[] = [];
    if (showClientMeetings && (salesSegment || isTop)) {
      const rcQb = this.leadRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.owner', 'owner')
        .where('c."repeatCallAt" IS NOT NULL')
        .andWhere('c."repeatCallAt" BETWEEN :from AND :to', { from, to })
        .andWhere(`c.status NOT IN ('won', 'lost')`);
      if (salesSegment) {
        rcQb.andWhere('c.ownerId = :leadViewer', { leadViewer: viewerId ?? null });
      } else if (employeeId) {
        rcQb.andWhere('c.ownerId = :empId', { empId: employeeId });
      }
      // catch — защита на первый деплой, пока идемпотентный DDL ещё не добавил
      // колонку repeatCallAt. Ошибку логируем, а не глотаем молча.
      repeatLeads = await rcQb.getMany().catch((e: any) => {
        this.logger.warn(`repeatCallAt events query failed: ${e?.message || e}`);
        return [] as ClientLead[];
      });
    }

    const [tasks, projects] = await Promise.all([taskQb.getMany(), projectQb.getMany()]);

    const clientMeetingEvents = leads.map(c => {
      // ВАЖНО: отдаём ПОЛНЫЙ ISO-timestamp (как у задач t.deadline), а не
      // дату-строку. Фронт делает new Date(e.date) → переводит в локальное
      // время (UTC+5) и для раскладки по дню, и для показа часа встречи.
      // Дата-строка теряла время и ломала час в календаре.
      const iso = new Date(c.nextContactAt).toISOString();
      return {
        id: `client-meeting-${c.id}`,
        clientId: c.id, // для drag-обновления и карточки клиента в календаре
        title: `Встреча: ${c.name}`,
        description: c.nextStep || null,
        date: iso,
        startDate: iso,
        type: 'client_meeting',
        status: c.status,
        assigneeName: c.owner?.name,
        assigneeId: c.ownerId,
        createdById: c.ownerId,
        scope: 'personal',
        link: `/clients?id=${c.id}`,
      };
    });

    const repeatCallEvents = repeatLeads.map(c => {
      const iso = new Date(c.repeatCallAt as Date).toISOString();
      return {
        id: `client-repeat-call-${c.id}`,
        clientId: c.id,
        title: `Повторно позвонить: ${c.name}`,
        description: c.nextStep || null,
        date: iso,
        startDate: iso,
        type: 'client_repeat_call',
        status: c.status,
        assigneeName: c.owner?.name,
        assigneeId: c.ownerId,
        createdById: c.ownerId,
        scope: 'personal',
        link: `/clients?id=${c.id}`,
      };
    });

    const taskEvents = tasks.map(t => ({
      id: `task-${t.id}`,
      taskId: t.id, // для drag-and-drop и быстрого редактирования из модалки
      title: t.title,
      description: t.description,
      date: t.deadline,
      startDate: t.startDate || new Date(t.createdAt).toISOString().split('T')[0],
      type: 'task',
      status: t.status,
      priority: t.priority,
      projectName: t.project?.name,
      assigneeName: t.assignee?.name,
      // Нужны на фронте для фильтра «мои задачи» у founder/co_founder
      // и для других персональных view.
      assigneeId: t.assigneeId,
      createdById: t.createdById,
      fromFounder: (t as any).fromFounder ?? false,
      scope: (t as any).scope ?? 'business',
      // Прогресс задачи в % — по подзадачам (acceptanceCriteria) если
      // они есть, иначе оценка по статусу. Показывается на карточке
      // задачи в календаре.
      progress: computeTaskProgress(t),
      createdAt: t.createdAt,
      link: `/tasks/${t.id}`,
    }));

    const projectStartEvents = hideProjectEvents ? [] : projects
      .filter(p => p.startDate)
      .map(p => ({
        id: `project-start-${p.id}`,
        title: `Старт: ${p.name}`,
        date: p.startDate,
        type: 'project_start',
        status: p.status,
        link: `/projects/${p.id}`,
      }));

    const projectEndEvents = hideProjectEvents ? [] : projects
      .filter(p => p.endDate)
      .map(p => ({
        id: `project-end-${p.id}`,
        title: `Завершение: ${p.name}`,
        date: p.endDate,
        type: 'project_end',
        status: p.status,
        link: `/projects/${p.id}`,
      }));

    return [
      ...taskEvents,
      ...clientMeetingEvents,
      ...repeatCallEvents,
      ...projectStartEvents,
      ...projectEndEvents,
    ].sort(
      (a, b) => new Date(a.date as unknown as string).getTime() - new Date(b.date as unknown as string).getTime(),
    );
  }
}
