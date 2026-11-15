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

/** «Продажи, этап 2» (15.11.2026, SALES_SPEC §6): дела по своим лидам в
 *  утреннем плане и вечернем разборе менеджера продаж. */
const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev']
/** Активные этапы единой воронки (лиды на паузе пропускаем отдельно). */
const ACTIVE_LEAD_STATUSES = ['new', 'waiting', 'meeting', 'proposal', 'contract']
/** Сколько строк по лидам показываем в сообщении — дальше «и ещё N». */
const LEAD_LINES_MAX = 10
/** «Без касания»: столько дней без активности по лиду. */
const STALE_DAYS = 7

export type LeadDueKind = 'meeting' | 'callback' | 'next_step'
/** Дело по лиду: встреча без итога, перезвон или следующий шаг. */
export interface LeadDueItem { leadId: string; ownerId: string; name: string; kind: LeadDueKind; at: Date; note: string | null }

const LEAD_DUE_LABEL: Record<LeadDueKind, string> = {
  meeting: 'Встреча без итога',
  callback: 'Перезвонить',
  next_step: 'Шаг',
}
const LEAD_DUE_ICON: Record<LeadDueKind, string> = { meeting: '🤝', callback: '📞', next_step: '➡️' }

/** «14.11 15:00» по Душанбе — у просроченного важен и день. */
const dayTime = (d: Date) => {
  const day = new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: TZ })
  return `${day} ${leadTime(d)}`
}

/** Строки дел по лидам: первые LEAD_LINES_MAX и «…и ещё N». Сообщение
 *  Telegram ограничено 4096 символами, а просрочек у менеджера бывают сотни. */
export function leadDueLines(items: LeadDueItem[], withDay: boolean, max = LEAD_LINES_MAX): string[] {
  const lines = items.slice(0, max).map(it => {
    const when = withDay ? dayTime(it.at) : leadTime(it.at)
    const note = it.kind === 'next_step' && it.note ? ` — ${esc(String(it.note).slice(0, 80))}` : ''
    return `${LEAD_DUE_ICON[it.kind]} <b>${when}</b> — ${LEAD_DUE_LABEL[it.kind]}: ${esc(it.name)}${note}`
  })
  if (items.length > max) lines.push(`…и ещё ${items.length - max}`)
  return lines
}

/**
 * SQL: дела по активным лидам менеджеров продаж (владелец — активный МП
 * основной или второй ролью; этап new…contract; не на паузе). Имена колонок
 * — из сущности ClientLead (camelCase в кавычках).
 *  $1 — роли продаж; встреча (nextContactAt без итога) и перезвон
 *  (repeatCallAt) — в [$2, $3); следующий шаг (nextStepAt) — в [$4, $5);
 *  $6 — «не сделано»: по перезвону и шагу с их времени не было активности
 *  (lastActivityAt), у встречи «сделано» — это отмеченный итог.
 */
const LEAD_DUE_SQL = `
  WITH mine AS (
    SELECT cl.id, cl.name, cl."ownerId" AS owner, cl."nextStep" AS note,
           cl."nextContactAt", cl."meetingResult", cl."repeatCallAt", cl."nextStepAt", cl."lastActivityAt"
      FROM client_leads cl
      JOIN users u ON u.id = cl."ownerId"
     WHERE cl.status::text = ANY($7::text[])
       AND COALESCE(cl."onHold", false) = false
       AND u."isActive" = true
       AND (u.role::text = ANY($1::text[]) OR u."secondaryRole"::text = ANY($1::text[]))
  )
  SELECT id, name, owner, 'meeting' AS kind, "nextContactAt" AS at, NULL::text AS note FROM mine
   WHERE "nextContactAt" >= $2 AND "nextContactAt" < $3 AND "meetingResult" IS NULL
  UNION ALL
  SELECT id, name, owner, 'callback', "repeatCallAt", NULL::text FROM mine
   WHERE "repeatCallAt" >= $2 AND "repeatCallAt" < $3
     AND (NOT $6::boolean OR "lastActivityAt" IS NULL OR "lastActivityAt" < "repeatCallAt")
  UNION ALL
  SELECT id, name, owner, 'next_step', "nextStepAt", note FROM mine
   WHERE "nextStepAt" >= $4 AND "nextStepAt" < $5
     AND (NOT $6::boolean OR "lastActivityAt" IS NULL OR "lastActivityAt" < "nextStepAt")
  ORDER BY at ASC`

/** SQL: сколько активных лидов у каждого МП без касания STALE_DAYS+ дней
 *  (lastActivityAt; у лида без отметок — дата создания). $1 — роли, $2 —
 *  граница, $3 — активные этапы. */
const LEAD_STALE_SQL = `
  SELECT cl."ownerId" AS owner, COUNT(*)::int AS n
    FROM client_leads cl
    JOIN users u ON u.id = cl."ownerId"
   WHERE cl.status::text = ANY($3::text[])
     AND COALESCE(cl."onHold", false) = false
     AND u."isActive" = true
     AND (u.role::text = ANY($1::text[]) OR u."secondaryRole"::text = ANY($1::text[]))
     AND COALESCE(cl."lastActivityAt", cl."createdAt") < $2
   GROUP BY cl."ownerId"`

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

  /** Дела по своим лидам менеджеров продаж (15.11.2026), по владельцу.
   *  Best-effort, как и leadsBetween: сбой не глушит напоминания по задачам.
   *  meetings — окно встреч и перезвонов, steps — окно следующих шагов,
   *  undone — только то, что после своего времени не трогали (вечер). */
  private async leadDue(meetings: { from: Date; to: Date }, steps: { from: Date; to: Date }, undone: boolean): Promise<Map<string, LeadDueItem[]>> {
    const out = new Map<string, LeadDueItem[]>()
    try {
      const rows: any[] = await this.leadRepo.manager.query(LEAD_DUE_SQL, [
        SALES_ROLES, meetings.from, meetings.to, steps.from, steps.to, undone, ACTIVE_LEAD_STATUSES,
      ])
      for (const r of rows || []) {
        if (!r?.owner || !r?.at) continue
        const it: LeadDueItem = {
          leadId: String(r.id), ownerId: String(r.owner), name: String(r.name || '').trim() || 'Клиент',
          kind: r.kind as LeadDueKind, at: new Date(r.at), note: r.note ?? null,
        }
        const list = out.get(it.ownerId) || []
        list.push(it)
        out.set(it.ownerId, list)
      }
    } catch (e: any) {
      this.logger.warn(`Дела по лидам не прочитаны: ${e?.message || e}`)
    }
    return out
  }

  /** Сколько активных лидов без касания STALE_DAYS+ дней — по владельцу. */
  private async staleLeads(now: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    try {
      const since = new Date(now.getTime() - STALE_DAYS * 86400_000)
      const rows: any[] = await this.leadRepo.manager.query(LEAD_STALE_SQL, [SALES_ROLES, since, ACTIVE_LEAD_STATUSES])
      for (const r of rows || []) if (r?.owner && Number(r.n) > 0) out.set(String(r.owner), Number(r.n))
    } catch (e: any) {
      this.logger.warn(`Лиды без касания не посчитаны: ${e?.message || e}`)
    }
    return out
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
  /** С 15.11.2026 менеджеру продаж — ещё просроченное по своим активным
   *  лидам (встречи без итога, перезвоны и шаги со временем в прошлом) и
   *  число лидов без касания 7+ дней. Сегодняшние встречи и перезвоны уже
   *  в плане выше (fetchLeadAgenda), поэтому в «просрочено» — только
   *  вчерашние и раньше; шаги — всё, что раньше этой минуты. */
  @Cron('0 9 * * *', { timeZone: TZ })
  async morningAgenda() {
    const now = new Date()
    const { start, end } = this.dushanbeDayBounds(now)
    const entries = await this.entriesBetween(start, end)
    const leads = await this.leadsBetween(start, end)
    const epoch = new Date(0)
    const overdue = await this.leadDue({ from: epoch, to: start }, { from: epoch, to: now }, false)
    const stale = await this.staleLeads(now)
    if (entries.length === 0 && leads.length === 0 && overdue.size === 0 && stale.size === 0) {
      this.logger.log('Утренняя сводка: на сегодня записей нет'); return
    }

    const byUser = new Map<string, { items: Task[]; own: LeadAgendaItem[] }>()
    const slot = (id: string) => {
      let s = byUser.get(id)
      if (!s) { s = { items: [], own: [] }; byUser.set(id, s) }
      return s
    }
    for (const t of entries) slot(t.assigneeId!).items.push(t)
    for (const l of leads) slot(l.ownerId).own.push(l)
    for (const id of [...overdue.keys(), ...stale.keys()]) slot(id)

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
      const late = overdue.get(userId) || []
      const staleCount = stale.get(userId) || 0
      const parts: string[] = []
      if (rows.length) {
        if (items.length - taskMeetings > 0 || (meetings === 0 && calls === 0)) parts.push(`Задач: ${items.length - taskMeetings}`)
        if (meetings > 0) parts.push(`Встреч: ${meetings}`)
        if (calls > 0) parts.push(`Звонков: ${calls}`)
      }
      if (late.length) parts.push(`Просрочено по клиентам: ${late.length}`)
      if (staleCount) parts.push(`Без касания ${STALE_DAYS}+ дн.: ${staleCount}`)
      const summary = parts.join(' · ')

      // Блок продаж — после плана дня, ограниченного размера.
      const sales: string[] = []
      if (late.length) sales.push(`⚠️ <b>Просрочено по клиентам: ${late.length}</b>`, ...leadDueLines(late, true))
      if (staleCount) sales.push(`💤 Без касания ${STALE_DAYS}+ дней: <b>${staleCount}</b> ${staleCount === 1 ? 'клиент' : 'клиентов'}`)
      const body = [lines, sales.join('\n')].filter(Boolean).join('\n\n')

      await this.push(
        userId,
        '📅 План на сегодня',
        summary,
        `📅 <b>План на сегодня</b>\n${summary}\n\n${body}\n\n👉 ${this.telegram.appUrl}/calendar`,
        undefined,
        rows.length ? undefined : '/clients',
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
  /** С 15.11.2026 менеджеру продаж — ещё невыполненное за сегодня по своим
   *  активным лидам: встречи без итога, перезвоны и шаги, время которых
   *  сегодня уже прошло, а лид с тех пор не трогали и не перенесли. */
  @Cron('0 18 * * *', { timeZone: TZ })
  async eveningUnfinished() {
    const now = new Date()
    const { start, end } = this.dushanbeDayBounds(now)
    const entries = await this.entriesBetween(start, end)
    const today = { from: start, to: now }
    const leadsLeft = await this.leadDue(today, today, true)
    if (entries.length === 0 && leadsLeft.size === 0) return

    const byUser = new Map<string, Task[]>()
    for (const t of entries) {
      const arr = byUser.get(t.assigneeId!) || []
      arr.push(t)
      byUser.set(t.assigneeId!, arr)
    }
    for (const id of leadsLeft.keys()) if (!byUser.has(id)) byUser.set(id, [])

    let sent = 0
    for (const [userId, items] of byUser) {
      const left = leadsLeft.get(userId) || []
      // Одна запись без дел по лидам — конкретное сообщение с кнопками;
      // иначе — списком.
      if (items.length === 1 && left.length === 0) {
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
        const total = items.length + left.length
        const clients = left.length
          ? `👥 <b>По клиентам: ${left.length}</b>\n${leadDueLines(left, false).join('\n')}`
          : ''
        const body = [lines, clients].filter(Boolean).join('\n\n')
        await this.push(
          userId,
          'Не закрыто сегодня',
          `Осталось ${total}`,
          `🌙 <b>Не закрыто сегодня</b>\nОсталось: <b>${total}</b>\n\n${body}\n\n👉 ${this.telegram.appUrl}/calendar`,
          undefined,
          items.length ? undefined : '/clients',
        )
      }
      sent++
    }
    this.logger.log(`Вечерний разбор отправлен: ${sent} чел.`)
  }
}
