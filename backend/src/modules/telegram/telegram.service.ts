import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
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

/** Срок жизни одноразового кода привязки Telegram. */
export const LINK_CODE_TTL_MS = 15 * 60_000;

/** Код привязки в базе храним только хэшем: утечка таблицы не даёт привязать чужой чат. */
export const linkCodeHash = (code: string): string => createHash('sha256').update(`tg-link:${code}`).digest('hex');

/** Код из «/start <код>»: base64url, как его выдаёт createLinkCode. */
export function startPayload(text: string): string | null {
  const m = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{16,64}))?\s*$/.exec(String(text || '').trim());
  return m?.[1] || null;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string | null;
  readonly appUrl: string;
  private assistantImpl: TelegramAssistant | null = null;
  /** Telegram принял секрет (setWebhook ок). На проде заголовок обязателен
   *  всегда (15.11.2026); флаг важен только вне прода — там без заголовка
   *  пускаем, пока секрет не включён. */
  private secretActive = false;
  /** Повтор установки секрета уже запланирован. */
  private secretRetry: NodeJS.Timeout | null = null;
  /** Когда последний раз чинили подпись из-за апдейта без верного заголовка. */
  private healAt = 0;
  /** Имя бота для ссылки t.me/<бот>?start=<код> (getMe, кэш). */
  private botName: string | null = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim() || null;
  private linkTable: Promise<void> | null = null;

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
      // С 15.11.2026 — и при TELEGRAM_WEBHOOK_AUTOSET=false: адрес webhook
      // мы и так не меняем (берём у Telegram как есть), лишь добавляем к
      // нему секрет, а без секрета прод теперь отклоняет все апдейты.
      if (process.env.NODE_ENV === 'production') {
        this.healAt = Date.now();
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

  /** Проверка заголовка X-Telegram-Bot-Api-Secret-Token.
   *  Раньше без включённого секрета пускали всех (fail-open): сбой setWebhook
   *  при запуске открывал webhook для подделки. Теперь (15.11.2026): на проде
   *  при заданном токене заголовок обязателен всегда; вне прода без заголовка
   *  пускаем, только пока секрет не включён. Без токена бота нет — апдейтов
   *  тоже. Telegram повторяет не-2xx, поэтому короткий отказ при запуске
   *  ничего не теряет. */
  verifyWebhook(header: string | undefined | null): boolean {
    if (!this.token) return false;
    const got = String(header || '');
    if (got) {
      const expected = Buffer.from(webhookSecretFor(this.token));
      const given = Buffer.from(got);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
    } else if (process.env.NODE_ENV !== 'production' && !this.secretActive) {
      return true;
    }
    this.healWebhookSecret();
    return false;
  }

  /** Апдейт на проде без верной подписи: возможно, webhook переставили без
   *  секрета — переподписываем (не чаще раза в 5 минут). */
  private healWebhookSecret(): void {
    if (process.env.NODE_ENV !== 'production' || !this.token || this.secretRetry) return;
    if (Date.now() - this.healAt < 5 * 60_000) return;
    this.healAt = Date.now();
    void this.ensureWebhookSecret();
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
      // Громко: пока секрета нет, прод отклоняет все апдейты бота.
      this.logger.error(`ВНИМАНИЕ: подпись webhook Telegram не включена (попытка ${attempt}) — апдейты без подписи отклоняются: ${e?.message || e}`);
      // Повторяем, пока не получится (раньше — 5 попыток, и бот оставался
      // без подписи до перезапуска), с паузой до 10 минут.
      if (!this.secretRetry) {
        this.secretRetry = setTimeout(() => {
          this.secretRetry = null;
          void this.ensureWebhookSecret(attempt + 1);
        }, Math.min(60_000 * attempt, 10 * 60_000));
        this.secretRetry.unref?.();
      }
    }
  }

  // ─── Привязка чата по одноразовому коду (15.11.2026) ───────────────────
  // Раньше /start привязывал чат по совпадению username с полем «Telegram»
  // в карточке и перезаписывал чужую привязку: кто занял этот username,
  // получал уведомления и действия бота от имени сотрудника. Теперь
  // перепривязка — только по коду из CRM (человек доказал вход в систему).

  /** Таблица кодов — идемпотентно, при первом обращении (повтор при сбое). */
  private ensureLinkTable(): Promise<void> {
    if (!this.linkTable) {
      this.linkTable = this.employeeRepo.manager.query(
        `CREATE TABLE IF NOT EXISTS telegram_link_codes (
           "codeHash" varchar(64) PRIMARY KEY,
           "userId" uuid NOT NULL,
           "expiresAt" timestamptz NOT NULL,
           "createdAt" timestamptz NOT NULL DEFAULT now()
         )`,
      ).then(() => undefined).catch((e) => {
        this.linkTable = null;
        throw e;
      });
    }
    return this.linkTable;
  }

  /** Имя бота: TELEGRAM_BOT_USERNAME или getMe (кэш на всё время работы). */
  async botUsername(): Promise<string | null> {
    if (this.botName || !this.token) return this.botName;
    try {
      const me: any = await this.callApiJson('getMe', {});
      const name = me?.ok ? String(me.result?.username || '').trim() : '';
      if (name) this.botName = name;
    } catch (e: any) {
      this.logger.warn(`getMe не ответил: ${e?.message || e}`);
    }
    return this.botName;
  }

  /** Одноразовая ссылка привязки: t.me/<бот>?start=<код>, 15 минут.
   *  Новый код отменяет прежние коды этого сотрудника. */
  async createLinkCode(userId: string): Promise<{ url: string; expiresAt: string }> {
    if (!this.token) throw new ServiceUnavailableException('Telegram-бот не настроен');
    const employee = await this.employeeRepo.findOne({ where: { userId } });
    if (!employee) throw new BadRequestException('У вашего аккаунта нет карточки сотрудника — привязать Telegram нельзя. Обратитесь к администратору.');
    const bot = await this.botUsername();
    if (!bot) throw new ServiceUnavailableException('Не удалось узнать имя Telegram-бота — попробуйте ещё раз через минуту');
    await this.ensureLinkTable();
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    const q = this.employeeRepo.manager;
    await q.query(`DELETE FROM telegram_link_codes WHERE "userId" = $1 OR "expiresAt" < now()`, [userId]);
    await q.query(
      `INSERT INTO telegram_link_codes ("codeHash", "userId", "expiresAt") VALUES ($1, $2, $3)`,
      [linkCodeHash(code), userId, expiresAt],
    );
    return { url: `https://t.me/${bot}?start=${code}`, expiresAt: expiresAt.toISOString() };
  }

  /** Погасить код (одноразовый): userId владельца или null — неверный/просрочен. */
  async consumeLinkCode(code: string): Promise<string | null> {
    if (!code) return null;
    try {
      await this.ensureLinkTable();
      const res: any = await this.employeeRepo.manager.query(
        `DELETE FROM telegram_link_codes WHERE "codeHash" = $1 RETURNING "userId", "expiresAt"`,
        [linkCodeHash(code)],
      );
      // У DELETE … RETURNING TypeORM (pg) отдаёт [строки, число].
      const rows: any[] = Array.isArray(res?.[0]) ? res[0] : (res || []);
      const row = rows[0];
      if (!row || new Date(row.expiresAt).getTime() < Date.now()) return null;
      return String(row.userId);
    } catch (e: any) {
      this.logger.error(`код привязки Telegram не проверен: ${e?.message || e}`);
      return null;
    }
  }

  /** Привязать чат к сотруднику. Чат — только у одного сотрудника: иначе
   *  по нему нельзя однозначно понять, кто пишет боту. */
  async linkChat(employeeId: string, chatId: string | number): Promise<void> {
    const chat = String(chatId);
    await this.employeeRepo.manager.query(
      `UPDATE employees SET "telegramChatId" = NULL WHERE "telegramChatId" = $1 AND id <> $2`,
      [chat, employeeId],
    );
    await this.employeeRepo.update(employeeId, { telegramChatId: chat });
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
