import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAd } from './project-ad.entity';

@Injectable()
export class ProjectAdsService {
  constructor(
    @InjectRepository(ProjectAd) private repo: Repository<ProjectAd>,
  ) {}

  findByProject(projectId: string) {
    return this.repo.find({
      where: { projectId },
      order: { startDate: 'DESC' },
    });
  }

  async findOne(id: string) {
    const ad = await this.repo.findOne({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
  }

  async create(projectId: string, dto: Partial<ProjectAd>, createdById?: string) {
    const ad = this.repo.create({ ...dto, projectId, createdById });
    return this.repo.save(ad);
  }

  async update(id: string, dto: Partial<ProjectAd>) {
    await this.findOne(id);
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    const ad = await this.findOne(id);
    await this.repo.remove(ad);
    return { message: 'Ad deleted' };
  }
}
