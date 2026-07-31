import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './employee.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Сегодняшняя дата по Душанбе, а не по таймзоне процесса — иначе на
 *  Railway (UTC) день рождения сдвигался бы на сутки. Формат YYYY-MM-DD. */
function todayInDushanbe(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

/** Полных лет на сегодня — для поздравления («вам исполняется 27»). */
function ageToday(birth: Date, year: number): number | null {
  const y = year - birth.getFullYear();
  if (!Number.isFinite(y) || y <= 0 || y > 120) return null;
  return y;
}

/**
 * Утреннее напоминание о днях рождения: команда узнаёт, кого сегодня
 * поздравить, а именинник получает поздравление от компании.
 *
 * Сравниваем ДЕНЬ и МЕСЯЦ (год рождения не важен), поэтому работает
 * и для 29 февраля в невисокосный год — такие поздравляем 28-го.
 */
@Injectable()
export class BirthdayScheduler {
  private readonly logger = new Logger(BirthdayScheduler.name);

  constructor(
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyBirthdays() {
    try {
      await this.run();
    } catch (e: any) {
      this.logger.warn(`birthday reminder failed: ${e?.message || e}`);
    }
  }

  /** public — чтобы можно было дёрнуть вручную и проверить, не дожидаясь 9 утра. */
  async run(): Promise<{ count: number; names: string[] }> {
    const iso = todayInDushanbe();
    const [year, m, d] = iso.split('-').map(Number);
    // 29 февраля в невисокосный год поздравляем 28-го — иначе такие
    // сотрудники не получали бы поздравления три года из четырёх.
    const isFeb28NonLeap = m === 2 && d === 28
      && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));

    const rows: Employee[] = await this.empRepo.createQueryBuilder('e')
      .leftJoinAndSelect('e.user', 'u')
      .where('e."birthDate" IS NOT NULL')
      .andWhere(
        isFeb28NonLeap
          ? `((EXTRACT(DAY FROM e."birthDate") = :d AND EXTRACT(MONTH FROM e."birthDate") = :m)
              OR (EXTRACT(DAY FROM e."birthDate") = 29 AND EXTRACT(MONTH FROM e."birthDate") = 2))`
          : `(EXTRACT(DAY FROM e."birthDate") = :d AND EXTRACT(MONTH FROM e."birthDate") = :m)`,
        { d, m },
      )
      .getMany();

    const celebrants = rows.filter(e => (e.status || 'active') === 'active');
    if (celebrants.length === 0) return { count: 0, names: [] };

    // Кому рассылаем: всем активным сотрудникам — поздравляет команда.
    const team = await this.userRepo.find({ where: { isActive: true, isBlocked: false } });
    const telegramQueue: Array<[string, string]> = [];

    for (const emp of celebrants) {
      const name = emp.fullName || emp.user?.name || 'Сотрудник';
      const age = emp.birthDate ? ageToday(new Date(emp.birthDate), year) : null;

      for (const u of team) {
        const isSelf = !!emp.userId && emp.userId === u.id;
        const title = isSelf ? '🎂 С днём рождения!' : '🎂 Сегодня день рождения';
        // Возраст — только в личном поздравлении: команде для поздравления
        // достаточно имени, а сколько человеку лет — его дело.
        const message = isSelf
          ? `Команда Sabt поздравляет вас с днём рождения${age ? ` — вам исполняется ${age}` : ''}!`
          : `Сегодня день рождения у ${name}${emp.position ? ` (${emp.position})` : ''}. Не забудьте поздравить!`;
        // Дедуп по сотруднику и дате: рестарт приложения рядом с 9:00 или
        // ручной прогон не должны слать поздравление дважды.
        const fresh = await this.notifications.createIfNotRecent({
          userId: u.id,
          type: NotificationType.BIRTHDAY,
          title,
          message,
          data: { alertKey: `birthday:${emp.id}:${iso}` },
        }, 20).catch(() => false);
        if (fresh) telegramQueue.push([u.id, `<b>${title}</b>\n${esc(message)}`]);
      }
    }

    // Telegram — пачками: у API лимит ~30 сообщений в секунду, а получателей
    // может быть под сотню, и все они уходили бы одним залпом.
    for (let i = 0; i < telegramQueue.length; i += 20) {
      const chunk = telegramQueue.slice(i, i + 20);
      await Promise.all(chunk.map(([uid, text]) =>
        this.telegram.sendToUser(uid, text).catch(() => { /* не критично */ })));
      if (i + 20 < telegramQueue.length) await new Promise(r => setTimeout(r, 1000));
    }

    const names = celebrants.map(e => e.fullName);
    this.logger.log(`birthday reminder sent: ${names.join(', ')} → ${team.length} сотрудникам`);
    return { count: celebrants.length, names };
  }
}
