import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { IsArray, IsOptional, IsUUID, ArrayMaxSize } from 'class-validator';

class SetMembersDto {
  @IsArray() @IsUUID('all', { each: true }) @ArrayMaxSize(500)
  userIds: string[];
}

class SetUserTeamDto {
  @IsOptional() @IsUUID()
  teamId?: string | null;
}
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

const TOP = [UserRole.FOUNDER, UserRole.CO_FOUNDER];
const VIEWERS = [
  UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
  UserRole.VIDEO_DIRECTOR,
];

@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('teams')
export class TeamsController {
  constructor(private service: TeamsService) {}

  /** Список команд — может смотреть кто угодно из создающих проекты,
   *  чтобы видеть варианты в дропдауне формы проекта. */
  @Get()
  @RequirePerm('teams.view')
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @RequirePerm('teams.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Get(':id/members')
  @RequirePerm('teams.view')
  members(@Param('id') id: string) { return this.service.getMembers(id); }

  /** CRUD команд — только основатель/сооснователь. */
  @Post()
  @RequirePerm('teams.manage')
  create(@Body() dto: CreateTeamDto, @Request() req) {
    return this.service.create(dto as any, req.user.id);
  }

  @Patch(':id')
  @RequirePerm('teams.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @RequirePerm('teams.manage')
  remove(@Param('id') id: string) { return this.service.remove(id); }

  /** Установить состав команды (массово). Заменяет всех. */
  @Patch(':id/members')
  @RequirePerm('teams.manage')
  setMembers(@Param('id') id: string, @Body() body: SetMembersDto) {
    return this.service.setMembers(id, body.userIds || []);
  }

  /** Поменять команду одного сотрудника (или отвязать teamId=null). */
  @Patch('user/:userId')
  @RequirePerm('teams.manage')
  setUserTeam(@Param('userId') userId: string, @Body() body: SetUserTeamDto) {
    return this.service.setUserTeam(userId, body.teamId ?? null);
  }
}
