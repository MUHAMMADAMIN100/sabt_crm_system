import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | null = null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor() {
    this.apiKey = process.env.BREVO_API_KEY || null;
    this.from = process.env.MAIL_FROM || 'noreply@sabt-system.com';
    this.appUrl = process.env.APP_URL || 'http://localhost:5173';

    if (this.apiKey) {
      this.logger.log(`Mail service ready (Brevo API). Sending from: ${this.from}`);
    } else {
      this.logger.warn('========================================');
      this.logger.warn('MAIL NOT CONFIGURED! Set BREVO_API_KEY in .env');
      this.logger.warn('========================================');
    }
  }

  private async sendViaBrevo(to: string, toName: string, subject: string, html: string, attempt = 1): Promise<void> {
    if (!this.apiKey) return;

    const payload = JSON.stringify({
      sender: { name: 'Sabt System', email: this.from },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent: html,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          {
            hostname: 'api.brevo.com',
            path: '/v3/smtp/email',
            method: 'POST',
            timeout: 10000,
            headers: {
              'api-key': this.apiKey,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                this.logger.log(`Email sent to ${to} [${res.statusCode}]`);
                resolve();
              } else {
                reject(new Error(`Brevo ${res.statusCode}: ${body}`));
              }
            });
          },
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(payload);
        req.end();
      });
    } catch (err) {
      if (attempt < 3) {
        const delay = attempt * 2000; // 2s, 4s
        this.logger.warn(`Email to ${to} failed (attempt ${attempt}/3), retrying in ${delay}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        return this.sendViaBrevo(to, toName, subject, html, attempt + 1);
      }
      this.logger.error(`Email request failed after 3 attempts: ${err.message}`);
      throw err;
    }
  }

  private header(title: string) {
    return `
      <div style="background:linear-gradient(135deg,#4f6ef7 0%,#7c3aed 100%);padding:32px 40px;text-align:center;">
        <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <span style="font-size:28px;">📋</span>
        </div>
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${title}</h1>
        <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Sabt System — ERP уведомление</p>
      </div>`;
  }

  private footer() {
    return `
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
        <p style="color:#94a3b8;font-size:12px;margin:0;">
          Это автоматическое уведомление от <strong>Sabt System</strong>. Не отвечайте на это письмо.
        </p>
      </div>`;
  }

  private row(label: string, value: string) {
    return `
      <tr>
        <td style="padding:8px 0;color:#64748b;font-size:14px;width:140px;vertical-align:top;">${label}</td>
        <td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:500;">${value}</td>
      </tr>`;
  }

  async sendProjectAssigned(
    to: string,
    recipientName: string,
    projectName: string,
    projectLink: string,
    description?: string,
    deadline?: string,
    managerName?: string,
  ) {
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('Новый проект назначен')}
        <div style="padding:32px 40px;">
          <p style="color:#334155;font-size:15px;margin:0 0 24px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            Вас добавили в новый проект в системе Sabt System.
          </p>
          <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              ${this.row('📌 Проект:', projectName)}
              ${managerName ? this.row('👤 Менеджер:', managerName) : ''}
              ${description ? this.row('📝 Описание:', description) : ''}
              ${deadline ? this.row('📅 Дедлайн:', deadline) : ''}
            </table>
          </div>
          <a href="${this.appUrl}${projectLink}"
             style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;">
            Открыть проект →
          </a>
        </div>
        ${this.footer()}
      </div>`;

    try {
      await this.sendViaBrevo(to, recipientName, `📁 Вас добавили в проект: ${projectName}`, html);
    } catch (err) {
      this.logger.error(`Failed to send project email to ${to}: ${err.message}`);
    }
  }

  async sendTaskAssigned(
    to: string,
    recipientName: string,
    taskTitle: string,
    taskId: string,
    projectName?: string,
    deadline?: string,
    priority?: string,
    description?: string,
  ) {
    const priorityLabels: Record<string, string> = {
      low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный',
    };
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('Вам назначена задача')}
        <div style="padding:32px 40px;">
          <p style="color:#334155;font-size:15px;margin:0 0 24px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            Вам назначена новая задача в системе Sabt System.
          </p>
          <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              ${this.row('✅ Задача:', taskTitle)}
              ${projectName ? this.row('📁 Проект:', projectName) : ''}
              ${priority ? this.row('🔥 Приоритет:', priorityLabels[priority] || priority) : ''}
              ${deadline ? this.row('📅 Дедлайн:', deadline) : ''}
              ${description ? this.row('📝 Описание:', description) : ''}
            </table>
          </div>
          <a href="${this.appUrl}/tasks/${taskId}"
             style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;">
            Открыть задачу →
          </a>
        </div>
        ${this.footer()}
      </div>`;

    try {
      await this.sendViaBrevo(to, recipientName, `✅ Новая задача: ${taskTitle}`, html);
    } catch (err) {
      this.logger.error(`Failed to send task email to ${to}: ${err.message}`);
    }
  }

  async sendCommentNotification(
    to: string,
    recipientName: string,
    commentText: string,
    taskTitle: string,
    projectName: string,
    taskId: string,
    authorName: string,
  ) {
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('Новый комментарий к задаче')}
        <div style="padding:32px 40px;">
          <p style="color:#334155;font-size:15px;margin:0 0 24px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            В вашей задаче появился новый комментарий.
          </p>
          <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
            <table style="width:100%;border-collapse:collapse;">
              ${this.row('📋 Задача:', taskTitle)}
              ${projectName ? this.row('📁 Проект:', projectName) : ''}
              ${this.row('👤 Автор:', authorName)}
            </table>
          </div>
          <div style="border-left:3px solid #4f6ef7;padding:14px 18px;background:#eff6ff;border-radius:0 8px 8px 0;margin-bottom:24px;">
            <p style="color:#1e40af;font-size:14px;margin:0;line-height:1.6;">${commentText}</p>
          </div>
          <a href="${this.appUrl}/tasks/${taskId}"
             style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;">
            Открыть задачу →
          </a>
        </div>
        ${this.footer()}
      </div>`;

    try {
      await this.sendViaBrevo(to, recipientName, `💬 Новый комментарий: ${taskTitle}`, html);
    } catch (err) {
      this.logger.error(`Failed to send comment email to ${to}: ${err.message}`);
    }
  }

  async sendPasswordReset(to: string, recipientName: string, resetToken: string) {
    const resetUrl = `${this.appUrl}/auth?resetToken=${resetToken}`;
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('🔐 Сброс пароля')}
        <div style="padding:32px 40px;">
          <p style="color:#334155;font-size:15px;margin:0 0 24px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            Мы получили запрос на сброс пароля от вашей учётной записи.
          </p>
          <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Ссылка действительна 1 час. Если вы не запрашивали сброс — проигнорируйте это письмо.</p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;">
            Сбросить пароль →
          </a>
        </div>
        ${this.footer()}
      </div>`;
    try {
      await this.sendViaBrevo(to, recipientName, '🔐 Сброс пароля — Sabt System', html);
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${to}: ${err.message}`);
    }
  }

  async sendDeadlineReminder(
    to: string,
    recipientName: string,
    taskTitle: string,
    taskId: string,
    projectName: string,
    deadline: string,
    daysLeft: number,
  ) {
    const urgencyColor = daysLeft === 1 ? '#ef4444' : daysLeft === 2 ? '#f97316' : '#eab308';
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('⏰ Напоминание о дедлайне')}
        <div style="padding:32px 40px;">
          <p style="color:#334155;font-size:15px;margin:0 0 24px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            Напоминаем: до дедлайна задачи осталось <strong style="color:${urgencyColor};">${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}</strong>.
          </p>
          <div style="background:#f1f5f9;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              ${this.row('✅ Задача:', taskTitle)}
              ${this.row('📁 Проект:', projectName)}
              ${this.row('📅 Дедлайн:', deadline)}
            </table>
          </div>
          <a href="${this.appUrl}/tasks/${taskId}"
             style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:15px;font-weight:600;">
            Открыть задачу →
          </a>
        </div>
        ${this.footer()}
      </div>`;
    try {
      await this.sendViaBrevo(to, recipientName, `⏰ Дедлайн через ${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}: ${taskTitle}`, html);
    } catch (err) {
      this.logger.error(`Failed to send deadline reminder to ${to}: ${err.message}`);
    }
  }

  /** Notify user they're now the project manager */
  async sendManagerAssigned(
    to: string,
    recipientName: string,
    projectName: string,
    projectId: string,
    description?: string,
    deadline?: string,
    actorName?: string,
  ) {
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('👑 Вы — менеджер проекта')}
        <div style="padding:28px 36px;">
          <p style="color:#334155;font-size:15px;margin:0 0 16px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            ${actorName ? `<strong>${actorName}</strong> назначил${actorName.endsWith('а') ? 'а' : ''} вас` : 'Вас назначили'} менеджером проекта.
          </p>
          <div style="background:#f1f5f9;border-radius:10px;padding:18px 22px;margin-bottom:22px;">
            <table style="width:100%;border-collapse:collapse;">
              ${this.row('📁 Проект:', projectName)}
              ${description ? this.row('📝 Описание:', description) : ''}
              ${deadline ? this.row('📅 Дедлайн:', deadline) : ''}
            </table>
          </div>
          <a href="${this.appUrl}/projects/${projectId}" style="display:inline-block;padding:12px 26px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">
            Открыть проект →
          </a>
        </div>
        ${this.footer()}
      </div>`;
    try {
      await this.sendViaBrevo(to, recipientName, `👑 Вы теперь менеджер проекта «${projectName}»`, html);
    } catch (err) {
      this.logger.error(`Failed to send manager-assigned to ${to}: ${err.message}`);
    }
  }

  /** Notify user they are no longer the project manager */
  async sendManagerRemoved(
    to: string,
    recipientName: string,
    projectName: string,
    projectId: string,
    actorName?: string,
  ) {
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('📋 Смена менеджера проекта')}
        <div style="padding:28px 36px;">
          <p style="color:#334155;font-size:15px;margin:0 0 16px;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            Вы больше не являетесь менеджером проекта <strong>${projectName}</strong>${actorName ? ` — изменение сделал ${actorName}` : ''}.
          </p>
          <a href="${this.appUrl}/projects/${projectId}" style="display:inline-block;padding:12px 26px;background:linear-gradient(135deg,#64748b,#475569);color:#fff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">
            Открыть проект →
          </a>
        </div>
        ${this.footer()}
      </div>`;
    try {
      await this.sendViaBrevo(to, recipientName, `📋 Вы больше не менеджер проекта «${projectName}»`, html);
    } catch (err) {
      this.logger.error(`Failed to send manager-removed to ${to}: ${err.message}`);
    }
  }

  /** Notify user they were removed from a project */
  async sendMemberRemoved(
    to: string,
    recipientName: string,
    projectName: string,
    actorName?: string,
  ) {
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('👥 Вас убрали из проекта')}
        <div style="padding:28px 36px;">
          <p style="color:#334155;font-size:15px;margin:0;">
            Здравствуйте, <strong>${recipientName}</strong>!<br>
            Вас больше нет в составе проекта <strong>${projectName}</strong>${actorName ? ` — изменение сделал ${actorName}` : ''}.
          </p>
        </div>
        ${this.footer()}
      </div>`;
    try {
      await this.sendViaBrevo(to, recipientName, `👥 Вас убрали из проекта «${projectName}»`, html);
    } catch (err) {
      this.logger.error(`Failed to send member-removed to ${to}: ${err.message}`);
    }
  }

  /** Daily end-of-day summary for PM: tasks not completed today */
  async sendDailyUncompletedSummary(
    to: string,
    recipientName: string,
    projectName: string,
    tasks: Array<{ id: string; title: string; assigneeName: string; status: string }>,
    dateStr: string,
  ) {
    const statusLabels: Record<string, string> = {
      new: 'Новая',
      in_progress: 'В работе',
      review: 'На проверке',
      returned: 'Возвращена',
    };
    const rows = tasks.map(t => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:14px;">
          <a href="${this.appUrl}/tasks/${t.id}" style="color:#4f6ef7;text-decoration:none;font-weight:600;">${t.title}</a>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;">${t.assigneeName}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;">${statusLabels[t.status] || t.status}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        ${this.header('📋 Итоги дня: невыполненные задачи')}
        <div style="padding:28px 36px;">
          <p style="color:#334155;font-size:15px;margin:0 0 6px;">
            Здравствуйте, <strong>${recipientName}</strong>!
          </p>
          <p style="color:#64748b;font-size:14px;margin:0 0 20px;">
            По проекту <strong style="color:#1e293b;">${projectName}</strong> за ${dateStr}
            осталось <strong style="color:#ef4444;">${tasks.length}</strong>
            невыполненных задач${tasks.length === 1 ? 'а' : ''}.
          </p>
          <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px;overflow:hidden;margin-bottom:22px;">
            <thead>
              <tr style="background:#eef2ff;">
                <th style="text-align:left;padding:10px 14px;color:#475569;font-size:12px;font-weight:600;">Задача</th>
                <th style="text-align:left;padding:10px 14px;color:#475569;font-size:12px;font-weight:600;">Исполнитель</th>
                <th style="text-align:left;padding:10px 14px;color:#475569;font-size:12px;font-weight:600;">Статус</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <a href="${this.appUrl}/projects" style="display:inline-block;padding:12px 26px;background:linear-gradient(135deg,#4f6ef7,#7c3aed);color:#fff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">
            Открыть проекты →
          </a>
        </div>
        ${this.footer()}
      </div>`;
    try {
      await this.sendViaBrevo(to, recipientName, `📋 Невыполнено за ${dateStr}: ${projectName} (${tasks.length})`, html);
    } catch (err) {
      this.logger.error(`Failed to send daily summary to ${to}: ${err.message}`);
    }
  }
}
