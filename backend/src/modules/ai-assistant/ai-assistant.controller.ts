import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('AI Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiAssistantController {
  constructor(private service: AiAssistantService) {}

  @Get('models')
  listModels() {
    return this.service.listModels();
  }

  @Post('chat')
  async chat(@Body() body: { message: string; model?: string }, @Request() req: any) {
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
