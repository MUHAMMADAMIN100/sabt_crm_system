import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('AI Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER)
@Controller('ai')
export class AiAssistantController {
  constructor(private service: AiAssistantService) {}

  @Get('models')
  listModels() {
    return this.service.listModels();
  }

  @Post('chat')
  async chat(@Body() body: { message: string; model?: string }) {
    if (!body.message?.trim()) {
      return { reply: 'Пожалуйста, задайте вопрос.' };
    }
    const reply = await this.service.chat(body.message.trim(), body.model);
    return { reply };
  }
}
