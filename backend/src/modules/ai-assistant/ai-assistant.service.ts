import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import Groq from 'groq-sdk';

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private client: Groq | null = null;

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(TimeLog) private timeRepo: Repository<TimeLog>,
    @InjectRepository(DailyReport) private reportRepo: Repository<DailyReport>,
  ) {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      this.client = new Groq({ apiKey });
      this.logger.log('AI Assistant ready (Groq API connected)');
    } else {
      this.logger.warn('GROQ_API_KEY not set — AI Assistant disabled');
    }
  }

  async chat(question: string): Promise<string> {
    if (!this.client) {
      return 'ИИ-помощник не настроен. Добавьте GROQ_API_KEY в переменные окружения.';
    }

    try {
      const context = await this.gatherContext(question);

      const completion = await this.client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2048,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `Ты — ИИ-помощник CRM-системы "Sabt" для SMM-агентства. Отвечай на русском языке.
Ты анализируешь данные из базы данных проекта и отвечаешь на вопросы администратора.
Будь точен, конкретен, давай цифры и факты. Форматируй ответ красиво с помощью markdown.
Если данных нет — так и скажи, не придумывай.

Вот актуальные данные из базы:
${context}`,
          },
          { role: 'user', content: question },
        ],
      });

      return completion.choices?.[0]?.message?.content || 'Не удалось получить ответ.';
    } catch (error) {
      this.logger.error(`AI chat error: ${error?.message || error}`);
      return `Ошибка ИИ: ${error?.message || 'Неизвестная ошибка'}`;
    }
  }

  private async gatherContext(question: string): Promise<string> {
    const q = question.toLowerCase();
    const parts: string[] = [];

    // Always include summary stats
    const [totalProjects, totalTasks, totalEmployees, totalUsers] = await Promise.all([
      this.projectRepo.count({ where: { isArchived: false } }),
      this.taskRepo.count(),
      this.employeeRepo.count(),
      this.userRepo.count(),
    ]);

    const [doneTasks, overdueTasks] = await Promise.all([
      this.taskRepo.count({ where: { status: 'done' as any } }),
      this.taskRepo.manager.query(
        `SELECT COUNT(*)::int AS count FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled')`
      ),
    ]);

    parts.push(`## Общая статистика
- Проектов (активных): ${totalProjects}
- Задач всего: ${totalTasks}, выполнено: ${doneTasks}, просрочено: ${overdueTasks?.[0]?.count || 0}
- Сотрудников: ${totalEmployees}, пользователей: ${totalUsers}`);

    // If question is about employees/people
    if (q.includes('сотрудник') || q.includes('работник') || q.includes('кто') || q.includes('команд') || q.includes('исполнител') || this.hasPersonName(q)) {
      const employees = await this.employeeRepo.find({
        relations: ['user'],
        where: { status: 'active' as any },
      });
      const empList = employees.map(e => {
        return `- ${e.fullName} | Должность: ${e.position || '—'} | Отдел: ${e.department || '—'} | Активность: ${e.activityScore}/100 | Задач выполнено: ${e.tasksCompleted} | Просрочено: ${e.tasksOverdue}`;
      }).join('\n');
      parts.push(`## Сотрудники\n${empList || 'Нет данных'}`);
    }

    // If question is about tasks or specific person's tasks
    if (q.includes('задач') || q.includes('таск') || q.includes('делает') || q.includes('работает') || q.includes('статус') || this.hasPersonName(q)) {
      const tasks = await this.taskRepo.find({
        relations: ['assignee', 'project'],
        order: { updatedAt: 'DESC' },
        take: 50,
      });
      const taskList = tasks.map(t => {
        const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString('ru-RU') : '—';
        const overdue = t.deadline && new Date(t.deadline) < new Date() && !['done', 'cancelled'].includes(t.status) ? ' ⚠️ПРОСРОЧЕНА' : '';
        return `- "${t.title}" | Проект: ${t.project?.name || '—'} | Статус: ${t.status} | Приоритет: ${t.priority} | Исполнитель: ${t.assignee?.name || '—'} | Дедлайн: ${deadline}${overdue}`;
      }).join('\n');
      parts.push(`## Задачи (последние 50)\n${taskList || 'Нет данных'}`);
    }

    // If question is about projects
    if (q.includes('проект') || q.includes('клиент') || q.includes('бюджет') || q.includes('прогресс')) {
      const projects = await this.projectRepo.find({
        where: { isArchived: false },
        relations: ['members', 'tasks'],
        order: { createdAt: 'DESC' },
        take: 20,
      });
      const projList = projects.map(p => {
        const taskCount = p.tasks?.length || 0;
        const doneCount = p.tasks?.filter(t => t.status === 'done').length || 0;
        return `- "${p.name}" | Статус: ${p.status} | Прогресс: ${p.progress}% | Задач: ${taskCount} (готово: ${doneCount}) | Участников: ${p.members?.length || 0} | Бюджет: ${p.budget || '—'}`;
      }).join('\n');
      parts.push(`## Проекты\n${projList || 'Нет данных'}`);
    }

    // If question is about time/hours
    if (q.includes('час') || q.includes('врем') || q.includes('тайм') || q.includes('отчёт') || q.includes('отчет')) {
      const recentLogs = await this.timeRepo.find({
        relations: ['employee', 'task'],
        order: { date: 'DESC' },
        take: 30,
      });
      const logList = recentLogs.map(l => {
        return `- ${l.employee?.name || '—'} | Задача: ${l.task?.title || '—'} | ${l.timeSpent}ч | Дата: ${new Date(l.date).toLocaleDateString('ru-RU')}`;
      }).join('\n');
      parts.push(`## Последние тайм-логи\n${logList || 'Нет данных'}`);
    }

    // If no specific context matched, include projects and tasks
    if (parts.length === 1) {
      const projects = await this.projectRepo.find({ where: { isArchived: false }, relations: ['tasks'], take: 10 });
      const projList = projects.map(p => `- "${p.name}" | ${p.status} | ${p.progress}% | Задач: ${p.tasks?.length || 0}`).join('\n');
      parts.push(`## Проекты\n${projList}`);

      const tasks = await this.taskRepo.find({ relations: ['assignee', 'project'], order: { updatedAt: 'DESC' }, take: 20 });
      const taskList = tasks.map(t => `- "${t.title}" | ${t.status} | ${t.assignee?.name || '—'} | ${t.project?.name || '—'}`).join('\n');
      parts.push(`## Задачи\n${taskList}`);
    }

    return parts.join('\n\n');
  }

  private hasPersonName(q: string): boolean {
    const words = q.split(/\s+/);
    return words.some(w => /^[А-ЯЁ][а-яё]{2,}$/.test(w));
  }
}
