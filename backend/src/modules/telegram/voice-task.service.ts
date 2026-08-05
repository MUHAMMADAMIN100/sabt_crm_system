import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as https from 'https';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task, TaskScope, TaskStatus, TaskPriority } from '../tasks/task.entity';
import { Employee } from '../employees/employee.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { User, UserRole } from '../users/user.entity';
import { TelegramService } from './telegram.service';

/**
 * Голосовая постановка задач через Telegram.
 *
 * Основатель наговаривает боту «добавь мне задачу на 10 августа, встреча» —
 * в календаре Sabt появляется личная задача. Речь и смысл разбирает Gemini
 * ОДНИМ запросом: он принимает аудио напрямую, поэтому отдельный сервис
 * распознавания (и отдельный ключ к нему) не нужен.
 */

/** Что удалось понять из голосового. */
interface VoiceIntent {
  isTask: boolean;
  title: string;
  /** Имя исполнителя, как оно прозвучало. null — задача себе. */
  assignee: string | null;
  /** YYYY-MM-DD или null, если дата не прозвучала. */
  date: string | null;
  /** HH:MM или null — тогда задача на весь день. */
  time: string | null;
  /** Полный текст сказанного: если бот расслышал не так, будет видно. */
  transcript: string;
  /** Дата прозвучала однозначно («10 августа»), а не «на следующей неделе». */
  dateExact: boolean;
}

/** Ожидающие подтверждения. В памяти намеренно: подтверждение живёт секунды,
 *  а ради него заводить таблицу и миграцию — лишнее. Перезапуск сервиса
 *  просто попросит наговорить заново. */
interface Pending extends VoiceIntent {
  userId: string;
  chatId: number;
  at: number;
  /** Кому ставим. Пусто — себе. */
  assigneeId?: string;
  assigneeLabel?: string;
}

/** Чат ждёт исправленный текст после нажатия «Изменить». */
interface AwaitingEdit { userId: string; at: number }

/** Метка в описании: по ней проверка просрочки отличает голосовые задачи
 *  от всех остальных и не лезет в чужую логику. */
const VOICE_MARK = 'Создано голосом в Telegram.';

const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 200;

@Injectable()
export class VoiceTaskService {
  private readonly logger = new Logger(VoiceTaskService.name);
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly pending = new Map<string, Pending>();
  /** Чаты, ждущие исправленный текст. Ключ — chatId. */
  private readonly awaitingEdit = new Map<number, AwaitingEdit>();

  /** Кому доступна голосовая постановка задач СЕБЕ. */
  private static readonly VOICE_ROLES: string[] = [
    UserRole.FOUNDER,
    UserRole.SALES_MANAGER_DEV,
  ];

  /** Кто может голосом ставить задачи ДРУГИМ. Только основатель: иначе
   *  роль получила бы право раздавать поручения по всей компании, а речь
   *  шла не об этом. */
  private static readonly ASSIGN_ROLES: string[] = [UserRole.FOUNDER];

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {
    const key = process.env.GEMINI_API_KEY;
    this.gemini = key ? new GoogleGenerativeAI(key) : null;
    if (!this.gemini) {
      this.logger.warn('GEMINI_API_KEY не задан — голосовые задачи отключены');
    }
  }

  /** Главный вход: пришло голосовое. Возвращает true, если сообщение
   *  обработано и дальше его вести не надо. */
  async handleVoice(chatId: number, fileId: string, durationSec: number): Promise<boolean> {
    const user = await this.resolveVoiceUser(chatId);
    if (!user) return false; // не основатель — ведём себя как раньше

    if (!this.gemini) {
      await this.telegram.sendMessage(chatId, '🎤 Распознавание голоса не настроено. Нужен GEMINI_API_KEY.');
      return true;
    }
    // Минута речи — это уже не задача, а совещание. Ограничиваем, чтобы не
    // гонять в модель мегабайты и не ждать ответа полминуты.
    if (durationSec > 120) {
      await this.telegram.sendMessage(chatId, '🎤 Слишком длинное сообщение. Скажите короче — до двух минут.');
      return true;
    }

    try {
      const audio = await this.telegram.downloadFile(fileId);
      const intent = await this.understand(audio);

      if (!intent.isTask || !intent.title) {
        await this.telegram.sendMessage(
          chatId,
          '🤔 Не понял, какую задачу создать.\n\n' +
          (intent.transcript ? `Я расслышал: «${esc(intent.transcript)}»\n\n` : '') +
          'Скажите примерно так: «добавь задачу на 10 августа — встреча с клиентом».',
        );
        return true;
      }

      await this.proposeTask(chatId, user, intent);
      return true;
    } catch (e: any) {
      this.logger.warn(`voice task failed: ${e?.message || e}`);
      await this.telegram.sendMessage(chatId, '⚠️ Не удалось разобрать голосовое. Попробуйте ещё раз.');
      return true;
    }
  }

  /** Показывает разбор и ждёт подтверждения. Подтверждение спрашиваем
   *  ВСЕГДА: распознавание ошибается в именах и датах, а поручение чужому
   *  человеку — не то, что стоит создавать молча. */
  private async proposeTask(chatId: number, user: User, intent: VoiceIntent): Promise<void> {
    let assigneeId: string | undefined;
    let assigneeLabel: string | undefined;

    if (intent.assignee) {
      if (!VoiceTaskService.ASSIGN_ROLES.includes(user.role)
          && !VoiceTaskService.ASSIGN_ROLES.includes(user.secondaryRole || '')) {
        await this.telegram.sendMessage(
          chatId, '⚠️ Ставить задачи другим сотрудникам может только основатель.');
        return;
      }
      const found = await this.findEmployees(intent.assignee);
      if (found.length === 1) {
        assigneeId = found[0].userId;
        assigneeLabel = found[0].name;
      } else {
        // Не нашли или несколько тёзок — пусть выберет кнопкой.
        const key = this.remember({ ...intent, userId: user.id, chatId, at: Date.now() });
        const list = found.length ? found : await this.findEmployees('');
        if (!list.length) {
          await this.telegram.sendMessage(chatId, '⚠️ В системе нет сотрудников с привязанным аккаунтом.');
          return;
        }
        await this.telegram.sendMessage(
          chatId,
          (found.length
            ? `🎤 Кого именно вы имели в виду под «${esc(intent.assignee)}»?`
            : `🎤 Не нашёл сотрудника «${esc(intent.assignee)}». Выберите из списка:`) +
          `\n\n<b>${esc(intent.title)}</b>` +
          `\n📅 ${intent.date ? fmtRu(intent.date) : 'сегодня'}${intent.time ? ` в ${intent.time}` : ''}`,
          list.slice(0, 12).map(e => [{ text: e.name, callback_data: `vt:who:${key}:${e.userId}` }]),
        );
        return;
      }
    }

    const key = this.remember({
      ...intent, userId: user.id, chatId, at: Date.now(), assigneeId, assigneeLabel,
    });
    await this.telegram.sendMessage(chatId, this.proposalText(intent, assigneeLabel), [[
      { text: '✓ Подтвердить', callback_data: `vt:ok:${key}` },
      { text: '✎ Изменить', callback_data: `vt:edit:${key}` },
    ]]);
  }

  private proposalText(intent: VoiceIntent, assigneeLabel?: string): string {
    return '🎤 Понял так:\n\n' +
      (assigneeLabel ? `👤 Исполнитель: <b>${esc(assigneeLabel)}</b>\n` : '👤 Исполнитель: вы\n') +
      `📋 Задача: <b>${esc(intent.title)}</b>\n` +
      `📅 Срок: ${intent.date ? fmtRu(intent.date) : 'сегодня'}${intent.time ? ` в ${intent.time}` : ''}\n\n` +
      `<i>«${esc(intent.transcript)}»</i>`;
  }

  /** Нажали кнопку. Возвращает текст для всплывашки. */
  async handleCallback(data: string, chatId: number): Promise<string | null> {
    // Выбор исполнителя из списка тёзок.
    const who = /^vt:who:([^:]+):(.+)$/.exec(data);
    if (who) {
      const item = this.pending.get(who[1]);
      if (!item || item.chatId !== chatId) return 'Запрос устарел — наговорите заново';
      const emp = (await this.findEmployees('')).find(e => e.userId === who[2]);
      if (!emp) return 'Сотрудник не найден';
      this.pending.delete(who[1]);
      const key = this.remember({ ...item, at: Date.now(), assigneeId: emp.userId, assigneeLabel: emp.name });
      await this.telegram.sendMessage(chatId, this.proposalText(item, emp.name), [[
        { text: '✓ Подтвердить', callback_data: `vt:ok:${key}` },
        { text: '✎ Изменить', callback_data: `vt:edit:${key}` },
      ]]);
      return emp.name;
    }

    const m = /^vt:(ok|no|edit):(.+)$/.exec(data);
    if (!m) return null;
    const [, action, key] = m;
    const item = this.pending.get(key);

    if (!item) return 'Запрос устарел — наговорите заново';
    if (item.chatId !== chatId) return 'Запрос не найден';

    if (action === 'edit') {
      this.pending.delete(key);
      this.awaitingEdit.set(chatId, { userId: item.userId, at: Date.now() });
      await this.telegram.sendMessage(
        chatId,
        '✎ Напишите, как правильно — текстом или новым голосовым.\n\n' +
        'Например: «Фирузу макет для Архидеи до 15 августа».',
      );
      return 'Жду исправление';
    }

    this.pending.delete(key);
    if (action === 'no') return 'Отменено';

    try {
      const task = await this.createTask(item.userId, item, item.assigneeId);
      await this.telegram.sendMessage(chatId, this.doneText(task, item, item.assigneeLabel));
      if (item.assigneeId && item.assigneeId !== item.userId) await this.notifyAssignee(task, item);
      return 'Задача создана';
    } catch (e: any) {
      this.logger.warn(`voice task create failed: ${e?.message || e}`);
      return 'Не удалось создать задачу';
    }
  }

  /** Пришёл текст, когда ждём исправление. true — сообщение обработано. */
  async handleEditText(chatId: number, text: string): Promise<boolean> {
    const wait = this.awaitingEdit.get(chatId);
    if (!wait) return false;
    // Правка живёт столько же, сколько подтверждение.
    if (Date.now() - wait.at > PENDING_TTL_MS) { this.awaitingEdit.delete(chatId); return false; }
    this.awaitingEdit.delete(chatId);

    const user = await this.resolveVoiceUser(chatId);
    if (!user) return false;
    try {
      const intent = await this.parse(text);
      if (!intent.isTask || !intent.title) {
        await this.telegram.sendMessage(chatId, '🤔 Не понял задачу. Наговорите или напишите ещё раз.');
        return true;
      }
      await this.proposeTask(chatId, user, intent);
    } catch (e: any) {
      this.logger.warn(`voice edit failed: ${e?.message || e}`);
      await this.telegram.sendMessage(chatId, '⚠️ Не удалось разобрать. Попробуйте ещё раз.');
    }
    return true;
  }

  /** Сотрудники с привязанным аккаунтом. Пустой запрос — все. */
  private async findEmployees(query: string): Promise<{ userId: string; name: string }[]> {
    const qb = this.empRepo.createQueryBuilder('e')
      .where('e."userId" IS NOT NULL')
      .andWhere(`COALESCE(e.status, 'active') = 'active'`);
    const q = query.trim().toLowerCase();
    if (q) {
      // Ищем по любому слову имени: сказали «Лашкарова» — найдём
      // «Лашкарова Саврибегим Эраджевна».
      qb.andWhere('LOWER(e."fullName") LIKE :q', { q: `%${q}%` });
    }
    const rows = await qb.orderBy('e."fullName"', 'ASC').take(60).getMany();
    return rows.map(e => ({ userId: e.userId as string, name: e.fullName }));
  }

  private async notifyAssignee(task: Task, item: Pending): Promise<void> {
    const when = item.date ? fmtRu(item.date) : 'сегодня';
    await this.notifications.create({
      userId: item.assigneeId as string,
      type: NotificationType.NEW_TASK,
      title: '📋 Новая задача от основателя',
      message: `${task.title} — до ${when}${item.time ? ` ${item.time}` : ''}`,
      link: `/tasks/${task.id}`,
    }).catch(() => { /* не критично */ });
    this.telegram.sendToUser(
      item.assigneeId as string,
      `<b>📋 Новая задача от основателя</b>\n${esc(task.title)}\n📅 до ${when}${item.time ? ` ${item.time}` : ''}`,
    ).catch(() => { /* не критично */ });
  }

  // ─── Внутреннее ───────────────────────────────────────────────────────

  private async resolveVoiceUser(chatId: number): Promise<User | null> {
    const userId = await this.telegram.resolveUserIdByChat(chatId);
    if (!userId) return null;
    const user = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
    if (!user || !user.isActive || user.isBlocked) return null;
    const ok = VoiceTaskService.VOICE_ROLES.includes(user.role)
      || VoiceTaskService.VOICE_ROLES.includes(user.secondaryRole || '');
    return ok ? user : null;
  }

  /** Аудио → смысл.
   *
   *  Основной путь — отдать аудио прямо в Gemini: проверено на настоящем
   *  OGG/Opus (формат голосовых Telegram), принимает и распознаёт русскую
   *  речь. В документации у него значится OGG/Vorbis, поэтому оставлен и
   *  второй путь: если появится ключ Groq, речь возьмёт Whisper, а Gemini
   *  разберёт уже текст. Так фича не завязана на одного поставщика. */
  private async understand(audio: Buffer): Promise<VoiceIntent> {
    const viaWhisper = await this.transcribeWithGroq(audio);
    return viaWhisper !== null
      ? this.parse(viaWhisper)
      : this.parse(null, audio);
  }

  /** Распознавание через Groq Whisper. null — ключа нет или сервис не ответил
   *  (тогда пробуем Gemini напрямую, а не роняем всю обработку). */
  private async transcribeWithGroq(audio: Buffer): Promise<string | null> {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    try {
      const boundary = `----sabt${Date.now().toString(36)}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nru\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\n` +
        `Content-Type: audio/ogg\r\n\r\n`);
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, audio, tail]);

      const text = await new Promise<string>((resolve, reject) => {
        const req = https.request({
          hostname: 'api.groq.com',
          path: '/openai/v1/audio/transcriptions',
          method: 'POST',
          timeout: 60000,
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        }, (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`Groq ${res.statusCode}: ${raw.slice(0, 200)}`));
            try { resolve(JSON.parse(raw).text || '') } catch { reject(new Error('Groq: неожиданный ответ')) }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Groq: таймаут')) });
        req.write(body);
        req.end();
      });
      return text.trim();
    } catch (e: any) {
      this.logger.warn(`Whisper не сработал, пробуем Gemini напрямую: ${e?.message || e}`);
      return null;
    }
  }

  /** Разбор смысла. Либо по готовому тексту, либо прямо по аудио. */
  private async parse(transcript: string | null, audio?: Buffer): Promise<VoiceIntent> {
    const model = this.gemini!.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const today = todayInDushanbe();

    const prompt = `Ты разбираешь голосовое сообщение руководителя, который ставит себе задачу в календарь.
Сегодня ${today} (часовой пояс Душанбе).

${transcript === null
  ? 'Сначала распознай русскую речь из аудио, затем извлеки смысл.'
  : `Речь уже распознана, вот она дословно:\n"""${transcript}"""\nИзвлеки смысл, а в поле transcript верни этот же текст без изменений.`}
Ответь ТОЛЬКО JSON без пояснений и без markdown:
{
  "isTask": true если человек просит создать задачу/напоминание/встречу, иначе false,
  "title": "короткая суть задачи, 2-6 слов, с большой буквы, без слов «добавь задачу» и без имени исполнителя",
  "assignee": "имя сотрудника, которому поручают, как прозвучало (например «Фируз», «Лашкаровой»), или null если человек ставит задачу СЕБЕ",
  "date": "YYYY-MM-DD или null если дата не прозвучала",
  "time": "HH:MM или null если время не прозвучало",
  "dateExact": true если дата названа однозначно (число, «завтра», «в понедельник»), false если размыто («на следующей неделе», «скоро») или её нет,
  "transcript": "полный текст сказанного дословно"
}

Правила по исполнителю:
- «поставь Фирузу», «дай задачу Лашкаровой», «пусть Фарзона сделает» — assignee = названное имя.
- «добавь мне», «напомни мне», без имени вовсе — assignee = null.
- Имя приводи к именительному падежу: «Фирузу» → «Фируз», «Лашкаровой» → «Лашкарова».

Правила по дате:
- «10 августа» без года — ближайшее будущее 10 августа относительно сегодня.
- «завтра», «послезавтра», «в понедельник» — посчитай реальную дату, dateExact = true.
- «на следующей неделе», «на днях», «когда-нибудь» — dateExact = false.
- Дата в прошлом невозможна: если получилось прошлое, возьми следующий такой день.`;

    const parts: any[] = transcript === null && audio
      ? [{ inlineData: { mimeType: 'audio/ogg', data: audio.toString('base64') } }, { text: prompt }]
      : [{ text: prompt }];

    // Gemini регулярно отвечает 503 «model is overloaded» — это временно и
    // проходит за секунды. Без повтора человек получал бы «не удалось
    // разобрать» на совершенно исправном голосовом.
    let res: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await model.generateContent(parts);
        break;
      } catch (e: any) {
        lastErr = e;
        if (!/503|overload|unavailable/i.test(e?.message || '')) throw e;
        this.logger.warn(`Gemini перегружен, повтор ${attempt + 1}/3`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    if (!res) throw lastErr;

    const raw = res.response.text().trim().replace(/^```(?:json)?|```$/g, '').trim();
    const parsed = JSON.parse(raw);

    return {
      isTask: !!parsed.isTask,
      title: String(parsed.title || '').slice(0, 200).trim(),
      assignee: parsed.assignee ? String(parsed.assignee).slice(0, 80).trim() : null,
      date: normalizeDate(parsed.date, today),
      time: /^\d{2}:\d{2}$/.test(parsed.time || '') ? parsed.time : null,
      transcript: String(parsed.transcript || '').slice(0, 2000).trim(),
      dateExact: !!parsed.dateExact,
    };
  }

  private async createTask(userId: string, intent: VoiceIntent, assigneeId?: string): Promise<Task> {
    const day = intent.date || todayInDushanbe();
    // Время не прозвучало — ставим на конец дня, чтобы задача не выглядела
    // просроченной с самого утра.
    const deadline = dushanbeInstant(day, intent.time || '23:59');

    const forOther = !!assigneeId && assigneeId !== userId;
    const task = this.taskRepo.create({
      title: intent.title,
      // Расшифровка в описании: если бот расслышал не так, видно исходное.
      description: `${VOICE_MARK}\n\nСказано: «${intent.transcript}»`,
      status: TaskStatus.NEW,
      priority: TaskPriority.MEDIUM,
      // Поручение сотруднику — рабочая задача, а не личная заметка:
      // личные видит только автор, и исполнитель бы её не нашёл.
      scope: forOther ? TaskScope.BUSINESS : TaskScope.PERSONAL,
      deadline,
      createdById: userId,
      assigneeId: assigneeId || userId,
    });
    return this.taskRepo.save(task);
  }

  private doneText(task: Task, intent: VoiceIntent, assigneeLabel?: string): string {
    const when = intent.date ? fmtRu(intent.date) : 'сегодня';
    return (assigneeLabel ? '✅ Задача поставлена\n\n' : '✅ Задача в календаре\n\n') +
      (assigneeLabel ? `👤 ${esc(assigneeLabel)}\n` : '') +
      `<b>${esc(task.title)}</b>\n` +
      `📅 ${when}${intent.time ? ` в ${intent.time}` : ''}`;
  }

  /**
   * Просрочка по задачам, выданным голосом. Раз в час: срок прошёл, задача
   * не закрыта — сообщение основателю и исполнителю. Ровно одно на задачу:
   * дедуп держит createIfNotRecent по ключу, поэтому лишняя колонка в базе
   * не нужна.
   *
   * Штатный планировщик задач просрочки не шлёт — там @Cron снят, просрочки
   * считаются по Доске проектов. Эта проверка смотрит ТОЛЬКО голосовые
   * задачи и существующую логику доски не трогает.
   */
  @Cron('0 * * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyOverdueVoiceTasks(): Promise<{ count: number }> {
    try {
      const rows = await this.taskRepo.createQueryBuilder('t')
        .where('t.deadline < NOW()')
        .andWhere('t.status NOT IN (:...done)', { done: [TaskStatus.DONE, TaskStatus.CANCELLED] })
        .andWhere('t.description LIKE :mark', { mark: `${VOICE_MARK}%` })
        // Смотрим только свежие: старые задачи разбирать поздно, а спам
        // при первом запуске после деплоя никому не нужен.
        .andWhere(`t.deadline > NOW() - INTERVAL '14 days'`)
        .take(100)
        .getMany();

      let count = 0;
      for (const t of rows) {
        const when = new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Asia/Dushanbe', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(t.deadline as any));

        const assignee = t.assigneeId
          ? await this.userRepo.findOne({ where: { id: t.assigneeId } }).catch(() => null)
          : null;
        const who = assignee?.name || 'Исполнитель';
        const alertKey = `voice-overdue:${t.id}`;

        // Автору — кто сорвал срок.
        if (t.createdById) {
          const fresh = await this.notifications.createIfNotRecent({
            userId: t.createdById,
            type: NotificationType.TASK_OVERDUE,
            title: '⚠️ Срок прошёл, задача не сдана',
            message: t.assigneeId && t.assigneeId !== t.createdById
              ? `${who} не выполнил задачу «${t.title}». Срок был ${when}.`
              : `Задача «${t.title}» не выполнена. Срок был ${when}.`,
            link: `/tasks/${t.id}`,
            data: { alertKey },
          }, 24 * 30).catch(() => false);
          if (fresh) {
            count++;
            this.telegram.sendToUser(
              t.createdById,
              `<b>⚠️ Срок прошёл, задача не сдана</b>\n` +
              (t.assigneeId && t.assigneeId !== t.createdById ? `👤 ${esc(who)}\n` : '') +
              `${esc(t.title)}\n📅 срок был ${when}`,
            ).catch(() => { /* не критично */ });
          }
        }

        // Исполнителю — напоминание. Часто задача просто забыта.
        if (t.assigneeId && t.assigneeId !== t.createdById) {
          const fresh = await this.notifications.createIfNotRecent({
            userId: t.assigneeId,
            type: NotificationType.TASK_OVERDUE,
            title: '⚠️ Срок по задаче прошёл',
            message: `«${t.title}» — срок был ${when}. Закройте задачу или сообщите руководителю.`,
            link: `/tasks/${t.id}`,
            data: { alertKey },
          }, 24 * 30).catch(() => false);
          if (fresh) {
            this.telegram.sendToUser(
              t.assigneeId,
              `<b>⚠️ Срок по задаче прошёл</b>\n${esc(t.title)}\n📅 срок был ${when}`,
            ).catch(() => { /* не критично */ });
          }
        }
      }
      if (count) this.logger.log(`voice overdue: уведомлений ${count}`);
      return { count };
    } catch (e: any) {
      this.logger.warn(`voice overdue failed: ${e?.message || e}`);
      return { count: 0 };
    }
  }

  private remember(item: Pending): string {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > PENDING_TTL_MS) this.pending.delete(k);
    // Страховка от бесконечного роста, если TTL почему-то не сработал.
    while (this.pending.size >= PENDING_MAX) this.pending.delete(this.pending.keys().next().value as string);
    const key = `${item.chatId}-${now.toString(36)}`;
    this.pending.set(key, item);
    return key;
  }
}

// ─── Мелкие помощники ───────────────────────────────────────────────────

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Сегодня по Душанбе, а не по таймзоне сервера: на Railway она UTC, и
 *  вечерние «завтра» уезжали бы на день назад. */
function todayInDushanbe(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

/** Названное вслух время — душанбинское. Пояс указываем ЯВНО: без него
 *  строка читается в поясе сервера, а на Railway это UTC, и задача уезжала
 *  на пять часов (а «на весь день» — вообще на следующие сутки).
 *  У Таджикистана нет перевода часов, поэтому смещение всегда +05:00. */
function dushanbeInstant(day: string, time: string): Date {
  return new Date(`${day}T${time}:00+05:00`);
}

/** Модель может вернуть мусор или прошедшую дату — проверяем сами. */
function normalizeDate(value: unknown, today: string): string | null {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Прошлое почти всегда означает, что модель промахнулась с годом.
  return s < today ? null : s;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function fmtRu(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
