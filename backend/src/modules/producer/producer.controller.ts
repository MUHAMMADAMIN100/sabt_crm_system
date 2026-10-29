import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { ProducerService } from './producer.service';

@ApiTags('Producer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('producer')
export class ProducerController {
  constructor(private service: ProducerService) {}

  /** Панель продюсера: съёмки SMM-проектов за период — только посмотреть. */
  @Get('shoots')
  @Roles(UserRole.PRODUCER, UserRole.ADMIN, UserRole.FOUNDER)
  shoots(@Query('from') from: string, @Query('to') to: string) {
    return this.service.shootsForPanel(from, to);
  }
}

/** Сценарий съёмки по ссылке из Telegram — без входа. Ссылка подписана
 *  сервером (подобрать нельзя) и живёт, пока рилс не вышел. */
@ApiTags('Public Script')
@Controller('public/script')
export class PublicScriptController {
  constructor(private service: ProducerService) {}

  @Get(':token')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  get(@Param('token') token: string) {
    return this.service.publicScript(token);
  }
}
