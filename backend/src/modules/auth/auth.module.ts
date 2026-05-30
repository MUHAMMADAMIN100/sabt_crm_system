import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { WorkSession } from './work-session.entity';
import { RefreshToken } from './refresh-token.entity';
import { SecurityEvent } from './security-event.entity';
import { SecurityAuditService } from './security-audit.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Employee, WorkSession, RefreshToken, SecurityEvent]),
    GatewayModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        // Короткий access-token (15 минут). Долгоживущая авторизация
        // выдерживается refresh-токеном — см. auth.service.refresh().
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', '15m') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy, SecurityAuditService],
  exports: [AuthService, JwtModule, SecurityAuditService],
})
export class AuthModule {}
