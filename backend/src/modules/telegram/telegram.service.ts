import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import { Employee } from '../employees/employee.entity';

/** Кнопка inline-клавиатуры Telegram. */
export interface TgButton { text: string; callback_data: string }

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string | null;
  readonly appUrl: string;

  constructor(
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {
    this.token = process.env.TELEGRAM_BOT_TOKEN || null;
    this.appUrl = process.env.APP_URL || 'http://localhost:5173';

    if (this.token) {
      this.logger.log('Telegram Bot ready');
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled');
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
