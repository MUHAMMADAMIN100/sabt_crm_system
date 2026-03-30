import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between } from 'typeorm'
import { Task, TaskStatus } from '../tasks/task.entity'
import { NotificationsService } from '../notifications/notifications.service'
import { NotificationType } from '../notifications/notification.entity'
import { MailService } from '../mail/mail.service'
import { TelegramService } from '../telegram/telegram.service'

@Injectable()
export class DeadlineScheduler {
  private readonly logger = new Logger(DeadlineScheduler.name)

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private telegramService: TelegramService,
  ) {}

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
        status: TaskStatus.IN_PROGRESS,
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

      // In-app notification
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.DEADLINE_APPROACHING,
        title: `⏰ Дедлайн через ${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}`,
        message: `Задача "${task.title}" — дедлайн ${deadlineStr}`,
        link: `/tasks/${task.id}`,
      })

      // Email
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

      // Telegram
      const tgText = `⏰ <b>Напоминание о дедлайне</b>\n\nЗадача: <b>${task.title}</b>\nПроект: ${projectName}\nДедлайн: <b>${deadlineStr}</b>\nОсталось: <b>${daysLeft} ${daysLeft === 1 ? 'день' : 'дня'}</b>`
      await this.telegramService.sendToUser(task.assigneeId, tgText)

      sent++
    }

    this.logger.log(`Sent ${sent} deadline reminders`)
  }
}
