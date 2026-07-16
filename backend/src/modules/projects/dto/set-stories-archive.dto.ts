import { IsBoolean } from 'class-validator';

/** Архив историй: true — скрыть проект из кабинета сторисмейкера,
 *  false — вернуть. */
export class SetStoriesArchiveDto {
  @IsBoolean()
  archived: boolean;
}
