import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { WorkShift } from './work-shift.entity';
import { ShiftEditRequest } from './shift-edit-request.entity';
import { ShiftAbsence } from './shift-absence.entity';
import { WorkSchedule } from './work-schedule.entity';
import { LateNotice } from './late-notice.entity';
import { ShiftSettings } from './shift-settings.entity';
import { User, UserRole } from '../users/user.entity';
import { TelegramService } from '../telegram/telegram.service';

/** Рабочий день начинается в 09:00, опоздание — приход позже 09:30
 *  (решение владельца, 21.09.2026). Порог больше не круглый час, поэтому
 *  сравниваем минуты, а не первые две цифры времени. */
const WORK_START = '09:00';
const WORK_END = '18:00';
/** Норма рабочего дня. Без неё нельзя сказать «осталось два часа», посчитать
 *  недоработку и вовремя напомнить, что пора заканчивать. */
const NORM_MINUTES = 8 * 60;
/** Сколько обеда оплачивается. Перерыв «по работе» (съёмка, встреча, банк)
 *  идёт в часы целиком, «личное» — не идёт вовсе. */
const LUNCH_PAID_MAX = 60;
const LATE_AFTER = '09:30';
const minutesOfTime = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const LATE_AFTER_MIN = minutesOfTime(LATE_AFTER);
/** Пришёл позже порога. Ровно в 09:30 — ещё не опоздание. */
const isLateAt = (hhmm?: string | null) => !!hhmm && minutesOfTime(hhmm) > LATE_AFTER_MIN;

/** График по умолчанию — им живёт тот, кому личный не задавали. */
const DEFAULT_SCHEDULE = {
  startTime: WORK_START, endTime: WORK_END, normMinutes: NORM_MINUTES,
  graceMinutes: 30, workdays: '1,2,3,4,5,6', floating: false,
};
type Sched = typeof DEFAULT_SCHEDULE;
const addMin = (hhmm: string, add: number) => {
  const t = minutesOfTime(hhmm) + add;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
/** Порог опоздания этого человека: начало смены + допуск. У «плавающих»
 *  порога нет вовсе — им опоздание не считается. */
const lateThreshold = (s: Sched): string | null => (s.floating ? null : addMin(s.startTime, s.graceMinutes));
/** Рабочий ли это день по его графику (1 — понедельник … 7 — воскресенье). */
const isWorkday = (s: Sched, dateIso: string): boolean => {
  const d = new Date(`${dateIso}T00:00:00`);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  return s.workdays.split(',').map(x => Number(x.trim())).includes(dow);
};
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
    @InjectRepository(ShiftEditRequest) private editRepo: Repository<ShiftEditRequest>,
    @InjectRepository(ShiftAbsence) private absenceRepo: Repository<ShiftAbsence>,
    @InjectRepository(WorkSchedule) private schedRepo: Repository<WorkSchedule>,
    @InjectRepository(LateNotice) private noticeRepo: Repository<LateNotice>,
    @InjectRepository(ShiftSettings) private settingsRepo: Repository<ShiftSettings>,
    @InjectRepository(User) private userRepo: Repository<User>,
    // TelegramModule помечен @Global — сервис доступен без импорта модуля,
    // то есть без нового ребра в графе зависимостей и без риска колец.
    private telegram: TelegramService,
  ) {}

  /** Моя смена: идёт, на паузе или не начата, и сколько наработано сегодня.
   *  Пауза — это закрытый отрезок с причиной pause: день не закончен,
   *  человек вернётся и продолжит. */
  async my(employeeId: string) {
    const open = await this.repo.findOne({ where: { employeeId, endedAt: IsNull() } });
    const today = dushanbeDate();
    const rows = await this.repo.find({ where: { employeeId, date: today } });
    // Отметка активности: по ней ночной крон закрывает забытую смену
    // настоящим временем, а не полуночью.
    if (open) {
      open.lastPingAt = new Date();
      await this.repo.update({ id: open.id }, { lastPingAt: open.lastPingAt });
    }
    const last = rows
      .filter(r => r.endedAt)
      .sort((a, b) => new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime())[0];
    const state: 'working' | 'paused' | 'idle' =
      open ? 'working' : last?.endReason === 'pause' ? 'paused' : 'idle';
    const sched = this.schedOf(await this.schedRepo.find({ where: { userId: employeeId } }), employeeId);
    const norm = sched.normMinutes;
    const threshold = lateThreshold(sched);
    const all = this.dayStats(rows);
    // closedMinutes — без идущего отрезка: фронт досчитывает его сам, иначе
    // счётчик стоял бы до следующего запроса, а суммируя — удваивался.
    const closed = this.dayStats(rows.filter(r => r.endedAt));
    const first = rows.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())[0];
    const startedLabel = first ? dushanbeTime(new Date(first.startedAt)) : null;
    return {
      state,
      open: open ? { id: open.id, startedAt: open.startedAt, startedLabel: dushanbeTime(open.startedAt) } : null,
      pausedSince: state === 'paused' && last?.endedAt ? dushanbeTime(new Date(last.endedAt)) : null,
      pauseKind: state === 'paused' ? (last?.pauseKind ?? 'personal') : null,
      todayMinutes: all.totalMinutes,
      closedMinutes: closed.totalMinutes,
      workMinutes: all.workMinutes,
      paidBreakMinutes: all.paidBreakMinutes,
      breakMinutes: all.breakMinutes,
      shiftsToday: rows.length,
      dayStartedLabel: startedLabel,
      // Опоздание — от НАЧАЛА ЕГО смены плюс допуск, а не от общих 09:30.
      isLate: !!threshold && !!startedLabel && startedLabel > threshold && isWorkday(sched, today),
      segments: this.daySegments(rows),
      norm: { start: sched.startTime, end: sched.endTime, minutes: norm, lateAfter: threshold, floating: sched.floating },
      leftMinutes: Math.max(0, norm - all.totalMinutes),
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
  private async close(employeeId: string, reason: 'pause' | 'stop', kind?: 'lunch' | 'work' | 'personal') {
    const today = dushanbeDate();
    const open = await this.repo.findOne({ where: { employeeId, endedAt: IsNull() } });
    const dayRows = await this.repo.find({ where: { employeeId, date: open ? open.date : today } });
    const byEndDesc = (a: WorkShift, b: WorkShift) =>
      new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime();

    if (open) {
      const ms = Date.now() - new Date(open.startedAt).getTime();
      const others = dayRows.filter(r => r.id !== open.id && r.endedAt);
      // Отрезок короче минуты — это промах по кнопке, а не работа. Удаляем
      // его и правим предыдущий, иначе в списке копятся строки «23:20 —
      // 23:20 · 0 м», которые ничего не значат.
      if (ms < 60_000 && others.length) {
        await this.repo.delete({ id: open.id });
        const prev = others.sort(byEndDesc)[0];
        prev.endReason = reason;
        prev.pauseKind = reason === 'pause' ? (kind ?? prev.pauseKind ?? 'personal') : null;
        await this.repo.save(prev);
        return this.my(employeeId);
      }
      open.endedAt = new Date();
      open.endReason = reason;
      // Причину помним на отрезке, ПОСЛЕ которого начинается перерыв: сам
      // перерыв — это промежуток, своей строки в таблице у него нет.
      open.pauseKind = reason === 'pause' ? (kind ?? 'personal') : null;
      await this.repo.save(open);
      return this.my(employeeId);
    }

    // Идущего отрезка нет. Для перерыва это ошибка — прерывать нечего.
    if (reason !== 'stop') throw new BadRequestException('Смена не начата');
    // А вот «Завершить» с перерыва — обычное дело: человек ушёл на обед и
    // решил не возвращаться. Раньше кнопка в этом состоянии просто падала
    // с «Смена не начата», и день оставался незакрытым до ночного крона.
    const last = dayRows.filter(r => r.endedAt).sort(byEndDesc)[0];
    if (!last) throw new BadRequestException('Сегодня смена не начиналась');
    if (last.endReason !== 'stop') {
      last.endReason = 'stop';
      last.pauseKind = null;
      await this.repo.save(last);
    }
    return this.my(employeeId);
  }


  stop(employeeId: string) { return this.close(employeeId, 'stop'); }
  pause(employeeId: string, kind?: 'lunch' | 'work' | 'personal') { return this.close(employeeId, 'pause', kind); }

  /** Часы дня по отрезкам. Работа — сами отрезки; между ними перерывы, и
   *  их судьба зависит от причины: обед оплачивается до лимита, выезд по
   *  работе — целиком, личное — никак. Раньше любой перерыв просто выпадал
   *  из часов, и «отошёл на съёмку» стоило человеку рабочего времени. */
  private dayStats(list: WorkShift[]) {
    const sorted = [...list].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    let work = 0, paidBreak = 0, unpaidBreak = 0;
    for (let i = 0; i < sorted.length; i++) {
      work += this.durationMs(sorted[i]) / 60000;
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (!next || !cur.endedAt) continue;
      const gap = Math.max(0, (new Date(next.startedAt).getTime() - new Date(cur.endedAt).getTime()) / 60000);
      if (cur.pauseKind === 'work') paidBreak += gap;
      else if (cur.pauseKind === 'lunch') {
        paidBreak += Math.min(gap, LUNCH_PAID_MAX);
        unpaidBreak += Math.max(0, gap - LUNCH_PAID_MAX);
      } else unpaidBreak += gap;
    }
    return {
      workMinutes: Math.round(work),
      paidBreakMinutes: Math.round(paidBreak),
      breakMinutes: Math.round(unpaidBreak),
      totalMinutes: Math.round(work + paidBreak),
    };
  }

  /** Отрезки дня для карточки смены: работа и перерывы вперемешку, по порядку. */
  private daySegments(list: WorkShift[]) {
    const sorted = [...list].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const out: Array<{ type: 'work' | 'break'; kind?: string | null; from: string; to: string | null; minutes: number; paid?: boolean }> = [];
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const mins = Math.round(this.durationMs(cur) / 60000);
      // Нулевой отрезок показываем, только если он в дне один: иначе это
      // след промаха по кнопке, и в списке от него один мусор.
      if (mins > 0 || sorted.length === 1) {
        out.push({
          type: 'work',
          from: dushanbeTime(new Date(cur.startedAt)),
          to: cur.endedAt ? dushanbeTime(new Date(cur.endedAt)) : null,
          minutes: mins,
        });
      }
      const next = sorted[i + 1];
      if (!next || !cur.endedAt) continue;
      const gap = Math.max(0, Math.round((new Date(next.startedAt).getTime() - new Date(cur.endedAt).getTime()) / 60000));
      if (!gap) continue;
      out.push({
        type: 'break',
        kind: cur.pauseKind ?? 'personal',
        from: dushanbeTime(new Date(cur.endedAt)),
        to: dushanbeTime(new Date(next.startedAt)),
        minutes: gap,
        paid: cur.pauseKind === 'work' || cur.pauseKind === 'lunch',
      });
    }
    return out;
  }

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
    const absences = await this.absenceRepo.find({ where: { date: day } });
    const absenceByUser = new Map(absences.map(a => [a.employeeId, a]));
    const scheds = await this.schedRepo.find();
    // Одобренная заранее просьба снимает опоздание за этот день.
    const excused = new Set(
      (await this.noticeRepo.find({ where: { date: day, status: 'approved' } })).map(n => n.userId),
    );

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
      const todayMin = this.dayStats(today).totalMinutes;
      // Неделя — по дням: перерывы считаются внутри дня, а не через ночь.
      const byDay = new Map<string, WorkShift[]>();
      for (const s of all) {
        const k = String(s.date);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k)!.push(s);
      }
      const weekMin = [...byDay.values()].reduce((sum, list) => sum + this.dayStats(list).totalMinutes, 0);
      const lastToday = today
        .filter(x => x.endedAt)
        .sort((a, b) => new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime())[0];
      const absence = absenceByUser.get(u.id) ?? null;
      const status: 'working' | 'paused' | 'closed' | 'absent' | 'off' =
        open ? 'working'
          : lastToday?.endReason === 'pause' ? 'paused'
          : today.length ? 'closed'
          : absence ? 'off'
          : 'absent';
      return {
        id: u.id, name: u.name, role: u.role, avatar: u.avatar ?? null,
        status,
        startedLabel: first ? dushanbeTime(first) : null,
        late: (() => {
          const sc = this.schedOf(scheds, u.id);
          const th = lateThreshold(sc);
          const at = first ? dushanbeTime(first) : null;
          return !!th && !!at && at > th && isWorkday(sc, day) && !excused.has(u.id);
        })(),
        excused: excused.has(u.id),
        startsAt: this.schedOf(scheds, u.id).startTime,
        floating: this.schedOf(scheds, u.id).floating,
        // Чем занят перерыв: «на обеде» и «выехал на съёмку» — разные вещи.
        pauseKind: status === 'paused' ? (lastToday?.pauseKind ?? 'personal') : null,
        absenceKind: absence?.kind ?? null,
        absenceNote: absence?.note ?? null,
        normMinutes: NORM_MINUTES,
        autoClosed: today.some(s => s.autoClosed),
        todayMinutes: todayMin,
        weekMinutes: weekMin,
      };
    });

    // Сначала те, кто на работе, потом опоздавшие, потом остальные.
    const rank = (s: string) => (s === 'working' ? 0 : s === 'paused' ? 1 : s === 'closed' ? 2 : s === 'off' ? 3 : 4);
    items.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'ru'));

    return {
      date: day,
      lateAfter: LATE_AFTER,
      workStart: WORK_START,
      workEnd: WORK_END,
      normMinutes: NORM_MINUTES,
      working: items.filter(i => i.status === 'working').length,
      paused: items.filter(i => i.status === 'paused').length,
      total: items.length,
      items,
    };
  }

  /** Табель за месяц: по каждому сотруднику часы по дням, итоги и сами
   *  отрезки смен. Отрезки отдаём сразу, а не отдельным запросом: их за
   *  месяц на всю команду — сотни строк, зато карточка человека открывается
   *  мгновенно, без второго похода на сервер. */
  async month(ym?: string) {
    const valid = typeof ym === 'string' && /^\d{4}-\d{2}$/.test(ym);
    const month = valid ? ym! : dushanbeDate().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const from = `${month}-01`;
    const to = `${month}-${String(daysInMonth).padStart(2, '0')}`;

    const users = await this.userRepo.find({
      where: { isActive: true },
      select: ['id', 'name', 'role', 'avatar'],
    });
    const people = users.filter(u => u.role !== UserRole.FOUNDER);

    const rows = await this.repo
      .createQueryBuilder('s')
      .where('s.date BETWEEN :from AND :to', { from, to })
      .getMany();
    const monthAbsences = await this.absenceRepo
      .createQueryBuilder('a')
      .where('a.date BETWEEN :from AND :to', { from, to })
      .getMany();
    const monthScheds = await this.schedRepo.find();
    const excusedDays = new Set(
      (await this.noticeRepo
        .createQueryBuilder('n')
        .where('n.date BETWEEN :from AND :to', { from, to })
        .andWhere("n.status = 'approved'")
        .getMany()).map(n => `${n.userId}:${n.date}`),
    );
    const absenceByUserDay = new Map<string, Record<number, string>>();
    for (const a of monthAbsences) {
      const dn = Number(String(a.date).slice(8, 10));
      const m = absenceByUserDay.get(a.employeeId) ?? {};
      m[dn] = a.kind;
      absenceByUserDay.set(a.employeeId, m);
    }

    const byUser = new Map<string, WorkShift[]>();
    for (const s of rows) {
      const list = byUser.get(s.employeeId) || [];
      list.push(s);
      byUser.set(s.employeeId, list);
    }

    const items = people.map(u => {
      const all = (byUser.get(u.id) || []).sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      );
      const days: Record<number, number> = {};
      const segments: Record<number, { from: string; to: string | null; reason: string | null; pauseKind: string | null; minutes: number }[]> = {};
      const lateDays = new Set<number>();
      const autoDays = new Set<number>();

      // Часы дня считаем по всем его отрезкам разом: оплачиваемые перерывы
      // живут МЕЖДУ отрезками, по одному отрезку их не увидеть.
      const byDayNum = new Map<number, WorkShift[]>();
      for (const sh of all) {
        const dn = Number(String(sh.date).slice(8, 10));
        if (!byDayNum.has(dn)) byDayNum.set(dn, []);
        byDayNum.get(dn)!.push(sh);
      }
      for (const [dn, list] of byDayNum) days[dn] = this.dayStats(list).totalMinutes;
      for (const sh of all) {
        const dayNum = Number(String(sh.date).slice(8, 10));
        const min = Math.round(this.durationMs(sh) / 60000);
        (segments[dayNum] ||= []).push({
          from: dushanbeTime(new Date(sh.startedAt)),
          to: sh.endedAt ? dushanbeTime(new Date(sh.endedAt)) : null,
          reason: sh.endReason ?? null,
          pauseKind: sh.pauseKind ?? null,
          minutes: min,
        });
        if (sh.autoClosed) autoDays.add(dayNum);
      }
      // Опоздание считаем по первому приходу за день и по ЕГО графику:
      // у монтажёра смена с 14:00, и общий порог 09:30 делал бы его
      // опоздавшим каждый день.
      const sc = this.schedOf(monthScheds, u.id);
      const th = lateThreshold(sc);
      for (const dayNum of Object.keys(segments).map(Number)) {
        const first = segments[dayNum][0];
        const dIso = `${month}-${String(dayNum).padStart(2, '0')}`;
        if (th && first?.from && first.from > th && isWorkday(sc, dIso) && !excusedDays.has(`${u.id}:${dIso}`)) {
          lateDays.add(dayNum);
        }
      }

      const workedDays = Object.values(days).filter(v => v > 0).length;
      const totalMinutes = Object.values(days).reduce((a, b) => a + b, 0);
      return {
        id: u.id, name: u.name, role: u.role, avatar: u.avatar ?? null,
        days, segments,
        lateDays: [...lateDays].sort((a, b) => a - b),
        autoDays: [...autoDays].sort((a, b) => a - b),
        workedDays,
        totalMinutes,
        avgMinutes: workedDays ? Math.round(totalMinutes / workedDays) : 0,
        // Недоработка/переработка считаются от нормы за отработанные дни:
        // считать по календарю нельзя, пока в системе нет графика и отгулов.
        normMinutes: workedDays * NORM_MINUTES,
        diffMinutes: totalMinutes - workedDays * NORM_MINUTES,
        // Дни, которые НЕ прогул: отгул, отпуск, больничный, праздник.
        absences: absenceByUserDay.get(u.id) ?? {},
      };
    });

    items.sort((a, b) => b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name, 'ru'));

    return {
      ym: month,
      daysInMonth,
      today: dushanbeDate(),
      lateAfter: LATE_AFTER,
      workStart: WORK_START,
      workEnd: WORK_END,
      normMinutes: NORM_MINUTES,
      items,
    };
  }

  // ─── Личный график смены ─────────────────────────────────────────────
  /** График человека: свой, если задан, иначе общий по компании. */
  private schedOf(rows: WorkSchedule[], userId: string): Sched {
    const r = rows.find(x => x.userId === userId);
    if (!r) return DEFAULT_SCHEDULE;
    return {
      startTime: r.startTime || DEFAULT_SCHEDULE.startTime,
      endTime: r.endTime || DEFAULT_SCHEDULE.endTime,
      normMinutes: Number(r.normMinutes) || DEFAULT_SCHEDULE.normMinutes,
      graceMinutes: Number(r.graceMinutes ?? DEFAULT_SCHEDULE.graceMinutes),
      workdays: r.workdays || DEFAULT_SCHEDULE.workdays,
      floating: !!r.floating,
    };
  }

  /** Графики всей команды — таблица во вкладке «График работы». */
  async schedules() {
    const users = await this.userRepo.find({
      where: { isActive: true },
      select: ['id', 'name', 'role', 'avatar'],
    });
    const rows = await this.schedRepo.find();
    const settings = await this.settings();
    return {
      defaults: DEFAULT_SCHEDULE,
      settings,
      items: users
        .filter(u => u.role !== UserRole.FOUNDER)
        .map(u => ({
          id: u.id, name: u.name, role: u.role, avatar: u.avatar ?? null,
          custom: rows.some(r => r.userId === u.id),
          ...this.schedOf(rows, u.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    };
  }

  async setSchedule(userId: string, dto: Partial<Sched>, byId: string) {
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (dto.startTime && !hhmm.test(dto.startTime)) throw new BadRequestException('Начало в формате ЧЧ:ММ');
    if (dto.endTime && !hhmm.test(dto.endTime)) throw new BadRequestException('Конец в формате ЧЧ:ММ');
    const row = (await this.schedRepo.findOne({ where: { userId } })) ?? this.schedRepo.create({ userId, ...DEFAULT_SCHEDULE });
    if (dto.startTime !== undefined) row.startTime = dto.startTime;
    if (dto.endTime !== undefined) row.endTime = dto.endTime;
    if (dto.normMinutes !== undefined) row.normMinutes = Math.max(0, Math.min(16 * 60, Number(dto.normMinutes) || 0));
    if (dto.graceMinutes !== undefined) row.graceMinutes = Math.max(0, Math.min(240, Number(dto.graceMinutes) || 0));
    if (dto.workdays !== undefined) {
      const days = String(dto.workdays).split(',').map(x => Number(x.trim())).filter(n => n >= 1 && n <= 7);
      row.workdays = [...new Set(days)].sort().join(',') || '1,2,3,4,5,6';
    }
    if (dto.floating !== undefined) row.floating = !!dto.floating;
    row.updatedById = byId;
    row.updatedAt = new Date();
    await this.schedRepo.save(row);
    return { ok: true };
  }

  /** Настройки смен и авто-штрафа — одна строка на компанию. */
  async settings(): Promise<ShiftSettings> {
    const row = await this.settingsRepo.findOne({ where: { id: true } });
    if (row) return row;
    return this.settingsRepo.save(this.settingsRepo.create({ id: true }));
  }

  async setSettings(dto: Partial<ShiftSettings>) {
    const row = await this.settings();
    if (dto.autoFine !== undefined) row.autoFine = !!dto.autoFine;
    if (dto.fineAmount !== undefined) row.fineAmount = Math.max(0, Number(dto.fineAmount) || 0);
    if (dto.graceMinutes !== undefined) row.graceMinutes = Math.max(0, Math.min(240, Number(dto.graceMinutes) || 0));
    if (dto.runHour !== undefined) row.runHour = Math.max(0, Math.min(23, Number(dto.runHour) || 0));
    if (dto.noticeDaysBefore !== undefined) row.noticeDaysBefore = Math.max(0, Math.min(7, Number(dto.noticeDaysBefore) || 0));
    row.updatedAt = new Date();
    await this.settingsRepo.save(row);
    return { ok: true };
  }

  // ─── «Приду позже»: предупредить заранее ─────────────────────────────
  /** Просьба от сотрудника. Поданная в тот же день от штрафа не спасает —
   *  об этом написано в форме, и решает это правило noticeDaysBefore. */
  async createNotice(userId: string, dto: { date: string; time: string; reason?: string }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date || '')) throw new BadRequestException('Дата в формате ГГГГ-ММ-ДД');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.time || '')) throw new BadRequestException('Время в формате ЧЧ:ММ');
    if (dto.date < dushanbeDate()) throw new BadRequestException('Этот день уже прошёл');
    await this.noticeRepo.update(
      { userId, date: dto.date, status: 'pending' },
      { status: 'rejected', decidedAt: new Date() },
    );
    const saved = await this.noticeRepo.save(this.noticeRepo.create({
      userId, date: dto.date, plannedTime: dto.time,
      reason: (dto.reason || '').trim().slice(0, 300) || null,
      status: 'pending',
    }));
    return { ok: true, id: saved.id };
  }

  async myNotices(userId: string) {
    const rows = await this.noticeRepo.find({ where: { userId }, order: { date: 'DESC' }, take: 10 });
    return rows.map(r => ({
      id: r.id, date: r.date, plannedTime: r.plannedTime, reason: r.reason, status: r.status,
    }));
  }

  /** Очередь просьб для руководства + одобренные на будущее. */
  async notices() {
    const rows = await this.noticeRepo
      .createQueryBuilder('n')
      .where("n.date >= :from", { from: dushanbeDate() })
      .orderBy('n.date', 'ASC')
      .getMany();
    if (!rows.length) return { items: [] };
    const users = await this.userRepo.find({ select: ['id', 'name', 'role'] });
    const scheds = await this.schedRepo.find();
    return {
      items: rows.map(r => ({
        id: r.id, date: r.date, plannedTime: r.plannedTime, reason: r.reason, status: r.status,
        userId: r.userId,
        name: users.find(u => u.id === r.userId)?.name ?? '—',
        role: users.find(u => u.id === r.userId)?.role ?? null,
        startTime: this.schedOf(scheds, r.userId).startTime,
      })),
    };
  }

  async decideNotice(id: string, approve: boolean, byId: string) {
    const row = await this.noticeRepo.findOne({ where: { id } });
    if (!row) throw new BadRequestException('Просьба не найдена');
    row.status = approve ? 'approved' : 'rejected';
    row.decidedById = byId;
    row.decidedAt = new Date();
    await this.noticeRepo.save(row);
    // Человек должен узнать ответ сразу, а не гадать до утра.
    await this.telegram.sendToUser(
      row.userId,
      approve
        ? `Ваша просьба на ${row.date} одобрена: приходите к ${row.plannedTime}, опоздание не начислится.`
        : `Просьба прийти позже ${row.date} отклонена. Смена начинается как обычно.`,
    ).catch(() => undefined);
    return { ok: true, status: row.status };
  }

  // ─── Отгул, отпуск, больничный ───────────────────────────────────────
  /** Отметить день как нерабочий по уважительной причине. Повторная отметка
   *  того же дня заменяет прежнюю — так проще исправить опечатку. */
  async setAbsence(dto: { employeeId: string; date: string; kind: ShiftAbsence['kind']; note?: string }, byId: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date || '')) throw new BadRequestException('Дата в формате ГГГГ-ММ-ДД');
    const kinds = ['dayoff', 'vacation', 'sick', 'holiday'];
    if (!kinds.includes(dto.kind)) throw new BadRequestException('Неизвестный тип');
    const exist = await this.absenceRepo.findOne({ where: { employeeId: dto.employeeId, date: dto.date } });
    const row = exist ?? this.absenceRepo.create({ employeeId: dto.employeeId, date: dto.date });
    row.kind = dto.kind;
    row.note = (dto.note || '').trim().slice(0, 200) || null;
    row.createdById = byId;
    await this.absenceRepo.save(row);
    return { ok: true };
  }

  async removeAbsence(employeeId: string, date: string) {
    await this.absenceRepo.delete({ employeeId, date });
    return { ok: true };
  }

  // ─── «Забыл нажать»: правка времени через подтверждение ──────────────
  /** Сотрудник просит поправить начало или конец своей смены. Сам он табель
   *  не меняет — иначе учёт времени теряет смысл. */
  async requestEdit(employeeId: string, dto: { date?: string; field: 'start' | 'end'; time: string; note?: string }) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dto.date || '') ? dto.date! : dushanbeDate();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.time || '')) throw new BadRequestException('Время в формате ЧЧ:ММ');
    if (date > dushanbeDate()) throw new BadRequestException('Нельзя править будущий день');
    const rows = await this.repo.find({ where: { employeeId, date } });
    if (!rows.length) throw new BadRequestException('В этот день смены не было');
    const sorted = rows.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const target = dto.field === 'start' ? sorted[0] : sorted[sorted.length - 1];
    const current = dto.field === 'start'
      ? dushanbeTime(new Date(target.startedAt))
      : (target.endedAt ? dushanbeTime(new Date(target.endedAt)) : null);
    // Один открытый запрос на день и поле — вторая просьба заменяет первую.
    await this.editRepo.update(
      { employeeId, date, field: dto.field, status: 'pending' },
      { status: 'rejected', decidedAt: new Date() },
    );
    const saved = await this.editRepo.save(this.editRepo.create({
      employeeId, date, field: dto.field,
      requestedTime: dto.time,
      currentTime: current,
      note: (dto.note || '').trim().slice(0, 300) || null,
      status: 'pending',
      shiftId: target.id,
    }));
    return { ok: true, id: saved.id };
  }

  /** Мои правки за последний месяц — чтобы человек видел, что с ними стало. */
  async myEdits(employeeId: string) {
    const rows = await this.editRepo.find({ where: { employeeId }, order: { createdAt: 'DESC' }, take: 20 });
    return rows.map(r => ({
      id: r.id, date: r.date, field: r.field, requestedTime: r.requestedTime,
      currentTime: r.currentTime, note: r.note, status: r.status,
    }));
  }

  /** Очередь правок для руководства. */
  async pendingEdits() {
    const rows = await this.editRepo.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' }, take: 100 });
    if (!rows.length) return { items: [] };
    const users = await this.userRepo.find({ select: ['id', 'name', 'role', 'avatar'] });
    const byId = new Map(users.map(u => [u.id, u]));
    return {
      items: rows.map(r => ({
        id: r.id, date: r.date, field: r.field,
        requestedTime: r.requestedTime, currentTime: r.currentTime, note: r.note,
        employeeId: r.employeeId,
        name: byId.get(r.employeeId)?.name ?? '—',
        role: byId.get(r.employeeId)?.role ?? null,
        avatar: byId.get(r.employeeId)?.avatar ?? null,
        createdAt: r.createdAt,
      })),
    };
  }

  /** Подтвердить правку: двигаем время отрезка и помечаем смену как
   *  поправленную руками (autoClosed снимаем — время теперь подтверждённое). */
  async decideEdit(id: string, approve: boolean, deciderId: string) {
    const req = await this.editRepo.findOne({ where: { id } });
    if (!req) throw new BadRequestException('Правка не найдена');
    if (req.status !== 'pending') throw new BadRequestException('Правка уже обработана');
    if (approve) {
      const shift = req.shiftId ? await this.repo.findOne({ where: { id: req.shiftId } }) : null;
      if (!shift) throw new BadRequestException('Смена не найдена');
      const [h, m] = req.requestedTime.split(':').map(Number);
      // Время приходит по Душанбе, а в базе лежит момент времени: берём день
      // смены и подставляем час с учётом смещения самого дня.
      const base = new Date(req.field === 'start' ? shift.startedAt : (shift.endedAt ?? shift.startedAt));
      const shiftHM = dushanbeTime(base).split(':').map(Number);
      const deltaMin = (h * 60 + m) - (shiftHM[0] * 60 + shiftHM[1]);
      const moved = new Date(base.getTime() + deltaMin * 60000);
      if (req.field === 'start') {
        if (shift.endedAt && moved >= new Date(shift.endedAt)) throw new BadRequestException('Начало позже конца смены');
        shift.startedAt = moved;
      } else {
        if (moved <= new Date(shift.startedAt)) throw new BadRequestException('Конец раньше начала смены');
        shift.endedAt = moved;
        shift.endReason = shift.endReason === 'auto' ? 'stop' : shift.endReason;
        shift.autoClosed = false;
      }
      await this.repo.save(shift);
    }
    req.status = approve ? 'approved' : 'rejected';
    req.decidedById = deciderId;
    req.decidedAt = new Date();
    await this.editRepo.save(req);
    return { ok: true, status: req.status };
  }

  /** Мой табель за месяц — для личного профиля. Общий /month закрыт
   *  руководством, здесь отдаём ровно одного человека: себя. */
  async myMonth(userId: string, ym?: string) {
    const res = await this.month(ym);
    const mine = res.items.find(i => i.id === userId) || null;
    return {
      ym: res.ym, daysInMonth: res.daysInMonth, today: res.today,
      lateAfter: res.lateAfter,
      workStart: res.workStart,
      item: mine ?? {
        id: userId, name: '', role: null, avatar: null,
        days: {}, segments: {}, lateDays: [], autoDays: [],
        workedDays: 0, totalMinutes: 0, avgMinutes: 0,
      },
    };
  }

  // ═══ Напоминания. Канал уже есть — тот же бот, что шлёт утренний дайджест.
  //     Сообщения без кнопок намеренно: нажатие в телеграме требует обработки
  //     колбэков в боте, а человеку и так достаточно открыть CRM. ═══

  /** Кому вообще шлём: активные сотрудники, кроме основателя. */
  private async shiftPeople(): Promise<User[]> {
    const users = await this.userRepo.find({ where: { isActive: true }, select: ['id', 'name', 'role'] });
    return users.filter(u => u.role !== UserRole.FOUNDER);
  }

  /** 09:35 — смена не отмечена. Проверяем ровно один раз за утро. */
  @Cron('35 9 * * *', { timeZone: TZ })
  async remindToStart() {
    const day = dushanbeDate();
    const people = await this.shiftPeople();
    if (!people.length) return;
    const started = new Set(
      (await this.repo.find({ where: { date: day }, select: ['employeeId'] })).map(s => s.employeeId),
    );
    let sent = 0;
    for (const u of people) {
      if (started.has(u.id)) continue;
      await this.telegram.sendToUser(
        u.id,
        `Рабочий день начался в ${WORK_START}, а смена не отмечена.\n` +
        'Откройте CRM и нажмите «Начать работу» — иначе день не попадёт в табель.',
      ).catch(() => undefined);
      sent++;
    }
    if (sent) this.logger.log(`Напоминаний «начни смену»: ${sent}`);
  }

  /** Долгий перерыв. Шлём ОДИН раз: только когда длительность перешла порог
   *  в это окно крона, иначе сообщение повторялось бы каждые 15 минут. */
  @Cron('*/15 10-20 * * *', { timeZone: TZ })
  async remindFromBreak() {
    const day = dushanbeDate();
    const rows = await this.repo.find({ where: { date: day } });
    if (!rows.length) return;
    const byUser = new Map<string, WorkShift[]>();
    for (const s of rows) {
      if (!byUser.has(s.employeeId)) byUser.set(s.employeeId, []);
      byUser.get(s.employeeId)!.push(s);
    }
    for (const [userId, list] of byUser) {
      if (list.some(s => !s.endedAt)) continue;                    // работает, не на перерыве
      const last = list.sort((a, b) => new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime())[0];
      if (last.endReason !== 'pause') continue;                    // день закрыт
      const mins = Math.round((Date.now() - new Date(last.endedAt!).getTime()) / 60000);
      const limit = last.pauseKind === 'lunch' ? LUNCH_PAID_MAX : 45;
      if (mins < limit || mins >= limit + 15) continue;            // порог пройден именно сейчас
      const what = last.pauseKind === 'lunch' ? 'Обед' : last.pauseKind === 'work' ? 'Выезд по работе' : 'Перерыв';
      await this.telegram.sendToUser(
        userId,
        `${what} идёт ${mins} минут.\n` +
        (last.pauseKind === 'lunch'
          ? `В часы засчитывается ${LUNCH_PAID_MAX} минут обеда — дальше время не идёт.`
          : 'Вернулись? Нажмите «Продолжить» в CRM.'),
      ).catch(() => undefined);
    }
  }

  /** 18:05 — норма закрыта, а смена всё ещё идёт. */
  @Cron('5 18 * * *', { timeZone: TZ })
  async remindToFinish() {
    const day = dushanbeDate();
    const rows = await this.repo.find({ where: { date: day } });
    const byUser = new Map<string, WorkShift[]>();
    for (const s of rows) {
      if (!byUser.has(s.employeeId)) byUser.set(s.employeeId, []);
      byUser.get(s.employeeId)!.push(s);
    }
    for (const [userId, list] of byUser) {
      if (!list.some(s => !s.endedAt)) continue;                   // смена уже закрыта
      const total = this.dayStats(list).totalMinutes;
      if (total < NORM_MINUTES) continue;
      await this.telegram.sendToUser(
        userId,
        `Норма ${Math.round(NORM_MINUTES / 60)} часов отработана.\n` +
        'Если закончили — нажмите «Завершить», чтобы день не закрылся автоматически.',
      ).catch(() => undefined);
    }
  }

  /** 10:00 — сводка руководству: кто на работе, кто опоздал, кого нет. */
  @Cron('0 10 * * *', { timeZone: TZ })
  async ownerMorningDigest() {
    const data = await this.team();
    if (!data.items.length) return;
    const late = data.items.filter(i => i.late);
    const absent = data.items.filter(i => i.status === 'absent');
    const working = data.items.filter(i => i.status !== 'absent');
    const lines = [
      `Смены на ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`,
      `На работе: ${working.length} из ${data.items.length}`,
    ];
    if (late.length) lines.push(`Опоздали (после ${LATE_AFTER}): ` + late.map(i => `${i.name} — ${i.startedLabel}`).join(', '));
    if (absent.length) lines.push('Не вышли: ' + absent.map(i => i.name).join(', '));
    const chiefs = await this.userRepo.find({
      where: { isActive: true },
      select: ['id', 'role'],
    });
    for (const u of chiefs) {
      if (u.role !== UserRole.FOUNDER && u.role !== UserRole.CO_FOUNDER) continue;
      await this.telegram.sendToUser(u.id, lines.join('\n')).catch(() => undefined);
    }
  }

  /** Полночь по Душанбе: закрываем забытые смены. Без этого один
   *  забывчивый даёт 40 часов за сутки и ломает всю статистику. */
  @Cron('59 23 * * *', { timeZone: TZ })
  async closeForgotten() {
    const open = await this.repo.find({ where: { endedAt: IsNull() } });
    if (!open.length) return;
    for (const s of open) {
      // Закрываем не полуночью, а последней активностью в системе: человек
      // ушёл в 18:00 и забыл нажать — раньше ему писали 14 часов 59 минут.
      // Активности не было вовсе (работал не за компьютером) — берём конец
      // рабочего дня: это правдоподобнее полуночи, а пометка autoClosed
      // честно говорит, что время не подтверждено нажатием.
      const started = new Date(s.startedAt);
      const ping = s.lastPingAt ? new Date(s.lastPingAt) : null;
      const [wh, wm] = WORK_END.split(':').map(Number);
      const endOfWork = new Date(started);
      endOfWork.setHours(wh, wm, 0, 0);
      let end = ping && ping > started ? ping : endOfWork;
      if (end < started) end = started;
      s.endedAt = end;
      s.autoClosed = true;
      s.endReason = 'auto';
    }
    await this.repo.save(open);
    this.logger.log(`Забытые смены закрыты автоматически: ${open.length}`);
  }

}
