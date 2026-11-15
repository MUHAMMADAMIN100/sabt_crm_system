import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { AiChatDto } from './ai-assistant.dto';

// Право «ИИ-помощник» (ai.chat) проверяется и на сервере (15.11.2026):
// раньше хватало входа в систему — пункт меню прятался только на фронте.
@ApiTags('AI Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai')
export class AiAssistantController {
  constructor(private service: AiAssistantService) {}

  @Get('models')
  @RequirePerm('ai.chat')
  listModels() {
    return this.service.listModels();
  }

  @Post('chat')
  @RequirePerm('ai.chat')
  async chat(@Body() body: AiChatDto, @Request() req: any) {
    if (!body.message?.trim()) {
      return { reply: 'Пожалуйста, задайте вопрос.' };
    }
    // Контекст ИИ формируется в сервисе с учётом роли — admin/founder видят всё,
    // остальные — только свои проекты/задачи/отчёты.
    const reply = await this.service.chat(
      body.message.trim(),
      { id: req.user.id, role: req.user.role },
      body.model,
    );
    return { reply };
  }
}
