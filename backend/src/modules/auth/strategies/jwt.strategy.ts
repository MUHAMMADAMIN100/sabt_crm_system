import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    if (!user || !user.isActive) throw new UnauthorizedException();
    if (user.isBlocked) {
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
