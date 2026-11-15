import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppGateway } from './app.gateway';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';

@Module({
  imports: [
    // Project/Task репозитории нужны gateway-у чтобы валидировать
    // право пользователя войти в WS-комнату project:X / task:X.
    // User/Employee — сверка подключения с базой, как в jwt.strategy
    // (блокировка, смена пароля, роль помощника админа; 15.11.2026).
    TypeOrmModule.forFeature([Project, Task, User, Employee]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class GatewayModule {}
