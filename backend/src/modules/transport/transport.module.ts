import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransportRequest } from './transport-request.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { TransportService } from './transport.service';
import { TransportController } from './transport.controller';
import { TransportReceiptsController } from './transport-receipts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransportRequest, Project, User]),
    FinanceModule,
    NotificationsModule,
    TelegramModule,
  ],
  providers: [TransportService],
  controllers: [TransportController, TransportReceiptsController],
})
export class TransportModule {}
