import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task, TaskStatus, TaskKind, TASK_CLOSED_FOR_OVERDUE } from '../tasks/task.entity';
import { TaskAssignee } from '../tasks/task-assignee.entity';
import { User } from '../users/user.entity';
import { TasksService } from '../tasks/tasks.service';
import { CommentsService } from '../comments/comments.service';
import { TaskResultsService } from '../task-results/task-results.service';
import { TelegramService } from './telegram.service';
import { TaskResultType } from '../task-results/task-result.entity';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

/** Экранирование под HTML-разметку Telegram. */
const esc = (s: string): string =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TZ = 'Asia/Dushanbe';
const TZ_OFFSET_H = 5;

/** Сколько задач показываем за раз: длинные списки в чате нечитаемы. */
const PAGE = 8;

/**
 * Telegram как рабочее место: сотрудник видит свои задачи, закрывает их,
 * комментирует и сдаёт результат прямо из чата. Всё пишется через те же
 * сервисы, что и веб-интерфейс, поэтому история, уведомления и статусы
 * везде одинаковые — синхронность обеспечена общей точкой записи, а не
 * копированием логики.
 */
@Injectable()
export class BotWorkspaceService {
  private readonly logger = new Logger(BotWorkspaceService.name);

  /** Чат ждёт текст комментария или файл-результат к конкретной задаче.
   *  В памяти намеренно: ожидание живёт минуты, ради него заводить таблицу
   *  избыточно — после перезапуска сотрудник просто нажмёт кнопку заново. */
  private readonly awaiting = new Map<number, { taskId: string; mode: 'comment' | 'result'; at: number }>();

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(TaskAssignee) private assigneeRepo: Repository<TaskAssignee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private tasks: TasksService,
    private comments: CommentsService,
    private results: TaskResultsService,
    private telegram: TelegramService,
  ) {}

  /** Сотрудник по чату — или null, если чат не привязан. */
  private async userOf(chatId: number): Promise<User | null> {
    const userId = await this.telegram.resolveUserIdByChat(chatId);
    if (!userId) return null;
    const u = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
    if (!u || !u.isActive || u.isBlocked) return null;
    return u;
  }

  /** Задачи сотрудника: назначенные лично и через мульти-исполнителей. */
  private async myTasks(userId: string, onlyToday = false): Promise<Task[]> {
    const extraIds = (await this.assigneeRepo.find({ where: { userId } }).catch(() => []))
      .map(a => a.taskId);

    const qb = this.taskRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.status NOT IN (:...closed)', { closed: TASK_CLOSED_FOR_OVERDUE })
      .andWhere(extraIds.length
        ? '(t."assigneeId" = :uid OR t.id IN (:...extra))'
        : 't."assigneeId" = :uid', { uid: userId, extra: extraIds.length ? extraIds : [''] })
      .orderBy('t.deadline', 'ASC');

    if (onlyToday) {
      const now = new Date();
      const local = new Date(now.getTime() + TZ_OFFSET_H * 3600_000);
      const y = local.getUTCFullYear(); const m = local.getUTCMonth(); const d = local.getUTCDate();
      const from = new Date(Date.UTC(y, m, d, 0, 0, 0) - TZ_OFFSET_H * 3600_000);
      const to = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - TZ_OFFSET_H * 3600_000);
      qb.andWhere('t.deadline BETWEEN :from AND :to', { from, to });
    }
    const rows = await qb.take(50).getMany().catch(() => [] as Task[]);
    // КП-задачи онбординга живут своей воронкой, в чат их не тащим.
    return rows.filter(t => (t as any).originStage !== 'kp_creation');
  }

  private fmtTime(d: Date | string | null | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
  }

  /** Одна строка списка + кнопки под ней. */
  private taskButtons(t: Task) {
    return [[
      { text: '✅ Готово', callback_data: `w:done:${t.id}` },
      { text: '▶️ В работу', callback_data: `w:prog:${t.id}` },
    ], [
      { text: '💬 Комментарий', callback_data: `w:cmt:${t.id}` },
      { text: '📎 Результат', callback_data: `w:res:${t.id}` },
    ]];
  }

  private taskCard(t: Task): string {
    const isMeeting = (t as any).kind === TaskKind.MEETING;
    const overdue = t.deadline && new Date(t.deadline) < new Date()
      && !TASK_CLOSED_FOR_OVERDUE.includes(t.status as any);
    return `${isMeeting ? '🤝' : '📋'} <b>${esc(t.title)}</b>\n` +
      (t.project?.name ? `📁 ${esc(t.project.name)}\n` : '') +
      ((t as any).location ? `📍 ${esc((t as any).location)}\n` : '') +
      (t.deadline ? `📅 ${this.fmtTime(t.deadline)}${overdue ? ' ⚠️ просрочено' : ''}\n` : '') +
      `Статус: ${t.status === TaskStatus.IN_PROGRESS ? 'в работе' : 'новая'}`;
  }

  /** «Мои задачи» и «Мой день» — один и тот же список, разный фильтр. */
  async sendList(chatId: number, onlyToday: boolean): Promise<boolean> {
    const user = await this.userOf(chatId);
    if (!user) return false;
    const list = await this.myTasks(user.id, onlyToday);
    if (list.length === 0) {
      await this.telegram.sendMessage(chatId, onlyToday
        ? '📅 На сегодня задач и встреч нет.'
        : '✅ Открытых задач нет.');
      return true;
    }
    const head = onlyToday
      ? `📅 <b>Сегодня: ${list.length}</b>`
      : `📋 <b>Ваши задачи: ${list.length}</b>`;
    await this.telegram.sendMessage(chatId, head);
    for (const t of list.slice(0, PAGE)) {
      await this.telegram.sendMessage(chatId, this.taskCard(t), this.taskButtons(t));
    }
    if (list.length > PAGE) {
      await this.telegram.sendMessage(
        chatId,
        `…и ещё ${list.length - PAGE}. Все задачи: ${this.telegram.appUrl}/tasks`,
      );
    }
    return true;
  }

  /** Нажатие кнопки под карточкой. Возвращает текст для всплывашки. */
  async handleCallback(chatId: number, data: string): Promise<string | null> {
    const m = /^w:(done|prog|cmt|res):(.+)$/.exec(data);
    if (!m) return null;
    const [, action, taskId] = m;
    const user = await this.userOf(chatId);
    if (!user) return 'Чат не привязан к сотруднику';

    if (action === 'cmt' || action === 'res') {
      this.awaiting.set(chatId, { taskId, mode: action === 'cmt' ? 'comment' : 'result', at: Date.now() });
      await this.telegram.sendMessage(chatId, action === 'cmt'
        ? '💬 Напишите комментарий одним сообщением — он появится в карточке задачи.'
        : '📎 Пришлите фото или документ — приложу к задаче как результат работы.');
      return action === 'cmt' ? 'Жду комментарий' : 'Жду файл';
    }

    // Статус меняем через общий сервис задач: те же уведомления, история и
    // пересчёт прогресса проекта, что и при работе через сайт.
    const status = action === 'done' ? TaskStatus.DONE : TaskStatus.IN_PROGRESS;
    try {
      await this.tasks.update(taskId, { status } as any, { id: user.id, role: user.role, name: user.name });
      return action === 'done' ? 'Задача закрыта' : 'Взято в работу';
    } catch (e: any) {
      const msg = String(e?.response?.message || e?.message || 'Не удалось обновить');
      await this.telegram.sendMessage(chatId, `⚠️ ${esc(msg)}`);
      return 'Не получилось';
    }
  }

  /** Текст после кнопки «Комментарий». true — сообщение обработано. */
  async handleText(chatId: number, text: string): Promise<boolean> {
    const wait = this.awaiting.get(chatId);
    if (!wait || wait.mode !== 'comment') return false;
    this.awaiting.delete(chatId);
    const user = await this.userOf(chatId);
    if (!user) return false;
    try {
      await this.comments.create(wait.taskId, text, user.id, user.role);
      await this.telegram.sendMessage(chatId, '💬 Комментарий добавлен в задачу.');
    } catch (e: any) {
      await this.telegram.sendMessage(chatId, `⚠️ ${esc(String(e?.message || 'Не удалось добавить'))}`);
    }
    return true;
  }

  /** Фото или документ после кнопки «Результат». */
  async handleFile(chatId: number, fileId: string, fileName?: string): Promise<boolean> {
    const wait = this.awaiting.get(chatId);
    if (!wait || wait.mode !== 'result') return false;
    this.awaiting.delete(chatId);
    const user = await this.userOf(chatId);
    if (!user) return false;
    try {
      // Кладём файл туда же, куда его положила бы веб-загрузка: карточка
      // задачи не должна знать, пришёл результат из браузера или из чата.
      const buf = await this.telegram.downloadFile(fileId);
      const safeName = (fileName || 'photo.jpg').replace(/[^\w.\-]+/g, '_').slice(0, 80);
      const ext = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '.jpg';
      const stored = `${uuidv4()}${ext}`;
      await fs.mkdir('./uploads/files', { recursive: true });
      await fs.writeFile(`./uploads/files/${stored}`, buf);

      await this.results.create(wait.taskId, user.id, user.role, {
        type: TaskResultType.FILE,
        content: `Результат из Telegram${fileName ? `: ${fileName}` : ''}`,
        fileName: safeName,
        filePath: `/uploads/files/${stored}`,
      });
      await this.telegram.sendMessage(chatId, '📎 Результат приложен к задаче.');
    } catch (e: any) {
      await this.telegram.sendMessage(chatId, `⚠️ ${esc(String(e?.message || 'Не удалось приложить файл'))}`);
    }
    return true;
  }

  /** Ждёт ли чат сейчас файл — чтобы контроллер не принял его за что-то ещё. */
  isAwaitingFile(chatId: number): boolean {
    return this.awaiting.get(chatId)?.mode === 'result';
  }

  /** Подсказка со списком команд — показываем после привязки и по /help. */
  helpText(): string {
    return '🤖 <b>Что я умею</b>\n\n' +
      '📋 /tasks — ваши открытые задачи с кнопками «Готово» и «В работу»\n' +
      '📅 /today — задачи и встречи на сегодня\n' +
      '🎤 Голосовое сообщение — создам задачу или встречу в календаре\n' +
      '💬 Кнопка «Комментарий» под задачей — напишете ответ, он попадёт в карточку\n' +
      '📎 Кнопка «Результат» — пришлёте фото или документ, приложу к задаче\n\n' +
      'Всё, что делаете здесь, сразу видно в системе.';
  }
}
