import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from './user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { GRANTABLE } from '../auth/permissions';

/** Безопасный конфиг для загрузки аватарок: только PNG/JPEG/WEBP,
 *  максимум 2MB. Никаких SVG (XSS) и тем более .html/.exe. */
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const AVATAR_MULTER_CONFIG = {
  storage: diskStorage({
    destination: './uploads/avatars',
    filename: (_req: any, file: Express.Multer.File, cb: any) => {
      const ext = extname(file.originalname).toLowerCase().slice(0, 8);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2MB max
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!AVATAR_ALLOWED_EXT.has(ext)) {
      return cb(new BadRequestException(`Аватар: расширение ${ext} запрещено. Только JPG/PNG/WEBP.`), false);
    }
    if (!AVATAR_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new BadRequestException(`Аватар: тип ${file.mimetype} запрещён.`), false);
    }
    cb(null, true);
  },
};

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  findAll(@Query('role') role?: UserRole) {
    return this.usersService.findAll(role);
  }

  // ─── Доступы сотрудников (персональные гранты) ────────────────────────
  /** Каталог выдаваемых возможностей (ключ → подпись) — для UI. */
  @Get('access/catalog')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  accessCatalog() {
    return Object.entries(GRANTABLE).map(([key, def]) => ({ key, label: def.label }));
  }

  /** Список сотрудников с их ролью и персональными доступами. */
  @Get('access')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  listAccess() {
    return this.usersService.listAccess();
  }

  /** Выдать/снять персональные доступы сотруднику. */
  @Patch(':id/access')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  setAccess(@Param('id') id: string, @Body() body: { permissions?: string[] }, @Request() req) {
    return this.usersService.setAccess(id, body?.permissions || [], req.user?.role);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req) {
    return this.usersService.update(id, dto, req.user?.role);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  toggleActive(@Param('id') id: string, @Request() req) {
    return this.usersService.toggleActive(id, req.user?.role, req.user?.id);
  }

  @Patch(':id/block')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  async block(@Param('id') id: string, @Body() body: BlockUserDto, @Request() req) {
    try {
      return await this.usersService.block(id, req.user, body?.reason);
    } catch (e: any) {
      throw new BadRequestException(e.message || 'Не удалось заблокировать пользователя');
    }
  }

  @Patch(':id/reset-password')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  async resetPassword(@Param('id') id: string, @Body() body: ResetUserPasswordDto, @Request() req) {
    try {
      return await this.usersService.resetPassword(id, req.user, body?.newPassword);
    } catch (e: any) {
      throw new BadRequestException(e.message || 'Не удалось сбросить пароль');
    }
  }

  @Patch(':id/unblock')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  unblock(@Param('id') id: string, @Request() req) {
    return this.usersService.unblock(id, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  remove(@Param('id') id: string, @Request() req) {
    return this.usersService.remove(id, req.user?.role, req.user?.id);
  }

  @Post('cleanup-orphans')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  cleanupOrphanedUsers() {
    return this.usersService.cleanupOrphanedUsers();
  }

  @Patch('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', AVATAR_MULTER_CONFIG))
  updateAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');
    // Self-edit — actor.id совпадает с целевым id, assertCanManage skip'нется.
    return this.usersService.updateAvatar(req.user.id, file.filename, { id: req.user.id, role: req.user.role });
  }

  /** Админ/основатель/сооснователь меняет аватар любого сотрудника.
   *  Внутри updateAvatar() сработает assertCanManage(target, actor.role) —
   *  не даст admin'у трогать founder/co_founder. */
  @Patch(':id/avatar')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  @UseInterceptors(FileInterceptor('avatar', AVATAR_MULTER_CONFIG))
  updateAvatarFor(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return this.usersService.updateAvatar(id, file.filename, { id: req.user.id, role: req.user.role });
  }
}
