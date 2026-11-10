import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import { createHash, timingSafeEqual } from 'crypto';
import { Employee } from '../employees/employee.entity';
import { vacationNow } from '../employees/vacation';

/** Кнопка inline-клавиатуры Telegram. */
export interface TgButton { text: string; callback_data: string }

/** Голосовой помощник (modules/voice-assistant). Регистрируется сам — так
 *  модуль бота не зависит от помощника и не образует круг модулей. */
/** Фото или документ, присланные боту. */
export interface IncomingFile {
  fileId: string;
  name: string;
  mime: string;
  kind: 'photo' | 'document';
}

export interface TelegramAssistant {
  handleFile(chatId: number, file: IncomingFile, caption: string, meta?: { replyTaskId?: string | null }): Promise<boolean>;
  handleVoice(chatId: number, fileId: string, durationSec: number, meta?: { replyTaskId?: string | null }): Promise<boolean>;
  handleText(chatId: number, text: string, meta?: { replyTaskId?: string | null }): Promise<boolean>;
  handleCallback(chatId: number, data: string): Promise<{ toast: string; append?: string } | null>;
}

/** Секрет webhook — производная от токена бота: новой переменной не нужно,
 *  а без токена подделать заголовок нельзя. */
export function webhookSecretFor(token: string): string {
  return createHash('sha256').update(`sabt-telegram-webhook:${token}`).digest('hex');
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string | null;
  readonly appUrl: string;
  private assistantImpl: TelegramAssistant | null = null;
  /** Секрет включаем в проверку только после того, как Telegram его принял
   *  (setWebhook ок). Иначе сбой установки оставил бы бот глухим. */
  private secretActive = false;

  constructor(
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {
    this.token = process.env.TELEGRAM_BOT_TOKEN || null;
    this.appUrl = process.env.APP_URL || 'http://localhost:5173';

    if (this.token) {
      this.logger.log('Telegram Bot ready');
      // Меню команд в чате: без него сотрудник не догадается, что бот
      // умеет показывать задачи. Сбой регистрации не должен ронять старт.
      void this.registerCommands();
      // Подпись входящих апдейтов (09.11.2026): до этого любой, кто знал
      // адрес webhook, мог прислать «сообщение» от имени сотрудника. Только
      // на проде: локальный запуск не должен трогать webhook боевого бота.
      if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_WEBHOOK_AUTOSET !== 'false') {
        void this.ensureWebhookSecret();
      }
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled');
    }
  }

  registerAssistant(impl: TelegramAssistant): void {
    this.assistantImpl = impl;
  }

  get assistant(): TelegramAssistant | null {
    return this.assistantImpl;
  }

  /** Проверка заголовка X-Telegram-Bot-Api-Secret-Token. */
  verifyWebhook(header: string | undefined | null): boolean {
    if (!this.secretActive || !this.token) return true;
    const expected = Buffer.from(webhookSecretFor(this.token));
    const got = Buffer.from(String(header || ''));
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  /** Переустановить webhook с тем же адресом, но с секретом. Адрес берём у
   *  самого Telegram — значит, на чужой сервер бот не уедет. */
  private async ensureWebhookSecret(attempt = 1): Promise<void> {
    try {
      const info: any = await this.callApiJson('getWebhookInfo', {});
      const url = info?.result?.url;
      if (!url) {
        this.logger.warn('webhook не установлен — подпись не включаю');
        return;
      }
      const payload: any = { url, secret_token: webhookSecretFor(this.token as string), drop_pending_updates: false };
      if (Array.isArray(info.result.allowed_updates) && info.result.allowed_updates.length) {
        payload.allowed_updates = info.result.allowed_updates;
      }
      if (info.result.max_connections) payload.max_connections = info.result.max_connections;
      const res: any = await this.callApiJson('setWebhook', payload);
      if (!res?.ok) throw new Error(res?.description || 'setWebhook не принят');
      this.secretActive = true;
      this.logger.log('webhook Telegram подписан секретом');
    } catch (e: any) {
      this.logger.error(`подпись webhook не включена (попытка ${attempt}): ${e?.message || e}`);
      if (attempt < 5) setTimeout(() => void this.ensureWebhookSecret(attempt + 1), 60_000 * attempt);
    }
  }

  /** «Печатает…» в чате — видно, что бот работает над сообщением. */
  async sendChatAction(chatId: string | number, action: 'typing' = 'typing'): Promise<void> {
    if (!this.token || !chatId) return;
    await this.callApi('sendChatAction', { chat_id: chatId, action }).catch(() => undefined);
  }

  /** Список команд в кнопке «Меню» у бота. */
  private async registerCommands(): Promise<void> {
    try {
      await this.callApiJson('setMyCommands', {
        commands: [
          { command: 'tasks', description: 'Мои задачи' },
          { command: 'today', description: 'Задачи и встречи на сегодня' },
          { command: 'help', description: 'Что умеет бот' },
          { command: 'start', description: 'Привязать аккаунт' },
        ],
      });
    } catch (e: any) {
      this.logger.warn(`setMyCommands failed: ${e?.message || e}`);
    }
  }

  /** Отправить сообщение по userId системы (ищет chatId через таблицу employees).
   *  buttons — опциональная inline-клавиатура (ряды кнопок). */
  async sendToUser(userId: string, text: string, buttons?: TgButton[][]): Promise<void> {
    try {
      const employee = await this.employeeRepo.findOne({ where: { userId } });
      // Операционные причины «не пришло в TG» — логируем, чтобы было видно:
      // нет карточки сотрудника, или не нажал /start (нет telegramChatId).
      if (!employee) { this.logger.debug(`no employee row for user ${userId} — Telegram skipped`); return; }
      if (!employee.telegramChatId) { this.logger.debug(`user ${userId} has no telegramChatId (не нажал /start) — Telegram skipped`); return; }
      // В отпуске не беспокоим: уведомления копятся в CRM, в Telegram — тишина.
      if (vacationNow(employee)) { this.logger.debug(`user ${userId} on vacation — Telegram skipped`); return; }
      await this.sendMessage(employee.telegramChatId, text, buttons);
    } catch (e) {
      this.logger.warn(`Failed to send Telegram to user ${userId}: ${e?.message || e}`);
    }
  }

  /** Отправить сообщение напрямую по chatId (+ опциональные кнопки). */
  async sendMessage(chatId: string | number, text: string, buttons?: TgButton[][]): Promise<void> {
    if (!this.token || !chatId) return;
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (buttons && buttons.length) payload.reply_markup = { inline_keyboard: buttons };
    await this.callApi('sendMessage', payload).catch(err =>
      this.logger.error(`Failed to send Telegram to ${chatId}: ${err.message}`));
  }

  /** Ответ на нажатие inline-кнопки — убирает «часики» и показывает тост. */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.token) return;
    await this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || '',
      show_alert: false,
    }).catch(() => {});
  }

  /** Заменить текст сообщения и убрать кнопки (после нажатия). */
  async editMessageText(chatId: string | number, messageId: number, text: string): Promise<void> {
    if (!this.token || !chatId || !messageId) return;
    await this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }

  /** Системный userId по Telegram chatId (для обработки нажатий). */
  async resolveUserIdByChat(chatId: string | number): Promise<string | null> {
    const employee = await this.employeeRepo.findOne({ where: { telegramChatId: String(chatId) } }).catch(() => null);
    return employee?.userId || null;
  }

  /** Скачивает файл, присланный в бот (голосовое сообщение).
   *  Telegram отдаёт файл в два шага: сначала getFile за путём, потом сам
   *  файл с другого хоста. Больше 20 МБ Bot API скачивать не умеет — для
   *  голосовых это не ограничение, минута речи весит около 100 КБ. */
  async downloadFile(fileId: string): Promise<Buffer> {
    const info: any = await this.callApiJson('getFile', { file_id: fileId });
    const path = info?.result?.file_path;
    if (!path) throw new Error('Telegram не отдал путь к файлу');
    return this.fetchBinary(`/file/bot${this.token}/${path}`);
  }

  private fetchBinary(path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { hostname: 'api.telegram.org', path, method: 'GET', timeout: 20000 },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Telegram file ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  /** Как callApi, но с разбором ответа: нужен там, где Telegram что-то
   *  возвращает (getFile), а не просто подтверждает доставку. */
  private callApiJson(method: string, payload: any): Promise<any> {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.token}/${method}`,
          method: 'POST',
          timeout: 15000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          let resp = '';
          res.on('data', (c) => (resp += c));
          res.on('end', () => {
            try { resolve(JSON.parse(resp)) } catch { reject(new Error(`Telegram ${res.statusCode}: ${resp}`)) }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }

  /** Низкоуровневый вызов Bot API. */
  private callApi(method: string, payload: any): Promise<void> {
    const body = JSON.stringify(payload);
    return new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${this.token}/${method}`,
          method: 'POST',
          timeout: 10000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          let resp = '';
          res.on('data', (c) => (resp += c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve();
            else reject(new Error(`Telegram ${res.statusCode}: ${resp}`));
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }
}
