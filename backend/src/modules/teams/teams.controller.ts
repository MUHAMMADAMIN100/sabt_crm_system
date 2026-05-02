import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

const TOP = [UserRole.FOUNDER, UserRole.CO_FOUNDER];
const VIEWERS = [
  UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
  UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM,
];

@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teams')
export class TeamsController {
  constructor(private service: TeamsService) {}

  /** Список команд — может смотреть кто угодно из создающих проекты,
   *  чтобы видеть варианты в дропдауне формы проекта. */
  @Get()
  @Roles(...VIEWERS)
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @Roles(...VIEWERS)
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/members')
  @Roles(...VIEWERS)
  members(@Param('id') id: string) { return this.service.getMembers(id); }

  /** CRUD команд — только основатель/сооснователь. */
  @Post()
  @Roles(...TOP)
  create(@Body() dto: any, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  @Roles(...TOP)
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(...TOP)
  remove(@Param('id') id: string) { return this.service.remove(id); }

  /** Установить состав команды (массово). Заменяет всех. */
  @Patch(':id/members')
  @Roles(...TOP)
  setMembers(@Param('id') id: string, @Body('userIds') userIds: string[]) {
    return this.service.setMembers(id, userIds || []);
  }

  /** Поменять команду одного сотрудника (или отвязать teamId=null). */
  @Patch('user/:userId')
  @Roles(...TOP)
  setUserTeam(@Param('userId') userId: string, @Body('teamId') teamId: string | null) {
    return this.service.setUserTeam(userId, teamId);
  }
}
