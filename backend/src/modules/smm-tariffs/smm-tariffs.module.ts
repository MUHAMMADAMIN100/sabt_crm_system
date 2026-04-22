import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmmTariff } from './smm-tariff.entity';
import { SmmTariffsService } from './smm-tariffs.service';
import { SmmTariffsController } from './smm-tariffs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SmmTariff])],
  controllers: [SmmTariffsController],
  providers: [SmmTariffsService],
  exports: [SmmTariffsService],
})
export class SmmTariffsModule {}
