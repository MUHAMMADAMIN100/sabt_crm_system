import { Controller, Post, Body, Inject, forwardRef, Headers, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramService } from './telegram.service';
import { VoiceTaskService } from './voice-task.service';
import { BotWorkspaceService } from './bot-workspace.service';
import { Employee } from '../employees/employee.entity';
import { TasksService } from '../tasks/tasks.service';

interface TgMessageRef {
  message_id?: number;
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; url?: string }>;
  reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string; url?: string }>> };
}

interface TelegramUpdate {
  message?: {
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
    /** Голосовое сообщение: команда или вопрос голосовому помощнику. */
    voice?: { file_id: string; duration?: number };
    /** Кружок/аудиофайл — тоже голос. */
    audio?: { file_id: string; duration?: number };
    photo?: Array<{ file_id: string; file_size?: number }>;
    document?: { file_id: string; file_name?: string };
    /** Ответ на сообщение бота: «готово» в ответ на карточку задачи. */
    reply_to_message?: TgMessageRef;
  };
  callback_query?: {
    id: string;
    from?: { id: number };
    data?: string;
    message?: { message_id: number; chat?: { id: number }; text?: string };
  };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Задача, о которой было сообщение бота: по кнопкам карточки или ссылке. */
export function taskIdFromReply(ref?: TgMessageRef): string | null {
  if (!ref) return null;
  for (const row of ref.reply_markup?.inline_keyboard || []) {
    for (const b of row) {
      const m = new RegExp(`^(?:t:(?:done|progress)|w:(?:done|prog|cmt|res)):(${UUID})$`, 'i').exec(b.callback_data || '');
      if (m) return m[1];
      const u = new RegExp(`/tasks/(${UUID})`, 'i').exec(b.url || '');
      if (u) return u[1];
    }
  }
  for (const e of ref.entities || []) {
    const u = new RegExp(`/tasks/(${UUID})`, 'i').exec(e.url || '');
    if (u) return u[1];
  }
  const t = new RegExp(`/tasks/(${UUID})`, 'i').exec(`${ref.text || ''} ${ref.caption || ''}`);
  return t ? t[1] : null;
}

const escHtml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private telegramService: TelegramService,
    private voiceTaskService: VoiceTaskService,
    private botWorkspace: BotWorkspaceService,
    @Inject(forwardRef(() => TasksService)) private tasksService: TasksService,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    if (!this.telegramService.verifyWebhook(secret)) {
      this.logger.warn('telegram webhook: неверная подпись — апдейт отклонён');
      throw new UnauthorizedException();
    }
    // ── Нажатие inline-кнопки («Сделал / Не сделал» на карточке) ──────────
    const cq = update?.callback_query;
    if (cq) {
      const chatId = cq.from?.id;
      const data = cq.data || '';
      // Кнопки голосового помощника: отменить / подтвердить / выбрать.
      const assistant = this.telegramService.assistant;
      if (data.startsWith('va:') && chatId && assistant) {
        const res: { toast: string; append?: string } | null = await assistant.handleCallback(chatId, data).catch((e) => {
          this.logger.error(`va-кнопка: ${e?.message || e}`);
          return { toast: 'Не получилось — попробуйте ещё раз' };
        });
        await this.telegramService.answerCallbackQuery(cq.id, res?.toast || '');
        if (res?.append && cq.message?.chat?.id && cq.message?.message_id) {
          const base = cq.message.text ? `${escHtml(cq.message.text)}\n\n` : '';
          await this.telegramService.editMessageText(cq.message.chat.id, cq.message.message_id, `${base}${res.append}`)
            .catch(() => {});
        }
        return { ok: true };
      }
      // Кнопки рабочего места («Готово», «В работу», «Комментарий»,
      // «Результат») — пишутся теми же сервисами, что и веб-интерфейс.
      if (data.startsWith('w:') && chatId) {
        const answer = await this.botWorkspace.handleCallback(chatId, data).catch(() => null);
        if (answer) {
          await this.telegramService.answerCallbackQuery(cq.id, answer);
          if ((answer === 'Задача закрыта' || answer === 'Взято в работу')
              && cq.message?.chat?.id && cq.message?.message_id) {
            const base = cq.message.text ? `${cq.message.text}\n\n` : '';
            await this.telegramService.editMessageText(
              cq.message.chat.id, cq.message.message_id,
              `${base}${answer === 'Задача закрыта' ? '✅ Закрыто' : '▶️ В работе'}`,
            ).catch(() => {});
          }
          return { ok: true };
        }
      }
      // Подтверждение голосовой задачи (vt:ok|no:<ключ>) — до разбора
      // кнопок доски и задач.
      if (data.startsWith('vt:') && chatId) {
        const text = await this.voiceTaskService.handleCallback(data, chatId);
        if (text) {
          await this.telegramService.answerCallbackQuery(cq.id, text);
          if (cq.message?.chat?.id && cq.message?.message_id) {
            const base = cq.message.text ? `${cq.message.text}\n\n` : '';
            await this.telegramService.editMessageText(
              cq.message.chat.id, cq.message.message_id, `${base}${text}`);
          }
          return { ok: true };
        }
      }
      // Кнопки задач в боте: t:done|progress:<taskId>.
      const taskMatch = data.match(/^t:(done|progress):(.+)$/);
      if (!chatId || !taskMatch) {
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
        const res = await this.tasksService.handleBotAction(taskMatch[2], taskMatch[1] as 'done' | 'progress', userId);
        resultText = res.text;
      } catch (e: any) {
        resultText = 'Не удалось выполнить. Откройте задачу в системе.';
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

    // ── Голосовой помощник ────────────────────────────────────────────────
    // Разбор голосового занимает секунды (распознавание + ИИ). Отвечаем
    // Telegram сразу, а работаем в фоне: иначе он посчитает апдейт
    // недоставленным, пришлёт повторно — и команда выполнится дважды.
    const assistant = this.telegramService.assistant;
    const voice = msg.voice || msg.audio;
    const replyTaskId = taskIdFromReply(msg.reply_to_message);
    if (chatId && voice?.file_id) {
      if (assistant) {
        void assistant.handleVoice(chatId, voice.file_id, voice.duration || 0, { replyTaskId })
          .catch((e) => this.logger.error(`голосовое: ${e?.message || e}`));
      }
      return { ok: true };
    }

    // Фото или документ после кнопки «Результат» — приложение к задаче.
    const fileId = msg.document?.file_id
      || (msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : undefined);
    if (chatId && fileId && this.botWorkspace.isAwaitingFile(chatId)) {
      await this.botWorkspace.handleFile(chatId, fileId, msg.document?.file_name)
        .catch(() => { /* бот не должен падать из-за файла */ });
      return { ok: true };
    }

    // Команды рабочего места.
    if (chatId && text) {
      const cmd = text.trim().toLowerCase().split(/[@\s]/)[0];
      if (cmd === '/tasks' || cmd === '/today') {
        const handled = await this.botWorkspace.sendList(chatId, cmd === '/today').catch(() => false);
        if (handled) return { ok: true };
        await this.telegramService.sendMessage(chatId,
          'Ваш Telegram не привязан к сотруднику. Отправьте /start.');
        return { ok: true };
      }
      if (cmd === '/help') {
        await this.telegramService.sendMessage(chatId, this.botWorkspace.helpText());
        return { ok: true };
      }
    }

    // Комментарий к задаче после кнопки «Комментарий».
    if (chatId && text && !text.startsWith('/')) {
      const handled = await this.botWorkspace.handleText(chatId, text).catch(() => false);
      if (handled) return { ok: true };
    }

    // Обычный текст от сотрудника — та же просьба, что и голосом:
    // «задачу Макет — на готово», «какие задачи у Сабрины?».
    if (chatId && text && !text.startsWith('/') && assistant) {
      const linked = await this.telegramService.resolveUserIdByChat(chatId).catch(() => null);
      if (linked) {
        void assistant.handleText(chatId, text, { replyTaskId })
          .catch((e) => this.logger.error(`текст боту: ${e?.message || e}`));
        return { ok: true };
      }
    }

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
    // Сразу показываем, что бот умеет: иначе о командах никто не узнает.
    await this.telegramService.sendMessage(chatId, this.botWorkspace.helpText()).catch(() => {});

    return { ok: true };
  }
}
