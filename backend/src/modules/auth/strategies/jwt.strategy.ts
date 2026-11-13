import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';
import { Employee } from '../../employees/employee.entity';
import { impersonationDenial } from '../impersonation';
import type { Request } from 'express';

/** Берём JWT из httpOnly cookie (`auth_token`), а если её нет — пытаемся
 *  из заголовка Authorization (поддержка старых клиентов и Swagger). */
const fromCookie = (req: Request): string | null => {
  // «Войти как»: кука входа в кабинет сотрудника сильнее основной — пока
  // она есть, основатель/админ работает за сотрудника. Основная кука при
  // этом не меняется, и «Вернуться» просто убирает imp_token.
  return (req?.cookies && (req.cookies['imp_token'] || req.cookies['auth_token'])) || null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger('JwtStrategy');

  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string; iat?: number; imp?: string }) {
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    // Логи без email — email это PII под GDPR/CCPA, не должна попадать
    // в persistent log файлы. Оператор найдёт юзера по UUID в БД, если надо.
    if (!user) {
      this.logger.warn(`JWT validate: user_missing sub=${payload.sub}`);
      throw new UnauthorizedException();
    }
    if (!user.isActive) {
      this.logger.warn(`JWT validate: user_inactive sub=${user.id}`);
      throw new UnauthorizedException();
    }
    if (user.isBlocked) {
      this.logger.warn(`JWT validate: user_blocked sub=${user.id}`);
      const blockedByLabel = user.blockedByRole === 'founder'
        ? 'основатель компании'
        : user.blockedByRole === 'admin'
          ? 'администратор'
          : (user.blockedByName || 'администрация');
      throw new UnauthorizedException(`BLOCKED: Вас заблокировал ${blockedByLabel}${user.blockedByName ? ` (${user.blockedByName})` : ''}`);
    }
    // Рабочий токен бессрочный, поэтому смена пароля отзывает его так:
    // всё, что выдано ДО метки, считается недействительным. Иначе после
    // смены пароля старая сессия на чужом устройстве продолжала бы жить.
    if (user.passwordChangedAt && payload.iat) {
      const changedAtSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      // Секунда допуска: токен, выпущенный в тот же момент, что и смена
      // пароля, — это токен самого инициатора, его отзывать не нужно.
      if (payload.iat + 1 < changedAtSec) {
        this.logger.warn(`JWT validate: password_changed sub=${user.id}`);
        throw new UnauthorizedException('Пароль был изменён — войдите заново');
      }
    }
    // «Войти как»: токен сотрудника, выданный основателю/админу. Каждый
    // запрос заново проверяет и того, кто вошёл: заблокировали, сменил
    // пароль, лишился роли или сотрудник стал ему недоступен — вход
    // обрывается сразу, а не когда истечёт токен.
    if (payload.imp) {
      const actor = await this.userRepo.findOne({ where: { id: payload.imp } });
      const ended = (why: string) => {
        this.logger.warn(`JWT validate: impersonation_ended (${why}) actor=${payload.imp} target=${user.id}`);
        return new UnauthorizedException('IMPERSONATION_ENDED');
      };
      if (!actor || !actor.isActive || actor.isBlocked) throw ended('actor_inactive');
      if (actor.passwordChangedAt && payload.iat
        && payload.iat + 1 < Math.floor(new Date(actor.passwordChangedAt).getTime() / 1000)) {
        throw ended('actor_password_changed');
      }
      const targetEmp = await this.employeeRepo.findOne({ where: { userId: user.id } });
      if (impersonationDenial(actor as any, user as any, targetEmp)) throw ended('not_allowed');
      return {
        ...user,
        role: user.role,
        impersonatorId: actor.id,
        impersonatorName: actor.name,
        impersonatorRole: actor.role,
      };
    }
    return { ...user, role: user.role };
  }
}
