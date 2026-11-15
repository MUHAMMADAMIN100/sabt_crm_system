import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientLead } from '../clients/client-lead.entity';
import { ClientsModule } from '../clients/clients.module';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { GatewayModule } from '../gateway/gateway.module';
import { SalesPlan } from '../smm-control/sales-plan.entity';
import { SmmControlModule } from '../smm-control/smm-control.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SalesAnalyticsService } from './sales-analytics.service';

/**
 * Продажи, этап 2 (15.11.2026): действия менеджера над лидом (звонок,
 * письмо, итог встречи, комментарий), лента событий, «Сегодня», передача
 * в работу, аналитика продаж и настройки (нормы KPI, комиссия).
 * Маршруты — /api/sales/*. Договор API — docs/SALES_SPEC.md.
 *
 * Зависимости без колец: ClientsModule (этап лида и KPI — ClientsService),
 * NotificationsModule (колокольчик), GatewayModule (сокет leads:changed),
 * SmmControlModule (SmmPaymentsService.receivedOf — «получено» в аналитике;
 * сам модуль никого не импортирует). TelegramService — из глобального
 * TelegramModule. Никто из них SalesModule не импортирует.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ClientLead, User, Task, SalesPlan]),
    ClientsModule,
    NotificationsModule,
    GatewayModule,
    SmmControlModule,
  ],
  controllers: [SalesController],
  providers: [SalesService, SalesAnalyticsService],
  exports: [SalesService],
})
export class SalesModule {}
