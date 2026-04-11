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

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  findAll(@Query('role') role?: UserRole) {
    return this.usersService.findAll(role);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  update(@Param('id') id: string, @Body() dto: Partial<{ name: string; email: string; role: UserRole; isActive: boolean }>) {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  toggleActive(@Param('id') id: string) {
    return this.usersService.toggleActive(id);
  }

  @Patch(':id/block')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  async block(@Param('id') id: string, @Body() body: { reason?: string }, @Request() req) {
    try {
      return await this.usersService.block(id, req.user, body?.reason);
    } catch (e: any) {
      throw new BadRequestException(e.message || 'Не удалось заблокировать пользователя');
    }
  }

  @Patch(':id/unblock')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  unblock(@Param('id') id: string, @Request() req) {
    return this.usersService.unblock(id, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post('cleanup-orphans')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  cleanupOrphanedUsers() {
    return this.usersService.cleanupOrphanedUsers();
  }

  @Patch('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (req, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
      }),
    }),
  )
  updateAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.updateAvatar(req.user.id, file.filename);
  }
}
