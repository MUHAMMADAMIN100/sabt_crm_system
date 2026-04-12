import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between, LessThan, Not, In } from 'typeorm'
import { Task, TaskStatus } from '../tasks/task.entity'
import { Employee } from '../employees/employee.entity'
import { Project, ProjectStatus } from '../projects/project.entity'
import { NotificationsService } from '../notifications/notifications.service'
import { NotificationType } from '../notifications/notification.entity'
import { MailService } from '../mail/mail.service'
import { TelegramService } from '../telegram/telegram.service'
import { ActivityLog, ActivityAction } from '../activity-log/activity-log.entity'

@Injectable()
export class DeadlineScheduler {
  private readonly logger = new Logger(DeadlineScheduler.name)

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(ActivityLog) private activityLogRepo: Repository<ActivityLog>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
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

  // ── 2. Overdue tasks (daily at 00:05) ─────────────────────────────────────
  @Cron('5 0 * * *')
  async notifyOverdueTasks() {
    this.logger.log('Checking overdue tasks...')

    const overdue = await this.taskRepo.find({
      where: {
        deadline: LessThan(new Date()),
        status: Not(In([TaskStatus.DONE, TaskStatus.CANCELLED])),
      },
      relations: ['assignee', 'project'],
    })

    let sent = 0
    for (const task of overdue) {
      if (!task.assigneeId) continue

      // Notify assignee
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.TASK_OVERDUE,
        title: '🔴 Задача просрочена',
        message: `"${task.title}" — дедлайн пропущен`,
        link: `/tasks/${task.id}`,
      })

      // Notify project manager if project has one
      if (task.project?.managerId && task.project.managerId !== task.assigneeId) {
        await this.notificationsService.create({
          userId: task.project.managerId,
          type: NotificationType.TASK_OVERDUE,
          title: '🔴 Просрочка в команде',
          message: `Задача "${task.title}"${task.assignee ? ` (${task.assignee.name})` : ''} просрочена`,
          link: `/tasks/${task.id}`,
          data: { assigneeName: task.assignee?.name },
        })
      }

      sent++
    }

    this.logger.log(`Sent ${sent} overdue notifications`)
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
        message: `Проект "${project.name}" создан 2 недели назад. Остаток: ${remaining.toLocaleString('ru')} сум. Запросите оплату у клиента.`,
        link: projectUrl,
        data: { projectId: project.id, budget, paid, remaining },
      })

      if (project.salesManager?.email) {
        await this.telegramService.sendToUser(
          project.salesManagerId,
          `💰 <b>Напоминание об оплате</b>\n\n` +
          `Проект: <b>${project.name}</b>\n` +
          `Бюджет: ${budget.toLocaleString('ru')} сум\n` +
          `Оплачено: ${paid.toLocaleString('ru')} сум\n` +
          `Остаток: <b>${remaining.toLocaleString('ru')} сум</b>\n\n` +
          `Пожалуйста, запросите оставшуюся сумму у клиента.\n\n` +
          `👉 ${this.telegramService.appUrl}${projectUrl}`,
        )
      }

      sent++
    }

    this.logger.log(`Sent ${sent} payment reminders`)
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
}
