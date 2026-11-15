import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Длина вопроса ИИ-помощнику (15.11.2026): без предела любой сотрудник
 *  мог отправить мегабайты текста — это и деньги за токены, и нагрузка. */
export const AI_MESSAGE_MAX = 4000;

export class AiChatDto {
  @IsString()
  @MaxLength(AI_MESSAGE_MAX, { message: `Слишком длинный вопрос — не больше ${AI_MESSAGE_MAX} символов` })
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
