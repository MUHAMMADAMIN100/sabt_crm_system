import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import { Employee } from '../employees/employee.entity';

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

  /** Отправить сообщение по userId системы (ищет chatId через таблицу employees) */
  async sendToUser(userId: string, text: string): Promise<void> {
    try {
      const employee = await this.employeeRepo.findOne({ where: { userId } });
      if (!employee?.telegramChatId) return;
      await this.sendMessage(employee.telegramChatId, text);
    } catch (_) {
      // никогда не ломаем основной поток
    }
  }

  /** Отправить сообщение напрямую по chatId */
  async sendMessage(chatId: string | number, text: string): Promise<void> {
    if (!this.token || !chatId) return;

    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          {
            hostname: 'api.telegram.org',
            path: `/bot${this.token}/sendMessage`,
            method: 'POST',
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                this.logger.log(`Telegram sent to ${chatId}`);
                resolve();
              } else {
                reject(new Error(`Telegram ${res.statusCode}: ${body}`));
              }
            });
          },
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(payload);
        req.end();
      });
    } catch (err) {
      this.logger.error(`Failed to send Telegram to ${chatId}: ${err.message}`);
    }
  }
}
