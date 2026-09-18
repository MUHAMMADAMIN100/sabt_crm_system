import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { WorkShift } from './work-shift.entity';
import { User, UserRole } from '../users/user.entity';

/** Час, позже которого начало смены считается опозданием (по Душанбе). */
const LATE_AFTER_HOUR = 10;
const TZ = 'Asia/Dushanbe';

/** Дата в календаре Душанбе: 'YYYY-MM-DD'. Считать по часовому поясу сервера
 *  нельзя — он в UTC, и смена, начатая в 02:00 по Душанбе, уехала бы во
 *  вчерашний день. */
const dushanbeDate = (d: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/** Время 'HH:MM' по Душанбе. */
const dushanbeTime = (d: Date) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);

@Injectable()
export class WorkShiftsService {
  private readonly logger = new Logger(WorkShiftsService.name);

  constructor(
    @InjectRepository(WorkShift) private repo: Repository<WorkShift>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /** Моя смена: идёт, на паузе или не начата, и сколько наработано сегодня.
   *  Пауза — это закрытый отрезок с причиной pause: день не закончен,
   *  человек вернётся и продолжит. */
  async my(employeeId: string) {
    const open = await this.repo.findOne({ where: { employeeId, endedAt: IsNull() } });
    const today = dushanbeDate();
    const rows = await this.repo.find({ where: { employeeId, date: today } });
    const todayMs = rows.reduce((sum, s) => sum + this.durationMs(s), 0);
    const last = rows
      .filter(r => r.endedAt)
      .sort((a, b) => new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime())[0];
    const state: 'working' | 'paused' | 'idle' =
      open ? 'working' : last?.endReason === 'pause' ? 'paused' : 'idle';
    // closedMinutes — только закрытые отрезки. Идущий отрезок фронт досчитывает
    // сам от startedAt, иначе счётчик стоял бы до следующего запроса, а если
    // прибавлять к todayMinutes — время удваивалось бы.
    const closedMs = rows.filter(r => r.endedAt).reduce((sum, r) => sum + this.durationMs(r), 0);
    return {
      state,
      open: open ? { id: open.id, startedAt: open.startedAt, startedLabel: dushanbeTime(open.startedAt) } : null,
      pausedSince: state === 'paused' && last?.endedAt ? dushanbeTime(new Date(last.endedAt)) : null,
      todayMinutes: Math.round(todayMs / 60000),
      closedMinutes: Math.round(closedMs / 60000),
      shiftsToday: rows.length,
    };
  }

  async start(employeeId: string) {
    const open = await this.repo.findOne({ where: { employeeId, endedAt: IsNull() } });
    if (open) return this.my(employeeId);          // уже начата — просто отдаём состояние
    const now = new Date();
    await this.repo.save(this.repo.create({
      employeeId, startedAt: now, endedAt: null, date: dushanbeDate(now),
    }));
    return this.my(employeeId);
  }

  /** Завершить день или уйти на паузу. Механика одна — закрываем отрезок,
   *  различает их только причина: после паузы человек вернётся и нажмёт
   *  «Продолжить», после завершения день закрыт. */
  private async close(employeeId: string, reason: 'pause' | 'stop') {
    const open = await this.repo.findOne({ where: { employeeId, endedAt: IsNull() } });
    if (!open) throw new BadRequestException('Смена не начата');
    open.endedAt = new Date();
    open.endReason = reason;
    await this.repo.save(open);
    return this.my(employeeId);
  }

  stop(employeeId: string) { return this.close(employeeId, 'stop'); }
  pause(employeeId: string) { return this.close(employeeId, 'pause'); }

  private durationMs(s: WorkShift): number {
    const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
    return Math.max(0, end - new Date(s.startedAt).getTime());
  }

  /** Сводка для основателя: кто на работе, когда начал, сколько сегодня и за
   *  неделю. Основателя в списке не показываем — у него смен нет. */
  async team(dateStr?: string) {
    const isIso = typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    const day = isIso ? dateStr! : dushanbeDate();
    // Неделя — последние 7 дней включая выбранный.
    const weekStart = new Date(`${day}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const weekFrom = weekStart.toISOString().slice(0, 10);

    // position живёт в карточке сотрудника, а не в users — должность на
    // фронте подписываем по роли (getRoleLabel).
    const users = await this.userRepo.find({
      where: { isActive: true },
      select: ['id', 'name', 'role', 'avatar'],
    });
    const people = users.filter(u => u.role !== UserRole.FOUNDER);

    const rows = await this.repo
      .createQueryBuilder('s')
      .where('s.date BETWEEN :from AND :to', { from: weekFrom, to: day })
      .getMany();

    const byUser = new Map<string, WorkShift[]>();
    for (const s of rows) {
      const list = byUser.get(s.employeeId) || [];
      list.push(s);
      byUser.set(s.employeeId, list);
    }

    const items = people.map(u => {
      const all = byUser.get(u.id) || [];
      const today = all.filter(s => String(s.date) === day);
      const open = today.find(s => !s.endedAt);
      const first = today.map(s => new Date(s.startedAt)).sort((a, b) => a.getTime() - b.getTime())[0];
      const todayMin = Math.round(today.reduce((sum, s) => sum + this.durationMs(s), 0) / 60000);
      const weekMin = Math.round(all.reduce((sum, s) => sum + this.durationMs(s), 0) / 60000);
      const lateHour = first
        ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(first))
        : null;
      const lastToday = today
        .filter(x => x.endedAt)
        .sort((a, b) => new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime())[0];
      const status: 'working' | 'paused' | 'closed' | 'absent' =
        open ? 'working'
          : lastToday?.endReason === 'pause' ? 'paused'
          : today.length ? 'closed'
          : 'absent';
      return {
        id: u.id, name: u.name, role: u.role, avatar: u.avatar ?? null,
        status,
        startedLabel: first ? dushanbeTime(first) : null,
        late: lateHour != null && lateHour >= LATE_AFTER_HOUR,
        autoClosed: today.some(s => s.autoClosed),
        todayMinutes: todayMin,
        weekMinutes: weekMin,
      };
    });

    // Сначала те, кто на работе, потом опоздавшие, потом остальные.
    const rank = (s: string) => (s === 'working' ? 0 : s === 'paused' ? 1 : s === 'closed' ? 2 : 3);
    items.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'ru'));

    return {
      date: day,
      lateAfter: `${String(LATE_AFTER_HOUR).padStart(2, '0')}:00`,
      working: items.filter(i => i.status === 'working').length,
      paused: items.filter(i => i.status === 'paused').length,
      total: items.length,
      items,
    };
  }

  /** Полночь по Душанбе: закрываем забытые смены. Без этого один
   *  забывчивый даёт 40 часов за сутки и ломает всю статистику. */
  @Cron('59 23 * * *', { timeZone: TZ })
  async closeForgotten() {
    const open = await this.repo.find({ where: { endedAt: IsNull() } });
    if (!open.length) return;
    const now = new Date();
    for (const s of open) {
      s.endedAt = now;
      s.autoClosed = true;
      s.endReason = 'auto';
    }
    await this.repo.save(open);
    this.logger.log(`Забытые смены закрыты автоматически: ${open.length}`);
  }
}
