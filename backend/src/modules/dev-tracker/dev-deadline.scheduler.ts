import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not } from 'typeorm';
import { DevTask, DevTaskStatus } from './dev-task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

/** Напоминания о дедлайнах на доске разработки. Раз в день в 09:00:
 *  - «дедлайн сегодня» и «дедлайн завтра» — исполнителю;
 *  - просроченные (дедлайн уже прошёл, задача не в DONE) — исполнителю,
 *    раз в сутки на задачу.
 *
 *  Дедупликация через createIfNotRecent (alertKey) — иначе каждый день
 *  приходила бы одна и та же просрочка. */
@Injectable()
export class DevDeadlineScheduler {
  private readonly logger = new Logger(DevDeadlineScheduler.name);

  constructor(
    @InjectRepository(DevTask)
    private readonly taskRepo: Repository<DevTask>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Dushanbe' })
  async remindDeadlines() {
    try {
      const now = new Date();
      // Границы «сегодня/завтра» — по Душанбе, как в production-digest.service.ts:30.
      // Asia/Dushanbe = UTC+5 круглый год (без DST), поэтому полночь Душанбе
      // выражаем явным офсетом +05:00 для корректного сравнения instant'ов.
      const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(now);
      const todayStart = new Date(`${dayKey}T00:00:00+05:00`);
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      const tomorrowEnd = new Date(todayStart.getTime() + 2 * 24 * 60 * 60 * 1000 - 1);

      // Один запрос: всё незавершённое с исполнителем и дедлайном раньше
      // конца завтрашнего дня (сюда попадают и просрочки, и «сегодня»,
      // и «завтра»). Классифицируем по дате в JS — объём доски небольшой.
      const tasks = await this.taskRepo.find({
        where: {
          status: Not(DevTaskStatus.DONE),
          deadline: LessThan(tomorrowEnd),
        },
      });

      let sent = 0;
      for (const task of tasks) {
        if (!task.assigneeId || !task.deadline) continue;
        const d = new Date(task.deadline);

        let type: NotificationType | null = null;
        let title = '';
        if (d < todayStart) {
          type = NotificationType.TASK_OVERDUE;
          title = 'Просрочена задача';
        } else if (d <= todayEnd) {
          type = NotificationType.DEADLINE_APPROACHING;
          title = 'Дедлайн сегодня';
        } else {
          type = NotificationType.DEADLINE_TOMORROW;
          title = 'Дедлайн завтра';
        }

        const created = await this.notifications.createIfNotRecent(
          {
            userId: task.assigneeId,
            type,
            title,
            message: `Доска разработки: «${task.title}»`,
            link: `/dev-board/task/${task.id}`,
            data: { alertKey: `dev-${type}-${task.id}-${dayKey}` },
          },
          20,
        );
        if (created) sent++;
      }

      this.logger.log(`Dev-tracker: напоминаний о дедлайнах отправлено: ${sent}`);
    } catch (e: any) {
      this.logger.warn(`Dev-tracker: напоминания не отправились: ${e?.message || e}`);
    }
  }
}
