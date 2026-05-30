import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityEvent } from './security-event.entity';
import { SecurityAuditService } from './security-audit.service';

/** Отдельный модуль для журнала безопасности — чтобы не создавать
 *  циклическую зависимость через AuthModule. Global — иначе RolesGuard
 *  не сможет получить SecurityAuditService через DI в каждом модуле. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SecurityEvent])],
  providers: [SecurityAuditService],
  exports: [SecurityAuditService],
})
export class SecurityAuditModule {}
