import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from './user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { RegisterFcmDto } from './dto/register-fcm.dto';
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

/** Кому доступны персональные обои интерфейса. По требованию владельца —
 *  проект-менеджер разработки и менеджер продаж по разработке; основатель и
 *  сооснователь добавлены, чтобы настройку можно было увидеть у себя. */
const BACKGROUND_ROLES = [
  UserRole.PM_DEV, UserRole.SALES_MANAGER_DEV, UserRole.FOUNDER, UserRole.CO_FOUNDER,
] as const;

/** Обои: файл идёт В ПАМЯТЬ и уезжает в БД. На диск класть нельзя — он на
 *  Railway эфемерный, фон слетал бы при каждом редеплое. 4 МБ на входе:
 *  фронт сжимает картинку до ~300 КБ, запас на несжатый PNG со смартфона. */
const BACKGROUND_MULTER_CONFIG = {
  storage: memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    // SVG запрещён намеренно: это XML, внутри может быть <script> — а мы
    // отдаём картинку обратно как data URI.
    if (!AVATAR_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new BadRequestException(`Фон: тип ${file.mimetype} запрещён. Только JPG/PNG/WEBP.`), false);
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
  /** Каталог выдаваемых возможностей (ключ → подпись) — для UI.
   *  roles отдаём тоже: по ним интерфейс отмечает возможности, которые у
   *  сотрудника уже есть НАТИВНО по роли. Без этого у основателя (у которого
   *  есть всё) матрица выглядела пустой — ни одной галочки. */
  @Get('access/catalog')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  accessCatalog() {
    return Object.entries(GRANTABLE).map(([key, def]) => ({
      key, label: def.label, category: def.category, roles: def.roles,
      danger: !!def.danger,
    }));
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
  setAccess(
    @Param('id') id: string,
    @Body() body: { permissions?: string[]; denied?: string[] },
    @Request() req,
  ) {
    return this.usersService.setAccess(id, body?.permissions || [], req.user, body?.denied || []);
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

  /** FCM-токены мобильного приложения: регистрация при входе, удаление при
   *  выходе. Доступно любому авторизованному — каждый регистрирует своё
   *  устройство. Спецификация согласована с мобильным разработчиком. */
  @Post('register-fcm')
  registerFcm(@Request() req, @Body() dto: RegisterFcmDto) {
    return this.usersService.registerFcmToken(req.user.id, dto.token);
  }

  @Post('unregister-fcm')
  unregisterFcm(@Request() req, @Body() dto: RegisterFcmDto) {
    return this.usersService.unregisterFcmToken(req.user.id, dto.token);
  }

  @Patch('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', AVATAR_MULTER_CONFIG))
  updateAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');
    // Self-edit — actor.id совпадает с целевым id, assertCanManage skip'нется.
    return this.usersService.updateAvatar(req.user.id, file.filename, { id: req.user.id, role: req.user.role });
  }

  // ─── Персональные обои интерфейса ────────────────────────────────────
  // Настройка своя у каждого и никого больше не касается, поэтому все три
  // ручки работают только со «своим» пользователем (req.user.id) — чужой
  // фон не прочитать и не переписать даже основателю.

  /** Свои обои. Отдаём отдельной ручкой, а не в /auth/me: картинка весит
   *  сотни килобайт, а /auth/me дёргается при каждом F5 и в интерцепторах. */
  @Get('me/background')
  getMyBackground(@Request() req) {
    return this.usersService.getBackground(req.user.id);
  }

  /** Загрузка обоев. Файл идёт в память и сохраняется в БД как data URI —
   *  на диск класть нельзя, он на Railway эфемерный. */
  @Patch('me/background')
  @Roles(...BACKGROUND_ROLES)
  @UseInterceptors(FileInterceptor('background', BACKGROUND_MULTER_CONFIG))
  setMyBackground(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { dim?: string; scale?: string; ratio?: string },
  ) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return this.usersService.setBackground(
      req.user.id, file, body?.dim, body?.scale, body?.ratio,
    );
  }

  /** Затемнение и масштаб — двигаются ползунками, картинку заново не гоняем. */
  @Patch('me/background/view')
  @Roles(...BACKGROUND_ROLES)
  setMyBackgroundView(@Request() req, @Body() body: { dim?: number; scale?: number }) {
    return this.usersService.setBackgroundView(req.user.id, body?.dim, body?.scale);
  }

  /** Старый путь только для затемнения. Оставлен, чтобы вкладка, открытая до
   *  деплоя фронта, не получала 404, пока Vercel и Railway обновляются
   *  независимо друг от друга. */
  @Patch('me/background/dim')
  @Roles(...BACKGROUND_ROLES)
  setMyBackgroundDim(@Request() req, @Body() body: { dim?: number }) {
    return this.usersService.setBackgroundView(req.user.id, body?.dim, undefined);
  }

  @Delete('me/background')
  @Roles(...BACKGROUND_ROLES)
  clearMyBackground(@Request() req) {
    return this.usersService.clearBackground(req.user.id);
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
