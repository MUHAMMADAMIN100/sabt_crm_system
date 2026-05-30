import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppGateway } from './app.gateway';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';

@Module({
  imports: [
    // Project/Task репозитории нужны gateway-у чтобы валидировать
    // право пользователя войти в WS-комнату project:X / task:X.
    TypeOrmModule.forFeature([Project, Task]),
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
