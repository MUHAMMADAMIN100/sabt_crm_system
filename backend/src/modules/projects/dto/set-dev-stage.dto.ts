import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Смена этапа разработки на доске «Разработка»: 1..6
 *  ([10%] ТЗ, [25%] Концепт, [50%] Производство, [75%] QA,
 *   [90%] Согласование, [100%] Внедрение). */
export class SetDevStageDto {
  @ApiProperty({ minimum: 1, maximum: 6 })
  @Type(() => Number) @IsInt() @Min(1) @Max(6)
  devStage: number;
}
