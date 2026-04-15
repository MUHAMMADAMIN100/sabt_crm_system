import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between, LessThan, Not, In } from 'typeorm'
import { Task, TaskStatus } from '../tasks/task.entity'
import { Employee } from '../employees/employee.entity'
import { Project, ProjectStatus } from '../projects/project.entity'
import { User, UserRole } from '../users/user.entity'
import { NotificationsService } from '../notifications/notifications.service'
import { NotificationType } from '../notifications/notification.entity'
import { MailService } from '../mail/mail.service'
import { TelegramService } from '../telegram/telegram.service'
import { ActivityLog, ActivityAction } from '../activity-log/activity-log.entity'

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  returned: 'Возвращена',
  done: 'Готово',
  cancelled: 'Отменена',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: '🟢 Низкий',
  medium: '🟡 Средний',
  high: '🟠 Высокий',
  critical: '🔴 Критический',
}

const STATUS_ICON: Record<string, string> = {
  new: '🆕',
  in_progress: '⚙️',
  review: '🔍',
  returned: '↩️',
  done: '✅',
  cancelled: '⛔',
}

@Injectable()
export class DeadlineScheduler implements OnModuleInit {
  private readonly logger = new Logger(DeadlineScheduler.name)

  /** Run a one-shot cleanup at boot so existing orphan notifications
   *  (created before the cascade-delete fix) get cleared without waiting
   *  for the daily cron. */
  async onModuleInit() {
    try {
      const removed = await this.cleanupOrphanTaskNotifications()
      if (removed > 0) this.logger.log(`Boot cleanup: removed ${removed} orphan task notifications`)
    } catch (e: any) {
      this.logger.warn(`Boot cleanup failed: ${e?.message}`)
    }
  }

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(ActivityLog) private activityLogRepo: Repository<ActivityLog>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private telegramService: TelegramService,
  ) {}

  // ── 1. Deadline reminder (daily at 9am) ───────────────────────────────────
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async notifyUpcomingDeadlines() {
    this.logger.log('Checking upcoming deadlines...')

    const now = new Date()
    const in3days = new Date(now)
    in3days.setDate(in3days.getDate() + 3)
    in3days.setHours(23, 59, 59, 999)

    const tomorrow = new Date(now)
    tomorrow.setHours(0, 0, 0, 0)

    const tasks = await this.taskRepo.find({
      where: {
        deadline: Between(tomorrow, in3days),
        status: Not(In([TaskStatus.DONE, TaskStatus.CANCELLED])),
      },
      relations: ['assignee', 'project'],
    })

    let sent = 0
    for (const task of tasks) {
      if (!task.assigneeId || !task.assignee) continue

      const deadlineDate = new Date(task.deadline)
      const msLeft = deadlineDate.getTime() - now.getTime()
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
      if (daysLeft < 1 || daysLeft > 3) continue

      const deadlineStr = deadlineDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const projectName = task.project?.name || '—'

      const type = daysLeft === 1 ? NotificationType.DEADLINE_TOMORROW : NotificationType.DEADLINE_APPROACHING

      await this.notificationsService.create({
        userId: task.assigneeId,
        type,
        title: `⏰ Дедлайн через ${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}`,
        message: `Задача "${task.title}" — дедлайн ${deadlineStr}`,
        link: `/tasks/${task.id}`,
      })

      if (task.assignee.email) {
        await this.mailService.sendDeadlineReminder(
          task.assignee.email,
          task.assignee.name,
          task.title,
          task.id,
          projectName,
          deadlineStr,
          daysLeft,
        )
      }

      const tgText = `⏰ <b>Напоминание о дедлайне</b>\n\nЗадача: <b>${task.title}</b>\nПроект: ${projectName}\nДедлайн: <b>${deadlineStr}</b>\nОсталось: <b>${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}</b>`
      await this.telegramService.sendToUser(task.assigneeId, tgText)

      sent++
    }

    this.logger.log(`Sent ${sent} deadline reminders`)
  }

  // ── 2. Overdue tasks (daily at 18:00 Dushanbe) ────────────────────────────
  @Cron('0 18 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyOverdueTasks() {
    this.logger.log('Checking overdue tasks...')

    const now = new Date()
    const overdue = await this.taskRepo.find({
      where: {
        deadline: LessThan(now),
        status: Not(In([TaskStatus.DONE, TaskStatus.CANCELLED])),
      },
      relations: ['assignee', 'project', 'project.manager'],
    })

    // Lookup founder/co-founder once (for escalation). Notify all if there are many.
    const founders = await this.userRepo.find({ where: [
      { role: UserRole.FOUNDER, isActive: true },
      { role: UserRole.CO_FOUNDER, isActive: true },
    ] })

    let sent = 0
    let escalated = 0

    for (const task of overdue) {
      if (!task.assigneeId) continue

      const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(task.deadline).getTime()) / 86400000))
      const deadlineStr = new Date(task.deadline).toLocaleDateString('ru-RU')
      const taskLink = `/tasks/${task.id}`
      const projectName = task.project?.name || '—'
      const assigneeName = task.assignee?.name || 'без исполнителя'
      const statusLabel = `${STATUS_ICON[task.status] || ''} ${STATUS_LABELS[task.status] || task.status}`
      const priorityLabel = PRIORITY_LABELS[task.priority] || ''
      const loggedHours = Number(task.loggedHours || 0)
      const daysWord = daysOverdue === 1 ? 'день' : daysOverdue < 5 ? 'дня' : 'дней'

      // Skip email/TG spam for very long overdue — keep only in-app after 14 days
      const sendExternal = daysOverdue <= 14

      // Common Telegram detail block (re-used per recipient)
      const detailBlock =
        `📝 <b>${task.title}</b>\n` +
        `📁 Проект: ${projectName}\n` +
        `📊 Статус: ${statusLabel}\n` +
        `🎯 Приоритет: ${priorityLabel}\n` +
        `⏱ Залогировано: <b>${loggedHours}ч</b>\n` +
        `📅 Дедлайн был: <b>${deadlineStr}</b>\n` +
        `🔥 Просрочено: <b>${daysOverdue} ${daysWord}</b>`

      // ── Notify ASSIGNEE ─────────────────────────────────────────
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.TASK_OVERDUE,
        title: '🔴 Задача просрочена',
        message: `"${task.title}" — ${daysOverdue} ${daysWord} · ${STATUS_LABELS[task.status]} · ${loggedHours}ч`,
        link: taskLink,
        data: { daysOverdue, taskId: task.id, status: task.status, priority: task.priority, loggedHours },
      })
      if (sendExternal && task.assignee?.email) {
        await this.mailService.sendOverdueTask(
          task.assignee.email, task.assignee.name,
          task.title, task.id, projectName, deadlineStr, daysOverdue, 'assignee',
          undefined, task.status, task.priority, loggedHours,
        )
      }
      if (sendExternal) {
        await this.telegramService.sendToUser(
          task.assigneeId,
          `🔴 <b>Ваша задача просрочена</b>\n\n${detailBlock}\n\n👉 ${this.telegramService.appUrl}${taskLink}`,
        )
      }

      // ── Notify PM ───────────────────────────────────────────────
      const pmId = task.project?.managerId
      if (pmId && pmId !== task.assigneeId) {
        await this.notificationsService.create({
          userId: pmId,
          type: NotificationType.TASK_OVERDUE,
          title: '🔴 Просрочка в команде',
          message: `${assigneeName} — "${task.title}" · ${daysOverdue} ${daysWord} · ${STATUS_LABELS[task.status]} · ${loggedHours}ч`,
          link: taskLink,
          data: { assigneeName, daysOverdue, taskId: task.id, status: task.status, priority: task.priority, loggedHours },
        })
        const pm = task.project?.manager
        if (sendExternal && pm?.email) {
          await this.mailService.sendOverdueTask(
            pm.email, pm.name,
            task.title, task.id, projectName, deadlineStr, daysOverdue, 'manager',
            assigneeName, task.status, task.priority, loggedHours,
          )
        }
        if (sendExternal) {
          await this.telegramService.sendToUser(
            pmId,
            `🔴 <b>Просрочка в команде</b>\n\n` +
            `👤 Исполнитель: <b>${assigneeName}</b>\n${detailBlock}\n\n👉 ${this.telegramService.appUrl}${taskLink}`,
          )
        }
      }

      // ── Escalate to FOUNDER after 3 days overdue ────────────────
      if (daysOverdue >= 3 && daysOverdue <= 14) {
        for (const founder of founders) {
          if (founder.id === task.assigneeId || founder.id === pmId) continue
          await this.notificationsService.create({
            userId: founder.id,
            type: NotificationType.TASK_OVERDUE,
            title: '⚠️ Серьёзная просрочка',
            message: `${assigneeName} — "${task.title}" (${projectName}) · ${daysOverdue} ${daysWord} · ${STATUS_LABELS[task.status]}`,
            link: taskLink,
            data: { assigneeName, projectName, daysOverdue, taskId: task.id, status: task.status, priority: task.priority, loggedHours, escalation: true },
          })
          if (founder.email) {
            await this.mailService.sendOverdueTask(
              founder.email, founder.name,
              task.title, task.id, projectName, deadlineStr, daysOverdue, 'founder',
              assigneeName, task.status, task.priority, loggedHours,
            )
          }
          await this.telegramService.sendToUser(
            founder.id,
            `⚠️ <b>Серьёзная просрочка</b>\n\n` +
            `👤 Исполнитель: <b>${assigneeName}</b>\n${detailBlock}\n\n👉 ${this.telegramService.appUrl}${taskLink}`,
          )
        }
        escalated++
      }

      sent++
    }

    this.logger.log(`Sent ${sent} overdue notifications, ${escalated} escalated to founder`)
  }

  // ── 3. Inactivity check (every 2 hours) ───────────────────────────────────
  @Cron('0 */2 * * *')
  async checkInactivity() {
    this.logger.log('Checking employee inactivity...')

    const threshold = new Date()
    threshold.setHours(threshold.getHours() - 24)

    // Find employees with lastActiveAt older than 24h or null (registered > 1 day ago)
    const inactive = await this.employeeRepo
      .createQueryBuilder('e')
      .leftJoin('e.user', 'u')
      .where('e.status = :status', { status: 'active' })
      .andWhere('u.isActive = true')
      .andWhere('(e.lastActiveAt IS NULL OR e.lastActiveAt < :threshold)', { threshold })
      .andWhere('u.createdAt < :threshold', { threshold })
      .leftJoinAndSelect('e.user', 'user')
      .getMany()

    for (const emp of inactive) {
      if (!emp.managerId || !emp.user) continue

      await this.notificationsService.create({
        userId: emp.managerId,
        type: NotificationType.INACTIVITY_24H,
        title: '⚠️ Сотрудник не активен',
        message: `${emp.fullName} не проявлял активности более 24 часов`,
        link: `/employees/${emp.id}`,
        data: { employeeId: emp.id, employeeName: emp.fullName },
      })
    }

    this.logger.log(`Inactivity check done, found ${inactive.length} inactive employees`)
  }

  // ── 4. Recalculate activity scores (daily at 23:50) ───────────────────────
  @Cron('50 23 * * *')
  async recalculateActivityScores() {
    this.logger.log('Recalculating activity scores...')

    const employees = await this.employeeRepo.find({
      where: { status: 'active' as any },
      relations: ['user'],
    })

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    for (const emp of employees) {
      if (!emp.userId) continue

      // Count positive actions in last 30 days
      const positiveActions = [
        ActivityAction.TASK_STATUS,
        ActivityAction.TASK_RESULT_SUBMIT,
        ActivityAction.TASK_REVIEW_APPROVE,
        ActivityAction.REPORT_CREATE,
        ActivityAction.FILE_UPLOAD,
      ]

      const negativeActions = [
        ActivityAction.TASK_REVIEW_RETURN,
      ]

      const positive = await this.activityLogRepo.count({
        where: {
          userId: emp.userId,
          action: In(positiveActions),
          createdAt: Between(thirtyDaysAgo, new Date()),
        },
      })

      const negative = await this.activityLogRepo.count({
        where: {
          userId: emp.userId,
          action: In(negativeActions),
          createdAt: Between(thirtyDaysAgo, new Date()),
        },
      })

      // Count overdue tasks assigned to this employee
      const overdueCount = await this.taskRepo.count({
        where: {
          assigneeId: emp.userId,
          deadline: LessThan(new Date()),
          status: Not(In([TaskStatus.DONE, TaskStatus.CANCELLED])),
        },
      })

      // Score formula: (positive * 10 - negative * 10 - overdue * 20) normalized to 0-100
      const rawScore = positive * 10 - negative * 10 - overdueCount * 20
      const score = Math.max(0, Math.min(100, rawScore))

      // Count completed and overdue tasks (denormalized)
      const tasksCompleted = await this.taskRepo.count({
        where: { assigneeId: emp.userId, status: TaskStatus.DONE },
      })

      await this.employeeRepo.update(emp.id, {
        activityScore: score,
        tasksCompleted,
        tasksOverdue: overdueCount,
      })
    }

    this.logger.log('Activity scores recalculated')
  }

  // ── 5. Payment reminder for sales manager (daily at 9am) ──────────────────
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async notifyPaymentReminder() {
    this.logger.log('Checking payment reminders for projects...')

    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

    // Projects created exactly 14 days ago (±1 day window) that have a salesManagerId and unpaid balance
    const dayStart = new Date(twoWeeksAgo)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(twoWeeksAgo)
    dayEnd.setHours(23, 59, 59, 999)

    const projects = await this.projectRepo.find({
      where: {
        createdAt: Between(dayStart, dayEnd) as any,
        isArchived: false,
        status: Not(ProjectStatus.COMPLETED) as any,
      },
      relations: ['salesManager'],
    })

    let sent = 0
    for (const project of projects) {
      if (!project.salesManagerId) continue

      const budget = project.budget || 0
      const paid = Number(project.paidAmount) || 0
      const remaining = budget - paid

      if (remaining <= 0) continue // Already fully paid

      const projectUrl = `/projects/${project.id}`
      await this.notificationsService.create({
        userId: project.salesManagerId,
        type: NotificationType.PAYMENT_REMINDER,
        title: '💰 Напоминание об оплате',
        message: `Проект "${project.name}" создан 2 недели назад. Остаток: ${remaining.toLocaleString('ru')} сомони. Запросите оплату у клиента.`,
        link: projectUrl,
        data: { projectId: project.id, budget, paid, remaining },
      })

      if (project.salesManager?.email) {
        await this.telegramService.sendToUser(
          project.salesManagerId,
          `💰 <b>Напоминание об оплате</b>\n\n` +
          `Проект: <b>${project.name}</b>\n` +
          `Бюджет: ${budget.toLocaleString('ru')} сомони\n` +
          `Оплачено: ${paid.toLocaleString('ru')} сомони\n` +
          `Остаток: <b>${remaining.toLocaleString('ru')} сомони</b>\n\n` +
          `Пожалуйста, запросите оставшуюся сумму у клиента.\n\n` +
          `👉 ${this.telegramService.appUrl}${projectUrl}`,
        )
      }

      sent++
    }

    this.logger.log(`Sent ${sent} payment reminders`)
  }

  // ── 7. Daily 18:00 Dushanbe — remind PMs about uncompleted tasks ─────────
  @Cron('0 18 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyDailyUncompleted() {
    this.logger.log('Daily 18:00 Dushanbe — collecting uncompleted tasks by project...')

    // "Today" in Dushanbe (UTC+5). Compute explicit window in UTC.
    const now = new Date()
    const dushanbeNow = new Date(now.getTime() + 5 * 60 * 60 * 1000)
    const yyyy = dushanbeNow.getUTCFullYear()
    const mm = dushanbeNow.getUTCMonth()
    const dd = dushanbeNow.getUTCDate()
    // 00:00 Dushanbe today  = yesterday 19:00 UTC
    const dayStart = new Date(Date.UTC(yyyy, mm, dd, 0, 0, 0) - 5 * 60 * 60 * 1000)
    // 23:59:59 Dushanbe today = today 18:59:59 UTC
    const dayEnd = new Date(Date.UTC(yyyy, mm, dd, 23, 59, 59, 999) - 5 * 60 * 60 * 1000)
    const dateStr = dushanbeNow.toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    })

    // Include tasks overdue from earlier AND due today — as long as they weren't finished
    const tasks = await this.taskRepo.find({
      where: {
        deadline: LessThan(dayEnd),
        status: Not(In([TaskStatus.DONE, TaskStatus.CANCELLED])),
      },
      relations: ['assignee', 'project', 'project.manager'],
    })

    // Consider only tasks whose deadline is today in Dushanbe (not earlier ones — those
    // are handled by the daily overdue notifier). This job is the end-of-day verdict.
    const dueToday = tasks.filter(t => {
      const d = new Date(t.deadline)
      return d >= dayStart && d <= dayEnd
    })

    if (!dueToday.length) {
      this.logger.log('No uncompleted tasks today — staying silent')
      return
    }

    // Group by project manager
    const byManager = new Map<string, { managerId: string; managerEmail?: string; managerName?: string; projectName: string; items: typeof dueToday }>()
    for (const task of dueToday) {
      const pm = task.project?.manager
      if (!task.project || !pm?.id) continue
      const key = `${pm.id}:${task.project.id}`
      if (!byManager.has(key)) {
        byManager.set(key, {
          managerId: pm.id,
          managerEmail: pm.email,
          managerName: pm.name,
          projectName: task.project.name,
          items: [],
        })
      }
      byManager.get(key)!.items.push(task)
    }

    let sent = 0
    for (const group of byManager.values()) {
      const count = group.items.length
      const byStatus: Record<string, number> = {}
      let totalLogged = 0
      let critical = 0
      for (const t of group.items) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1
        totalLogged += Number(t.loggedHours || 0)
        if (t.priority === 'critical') critical++
      }
      const statusBreakdown = Object.entries(byStatus)
        .map(([s, n]) => `${STATUS_ICON[s] || '·'} ${STATUS_LABELS[s] || s}: <b>${n}</b>`).join(' · ')

      const visible = group.items.slice(0, 12)
      const overflow = count - visible.length
      const detailedLines = visible.map(t => {
        const prio = PRIORITY_LABELS[t.priority] || ''
        const status = `${STATUS_ICON[t.status] || ''} ${STATUS_LABELS[t.status] || t.status}`
        const hours = Number(t.loggedHours || 0)
        const hoursStr = hours > 0 ? ` · ⏱ ${hours}ч` : ''
        return `• <b>${t.title}</b>\n   👤 ${t.assignee?.name || 'без исполнителя'} · ${status} · ${prio}${hoursStr}`
      }).join('\n')
      const overflowLine = overflow > 0 ? `\n…и ещё ${overflow}` : ''

      const shortMessage = `Проект "${group.projectName}" — не выполнено ${count} задач${count === 1 ? 'а' : ''} за сегодня`

      // In-app notification (+ realtime via gateway inside NotificationsService)
      await this.notificationsService.create({
        userId: group.managerId,
        type: NotificationType.DAILY_UNCOMPLETED,
        title: '📋 Итоги дня: невыполненные задачи',
        message: shortMessage + (critical > 0 ? ` · 🔴 ${critical} критич.` : ''),
        link: `/tasks?overdue=true`,
        data: { projectName: group.projectName, count, date: dateStr, byStatus, totalLogged, critical },
      })

      // Email
      if (group.managerEmail) {
        await this.mailService.sendDailyUncompletedSummary(
          group.managerEmail,
          group.managerName || 'Менеджер',
          group.projectName,
          group.items.map(t => ({
            id: t.id,
            title: t.title,
            assigneeName: t.assignee?.name || 'без исполнителя',
            status: t.status,
            priority: t.priority,
            loggedHours: Number(t.loggedHours || 0),
          })),
          dateStr,
        )
      }

      // Telegram — full detail
      const tgText =
        `📋 <b>Итоги дня — невыполненные задачи</b>\n\n` +
        `📁 Проект: <b>${group.projectName}</b>\n` +
        `📅 Дата: ${dateStr}\n` +
        `📊 Не выполнено: <b>${count}</b> · ⏱ потрачено ${totalLogged}ч` +
        (critical > 0 ? ` · 🔴 ${critical} критич.` : '') +
        `\n${statusBreakdown}\n\n` +
        `<b>Подробно:</b>\n${detailedLines}${overflowLine}\n\n` +
        `👉 ${this.telegramService.appUrl}/tasks?overdue=true`
      await this.telegramService.sendToUser(group.managerId, tgText)

      sent++
    }

    this.logger.log(`Daily 20:00 summary sent to ${sent} project manager(s)`)
  }

  // ── 6. Notify PM about tasks pending review > 24h (daily at 10am) ─────────
  @Cron('0 10 * * *')
  async notifyPendingReview() {
    this.logger.log('Checking tasks pending review...')

    const oneDayAgo = new Date()
    oneDayAgo.setHours(oneDayAgo.getHours() - 24)

    const pendingReview = await this.taskRepo.find({
      where: {
        status: TaskStatus.REVIEW,
        updatedAt: LessThan(oneDayAgo),
      },
      relations: ['project', 'assignee'],
    })

    for (const task of pendingReview) {
      if (!task.project?.managerId) continue

      await this.notificationsService.create({
        userId: task.project.managerId,
        type: NotificationType.REVIEW_NEEDED,
        title: '🔍 Ожидает проверки',
        message: `Задача "${task.title}" ожидает проверки более 24 часов`,
        link: `/tasks/${task.id}`,
      })
    }

    this.logger.log(`Notified about ${pendingReview.length} long-pending reviews`)
  }

  // ── 9. Weekly digest (Monday 08:00 Dushanbe) ─────────────────────────────
  /** Every Monday 08:00 Dushanbe: for every active employee, send their weekly
   *  "what I did last 7 days" digest to them + to all admin/founder/PM users
   *  (one consolidated letter per recipient, employees grouped inside). */
  @Cron('0 8 * * 1', { timeZone: 'Asia/Dushanbe' })
  async weeklyDigest() {
    this.logger.log('Running weekly digest cron (Monday 08:00 Dushanbe)...')

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86400000)

    // Load all active employees with linked user
    const employees = await this.employeeRepo.find({
      where: { status: 'active' as any },
      relations: ['user'],
    })

    // Build per-employee weekly data: done tasks, total logged hours
    const rows = await Promise.all(employees.map(async emp => {
      if (!emp.userId) return null
      const doneTasks = await this.taskRepo
        .createQueryBuilder('t')
        .where('t.assigneeId = :uid', { uid: emp.userId })
        .andWhere('t.status = :s', { s: TaskStatus.DONE })
        .andWhere('t.reviewedAt >= :from', { from: weekAgo })
        .andWhere('t.reviewedAt <= :to', { to: now })
        .select(['t.id', 't.title', 't.loggedHours', 't.projectId'])
        .addSelect(['t.reviewedAt'])
        .getMany()
      const totalHours = doneTasks.reduce((s, t) => s + Number(t.loggedHours || 0), 0)
      return {
        employeeId: emp.id,
        userId: emp.userId,
        fullName: emp.fullName,
        email: emp.user?.email,
        doneCount: doneTasks.length,
        totalHours,
        tasks: doneTasks.map(t => ({ title: t.title, hours: Number(t.loggedHours || 0) })),
      }
    }))
    const stats = rows.filter((r): r is Exclude<typeof r, null> => r !== null)

    // ── 1. Send a personal summary to each employee (email + telegram + in-app)
    for (const row of stats) {
      if (row.doneCount === 0) continue // skip silent weeks
      const taskLines = row.tasks.slice(0, 10)
        .map(t => `• ${t.title}${t.hours > 0 ? ` (${t.hours}ч)` : ''}`)
        .join('\n')
      const overflow = row.tasks.length > 10 ? `\n…и ещё ${row.tasks.length - 10}` : ''

      await this.notificationsService.create({
        userId: row.userId,
        type: NotificationType.NEW_REPORT,
        title: '📅 Итоги недели',
        message: `Выполнено задач: ${row.doneCount} · Часов: ${row.totalHours}`,
        link: `/reports`,
      })
      if (row.email) {
        await this.mailService.sendWeeklyPersonalDigest(
          row.email, row.fullName, row.doneCount, row.totalHours, row.tasks,
        ).catch(() => {})
      }
      await this.telegramService.sendToUser(
        row.userId,
        `📅 <b>Итоги недели</b>\n\n` +
        `✅ Выполнено: <b>${row.doneCount}</b> задач\n` +
        `⏱ Часов: <b>${row.totalHours}</b>\n\n` +
        (taskLines ? `<b>Задачи:</b>\n${taskLines}${overflow}` : ''),
      ).catch(() => {})
    }

    // ── 2. Send consolidated team digest to every admin/founder/PM
    const supervisors = await this.userRepo.find({
      where: [
        { role: UserRole.ADMIN, isActive: true },
        { role: UserRole.FOUNDER, isActive: true },
        { role: UserRole.CO_FOUNDER, isActive: true },
        { role: UserRole.PROJECT_MANAGER, isActive: true },
        { role: UserRole.HEAD_SMM, isActive: true },
      ],
    })

    const teamData = stats
      .filter(s => s.doneCount > 0)
      .sort((a, b) => b.doneCount - a.doneCount)

    for (const sup of supervisors) {
      await this.notificationsService.create({
        userId: sup.id,
        type: NotificationType.NEW_REPORT,
        title: '📊 Недельный отчёт по команде',
        message: `Выполнено задач командой: ${teamData.reduce((s, r) => s + r.doneCount, 0)}`,
        link: `/reports`,
      })
      if (sup.email) {
        await this.mailService.sendWeeklyTeamDigest(
          sup.email, sup.name, teamData,
        ).catch(() => {})
      }
    }

    this.logger.log(`Weekly digest sent: ${stats.filter(r => r.doneCount > 0).length} employees, ${supervisors.length} supervisors`)
  }

  // ── 8. Cleanup orphan task notifications (daily at 03:00) ────────────────
  /** Removes notifications whose link points to a task that no longer exists.
   *  Returns the number of deleted rows. */
  async cleanupOrphanTaskNotifications(): Promise<number> {
    const result = await this.taskRepo.manager.query(`
      DELETE FROM notifications
      WHERE link LIKE '/tasks/%'
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.id::text = SUBSTRING(notifications.link FROM '/tasks/(.+)')
        )
    `)
    // pg driver returns [, count] for DELETE
    const count = Array.isArray(result) ? Number(result[1] ?? 0) : 0
    return count
  }

  @Cron('0 3 * * *')
  async dailyOrphanCleanup() {
    try {
      const removed = await this.cleanupOrphanTaskNotifications()
      this.logger.log(`Daily 03:00 cleanup: removed ${removed} orphan task notifications`)
    } catch (e: any) {
      this.logger.warn(`Daily orphan cleanup failed: ${e?.message}`)
    }
  }
}
