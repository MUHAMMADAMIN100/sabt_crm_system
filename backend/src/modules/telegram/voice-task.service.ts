import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Task, TaskScope, TaskStatus, TaskPriority } from '../tasks/task.entity';
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
interface Pending extends VoiceIntent { userId: string; chatId: number; at: number }

const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 200;

@Injectable()
export class VoiceTaskService {
  private readonly logger = new Logger(VoiceTaskService.name);
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly pending = new Map<string, Pending>();

  /** Кому доступна голосовая постановка. По требованию владельца — основатель. */
  private static readonly VOICE_ROLES: string[] = [UserRole.FOUNDER];

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
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
    const user = await this.resolveFounder(chatId);
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

      // Дата чёткая — создаём молча. Размытая или её нет — переспрашиваем.
      if (intent.date && intent.dateExact) {
        const task = await this.createTask(user.id, intent);
        await this.telegram.sendMessage(chatId, this.doneText(task, intent));
        return true;
      }

      const key = this.remember({ ...intent, userId: user.id, chatId, at: Date.now() });
      await this.telegram.sendMessage(
        chatId,
        '🎤 Понял так:\n\n' +
        `<b>${esc(intent.title)}</b>\n` +
        `📅 ${intent.date ? fmtRu(intent.date) : 'дата не прозвучала — поставлю на сегодня'}` +
        `${intent.time ? ` в ${intent.time}` : ''}\n\n` +
        `<i>«${esc(intent.transcript)}»</i>`,
        [[
          { text: '✓ Создать', callback_data: `vt:ok:${key}` },
          { text: '✕ Отмена', callback_data: `vt:no:${key}` },
        ]],
      );
      return true;
    } catch (e: any) {
      this.logger.warn(`voice task failed: ${e?.message || e}`);
      await this.telegram.sendMessage(chatId, '⚠️ Не удалось разобрать голосовое. Попробуйте ещё раз.');
      return true;
    }
  }

  /** Нажали кнопку под переспросом. Возвращает текст для всплывашки. */
  async handleCallback(data: string, chatId: number): Promise<string | null> {
    const m = /^vt:(ok|no):(.+)$/.exec(data);
    if (!m) return null;
    const [, action, key] = m;
    const item = this.pending.get(key);
    this.pending.delete(key);

    if (!item) return 'Запрос устарел — наговорите заново';
    if (item.chatId !== chatId) return 'Запрос не найден';
    if (action === 'no') return 'Отменено';

    try {
      const task = await this.createTask(item.userId, item);
      await this.telegram.sendMessage(chatId, this.doneText(task, item));
      return 'Задача создана';
    } catch (e: any) {
      this.logger.warn(`voice task create failed: ${e?.message || e}`);
      return 'Не удалось создать задачу';
    }
  }

  // ─── Внутреннее ───────────────────────────────────────────────────────

  private async resolveFounder(chatId: number): Promise<User | null> {
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
  "title": "короткая суть задачи, 2-6 слов, с большой буквы, без слов «добавь задачу»",
  "date": "YYYY-MM-DD или null если дата не прозвучала",
  "time": "HH:MM или null если время не прозвучало",
  "dateExact": true если дата названа однозначно (число, «завтра», «в понедельник»), false если размыто («на следующей неделе», «скоро») или её нет,
  "transcript": "полный текст сказанного дословно"
}

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
      date: normalizeDate(parsed.date, today),
      time: /^\d{2}:\d{2}$/.test(parsed.time || '') ? parsed.time : null,
      transcript: String(parsed.transcript || '').slice(0, 2000).trim(),
      dateExact: !!parsed.dateExact,
    };
  }

  private async createTask(userId: string, intent: VoiceIntent): Promise<Task> {
    const day = intent.date || todayInDushanbe();
    // Время не прозвучало — ставим на конец дня, чтобы задача не выглядела
    // просроченной с самого утра.
    const deadline = new Date(`${day}T${intent.time || '23:59'}:00`);

    const task = this.taskRepo.create({
      title: intent.title,
      // Расшифровка в описании: если бот расслышал не так, видно исходное.
      description: `Создано голосом в Telegram.\n\nСказано: «${intent.transcript}»`,
      status: TaskStatus.NEW,
      priority: TaskPriority.MEDIUM,
      scope: TaskScope.PERSONAL,
      deadline,
      createdById: userId,
      assigneeId: userId,
    });
    return this.taskRepo.save(task);
  }

  private doneText(task: Task, intent: VoiceIntent): string {
    const when = intent.date ? fmtRu(intent.date) : 'сегодня';
    return '✅ Задача в календаре\n\n' +
      `<b>${esc(task.title)}</b>\n` +
      `📅 ${when}${intent.time ? ` в ${intent.time}` : ''}`;
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
