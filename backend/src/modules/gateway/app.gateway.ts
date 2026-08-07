import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';
import { buildTrustedOrigins } from '../../common/trusted-origins';

const ALLOWED_WS_ORIGINS = [...buildTrustedOrigins()];

/** Роли с полным WS-доступом — могут слушать любую project/task комнату.
 *  Все остальные пользователи могут слушать ТОЛЬКО:
 *   - свою личную комнату `user:{self.id}` (автоматически)
 *   - комнаты проектов где они участники / менеджер
 *   - комнаты задач где они исполнители / создатели */
const WS_ADMIN_ROLES = new Set([
  'admin', 'founder', 'co_founder', 'smm_director', 'video_director',
]);

@WebSocketGateway({
  cors: { origin: ALLOWED_WS_ORIGINS, credentials: true },
  namespace: '/ws',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger('AppGateway');
  private userSockets = new Map<string, string[]>(); // userId -> socketIds

  constructor(
    private jwtService: JwtService,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Источники JWT в порядке приоритета:
      //  1) httpOnly cookie `auth_token` (новый безопасный путь)
      //  2) handshake.auth.token (legacy — фронт ещё не обновился)
      //  3) Authorization: Bearer (Swagger / curl)
      const cookieHeader = client.handshake.headers?.cookie || '';
      const cookieToken = cookieHeader
        .split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('auth_token='))
        ?.slice('auth_token='.length);
      const token =
        cookieToken
        || client.handshake.auth?.token
        || client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) { client.disconnect(); return; }

      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Track user sockets
      const existing = this.userSockets.get(payload.sub) || [];
      this.userSockets.set(payload.sub, [...existing, client.id]);

      // Join user room
      client.join(`user:${payload.sub}`);
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      const sockets = this.userSockets.get(userId)?.filter(id => id !== client.id) || [];
      if (sockets.length === 0) this.userSockets.delete(userId);
      else this.userSockets.set(userId, sockets);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Может ли пользователь подписаться на события проекта.
   *  Админ — да всегда; остальные — только если он менеджер или участник. */
  private async canJoinProject(userId: string, role: string, projectId: string): Promise<boolean> {
    if (WS_ADMIN_ROLES.has(role)) return true;
    const proj = await this.projectRepo
      .createQueryBuilder('p')
      .leftJoin('p.members', 'm')
      .where('p.id = :pid', { pid: projectId })
      .andWhere('(p.managerId = :uid OR m.id = :uid)', { uid: userId })
      .getCount();
    return proj > 0;
  }

  /** Может ли пользователь подписаться на события задачи.
   *  Админ — да; остальные — только если исполнитель/создатель/коисполнитель
   *  или участник проекта этой задачи. */
  private async canJoinTask(userId: string, role: string, taskId: string): Promise<boolean> {
    if (WS_ADMIN_ROLES.has(role)) return true;
    const task = await this.taskRepo.findOne({ where: { id: taskId }, select: ['id', 'projectId', 'assigneeId', 'createdById'] as any });
    if (!task) return false;
    if (task.assigneeId === userId || task.createdById === userId) return true;
    // Иначе проверяем членство в проекте задачи
    return this.canJoinProject(userId, role, task.projectId);
  }

  @SubscribeMessage('join:project')
  async joinProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    const userId = client.data.userId as string;
    const role = client.data.role as string;
    if (!userId || !projectId || typeof projectId !== 'string') return { event: 'denied', data: 'invalid' };
    const ok = await this.canJoinProject(userId, role, projectId);
    if (!ok) {
      this.logger.warn(`WS deny: user=${userId} role=${role} join:project=${projectId}`);
      return { event: 'denied', data: projectId };
    }
    client.join(`project:${projectId}`);
    return { event: 'joined', data: projectId };
  }

  @SubscribeMessage('leave:project')
  leaveProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    if (typeof projectId === 'string') client.leave(`project:${projectId}`);
  }

  @SubscribeMessage('join:task')
  async joinTask(@ConnectedSocket() client: Socket, @MessageBody() taskId: string) {
    const userId = client.data.userId as string;
    const role = client.data.role as string;
    if (!userId || !taskId || typeof taskId !== 'string') return { event: 'denied', data: 'invalid' };
    const ok = await this.canJoinTask(userId, role, taskId);
    if (!ok) {
      this.logger.warn(`WS deny: user=${userId} role=${role} join:task=${taskId}`);
      return { event: 'denied', data: taskId };
    }
    client.join(`task:${taskId}`);
    return { event: 'joined', data: taskId };
  }

  /** Реалтайм — вспомогательный канал: если сокет-сервер ещё не поднялся
   *  (старт приложения, консольный контекст) или соединение оборвалось,
   *  бизнес-операция обязана завершиться успешно. Раньше падение здесь
   *  роняло весь вызов — так терялись уведомления. */
  private safeEmit(fn: () => void, event: string) {
    try {
      if (!this.server) return;
      fn();
    } catch (e) {
      this.logger?.warn?.(`Не удалось отправить событие ${event}: ${(e as Error).message}`);
    }
  }

  // Emit to specific user
  notifyUser(userId: string, event: string, data: any) {
    this.safeEmit(() => this.server.to(`user:${userId}`).emit(event, data), event);
  }

  // Emit to project room
  notifyProject(projectId: string, event: string, data: any) {
    this.safeEmit(() => this.server.to(`project:${projectId}`).emit(event, data), event);
  }

  // Emit to task room
  notifyTask(taskId: string, event: string, data: any) {
    this.safeEmit(() => this.server.to(`task:${taskId}`).emit(event, data), event);
  }

  // Broadcast to all
  broadcast(event: string, data: any) {
    this.safeEmit(() => this.server.emit(event, data), event);
  }
}
