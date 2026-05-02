import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { User } from '../users/user.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private repo: Repository<Team>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async findAll(includeInactive = false) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.lead', 'lead')
      .loadRelationCountAndMap('t.memberCount', 't.id', 'memberCount', qb2 =>
        qb2.from(User, 'u').where('u.teamId = t.id'),
      );
    if (!includeInactive) qb.where('t.isActive = true');
    qb.orderBy('t.isActive', 'DESC').addOrderBy('t.name', 'ASC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const t = await this.repo.findOne({ where: { id }, relations: ['lead'] });
    if (!t) throw new NotFoundException('Team not found');
    return t;
  }

  /** Список сотрудников команды (через User.teamId). */
  async getMembers(id: string) {
    await this.findOne(id);
    return this.userRepo.find({
      where: { teamId: id },
      order: { name: 'ASC' },
    });
  }

  async create(dto: Partial<Team>, createdById?: string) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Название команды обязательно');
    }
    const t = this.repo.create({ ...dto, createdById: dto.createdById ?? createdById });
    return this.repo.save(t);
  }

  async update(id: string, dto: Partial<Team>) {
    await this.findOne(id);
    const { id: _id, createdAt, updatedAt, createdById, ...patch } = dto as any;
    if (patch.name !== undefined && !String(patch.name).trim()) {
      throw new BadRequestException('Название не может быть пустым');
    }
    await this.repo.update(id, patch);
    return this.findOne(id);
  }

  async remove(id: string) {
    const t = await this.findOne(id);
    await this.repo.remove(t);
    return { message: 'Team deleted' };
  }

  /** Привязать сотрудника к команде. Если teamId=null — отвязать. */
  async setUserTeam(userId: string, teamId: string | null) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (teamId) {
      const team = await this.repo.findOne({ where: { id: teamId } });
      if (!team) throw new NotFoundException('Team not found');
    }
    await this.userRepo.update(userId, { teamId: teamId ?? null } as any);
    return { id: userId, teamId };
  }

  /** Массово назначить пользователей в команду (заменяет состав). */
  async setMembers(teamId: string, userIds: string[]) {
    await this.findOne(teamId);
    // 1) убрать из этой команды всех текущих кто не в новом списке
    if (userIds.length === 0) {
      await this.userRepo.createQueryBuilder()
        .update(User).set({ teamId: null as any })
        .where('teamId = :tid', { tid: teamId })
        .execute();
    } else {
      await this.userRepo.createQueryBuilder()
        .update(User).set({ teamId: null as any })
        .where('teamId = :tid AND id NOT IN (:...ids)', { tid: teamId, ids: userIds })
        .execute();
      // 2) поставить новым выбранным эту команду (перетащит их если они были в другой)
      await this.userRepo.createQueryBuilder()
        .update(User).set({ teamId })
        .whereInIds(userIds)
        .execute();
    }
    return this.getMembers(teamId);
  }
}
