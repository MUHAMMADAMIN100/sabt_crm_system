import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between, In, Not } from 'typeorm'
import { Task, TaskStatus, TaskKind, TASK_CLOSED_FOR_OVERDUE } from './task.entity'
import { TasksService } from './tasks.service'
import { NotificationsService } from '../notifications/notifications.service'
import { NotificationType } from '../notifications/notification.entity'
import { TelegramService } from '../telegram/telegram.service'

/** Компания работает по Душанбе (UTC+5). Крон-выражения ниже привязаны к
 *  этой зоне, а границы суток считаем явным сдвигом — сервер живёт в UTC. */
const TZ = 'Asia/Dushanbe'
const TZ_OFFSET_H = 5

/**
 * Напоминания по личным задачам и встречам сотрудника.
 *
 * Раньше напоминаний по задачам не было вовсе: старые кроны в
 * DeadlineScheduler отключили при переходе на Доску проектов, и всё, что
 * человек ставит себе в календаре, жило молча. Здесь именно эта, отдельная
 * ветка — записи календаря сотрудника:
 *
 *   09:00 — сводка «сегодня у вас», списком;
 *   каждые 5 минут — точечное «через час» для записей со временем;
 *   18:00 — что из сегодняшнего осталось незакрытым (только самому).
 *
 * Просрочки по карточкам Доски проектов шлёт DeadlineScheduler — здесь их
 * намеренно нет, чтобы не задваивать сообщения.
 */
@Injectable()
export class PersonalReminderScheduler {
  private readonly logger = new Logger(PersonalReminderScheduler.name)

  /** id записей, по которым «за час» уже отправлено. Ключ — id + отметка
   *  времени: перенос встречи на другой час снова включает напоминание.
   *  В памяти: после рестарта максимум одно повторное сообщение. */
  private readonly soonSent = new Set<string>()

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private tasks: TasksService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  /** Границы сегодняшних суток по Душанбе, выраженные в UTC. */
  private dushanbeDayBounds(base = new Date()) {
    const local = new Date(base.getTime() + TZ_OFFSET_H * 3600_000)
    const y = local.getUTCFullYear(); const m = local.getUTCMonth(); const d = local.getUTCDate()
    const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - TZ_OFFSET_H * 3600_000)
    const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - TZ_OFFSET_H * 3600_000)
    return { start, end }
  }

  /** Записи календаря сотрудника: то, что он ведёт сам (личные задачи и
   *  встречи) плюс назначенные ему рабочие задачи с дедлайном в окне.
   *  КП-задачи онбординга исключены — они живут своей воронкой. */
  private async entriesBetween(from: Date, to: Date): Promise<Task[]> {
    const rows = await this.taskRepo.find({
      where: {
        deadline: Between(from, to) as any,
        status: Not(In(TASK_CLOSED_FOR_OVERDUE)) as any,
      },
      relations: ['project'],
    })
    return rows.filter(t =>
      !!t.assigneeId
      && (t as any).originStage !== 'kp_creation'
      && !String(t.title || '').startsWith('История:'))
  }

  /** in-app + Telegram одному человеку. Оба канала best-effort: молчание
   *  бота не должно ронять крон для остальных. */
  private async push(userId: string, title: string, message: string, text: string, taskId?: string) {
    await this.notifications.create({
      userId,
      type: NotificationType.DEADLINE_TOMORROW,
      title,
      message,
      link: taskId ? `/tasks/${taskId}` : '/calendar',
    } as any).catch(() => {})
    await this.telegram.sendToUser(userId, text, taskId ? this.tasks.publicTaskButtons(taskId) : undefined)
      .catch(() => {})
  }

  // ── 1. Утренняя сводка: что сегодня ──────────────────────────────────
  @Cron('0 9 * * *', { timeZone: TZ })
  async morningAgenda() {
    const { start, end } = this.dushanbeDayBounds()
    const entries = await this.entriesBetween(start, end)
    if (entries.length === 0) { this.logger.log('Утренняя сводка: на сегодня записей нет'); return }

    const byUser = new Map<string, Task[]>()
    for (const t of entries) {
      const arr = byUser.get(t.assigneeId!) || []
      arr.push(t)
      byUser.set(t.assigneeId!, arr)
    }

    let sent = 0
    for (const [userId, items] of byUser) {
      items.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
      const lines = items.map(t => {
        const time = new Date(t.deadline).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
        const icon = t.kind === TaskKind.MEETING ? '🤝' : '📌'
        const place = t.kind === TaskKind.MEETING && t.location ? ` · 📍 ${t.location}` : ''
        const proj = t.project?.name ? ` · ${t.project.name}` : ''
        return `${icon} <b>${time}</b> — ${t.title}${place}${proj}`
      }).join('\n')

      const meetings = items.filter(t => t.kind === TaskKind.MEETING).length
      const summary = meetings > 0
        ? `Задач: ${items.length - meetings} · Встреч: ${meetings}`
        : `Задач: ${items.length}`

      await this.push(
        userId,
        '📅 План на сегодня',
        summary,
        `📅 <b>План на сегодня</b>\n${summary}\n\n${lines}\n\n👉 ${this.telegram.appUrl}/calendar`,
      )
      sent++
    }
    this.logger.log(`Утренняя сводка отправлена: ${sent} чел.`)
  }

  // ── 2. За час до записи ──────────────────────────────────────────────
  /** Каждые 5 минут смотрим окно [через 55 мин, через 65 мин]: любая запись
   *  со временем попадёт в него ровно один раз. Точный крон «за час» не
   *  подходит — время встречи произвольное. */
  @Cron('*/5 * * * *')
  async hourBefore() {
    const now = new Date()
    const from = new Date(now.getTime() + 55 * 60_000)
    const to = new Date(now.getTime() + 65 * 60_000)
    const entries = await this.entriesBetween(from, to)

    let sent = 0
    for (const t of entries) {
      // Ключ включает время: перенесли встречу — напомним снова.
      const key = `${t.id}:${new Date(t.deadline).getTime()}`
      if (this.soonSent.has(key)) continue
      this.soonSent.add(key)

      const time = new Date(t.deadline).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
      await this.push(
        t.assigneeId!,
        t.kind === TaskKind.MEETING ? '⏰ Встреча через час' : '⏰ Задача через час',
        `${t.title} — в ${time}`,
        this.tasks.calendarEntryMessage(t, 'soon'),
        t.id,
      )
      sent++
    }
    // Держим набор компактным: за сутки записей немного, но крон вечный.
    if (this.soonSent.size > 5000) this.soonSent.clear()
    if (sent > 0) this.logger.log(`Напоминаний «через час»: ${sent}`)
  }

  // ── 3. Вечером: что не закрыто ───────────────────────────────────────
  @Cron('0 18 * * *', { timeZone: TZ })
  async eveningUnfinished() {
    const { start, end } = this.dushanbeDayBounds()
    const entries = await this.entriesBetween(start, end)
    if (entries.length === 0) return

    const byUser = new Map<string, Task[]>()
    for (const t of entries) {
      const arr = byUser.get(t.assigneeId!) || []
      arr.push(t)
      byUser.set(t.assigneeId!, arr)
    }

    let sent = 0
    for (const [userId, items] of byUser) {
      // Одна запись — конкретное сообщение с кнопками; несколько — списком.
      if (items.length === 1) {
        await this.push(
          userId,
          'Не закрыто сегодня',
          items[0].title,
          this.tasks.calendarEntryMessage(items[0], 'unfinished'),
          items[0].id,
        )
      } else {
        const lines = items.map(t => {
          const icon = t.kind === TaskKind.MEETING ? '🤝' : '📌'
          return `${icon} ${t.title}`
        }).join('\n')
        await this.push(
          userId,
          'Не закрыто сегодня',
          `Осталось ${items.length}`,
          `🌙 <b>Не закрыто сегодня</b>\nОсталось: <b>${items.length}</b>\n\n${lines}\n\n👉 ${this.telegram.appUrl}/calendar`,
        )
      }
      sent++
    }
    this.logger.log(`Вечерний разбор отправлен: ${sent} чел.`)
  }
}
