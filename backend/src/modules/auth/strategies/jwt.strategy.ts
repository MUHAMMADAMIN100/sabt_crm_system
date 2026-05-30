import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';
import type { Request } from 'express';

/** Берём JWT из httpOnly cookie (`auth_token`), а если её нет — пытаемся
 *  из заголовка Authorization (поддержка старых клиентов и Swagger). */
const fromCookie = (req: Request): string | null => {
  return (req?.cookies && req.cookies['auth_token']) || null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger('JwtStrategy');

  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) {
      this.logger.warn(`JWT validate: user not found by id=${payload.sub} (email in token: ${payload.email})`);
      throw new UnauthorizedException();
    }
    if (!user.isActive) {
      this.logger.warn(`JWT validate: user ${user.email} (id=${user.id}) is NOT active`);
      throw new UnauthorizedException();
    }
    if (user.isBlocked) {
      this.logger.warn(`JWT validate: user ${user.email} (id=${user.id}) is BLOCKED`);
      const blockedByLabel = user.blockedByRole === 'founder'
        ? 'основатель компании'
        : user.blockedByRole === 'co_founder'
          ? 'сооснователь компании'
          : user.blockedByRole === 'admin'
            ? 'администратор'
            : (user.blockedByName || 'администрация');
      throw new UnauthorizedException(`BLOCKED: Вас заблокировал ${blockedByLabel}${user.blockedByName ? ` (${user.blockedByName})` : ''}`);
    }
    return { ...user, role: user.role };
  }
}
