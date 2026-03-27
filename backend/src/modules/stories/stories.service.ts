import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoryLog } from './story.entity';

@Injectable()
export class StoriesService {
  constructor(@InjectRepository(StoryLog) private repo: Repository<StoryLog>) {}

  async getByEmployee(employeeId: string, from: string, to: string) {
    return this.repo.createQueryBuilder('s')
      .leftJoinAndSelect('s.project', 'project')
      .where('s.employeeId = :employeeId', { employeeId })
      .andWhere('s.date BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  async getAll(from: string, to: string) {
    return this.repo.createQueryBuilder('s')
      .leftJoinAndSelect('s.employee', 'employee')
      .leftJoinAndSelect('s.project', 'project')
      .where('s.date BETWEEN :from AND :to', { from, to })
      .getMany();
  }

  async upsert(employeeId: string, projectId: string, date: string, storiesCount: number) {
    let log = await this.repo.findOne({ where: { employeeId, projectId, date } });
    if (log) {
      log.storiesCount = storiesCount;
    } else {
      log = this.repo.create({ employeeId, projectId, date, storiesCount });
    }
    return this.repo.save(log);
  }
}
