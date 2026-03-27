import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, LessThan, MoreThan } from 'typeorm'
import { Task, TaskStatus } from '../tasks/task.entity'
import { NotificationsService } from '../notifications/notifications.service'
import { NotificationType } from '../notifications/notification.entity'

@Injectable()
export class DeadlineScheduler {
  private readonly logger = new Logger(DeadlineScheduler.name)

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async notifyUpcomingDeadlines() {
    this.logger.log('Checking upcoming deadlines...')

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(23, 59, 59, 999)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tasks = await this.taskRepo.find({
      where: {
        deadline: LessThan(tomorrow),
        status: TaskStatus.IN_PROGRESS,
      },
      relations: ['assignee'],
    })

    for (const task of tasks) {
      if (!task.assigneeId) continue

      const isOverdue = new Date(task.deadline) < new Date()
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.DEADLINE_APPROACHING,
        title: isOverdue ? '⚠️ Задача просрочена!' : '🔔 Дедлайн завтра',
        message: `Задача "${task.title}" ${isOverdue ? 'просрочена' : 'должна быть выполнена завтра'}`,
        link: `/tasks/${task.id}`,
      })
    }

    this.logger.log(`Sent ${tasks.length} deadline notifications`)
  }
}
