import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as https from 'https';

// Gemini fallback chain (paid tier — only used if GEMINI_API_KEY has billing)
const GEMINI_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
];

// Groq fallback (free, fast, reliable)
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private gemini: GoogleGenerativeAI | null = null;
  private groqKey: string | null = null;

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(TimeLog) private timeRepo: Repository<TimeLog>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
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

  async chat(question: string): Promise<string> {
    if (!this.gemini && !this.groqKey) {
      return 'ИИ-помощник не настроен. Добавьте GEMINI_API_KEY или GROQ_API_KEY в переменные окружения.';
    }

    const context = await this.gatherContext(question);
    const systemPrompt = `Ты — ИИ-помощник CRM-системы "Sabt" для SMM-агентства. Отвечай на русском языке.
Ты анализируешь данные из базы данных проекта и отвечаешь на вопросы администратора.
Будь точен, конкретен, давай цифры и факты. Форматируй ответ красиво с помощью markdown.
Если данных нет — так и скажи, не придумывай.

Вот актуальные данные из базы:
${context}

Вопрос администратора: ${question}`;

    // Try Gemini first (paid tier or with quota)
    if (this.gemini) {
      for (const modelName of GEMINI_MODEL_CHAIN) {
        try {
          const model = this.gemini.getGenerativeModel({
            model: modelName,
            generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
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

    // Fallback to Groq (free)
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

  private callGroq(model: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        temperature: 0.3,
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
          timeout: 30000,
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

  private async gatherContext(question: string): Promise<string> {
    const q = question.toLowerCase();
    const parts: string[] = [];

    // Always load EVERYTHING — Gemini has 1M context, our DB is small
    const [
      totalProjects, totalTasks, totalEmployees, totalUsers,
      doneTasks, overdueRow,
      employees, projects, tasks,
    ] = await Promise.all([
      this.projectRepo.count({ where: { isArchived: false } }),
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
      this.taskRepo.find({
        relations: ['assignee', 'project'],
        order: { updatedAt: 'DESC' },
        take: 100,
      }),
    ]);

    const overdueCount = overdueRow?.[0]?.count || 0;

    parts.push(`## Общая статистика
- Активных проектов: ${totalProjects}
- Задач всего: ${totalTasks}, выполнено: ${doneTasks}, просрочено: ${overdueCount}
- Сотрудников: ${totalEmployees}, пользователей: ${totalUsers}`);

    // ── ALL EMPLOYEES (always) ──────────────────
    const empList = employees.map((e, i) => {
      const status = e.status === 'active' ? '✅' : '⏸';
      return `${i + 1}. ${status} **${e.fullName}** — Должность: ${e.position || '—'} | Отдел: ${e.department || '—'} | Email: ${e.email || '—'} | Phone: ${e.phone || '—'} | Telegram: ${e.telegram || '—'} | Активность: ${e.activityScore || 0}/100 | Задач выполнено: ${e.tasksCompleted || 0} | Просрочено: ${e.tasksOverdue || 0}${e.user?.role ? ` | Роль системы: ${e.user.role}` : ''}`;
    }).join('\n');
    parts.push(`## Все сотрудники (${employees.length})\n${empList || 'Нет данных'}`);

    // ── ALL PROJECTS (always) ──────────────────
    const projList = projects.map((p, i) => {
      const taskCount = p.tasks?.length || 0;
      const doneCount = p.tasks?.filter(t => t.status === 'done').length || 0;
      const memberNames = (p.members || []).map(m => m.name).join(', ') || '—';
      const startDate = p.startDate ? new Date(p.startDate).toLocaleDateString('ru-RU') : '—';
      const endDate = p.endDate ? new Date(p.endDate).toLocaleDateString('ru-RU') : '—';
      return `${i + 1}. **"${p.name}"** | Статус: ${p.status} | Прогресс: ${p.progress}% | Задач: ${taskCount} (готово: ${doneCount}) | Менеджер: ${p.manager?.name || '—'} | Участники: [${memberNames}] | Тип: ${p.projectType || '—'} | Бюджет: ${p.budget || '—'} | Старт: ${startDate} | Дедлайн: ${endDate}`;
    }).join('\n');
    parts.push(`## Все проекты (${projects.length})\n${projList || 'Нет данных'}`);

    // ── RECENT TASKS (always, up to 100) ──────────────────
    const taskList = tasks.map((t, i) => {
      const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '—';
      const overdue = t.deadline && new Date(t.deadline) < new Date() && !['done', 'cancelled'].includes(t.status) ? ' ⚠️ПРОСРОЧЕНА' : '';
      return `${i + 1}. "${t.title}" | Проект: ${t.project?.name || '—'} | Статус: ${t.status} | Приоритет: ${t.priority} | Исполнитель: ${t.assignee?.name || '—'} | Дедлайн: ${deadline}${overdue}`;
    }).join('\n');
    parts.push(`## Задачи (${tasks.length})\n${taskList || 'Нет данных'}`);

    // ── Time logs (only if relevant) ──────────────────
    if (q.includes('час') || q.includes('врем') || q.includes('тайм') || q.includes('отчёт') || q.includes('отчет')) {
      const recentLogs = await this.timeRepo.find({
        relations: ['employee', 'task'],
        order: { date: 'DESC' },
        take: 50,
      });
      const logList = recentLogs.map(l => {
        return `- ${l.employee?.name || '—'} | Задача: ${l.task?.title || '—'} | ${l.timeSpent}ч | Дата: ${new Date(l.date).toLocaleDateString('ru-RU')}`;
      }).join('\n');
      parts.push(`## Тайм-логи (последние 50)\n${logList || 'Нет данных'}`);
    }

    return parts.join('\n\n');
  }
}
