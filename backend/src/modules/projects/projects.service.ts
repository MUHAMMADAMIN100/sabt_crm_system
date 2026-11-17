import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { hasGrant } from '../auth/permissions';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { Project, ProjectStatus, ProjectBillingType, ProjectPaymentStatus } from './project.entity';
import { ProjectPayment } from './payment.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UserRole, User } from '../users/user.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { ContentPlanService, isProductionOnly } from '../content-plan/content-plan.service';
import { ContentItemType, ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { Task, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { Team } from '../teams/team.entity';
import { Employee } from '../employees/employee.entity';
import {
  LAUNCH_KEYS, MANUAL_LAUNCH_KEYS, LAUNCH_LABELS,
  computeLaunchState, LaunchState, LaunchSignals,
} from './launch-checklist.helper';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { encryptSecret, decryptSecret } from '../../common/secret-box';
import { getSalesSegment, isSalesManager, DEV_PROJECT_TYPES, projectTypeLabel, getSalesSegmentOfUser, salesRoleOf } from '../../common/sales-segment';
import { effectiveLimits, sanitizeCustomTariff, TariffLimits } from './tariff-limits';
import { devClientFromSmm, CLIENT_MOVED_FLAG } from './dev-client.logic';
import { withManagerChange } from '../smm-control/smm-payments.logic';
import { SmmPaymentsService } from '../smm-control/smm-payments.service';
import { recordLeadEvent } from '../clients/lead-events';
import { escapeHtml } from '../../common/html-escape';
import { dushanbeToday } from '../employees/vacation';
import { tiktokLogOf, tiktokNeeded, tiktokOnAt, toggleTiktokLog } from '../../common/tiktok';
import {
  AccessUser, assertCanViewProject, canEditSmmProject, directionTypesOf, hasAnyRole, inDirection,
  isAssignedSalesManager, isOwnProject, isSmmManagement, isTop, patchSmmData, rolesOf,
} from './project-access';

/** Руководители направлений: деньги (оплаты, запрос оплаты) — по всему
 *  своему направлению, основной или второй ролью (15.11.2026). */
const DIRECTOR_MONEY_TYPES: Record<string, readonly string[]> = {
  smm_director: ['SMM'],
  dev_director: DEV_PROJECT_TYPES,
};

/** Кто связывает новый проект с лидом продаж (15.11.2026): руководство и
 *  руководители направлений — те, кто видит «Заявки от продаж». */
const LEAD_LINK_ROLES = ['admin', 'founder', 'smm_director', 'dev_director'];

/** Ключи smmData, у которых есть свои ручки (цикл, профиль, менеджер,
 *  TikTok, авторасстановка, реклама «Контроля», связь с «Финансами»).
 *  PATCH /projects/:id их не трогает (15.11.2026): старая карточка проекта
 *  присылала устаревший снимок smmData целиком и откатывала эти настройки. */
const SMM_DATA_OWNED_KEYS = [
  'cycleStartDay', 'cycleAnchor', 'normReels', 'normPosts', 'storiesPerMonth',
  'smmSpecialistIds', 'salesManagerId', 'salesManagerHistory', 'tiktokOff', 'tiktokLog', 'autoPlan',
  'adsRunning', 'adsSince', 'adsById', 'financeProjectId',
  'videographerIds', 'videoEditorIds', 'designerIds',
];

/** Кто видит и задаёт цену индивидуального тарифа. Один список и на чтение
 *  (stripFinance), и на запись (normalizeCustomTariff): иначе роль правила бы
 *  то, чего не видит, и её правка молча откатывалась.
 *  Руководитель SMM здесь потому, что цену индивидуального проекта
 *  согласовывает он — в справочнике тарифов её нет. Цены ОБЫЧНЫХ тарифов ему
 *  по-прежнему не видны. Admin в списке нет: ему, как и по остальным
 *  финансовым полям, деньги проекта не показываются. */
const CUSTOM_PRICE_ROLES = [
  'founder', 'smm_director', 'sales_manager_smm',
];
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TelegramService } from '../telegram/telegram.service';
import { AppGateway } from '../gateway/app.gateway';

/** Число дней в текущем месяце — для производной дневной нормы сторис (месяц / дни).
 *  Месяц — по Душанбе (15.11.2026): сервер в UTC, и в ночь на 1-е число
 *  норма считалась по прошлому месяцу. */
function daysInCurrentMonth(): number {
  const [y, m] = dushanbeToday().split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Правка верхних ключей smmData с учётом того, что поменялось (15.11.2026):
 *  view — объект для ответа, set/unset — для атомарного patchSmmData. */
function smmDataEditor(view: Record<string, any>) {
  const set: Record<string, any> = {};
  const unset: string[] = [];
  return {
    set, unset,
    put(key: string, val: any) {
      view[key] = val; set[key] = val;
      const i = unset.indexOf(key); if (i >= 0) unset.splice(i, 1);
    },
    del(key: string) {
      delete view[key]; delete set[key];
      if (!unset.includes(key)) unset.push(key);
    },
  };
}

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  /** Авто-миграция:
   *   - jsonb-колонка brief для SMM-брифа клиента (CRUD /projects/:id/brief);
   *   - varchar briefShareToken для публичной ссылки клиенту;
   *   - int devStage — этап разработки для доски «Разработка».
   *  Идемпотентно — миграции дублируют это для чистого прод-деплоя. */
  async onModuleInit() {
    try {
      await this.repo.manager.query(
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief jsonb`,
      );
      await this.repo.manager.query(
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS "briefShareToken" varchar`,
      );
      await this.repo.manager.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_brief_share_token
         ON projects("briefShareToken") WHERE "briefShareToken" IS NOT NULL`,
      );
      await this.repo.manager.query(
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS "devStage" int`,
      );
      await this.repo.manager.query(
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS "storiesArchived" boolean NOT NULL DEFAULT false`,
      );
      // Лимиты и цена индивидуального тарифа — на конкретный проект.
      await this.repo.manager.query(
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS "customTariff" jsonb`,
      );
      // Доступы к аккаунтам клиента: логин, зашифрованный пароль, заметка.
      await this.repo.manager.query(
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS "clientAccess" jsonb`,
      );
      // Личный архив: менеджер продаж убирает проект из СВОЕГО списка, у
      // остальной команды проект остаётся активным. Общий архив (isArchived)
      // это не заменяет — им пользуются руководство и руководитель СММ.
      await this.repo.manager.query(
        `CREATE TABLE IF NOT EXISTS project_hidden (
           user_id uuid NOT NULL,
           project_id uuid NOT NULL,
           hidden_at timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (user_id, project_id)
         )`,
      );
      await this.repo.manager.query(
        `CREATE INDEX IF NOT EXISTS idx_project_hidden_user ON project_hidden(user_id)`,
      );
      // Отметки разовых уборок данных (15.11.2026): уборка, сделанная один
      // раз, не должна повторяться на каждом перезапуске.
      await this.repo.manager.query(
        `CREATE TABLE IF NOT EXISTS projects_boot_jobs (
           key varchar PRIMARY KEY,
           done_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE projects brief/briefShareToken/devStage failed: ${e?.message || e}`);
    }
    await this.separateSmmFromDev().catch((e: any) =>
      this.logger.warn(`separateSmmFromDev failed: ${e?.message || e}`));
  }

  /** СММ и разработка разделены (решение владельца 14.10.2026) — разовая
   *  уборка данных, оставшихся от смешения: анкета SMM-клиента у проектов
   *  разработки переезжает в контакты, рилсы и съёмки разработки удаляются.
   *  Повторный запуск ничего не меняет.
   *  (14.10 здесь же снимались менеджеры по продажам разработки с
   *  SMM-проектов; 15.10 владелец вернул их в СММ — шаг убран, чтобы новые
   *  назначения не стирались при каждом перезапуске.) */
  private async separateSmmFromDev() {
    // Анкета SMM-клиента у проектов разработки → контакты клиента.
    const devRows: Array<{ id: string; smmData: any; clientInfo: any }> = await this.repo.manager.query(
      `SELECT id, "smmData", "clientInfo" FROM projects
        WHERE "projectType" = ANY($1::text[])
          AND jsonb_typeof("smmData") = 'object'
          AND NOT ("smmData" ? '${CLIENT_MOVED_FLAG}')
          AND ("smmData" ?| array['ownerName', 'preferences', 'keyDate', 'collabSince'])`,
      [DEV_PROJECT_TYPES],
    );
    for (const row of devRows) {
      const next = devClientFromSmm(row.smmData, row.clientInfo);
      await this.repo.manager.query(
        `UPDATE projects
            SET "clientInfo" = COALESCE($2::jsonb, "clientInfo"),
                "smmData" = "smmData" || jsonb_build_object('${CLIENT_MOVED_FLAG}', true)
          WHERE id = $1`,
        [row.id, next ? JSON.stringify(next) : null],
      );
    }
    if (devRows.length) this.logger.log(`Анкета клиента перенесена в контакты у ${devRows.length} проектов разработки`);

    // Рилсы, посты и карточки съёмки/монтажа/дизайна у проектов разработки
    // (07.11.2026, решение владельца — удалить). Завелись, пока разработка
    // открывалась страницами СММ, и продолжали раздаваться видеографам.
    // Сначала связанные с ними задачи, потом сами карточки.
    // Разовая уборка (15.11.2026): раньше шла на КАЖДОМ запуске и молча
    // стирала контент проекта, которому только что сменили тип. Теперь —
    // один раз (отметка в projects_boot_jobs) и только карточки, заведённые
    // до уборки 07.11 (исходный объём).
    const JOB = 'dev-content-cleanup-2026-11-07';
    const done: any[] = await this.repo.manager.query(
      `SELECT 1 FROM projects_boot_jobs WHERE key = $1`, [JOB],
    ).catch(() => [{ skip: true }]);
    if (done.length) return;
    const CUTOFF = '2026-11-08';
    const tasks: Array<{ taskId: string }> = await this.repo.manager.query(
      `SELECT DISTINCT ci."taskId" FROM content_plan_items ci
         JOIN projects p ON p.id = ci."projectId"
        WHERE p."projectType" = ANY($1::text[]) AND ci."taskId" IS NOT NULL
          AND ci."createdAt" < $2::timestamp`,
      [DEV_PROJECT_TYPES, CUTOFF],
    );
    if (tasks.length) {
      await this.repo.manager.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [tasks.map(t => t.taskId)])
        .catch((e: any) => this.logger.warn(`Задачи контент-плана у разработки не удалены: ${e?.message || e}`));
    }
    const removed: any[] = await this.repo.manager.query(
      `DELETE FROM content_plan_items ci USING projects p
        WHERE p.id = ci."projectId" AND p."projectType" = ANY($1::text[])
          AND ci."createdAt" < $2::timestamp
        RETURNING ci.id`,
      [DEV_PROJECT_TYPES, CUTOFF],
    );
    const n = Array.isArray(removed?.[0]) ? removed[0].length : removed.length;
    if (n) this.logger.log(`Удалено ${n} карточек контент-плана у проектов разработки (задач: ${tasks.length})`);
    await this.repo.manager.query(
      `INSERT INTO projects_boot_jobs (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, [JOB],
    ).catch(() => undefined);
  }

  constructor(
    @InjectRepository(Project) private repo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(ProjectPayment) private paymentRepo: Repository<ProjectPayment>,
    @InjectRepository(SmmTariff) private tariffRepo: Repository<SmmTariff>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Team) private teamRepo: Repository<Team>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
    private gateway: AppGateway,
    private contentPlanService: ContentPlanService,
    // Долг клиента по «Финансам» для письма «Запрос оплаты» (15.11.2026).
    private smmPayments: SmmPaymentsService,
  ) {}

  /** Заполняет проект полями из выбранного тарифа (snapshot имени и цены).
   *  Не перезаписывает уже заданные monthlyFee / billingType — клиент мог
   *  указать индивидуальную скидку. Используется в create() и при смене
   *  tariffId в update().
   *  Для «Индивидуального» тарифа (isCustom=true) цена берётся из
   *  monthlyFee, переданного клиентом в DTO (если != null). Сам snapshot
   *  цены тоже подменяется этим значением, чтобы оно отображалось
   *  везде где показывается тариф проекта. */
  private async applyTariffSnapshot(
    target: Partial<Project>,
    tariffId: string,
    customTariff?: Record<string, any> | null,
  ): Promise<void> {
    const tariff = await this.tariffRepo.findOne({ where: { id: tariffId } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    target.tariffId = tariff.id;
    target.tariffNameSnapshot = tariff.name;
    // Для custom тарифа цена живёт в самом проекте: сначала явный monthlyFee
    // (финансовый таб), иначе цена, введённая в форме проекта. В справочнике
    // у индивидуального тарифа ноль — брать его нельзя, иначе «Ежемесячная
    // плата» и выручка по проекту остались бы нулевыми.
    if ((tariff as any).isCustom) {
      const own = effectiveLimits(tariff as any, customTariff).monthlyPrice;
      const price = target.monthlyFee != null
        ? Number(target.monthlyFee)
        : (own > 0 ? own : tariff.monthlyPrice);
      target.tariffPriceSnapshot = price as any;
      if (target.monthlyFee == null) target.monthlyFee = price as any;
    } else {
      target.tariffPriceSnapshot = tariff.monthlyPrice;
      if (target.monthlyFee == null) target.monthlyFee = tariff.monthlyPrice;
    }
    if (target.billingType == null) target.billingType = ProjectBillingType.MONTHLY;
  }

  // ─── Payments: список платежей проекта (для финансового таба и формы) ──
  async listPayments(projectId: string, user?: AccessUser | null) {
    // Оплаты — только своего направления (15.11.2026).
    if (user) {
      const p = await this.repo.findOne({ where: { id: projectId } });
      if (!p) throw new NotFoundException('Project not found');
      this.assertMoneyScope(user, p);
    }
    const rows = await this.paymentRepo.find({
      where: { projectId },
      order: { paidAt: 'ASC' },
    });
    return rows.map(r => ({
      id: r.id,
      amount: Number(r.amount),
      paidAt: r.paidAt,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }

  // ─── Wave 7: Launch Setup checklist ──────────────────────────────────

  /** Собирает сигналы из БД для расчёта состояния чеклиста. */
  private async collectLaunchSignals(projectId: string, project: Project): Promise<LaunchSignals> {
    // 1) есть ли в команде SMM-специалист (или руководитель SMM /
    //    сторисмейкер — они тоже закрывают SMM-функцию проекта)
    const smmRows: Array<{ cnt: string }> = await this.repo.manager.query(
      `SELECT COUNT(*) AS cnt
       FROM project_members pm
       JOIN users u ON u.id = pm."usersId"
       WHERE pm."projectsId" = $1
         AND u.role IN ('smm_specialist','smm_director')`,
      [projectId],
    );
    // + назначенные специалисты проекта (smmData.smmSpecialistIds) — они закрывают
    //   SMM-функцию и без членства в project_members.
    const assignedSpecs = (project.smmData as any)?.smmSpecialistIds;
    const hasAssignedSpecialist = Array.isArray(assignedSpecs) && assignedSpecs.length > 0;
    const hasSmmMember = Number(smmRows?.[0]?.cnt || 0) > 0 || hasAssignedSpecialist;

    // 2) общее число позиций контент-плана и сколько в первую неделю
    //    (от startBillingDate или createdAt)
    const start = project.startBillingDate
      ? new Date(project.startBillingDate)
      : new Date(project.createdAt || Date.now());
    const weekEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    const cpiRows: Array<{ total: string; firstWeek: string }> = await this.repo.manager.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN "publishDate" BETWEEN $2 AND $3 THEN 1 ELSE 0 END) AS "firstWeek"
       FROM content_plan_items
       WHERE "projectId" = $1`,
      [projectId, start.toISOString(), weekEnd.toISOString()],
    );

    // 3) число задач
    const taskRows: Array<{ cnt: string }> = await this.repo.manager.query(
      `SELECT COUNT(*) AS cnt FROM tasks WHERE "projectId" = $1`,
      [projectId],
    );

    return {
      hasSmmMember,
      contentPlanCount: Number(cpiRows?.[0]?.total || 0),
      contentPlanFirstWeekCount: Number(cpiRows?.[0]?.firstWeek || 0),
      taskCount: Number(taskRows?.[0]?.cnt || 0),
    };
  }

  /** Возвращает текущее состояние launch-чеклиста проекта. */
  async getLaunchChecklist(projectId: string): Promise<LaunchState> {
    const project = await this.findOne(projectId);
    const signals = await this.collectLaunchSignals(projectId, project);
    return computeLaunchState(project, signals);
  }

  /** Переключает ручной пункт чеклиста (materials_received / accesses_received). */
  async setManualLaunchItem(projectId: string, itemKey: string, value: boolean): Promise<LaunchState> {
    if (!MANUAL_LAUNCH_KEYS.includes(itemKey)) {
      throw new ForbiddenException(
        `Пункт "${itemKey}" вычисляется автоматически и не может быть переключён вручную`,
      );
    }
    const project = await this.findOne(projectId);
    const checklist = { ...(project.launchChecklist || {}) };
    checklist[itemKey] = !!value;
    await this.repo.update(projectId, { launchChecklist: checklist });
    this.gateway.broadcast('projects:changed', {});
    return this.getLaunchChecklist(projectId);
  }

  // ─── SMM-бриф клиента ────────────────────────────────────────────────
  // ─── Доступы к аккаунтам клиента ──────────────────────────────────
  /** Кому положено видеть и менять доступы. Список намеренно короткий и
   *  жёстко зашит: это чужие учётные данные, а не рабочая настройка.
   *  Руководитель СММ работает с аккаунтами, основатель не должен остаться
   *  без доступа, если сотрудник уйдёт. Менеджер по продажам — только
   *  менеджер ЭТОГО проекта (решение владельца 14.11.2026), не по роли. */
  static readonly CLIENT_ACCESS_ROLES: string[] = [
    UserRole.SMM_DIRECTOR,
    UserRole.FOUNDER,
  ];

  /** + SMM-специалист этого проекта (решение владельца 19.10.2026) и
   *  менеджер по продажам, назначенный на проект (smmData.salesManagerId). */
  private canSeeClientAccessFor(
    user: { id?: string; role?: string; secondaryRole?: string | null },
    specialistIds: string[],
    salesManagerId?: string | null,
  ): boolean {
    return ProjectsService.CLIENT_ACCESS_ROLES.includes(user?.role || '')
      || ProjectsService.CLIENT_ACCESS_ROLES.includes(user?.secondaryRole || '')
      || (!!user?.id && specialistIds.includes(user.id))
      || (!!user?.id && !!salesManagerId && salesManagerId === user.id);
  }

  private assertCanSeeClientAccess(user: { id?: string; role?: string; secondaryRole?: string | null }, project: { smmData?: any }) {
    const sd = project?.smmData || {};
    const ids = Array.isArray(sd.smmSpecialistIds)
      ? (sd.smmSpecialistIds as any[]).filter(x => typeof x === 'string') : [];
    const salesManagerId = typeof sd.salesManagerId === 'string' ? sd.salesManagerId : null;
    if (!this.canSeeClientAccessFor(user, ids, salesManagerId)) {
      throw new ForbiddenException('Доступы клиента видят руководитель СММ, менеджер по продажам этого проекта, SMM-специалист проекта и основатель');
    }
  }

  private async clientAccessRow(projectId: string) {
    const row = await this.repo
      .createQueryBuilder('p')
      .select(['p.id', 'p.smmData'])
      .addSelect('p.clientAccess')
      .where('p.id = :id', { id: projectId })
      .getOne();
    if (!row) throw new NotFoundException('Проект не найден');
    return row;
  }

  /** Доступы одного проекта — без пароля: он приезжает отдельным запросом,
   *  только когда нажали «Показать», «Скопировать» или «Изменить». */
  async getClientAccess(projectId: string, user: { id?: string; role?: string; secondaryRole?: string }) {
    const row = await this.clientAccessRow(projectId);
    this.assertCanSeeClientAccess(user, row);
    const a = row.clientAccess || {};
    return {
      pageUrl: typeof (row.smmData as any)?.pageUrl === 'string' ? (row.smmData as any).pageUrl : '',
      login: a.login || '',
      hasPassword: !!a.password,
      note: a.note || '',
      updatedAt: a.updatedAt || null,
      updatedByName: a.updatedByName || null,
    };
  }

  /** Пароль клиента. Расшифровываем только здесь — в общей карточке проекта
   *  колонка не выбирается вовсе (select: false). */
  async getClientAccessPassword(projectId: string, user: { id?: string; role?: string; secondaryRole?: string }) {
    const row = await this.clientAccessRow(projectId);
    this.assertCanSeeClientAccess(user, row);
    return { password: decryptSecret((row.clientAccess || {}).password || '') };
  }

  async saveClientAccess(
    projectId: string,
    body: { login?: string; password?: string; note?: string; pageUrl?: string },
    user: { id: string; role?: string; secondaryRole?: string; name?: string },
  ) {
    const project = await this.repo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Проект не найден');
    this.assertCanSeeClientAccess(user, project);

    // Ссылка на страницу клиента живёт в smmData: её видят все, кто открыл
    // проект, в отличие от логина и пароля.
    if (body?.pageUrl !== undefined) {
      let url = String(body.pageUrl ?? '').trim().slice(0, 500);
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
      // Только этот ключ — атомарно поверх текущего smmData (15.11.2026).
      if (url) await patchSmmData(this.repo.manager, projectId, { pageUrl: url });
      else await patchSmmData(this.repo.manager, projectId, {}, ['pageUrl']);
    }

    const login = String(body?.login ?? '').trim().slice(0, 200);
    const note = String(body?.note ?? '').trim().slice(0, 2000);
    // Пароль не прислали вовсе — оставляем прежний (его могли не открывать).
    const keepPassword = body?.password === undefined || body?.password === null;
    const prevEncrypted: string = keepPassword
      ? (((await this.clientAccessRow(projectId)).clientAccess || {}).password || '')
      : '';
    const password = keepPassword ? '' : String(body.password);

    // Всё пустое — считаем, что доступы удалили.
    const empty = !login && !password && !prevEncrypted && !note;
    await this.repo.update(projectId, {
      clientAccess: empty ? null : {
        login,
        password: keepPassword ? prevEncrypted : (password ? encryptSecret(password) : ''),
        note,
        updatedAt: new Date().toISOString(),
        updatedByName: user?.name || '',
      },
    } as any);

    return this.getClientAccess(projectId, user);
  }

  /** Кто ведёт бриф SMM-проекта (правка и ссылка для клиента), 15.11.2026:
   *  руководство SMM — любой; менеджер проекта; SMM-специалист — только
   *  своего проекта; менеджер по продажам — своего направления (по любой из
   *  двух ролей) или назначенный на этот проект. Раньше роль МП разработки
   *  давала правку брифа любого SMM-проекта. */
  canManageBrief(
    user: AccessUser | null | undefined,
    p: { projectType?: string | null; managerId?: string | null; salesManagerId?: string | null; smmData?: any; members?: any[] } | null | undefined,
  ): boolean {
    if (!user?.id || !p || p.projectType !== 'SMM') return false;
    if (isSmmManagement(user) || p.managerId === user.id) return true;
    const memberIds = (Array.isArray(p.members) ? p.members : []).map((m: any) => m?.id).filter(Boolean);
    if (hasAnyRole(user, ['smm_specialist']) && isOwnProject(user, p, memberIds)) return true;
    const seg = getSalesSegmentOfUser(user);
    if (seg && (seg.projectTypes.includes('SMM') || isAssignedSalesManager(user, p))) return true;
    return false;
  }

  /** Сохраняет/обновляет бриф проекта. Право — canManageBrief. */
  async saveBrief(projectId: string, payload: any, user: AccessUser & { id: string; role: string; name?: string }) {
    const project = await this.findOne(projectId);
    if (project.projectType !== 'SMM') {
      throw new ForbiddenException('Бриф доступен только для SMM-проектов');
    }
    const isAllowed = this.canManageBrief(user, project as any);
    if (!isAllowed) {
      throw new ForbiddenException('Нет прав на редактирование брифа этого проекта');
    }
    // Меta: кто заполнил последним и когда. Сами ответы — в answers.
    const safe = payload && typeof payload === 'object' ? payload : {};
    const brief = {
      ...safe,
      filledAt: new Date().toISOString(),
      filledByUserId: user.id,
      filledByName: user.name || null,
    };
    await this.repo.update(projectId, { brief } as any);
    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: projectId,
      entityName: project.name,
      details: { brief: true },
    }).catch(() => {});
    this.gateway.broadcast('projects:changed', { projectId });
    return this.findOne(projectId, user);
  }

  /** Генерирует (или возвращает существующий) публичный токен для брифа.
   *  Клиент по URL `/public/brief/<token>` заполняет анкету без auth. */
  async generateBriefShareToken(projectId: string, user: AccessUser & { id: string; role: string; name?: string }): Promise<{ token: string }> {
    const project = await this.findOne(projectId);
    if (project.projectType !== 'SMM') {
      throw new ForbiddenException('Бриф доступен только для SMM-проектов');
    }
    // То же правило, что у правки брифа (15.11.2026).
    if (!this.canManageBrief(user, project as any)) throw new ForbiddenException('Нет прав на проект');

    let token = project.briefShareToken;
    if (!token) {
      // 32 hex-символа — достаточно для unguessable URL.
      token = require('crypto').randomBytes(16).toString('hex');
      await this.repo.update(projectId, { briefShareToken: token } as any);
    }
    return { token };
  }

  /** Публичный (без auth) — отдаёт минимум проектной инфы по токену +
   *  текущий бриф для пред-заполнения. Если токена нет — 404. */
  async getPublicBriefByToken(token: string) {
    if (!token || token.length < 8) throw new NotFoundException('Invalid token');
    const p = await this.repo.findOne({ where: { briefShareToken: token } });
    if (!p) throw new NotFoundException('Бриф не найден или ссылка отозвана');
    return {
      projectId: p.id,
      projectName: p.name,
      projectType: p.projectType,
      brief: p.brief || null,
    };
  }

  /** Публичный (без auth) — клиент сохраняет ответы. */
  async savePublicBrief(token: string, payload: any) {
    if (!token || token.length < 8) throw new NotFoundException('Invalid token');
    const p = await this.repo.findOne({
      where: { briefShareToken: token },
      relations: ['manager'],
    });
    if (!p) throw new NotFoundException('Бриф не найден или ссылка отозвана');
    // Клиент правит только свои ответы (15.11.2026): раньше ссылка заменяла
    // бриф целиком произвольным JSON — вместе с подписью менеджера, тарифом
    // и служебными полями. Остальное берём из сохранённого брифа.
    const safe: any = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const clip = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
    const answers: Record<string, string> = {};
    const rawAnswers = safe.answers && typeof safe.answers === 'object' && !Array.isArray(safe.answers) ? safe.answers : {};
    for (const [k, v] of Object.entries(rawAnswers).slice(0, 100)) {
      if (!/^q\d{1,2}$/.test(k) || typeof v !== 'string') continue;
      answers[k] = v.slice(0, 5000);
    }
    const stored: any = p.brief && typeof p.brief === 'object' ? p.brief : {};
    const clientName = clip(safe.clientSignature, 200) || 'Клиент';
    const brief = {
      ...stored,
      answers,
      clientSignature: clip(safe.clientSignature, 200),
      clientPhone: clip(safe.clientPhone, 50),
      filledAt: new Date().toISOString(),
      filledByUserId: null,
      filledByName: clientName,
      source: 'client',
    };
    await this.repo.update(p.id, { brief } as any);

    // Real-time: команда видит обновление мгновенно.
    try { this.gateway.broadcast('projects:changed', { projectId: p.id }); } catch {}

    // ─── Уведомление менеджеру проекта (in-app + email + Telegram) ────
    // Best-effort: каждая интеграция в своём try/catch, чтобы упавший
    // Brevo или Telegram не ломали клиентский сабмит брифа.
    try {
      // Считаем процент заполненности (минимум для понимания «полный
      // бриф» vs «черновик»).
      const answers = (brief as any).answers || {};
      const totalQs = 37; // см. frontend/src/lib/briefSchema.ts
      let filledQs = 0;
      for (const k of Object.keys(answers)) {
        if (typeof answers[k] === 'string' && answers[k].trim().length > 0) filledQs++;
      }
      const percent = Math.round((filledQs / totalQs) * 100);

      const manager = p.manager;
      const projectLink = `/projects/${p.id}`;
      const title = '📋 Клиент заполнил бриф';
      const message =
        `${clientName} заполнил${clientName.endsWith('а') ? 'а' : ''} бриф для проекта ` +
        `«${p.name}» (${percent}% — ${filledQs} из ${totalQs} вопросов).`;

      if (manager?.id) {
        // 1) In-app notification — кликабельная карточка в шторке.
        await this.notificationsService.create({
          userId: manager.id,
          type: NotificationType.STATUS_CHANGE,
          title,
          message,
          link: projectLink,
          data: { projectId: p.id, briefPercent: percent, source: 'client' },
        }).catch(() => {});

        // 2) Email — если у менеджера есть email. Имена клиента и проекта —
        //    только через escapeHtml (15.11.2026): их вводят люди.
        if (manager.email) {
          await this.mailService.sendGenericNotification(
            manager.email,
            manager.name || 'Менеджер',
            title,
            `Здравствуйте, <strong>${escapeHtml(manager.name || 'коллега')}</strong>!<br><br>` +
            `Клиент <strong>${escapeHtml(clientName)}</strong> только что заполнил бриф для проекта ` +
            `<strong>«${escapeHtml(p.name)}»</strong>.<br><br>` +
            `📊 Заполнено: <strong>${percent}%</strong> (${filledQs} из ${totalQs} вопросов).<br>` +
            `📅 ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}<br><br>` +
            `<a href="${this.telegramService.appUrl}${projectLink}" ` +
            `style="display:inline-block;padding:12px 24px;background:#4f6ef7;` +
            `color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">` +
            `Открыть бриф →</a>`,
          ).catch(() => {});
        }

        // 3) Telegram — если менеджер привязал свой Telegram.
        await this.telegramService.sendToUser(
          manager.id,
          `📋 <b>Клиент заполнил бриф</b>\n\n` +
          `👤 Клиент: <b>${escapeHtml(clientName)}</b>\n` +
          `📁 Проект: <b>${escapeHtml(p.name)}</b>\n` +
          `📊 Заполнено: <b>${percent}%</b> (${filledQs}/${totalQs})\n\n` +
          `👉 ${this.telegramService.appUrl}${projectLink}`,
        ).catch(() => {});
      }
    } catch (e: any) {
      this.logger.warn(`Brief notification to manager failed: ${e?.message || e}`);
    }

    return { ok: true };
  }

  /** Очистка брифа (полное удаление). Доступно только PM-ролям/админу. */
  async clearBrief(projectId: string, user: AccessUser & { id: string; role: string; name?: string }) {
    const project = await this.findOne(projectId);
    if (project.projectType !== 'SMM') {
      throw new ForbiddenException('Бриф доступен только для SMM-проектов');
    }
    const isAllowed = isSmmManagement(user) || project.managerId === user.id;
    if (!isAllowed) {
      throw new ForbiddenException('Нет прав на удаление брифа этого проекта');
    }
    // Вместе с брифом гасим и ссылку клиента (15.11.2026): иначе по старой
    // ссылке можно было снова заполнить уже удалённый бриф.
    await this.repo.update(projectId, { brief: null, briefShareToken: null } as any);
    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: projectId,
      entityName: project.name,
      details: { briefCleared: true },
    }).catch(() => {});
    this.gateway.broadcast('projects:changed', { projectId });
    return this.findOne(projectId, user);
  }

  // ─── Wave 13: автопересчёт финансовых полей ─────────────────────────

  /** Список финансовых полей, изменять которые могут только founder/co_founder. */
  private readonly FINANCE_FIELDS = [
    'totalContractValue',
    'outstandingAmount',
    'internalCostEstimate',
    'marginEstimate',
    'tariffLimitOveruseCost',
    'discount',
    'discountType',
    'monthlyFee',
    // paidAmount гвардится отдельно ниже (исторически был раньше)
  ] as const;

  /** Кто фиксирует «оплачено» (paidAmount): основатель и менеджер по
   *  продажам — только в проектах своего сегмента (по любой из двух ролей).
   *  Одно правило для create и update (15.11.2026). */
  private mayEditPaid(user: AccessUser | null | undefined, projectType?: string | null): boolean {
    if (hasAnyRole(user, ['founder'])) return true;
    const seg = getSalesSegmentOfUser(user);
    return !!seg && seg.projectTypes.includes(projectType || '');
  }

  /** Пересчитывает производные финансовые поля:
   *  - outstandingAmount = totalContractValue − paidAmount
   *  - marginEstimate    = totalContractValue − internalCostEstimate
   *  - tariffLimitOveruseCost — best-effort оценка по перерасходу * unit price
   *
   *  Не перезаписывает явно переданные значения если они отличаются от
   *  пересчёта (manual override имеет приоритет). */
  private async recomputeFinancials(
    target: Partial<Project>,
    existing: Partial<Project>,
    explicit: Set<string>,
  ): Promise<void> {
    const total = Number(
      target.totalContractValue ?? existing.totalContractValue ?? 0,
    );
    const paid = Number(target.paidAmount ?? existing.paidAmount ?? 0);
    const internalCost = Number(
      target.internalCostEstimate ?? existing.internalCostEstimate ?? 0,
    );
    const discountValue = Number(target.discount ?? existing.discount ?? 0);
    const discountType = (target.discountType ?? existing.discountType ?? 'fixed') as string;
    // В фиксированной скидке вычитаем сумму, в процентной — долю от подытога
    const discount = discountType === 'percent'
      ? (total * Math.min(100, Math.max(0, discountValue))) / 100
      : discountValue;
    // Эффективная сумма контракта после скидки — основа для margin/outstanding
    const effectiveTotal = Math.max(0, total - discount);

    if (!explicit.has('outstandingAmount') && total > 0) {
      // К оплате считаем от суммы со скидкой
      target.outstandingAmount = Math.max(0, effectiveTotal - paid);
    }
    if (!explicit.has('marginEstimate') && total > 0) {
      // Маржа = (контракт − скидка) − себестоимость
      target.marginEstimate = effectiveTotal - internalCost;
    }

    // Перерасход тарифа: считаем только если есть тариф и проект SMM.
    if (!explicit.has('tariffLimitOveruseCost')) {
      const tariffId = (target.tariffId ?? existing.tariffId) as string | undefined;
      const projectType = (target.projectType ?? existing.projectType) as string | undefined;
      const projectId = (existing.id ?? target.id) as string | undefined;
      if (tariffId && projectType === 'SMM' && projectId) {
        const tariff = await this.tariffRepo.findOne({ where: { id: tariffId } });
        if (tariff) {
          // У индивидуального тарифа лимиты и цена лежат в самом проекте —
          // в справочнике там нули, и перерасход не считался вовсе.
          const lim = effectiveLimits(tariff, (target.customTariff ?? existing.customTariff) as any);
          const totalPlanned =
            lim.storiesPerMonth + lim.reelsPerMonth + lim.postsPerMonth +
            (tariff.isCustom ? 0 : (tariff.designsPerMonth || 0));
          if (totalPlanned > 0) {
            const unitPrice = lim.monthlyPrice / totalPlanned;
            const overuseRows: Array<{ overuse: string }> = await this.repo.manager.query(
              `SELECT GREATEST(0,
                 SUM(CASE WHEN c.status = 'published' THEN 1 ELSE 0 END)
                 - $2::int
               ) AS overuse
               FROM content_plan_items c
               WHERE c."projectId" = $1
               GROUP BY c."contentType"`,
              [projectId, 0],
            );
            // Грубая оценка: для каждого type считаем published > limit
            // но т.к. лимиты разные, делаем точнее ниже:
            let totalOveruseUnits = 0;
            const types: Array<[string, number]> = [
              ['story', lim.storiesPerMonth],
              ['reel', lim.reelsPerMonth],
              ['post', lim.postsPerMonth],
              ['design', tariff.isCustom ? 0 : (tariff.designsPerMonth || 0)],
            ];
            for (const [type, limit] of types) {
              if (limit <= 0) continue;
              const r: Array<{ cnt: string }> = await this.repo.manager.query(
                `SELECT COUNT(*) AS cnt FROM content_plan_items
                 WHERE "projectId" = $1 AND "contentType" = $2 AND status = 'published'`,
                [projectId, type],
              );
              const published = Number(r?.[0]?.cnt || 0);
              totalOveruseUnits += Math.max(0, published - limit);
            }
            // Страховка: NaN/Infinity в decimal(15,2) Postgres проглотит, а
            // потом любой SUM() по колонке вернёт NaN и сломает финотчёты.
            const cost = Math.round(totalOveruseUnits * unitPrice * 100) / 100;
            target.tariffLimitOveruseCost = Number.isFinite(cost) ? cost : 0;
            void overuseRows; // подавляем unused
          }
        }
      }
    }
  }

  /** Авто-генерация шаблонного контент-плана из тарифа.
   *  Запускается ОДИН раз для проекта (флаг isAutoGeneratedFromTariff).
   *  Раскладывает deliverables (stories/reels/posts/designs) равномерно
   *  по durationDays тарифа от startBillingDate (или от createdAt). */
  private async generateContentPlanFromTariff(project: Project): Promise<void> {
    if (!project.tariffId || project.isAutoGeneratedFromTariff) return;
    if (project.projectType !== 'SMM') return;

    const tariff = await this.tariffRepo.findOne({ where: { id: project.tariffId } });
    if (!tariff) return;

    // У индивидуального тарифа в справочнике нули — цифры лежат в проекте.
    // Без effectiveLimits контент-план такому проекту не генерировался вовсе.
    const lim = effectiveLimits(tariff as any, project.customTariff as any);
    const buckets: Array<{ type: ContentItemType; count: number; label: string }> = [
      { type: ContentItemType.STORY,  count: lim.storiesPerMonth, label: 'История' },
      { type: ContentItemType.REEL,   count: lim.reelsPerMonth,   label: 'Reels' },
      { type: ContentItemType.POST,   count: lim.postsPerMonth,   label: 'Пост' },
      // Макет у индивидуального тарифа — это Post (см. форму проекта),
      // отдельного счётчика дизайнов у него нет.
      { type: ContentItemType.DESIGN, count: tariff.isCustom ? 0 : (tariff.designsPerMonth || 0), label: 'Дизайн' },
    ];

    const totalUnits = buckets.reduce((s, b) => s + b.count, 0);
    if (totalUnits === 0) return;

    const startDate = project.startBillingDate
      ? new Date(project.startBillingDate)
      : new Date(project.createdAt || Date.now());
    const durationMs = (tariff.durationDays || 30) * 24 * 60 * 60 * 1000;

    const items: Partial<ContentPlanItem>[] = [];
    for (const bucket of buckets) {
      if (bucket.count <= 0) continue;
      const stepMs = durationMs / bucket.count;
      for (let i = 0; i < bucket.count; i++) {
        const publishDate = new Date(startDate.getTime() + Math.round(stepMs * (i + 0.5)));
        const preparationDeadline = new Date(publishDate.getTime() - 24 * 60 * 60 * 1000);
        items.push({
          projectId: project.id,
          contentType: bucket.type,
          topic: `${bucket.label} #${i + 1}`,
          publishDate,
          preparationDeadline,
          pmId: project.managerId,
        });
      }
    }

    try {
      await this.contentPlanService.createMany(items);
      // Стартовые задачи запуска SMM-проекта (TZ п.2)
      await this.generateStarterTasksFromTariff(project, tariff, lim);
      await this.repo.update(project.id, { isAutoGeneratedFromTariff: true });
    } catch (e: any) {
      // Авто-генерация не должна блокировать создание проекта.
      // eslint-disable-next-line no-console
      console.warn('content plan auto-generation failed:', e?.message);
    }
  }

  /** Wave 18: создаёт стартовый набор задач для нового SMM-проекта с тарифом.
   *  Это последняя необработанная часть TZ п.2 («автоматически создаётся
   *  стартовый набор задач»). Задачи назначаются на менеджера проекта. */
  private async generateStarterTasksFromTariff(
    project: Project,
    tariff: SmmTariff,
    lim: TariffLimits,
  ): Promise<void> {
    const start = project.startBillingDate
      ? new Date(project.startBillingDate)
      : new Date(project.createdAt || Date.now());
    const day = (n: number) => {
      const d = new Date(start);
      d.setDate(d.getDate() + n);
      return d;
    };

    const templates: Array<Partial<Task>> = [
      {
        title: 'Брифинг с клиентом и сбор материалов',
        description: 'Провести стартовую встречу, собрать референсы, бренд-материалы, фото/видео.',
        priority: TaskPriority.HIGH,
        deadline: day(2),
        estimatedHours: 2,
      },
      {
        title: 'Запросить и проверить доступы',
        description: 'Доступы к Instagram, TikTok, Facebook, рекламным кабинетам.',
        priority: TaskPriority.HIGH,
        deadline: day(3),
        estimatedHours: 1,
      },
      {
        title: 'Подготовить контент-стратегию на месяц',
        description: `Тариф "${tariff.name}": ${lim.storiesPerMonth} историй, ${lim.reelsPerMonth} рилсов, ${lim.postsPerMonth} макетов${tariff.isCustom ? '' : `, ${tariff.designsPerMonth} дизайнов`} в месяц.`,
        priority: TaskPriority.HIGH,
        deadline: day(5),
        estimatedHours: 4,
      },
      {
        title: 'Согласовать контент-план с клиентом',
        description: 'Отправить план на согласование, собрать правки, утвердить.',
        priority: TaskPriority.MEDIUM,
        deadline: day(7),
        estimatedHours: 2,
      },
    ];

    if ((tariff.shootingDaysPerMonth || 0) > 0) {
      templates.push({
        title: 'Запланировать первую съёмку',
        description: `По тарифу полагается ${tariff.shootingDaysPerMonth} съёмочных дней в месяц.`,
        priority: TaskPriority.MEDIUM,
        deadline: day(10),
        estimatedHours: 1,
      });
    }

    if (lim.reportsPerMonth > 0) {
      templates.push({
        title: 'Подготовить шаблон ежемесячного отчёта',
        description: `Клиент ожидает ${lim.reportsPerMonth} отчётов в месяц.`,
        priority: TaskPriority.LOW,
        deadline: day(14),
        estimatedHours: 1,
      });
    }

    const tasks = templates.map(t => this.taskRepo.create({
      ...t,
      projectId: project.id,
      assigneeId: project.managerId,
      createdById: project.managerId,
      status: TaskStatus.NEW,
      deliveryType: 'task',
    }));

    if (tasks.length === 0) return;

    try {
      await this.taskRepo.save(tasks);
      // Стартовые задачи — тоже «задачи изменились» (08.11.2026): событие
      // проекта списки задач не обновляет, они появлялись только по опросу.
      this.gateway.broadcast('tasks:changed', { projectId: project.id, kind: 'create' });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('starter tasks generation failed:', e?.message);
    }
  }

  /** Удаляет финансовые поля из проекта/списка для тех ролей которые
   *  не должны их видеть. Полный доступ — только founder.
   *  Менеджер по продажам (основной или второй ролью) видит
   *  paidAmount/budget/totalContractValue/outstanding/monthlyFee и цену
   *  индивидуального тарифа ТОЛЬКО у своих проектов — где он ответственный
   *  (salesManagerId или smmData.salesManagerId; «Продажи, этап 2»,
   *  15.11.2026: деньги только своих клиентов). Маржу/себестоимость/
   *  тариф-цену не видит нигде.
   *  Руководители направлений (smm_director / dev_director) видят ТОЛЬКО
   *  budget (планирование объёма работ), всё остальное финансовое — скрыто.
   *  Прочие роли — финансы полностью скрыты.
   *  viewer — пользователь (нужен id для «своих») или, по-старому, роль:
   *  по одной роли «свой» не определить, и МП суммы не получает. */
  stripFinance<T extends Project | Project[]>(data: T, viewer?: string | (AccessUser & { role?: string | null }) | null): T {
    const user: AccessUser | null = typeof viewer === 'string' ? { role: viewer } : (viewer ?? null);
    const role = user?.role ?? undefined;
    const isFinance = role === 'founder';
    if (isFinance) return data;
    const isSales = !!salesRoleOf(user);
    const isProjectManager = typeof viewer === 'string'
      ? role === 'smm_director' || role === 'dev_director'
      : hasAnyRole(user, ['smm_director', 'dev_director']);
    const strip = (p: any) => {
      if (!p) return p;
      // Деньги проекта менеджеру продаж — только у своего клиента.
      const salesMoney = isSales && !!user?.id && isAssignedSalesManager(user, p);
      // Поля связанные с маржой/прибыльностью — только finance role видит
      delete p.internalCostEstimate;
      delete p.marginEstimate;
      delete p.tariffLimitOveruseCost;
      delete p.tariffPriceSnapshot;
      delete p.discount;
      delete p.discountType;
      // paidAmount/totalContractValue/outstandingAmount/monthlyFee —
      // только finance и менеджер этого проекта (сумма следующей оплаты).
      if (!salesMoney) {
        delete p.paidAmount;
        delete p.totalContractValue;
        delete p.outstandingAmount;
        delete p.monthlyFee;
      }
      // budget — свой менеджер продаж + руководители направлений, прочим скрываем
      if (!salesMoney && !isProjectManager) {
        delete p.budget;
      }
      // customTariff держит и лимиты, и цену индивидуального тарифа. Лимиты
      // нужны всем (по ним рисуется доска), а цену — только тем, кто её и
      // задаёт; менеджеру продаж — только у своего проекта. Остальным
      // отдаём объект без цены.
      const seePrice = CUSTOM_PRICE_ROLES.includes(role as string) && (!isSales || salesMoney);
      if (p.customTariff && typeof p.customTariff === 'object' && !seePrice) {
        const { monthlyPrice: _hidden, ...rest } = p.customTariff as Record<string, any>;
        p.customTariff = rest;
      }
      return p;
    };
    return Array.isArray(data) ? (data.map(strip) as T) : (strip(data) as T);
  }

  async findAll(
    search?: string,
    status?: ProjectStatus,
    managerId?: string,
    archived = false,
    requestUser?: { id: string; role: string },
  ) {
    const qb = this.repo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manager', 'manager')
      .leftJoinAndSelect('p.members', 'members')
      .loadRelationCountAndMap('p.taskCount', 'p.tasks')
      .loadRelationCountAndMap('p.doneTaskCount', 'p.tasks', 'doneTask', qb =>
        qb.where('doneTask.status = :s', { s: 'done' }),
      )
      // Служебный проект «Одноразовые съёмки» — не показываем в списках
      // проектов/аналитике/продажах: его карточки живут на доске проектов.
      .where('p."isOneOffSystem" = false');

    // Для менеджера продаж «архив» — личный: он скрывает проект у себя, не
    // трогая остальных. Поэтому в его личном архиве лежат ОБЫЧНЫЕ (не
    // архивированные компанией) проекты, и общий флаг isArchived к списку не
    // применяется — условие добавляется ниже, после определения роли.
    // Вторая роль dev_director (Сабрина) — архив ОБЩИЙ, как у smm_director.
    const devDirectorSecond = (requestUser as any)?.secondaryRole === 'dev_director';
    const personalArchive = archived && isSalesManager(requestUser?.role) && !devDirectorSecond;
    if (!personalArchive) {
      qb.andWhere('p.isArchived = :archived', { archived });
    } else {
      qb.andWhere('p.isArchived = false');
    }

    // RBAC: filter by role using SUBQUERY (not the joined members table)
    // so leftJoinAndSelect still loads ALL members in the result
    if (requestUser) {
      const { id: userId, role } = requestUser;
      // Сторисмейкер должен видеть все активные SMM-проекты — его работа
      // покрывает истории по всему продакшну, а не только мемберским.
      // Подгружаем флаг разово из employees (легче чем хранить в JWT).
      const emp = await this.employeeRepo.findOne({
        where: { userId },
        select: ['id', 'isStoryMaker'] as any,
      }).catch(() => null);
      // Роль «сторисмейкер» убрана (25.09.2026) — остался флаг isStoryMaker
      // на карточке сотрудника: он и даёт доступ ко всем SMM-проектам для
      // отметки историй.
      const isStoryMaker = !!emp?.isStoryMaker;

      // ВАЖНО: направление проверяется ПЕРВЫМ и грантом не обходится. Роли
      // ниже имеют 'projects.view' нативно, и раньше грант срабатывал раньше
      // фильтра — менеджеру продаж по СММ показывались проекты разработки.
      // Грант снимает ограничение по членству, но не по направлению.
      // Направление — по ОБЕИМ ролям (15.11.2026, project-access.directionTypesOf):
      //  • менеджер продаж — только типы своего сегмента (у МП-dev несколько
      //    подтипов: Лендинг, Телеграм бот, CRM, Интернет магазин + legacy
      //    «Web сайт»). Раньше МП второй ролью попадал в ветку гранта ниже
      //    (projects.view у МП нативный) и видел проекты обоих направлений;
      //  • smm_director / smm_specialist / producer — ВСЕ SMM-проекты
      //    (решение владельца, сент. 2026; продюсер — 09.11.2026); отмечать
      //    сторис специалист может только по своим (StoriesService.upsert);
      //  • pm_dev / developer / dev_director — ВСЕ dev-проекты без членства:
      //    иначе карточку можно назначить разработчику вне состава проекта,
      //    а он её не увидит.
      // Две роли разных направлений — объединение.
      const dirTypes = directionTypesOf(requestUser as any);
      if (dirTypes) {
        qb.andWhere('p.projectType IN (:...dirTypes)', { dirTypes });
      } else if (hasGrant(requestUser as any, 'projects.view')) {
        // Персональный грант «Проекты — просмотр», выданный роли без своего
        // направления — видит ВСЕ проекты компании.
      } else if (isStoryMaker) {
        // Сторисмейкер (флаг на Employee) — все активные SMM-проекты,
        // вне зависимости от членства. Как smm_director, но только в SMM.
        qb.andWhere('p.projectType = :smmType', { smmType: 'SMM' });
      } else if (!['admin', 'founder'].includes(role)) {
        // All other roles: видят проекты где они member ИЛИ менеджер
        // (project.managerId === userId). Раньше учитывалось только
        // membership — sm­m_specialist'а, повышенного до manager'а отдельного
        // проекта, отсекали из списка, и он не мог даже создать в нём задачу.
        // + проекты, где сотрудник назначен SMM-специалистом (smmData.smmSpecialistIds):
        // назначение через «Схему»/поле проекта должно открывать проект в его
        // кабинете даже без членства (иначе панель дня видела только member-проекты).
        qb.andWhere(
          `(p.managerId = :userId OR p.id IN (
            SELECT pm."projectsId" FROM project_members pm
            WHERE pm."usersId" = :userId
          ) OR jsonb_exists(COALESCE(p."smmData"->'smmSpecialistIds', '[]'::jsonb), :userId))`,
          { userId },
        );
      }
      // admin, founder & co_founder see all — no extra filter

      // Личный архив менеджера продаж. Список активных проектов — без
      // скрытых им; «Архив» (archived=true) для него — это и есть его личный
      // список скрытых, а не общий архив компании (общий архив ведут
      // руководство и руководитель СММ).
      // Личный список скрытых действует только для «чистого» менеджера продаж.
      // У руководителя направления архив общий, поэтому и скрытия применять
      // нельзя: иначе спрятанный когда-то dev-проект пропадал бы и из списка
      // (отфильтрован), и из архива (там теперь только isArchived=true) —
      // вернуть его было бы нечем.
      if (isSalesManager(role) && !devDirectorSecond) {
        const hiddenSql = `SELECT ph.project_id FROM project_hidden ph WHERE ph.user_id = :hideUid`;
        if (archived) {
          qb.andWhere(`p.id IN (${hiddenSql})`, { hideUid: userId });
        } else {
          qb.andWhere(`p.id NOT IN (${hiddenSql})`, { hideUid: userId });
        }
      }
    }

    if (status) qb.andWhere('p.status = :status', { status });
    if (managerId) qb.andWhere('p.managerId = :managerId', { managerId });
    if (search) qb.andWhere('p.name ILIKE :search', { search: `%${search}%` });

    const projects = await qb.orderBy('p.createdAt', 'DESC').getMany();

    // hasActiveAd (идёт ли реклама) больше не считаем (15.11.2026): фронт
    // поле не читал, а запрос к project_ads шёл на каждый список проектов.

    // Время последней активности проекта = максимум из updatedAt проекта
    // и updatedAt связанных задач. Показывается на карточке проекта.
    const projIds = projects.map(p => p.id);
    if (projIds.length > 0) {
      const taskRows = await this.repo.manager.query(
        `SELECT "projectId", MAX("updatedAt") AS last FROM tasks
         WHERE "projectId" = ANY($1::uuid[]) GROUP BY "projectId"`,
        [projIds],
      );
      const taskLastMap: Record<string, string> = Object.fromEntries(
        (taskRows as Array<{ projectId: string; last: string }>).map(r => [r.projectId, r.last]),
      );
      for (const p of projects) {
        const times = [p.updatedAt, taskLastMap[p.id]]
          .filter(Boolean)
          .map(d => new Date(d as any).getTime());
        (p as any).lastActivityAt = times.length
          ? new Date(Math.max(...times)).toISOString()
          : null;
      }

      // Дата последней полученной оплаты — менеджер продаж видит на карточке
      // «дату оплаты» вместо дедлайна проекта.
      const payRows = await this.repo.manager.query(
        `SELECT "projectId", MAX("paidAt")::text AS last FROM project_payments
         WHERE "projectId" = ANY($1::uuid[]) AND amount > 0 GROUP BY "projectId"`,
        [projIds],
      );
      const payMap: Record<string, string> = Object.fromEntries(
        (payRows as Array<{ projectId: string; last: string }>).map(r => [r.projectId, r.last]),
      );
      for (const p of projects) {
        (p as any).lastPaymentAt = payMap[p.id] ?? null;
      }
    }

    // Деньги — по пользователю (15.11.2026): МП видит суммы только своих проектов.
    const stripped = this.stripFinance(projects, requestUser ?? null);
    // Лёгкий состав для списка (фронт рисует стек без второго запроса):
    // manager в том же виде, что в карточке + membersCount + первые 5.
    // members уже загружены одним join выше — новых запросов нет (N+1 нет).
    // Пагинации/фильтров здесь нет — порядок/фильтры выше не трогаем.
    return (stripped as any[]).map((p: any) => {
      const all = Array.isArray(p.members) ? p.members : [];
      // Бриф, контакты клиента и ссылка для клиента в список не уходят
      // (15.11.2026): список видят все роли, а ни одному экрану списка они
      // не нужны. Бриф и контакты — в карточке проекта (GET /projects/:id).
      const { brief: _brief, clientInfo: _clientInfo, briefShareToken: _token, ...rest } = p;
      return {
        ...rest,
        manager: this.toManagerView(p.manager),
        members: all
          .slice(0, 5)
          .map((m: any) => ({ id: m.id, name: m.name, avatar: m.avatar ?? null })),
        membersCount: all.length,
      };
    });
  }

  /** viewer — роль (как раньше) или пользователь: по пользователю деньги
   *  отдаются менеджеру продаж у его проектов (15.11.2026). */
  async findOne(id: string, viewer?: string | (AccessUser & { role?: string | null })) {
    const requestUserRole: string | undefined = typeof viewer === 'string' ? viewer : (viewer?.role ?? undefined);
    // Мусорный UUID в :id → 400, а не 500 от Postgres (invalid input syntax).
    if (typeof id !== 'string' || !ProjectsService.UUID_RE.test(id)) {
      throw new BadRequestException(`Некорректный UUID проекта: ${String(id)}`);
    }
    const project = await this.repo.findOne({
      where: { id },
      relations: ['manager', 'members', 'tasks', 'tasks.assignee', 'files'],
    });
    if (!project) throw new NotFoundException('Project not found');
    // Менеджер продаж не может открыть проект чужого направления.
    // Исключение — SMM-проекты: раздел «СММ» открыт обоим видам менеджеров по
    // продажам на просмотр, и ответственным за SMM-проект владелец может
    // назначить любого из них (решение 11.10.2026, подтверждено 15.10.2026).
    const segment = getSalesSegment(requestUserRole);
    if (segment && !segment.projectTypes.includes(project.projectType as string) && project.projectType !== 'SMM') {
      throw new ForbiddenException('Проект не относится к вашему направлению');
    }
    // ПМ по разработке — только dev-проекты (SMM/Дизайн не его направление).
    if (['pm_dev', 'dev_director'].includes(requestUserRole as string) && !DEV_PROJECT_TYPES.includes(project.projectType as string)) {
      throw new ForbiddenException('Проект не относится к направлению разработки');
    }
    // Разработчик SMM-проекты не открывает даже по ссылке — как и в списке,
    // где ему отдаются только dev-проекты.
    if (requestUserRole === 'developer' && project.projectType === 'SMM') {
      throw new ForbiddenException('Проект не относится к направлению разработки');
    }
    // Задачи-«Истории» из контент-плана не показываем в списке задач проекта —
    // они ведутся во вкладке «Контент-план». Скрываем для всех ролей.
    if (Array.isArray(project.tasks) && project.tasks.length > 0) {
      const storyRows = await this.repo.manager.query(
        `SELECT "taskId" FROM content_plan_items
         WHERE "projectId" = $1 AND "contentType" = 'story' AND "taskId" IS NOT NULL`,
        [id],
      );
      const storyTaskIds = new Set(
        (storyRows as Array<{ taskId: string }>).map(r => r.taskId),
      );
      if (storyTaskIds.size > 0) {
        project.tasks = project.tasks.filter(t => !storyTaskIds.has(t.id));
      }
    }
    // Дата последней полученной оплаты (для карточки «Дата оплаты» у МП).
    const payRow = await this.repo.manager.query(
      `SELECT MAX("paidAt")::text AS last FROM project_payments
       WHERE "projectId" = $1 AND amount > 0`,
      [id],
    ).catch(() => [] as any[]);
    (project as any).lastPaymentAt = payRow?.[0]?.last ?? null;

    // Состав проекта: manager {id,name,role,avatar}|null и
    // members [{id,name,role,avatar}]. Маппим по УЖЕ загруженным relations
    // (один запрос выше) — N+1 не плодим. Остальные поля (tasks/files/smm…)
    // не трогаем.
    const withFinance = viewer ? this.stripFinance(project, viewer) : project;
    const rawMembers = Array.isArray((withFinance as any).members)
      ? (withFinance as any).members
      : [];
    return {
      ...(withFinance as any),
      manager: this.toManagerView((withFinance as any).manager),
      members: rawMembers
        .map((m: any) => this.toMemberView(m))
        .filter((m: any) => !!m),
    };
  }

  /** Карточка проекта для GET /projects/:id (15.11.2026): сначала право
   *  видеть проект (project-access.canViewProject — то же правило, что у
   *  списка, плюс свой проект, команда производства и исполнители), потом
   *  деньги по роли. Ссылку клиента на бриф получает только тот, кто ведёт
   *  бриф. Внутренние вызовы findOne(id, role) не меняются. */
  async findOneForUser(id: string, user: AccessUser & { role?: string }) {
    this.assertUuidOr400(id, 'id');
    await assertCanViewProject(this.repo.manager, user, id);
    const project: any = this.stripFinance(await this.findOne(id) as any, user);
    if (!this.canManageBrief(user, project)) delete project.briefShareToken;
    return project;
  }

  /** Проверка «видит ли проект» для соседних ручек (профиль, чеклист, объявления). */
  async assertCanView(id: string, user: AccessUser | null | undefined) {
    this.assertUuidOr400(id, 'id');
    return assertCanViewProject(this.repo.manager, user, id);
  }

  /** Деньги проекта (оплаты, запрос оплаты клиенту).
   *  • Руководство компании — без ограничений.
   *  • Руководитель направления (основной или второй ролью) — всё своё
   *    направление (15.11.2026).
   *  • Менеджер по продажам — только СВОЙ проект, где он ответственный
   *    (salesManagerId или smmData.salesManagerId): «Продажи, этап 2»,
   *    15.11.2026 — раньше хватало своего направления, и МП видел оплаты
   *    чужих клиентов.
   *  • Прочие (право выдано грантом) — своё направление, как раньше. */
  private assertMoneyScope(user: AccessUser | null | undefined, p: { projectType?: string | null; salesManagerId?: string | null; smmData?: any }) {
    if (!user || isTop(user)) return;
    const directorTypes = rolesOf(user).flatMap(r => DIRECTOR_MONEY_TYPES[r] || []);
    if (directorTypes.includes(p.projectType || '')) return;
    if (salesRoleOf(user)) {
      if (isAssignedSalesManager(user, p)) return;
      throw new ForbiddenException('Это не ваш клиент: оплаты видит ответственный менеджер проекта');
    }
    if (inDirection(user, p.projectType)) return;
    throw new ForbiddenException('Проект не относится к вашему направлению');
  }

  /** Guard: smm_director может быть менеджером только SMM-проектов.
   *  Любой другой сотрудник может быть назначен менеджером любого проекта —
   *  назначение даёт ему руководство этим проектом (без отдельной роли). */
  private async validateManagerAssignment(managerId: string | undefined, projectType: string | undefined) {
    if (!managerId) return;
    const mgr = await this.userRepo.findOne({ where: { id: managerId } });
    if (!mgr) return;
    if (mgr.role === UserRole.SMM_DIRECTOR && projectType !== 'SMM') {
      throw new ForbiddenException(
        'Руководитель SMM может быть менеджером только SMM-проектов',
      );
    }
    if (mgr.role === UserRole.DEV_DIRECTOR && !DEV_PROJECT_TYPES.includes(projectType as string)) {
      throw new ForbiddenException(
        'Руководитель разработки может быть менеджером только проектов разработки',
      );
    }
  }

  /** Состав dev-проекта: кто ведёт (PM) и кто вовлечён (members).
   *  Только additive — SMM-логику не затрагивает. Все маппинги работают по
   *  УЖЕ загруженным relations (findOne/findAll грузят manager+members одним
   *  запросом), новых запросов на проект не добавляется — N+1 нет. */
  private static readonly UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Мусорный UUID → 400 (не 500 от Postgres). Вызывается до любых запросов
   *  с этим id, чтобы невалидный формат не уходил в SQL. */
  private assertUuidOr400(id: unknown, field: string): asserts id is string {
    if (typeof id !== 'string' || !ProjectsService.UUID_RE.test(id)) {
      throw new BadRequestException(`Некорректный UUID в поле ${field}: ${String(id)}`);
    }
  }

  /** managerId: undefined = не менять, null = снять, UUID = назначить.
   *  Проверяет существование и isActive (нет → 400). */
  private async validateTeamManagerId(managerId: string | null | undefined): Promise<void> {
    if (managerId === undefined || managerId === null) return;
    this.assertUuidOr400(managerId, 'managerId');
    const mgr = await this.userRepo.findOne({ where: { id: managerId } });
    if (!mgr) throw new BadRequestException(`Менеджер не найден: ${managerId}`);
    if (!mgr.isActive) throw new BadRequestException(`Менеджер деактивирован: ${mgr.name || managerId}`);
  }

  /** memberIds: дедуп, cap 30, UUID-формат, существование + isActive.
   *  Возвращает дедупнутый список. Пустой массив = очистить состав (это
   *  валидно и отличается от undefined = поле не передано). */
  private async resolveTeamMemberIds(raw: unknown): Promise<string[]> {
    if (!Array.isArray(raw)) {
      throw new BadRequestException('memberIds должен быть массивом UUID');
    }
    for (const v of raw) {
      if (typeof v !== 'string') throw new BadRequestException(`Некорректный UUID в поле memberIds: ${String(v)}`);
      this.assertUuidOr400(v, 'memberIds');
    }
    const uniq = [...new Set(raw as string[])];
    if (uniq.length > 30) {
      throw new BadRequestException('memberIds: не более 30 участников');
    }
    if (uniq.length === 0) return [];
    // Один запрос на всех (In) — N+1 нет.
    const users = await this.userRepo.find({ where: { id: In(uniq) } });
    const byId = new Map(users.map(u => [u.id, u] as const));
    for (const id of uniq) {
      const u = byId.get(id);
      if (!u) throw new BadRequestException(`Пользователь не найден: ${id}`);
      if (!u.isActive) throw new BadRequestException(`Пользователь деактивирован: ${u.name || id}`);
    }
    return uniq;
  }

  /** manager → {id,name,role,avatar}|null для GET /projects и GET /projects/:id. */
  private toManagerView(u: any): { id: string; name: string; role: string; avatar: string | null } | null {
    if (!u || !u.id) return null;
    return { id: u.id, name: u.name, role: u.role, avatar: u.avatar ?? null };
  }

  /** member для карточки (GET :id): {id,name,role,avatar}. */
  private toMemberView(u: any): { id: string; name: string; role: string; avatar: string | null } | null {
    if (!u || !u.id) return null;
    return { id: u.id, name: u.name, role: u.role, avatar: u.avatar ?? null };
  }

  /** Индивидуальные лимиты имеют смысл только на тарифе с пометкой
   *  isCustom. На обычном тарифе цифры берутся из справочника, поэтому
   *  присланный объект отбрасываем — иначе в проекте копились бы значения,
   *  которые нигде не участвуют и вводят в заблуждение. */
  private async normalizeCustomTariff(
    dto: { customTariff?: any; tariffId?: string },
    currentTariffId?: string | null,
    userRole?: string,
    currentCustom?: Record<string, any> | null,
  ): Promise<Record<string, any> | null | undefined> {
    if (!('customTariff' in dto)) return undefined;
    const tariffId = dto.tariffId ?? currentTariffId;
    if (!tariffId) return null;
    const tariff = await this.tariffRepo.findOne({ where: { id: tariffId } }).catch(() => null);
    if (!tariff?.isCustom) return null;
    const clean = sanitizeCustomTariff(dto.customTariff);
    // Цену задаёт тот же круг, что её и видит (см. stripFinance). Прочим
    // ролям с правом на редактирование проекта лимиты менять можно, а цену —
    // нет: оставляем прежнюю, чтобы правка лимитов её не обнуляла.
    if (!CUSTOM_PRICE_ROLES.includes(userRole as string)) {
      const prev = Number(currentCustom?.monthlyPrice || 0);
      if (!clean) return prev > 0 ? { monthlyPrice: prev } : null;
      if (prev > 0) clean.monthlyPrice = prev;
      else delete clean.monthlyPrice;
    }
    return clean;
  }

  async create(dto: CreateProjectDto, userId: string, userRole?: string, userSecondaryRole?: string | null) {
    // smm_director может создавать только SMM-проекты
    if (userRole === UserRole.SMM_DIRECTOR && dto.projectType !== 'SMM') {
      throw new ForbiddenException('Руководитель SMM может создавать только SMM-проекты');
    }
    // Руководитель разработки — только проекты своего направления. Проверка
    // ДО тарифов и прочей валидации: иначе на попытке создать SMM-проект он
    // получал бы «Выберите SMM-тариф» вместо честного «не ваше направление».
    // Роль может быть и второй (у Сабрины поверх «МП по разработке»).
    if ((userRole === UserRole.DEV_DIRECTOR || userSecondaryRole === UserRole.DEV_DIRECTOR)
        && !DEV_PROJECT_TYPES.includes(dto.projectType as string)) {
      throw new ForbiddenException('Руководитель разработки может создавать только проекты разработки');
    }
    // SMM-проект без тарифа не создаётся: все тарифы действуют 1 месяц,
    // от тарифа считаются лимиты/финансы. Старые проекты без тарифа
    // остаются как есть — проверка только на создание.
    if (dto.projectType === 'SMM' && !dto.tariffId && !dto.allowNoTariff) {
      throw new BadRequestException('Выберите SMM-тариф — без него проект не создаётся');
    }
    delete (dto as any).allowNoTariff; // служебный флаг, не поле проекта
    // Менеджер продаж может создавать проекты только своего направления.
    const createSegment = getSalesSegment(userRole);
    if (createSegment && !createSegment.projectTypes.includes(dto.projectType as string)) {
      throw new ForbiddenException(
        `Вы можете создавать только проекты типов: ${createSegment.projectTypes.map(projectTypeLabel).join(', ')}`,
      );
    }
    await this.validateManagerAssignment(dto.managerId, dto.projectType);
    // Деньги и служебные ключи при создании — по тем же правилам, что при
    // правке (15.11.2026). Раньше `...dto` клал в проект любые финансовые
    // поля от всякого, у кого есть projects.create.
    const actor: AccessUser = { id: userId, role: userRole ?? null, secondaryRole: userSecondaryRole ?? null };
    // Проект по заявке продаж (15.11.2026): лид проверяем ДО создания —
    // иначе проект появился бы, а связь с лидом молча не встала.
    const lead = dto.leadId ? await this.leadForNewProject(dto.leadId, actor) : null;
    if (!lead) delete (dto as any).leadId;
    if (!hasAnyRole(actor, ['founder'])) {
      for (const f of this.FINANCE_FIELDS) delete (dto as any)[f];
    }
    if (!this.mayEditPaid(actor, dto.projectType)) delete (dto as any).paidAmount;
    // Технические снимки и флаги проекта сервер ставит сам.
    for (const f of ['tariffNameSnapshot', 'tariffPriceSnapshot', 'isAutoGeneratedFromTariff', 'briefShareToken', 'brief', 'launchChecklist']) {
      delete (dto as any)[f];
    }
    if ('smmData' in dto) {
      const raw = (dto as any).smmData;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const sd: Record<string, any> = { ...raw };
        // Ответственного менеджера и его историю назначает только основатель
        // (PATCH /projects/:id/smm-manager), TikTok выключает руководство.
        if (!hasAnyRole(actor, ['founder'])) { delete sd.salesManagerId; delete sd.salesManagerHistory; }
        if (!hasAnyRole(actor, ['admin', 'founder', 'smm_director'])) delete sd.tiktokOff;
        // Журнал переключений TikTok ведёт только сервер (PATCH smm-profile).
        delete sd.tiktokLog;
        (dto as any).smmData = sd;
      } else {
        delete (dto as any).smmData;
      }
    }
    // Менеджер проекта всегда должен быть в members — иначе он не пройдёт
    // member-проверки в задачах и не появится в дропдаунах assignee.
    const resolvedManagerId = dto.managerId || userId;
    const memberIds = new Set<string>(dto.memberIds || []);
    if (resolvedManagerId) memberIds.add(resolvedManagerId);
    // МП сам автоматически становится salesManager своих проектов —
    // он же продал, у него же напоминание об оплате через 2 недели.
    // Проект по заявке продаж (15.11.2026): менеджер не выбран — им
    // становится владелец лида (если он менеджер продаж): он клиента продал,
    // и по правилу «деньги только своих» должен видеть его оплаты. Выбранный
    // основателем в smmData — важнее владельца лида.
    const keptSmmManager = typeof (dto as any).smmData?.salesManagerId === 'string' && (dto as any).smmData.salesManagerId
      ? (dto as any).smmData.salesManagerId as string
      : undefined;
    const leadManagerId = lead?.ownerIsSales ? (lead.ownerId as string) : undefined;
    const resolvedSalesManagerId = dto.salesManagerId
      || (createSegment ? userId : undefined)
      || (lead ? keptSmmManager || leadManagerId : undefined);
    const custom = await this.normalizeCustomTariff(dto, null, userRole, null);
    const project = this.repo.create({
      ...dto,
      ...(custom !== undefined ? { customTariff: custom as any } : {}),
      managerId: resolvedManagerId,
      salesManagerId: resolvedSalesManagerId,
      members: Array.from(memberIds).map(id => ({ id })) as unknown as User[],
    });
    // If a tariff was selected → snapshot its name+price into the project so
    // future tariff renames/deletions don't rewrite history.
    if (dto.tariffId) {
      await this.applyTariffSnapshot(project, dto.tariffId, custom);
    }

    // Team — snapshot имени, чтобы переименование/удаление команды
    // не ломало карточку проекта.
    if (dto.teamId) {
      const team = await this.teamRepo.findOne({ where: { id: dto.teamId } });
      if (team) {
        project.teamId = team.id;
        project.teamNameSnapshot = team.name;
      }
    }

    // Wave 13: при создании пересчитываем outstanding/margin (overuse_cost
    // в этот момент 0 — контент-плана ещё нет).
    const explicitOnCreate = new Set<string>();
    for (const f of this.FINANCE_FIELDS) {
      if ((dto as any)[f] != null) explicitOnCreate.add(f);
    }
    await this.recomputeFinancials(project, project, explicitOnCreate);

    // По умолчанию SMM-проект = 20 сторис/месяц (дневная норма = round(20/30) = 1),
    // если норма ещё не задана явно. Редактируется на странице проекта (0–100).
    if (project.projectType === 'SMM') {
      const sd: any = { ...(project.smmData || {}) };
      if (sd.storiesPerMonth == null) { sd.storiesPerMonth = 20; sd.storiesPerDay = 1; }
      // Ответственный SMM-проекта по заявке — тот же владелец лида и в
      // smmData (по нему календарь денег и оплаты на «Панели»), с первой
      // записью истории назначений. Только когда менеджер не выбран вручную.
      if (leadManagerId && resolvedSalesManagerId === leadManagerId
          && !(typeof sd.salesManagerId === 'string' && sd.salesManagerId)) {
        sd.salesManagerId = leadManagerId;
        sd.salesManagerHistory = withManagerChange(null, null, leadManagerId, dushanbeToday());
      }
      project.smmData = sd;
    }

    const saved = await this.repo.save(project);

    // Связь с лидом продаж: лид → проект, событие в ленте лида, менеджеру —
    // «Проект создан». Сбой здесь проект не откатывает (он уже создан).
    if (lead) {
      await this.linkLeadToProject(lead, saved, userId).catch((e: any) =>
        this.logger.warn(`Связь лида ${lead.id} с проектом ${saved.id} не записана: ${e?.message || e}`));
    }

    // Транши оплаты: создаём ProjectPayment записи и суммируем в paidAmount.
    // Доступно ролям, которые могут создавать/редактировать проект (включая
    // руководителей направлений — в т.ч. второй ролью, как dev_director у
    // Сабрины).
    const PAYMENT_ROLES = ['admin', 'founder', 'smm_director', 'dev_director'];
    if (Array.isArray((dto as any).initialPayments) && (dto as any).initialPayments.length > 0
        && (PAYMENT_ROLES.includes(userRole as string)
            || PAYMENT_ROLES.includes(userSecondaryRole as string))) {
      const items = (dto as any).initialPayments as Array<{ amount: number; paidAt: string; note?: string }>;
      let totalDelta = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const amount = Number(it.amount || 0);
        if (!amount || amount <= 0 || !it.paidAt) continue;
        await this.paymentRepo.save(this.paymentRepo.create({
          projectId: saved.id,
          amount,
          paidAt: new Date(it.paidAt),
          recordedById: userId,
          note: it.note?.trim() || `Транш ${i + 1}`,
        }));
        totalDelta += amount;
      }
      if (totalDelta > 0) {
        saved.paidAmount = Number(saved.paidAmount || 0) + totalDelta;
        await this.recomputeFinancials(saved, saved, new Set());
        await this.repo.update(saved.id, {
          paidAmount: saved.paidAmount,
          outstandingAmount: saved.outstandingAmount,
        });
      }
    }

    // Авто-генерация контент-плана для SMM-проекта с тарифом.
    // Best-effort — ошибка не должна валить создание проекта.
    await this.generateContentPlanFromTariff(saved);

    // Wave 6: алерт «SMM-проект создан без тарифа» — менеджеру проекта.
    if (saved.projectType === 'SMM' && !saved.tariffId && saved.managerId) {
      this.notificationsService.createIfNotRecent({
        userId: saved.managerId,
        type: NotificationType.PROJECT_NO_TARIFF,
        title: '⚠️ Проект без тарифа',
        message: `SMM-проект "${saved.name}" создан без выбранного тарифа. Привяжите тариф в настройках проекта.`,
        link: `/projects/${saved.id}`,
        data: { alertKey: `project-no-tariff:${saved.id}`, projectId: saved.id },
      }, 72).catch(() => {});
    }

    const creator = await this.userRepo.findOne({ where: { id: userId } });

    // Notify members (in-app + email)
    if (dto.memberIds?.length) {
      for (const memberId of dto.memberIds) {
        await this.notificationsService.create({
          userId: memberId,
          type: NotificationType.PROJECT_ASSIGNED,
          title: 'Вы добавлены в проект',
          message: `Вас добавили в проект "${saved.name}"`,
          link: `/projects/${saved.id}`,
        });
        // Send email notification with project details
        const member = await this.userRepo.findOne({ where: { id: memberId } });
        if (member?.email) {
          const manager = dto.managerId
            ? await this.userRepo.findOne({ where: { id: dto.managerId || userId } })
            : null;
          const deadline = saved.endDate ? new Date(saved.endDate).toLocaleDateString('ru-RU') : undefined;
          await this.mailService.sendProjectAssigned(
            member.email,
            member.name,
            saved.name,
            `/projects/${saved.id}`,
            saved.description || undefined,
            deadline,
            manager?.name || undefined,
          );
          await this.telegramService.sendToUser(
            memberId,
            `📁 <b>Вас добавили в проект</b>\n\n` +
            `📌 ${escapeHtml(saved.name)}` +
            (manager?.name ? `\n👤 Менеджер: ${escapeHtml(manager.name)}` : '') +
            (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}/projects/${saved.id}`,
          );
        }
      }
    }

    await this.activityLog.log({
      userId,
      userName: creator?.name,
      action: ActivityAction.PROJECT_CREATE,
      entity: 'project',
      entityId: saved.id,
      entityName: saved.name,
      details: { memberIds: dto.memberIds, status: saved.status },
    });

    this.gateway.broadcast('projects:changed', {});
    return saved;
  }

  /** Лид для нового проекта (15.11.2026): только руководство и руководители
   *  направлений; лид есть и ещё не связан с живым проектом. */
  private async leadForNewProject(
    leadId: string, actor: AccessUser,
  ): Promise<{ id: string; name: string; ownerId: string | null; ownerIsSales: boolean }> {
    if (!hasAnyRole(actor, LEAD_LINK_ROLES)) {
      throw new ForbiddenException('Связать проект с лидом может руководство или руководитель направления');
    }
    const rows: Array<{
      id: string; name: string; ownerId: string | null; projectId: string | null; projectName: string | null;
      ownerRole: string | null; ownerSecondaryRole: string | null; ownerActive: boolean | null;
    }> =
      await this.repo.manager.query(
        `SELECT cl.id, cl.name, cl."ownerId" AS "ownerId", cl."projectId" AS "projectId", p.name AS "projectName",
                u.role::text AS "ownerRole", u."secondaryRole"::text AS "ownerSecondaryRole", u."isActive" AS "ownerActive"
           FROM client_leads cl
           LEFT JOIN projects p ON p.id = cl."projectId"
           LEFT JOIN users u ON u.id = cl."ownerId"
          WHERE cl.id = $1`,
        [leadId],
      );
    const lead = rows?.[0];
    if (!lead) throw new NotFoundException('Лид не найден');
    // Связанный проект удалили (projectName пуст) — лид снова свободен.
    if (lead.projectId && lead.projectName != null) {
      throw new ConflictException(`Лид «${lead.name}» уже связан с проектом «${lead.projectName}»`);
    }
    // Владелец лида — менеджер продаж (основной или второй ролью) и не уволен:
    // только такого можно сделать ответственным за проект по умолчанию.
    const ownerIsSales = !!lead.ownerId && lead.ownerActive !== false
      && !!salesRoleOf({ role: lead.ownerRole, secondaryRole: lead.ownerSecondaryRole });
    return { id: lead.id, name: lead.name, ownerId: lead.ownerId ?? null, ownerIsSales };
  }

  /** Записать связь лида и созданного проекта (как POST /sales/handoffs/:leadId/link):
   *  client_leads.projectId (projects.leadId уже сохранён с проектом),
   *  событие project_linked, уведомление владельцу лида в CRM и Telegram. */
  private async linkLeadToProject(lead: { id: string; name: string; ownerId: string | null }, saved: Project, actorId: string) {
    // Условие — от гонки двух созданий по одной заявке: связь получает первый.
    const res: any = await this.repo.manager.query(
      `UPDATE client_leads SET "projectId" = $1
        WHERE id = $2
          AND ("projectId" IS NULL OR "projectId" = $1
               OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = client_leads."projectId"))
        RETURNING id`,
      [saved.id, lead.id],
    );
    const updated = Array.isArray(res?.[0]) ? res[0] : res;
    if (Array.isArray(updated) && updated.length === 0) {
      this.logger.warn(`Лид ${lead.id} уже связан с другим проектом — проект ${saved.id} остался без обратной связи`);
      return;
    }
    await recordLeadEvent(this.repo.manager, {
      leadId: lead.id, userId: actorId, kind: 'project_linked', data: { projectId: saved.id, projectName: saved.name },
    }).catch((e: any) => this.logger.warn(`Событие project_linked не записано: ${e?.message || e}`));
    // Задача «Создать проект» из заявки продаж выполнена (как в
    // SalesService.closeHandoffTask при связывании с готовым проектом).
    await this.repo.manager.query(
      `UPDATE tasks SET status = 'done', "completedAt" = now()
        WHERE id::text = (SELECT "handoffData"->>'taskId' FROM client_leads WHERE id = $1)
          AND status::text NOT IN ('done', 'cancelled')`,
      [lead.id],
    ).catch((e: any) => this.logger.warn(`Задача заявки не закрыта: ${e?.message || e}`));
    try { this.gateway.broadcast('leads:changed', { leadId: lead.id, ownerId: lead.ownerId }); } catch { /* сокет — не главное */ }
    if (!lead.ownerId || lead.ownerId === actorId) return;
    const link = `/projects/${saved.id}`;
    await this.notificationsService.create({
      userId: lead.ownerId,
      type: NotificationType.PROJECT_ASSIGNED,
      title: 'Проект создан',
      message: `Проект создан: ${saved.name}`,
      link,
    }).catch(() => undefined);
    await this.telegramService.sendToUser(
      lead.ownerId,
      `✅ <b>Проект создан: ${escapeHtml(saved.name)}</b>\n`
      + `По вашему клиенту «${escapeHtml(lead.name)}» руководитель завёл проект.`
      + `\n\n👉 ${this.telegramService.appUrl}${link}`,
    ).catch(() => undefined);
  }

  async update(id: string, dto: UpdateProjectDto, user: AccessUser & { id: string; role: string; name?: string }) {
    // Связь с лидом PATCH не меняет (15.11.2026): старая карточка присылает
    // проект целиком, и leadId из него не должен перезаписывать связь.
    delete (dto as any).leadId;
    const project = await this.findOne(id);
    // Менеджер по продажам проекты не правит (решение владельца 14.11.2026):
    // раньше «своё направление» давало ему полную правку, в т.ч. smmData.
    // Менеджер проекта — НАЗНАЧАЕМЫЙ: любой сотрудник, выбранный в поле
    // «Менеджер проекта» (project.managerId), руководит этим проектом и
    // может редактировать его данные независимо от своей роли. Отдельной
    // роли project_manager больше нет.
    const isAssignedManager = project.managerId === user.id;
    // Право projects.edit (роль или грант) действует только в своём
    // направлении (15.11.2026): раньше грант пропускал руководителя SMM в
    // проекты разработки и руководителя разработки — в SMM. Направление —
    // по обеим ролям (directionTypesOf); у ролей без направления — все проекты.
    const canEdit = isTop(user) ||
      isAssignedManager ||
      (hasGrant(user as any, 'projects.edit') && inDirection(user, project.projectType));
    if (!canEdit) {
      throw new ForbiddenException(
        hasGrant(user as any, 'projects.edit') ? 'Проект не относится к вашему направлению' : 'Not allowed',
      );
    }
    // Смена типа не выводит проект из направления редактора (15.11.2026).
    if ('projectType' in dto && dto.projectType !== project.projectType && !isTop(user)
        && directionTypesOf(user) && !inDirection(user, dto.projectType)) {
      throw new ForbiddenException('Нельзя перевести проект в чужое направление');
    }

    // ─── Состав dev-проекта (additive, SMM не трогаем) ────────────────
    // Гарды выше уже прошли (не ослабляем). Семантика:
    // managerId: undefined = не менять, null = снять, UUID = назначить;
    // memberIds: undefined = не трогать, [] = очистить, иначе заменить.
    // Проверяем существование + isActive (нет → 400), мусорные UUID → 400.
    if ('managerId' in dto) {
      await this.validateTeamManagerId(dto.managerId as any);
    }
    if ((dto as any).memberIds !== undefined) {
      (dto as any).memberIds = await this.resolveTeamMemberIds((dto as any).memberIds);
    }

    // Wave 7: блок перевода проекта в IN_PROGRESS пока launch-чеклист не закрыт.
    // Не применяется если проект уже в IN_PROGRESS — мы блокируем только переход.
    // Только пункты, которые имеют смысл для проекта (15.11.2026): раньше
    // чеклист требовал тариф и SMM-специалиста у ЛЮБОГО проекта, и ни SMM-
    // проект без тарифа (единственный, что создаёт интерфейс), ни проект
    // разработки в работу через PATCH не переводились никогда.
    //   • тариф — только если он у проекта есть (без тарифа пункт пропускаем);
    //   • SMM-команда и контент-план — только у SMM-проектов.
    if (
      dto.status === ProjectStatus.IN_PROGRESS &&
      project.status !== ProjectStatus.IN_PROGRESS
    ) {
      const state = await this.getLaunchChecklist(id);
      const skip = new Set<string>();
      if (!project.tariffId) skip.add(LAUNCH_KEYS.TARIFF_SELECTED);
      if (project.projectType !== 'SMM') {
        skip.add(LAUNCH_KEYS.TARIFF_SELECTED);
        skip.add(LAUNCH_KEYS.SMM_ASSIGNED);
        skip.add(LAUNCH_KEYS.FIRST_WEEK_PLANNED);
        skip.add(LAUNCH_KEYS.CONTENT_PLAN_READY);
      }
      const missingItems = state.items.filter(i => !i.done && !skip.has(i.key));
      if (missingItems.length) {
        const missing = missingItems.map(i => i.label).join(', ');
        throw new ForbiddenException(
          `Нельзя перевести проект в работу: не закрыты пункты launch-чеклиста — ${missing}`,
        );
      }
    }
    // Only founder can change paidAmount (actual money paid).
    // Other fields (budget, salesManager assignment, project manager) are
    // project-management concerns — admin/PM can edit.
    // If a non-founder submits paidAmount unchanged (form re-submit), silently
    // drop it instead of erroring. Reject only real changes.
    // paidAmount раньше мог менять только founder/co_founder. Теперь оба МП
    // по продажам (СММ и разработка) могут фиксировать оплату по своим
    // проектам — это часть их работы, чтобы вести воронку до победного.
    // 15.11.2026: МП — только в своём сегменте и по любой из двух ролей
    // (раньше МП разработки со второй ролью руководителя разработки правил
    // оплату SMM-проектов: проверялась только основная роль).
    const canEditPaid = this.mayEditPaid(user, project.projectType);
    if ('paidAmount' in dto && !canEditPaid) {
      const sameValue = Number(dto.paidAmount ?? 0) === Number(project.paidAmount ?? 0);
      if (!sameValue) {
        throw new ForbiddenException('У вас нет прав изменять сумму оплаты');
      }
      delete (dto as any).paidAmount;
    }

    // Wave 13: финансовые поля могут менять только founder/co_founder.
    // Если не founder — молча отбрасываем поля с реальными изменениями.
    const isFinanceRole = ['founder'].includes(user.role);
    if (!isFinanceRole) {
      for (const field of this.FINANCE_FIELDS) {
        if (field in dto) {
          const incoming = Number((dto as any)[field] ?? 0);
          const current = Number((project as any)[field] ?? 0);
          if (incoming !== current) {
            throw new ForbiddenException('Только основатель или сооснователь может изменять финансовые поля');
          }
          delete (dto as any)[field];
        }
      }
    }

    // Guard: smm_director может руководить только SMM-проектами.
    // Проверяем и назначение нового менеджера, и смену projectType
    // у проекта, которым он уже руководит.
    const nextManagerId = 'managerId' in dto ? dto.managerId : project.managerId;
    const nextType = 'projectType' in dto ? dto.projectType : project.projectType;
    await this.validateManagerAssignment(nextManagerId as string | undefined, nextType as string | undefined);

    // Track paidAmount change as a Payment record (delta-based).
    // Все роли которые могут менять оплату — записываем их изменения как
    // ProjectPayment delta для истории/аудита.
    let paymentDelta: number | null = null;
    if ('paidAmount' in dto && canEditPaid) {
      const oldPaid = Number(project.paidAmount ?? 0);
      const newPaid = Number(dto.paidAmount ?? 0);
      if (newPaid !== oldPaid) {
        paymentDelta = newPaid - oldPaid;
      }
    }

    const oldMemberIds = project.members?.map(m => m.id) || [];
    const oldManagerId = project.managerId;
    const managerChanged = dto.managerId !== undefined && dto.managerId !== oldManagerId;

    // Индивидуальные лимиты считаем до смены тарифа: от них зависит и
    // snapshot цены, и пересчёт перерасхода ниже.
    const customOnUpdate = await this.normalizeCustomTariff(
      dto, project.tariffId, user.role, project.customTariff as any,
    );
    const nextCustom = customOnUpdate !== undefined
      ? customOnUpdate
      : (project.customTariff as any);

    // Tariff change handling: re-snapshot when tariffId changes,
    // wipe snapshot when tariff is detached.
    if ('tariffId' in dto && dto.tariffId !== project.tariffId) {
      if (dto.tariffId) {
        await this.applyTariffSnapshot(dto as unknown as Partial<Project>, dto.tariffId, nextCustom);
      } else {
        (dto as any).tariffNameSnapshot = null;
        (dto as any).tariffPriceSnapshot = null;
      }
    }

    // Team change — пересохраняем snapshot или обнуляем если отвязали.
    if ('teamId' in (dto as any) && (dto as any).teamId !== project.teamId) {
      if ((dto as any).teamId) {
        const team = await this.teamRepo.findOne({ where: { id: (dto as any).teamId } });
        if (team) (dto as any).teamNameSnapshot = team.name;
      } else {
        (dto as any).teamNameSnapshot = null;
      }
    }

    if (dto.memberIds !== undefined) {
      project.members = dto.memberIds.map(id => ({ id })) as unknown as User[];
    }

    // If managerId is being changed, clear the cached manager object
    // so TypeORM uses the new managerId instead of the stale relation.
    if (managerChanged) {
      (project as any).manager = null;
      project.managerId = dto.managerId as any;
    }

    // Менеджер ВСЕГДА должен быть в составе проекта — иначе он не пройдёт
    // member-проверки в задачах/файлах и не появится в дропдаунах assignee.
    // Применяется и при смене менеджера, и при ручном редактировании members.
    const effectiveManagerId = managerChanged ? dto.managerId : project.managerId;
    if (effectiveManagerId) {
      const currentMembers = (project.members || []) as Array<{ id: string }>;
      if (!currentMembers.some(m => m.id === effectiveManagerId)) {
        project.members = [...currentMembers, { id: effectiveManagerId }] as unknown as User[];
      }
    }

    // smmData — слиянием, а не заменой целиком (15.11.2026). Старая карточка
    // проекта присылала устаревший снимок smmData и откатывала цикл, норму,
    // специалистов, менеджера и TikTok. Ключи со своими ручками
    // (SMM_DATA_OWNED_KEYS) здесь не меняются; остальное ложится поверх
    // текущего значения в базе атомарно (patchSmmData) уже после save.
    let smmPatch: Record<string, any> | null = null;
    if ('smmData' in dto) {
      const raw = (dto as any).smmData;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        smmPatch = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!SMM_DATA_OWNED_KEYS.includes(k)) smmPatch[k] = v;
        }
      }
      delete (dto as any).smmData;
    }
    // Загруженный снимок smmData обратно не пишем — его могли изменить
    // параллельно (undefined TypeORM при save пропускает).
    delete (project as any).smmData;

    Object.assign(project, {
      ...dto,
      members: project.members,
    });

    // Wave 13: пересчёт финансов до save. Поля из dto имеют приоритет
    // (manual override), производные авто-перезаписываются если их явно
    // не передавали.
    const explicitOnUpdate = new Set<string>()
    for (const f of this.FINANCE_FIELDS) {
      if (f in dto) explicitOnUpdate.add(f)
    }
    // Object.assign выше положил сырой customTariff из запроса — заменяем
    // очищенным. Цена индивидуального тарифа = «Ежемесячная плата» проекта:
    // это одна и та же цифра, иначе финансовый таб и выручка показывали бы 0.
    if (customOnUpdate !== undefined) {
      project.customTariff = customOnUpdate as any;
      const price = Number(customOnUpdate?.monthlyPrice || 0);
      if (price > 0 && !explicitOnUpdate.has('monthlyFee')) {
        project.monthlyFee = price as any;
        project.tariffPriceSnapshot = price as any;
      }
    }
    if ('paidAmount' in dto || 'totalContractValue' in dto || 'internalCostEstimate' in dto || 'tariffId' in dto || 'discount' in dto || 'discountType' in dto || 'customTariff' in dto) {
      await this.recomputeFinancials(project, project, explicitOnUpdate)
    }

    const saved = await this.repo.save(project);
    if (smmPatch && Object.keys(smmPatch).length) {
      await patchSmmData(this.repo.manager, id, smmPatch);
    }

    // Если тариф только что привязан к SMM-проекту впервые (раньше его не было),
    // и контент-план ещё не сгенерирован — генерируем сейчас.
    // Флаг isAutoGeneratedFromTariff в самом методе предотвратит двойную генерацию.
    const tariffJustAttached = 'tariffId' in dto && dto.tariffId && saved.tariffId === dto.tariffId;
    if (tariffJustAttached && !saved.isAutoGeneratedFromTariff) {
      await this.generateContentPlanFromTariff(saved);
    }

    // Record payment delta if paidAmount changed
    if (paymentDelta !== null) {
      await this.paymentRepo.save(this.paymentRepo.create({
        projectId: saved.id,
        amount: paymentDelta,
        paidAt: new Date(),
        recordedById: user.id,
        note: paymentDelta > 0 ? 'Оплата получена' : 'Корректировка',
      }));
    }

    // Транши оплаты при UPDATE: добавляем только НОВЫЕ платежи (без id).
    // Существующие платежи редактируются через отдельный финансовый таб
    // и здесь не трогаются. Доступно ролям с правом редактирования проекта
    // (вторая роль тоже даёт право — dev_director у Сабрины).
    const UPD_PAYMENT_ROLES = ['admin', 'founder', 'smm_director', 'dev_director'];
    if (Array.isArray((dto as any).initialPayments)
        && (UPD_PAYMENT_ROLES.includes(user.role)
            || UPD_PAYMENT_ROLES.includes((user as any).secondaryRole)
            || project.managerId === user.id)) {
      const items = (dto as any).initialPayments as Array<{ id?: string; amount: number; paidAt: string; note?: string }>;
      const newOnes = items.filter(it => !it.id && Number(it.amount) > 0 && it.paidAt);
      let totalNew = 0;
      for (const it of newOnes) {
        const amount = Number(it.amount);
        await this.paymentRepo.save(this.paymentRepo.create({
          projectId: saved.id,
          amount,
          paidAt: new Date(it.paidAt),
          recordedById: user.id,
          note: it.note?.trim() || `Транш`,
        }));
        totalNew += amount;
      }
      if (totalNew > 0) {
        const newPaid = Number(saved.paidAmount || 0) + totalNew;
        saved.paidAmount = newPaid;
        // Пересчитываем outstanding/margin с учётом новых платежей.
        await this.recomputeFinancials(saved, saved, new Set());
        await this.repo.update(saved.id, {
          paidAmount: newPaid,
          outstandingAmount: saved.outstandingAmount,
        });
      }
    }

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: dto,
    });

    const deadlineStr = saved.endDate ? new Date(saved.endDate).toLocaleDateString('ru-RU') : undefined;
    const projectLink = `/projects/${saved.id}`;

    // ── Manager change notifications ──────────────────────────────
    if (managerChanged) {
      // Notify NEW manager (if set)
      if (dto.managerId) {
        const newManager = await this.userRepo.findOne({ where: { id: dto.managerId } }).catch(() => null);
        if (newManager && newManager.id !== user.id) {
          try {
            await this.notificationsService.create({
              userId: newManager.id,
              type: NotificationType.MANAGER_ASSIGNED,
              title: '👑 Вы — менеджер проекта',
              message: `Вас назначили менеджером проекта "${saved.name}"`,
              link: projectLink,
              data: { projectId: saved.id, actorId: user.id, actorName: user.name },
            });
          } catch (e: any) { console.warn('manager-assigned in-app failed:', e?.message); }
          if (newManager.email) {
            await this.mailService
              .sendManagerAssigned(
                newManager.email, newManager.name, saved.name, saved.id,
                saved.description || undefined, deadlineStr, user.name,
              )
              .catch((e: any) => console.warn('manager-assigned mail failed:', e?.message));
          }
          await this.telegramService
            .sendToUser(
              newManager.id,
              `👑 <b>Вы — менеджер проекта</b>\n\n` +
              `📌 ${escapeHtml(saved.name)}\n` +
              (user.name ? `👤 Назначил: ${escapeHtml(user.name)}\n` : '') +
              (deadlineStr ? `📅 Дедлайн: ${deadlineStr}\n` : '') +
              `\n👉 ${this.telegramService.appUrl}${projectLink}`,
            )
            .catch((e: any) => console.warn('manager-assigned telegram failed:', e?.message));
        }
      }
      // Notify OLD manager (if they had one and still exist)
      if (oldManagerId && oldManagerId !== user.id) {
        const oldManager = await this.userRepo.findOne({ where: { id: oldManagerId } }).catch(() => null);
        if (oldManager) {
          try {
            await this.notificationsService.create({
              userId: oldManager.id,
              type: NotificationType.MANAGER_REMOVED,
              title: '📋 Смена менеджера проекта',
              message: `Вы больше не менеджер проекта "${saved.name}"`,
              link: projectLink,
              data: { projectId: saved.id, actorId: user.id, actorName: user.name },
            });
          } catch (e: any) { console.warn('manager-removed in-app failed:', e?.message); }
          if (oldManager.email) {
            await this.mailService
              .sendManagerRemoved(oldManager.email, oldManager.name, saved.name, saved.id, user.name)
              .catch((e: any) => console.warn('manager-removed mail failed:', e?.message));
          }
          await this.telegramService
            .sendToUser(
              oldManager.id,
              `📋 <b>Смена менеджера проекта</b>\n\n` +
              `Вы больше не менеджер проекта <b>${escapeHtml(saved.name)}</b>` +
              (user.name ? `\n\n👤 Изменение сделал: ${escapeHtml(user.name)}` : ''),
            )
            .catch((e: any) => console.warn('manager-removed telegram failed:', e?.message));
        }
      }
    }

    // ── Member add/remove notifications ───────────────────────────
    if (dto.memberIds !== undefined) {
      const newMemberIds = dto.memberIds.filter(mid => !oldMemberIds.includes(mid));
      const removedMemberIds = oldMemberIds.filter(mid => !dto.memberIds.includes(mid));

      for (const memberId of newMemberIds) {
        // Notifications are best-effort — never block the member-add itself.
        try {
          await this.activityLog.log({
            userId: user.id,
            userName: user.name,
            action: ActivityAction.MEMBER_ADD,
            entity: 'project',
            entityId: id,
            entityName: project.name,
            details: { memberId },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-add activity log failed:', e?.message);
        }

        if (memberId === user.id) continue;
        const member = await this.userRepo.findOne({ where: { id: memberId } }).catch(() => null);
        if (!member) continue;

        try {
          await this.notificationsService.create({
            userId: memberId,
            type: NotificationType.PROJECT_ASSIGNED,
            title: '👥 Вас добавили в проект',
            message: `Вас добавили в проект "${saved.name}"`,
            link: projectLink,
            data: { projectId: saved.id, actorId: user.id, actorName: user.name },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-add in-app notification failed:', e?.message);
        }
        if (member.email) {
          await this.mailService
            .sendProjectAssigned(
              member.email, member.name, saved.name, projectLink,
              saved.description || undefined, deadlineStr, user.name,
            )
            .catch((e: any) => console.warn('member-add mail failed:', e?.message));
        }
        await this.telegramService
          .sendToUser(
            memberId,
            `👥 <b>Вас добавили в проект</b>\n\n` +
            `📌 ${escapeHtml(saved.name)}` +
            (user.name ? `\n👤 Добавил: ${escapeHtml(user.name)}` : '') +
            (deadlineStr ? `\n📅 Дедлайн: ${deadlineStr}` : '') +
            `\n\n👉 ${this.telegramService.appUrl}${projectLink}`,
          )
          .catch((e: any) => console.warn('member-add telegram failed:', e?.message));
      }

      for (const memberId of removedMemberIds) {
        // Notifications are best-effort — a failing email/telegram/enum-not-yet-
        // migrated-on-DB must not roll back the actual member removal.
        try {
          await this.activityLog.log({
            userId: user.id,
            userName: user.name,
            action: ActivityAction.MEMBER_REMOVE,
            entity: 'project',
            entityId: id,
            entityName: project.name,
            details: { memberId },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-remove activity log failed:', e?.message);
        }

        if (memberId === user.id) continue;
        const member = await this.userRepo.findOne({ where: { id: memberId } }).catch(() => null);
        if (!member) continue;

        try {
          await this.notificationsService.create({
            userId: memberId,
            type: NotificationType.MEMBER_REMOVED,
            title: '👥 Вас убрали из проекта',
            message: `Вас больше нет в составе проекта "${saved.name}"`,
            link: projectLink,
            data: { projectId: saved.id, actorId: user.id, actorName: user.name },
          });
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.warn('member-remove in-app notification failed:', e?.message);
        }
        if (member.email) {
          await this.mailService
            .sendMemberRemoved(member.email, member.name, saved.name, user.name)
            .catch((e: any) => console.warn('member-remove mail failed:', e?.message));
        }
        await this.telegramService
          .sendToUser(
            memberId,
            `👥 <b>Вас убрали из проекта</b>\n\n` +
            `📌 ${escapeHtml(saved.name)}` +
            (user.name ? `\n👤 Изменение сделал: ${escapeHtml(user.name)}` : ''),
          )
          .catch((e: any) => console.warn('member-remove telegram failed:', e?.message));
      }
    }

    this.gateway.broadcast('projects:changed', {});
    // Return fresh project with relations loaded
    const fresh: any = await this.findOne(id, user);
    if (!this.canManageBrief(user, fresh)) delete fresh.briefShareToken;
    return fresh;
  }

  /** Этап разработки на доске «Разработка»: только dev-проекты, 1..6.
   *  Роли режет @Roles на контроллере (admin/founder/co_founder/pm_dev). */
  async setDevStage(id: string, devStage: number, user?: { id: string; role: string; name?: string }) {
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (!DEV_PROJECT_TYPES.includes(project.projectType as string)) {
      throw new BadRequestException('Этапы разработки применимы только к проектам разработки');
    }
    if (project.devStage === devStage) return { id, devStage };
    await this.repo.update(id, { devStage });
    await this.activityLog.log({
      userId: user?.id,
      userName: user?.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: { devStage, prevDevStage: project.devStage ?? null },
    });
    this.gateway.broadcast('projects:changed', { projectId: id });
    return { id, devStage };
  }

  /** SMM-специалист (и любая не руководящая роль) правит только свой
   *  SMM-проект: менеджер, участник или назначенный специалист (15.11.2026).
   *  Руководство SMM — любой. Без user — внутренний вызов, не ограничиваем.
   *  project должен быть загружен с members. */
  private assertSmmOwn(project: { managerId?: string; smmData?: any; members?: Array<{ id: string }> }, user?: AccessUser | null) {
    if (!user) return;
    const memberIds = (Array.isArray(project.members) ? project.members : []).map(m => m?.id).filter(Boolean);
    if (!canEditSmmProject(user, project, memberIds)) {
      throw new ForbiddenException('Это не ваш проект: править его может менеджер, участник или назначенный SMM-специалист');
    }
  }

  /** Флаг «сторисмейкер» на карточке сотрудника (employees.isStoryMaker). */
  private async isStoryMakerUser(userId: string): Promise<boolean> {
    const emp = await this.employeeRepo.findOne({
      where: { userId },
      select: ['id', 'isStoryMaker'] as any,
    }).catch(() => null);
    return !!emp?.isStoryMaker;
  }

  /** Архив историй: скрыть/вернуть SMM-проект в кабинете сторисмейкера.
   *  НЕ настоящее архивирование — проект остаётся активным везде, кроме
   *  списков историй и напоминаний «нет историй». */
  async setStoriesArchived(id: string, archived: boolean, user?: AccessUser & { id: string; role: string; name?: string }) {
    const project = await this.repo.findOne({ where: { id }, relations: ['members'] });
    if (!project) throw new NotFoundException('Project not found');
    if (project.projectType !== 'SMM') {
      throw new BadRequestException('Архив историй применим только к SMM-проектам');
    }
    // Сторисмейкер ведёт истории ВСЕХ SMM-проектов — архив историй это его
    // кабинет, свой проект ему не нужен; остальным — только свой.
    if (user && !(await this.isStoryMakerUser(user.id))) this.assertSmmOwn(project, user);
    if (project.storiesArchived === archived) return { id, storiesArchived: archived };
    await this.repo.update(id, { storiesArchived: archived });
    await this.activityLog.log({
      userId: user?.id,
      userName: user?.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: { storiesArchived: archived },
    });
    this.gateway.broadcast('projects:changed', { projectId: id });
    return { id, storiesArchived: archived };
  }

  /** Настройки месячного цикла SMM-проекта (Умный календарь): день старта
   *  цикла (1..31) + норма за цикл (рилсы/посты). Цикл сбрасывается каждый
   *  месяц. Хранится в smmData (merge, без миграции), отдельно от тарифа/Доски. */
  async setSmmCycle(
    id: string,
    dto: { day?: number | null; normReels?: number | null; normPosts?: number | null; anchor?: string | null; storiesPerMonth?: number | null },
    user?: AccessUser & { id: string; role: string; name?: string },
  ) {
    const project = await this.repo.findOne({ where: { id }, relations: ['members'] });
    if (!project) throw new NotFoundException('Project not found');
    if (project.projectType !== 'SMM') {
      throw new BadRequestException('Цикл применим только к SMM-проектам');
    }
    this.assertSmmOwn(project, user);
    const dayInRange = (v: any, lo: number, hi: number): number | null => {
      if (v == null) return null;
      const n = Math.trunc(Number(v));
      if (!Number.isFinite(n) || n < lo || n > hi) {
        throw new BadRequestException(`Значение должно быть от ${lo} до ${hi}`);
      }
      return n;
    };
    // Пишем только свои ключи — атомарно поверх текущего smmData (15.11.2026):
    // раньше цикл и профиль, сохранённые одновременно, затирали друг друга.
    const smmData: any = { ...(project.smmData || {}) };
    const { put, del, set, unset } = smmDataEditor(smmData);
    if ('day' in dto) {
      const d = dayInRange(dto.day, 1, 31);
      if (d == null) { del('cycleStartDay'); del('cycleAnchor'); } else put('cycleStartDay', d);
    }
    // Якорь активного цикла (дата старта, 'YYYY-MM-DD') — выбор пользователя
    // «этот месяц / прошлый месяц». null — авто (цикл, содержащий сегодня).
    if ('anchor' in dto) {
      const a = dto.anchor;
      if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) put('cycleAnchor', a); else del('cycleAnchor');
    }
    if ('normReels' in dto) {
      const n = dayInRange(dto.normReels, 0, 999);
      if (n == null) del('normReels'); else put('normReels', n);
    }
    if ('normPosts' in dto) {
      const n = dayInRange(dto.normPosts, 0, 999);
      if (n == null) del('normPosts'); else put('normPosts', n);
    }
    // Сторис в месяц (норма, 0–100). Дневную норму (для KPI и раскраски дней) выводим = месяц / дни текущего месяца.
    if ('storiesPerMonth' in dto) {
      const m = dayInRange(dto.storiesPerMonth, 0, 100);
      if (m == null) { del('storiesPerMonth'); del('storiesPerDay'); }
      else { put('storiesPerMonth', m); put('storiesPerDay', m > 0 ? Math.max(1, Math.round(m / daysInCurrentMonth())) : 0); }
    }
    await patchSmmData(this.repo.manager, id, set, unset);
    await this.activityLog.log({
      userId: user?.id,
      userName: user?.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: { smmCycle: { cycleStartDay: smmData.cycleStartDay ?? null, normReels: smmData.normReels ?? null, normPosts: smmData.normPosts ?? null, storiesPerMonth: smmData.storiesPerMonth ?? null } },
    });
    this.gateway.broadcast('projects:changed', { projectId: id });
    return {
      id,
      cycleStartDay: smmData.cycleStartDay ?? null,
      cycleAnchor: smmData.cycleAnchor ?? null,
      normReels: smmData.normReels ?? null,
      normPosts: smmData.normPosts ?? null,
      storiesPerMonth: smmData.storiesPerMonth ?? null,
    };
  }

  /** Профиль клиента SMM-проекта (владелец, значимый день, начало сотрудничества,
   *  предпочтения) + помесячные метрики (подписчики, охват, вовлечённость, заявки). В smmData. */
  private normSmmProfile(smmData: any) {
    const numOr = (v: any): number | null => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };
    let metrics: any[];
    if (Array.isArray(smmData?.metrics)) {
      metrics = smmData.metrics
        .filter((m: any) => m && /^\d{4}-\d{2}$/.test(m.ym))
        .map((m: any) => ({ ym: String(m.ym), subs: numOr(m.subs), reach: numOr(m.reach), eng: numOr(m.eng), leads: numOr(m.leads) }))
        .sort((a: any, b: any) => (a.ym < b.ym ? -1 : 1));
    } else {
      // Легаси: старое поле followers → подписчики (subs).
      const raw = Array.isArray(smmData?.followers) ? smmData.followers : [];
      metrics = raw
        .filter((f: any) => f && /^\d{4}-\d{2}$/.test(f.ym) && Number.isFinite(Number(f.value)))
        .map((f: any) => ({ ym: String(f.ym), subs: Math.trunc(Number(f.value)), reach: null, eng: null, leads: null }))
        .sort((a: any, b: any) => (a.ym < b.ym ? -1 : 1));
    }
    return {
      ownerName: smmData?.ownerName ?? null,
      keyDate: smmData?.keyDate ?? null,
      keyDateNote: smmData?.keyDateNote ?? null,
      collabSince: smmData?.collabSince ?? null,
      preferences: smmData?.preferences ?? null,
      // Для съёмок (07.11.2026): куда ехать и кто встретит. Уходит видеографу
      // и продюсеру в Telegram и на страницу сценария.
      shootAddress: smmData?.shootAddress ?? null,
      shootMapUrl: smmData?.shootMapUrl ?? null,
      shootContact: smmData?.shootContact ?? null,
      metrics,
    };
  }

  /** Производственная команда проекта: кто закрывает какой этап. Ключ —
   *  поле в smmData, roles — кем можно назначить (вторая роль тоже считается:
   *  «Видеограф / Монтажёр» у нас обычная связка).
   *  По этим полям content-plan раздаёт карточки подготовки исполнителям. */
  private static readonly CREW_FIELDS = [
    { key: 'videographerIds', out: 'videographers', roles: [UserRole.VIDEOGRAPHER] },
    { key: 'videoEditorIds',  out: 'videoEditors',  roles: [UserRole.VIDEO_EDITOR] },
    { key: 'designerIds',     out: 'designers',     roles: [UserRole.DESIGNER] },
  ] as const;

  /** Единственный активный сотрудник с такой ролью (вторая роль тоже считается).
   *  Несколько или ни одного — null: угадывать за людей не беремся. */
  private async soleActiveByRole(roles: readonly UserRole[]): Promise<User | null> {
    const users = await this.userRepo.find({
      where: [
        { role: In(roles as any), isActive: true },
        { secondaryRole: In(roles as any), isActive: true },
      ],
      take: 3,
    }).catch(() => [] as User[]);
    return users.length === 1 ? users[0] : null;
  }

  async getSmmProfile(id: string, viewer?: { id?: string; role?: string; secondaryRole?: string | null }) {
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    const sd: any = project.smmData || {};
    const base = this.normSmmProfile(sd);
    const strIds = (v: any): string[] => (Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : []);
    // Назначенные SMM-специалисты, производственная команда и ответственный
    // менеджер: id храним в smmData, для отображения резолвим в мини-объекты
    // (имя/аватар) — чтобы их видели и те, кому недоступен /users.
    const specIds = strIds(sd.smmSpecialistIds);
    const crewIds: Record<string, string[]> = Object.fromEntries(
      ProjectsService.CREW_FIELDS.map(f => [f.key, strIds(sd[f.key])]));
    const managerId = typeof sd.salesManagerId === 'string' ? sd.salesManagerId as string : null;
    const wanted = [...new Set([...specIds, ...Object.values(crewIds).flat(), ...(managerId ? [managerId] : [])])];
    const candRoles = ProjectsService.CREW_FIELDS.flatMap(f => f.roles as readonly UserRole[]);

    // Все запросы к людям — одновременно (19.10.2026: раньше шли по очереди,
    // и карточка проекта открывалась заметно дольше).
    const [users, candidates, defaults] = await Promise.all([
      wanted.length ? this.userRepo.find({ where: { id: In(wanted) } }).catch(() => [] as User[]) : Promise.resolve([] as User[]),
      // Кандидаты для назначения отдаём прямо тут: список /users закрыт ролями,
      // а назначать команду должен и СММ-специалист по своему проекту.
      this.userRepo.find({
        where: [
          { role: In(candRoles as any), isActive: true },
          { secondaryRole: In(candRoles as any), isActive: true },
        ],
      }).catch(() => [] as User[]),
      // Кого работа найдёт сама, если на проекте никого не назначали: главного
      // видеографа, а для монтажа и дизайна — единственного в агентстве человека
      // с этой ролью. Ровно та же логика, по которой content-plan раздаёт
      // карточки подготовки, — экран показывает того, кто реально получит работу.
      Promise.all(ProjectsService.CREW_FIELDS.filter(f => !crewIds[f.key].length).map(async f => {
        let u: User | null = null;
        if (f.out === 'videographers') {
          u = await this.userRepo.findOne({ where: { isDefaultVideographer: true, isActive: true } }).catch(() => null);
          if (!u) u = await this.soleActiveByRole([UserRole.VIDEOGRAPHER]);
        } else {
          u = await this.soleActiveByRole(f.roles as readonly UserRole[]);
        }
        return [f.out, u] as const;
      })),
    ]);
    const mini = (u: User) => ({ id: u.id, name: u.name, avatar: u.avatar || null, role: u.role });
    const byId = new Map(users.map(u => [u.id, u] as const));
    const resolve = (ids: string[]) => ids.map(uid => byId.get(uid)).filter((u): u is User => !!u).map(mini);

    const smmSpecialists = resolve(specIds);
    const crew: Record<string, any> = {};
    for (const f of ProjectsService.CREW_FIELDS) {
      const people = resolve(crewIds[f.key]);
      crew[f.key] = people.map(u => u.id);
      crew[f.out] = people;
    }
    const crewDefaults: Record<string, any> = {};
    for (const [out, u] of defaults) if (u) crewDefaults[out] = mini(u);
    const crewCandidates: Record<string, any[]> = {};
    for (const f of ProjectsService.CREW_FIELDS) {
      const roles = f.roles as readonly UserRole[];
      crewCandidates[f.out] = candidates
        .filter(u => roles.includes(u.role) || (u.secondaryRole && roles.includes(u.secondaryRole)))
        .map(mini);
    }
    const mgr = managerId ? byId.get(managerId) : undefined;
    const salesManager = mgr ? mini(mgr) : null;
    const today = dushanbeToday();
    return {
      ...base, smmSpecialistIds: smmSpecialists.map(u => u.id), smmSpecialists, salesManager, ...crew, crewCandidates, crewDefaults,
      // Ссылка на страницу клиента — видят все, кто открыл проект; логин и
      // пароль — только кому можно (canSeeAccess), отдельным запросом.
      pageUrl: typeof sd.pageUrl === 'string' && sd.pageUrl ? sd.pageUrl : null,
      canSeeAccess: !!viewer && this.canSeeClientAccessFor(viewer, specIds, managerId || null),
      // TikTok (14.11.2026): по умолчанию у всех проектов, выключают по одному.
      // 17.11.2026: состояние — на сегодня по журналу (действует с дня
      // изменения), история — новые сверху, и сколько прошлых публикаций ещё
      // ждут отметки TikTok.
      tiktok: tiktokOnAt(sd, today),
      tiktokHistory: tiktokLogOf(sd).reverse().map(e => ({ from: e.from, on: e.on, byName: e.byName, at: e.at })),
      tiktokPending: await this.tiktokPendingCount(id, sd, today),
    };
  }

  /** Публикации проекта за последние 60 дней (до вчера включительно), которым
   *  TikTok нужен (на их дату), а отметки «выложено в TikTok» нет. Отменённые,
   *  сторис и карточки подготовки (съёмка/монтаж/дизайн) не считаются. */
  private async tiktokPendingCount(projectId: string, smmData: any, today: string): Promise<number> {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86400_000).toISOString().slice(0, 10);
    const rows: Array<{ d: string }> = await this.repo.manager.query(
      `SELECT to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS d
         FROM content_plan_items ci
        WHERE ci."projectId" = $1
          AND ci."shootForItemId" IS NULL
          AND ci."contentType" <> 'story'
          AND ci.status <> 'cancelled'
          AND ci."tiktokAt" IS NULL
          AND ci."publishDate" IS NOT NULL
          AND ci."publishDate"::date >= $2::date
          AND ci."publishDate"::date < $3::date`,
      [projectId, since, today],
    ).catch((e: any) => { this.logger.warn(`tiktokPending failed: ${e?.message || e}`); return [] as Array<{ d: string }>; });
    return (Array.isArray(rows) ? rows : []).filter(r => tiktokNeeded(smmData, r.d)).length;
  }

  async setSmmProfile(
    id: string,
    dto: { ownerName?: string | null; keyDate?: string | null; keyDateNote?: string | null; collabSince?: string | null; preferences?: string | null; metrics?: any[]; followers?: { ym: string; value: number }[]; smmSpecialistIds?: string[];
      videographerIds?: string[]; videoEditorIds?: string[]; designerIds?: string[];
      shootAddress?: string | null; shootMapUrl?: string | null; shootContact?: string | null; tiktok?: boolean },
    user?: AccessUser & { id: string; role: string; name?: string },
  ) {
    const project = await this.repo.findOne({ where: { id }, relations: ['members'] });
    if (!project) throw new NotFoundException('Project not found');
    if (project.projectType !== 'SMM') throw new BadRequestException('Профиль применим только к SMM-проектам');
    // Продюсер (09.11.2026) правит в профиле только производство: где снимать
    // и кто снимает, монтирует, рисует. Остальное — СММ-специалиста.
    // Роль — основная ИЛИ вторая (15.11.2026), как в умном календаре
    // (isProductionOnly): раньше продюсер второй ролью правил весь профиль.
    const productionOnly = !!user && isProductionOnly(user);
    if (productionOnly) {
      const PRODUCTION_KEYS = ['shootAddress', 'shootMapUrl', 'shootContact', 'videographerIds', 'videoEditorIds', 'designerIds'];
      dto = Object.fromEntries(Object.entries(dto || {}).filter(([k]) => PRODUCTION_KEYS.includes(k))) as typeof dto;
    } else {
      // SMM-специалист правит профиль только своего проекта (15.11.2026).
      this.assertSmmOwn(project, user);
    }
    // Пишем только тронутые ключи — атомарно поверх текущего smmData.
    const smmData: any = { ...(project.smmData || {}) };
    const ed = smmDataEditor(smmData);
    const str = (v: any, max: number): string | null => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; };
    const dateOr = (v: any): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
    const setOrDel = (key: string, val: any) => { if (val == null) ed.del(key); else ed.put(key, val); };
    if ('ownerName' in dto) setOrDel('ownerName', str(dto.ownerName, 200));
    if ('keyDate' in dto) setOrDel('keyDate', dateOr(dto.keyDate));
    if ('keyDateNote' in dto) setOrDel('keyDateNote', str(dto.keyDateNote, 500));
    if ('collabSince' in dto) setOrDel('collabSince', dateOr(dto.collabSince));
    if ('preferences' in dto) setOrDel('preferences', str(dto.preferences, 4000));
    // TikTok (17.11.2026, docs/SMM_DELEGATION_SPEC.md §2): включает и
    // выключает тот же круг, что правит профиль (assertSmmOwn выше): SMM-
    // специалист своего проекта и руководство. Продюсер — нет (его ключи
    // отфильтрованы выше). Действует с сегодняшнего дня по Душанбе: журнал
    // smmData.tiktokLog, tiktokOff = текущее состояние (совместимость).
    // Уведомлений нет.
    if ('tiktok' in dto) {
      const on = dto.tiktok !== false;
      const log = toggleTiktokLog(smmData, on, dushanbeToday(), {
        by: user?.id ?? null,
        byName: user?.name ?? null,
        at: new Date().toISOString(),
      });
      setOrDel('tiktokLog', log.length ? log : null);
      setOrDel('tiktokOff', on ? null : true);
    }
    // Съёмки: адрес, ссылка на карту (только http/https — она уходит ссылкой
    // в Telegram) и человек на месте. Пусто — поле убираем.
    if ('shootAddress' in dto) setOrDel('shootAddress', str(dto.shootAddress, 300));
    if ('shootMapUrl' in dto) {
      const url = str(dto.shootMapUrl, 500);
      if (url && !/^https?:\/\/\S+$/i.test(url)) throw new BadRequestException('Ссылка на карту должна начинаться с http:// или https://');
      setOrDel('shootMapUrl', url);
    }
    if ('shootContact' in dto) setOrDel('shootContact', str(dto.shootContact, 200));
    // Назначенные SMM-специалисты проекта. Принимаем только id пользователей с
    // ролью smm_specialist (защита «в выборе только специалисты») и руководителя
    // SMM — он ведёт свои проекты как специалист (30.10.2026), дедуп, cap 10.
    // Сам СММ-специалист (и продюсер — у него те же права) переставлять
    // проекты НЕ может — игнорируем это поле от них. Переставляет только
    // руководство SMM — по основной или второй роли (15.11.2026).
    if ('smmSpecialistIds' in dto && (!user || isSmmManagement(user))) {
      const raw = Array.isArray(dto.smmSpecialistIds) ? dto.smmSpecialistIds.filter(x => typeof x === 'string') : [];
      const uniq = [...new Set(raw)].slice(0, 10);
      let valid: string[] = [];
      if (uniq.length) {
        const users = await this.userRepo.find({ where: { id: In(uniq) } });
        const SPEC_ROLES: string[] = [UserRole.SMM_SPECIALIST, UserRole.SMM_DIRECTOR];
        const allowed = new Set(users
          .filter(u => SPEC_ROLES.includes(u.role) || (!!u.secondaryRole && SPEC_ROLES.includes(u.secondaryRole)))
          .map(u => u.id));
        valid = uniq.filter(x => allowed.has(x));
      }
      setOrDel('smmSpecialistIds', valid.length ? valid : null);
    }
    // Производственная команда проекта: видеограф, монтажёр, дизайнер.
    // В отличие от smmSpecialistIds это назначение может делать и СММ-специалист:
    // распределить съёмку по своему проекту — его рабочая задача, а не передел
    // проектов. Принимаем только людей с подходящей ролью (или второй ролью).
    for (const f of ProjectsService.CREW_FIELDS) {
      if (!(f.key in dto)) continue;
      const raw = Array.isArray((dto as any)[f.key]) ? (dto as any)[f.key].filter((x: any) => typeof x === 'string') : [];
      const uniq = [...new Set<string>(raw)].slice(0, 10);
      let valid: string[] = [];
      if (uniq.length) {
        const users = await this.userRepo.find({ where: { id: In(uniq) } });
        const roles = f.roles as readonly UserRole[];
        const allowed = new Set(
          users.filter(u => roles.includes(u.role) || (u.secondaryRole && roles.includes(u.secondaryRole))).map(u => u.id),
        );
        valid = uniq.filter(x => allowed.has(x));
      }
      setOrDel(f.key, valid.length ? valid : null);
    }
    // Помесячные метрики: подписчики/охват/вовлечённость/заявки. Дедуп по ym, сортировка, cap 240.
    if ('metrics' in dto) {
      const arr = Array.isArray(dto.metrics) ? dto.metrics : [];
      const byYm = new Map<string, any>();
      for (const m of arr) {
        if (m && /^\d{4}-\d{2}$/.test(String(m.ym))) {
          const clean: any = { ym: String(m.ym) };
          for (const k of ['subs', 'reach', 'eng', 'leads']) {
            const n = Math.trunc(Number((m as any)[k]));
            if (Number.isFinite(n) && n >= 0 && n <= 1_000_000_000_000) clean[k] = n;
          }
          byYm.set(clean.ym, clean);
        }
      }
      const metrics = [...byYm.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1)).slice(-240);
      if (metrics.length) ed.put('metrics', metrics); else ed.del('metrics');
      ed.del('followers'); // мигрировали на metrics
    } else if ('followers' in dto) {
      // Легаси-совместимость (старый фронт в переходный период).
      const arr = Array.isArray(dto.followers) ? dto.followers : [];
      const byYm = new Map<string, number>();
      for (const f of arr) {
        if (f && /^\d{4}-\d{2}$/.test(String(f.ym))) {
          const n = Math.trunc(Number(f.value));
          if (Number.isFinite(n) && n >= 0 && n <= 1_000_000_000) byYm.set(String(f.ym), n);
        }
      }
      const followers = [...byYm.entries()].map(([ym, value]) => ({ ym, value })).sort((a, b) => (a.ym < b.ym ? -1 : 1)).slice(-240);
      if (followers.length) ed.put('followers', followers); else ed.del('followers');
    }
    await patchSmmData(this.repo.manager, id, ed.set, ed.unset);
    await this.activityLog.log({
      userId: user?.id, userName: user?.name, action: ActivityAction.PROJECT_UPDATE,
      entity: 'project', entityId: id, entityName: project.name, details: { smmProfile: true },
    });
    this.gateway.broadcast('projects:changed', { projectId: id });
    // Возвращаем через getSmmProfile — с резолвом специалистов (имя/аватар).
    return this.getSmmProfile(id, user);
  }

  /** Схема нагрузки SMM: каждый специалист (role=smm_specialist) с его
   *  активными SMM-проектами + проекты без назначенного специалиста.
   *  Руководитель SMM — своей колонкой: свои проекты он ведёт как
   *  специалист (30.10.2026). */
  async smmSpecialistLoad() {
    // Служебный проект «Одноразовые съёмки» на схеме не нужен (15.11.2026).
    const projects = await this.repo.find({ where: { projectType: 'SMM', isOneOffSystem: false } });
    const active = projects.filter(p => String(p.status) !== 'archived');
    // Только действующие и незаблокированные (15.11.2026): уволенный
    // специалист висел на схеме колонкой, и на него можно было перетащить
    // проект. Вторая роль специалиста тоже считается — как при назначении.
    const allSpecs = await this.userRepo.find({
      where: [
        { role: UserRole.SMM_SPECIALIST, isActive: true, isBlocked: false },
        { secondaryRole: UserRole.SMM_SPECIALIST, isActive: true, isBlocked: false },
        { role: UserRole.SMM_DIRECTOR, isActive: true, isBlocked: false },
      ],
    });
    const specMap = new Map<string, { id: string; name: string; avatar: string | null; role: string; projects: { id: string; name: string }[] }>();
    for (const u of allSpecs) specMap.set(u.id, { id: u.id, name: u.name, avatar: u.avatar || null, role: u.role, projects: [] });
    const unassigned: { id: string; name: string }[] = [];
    for (const p of active) {
      const ids = Array.isArray((p.smmData as any)?.smmSpecialistIds)
        ? ((p.smmData as any).smmSpecialistIds as any[]).filter(x => typeof x === 'string') : [];
      const proj = { id: p.id, name: p.name };
      let matched = false;
      for (const uid of ids) { const s = specMap.get(uid); if (s) { s.projects.push(proj); matched = true; } }
      if (!matched) unassigned.push(proj);
    }
    const collator = new Intl.Collator('ru');
    const specialists = [...specMap.values()].sort((a, b) => collator.compare(a.name, b.name));
    unassigned.sort((a, b) => collator.compare(a.name, b.name));
    return { specialists, unassigned };
  }

  /** Ответственный менеджер SMM-проекта — любой менеджер по продажам
   *  (решение владельца 10.10.2026; 14.10 круг сужали до менеджеров СММ,
   *  15.10 владелец вернул обоих): у проекта он один, хранится в
   *  smmData.salesManagerId. */
  private static readonly SALES_ROLES = [UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV];

  /** «Схема менеджеров»: каждый менеджер по продажам с его SMM-проектами +
   *  проекты без менеджера. У проекта — имена его SMM-специалистов, чтобы
   *  на карточке было видно, кто ведёт контент. */
  async smmManagerLoad() {
    const projects = await this.repo.find({ where: { projectType: 'SMM', isOneOffSystem: false } });
    const active = projects.filter(p => String(p.status) !== 'archived');
    const roles = ProjectsService.SALES_ROLES;
    const users = await this.userRepo.find({
      where: [{ role: In(roles), isActive: true }, { secondaryRole: In(roles), isActive: true }],
    });
    type Proj = { id: string; name: string; specialists: string[] };
    const map = new Map<string, { id: string; name: string; avatar: string | null; projects: Proj[] }>();
    for (const u of users) map.set(u.id, { id: u.id, name: u.name, avatar: u.avatar || null, projects: [] });

    const specIds = new Set<string>();
    for (const p of active) for (const x of ((p.smmData as any)?.smmSpecialistIds || [])) if (typeof x === 'string') specIds.add(x);
    const specs = specIds.size ? await this.userRepo.find({ where: { id: In([...specIds]) } }) : [];
    const specName = new Map(specs.map(u => [u.id, u.name]));

    const unassigned: Proj[] = [];
    for (const p of active) {
      const sd: any = p.smmData || {};
      const proj: Proj = {
        id: p.id, name: p.name,
        specialists: (Array.isArray(sd.smmSpecialistIds) ? sd.smmSpecialistIds : [])
          .map((x: any) => specName.get(x)).filter(Boolean) as string[],
      };
      const m = typeof sd.salesManagerId === 'string' ? map.get(sd.salesManagerId) : undefined;
      if (m) m.projects.push(proj); else unassigned.push(proj);
    }
    const collator = new Intl.Collator('ru');
    const managers = [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
    for (const m of managers) m.projects.sort((a, b) => collator.compare(a.name, b.name));
    unassigned.sort((a, b) => collator.compare(a.name, b.name));
    return { managers, unassigned };
  }

  /** Назначить (или снять — null) ответственного менеджера SMM-проекта. */
  async setSmmManager(id: string, managerId: string | null) {
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Проект не найден');
    if (project.projectType !== 'SMM') throw new BadRequestException('Менеджера назначают только SMM-проектам');
    if (managerId) {
      const u = await this.userRepo.findOne({ where: { id: managerId } });
      const roles = ProjectsService.SALES_ROLES as string[];
      if (!u || !u.isActive || !(roles.includes(u.role as string) || roles.includes((u as any).secondaryRole as string))) {
        throw new BadRequestException('Ответственным может быть только менеджер по продажам');
      }
    }
    const sd: any = { ...(project.smmData || {}) };
    const prev = typeof sd.salesManagerId === 'string' ? sd.salesManagerId : null;
    sd.salesManagerId = managerId || null;
    // История назначений (14.11.2026): оплата засчитывается тому, кто вёл
    // проект в день оплаты, — смена менеджера не переносит прошлые деньги.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
    const since = project.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date(project.createdAt)) : null;
    const history = withManagerChange(sd.salesManagerHistory, prev, sd.salesManagerId, today, since);
    // Атомарно — только эти два ключа (15.11.2026).
    if (history.length) {
      await patchSmmData(this.repo.manager, id, { salesManagerId: sd.salesManagerId, salesManagerHistory: history });
    } else {
      await patchSmmData(this.repo.manager, id, { salesManagerId: sd.salesManagerId }, ['salesManagerHistory']);
    }
    return { ok: true, salesManagerId: sd.salesManagerId };
  }

  async archive(id: string, user?: { id: string; role: string; name?: string }) {
    const project = await this.findOne(id);
    // smm_director может архивировать ТОЛЬКО SMM-проекты (его область).
    if (user?.role === 'smm_director' && project.projectType !== 'SMM') {
      throw new ForbiddenException('Руководитель SMM может архивировать только SMM-проекты');
    }
    // Направление — по обеим ролям (15.11.2026): МП второй ролью тоже
    // ограничен своим сегментом.
    if (user && !inDirection(user as AccessUser, project.projectType)) {
      throw new ForbiddenException('Вы можете архивировать только проекты своего направления');
    }
    // ПМ по разработке (грант projects.archive) — только dev-проекты.
    if (['pm_dev', 'dev_director'].includes(user?.role as string) && !DEV_PROJECT_TYPES.includes(project.projectType as string)) {
      throw new ForbiddenException('Проект-менеджер по разработке может архивировать только проекты разработки');
    }
    // Менеджер продаж прячет проект ТОЛЬКО у себя: команда продолжает по нему
    // работать, задачи и дедлайны живут дальше. Общий архив ведут руководство
    // и руководители направлений. Исключение — вторая роль dev_director
    // (Сабрина): руководитель разработки ведёт НАСТОЯЩИЙ архив dev-проектов,
    // как smm_director в SMM, а не личное скрытие.
    const archAsDevDirector = (user as any)?.secondaryRole === 'dev_director'
      && DEV_PROJECT_TYPES.includes(project.projectType as string);
    if (!archAsDevDirector && isSalesManager(user?.role) && user?.id) {
      await this.repo.manager.query(
        `INSERT INTO project_hidden (user_id, project_id) VALUES ($1, $2)
         ON CONFLICT (user_id, project_id) DO NOTHING`,
        [user.id, id],
      );
      await this.activityLog.log({
        userId: user.id,
        action: ActivityAction.PROJECT_ARCHIVE,
        entity: 'project',
        entityId: id,
        entityName: project.name,
        details: { personal: true, note: 'Скрыт из личного списка (проект остался активным)' },
      });
      this.gateway.broadcast('projects:changed', {});
      return this.findOne(id, user);
    }
    await this.repo.update(id, { isArchived: true, status: ProjectStatus.ARCHIVED });
    await this.activityLog.log({
      action: ActivityAction.PROJECT_ARCHIVE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
    });
    this.gateway.broadcast('projects:changed', {});
    return this.findOne(id, user);
  }

  async restore(id: string, user?: { id: string; role: string; name?: string }) {
    const project = await this.findOne(id);
    if (user?.role === 'smm_director' && project.projectType !== 'SMM') {
      throw new ForbiddenException('Руководитель SMM может восстанавливать только SMM-проекты');
    }
    if (user && !inDirection(user as AccessUser, project.projectType)) {
      throw new ForbiddenException('Вы можете восстанавливать только проекты своего направления');
    }
    // ПМ по разработке (грант projects.archive) — только dev-проекты.
    if (['pm_dev', 'dev_director'].includes(user?.role as string) && !DEV_PROJECT_TYPES.includes(project.projectType as string)) {
      throw new ForbiddenException('Проект-менеджер по разработке может восстанавливать только проекты разработки');
    }
    // Менеджеру продаж «восстановить» = вернуть проект в свой список.
    // Общий флаг isArchived он не трогает — проект и не был архивирован.
    // Вторая роль dev_director — настоящее восстановление, зеркально archive().
    const restoreAsDevDirector = (user as any)?.secondaryRole === 'dev_director'
      && DEV_PROJECT_TYPES.includes(project.projectType as string);
    if (!restoreAsDevDirector && isSalesManager(user?.role) && user?.id) {
      await this.repo.manager.query(
        `DELETE FROM project_hidden WHERE user_id = $1 AND project_id = $2`,
        [user.id, id],
      );
      await this.activityLog.log({
        userId: user.id,
        action: ActivityAction.PROJECT_RESTORE,
        entity: 'project',
        entityId: id,
        entityName: project.name,
        details: { personal: true, note: 'Возвращён в личный список' },
      });
      this.gateway.broadcast('projects:changed', {});
      return this.findOne(id, user);
    }
    // При восстановлении НЕ форсируем COMPLETED — возвращаем в IN_PROGRESS
    // как safe default. Если был completed до архива — пользователь может
    // вручную пометить заново. Раньше форсилось COMPLETED, что теряло
    // информацию о реальном состоянии проекта.
    await this.repo.update(id, { isArchived: false, status: ProjectStatus.IN_PROGRESS });
    await this.activityLog.log({
      action: ActivityAction.PROJECT_RESTORE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
    });
    this.gateway.broadcast('projects:changed', {});
    return this.findOne(id, user);
  }

  async remove(id: string, user?: { id: string; role: string; name?: string }) {
    const p = await this.findOne(id);

    // Служебный проект одноразовых съёмок удалять нельзя — его карточки
    // на доске осиротеют, а следующая one-off карточка пересоздаст проект.
    if (p.isOneOffSystem) {
      throw new BadRequestException('Служебный проект «Одноразовые съёмки» нельзя удалить');
    }

    // Доступ к удалению: founder/co_founder/admin — без ограничений;
    // smm_director — только SMM-проекты. Прочие роли — нельзя.
    if (user) {
      const role = user.role;
      const isTopAdmin = ['admin', 'founder'].includes(role);
      const isSmmDirOnSmm = role === 'smm_director' && p.projectType === 'SMM';
      if (!isTopAdmin && !isSmmDirOnSmm) {
        throw new ForbiddenException(
          role === 'smm_director'
            ? 'Руководитель SMM может удалять только SMM-проекты'
            : 'Удалять проекты могут только администратор, основатель, сооснователь и руководитель SMM (для SMM-проектов)',
        );
      }
    }

    await this.activityLog.log({
      userId: user?.id,
      userName: user?.name,
      action: ActivityAction.PROJECT_DELETE,
      entity: 'project',
      entityId: id,
      entityName: p.name,
    });
    // Личные скрытия удаляемого проекта — у таблицы нет FK, чистим руками,
    // иначе строки останутся мусором навсегда.
    await this.repo.manager
      .query(`DELETE FROM project_hidden WHERE project_id = $1`, [id])
      .catch(() => undefined);
    await this.repo.remove(p);
    this.gateway.broadcast('projects:changed', {});
    return { message: 'Project deleted' };
  }

  async updateProgress(id: string | null | undefined) {
    // Без проекта считать нечего. Раньше сюда приходил null от задач без
    // проекта (личные, прямые от основателя): TypeORM отбрасывает пустое
    // условие, и findOne грузил ПЕРВЫЙ попавшийся проект со всеми его
    // задачами и пересчитывал ему прогресс — секунды на каждую отметку или
    // удаление такой задачи.
    if (!id) return;
    const project = await this.repo.findOne({ where: { id }, relations: ['tasks'] });
    if (!project) return;

    // No tasks → progress = 0
    if (!project.tasks || !project.tasks.length) {
      if (project.progress !== 0) {
        project.progress = 0;
        await this.repo.save(project);
      }
      return;
    }

    // Weight per status (4-статусная модель): new=0%, in_progress=50%, done=100%,
    // cancelled — исключена из расчёта.
    const statusWeight: Record<string, number> = {
      new: 0,
      in_progress: 50,
      done: 100,
    };

    const activeTasks = project.tasks.filter(t => t.status !== 'cancelled');
    if (!activeTasks.length) {
      project.progress = 0;
      return this.repo.save(project);
    }

    const totalWeight = activeTasks.reduce((sum, t) => sum + (statusWeight[t.status] ?? 0), 0);
    project.progress = Math.round(totalWeight / activeTasks.length);

    // Auto-update project status based on task completion
    const allDone = activeTasks.every(t => t.status === 'done');
    if (allDone && project.status !== ProjectStatus.ARCHIVED) {
      project.status = ProjectStatus.COMPLETED;
    } else if (!allDone && project.status === ProjectStatus.COMPLETED) {
      project.status = ProjectStatus.IN_PROGRESS;
    }

    return this.repo.save(project);
  }

  getStats() {
    return this.repo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('p.isArchived = false')
      .groupBy('p.status')
      .getRawMany();
  }

  /** Письмо клиенту «Запрос оплаты». Руководство — по любому проекту,
   *  менеджер по продажам — только по своему (assertMoneyScope).
   *  Сумма — из «Финансов» (15.11.2026, «Продажи, этап 2»): к оплате —
   *  просроченное и со сроком сегодня у клиента «Финансов», связанного с
   *  проектом; оплачено — полученное за те же месяцы. Поля проекта
   *  totalContractValue/budget/paidAmount больше не используются — их
   *  никто не ведёт, и письмо уходило с выдуманным долгом. Проект не связан
   *  с «Финансами» — 400 с объяснением, что сделать. */
  async sendPaymentRequest(
    id: string,
    actor: { id: string; name?: string; role: string; secondaryRole?: string | null },
    customMessage?: string,
  ) {
    this.assertUuidOr400(id, 'id');
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    this.assertMoneyScope(actor, project);

    const clientInfo = (project.clientInfo || {}) as any;
    const clientEmail: string | undefined = clientInfo.email;
    const clientName: string = clientInfo.contactPerson || clientInfo.name || 'Клиент';
    if (!clientEmail) {
      throw new ForbiddenException('У проекта не указан email клиента. Добавьте его во вкладке "О клиенте".');
    }

    const debt = await this.smmPayments.projectDebt(project);
    if (!debt) {
      // Что делать — зависит от направления: SMM-проект связывают вручную в
      // карточке, клиента разработки и дизайна находим только по названию.
      throw new BadRequestException(
        'Проект не связан с клиентом в «Финансах», поэтому сумму долга взять неоткуда. '
        + (project.projectType === 'SMM'
          ? 'Попросите руководителя связать проект с клиентом «Финансов» (карточка проекта → «Оплата клиента»).'
          : 'Название проекта в CRM должно совпадать с названием клиента в «Финансах» того же направления — попросите руководителя проверить.'),
      );
    }
    if (debt.remaining <= 0) {
      throw new BadRequestException('По данным «Финансов» у клиента сейчас нет долга — просроченных или сегодняшних оплат нет');
    }

    const ok = await this.mailService.sendPaymentRequestToClient(
      clientEmail,
      clientName,
      project.name,
      debt.total,
      debt.paid,
      debt.remaining,
      actor.name || 'Менеджер по продажам',
      customMessage,
    );

    await this.activityLog.log({
      userId: actor.id,
      userName: actor.name,
      action: ActivityAction.PROJECT_UPDATE,
      entity: 'project',
      entityId: id,
      entityName: project.name,
      details: {
        kind: 'payment_request_sent', to: clientEmail, remaining: debt.remaining, byRole: actor.role,
        source: 'finance', financeProjectId: debt.client.id,
      },
    });

    return { sent: ok, to: clientEmail, remaining: debt.remaining, total: debt.total, paid: debt.paid };
  }
}
