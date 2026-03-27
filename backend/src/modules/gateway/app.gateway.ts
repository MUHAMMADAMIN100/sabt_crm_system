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

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/ws',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger('AppGateway');
  private userSockets = new Map<string, string[]>(); // userId -> socketIds

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
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

  @SubscribeMessage('join:project')
  joinProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    client.join(`project:${projectId}`);
    return { event: 'joined', data: projectId };
  }

  @SubscribeMessage('leave:project')
  leaveProject(@ConnectedSocket() client: Socket, @MessageBody() projectId: string) {
    client.leave(`project:${projectId}`);
  }

  @SubscribeMessage('join:task')
  joinTask(@ConnectedSocket() client: Socket, @MessageBody() taskId: string) {
    client.join(`task:${taskId}`);
    return { event: 'joined', data: taskId };
  }

  // Emit to specific user
  notifyUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // Emit to project room
  notifyProject(projectId: string, event: string, data: any) {
    this.server.to(`project:${projectId}`).emit(event, data);
  }

  // Emit to task room
  notifyTask(taskId: string, event: string, data: any) {
    this.server.to(`task:${taskId}`).emit(event, data);
  }

  // Broadcast to all
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }
}
