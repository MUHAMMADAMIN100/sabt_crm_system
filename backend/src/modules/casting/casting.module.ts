import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../clients/clients.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { CastingBooking, CastingPhoto, CastingRequest, CastingTalent } from './casting.entity';
import { CastingController, PublicCastingController } from './casting.controller';
import { CastingService } from './casting.service';

/**
 * Кастинг WeBrand (17.11.2026, docs/CASTING_SPEC.md): база людей для
 * съёмок, импорт, участие в съёмках и публичный каталог. Заявка с каталога
 * заводит лид через ClientsService (общий путь создания лида). Строку
 * «Актёры: …» в сообщения о съёмках добавляет ProducerService сам — запросом
 * к casting_bookings, без зависимости от этого модуля.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CastingTalent, CastingPhoto, CastingBooking, CastingRequest]),
    ClientsModule,
    NotificationsModule,
    TelegramModule,
  ],
  controllers: [CastingController, PublicCastingController],
  providers: [CastingService],
  exports: [CastingService],
})
export class CastingModule {}
