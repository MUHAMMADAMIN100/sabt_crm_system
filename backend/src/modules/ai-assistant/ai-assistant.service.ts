import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { User, UserRole } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Comment } from '../comments/comment.entity';
import { Notification } from '../notifications/notification.entity';
import { ActivityLog } from '../activity-log/activity-log.entity';
import { StoryLog } from '../stories/story.entity';
import { FileAttachment } from '../files/file.entity';
import { WorkSession } from '../auth/work-session.entity';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as https from 'https';

export interface AiUserContext {
  id: string;
  role: UserRole;
}

/** Пользователи, которым доступна полная картина по БД. */
const FULL_ACCESS_ROLES: ReadonlySet<UserRole> = new Set([UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER]);

/** Пользователи, которые видят только свои проекты (плюс команду и задачи в них). */
const PROJECT_SCOPED_ROLES: ReadonlySet<UserRole> = new Set([UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM]);

// Default fallback chain (used when user doesn't pick a specific model)
const GEMINI_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
];

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

// Models user can select from frontend
export interface AiModelOption {
  id: string;
  name: string;
  provider: 'gemini' | 'groq';
  description: string;
  speed: 'fast' | 'medium' | 'slow';
}

const AVAILABLE_MODELS: AiModelOption[] = [
  // Gemini
  { id: 'gemini-2.5-flash',       provider: 'gemini', name: 'Gemini 2.5 Flash',       description: 'Самая умная, лучшая для аналитики',     speed: 'medium' },
  { id: 'gemini-2.0-flash',       provider: 'gemini', name: 'Gemini 2.0 Flash',       description: 'Быстрая и точная',                       speed: 'fast' },
  { id: 'gemini-2.0-flash-lite',  provider: 'gemini', name: 'Gemini 2.0 Flash Lite',  description: 'Очень быстрая, для простых вопросов',    speed: 'fast' },
  { id: 'gemini-flash-latest',    provider: 'gemini', name: 'Gemini Flash Latest',    description: 'Последняя стабильная версия',            speed: 'medium' },
  // Groq
  { id: 'llama-3.3-70b-versatile', provider: 'groq',  name: 'Llama 3.3 70B',          description: 'Открытая модель Meta, очень быстрая',    speed: 'fast' },
  { id: 'llama-3.1-8b-instant',    provider: 'groq',  name: 'Llama 3.1 8B Instant',   description: 'Самая быстрая, для коротких вопросов',   speed: 'fast' },
];

// Context cache TTL
const CONTEXT_CACHE_TTL_MS = 30_000; // 30 seconds

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private gemini: GoogleGenerativeAI | null = null;
  private groqKey: string | null = null;

  // Кэш контекста — отдельный для каждого пользователя,
  // потому что данные теперь фильтруются по роли/id.
  private contextCache = new Map<string, { context: string; cachedAt: number }>();

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(TimeLog) private timeRepo: Repository<TimeLog>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
    @InjectRepository(Comment) private commentRepo: Repository<Comment>,
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    @InjectRepository(ActivityLog) private activityRepo: Repository<ActivityLog>,
    @InjectRepository(StoryLog) private storyRepo: Repository<StoryLog>,
    @InjectRepository(FileAttachment) private fileRepo: Repository<FileAttachment>,
    @InjectRepository(WorkSession) private sessionRepo: Repository<WorkSession>,
  ) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      this.gemini = new GoogleGenerativeAI(geminiKey);
      this.logger.log('Gemini ready');
    }
    this.groqKey = process.env.GROQ_API_KEY || null;
    if (this.groqKey) this.logger.log('Groq ready (fallback)');
    if (!this.gemini && !this.groqKey) {
      this.logger.warn('No AI provider configured (GEMINI_API_KEY or GROQ_API_KEY)');
    }
  }

  /** List available models with their availability status */
  listModels(): { models: AiModelOption[]; defaultModel: string } {
    const models = AVAILABLE_MODELS.filter(m => {
      if (m.provider === 'gemini') return !!this.gemini;
      if (m.provider === 'groq') return !!this.groqKey;
      return false;
    });
    // Default: Llama 3.1 8B Instant (fastest), fall back to other Groq, then Gemini
    let defaultModel = 'llama-3.1-8b-instant';
    if (!this.groqKey) {
      defaultModel = this.gemini ? 'gemini-2.5-flash' : '';
    }
    return { models, defaultModel };
  }

  async chat(question: string, userCtx: AiUserContext, selectedModel?: string): Promise<string> {
    if (!this.gemini && !this.groqKey) {
      return 'ИИ-помощник не настроен. Добавьте GEMINI_API_KEY или GROQ_API_KEY в переменные окружения.';
    }

    const context = await this.getCachedContext(userCtx);
    const today = new Date().toLocaleDateString('ru-RU');
    const scopeNote = this.describeScope(userCtx.role);

    const systemPrompt = `Ты — главный ИИ-аналитик CRM-системы "Sabt" для SMM-агентства. Твоя задача — помогать пользователю глубоко понимать что происходит в его рабочем пространстве, отвечать на ЛЮБЫЕ вопросы — от самых простых ("Сколько задач?") до сложных аналитических ("Кто из дизайнеров эффективнее справляется с дедлайнами в SMM-проектах за последний месяц?").

ВИДИМОСТЬ ДАННЫХ: ${scopeNote}
Никогда не раскрывай и не строй гипотез о данных вне этого контекста. Если пользователь спросил про проект/задачу/сотрудника, которых нет в данных ниже — скажи "У вас нет доступа к этой информации" и не выдумывай.

ПРАВИЛА:
1. Отвечай ВСЕГДА на русском языке.
2. Используй ТОЛЬКО предоставленные ниже данные из БД. Никогда не выдумывай.
3. Если данных недостаточно для ответа — честно скажи "В базе нет данных о X" и предложи что-то близкое.
4. Будь МАКСИМАЛЬНО конкретным: давай имена, цифры, даты, проценты. НЕ обобщай.
5. Делай выводы и рекомендации, если они уместны.
6. Форматируй ответ красиво через markdown: заголовки (##), списки (-), жирный шрифт (**), эмодзи где уместно (📊 ✅ ⚠️ 🔥 👤 📁).
7. Для коротких вопросов — короткий ответ. Для аналитических — структурированный с разделами.
8. Если спросили про конкретного человека — найди его в данных и используй ВСЁ что про него знаешь (должность, email, телефон, telegram, проекты, задачи, активность, тайм-логи, комментарии).
9. Если спросили "топ X" — выведи топ с цифрами.
10. Если задают вопрос на узбекском/таджикском — отвечай на русском, но уважительно.

СЕГОДНЯШНЯЯ ДАТА: ${today}

═══════════════════════════════════════
ПОЛНЫЕ ДАННЫЕ ИЗ БАЗЫ ДАННЫХ CRM "SABT":
═══════════════════════════════════════

${context}

═══════════════════════════════════════
ВОПРОС ПОЛЬЗОВАТЕЛЯ: ${question}
═══════════════════════════════════════

Дай точный, полный, красиво оформленный ответ строго на основе данных выше.`;

    // If user picked a specific model — try ONLY that model first, then fall back
    if (selectedModel) {
      const found = AVAILABLE_MODELS.find(m => m.id === selectedModel);
      if (found) {
        try {
          if (found.provider === 'gemini' && this.gemini) {
            const model = this.gemini.getGenerativeModel({
              model: found.id,
              generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
            });
            const result = await model.generateContent(systemPrompt);
            const text = result.response.text();
            if (text) {
              this.logger.log(`Response from selected Gemini (${found.id})`);
              return text;
            }
          }
          if (found.provider === 'groq' && this.groqKey) {
            const text = await this.callGroq(found.id, systemPrompt);
            if (text) {
              this.logger.log(`Response from selected Groq (${found.id})`);
              return text;
            }
          }
        } catch (error: any) {
          this.logger.warn(`Selected model ${selectedModel} failed: ${error?.message}, falling back to chain`);
        }
      }
    }

    // Auto fallback chain — try Gemini first
    if (this.gemini) {
      for (const modelName of GEMINI_MODEL_CHAIN) {
        try {
          const model = this.gemini.getGenerativeModel({
            model: modelName,
            generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
          });
          const result = await model.generateContent(systemPrompt);
          const text = result.response.text();
          if (text) {
            this.logger.log(`Response from Gemini (${modelName})`);
            return text;
          }
        } catch (error: any) {
          const msg = error?.message || '';
          if (msg.includes('503') || msg.includes('429') || msg.includes('overloaded') || msg.includes('quota') || msg.includes('high demand')) {
            continue;
          }
          break;
        }
      }
    }

    // Fallback to Groq
    if (this.groqKey) {
      for (const modelName of GROQ_MODELS) {
        try {
          const text = await this.callGroq(modelName, systemPrompt);
          if (text) {
            this.logger.log(`Response from Groq (${modelName})`);
            return text;
          }
        } catch (error: any) {
          this.logger.warn(`Groq ${modelName} failed: ${error?.message}`);
          continue;
        }
      }
    }

    return 'Ошибка ИИ: все провайдеры временно недоступны, попробуйте через минуту.';
  }

  /** Возвращает кэшированный контекст для конкретного пользователя (<30s), иначе строит свежий */
  private async getCachedContext(userCtx: AiUserContext): Promise<string> {
    const now = Date.now();
    const key = `${userCtx.role}:${userCtx.id}`;
    const cached = this.contextCache.get(key);
    if (cached && now - cached.cachedAt < CONTEXT_CACHE_TTL_MS) {
      return cached.context;
    }
    const fresh = await this.gatherFullContext(userCtx);
    this.contextCache.set(key, { context: fresh, cachedAt: now });
    // Чистим протухшие записи, чтобы мапа не росла бесконечно
    if (this.contextCache.size > 50) {
      for (const [k, v] of this.contextCache) {
        if (now - v.cachedAt > CONTEXT_CACHE_TTL_MS) this.contextCache.delete(k);
      }
    }
    return fresh;
  }

  /** Текстовое описание scope для системного промпта — чтобы LLM понимала границы */
  private describeScope(role: UserRole): string {
    if (FULL_ACCESS_ROLES.has(role)) {
      return 'полный доступ ко всей базе компании (все пользователи, проекты, задачи, отчёты, активность).';
    }
    if (PROJECT_SCOPED_ROLES.has(role)) {
      return 'только проекты, где пользователь является менеджером или участником, и задачи/комментарии/файлы внутри них. Контакты других сотрудников (email, телефон, telegram) скрыты.';
    }
    return 'только собственные задачи, отчёты и тайм-логи + названия проектов, где пользователь состоит. Данные о других сотрудниках не видны.';
  }

  private callGroq(model: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.4,
      });
      const req = https.request(
        {
          hostname: 'api.groq.com',
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Authorization: `Bearer ${this.groqKey}`,
          },
          timeout: 60000,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              const j = JSON.parse(body);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(j.choices?.[0]?.message?.content || '');
              } else {
                reject(new Error(`Groq ${res.statusCode}: ${j.error?.message || body.slice(0, 200)}`));
              }
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout')); });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Собирает контекст для ИИ с учётом роли пользователя.
   * - admin/founder → полный снимок БД
   * - project_manager → только свои проекты, их задачи/команда/файлы (без PII сотрудников)
   * - остальные роли → только свои задачи/отчёты/тайм-логи
   */
  private async gatherFullContext(userCtx: AiUserContext): Promise<string> {
    if (FULL_ACCESS_ROLES.has(userCtx.role)) {
      return this.gatherAdminContext();
    }
    if (PROJECT_SCOPED_ROLES.has(userCtx.role)) {
      return this.gatherProjectManagerContext(userCtx.id);
    }
    return this.gatherEmployeeContext(userCtx.id);
  }

  /**
   * Полный снимок БД для admin/founder.
   * Small DB → влезает в Gemini 1M token context.
   */
  private async gatherAdminContext(): Promise<string> {
    const parts: string[] = [];

    // Run all queries in parallel
    const [
      // Counts
      totalActiveProjects, totalArchivedProjects, totalTasks, totalEmployees, totalUsers,
      doneTasks, overdueRow,
      // Full data
      employees, projects, archivedProjects, tasks, comments,
      timeLogs, reports, stories, files, recentActivity,
      recentSessions, allUsers,
    ] = await Promise.all([
      this.projectRepo.count({ where: { isArchived: false } }),
      this.projectRepo.count({ where: { isArchived: true } }),
      this.taskRepo.count(),
      this.employeeRepo.count(),
      this.userRepo.count(),
      this.taskRepo.count({ where: { status: 'done' as any } }),
      this.taskRepo.manager.query(
        `SELECT COUNT(*)::int AS count FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled')`
      ),
      this.employeeRepo.find({ relations: ['user'], order: { fullName: 'ASC' } }),
      this.projectRepo.find({
        where: { isArchived: false },
        relations: ['members', 'tasks', 'manager'],
        order: { createdAt: 'DESC' },
      }),
      this.projectRepo.find({
        where: { isArchived: true },
        relations: ['manager'],
        order: { updatedAt: 'DESC' },
        take: 30,
      }),
      this.taskRepo.find({
        relations: ['assignee', 'project', 'createdBy'],
        order: { updatedAt: 'DESC' },
        take: 200,
      }),
      this.commentRepo.find({
        relations: ['author', 'task'],
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.timeRepo.find({
        relations: ['employee', 'task'],
        order: { date: 'DESC' },
        take: 100,
      }),
      this.reportRepo.find({
        relations: ['employee', 'project', 'task'],
        order: { date: 'DESC' },
        take: 50,
      }),
      this.storyRepo.find({
        relations: ['user', 'project'],
        order: { date: 'DESC' },
        take: 100,
      }).catch(() => []),
      this.fileRepo.find({
        relations: ['uploadedBy', 'project', 'task'],
        order: { createdAt: 'DESC' },
        take: 50,
      }).catch(() => []),
      this.activityRepo.find({
        relations: ['user'],
        order: { createdAt: 'DESC' },
        take: 100,
      }).catch(() => []),
      this.sessionRepo.find({
        relations: ['user'],
        order: { loginAt: 'DESC' },
        take: 50,
      }).catch(() => []),
      this.userRepo.find({ order: { createdAt: 'DESC' } }),
    ]);

    const overdueCount = overdueRow?.[0]?.count || 0;

    // ── 1. SUMMARY ─────────────────────────────────────────
    parts.push(`## 📊 СВОДКА
- Всего пользователей: ${totalUsers}
- Сотрудников (employees): ${totalEmployees}
- Активных проектов: ${totalActiveProjects}
- Архивных проектов: ${totalArchivedProjects}
- Задач всего: ${totalTasks} (выполнено: ${doneTasks}, просрочено: ${overdueCount})
- Тайм-логов: ${timeLogs.length}, отчётов: ${reports.length}, комментариев: ${comments.length}, файлов: ${files.length}, сторис: ${stories.length}`);

    // ── 2. USERS (system accounts) ─────────────────────────
    const userList = allUsers.map((u, i) => {
      return `${i + 1}. ${u.name} | role: ${u.role} | email: ${u.email} | active: ${u.isActive} | created: ${new Date(u.createdAt).toLocaleDateString('ru-RU')}`;
    }).join('\n');
    parts.push(`## 👥 ВСЕ ПОЛЬЗОВАТЕЛИ СИСТЕМЫ (${allUsers.length})\n${userList}`);

    // ── 3. EMPLOYEES (full profiles) ───────────────────────
    const empList = employees.map((e, i) => {
      const status = e.status === 'active' ? '✅' : '⏸';
      return `${i + 1}. ${status} **${e.fullName}**
   - Должность: ${e.position || '—'}
   - Отдел: ${e.department || '—'}
   - Email: ${e.email || '—'}
   - Phone: ${e.phone || '—'}
   - Telegram: ${e.telegram || '—'}
   - Instagram: ${(e as any).instagram || '—'}
   - Дата найма: ${e.hireDate ? new Date(e.hireDate).toLocaleDateString('ru-RU') : '—'}
   - Активность: ${e.activityScore || 0}/100
   - Задач выполнено: ${e.tasksCompleted || 0}
   - Задач просрочено: ${e.tasksOverdue || 0}
   - Роль системы: ${e.user?.role || '—'}
   - User ID: ${e.userId || '—'}
   - Sub-admin: ${e.isSubAdmin ? 'да' : 'нет'}`;
    }).join('\n\n');
    parts.push(`## 👤 ВСЕ СОТРУДНИКИ (${employees.length})\n${empList}`);

    // ── 4. PROJECTS (full details) ─────────────────────────
    const projList = projects.map((p, i) => {
      const taskCount = p.tasks?.length || 0;
      const doneCount = p.tasks?.filter(t => t.status === 'done').length || 0;
      const memberNames = (p.members || []).map(m => m.name).join(', ') || '—';
      const startDate = p.startDate ? new Date(p.startDate).toLocaleDateString('ru-RU') : '—';
      const endDate = p.endDate ? new Date(p.endDate).toLocaleDateString('ru-RU') : '—';
      return `${i + 1}. **"${p.name}"**
   - ID: ${p.id}
   - Статус: ${p.status}
   - Прогресс: ${p.progress}%
   - Тип: ${p.projectType || '—'}
   - Описание: ${p.description || '—'}
   - Менеджер: ${p.manager?.name || '—'}
   - Участники (${(p.members || []).length}): [${memberNames}]
   - Задач: ${taskCount} (готово: ${doneCount})
   - Бюджет: ${p.budget || '—'}
   - Старт: ${startDate}, Дедлайн: ${endDate}
   - Создан: ${new Date(p.createdAt).toLocaleDateString('ru-RU')}`;
    }).join('\n\n');
    parts.push(`## 📁 АКТИВНЫЕ ПРОЕКТЫ (${projects.length})\n${projList || 'Нет активных проектов'}`);

    if (archivedProjects.length > 0) {
      const archList = archivedProjects.map(p => `- "${p.name}" | менеджер: ${p.manager?.name || '—'} | завершён: ${new Date(p.updatedAt).toLocaleDateString('ru-RU')}`).join('\n');
      parts.push(`## 📦 АРХИВНЫЕ ПРОЕКТЫ (${archivedProjects.length})\n${archList}`);
    }

    // ── 5. TASKS (recent 200) ──────────────────────────────
    const taskList = tasks.map((t, i) => {
      const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '—';
      const overdue = t.deadline && new Date(t.deadline) < new Date() && !['done', 'cancelled'].includes(t.status) ? ' ⚠️ПРОСРОЧЕНА' : '';
      return `${i + 1}. "${t.title}" | Проект: ${t.project?.name || '—'} | Статус: ${t.status} | Приоритет: ${t.priority} | Исполнитель: ${t.assignee?.name || '—'} | Создал: ${t.createdBy?.name || '—'} | Дедлайн: ${deadline}${overdue}${t.description ? ` | Описание: ${t.description.slice(0, 100)}` : ''}`;
    }).join('\n');
    parts.push(`## ✅ ЗАДАЧИ (${tasks.length} последних)\n${taskList || 'Нет задач'}`);

    // ── 6. COMMENTS (recent) ───────────────────────────────
    if (comments.length > 0) {
      const cmtList = comments.map(c => `- ${c.author?.name || '?'} → "${c.task?.title || '?'}": ${(c.message || '').slice(0, 150)} (${new Date(c.createdAt).toLocaleDateString('ru-RU')})`).join('\n');
      parts.push(`## 💬 КОММЕНТАРИИ (последние ${comments.length})\n${cmtList}`);
    }

    // ── 7. TIME LOGS ───────────────────────────────────────
    if (timeLogs.length > 0) {
      const logList = timeLogs.map(l => `- ${l.employee?.name || '—'} | ${l.task?.title || '—'} | ${l.timeSpent}ч | ${new Date(l.date).toLocaleDateString('ru-RU')}${l.description ? ` — ${l.description.slice(0, 80)}` : ''}`).join('\n');
      parts.push(`## ⏱ ТАЙМ-ЛОГИ (${timeLogs.length} последних)\n${logList}`);
    }

    // ── 8. REPORTS ─────────────────────────────────────────
    if (reports.length > 0) {
      const repList = reports.map(r => `- ${r.employee?.name || '—'} | ${new Date(r.date).toLocaleDateString('ru-RU')} | ${r.timeSpent || 0}ч | Проект: ${r.project?.name || '—'} | ${(r.description || '').slice(0, 100)}`).join('\n');
      parts.push(`## 📋 ОТЧЁТЫ (${reports.length})\n${repList}`);
    }

    // ── 9. STORIES (SMM) ───────────────────────────────────
    if (stories.length > 0) {
      const stList = stories.map((s: any) => `- ${s.user?.name || '—'} | Проект: ${s.project?.name || '—'} | ${s.storiesCount || 0} сторис | ${new Date(s.date).toLocaleDateString('ru-RU')}`).join('\n');
      parts.push(`## 📸 СТОРИС (${stories.length})\n${stList}`);
    }

    // ── 10. FILES ──────────────────────────────────────────
    if (files.length > 0) {
      const fileList = files.map(f => `- ${f.originalName} | загрузил: ${f.uploadedBy?.name || '—'} | размер: ${Math.round(f.size / 1024)}KB | проект: ${f.project?.name || '—'} | задача: ${f.task?.title || '—'}`).join('\n');
      parts.push(`## 📎 ФАЙЛЫ (${files.length})\n${fileList}`);
    }

    // ── 11. ACTIVITY LOG ───────────────────────────────────
    if (recentActivity.length > 0) {
      const actList = recentActivity.slice(0, 50).map(a => `- ${new Date(a.createdAt).toLocaleString('ru-RU')} | ${a.userName || a.user?.name || '?'} | ${a.action} | ${a.entity || ''} ${a.entityName || ''}`).join('\n');
      parts.push(`## 📜 АКТИВНОСТЬ (последние 50 событий)\n${actList}`);
    }

    // ── 12. WORK SESSIONS ──────────────────────────────────
    if (recentSessions.length > 0) {
      const sesList = recentSessions.map(s => {
        const login = new Date(s.loginAt).toLocaleString('ru-RU');
        const logout = s.logoutAt ? new Date(s.logoutAt).toLocaleString('ru-RU') : 'в сети';
        return `- ${s.user?.name || '?'} | ${login} → ${logout} | ${s.durationHours || 0}ч`;
      }).join('\n');
      parts.push(`## 🕐 СЕССИИ ВХОДА (${recentSessions.length})\n${sesList}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Контекст для project manager: только проекты, где он менеджер или участник,
   * плюс их задачи/команда/файлы. PII сотрудников (phone, telegram, email) скрыты.
   */
  private async gatherProjectManagerContext(userId: string): Promise<string> {
    const parts: string[] = [];

    // 1. Находим проекты, где пользователь — менеджер
    const managedProjects = await this.projectRepo.find({
      where: { managerId: userId, isArchived: false },
      relations: ['members', 'manager'],
      order: { createdAt: 'DESC' },
    });

    // 2. И проекты, где он участник (через many-to-many)
    const memberProjects = await this.projectRepo
      .createQueryBuilder('p')
      .innerJoin('p.members', 'm', 'm.id = :userId', { userId })
      .leftJoinAndSelect('p.members', 'allMembers')
      .leftJoinAndSelect('p.manager', 'manager')
      .where('p.isArchived = false')
      .orderBy('p.createdAt', 'DESC')
      .getMany();

    const allProjectsMap = new Map<string, Project>();
    for (const p of [...managedProjects, ...memberProjects]) allProjectsMap.set(p.id, p);
    const projects = Array.from(allProjectsMap.values());
    const projectIds = projects.map(p => p.id);

    if (projectIds.length === 0) {
      return '## ⚠️ ДОСТУП\nУ вас пока нет проектов под управлением или участием. ИИ может отвечать только по вашим собственным задачам.';
    }

    // 3. Задачи и команда в рамках этих проектов
    const [tasks, comments, timeLogs, files, self] = await Promise.all([
      this.taskRepo.find({
        where: { projectId: In(projectIds) },
        relations: ['assignee', 'project', 'createdBy'],
        order: { updatedAt: 'DESC' },
        take: 300,
      }),
      this.commentRepo.createQueryBuilder('c')
        .leftJoinAndSelect('c.author', 'author')
        .leftJoinAndSelect('c.task', 'task')
        .where('task.projectId IN (:...projectIds)', { projectIds })
        .orderBy('c.createdAt', 'DESC')
        .take(80)
        .getMany(),
      this.timeRepo.createQueryBuilder('l')
        .leftJoinAndSelect('l.employee', 'employee')
        .leftJoinAndSelect('l.task', 'task')
        .where('task.projectId IN (:...projectIds)', { projectIds })
        .orderBy('l.date', 'DESC')
        .take(100)
        .getMany(),
      this.fileRepo.find({
        where: [{ projectId: In(projectIds) }],
        relations: ['uploadedBy', 'project', 'task'],
        order: { createdAt: 'DESC' },
        take: 50,
      }).catch(() => [] as FileAttachment[]),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);

    parts.push(`## 📊 СВОДКА (ваш scope)
- Вы: ${self?.name || '—'} (${self?.role || '—'})
- Доступно проектов: ${projects.length}
- Задач в них: ${tasks.length}
- Комментариев: ${comments.length}, тайм-логов: ${timeLogs.length}, файлов: ${files.length}`);

    // 4. Проекты (без бюджета)
    const projList = projects.map((p, i) => {
      const taskCount = tasks.filter(t => t.projectId === p.id).length;
      const doneCount = tasks.filter(t => t.projectId === p.id && t.status === 'done').length;
      const memberNames = (p.members || []).map(m => m.name).join(', ') || '—';
      const startDate = p.startDate ? new Date(p.startDate).toLocaleDateString('ru-RU') : '—';
      const endDate = p.endDate ? new Date(p.endDate).toLocaleDateString('ru-RU') : '—';
      return `${i + 1}. **"${p.name}"**
   - Статус: ${p.status} | Прогресс: ${p.progress}%
   - Тип: ${p.projectType || '—'}
   - Менеджер: ${p.manager?.name || '—'}
   - Команда (${(p.members || []).length}): [${memberNames}]
   - Задач: ${taskCount} (готово: ${doneCount})
   - Старт: ${startDate}, Дедлайн: ${endDate}`;
    }).join('\n\n');
    parts.push(`## 📁 ВАШИ ПРОЕКТЫ (${projects.length})\n${projList}`);

    // 5. Задачи
    const taskList = tasks.map((t, i) => {
      const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '—';
      const overdue = t.deadline && new Date(t.deadline) < new Date() && !['done', 'cancelled'].includes(t.status) ? ' ⚠️ПРОСРОЧЕНА' : '';
      return `${i + 1}. "${t.title}" | Проект: ${t.project?.name || '—'} | Статус: ${t.status} | Приоритет: ${t.priority} | Исполнитель: ${t.assignee?.name || '—'} | Дедлайн: ${deadline}${overdue}`;
    }).join('\n');
    parts.push(`## ✅ ЗАДАЧИ (${tasks.length})\n${taskList || 'Нет задач'}`);

    // 6. Комментарии
    if (comments.length > 0) {
      const cmtList = comments.map(c => `- ${c.author?.name || '?'} → "${c.task?.title || '?'}": ${(c.message || '').slice(0, 150)} (${new Date(c.createdAt).toLocaleDateString('ru-RU')})`).join('\n');
      parts.push(`## 💬 КОММЕНТАРИИ\n${cmtList}`);
    }

    // 7. Тайм-логи
    if (timeLogs.length > 0) {
      const logList = timeLogs.map(l => `- ${l.employee?.name || '—'} | ${l.task?.title || '—'} | ${l.timeSpent}ч | ${new Date(l.date).toLocaleDateString('ru-RU')}`).join('\n');
      parts.push(`## ⏱ ТАЙМ-ЛОГИ\n${logList}`);
    }

    // 8. Файлы
    if (files.length > 0) {
      const fileList = files.map(f => `- ${f.originalName} | загрузил: ${f.uploadedBy?.name || '—'} | проект: ${f.project?.name || '—'} | задача: ${f.task?.title || '—'}`).join('\n');
      parts.push(`## 📎 ФАЙЛЫ\n${fileList}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Контекст для обычного сотрудника: только свои задачи, отчёты, тайм-логи.
   * Данные о других людях не загружаются.
   */
  private async gatherEmployeeContext(userId: string): Promise<string> {
    const parts: string[] = [];

    const [self, myTasks, myTimeLogs, myReports, myComments, myStories, myMemberProjects] = await Promise.all([
      this.userRepo.findOne({ where: { id: userId } }),
      this.taskRepo.find({
        where: { assigneeId: userId },
        relations: ['project', 'createdBy'],
        order: { updatedAt: 'DESC' },
        take: 200,
      }),
      this.timeRepo.find({
        where: { employeeId: userId },
        relations: ['task'],
        order: { date: 'DESC' },
        take: 100,
      }),
      this.reportRepo.find({
        where: { employeeId: userId },
        relations: ['project', 'task'],
        order: { date: 'DESC' },
        take: 50,
      }),
      this.commentRepo.find({
        where: { authorId: userId },
        relations: ['task'],
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.storyRepo.find({
        where: { employeeId: userId },
        order: { date: 'DESC' },
        take: 50,
      }).catch(() => [] as StoryLog[]),
      this.projectRepo
        .createQueryBuilder('p')
        .innerJoin('p.members', 'm', 'm.id = :userId', { userId })
        .where('p.isArchived = false')
        .select(['p.id', 'p.name', 'p.status', 'p.progress'])
        .getMany(),
    ]);

    const doneCount = myTasks.filter(t => t.status === 'done').length;
    const overdueCount = myTasks.filter(
      t => t.deadline && new Date(t.deadline) < new Date() && !['done', 'cancelled'].includes(t.status),
    ).length;

    parts.push(`## 📊 СВОДКА (ваш scope)
- Вы: ${self?.name || '—'} (${self?.role || '—'})
- Ваших задач: ${myTasks.length} (готово: ${doneCount}, просрочено: ${overdueCount})
- Ваших тайм-логов: ${myTimeLogs.length}
- Ваших отчётов: ${myReports.length}
- Ваших комментариев: ${myComments.length}
- Проектов, где вы участник: ${myMemberProjects.length}`);

    if (myMemberProjects.length > 0) {
      const projList = myMemberProjects.map((p, i) => `${i + 1}. "${p.name}" | Статус: ${p.status} | Прогресс: ${p.progress}%`).join('\n');
      parts.push(`## 📁 ПРОЕКТЫ, ГДЕ ВЫ УЧАСТНИК\n${projList}`);
    }

    if (myTasks.length > 0) {
      const taskList = myTasks.map((t, i) => {
        const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '—';
        const overdue = t.deadline && new Date(t.deadline) < new Date() && !['done', 'cancelled'].includes(t.status) ? ' ⚠️ПРОСРОЧЕНА' : '';
        return `${i + 1}. "${t.title}" | Проект: ${t.project?.name || '—'} | Статус: ${t.status} | Приоритет: ${t.priority} | Дедлайн: ${deadline}${overdue}${t.description ? ` | Описание: ${t.description.slice(0, 100)}` : ''}`;
      }).join('\n');
      parts.push(`## ✅ ВАШИ ЗАДАЧИ (${myTasks.length})\n${taskList}`);
    }

    if (myTimeLogs.length > 0) {
      const logList = myTimeLogs.map(l => `- ${l.task?.title || '—'} | ${l.timeSpent}ч | ${new Date(l.date).toLocaleDateString('ru-RU')}${l.description ? ` — ${l.description.slice(0, 80)}` : ''}`).join('\n');
      parts.push(`## ⏱ ВАШИ ТАЙМ-ЛОГИ\n${logList}`);
    }

    if (myReports.length > 0) {
      const repList = myReports.map(r => `- ${new Date(r.date).toLocaleDateString('ru-RU')} | ${r.timeSpent || 0}ч | Проект: ${r.project?.name || '—'} | ${(r.description || '').slice(0, 120)}`).join('\n');
      parts.push(`## 📋 ВАШИ ОТЧЁТЫ\n${repList}`);
    }

    if (myStories.length > 0) {
      const stList = myStories.map((s: any) => `- Проект: ${s.project?.name || '—'} | ${s.storiesCount || 0} сторис | ${new Date(s.date).toLocaleDateString('ru-RU')}`).join('\n');
      parts.push(`## 📸 ВАШИ СТОРИС\n${stList}`);
    }

    return parts.join('\n\n');
  }
}
