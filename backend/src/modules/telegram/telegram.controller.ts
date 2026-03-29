import { Controller, Post, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramService } from './telegram.service';
import { Employee } from '../employees/employee.entity';

interface TelegramUpdate {
  message?: {
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
}

@Controller('telegram')
export class TelegramController {
  constructor(
    private telegramService: TelegramService,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {}

  @Post('webhook')
  async handleWebhook(@Body() update: TelegramUpdate) {
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
