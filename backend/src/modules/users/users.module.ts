import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { Employee } from '../employees/employee.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { SecurityAuditModule } from '../auth/security-audit.module';
import { RefreshToken } from '../auth/refresh-token.entity';

@Module({
  imports: [
    // RefreshToken — нужен UsersService для отзыва refresh-токенов при
    // блокировке / сбросе пароля админом (Security review fix).
    TypeOrmModule.forFeature([User, Employee, RefreshToken]),
    GatewayModule,
    SecurityAuditModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
