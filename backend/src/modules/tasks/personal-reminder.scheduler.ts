import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between, In, Not } from 'typeorm'
import { Task, TaskStatus, TaskKind, TASK_CLOSED_FOR_OVERDUE } from './task.entity'
import { TasksService } from './tasks.service'
import { NotificationsService } from '../notifications/notifications.service'
import { NotificationType } from '../notifications/notification.entity'
import { TelegramService } from '../telegram/telegram.service'
import { ClientLead } from '../clients/client-lead.entity'
import {
  LeadAgendaItem, LEAD_AGENDA_ICON, LEAD_AGENDA_LABEL, fetchLeadAgenda, leadAgendaText, leadLink, leadTime,
} from '../clients/lead-agenda'

/** Компания работает по Душанбе (UTC+5). Крон-выражения ниже привязаны к
 *  этой зоне, а границы суток считаем явным сдвигом — сервер живёт в UTC. */
const TZ = 'Asia/Dushanbe'
const TZ_OFFSET_H = 5

/** Экранирование под HTML-разметку Telegram (имя клиента вводят руками). */
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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
 *
 * С 14.11.2026 в сводку 09:00 и «через час» попадают и встречи / повторные
 * звонки по своим клиентам (лиды): задачи под них у менеджера продаж нет,
 * а форма клиента обещает напоминание. См. clients/lead-agenda.
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
    @InjectRepository(ClientLead) private leadRepo: Repository<ClientLead>,
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

  /** Встречи и звонки по своим клиентам в окне. Best-effort: сбой запроса
   *  по лидам не должен глушить напоминания по задачам. */
  private leadsBetween(from: Date, to: Date): Promise<LeadAgendaItem[]> {
    return fetchLeadAgenda(this.leadRepo, this.taskRepo, from, to).catch((e: any) => {
      this.logger.warn(`Лиды для напоминаний не прочитаны: ${e?.message || e}`)
      return [] as LeadAgendaItem[]
    })
  }

  /** in-app + Telegram одному человеку. Оба канала best-effort: молчание
   *  бота не должно ронять крон для остальных. link — своя ссылка (клиент). */
  private async push(userId: string, title: string, message: string, text: string, taskId?: string, link?: string) {
    await this.notifications.create({
      userId,
      type: NotificationType.DEADLINE_TOMORROW,
      title,
      message,
      link: link || (taskId ? `/tasks/${taskId}` : '/calendar'),
    } as any).catch(() => {})
    await this.telegram.sendToUser(userId, text, taskId ? this.tasks.publicTaskButtons(taskId) : undefined)
      .catch(() => {})
  }

  // ── 1. Утренняя сводка: что сегодня ──────────────────────────────────
  @Cron('0 9 * * *', { timeZone: TZ })
  async morningAgenda() {
    const { start, end } = this.dushanbeDayBounds()
    const entries = await this.entriesBetween(start, end)
    const leads = await this.leadsBetween(start, end)
    if (entries.length === 0 && leads.length === 0) { this.logger.log('Утренняя сводка: на сегодня записей нет'); return }

    const byUser = new Map<string, { items: Task[]; own: LeadAgendaItem[] }>()
    const slot = (id: string) => {
      let s = byUser.get(id)
      if (!s) { s = { items: [], own: [] }; byUser.set(id, s) }
      return s
    }
    for (const t of entries) slot(t.assigneeId!).items.push(t)
    for (const l of leads) slot(l.ownerId).own.push(l)

    let sent = 0
    for (const [userId, { items, own }] of byUser) {
      // Задачи и клиенты — одним списком по времени.
      const rows: Array<{ at: number; line: string }> = items.map(t => {
        const time = new Date(t.deadline).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
        const icon = t.kind === TaskKind.MEETING ? '🤝' : '📌'
        // Пользовательский текст — только через esc (15.11.2026).
        const place = t.kind === TaskKind.MEETING && t.location ? ` · 📍 ${esc(t.location)}` : ''
        const proj = t.project?.name ? ` · ${esc(t.project.name)}` : ''
        return { at: new Date(t.deadline).getTime(), line: `${icon} <b>${time}</b> — ${esc(t.title)}${place}${proj}` }
      })
      for (const l of own) {
        rows.push({
          at: l.at.getTime(),
          line: `${LEAD_AGENDA_ICON[l.kind]} <b>${leadTime(l.at)}</b> — ${LEAD_AGENDA_LABEL[l.kind]}: ${esc(l.name)}`,
        })
      }
      rows.sort((a, b) => a.at - b.at)
      const lines = rows.map(r => r.line).join('\n')

      const taskMeetings = items.filter(t => t.kind === TaskKind.MEETING).length
      const meetings = taskMeetings + own.filter(l => l.kind === 'meeting').length
      const calls = own.filter(l => l.kind === 'call').length
      const parts: string[] = []
      if (items.length - taskMeetings > 0 || (meetings === 0 && calls === 0)) parts.push(`Задач: ${items.length - taskMeetings}`)
      if (meetings > 0) parts.push(`Встреч: ${meetings}`)
      if (calls > 0) parts.push(`Звонков: ${calls}`)
      const summary = parts.join(' · ')

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

    // Встречи и повторные звонки по своим клиентам: тот же дедуп в памяти,
    // ключ — вид + лид + время (перенесли встречу — напомним снова).
    const leads = await this.leadsBetween(from, to)
    for (const l of leads) {
      const key = `lead:${l.kind}:${l.leadId}:${l.at.getTime()}`
      if (this.soonSent.has(key)) continue
      this.soonSent.add(key)

      const text = leadAgendaText(l)
      const link = leadLink(l.leadId)
      await this.push(
        l.ownerId,
        l.kind === 'meeting' ? '⏰ Встреча через час' : '⏰ Звонок через час',
        text,
        `⏰ <b>Через час</b>\n${esc(text)}\n\n👉 ${this.telegram.appUrl}${link}`,
        undefined,
        link,
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
          return `${icon} ${esc(t.title)}`
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
