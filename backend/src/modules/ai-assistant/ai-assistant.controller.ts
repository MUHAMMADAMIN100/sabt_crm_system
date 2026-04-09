import { Controller, Post, Body, UseGuards } from '@nestjs/common';
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

  @Post('chat')
  async chat(@Body('message') message: string) {
    if (!message?.trim()) {
      return { reply: 'Пожалуйста, задайте вопрос.' };
    }
    const reply = await this.service.chat(message.trim());
    return { reply };
  }
}
