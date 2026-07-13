import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { OrganizerDirectoryService } from './organizer-directory.service';

const KINDS = ['clients', 'models', 'places'] as const;

/** Справочники организатора съёмок (клиенты/модели/места).
 *  Доступ — грант organizer.directory: нативно organizer, smm_director и топ;
 *  остальным можно выдать через «Доступы сотрудников». RequirePerm стоит на
 *  КАЖДОМ обработчике: классовые метаданные гварды не читают. */
@ApiTags('Organizer Directory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('organizer-directory')
export class OrganizerDirectoryController {
  constructor(private service: OrganizerDirectoryService) {}

  @Get(':kind')
  @RequirePerm('organizer.directory')
  list(@Param('kind') kind: (typeof KINDS)[number], @Query('search') search?: string) {
    return this.service.list(kind, search);
  }

  @Post(':kind')
  @RequirePerm('organizer.directory')
  create(@Param('kind') kind: (typeof KINDS)[number], @Body() dto: any) {
    return this.service.create(kind, dto);
  }

  @Patch(':kind/:id')
  @RequirePerm('organizer.directory')
  update(@Param('kind') kind: (typeof KINDS)[number], @Param('id') id: string, @Body() dto: any) {
    return this.service.update(kind, id, dto);
  }

  @Delete(':kind/:id')
  @RequirePerm('organizer.directory')
  remove(@Param('kind') kind: (typeof KINDS)[number], @Param('id') id: string) {
    return this.service.remove(kind, id);
  }
}
