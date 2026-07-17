import {
  Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotesService } from './notes.service';

/** Личные заметки («Заметки» сторисмейкера). Любой авторизованный работает
 *  ТОЛЬКО со своими заметками — userId всегда из JWT, поэтому приватность
 *  гарантирована на уровне каждой выборки. */
@Controller('my-notes')
@UseGuards(AuthGuard('jwt'))
export class NotesController {
  constructor(private service: NotesService) {}

  @Get()
  list(@Request() req) {
    return this.service.list(req.user.id);
  }

  @Post()
  create(@Body() dto: any, @Request() req) {
    return this.service.create(req.user.id, dto || {});
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any, @Request() req) {
    return this.service.update(id, req.user.id, dto || {});
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id);
  }
}
