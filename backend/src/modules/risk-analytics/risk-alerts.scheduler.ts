import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RiskAlertsService } from './risk-alerts.service';

/** Wave 6: ежедневный прогон риск-алертов.
 *  Запускается рано утром в Душанбе (4:00 UTC = 9:00 Asia/Dushanbe),
 *  чтобы алерты приходили к началу рабочего дня. */
@Injectable()
export class RiskAlertsScheduler {
  private readonly logger = new Logger(RiskAlertsScheduler.name);

  constructor(private readonly alerts: RiskAlertsService) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Dushanbe' })
  async dailyRun() {
    this.logger.log('Running daily risk alerts sweep');
    try {
      await this.alerts.runAll();
      this.logger.log('Risk alerts sweep finished');
    } catch (e: any) {
      this.logger.error(`Risk alerts sweep failed: ${e?.message}`);
    }
  }
}
