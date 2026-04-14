import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { ClientLead, ClientLeadStatus, ClientLeadInterest } from './client-lead.entity';

export interface ListFilters {
  search?: string;
  status?: ClientLeadStatus;
  interest?: ClientLeadInterest;
  sphere?: string;
  ownerId?: string;
  source?: string;
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(ClientLead) private repo: Repository<ClientLead>,
  ) {}

  async findAll(f: ListFilters) {
    const qb = this.repo.createQueryBuilder('c')
      .leftJoinAndSelect('c.owner', 'owner');
    if (f.search) {
      qb.andWhere(
        '(c.name ILIKE :s OR c.sphere ILIKE :s OR c.contactPerson ILIKE :s OR c.contactInfo ILIKE :s OR c.address ILIKE :s)',
        { s: `%${f.search}%` },
      );
    }
    if (f.status) qb.andWhere('c.status = :st', { st: f.status });
    if (f.interest) qb.andWhere('c.interest = :it', { it: f.interest });
    if (f.sphere) qb.andWhere('c.sphere = :sp', { sp: f.sphere });
    if (f.ownerId) qb.andWhere('c.ownerId = :oid', { oid: f.ownerId });
    if (f.source) qb.andWhere('c.leadSource = :src', { src: f.source });
    qb.orderBy('c.updatedAt', 'DESC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const lead = await this.repo.findOne({ where: { id }, relations: ['owner'] });
    if (!lead) throw new NotFoundException('Client lead not found');
    return lead;
  }

  async create(dto: Partial<ClientLead>, ownerId?: string) {
    const lead = this.repo.create({ ...dto, ownerId: dto.ownerId ?? ownerId });
    return this.repo.save(lead);
  }

  async update(id: string, dto: Partial<ClientLead>) {
    await this.findOne(id);
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    const lead = await this.findOne(id);
    await this.repo.remove(lead);
    return { message: 'Lead deleted' };
  }

  /** Aggregated counters for the Clients page header */
  async stats() {
    const statusRows = await this.repo
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status')
      .getRawMany();
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = Number(r.count);

    const interestRows = await this.repo
      .createQueryBuilder('c')
      .select('COALESCE(c.interest, \'none\')', 'interest')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.interest')
      .getRawMany();
    const byInterest: Record<string, number> = {};
    for (const r of interestRows) byInterest[r.interest] = Number(r.count);

    const totalPotentialRow = await this.repo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.dealPotential), 0)', 'total')
      .where('c.status NOT IN (:...bad)', { bad: ['lost'] })
      .getRawOne();

    return {
      byStatus,
      byInterest,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      openPotential: Number(totalPotentialRow?.total || 0),
    };
  }
}
