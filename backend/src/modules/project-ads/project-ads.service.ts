import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAd, BudgetSource } from './project-ad.entity';
import { Project } from '../projects/project.entity';

@Injectable()
export class ProjectAdsService {
  constructor(
    @InjectRepository(ProjectAd) private repo: Repository<ProjectAd>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
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

  /** Adjust project budget by delta (positive = increase, negative = decrease) */
  private async adjustProjectBudget(projectId: string, delta: number) {
    if (!delta) return;
    await this.projectRepo
      .createQueryBuilder()
      .update(Project)
      .set({ budget: () => `COALESCE(budget, 0) + ${delta}` })
      .where('id = :id', { id: projectId })
      .execute();
  }

  async create(projectId: string, dto: Partial<ProjectAd>, createdById?: string) {
    const ad = this.repo.create({ ...dto, projectId, createdById });
    const saved = await this.repo.save(ad);

    // Company-paid ad → add budget to project so we can bill the client
    if (saved.budgetSource === BudgetSource.COMPANY && saved.budget) {
      await this.adjustProjectBudget(projectId, Number(saved.budget));
    }

    return saved;
  }

  async update(id: string, dto: Partial<ProjectAd>) {
    const old = await this.findOne(id);
    const oldCompanyBudget = old.budgetSource === BudgetSource.COMPANY ? Number(old.budget || 0) : 0;

    await this.repo.update(id, dto);
    const updated = await this.findOne(id);
    const newCompanyBudget = updated.budgetSource === BudgetSource.COMPANY ? Number(updated.budget || 0) : 0;

    // Adjust project budget by the difference
    const delta = newCompanyBudget - oldCompanyBudget;
    if (delta !== 0) {
      await this.adjustProjectBudget(updated.projectId, delta);
    }

    return updated;
  }

  async remove(id: string) {
    const ad = await this.findOne(id);

    // If company-paid, subtract budget from project
    if (ad.budgetSource === BudgetSource.COMPANY && ad.budget) {
      await this.adjustProjectBudget(ad.projectId, -Number(ad.budget));
    }

    await this.repo.remove(ad);
    return { message: 'Ad deleted' };
  }
}
