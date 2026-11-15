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
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { impersonationDenial } from '../auth/impersonation';
import { effectiveRoleOf } from '../auth/roles.helper';
import { buildTrustedOrigins, normalizeHttpOrigin } from '../../common/trusted-origins';
import { clearResponseCache } from '../../common/response-cache';

/** Доверенные адреса фронта — считаем при первом подключении, а не при
 *  импорте файла (15.11.2026): импорт случается раньше, чем ConfigModule
 *  прочитает .env, и FRONTEND_URL/CORS_ORIGINS из файла сюда не попадали. */
let wsOrigins: Set<string> | null = null;
const trustedWsOrigins = (): Set<string> => (wsOrigins ??= buildTrustedOrigins());

/** Адрес из заголовка Origin — доверенный ли. Пустой Origin (мобильное
 *  приложение, сервер) пропускаем: подделать чужой сайт без браузера нельзя,
 *  а браузер Origin при рукопожатии всегда шлёт. sameOrigin — адрес самого
 *  API: его ставит, например, React Native, и чужой сайт его не подделает. */
const isTrustedWsOrigin = (origin: string | undefined | null, sameOrigin?: string | null): boolean => {
  if (!origin) return true;
  const normalized = normalizeHttpOrigin(origin);
  if (!normalized) return false;
  return trustedWsOrigins().has(normalized) || (!!sameOrigin && normalized === sameOrigin);
};

type HandshakeRequest = {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { encrypted?: boolean };
};

/** Собственный адрес API по заголовкам рукопожатия (как requestOrigin в
 *  common/trusted-origins для HTTP). */
const handshakeOwnOrigin = (req: HandshakeRequest): string | null => {
  const first = (v: string | string[] | undefined) =>
    String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim();
  const host = first(req?.headers?.['x-forwarded-host']) || first(req?.headers?.host);
  if (!host) return null;
  const proto = first(req?.headers?.['x-forwarded-proto']) || (req?.socket?.encrypted ? 'https' : 'http');
  return normalizeHttpOrigin(`${proto}://${host}`);
};

/** Роли с полным WS-доступом — могут слушать любую project/task комнату.
 *  Все остальные пользователи могут слушать ТОЛЬКО:
 *   - свою личную комнату `user:{self.id}` (автоматически)
 *   - комнаты проектов где они участники / менеджер
 *   - комнаты задач где они исполнители / создатели */
const WS_ADMIN_ROLES = new Set([
  'admin', 'founder', 'smm_director',
]);

@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, isTrustedWsOrigin(origin)),
    credentials: true,
  },
  // Защита от CSWSH (15.11.2026): WebSocket не подчиняется CORS, и чужой
  // сайт, открытый у сотрудника, подключался к сокету с его куками и
  // слушал события. Рукопожатие с чужим Origin отклоняем.
  allowRequest: (req: HandshakeRequest, cb: (err: string | null | undefined, success: boolean) => void) => {
    const origin = req?.headers?.origin;
    const ok = isTrustedWsOrigin(Array.isArray(origin) ? origin[0] : origin, handshakeOwnOrigin(req));
    cb(ok ? null : 'Origin not allowed', ok);
  },
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
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {}

  /** Проверка подключения теперь ходит в базу, а сообщения join:* могут
   *  прийти раньше, чем она закончится, — обработчики ждут этот промис. */
  async handleConnection(client: Socket) {
    const ready = this.authenticate(client);
    client.data.ready = ready;
    await ready;
  }

  /** Токен сверяем с базой так же, как jwt.strategy (15.11.2026): раньше
   *  хватало подписи, и заблокированный, отключённый или сменивший пароль
   *  сотрудник продолжал слушать события, а роль бралась из токена. */
  private async authenticate(client: Socket): Promise<boolean> {
    try {
      // Источники JWT в порядке приоритета:
      //  1) httpOnly cookie `auth_token` (новый безопасный путь)
      //  2) handshake.auth.token (legacy — фронт ещё не обновился)
      //  3) Authorization: Bearer (Swagger / curl)
      const cookieHeader = client.handshake.headers?.cookie || '';
      const cookies = cookieHeader.split(';').map(c => c.trim());
      const cookieOf = (name: string) => cookies.find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);
      // «Войти как»: кука входа в кабинет сотрудника сильнее основной —
      // как в jwt.strategy, иначе сокет слушал бы события самого админа.
      const cookieToken = cookieOf('imp_token') || cookieOf('auth_token');
      const token =
        cookieToken
        || client.handshake.auth?.token
        || client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) { client.disconnect(); return false; }

      const payload = this.jwtService.verify(token);
      const user = await this.userRepo.findOne({ where: { id: payload.sub } });
      if (!user || !user.isActive || user.isBlocked || this.issuedBeforePasswordChange(payload.iat, user)) {
        client.disconnect();
        return false;
      }
      // «Войти как»: и входивший должен быть всё ещё вправе (как в jwt.strategy).
      const targetEmp = await this.employeeRepo.findOne({ where: { userId: user.id } });
      if (payload.imp) {
        const actor = await this.userRepo.findOne({ where: { id: payload.imp } });
        if (!actor || !actor.isActive || actor.isBlocked
          || this.issuedBeforePasswordChange(payload.iat, actor)
          || impersonationDenial(actor as any, user as any, targetEmp)) {
          client.disconnect();
          return false;
        }
      }
      // Пока ходили в базу, клиент мог уже уйти — не заводим ему записей.
      if (client.disconnected) return false;
      client.data.userId = user.id;
      // Роль — из базы, с учётом помощника админа (как в jwt.strategy).
      client.data.role = effectiveRoleOf(user.role, targetEmp?.isSubAdmin);
      client.data.secondaryRole = user.secondaryRole || null;

      // Track user sockets
      const existing = this.userSockets.get(user.id) || [];
      this.userSockets.set(user.id, [...existing, client.id]);

      // Join user room
      client.join(`user:${user.id}`);
      this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
      return true;
    } catch {
      client.disconnect();
      return false;
    }
  }

  /** Токен выдан до смены пароля — недействителен (секунда допуска, как в
   *  jwt.strategy: токен самого инициатора смены не отзываем). */
  private issuedBeforePasswordChange(iat: number | undefined, user: { passwordChangedAt?: Date | null }): boolean {
    if (!user.passwordChangedAt || !iat) return false;
    return iat + 1 < Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
  }

  /** Роль из тех, что слушают любые комнаты, — по основной или второй роли. */
  private isWsAdmin(client: Socket): boolean {
    return WS_ADMIN_ROLES.has(client.data.role)
      || (!!client.data.secondaryRole && WS_ADMIN_ROLES.has(client.data.secondaryRole));
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
  private async canJoinProject(userId: string, isAdmin: boolean, projectId: string): Promise<boolean> {
    if (isAdmin) return true;
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
  private async canJoinTask(userId: string, isAdmin: boolean, taskId: string): Promise<boolean> {
    if (isAdmin) return true;
    const task = await this.taskRepo.findOne({ where: { id: taskId }, select: ['id', 'projectId', 'assigneeId', 'createdById'] as any });
    if (!task) return false;
    if (task.assigneeId === userId || task.createdById === userId) return true;
    // Иначе проверяем членство в проекте задачи
    return this.canJoinProject(userId, isAdmin, task.projectId);
  }

  @SubscribeMessage('join:project')
  async joinProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    // Проверка подключения могла ещё не закончиться — ждём её.
    if (client.data.ready) await client.data.ready;
    const userId = client.data.userId as string;
    const role = client.data.role as string;
    if (!userId || !projectId || typeof projectId !== 'string') return { event: 'denied', data: 'invalid' };
    const ok = await this.canJoinProject(userId, this.isWsAdmin(client), projectId);
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
    if (client.data.ready) await client.data.ready;
    const userId = client.data.userId as string;
    const role = client.data.role as string;
    if (!userId || !taskId || typeof taskId !== 'string') return { event: 'denied', data: 'invalid' };
    const ok = await this.canJoinTask(userId, this.isWsAdmin(client), taskId);
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
    // Данные изменились — короткий кэш тяжёлых ответов сбрасываем ДО рассылки:
    // клиенты сразу перезапросят и должны получить свежее (08.11.2026).
    clearResponseCache();
    this.safeEmit(() => this.server.emit(event, data), event);
  }
}
