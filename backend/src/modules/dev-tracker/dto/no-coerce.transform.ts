import { Type } from 'class-transformer';

/**
 * Отключает глобальную implicit conversion ТОЛЬКО для этого поля.
 * Контекст: в main.ts ValidationPipe работает с
 * `transformOptions: { enableImplicitConversion: true }`, поэтому объект
 * `{"title":{}}` тихо превращается в строку `'[object Object]'`, а строка
 * `'not-bool'` — в `true` ЕЩЁ ДО class-validator и ДО кастомных @Transform
 * (implicit идёт первым в TransformOperationExecutor) — проверки типов
 * в сервисе их уже не видят (QA-fuzz: stored junk через title/comments,
 * клон по `withSubtasks='x'`).
 * Явный @Type имеет приоритет над implicit (ветка findTypeMetadata выше
 * enableImplicitConversion в исходнике class-transformer): тип Object
 * оставляет значение как есть, и @IsString/@IsBoolean честно отвечают 400.
 * null/undefined пропускаем как есть (их добирает @IsOptional).
 * Числа/даты/enum/UUID не трогаем — там коэрсия безвредна или нужна.
 */
export function NoCoerce() {
  return Type(() => Object);
}
