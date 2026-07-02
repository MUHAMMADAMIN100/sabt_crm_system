import { Controller, Post, Body, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramService } from './telegram.service';
import { Employee } from '../employees/employee.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { TasksService } from '../tasks/tasks.service';

interface TelegramUpdate {
  message?: {
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id: number };
    data?: string;
    message?: { message_id: number; chat?: { id: number }; text?: string };
  };
}

@Controller('telegram')
export class TelegramController {
  constructor(
    private telegramService: TelegramService,
    @Inject(forwardRef(() => WorkflowService)) private workflowService: WorkflowService,
    @Inject(forwardRef(() => TasksService)) private tasksService: TasksService,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {}

  @Post('webhook')
  async handleWebhook(@Body() update: TelegramUpdate) {
    // ── Нажатие inline-кнопки («Сделал / Не сделал» на карточке) ──────────
    const cq = update?.callback_query;
    if (cq) {
      const chatId = cq.from?.id;
      const data = cq.data || '';
      // Карточки доски: wf:done|skip:<cardId>. Обычные задачи: t:done|progress:<taskId>.
      const wfMatch = data.match(/^wf:(done|skip):(.+)$/);
      const taskMatch = data.match(/^t:(done|progress):(.+)$/);
      if (!chatId || (!wfMatch && !taskMatch)) {
        if (cq.id) await this.telegramService.answerCallbackQuery(cq.id, '');
        return { ok: true };
      }
      const userId = await this.telegramService.resolveUserIdByChat(chatId);
      if (!userId) {
        await this.telegramService.answerCallbackQuery(cq.id, 'Аккаунт не привязан. Нажмите /start в боте.');
        return { ok: true };
      }
      let resultText = 'Готово';
      try {
        if (taskMatch) {
          const res = await this.tasksService.handleBotAction(taskMatch[2], taskMatch[1] as 'done' | 'progress', userId);
          resultText = res.text;
        } else {
          const res = await this.workflowService.handleBotAction(wfMatch![2], wfMatch![1] as 'done' | 'skip', userId);
          resultText = res.text;
        }
      } catch (e: any) {
        resultText = taskMatch ? 'Не удалось выполнить. Откройте задачу в системе.' : 'Не удалось выполнить. Откройте «Доску проектов».';
      }
      await this.telegramService.answerCallbackQuery(cq.id, resultText);
      // Заменяем текст сообщения (с результатом) и убираем кнопки.
      if (cq.message?.chat?.id && cq.message?.message_id) {
        const base = cq.message.text ? `${cq.message.text}\n\n` : '';
        await this.telegramService.editMessageText(cq.message.chat.id, cq.message.message_id, `${base}${resultText}`);
      }
      return { ok: true };
    }

    // ── Привязка аккаунта по /start ───────────────────────────────────────
    const msg = update?.message;
    if (!msg) return { ok: true };

    const chatId = msg.from?.id;
    const rawUsername = msg.from?.username;
    const firstName = msg.from?.first_name || 'пользователь';
    const text = msg.text?.trim() || '';

    if (!chatId || !text.startsWith('/start')) return { ok: true };

    if (!rawUsername) {
      await this.telegramService.sendMessage(
        chatId,
        '❌ У вас не установлен username в Telegram.\n\nУстановите его в настройках Telegram (Настройки → Изменить профиль → Username) и попробуйте снова.',
      );
      return { ok: true };
    }

    const username = rawUsername.toLowerCase().replace('@', '');

    // Ищем сотрудника по telegram-юзернейму (без учёта регистра и наличия @)
    const employee = await this.employeeRepo
      .createQueryBuilder('e')
      .where('LOWER(REPLACE(e.telegram, \'@\', \'\')) = :username', { username })
      .getOne();

    if (!employee) {
      await this.telegramService.sendMessage(
        chatId,
        `👋 Привет, <b>${firstName}</b>!\n\n` +
        `Аккаунт с Telegram @${username} не найден в системе <b>Sabt</b>.\n\n` +
        `Попросите администратора указать ваш Telegram в профиле сотрудника.`,
      );
      return { ok: true };
    }

    // Сохраняем chatId сотрудника
    employee.telegramChatId = String(chatId);
    await this.employeeRepo.save(employee);

    await this.telegramService.sendMessage(
      chatId,
      `✅ <b>Аккаунт привязан!</b>\n\n` +
      `Привет, <b>${employee.fullName}</b>!\n` +
      `Теперь вы будете получать уведомления Sabt System прямо здесь. 🎉`,
    );

    return { ok: true };
  }
}
