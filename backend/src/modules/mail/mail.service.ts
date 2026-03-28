import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;
    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST || 'smtp.gmail.com',
        port: Number(process.env.MAIL_PORT) || 587,
        secure: false,
        auth: { user, pass },
      });
    } else {
      this.logger.warn('Mail not configured (MAIL_USER/MAIL_PASS missing). Emails will be skipped.');
    }
  }

  async sendProjectAssigned(to: string, recipientName: string, projectName: string, projectLink: string) {
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM || 'noreply@erp-system.com',
        to,
        subject: `Вы добавлены в проект: ${projectName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4f6ef7;">ERP System — Новый проект</h2>
            <p>Здравствуйте, <strong>${recipientName}</strong>!</p>
            <p>Вас добавили в проект <strong>"${projectName}"</strong>.</p>
            <p>Для просмотра проекта перейдите по ссылке:</p>
            <a href="http://localhost:5173${projectLink}"
               style="display:inline-block;padding:10px 20px;background:#4f6ef7;color:#fff;border-radius:8px;text-decoration:none;">
              Открыть проект
            </a>
            <p style="color:#999;font-size:12px;margin-top:20px;">ERP System — автоматическое уведомление</p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error('Failed to send email:', err.message);
    }
  }
}
