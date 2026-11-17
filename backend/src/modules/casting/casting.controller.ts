import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Request, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { CastingService } from './casting.service';
import { IMPORT_MULTER, MAX_IMPORT_PHOTOS, MAX_PHOTOS_PER_UPLOAD, PHOTO_MULTER } from './casting-upload';
import {
  AddBookingDto, CreateTalentDto, PhotoOrderDto, PublicBookDto, UpdateBookingDto, UpdateTalentDto,
} from './dto/casting.dto';

/**
 * Кастинг в CRM (17.11.2026, docs/CASTING_SPEC.md §3). Кто что видит и
 * правит — проверяет сервис (casting-access.ts). Загрузки дополнительно
 * закрыты ролями ДО приёма файлов: чужой запрос не оставит файлов на диске.
 */
@ApiTags('Casting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('casting')
export class CastingController {
  constructor(private service: CastingService) {}

  /** ?search=&category=&tags=ads,film&kids=1&archived=1 */
  @Get('talents')
  list(
    @Query('search') search: string,
    @Query('category') category: string,
    @Query('tags') tags: string,
    @Query('kids') kids: string,
    @Query('archived') archived: string,
    @Request() req: any,
  ) {
    return this.service.list(req.user, { search, category, tags, kids, archived });
  }

  @Get('talents/:id')
  detail(@Param('id') id: string, @Request() req: any) {
    return this.service.detail(req.user, id);
  }

  @Post('talents')
  create(@Body() dto: CreateTalentDto, @Request() req: any) {
    return this.service.create(req.user, dto);
  }

  @Patch('talents/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTalentDto, @Request() req: any) {
    return this.service.update(req.user, id, dto);
  }

  /** multipart: files — до 10 фото JPG/PNG/WEBP ≤ 8 МБ. */
  @Post('talents/:id/photos')
  @Roles(UserRole.FOUNDER, UserRole.ADMIN, UserRole.SMM_DIRECTOR, UserRole.PRODUCER)
  @UseInterceptors(FilesInterceptor('files', MAX_PHOTOS_PER_UPLOAD, PHOTO_MULTER))
  addPhotos(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @Request() req: any) {
    return this.service.addPhotos(req.user, id, files);
  }

  /** { ids: [photoId, …] } — новый порядок. */
  @Patch('talents/:id/photos/order')
  reorderPhotos(@Param('id') id: string, @Body() dto: PhotoOrderDto, @Request() req: any) {
    return this.service.reorderPhotos(req.user, id, dto.ids);
  }

  @Delete('photos/:photoId')
  deletePhoto(@Param('photoId') photoId: string, @Request() req: any) {
    return this.service.deletePhoto(req.user, photoId);
  }

  /** multipart: data — data.json, files — фото (до 150). */
  @Post('import')
  @Roles(UserRole.FOUNDER, UserRole.ADMIN, UserRole.SMM_DIRECTOR)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'data', maxCount: 1 }, { name: 'files', maxCount: MAX_IMPORT_PHOTOS }], IMPORT_MULTER))
  importData(
    @UploadedFiles() uploaded: { data?: Express.Multer.File[]; files?: Express.Multer.File[] },
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.service.importData(req.user, uploaded?.data?.[0], body?.data, uploaded?.files || []);
  }

  /** Люди в съёмке: contentItemId — карточка съёмки (как ShootRow.id у продюсера). */
  @Get('shoots/:contentItemId')
  shoot(@Param('contentItemId') contentItemId: string, @Request() req: any) {
    return this.service.shootList(req.user, contentItemId);
  }

  @Post('shoots/:contentItemId')
  addToShoot(@Param('contentItemId') contentItemId: string, @Body() dto: AddBookingDto, @Request() req: any) {
    return this.service.addToShoot(req.user, contentItemId, dto);
  }

  @Patch('bookings/:id')
  updateBooking(@Param('id') id: string, @Body() dto: UpdateBookingDto, @Request() req: any) {
    return this.service.updateBooking(req.user, id, dto);
  }

  @Delete('bookings/:id')
  removeBooking(@Param('id') id: string, @Request() req: any) {
    return this.service.removeBooking(req.user, id);
  }
}

/**
 * Публичный каталог для клиентов (§4) — без входа. Отдаёт только тех, кого
 * разрешили показывать, и без внутренних полей (телефон, Telegram, гонорар,
 * заметки). «Забронировать» — 5 заявок в минуту с адреса.
 */
@ApiTags('Public Casting')
@Controller('public/casting')
export class PublicCastingController {
  constructor(private service: CastingService) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  catalog() {
    return this.service.publicCatalog();
  }

  @Post('book')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  book(@Body() dto: PublicBookDto) {
    return this.service.publicBook(dto as any);
  }
}
