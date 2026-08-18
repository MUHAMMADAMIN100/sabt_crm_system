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
import { SecurityAuditModule } from './security-audit.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Employee, WorkSession, RefreshToken]),
    GatewayModule,
    PassportModule,
    SecurityAuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        // Короткий access-token (15 минут). Долгоживущая авторизация
        // выдерживается refresh-токеном — см. auth.service.refresh().
        // Рабочий токен бессрочный (по решению владельца): обновлять нечего —
        // значит нечему и ломаться, сотрудников больше не выбрасывает посреди
        // работы. Безопасность держится на другом: КАЖДЫЙ запрос сверяется с
        // базой (jwt.strategy), поэтому заблокированный или уволенный
        // отсекается мгновенно, а токены, выданные до смены пароля, отвергаются
        // по метке passwordChangedAt.
        signOptions: config.get('JWT_ACCESS_TTL')
          ? { expiresIn: config.get('JWT_ACCESS_TTL') }
          : {},
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService, JwtModule, SecurityAuditModule],
})
export class AuthModule {}
