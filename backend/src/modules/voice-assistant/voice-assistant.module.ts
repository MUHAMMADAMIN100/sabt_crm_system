import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { VoiceAssistantService } from './voice-assistant.service';

/**
 * Голосовой помощник Telegram-бота. TelegramModule глобальный, поэтому
 * TelegramService сюда приходит без импорта; обратно помощник
 * регистрируется в нём сам (registerAssistant) — без круга модулей.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  providers: [VoiceAssistantService],
  exports: [VoiceAssistantService],
})
export class VoiceAssistantModule {}
