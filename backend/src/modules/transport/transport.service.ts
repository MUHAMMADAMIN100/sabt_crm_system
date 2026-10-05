import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TransportRequest } from './transport-request.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';

/** Кто подаёт заявки (основная или вторая роль) — решение владельца 05.10.2026. */
const REQUEST_ROLES = ['smm_specialist', 'videographer'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const KEY_RE = /^[0-9a-f-]{36}$/i;
const MAX_AMOUNT = 5000;
/** Фото чека: фронт жмёт его в JPEG до ~400 КБ — в base64 это ~550 КБ. */
export const RECEIPT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

type Actor = { id: string; role?: string | null; secondaryRole?: string | null; name?: string };

const todayDushanbe = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
const shiftDay = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const nameKey = (s?: string | null) => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ').trim();
/** '2026-10-04' → '04.10.2026' — так дату читают в уведомлениях и комментарии расхода. */
const ruDate = (iso: any) => String(iso || '').slice(0, 10).split('-').reverse().join('.');
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    @InjectRepository(TransportRequest) private repo: Repository<TransportRequest>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private finance: FinanceService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    private ds: DataSource,
  ) {}

  canRequest(a: Actor) {
    return [a.role, a.secondaryRole].some(r => REQUEST_ROLES.includes(String(r || '')));
  }

  private view(r: TransportRequest, names: Map<string, string>) {
    return {
      id: r.id, employeeId: r.employeeId, employeeName: names.get(r.employeeId) || 'Сотрудник',
      projectId: r.projectId, projectName: r.projectName, amount: r2(r.amount), date: String(r.date).slice(0, 10),
      note: r.note, receiptUrl: r.receiptKey ? `/api/transport-receipts/${r.receiptKey}` : null, status: r.status === 'paying' ? 'pending' : r.status,
      rejectReason: r.rejectReason, decidedAt: r.decidedAt, createdAt: r.createdAt,
    };
  }

  /** Проекты для выбора: все активные; свои (менеджер, участник, SMM-специалист
   *  или видеограф проекта) — первыми. */
  async projectsFor(actor: Actor) {
    const projects = await this.projectRepo.createQueryBuilder('p')
      .leftJoin('p.members', 'members')
      .addSelect('members.id')
      .where('p.isArchived = false')
      .andWhere('p.isOneOffSystem = false')
      .getMany();
    return projects
      .filter(p => String(p.status) !== 'archived')
      .map(p => {
        const sd: any = p.smmData || {};
        const ids = [...(sd.smmSpecialistIds || []), ...(sd.videographerIds || [])];
        const mine = p.managerId === actor.id || (p.members || []).some(m => m.id === actor.id) || ids.includes(actor.id);
        return { id: p.id, name: p.name, mine };
      })
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name, 'ru'));
  }

  /** Мои заявки и итоги: сколько ждёт оплаты, сколько вернули в этом месяце. */
  async my(actor: Actor) {
    const rows = await this.repo.find({ where: { employeeId: actor.id }, order: { createdAt: 'DESC' }, take: 60 });
    const month = todayDushanbe().slice(0, 7);
    const names = new Map([[actor.id, actor.name || '']]);
    const pending = rows.filter(r => r.status === 'pending' || r.status === 'paying');
    const paidMonth = rows.filter(r => r.status === 'paid' && r.decidedAt
      && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date(r.decidedAt)).slice(0, 7) === month);
    return {
      canRequest: this.canRequest(actor),
      pendingSum: r2(pending.reduce((s, r) => s + Number(r.amount), 0)),
      pendingCount: pending.length,
      paidMonthSum: r2(paidMonth.reduce((s, r) => s + Number(r.amount), 0)),
      items: rows.map(r => this.view(r, names)),
    };
  }

  async create(actor: Actor, dto: any, file?: Express.Multer.File) {
    if (!this.canRequest(actor)) {
      throw new ForbiddenException('Заявки на транспорт подают SMM-специалисты и видеографы');
    }
    const amount = r2(dto?.amount);
    if (!(amount > 0) || amount > MAX_AMOUNT) throw new BadRequestException(`Сумма — от 1 до ${MAX_AMOUNT} сомони`);
    const today = todayDushanbe();
    const date = String(dto?.date || today);
    if (!ISO_RE.test(date)) throw new BadRequestException('Некорректная дата поездки');
    if (date > today) throw new BadRequestException('Дата поездки не может быть в будущем');
    if (date < shiftDay(today, -60)) throw new BadRequestException('Заявку можно подать за поездку не старше 60 дней');
    const project = dto?.projectId ? await this.projectRepo.findOne({ where: { id: dto.projectId } }) : null;
    if (!project) throw new BadRequestException('Выберите проект');
    const note = typeof dto?.note === 'string' ? dto.note.trim().slice(0, 300) : '';
    let receiptKey: string | null = null;
    let receiptImage: string | null = null;
    if (file?.buffer?.length) {
      // Размер считаем до кодирования: base64 раздувает данные на треть.
      if (Math.ceil(file.buffer.length / 3) * 4 > MAX_RECEIPT_BYTES) {
        throw new BadRequestException('Фото чека слишком тяжёлое — выберите другое или сделайте скриншот');
      }
      const mime = RECEIPT_MIME.has(file.mimetype) ? file.mimetype : 'image/jpeg';
      receiptKey = uuidv4();
      receiptImage = `data:${mime};base64,${file.buffer.toString('base64')}`;
    }

    const saved = await this.repo.save(this.repo.create({
      employeeId: actor.id, projectId: project.id, projectName: project.name,
      amount: String(amount), date, note: note || null, receiptKey, receiptImage, status: 'pending',
    }));
    this.notifyOwners(saved, actor).catch(e => this.logger.warn(`Уведомление о заявке не ушло: ${e?.message || e}`));
    return this.view(saved, new Map([[actor.id, actor.name || '']]));
  }

  /** Фото чека по ключу. receiptImage помечена select:false — читаем явно. */
  async getReceipt(key: string): Promise<{ mime: string; data: Buffer } | null> {
    // Ключ приходит из URL — пускаем только формат uuid.
    if (!KEY_RE.test(key || '')) return null;
    const rows: Array<{ receiptImage: string | null }> = await this.ds.query(
      `SELECT "receiptImage" FROM transport_requests WHERE "receiptKey" = $1 LIMIT 1`, [key]).catch(() => []);
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(rows[0]?.receiptImage || '');
    if (!m) return null;
    return { mime: RECEIPT_MIME.has(m[1]) ? m[1] : 'image/jpeg', data: Buffer.from(m[2], 'base64') };
  }

  /** Своя заявка, пока не оплачена, — отозвать (ошибся суммой или проектом). */
  async cancel(actor: Actor, id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r || r.employeeId !== actor.id) throw new NotFoundException('Заявка не найдена');
    if (r.status !== 'pending') throw new BadRequestException('Отозвать можно только заявку, которая ждёт оплаты');
    await this.repo.delete(id);
    return { ok: true };
  }

  /** Для владельца: все ждущие оплаты + решённые за месяц, с итогами. */
  async list(ym?: string) {
    const month = YM_RE.test(ym || '') ? (ym as string) : todayDushanbe().slice(0, 7);
    const pending = await this.repo.find({ where: { status: In(['pending', 'paying']) }, order: { createdAt: 'ASC' } });
    const done: TransportRequest[] = await this.repo.createQueryBuilder('t')
      .where(`t.status IN ('paid', 'rejected')`)
      .andWhere(`to_char(t."decidedAt" AT TIME ZONE 'Asia/Dushanbe', 'YYYY-MM') = :month`, { month })
      .orderBy('t."decidedAt"', 'DESC')
      .getMany();
    const ids = [...new Set([...pending, ...done].map(r => r.employeeId))];
    const users = ids.length ? await this.userRepo.find({ where: { id: In(ids) } }) : [];
    const names = new Map(users.map(u => [u.id, u.name]));
    const roleOf = new Map(users.map(u => [u.id, String(u.role || '')]));
    const paid = done.filter(r => r.status === 'paid');
    const byPerson = new Map<string, { n: number; sum: number }>();
    for (const r of paid) {
      const x = byPerson.get(r.employeeId) || { n: 0, sum: 0 };
      x.n += 1; x.sum += Number(r.amount);
      byPerson.set(r.employeeId, x);
    }
    const topEntry = [...byPerson.entries()].sort((a, b) => b[1].sum - a[1].sum)[0];
    const withRole = (r: TransportRequest) => ({ ...this.view(r, names), employeeRole: roleOf.get(r.employeeId) || null });
    return {
      ym: month,
      pending: pending.map(withRole),
      done: done.map(withRole),
      totals: {
        pendingSum: r2(pending.reduce((s, r) => s + Number(r.amount), 0)),
        pendingCount: pending.length,
        paidSum: r2(paid.reduce((s, r) => s + Number(r.amount), 0)),
        paidCount: paid.length,
        top: topEntry ? { name: names.get(topEntry[0]) || 'Сотрудник', count: topEntry[1].n, sum: r2(topEntry[1].sum) } : null,
      },
    };
  }

  /** Оплатить: расход «Транспорт» в Финансах + заявка «оплачено». Двойное
   *  нажатие не создаёт второй расход: заявку сначала атомарно переводим в
   *  «paying», и только у одного запроса это получается. */
  async pay(actor: Actor, id: string, dto: any) {
    const accountId = typeof dto?.accountId === 'string' ? dto.accountId : '';
    if (!accountId) throw new BadRequestException('Выберите счёт, с которого платите');
    const locked: Array<{ id: string }> = await this.ds.query(
      `UPDATE transport_requests SET status = 'paying', "updatedAt" = now()
        WHERE id = $1 AND status = 'pending' RETURNING id`, [id]);
    if (!locked.length) {
      const r = await this.repo.findOne({ where: { id } });
      if (!r) throw new NotFoundException('Заявка не найдена');
      throw new ConflictException('Эта заявка уже оплачена или отклонена');
    }
    const r = await this.repo.findOne({ where: { id } });
    try {
      const user = await this.userRepo.findOne({ where: { id: r!.employeeId } });
      const categoryId = await this.transportCategoryId();
      const finEmp: Array<{ id: string }> = await this.ds.query(
        `SELECT id FROM finance_employees WHERE "userId" = $1 LIMIT 1`, [r!.employeeId]);
      const finProjectId = await this.financeProjectIdByName(r!.projectName);
      const tx: any = await this.finance.createOperation({
        type: 'expense',
        amount: Number(r!.amount),
        date: todayDushanbe(),
        accountId,
        categoryId,
        projectId: finProjectId,
        recipientId: finEmp[0]?.id ?? null,
        comment: `Транспорт: ${user?.name || 'сотрудник'} · ${r!.projectName || 'проект'}`
          + `${r!.note ? ` · ${r!.note}` : ''} · поездка ${ruDate(r!.date)}`,
      }, actor.id);
      await this.repo.update(id, {
        status: 'paid', decidedById: actor.id, decidedAt: new Date(), financeTxId: tx?.id ?? null, rejectReason: null,
      });
      const fresh = await this.repo.findOne({ where: { id } });
      this.notifyEmployee(fresh!, 'paid').catch(e => this.logger.warn(`Уведомление об оплате не ушло: ${e?.message || e}`));
      return this.view(fresh!, new Map([[fresh!.employeeId, user?.name || '']]));
    } catch (e) {
      await this.repo.update(id, { status: 'pending' }).catch(() => undefined);
      throw e;
    }
  }

  async reject(actor: Actor, id: string, dto: any) {
    const reason = typeof dto?.reason === 'string' ? dto.reason.trim().slice(0, 200) : '';
    if (!reason) throw new BadRequestException('Напишите причину — сотрудник её увидит');
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Заявка не найдена');
    if (r.status !== 'pending') throw new ConflictException('Эта заявка уже оплачена или отклонена');
    await this.repo.update(id, { status: 'rejected', rejectReason: reason, decidedById: actor.id, decidedAt: new Date() });
    const fresh = await this.repo.findOne({ where: { id } });
    this.notifyEmployee(fresh!, 'rejected').catch(e => this.logger.warn(`Уведомление об отказе не ушло: ${e?.message || e}`));
    return { ok: true };
  }

  /** Категория расходов «Транспорт» (есть среди стандартных); если её
   *  удалили — создаём такую же, чтобы расход не остался без категории. */
  private async transportCategoryId(): Promise<string> {
    const found: Array<{ id: string }> = await this.ds.query(
      `SELECT id FROM finance_categories
        WHERE type = 'expense' AND (name = 'Транспорт' OR lower(name) = 'транспорт')
        ORDER BY position LIMIT 1`);
    if (found[0]?.id) return found[0].id;
    const made: Array<{ id: string }> = await this.ds.query(
      `INSERT INTO finance_categories (name, type, key, builtin, icon, color, position)
       VALUES ('Транспорт', 'expense', NULL, false, 'car', '#06b6d4', 11) RETURNING id`);
    return made[0].id;
  }

  /** Проект в Финансах с тем же названием — чтобы расход попал в траты проекта.
   *  Одинаковые названия не угадываем. */
  private async financeProjectIdByName(name?: string | null): Promise<string | null> {
    const key = nameKey(name);
    if (!key) return null;
    const rows: Array<{ id: string; name: string }> = await this.ds.query(
      `SELECT id, name FROM finance_projects WHERE COALESCE(archived, false) = false`).catch(() => []);
    const hits = rows.filter(r => nameKey(r.name) === key);
    return hits.length === 1 ? hits[0].id : null;
  }

  private async notifyOwners(r: TransportRequest, actor: Actor) {
    const owners = await this.userRepo.find({ where: { role: 'founder' as any, isActive: true } });
    const who = actor.name || 'Сотрудник';
    for (const o of owners) {
      await this.notifications.create({
        userId: o.id,
        type: NotificationType.REVIEW_NEEDED,
        title: `Транспорт: ${who} — ${r2(r.amount)} с.`,
        message: `${r.projectName || 'Проект'} · ${ruDate(r.date)}${r.note ? ` · ${r.note}` : ''}`,
        link: '/finance/transport',
        data: { transportRequestId: r.id },
      } as any).catch(() => undefined);
      await this.telegram.sendToUser(
        o.id,
        `🚗 <b>Заявка на транспорт</b>\n\n` +
        `${esc(who)} — <b>${r2(r.amount)} сомони</b>\n` +
        `Проект: ${esc(r.projectName || '—')}\n` +
        `Поездка: ${ruDate(r.date)}${r.note ? ` · ${esc(r.note)}` : ''}\n\n` +
        `👉 ${this.telegram.appUrl}/finance/transport`,
      ).catch(() => undefined);
    }
  }

  private async notifyEmployee(r: TransportRequest, what: 'paid' | 'rejected') {
    const paid = what === 'paid';
    const title = paid
      ? `Оплачено ${r2(r.amount)} с. за проезд`
      : `Заявка на ${r2(r.amount)} с. отклонена`;
    const message = paid
      ? `${r.projectName || 'Проект'} · поездка ${ruDate(r.date)}`
      : `Причина: ${r.rejectReason || '—'}`;
    await this.notifications.create({
      userId: r.employeeId, type: NotificationType.STATUS_CHANGE, title, message, link: '/',
      data: { transportRequestId: r.id },
    } as any).catch(() => undefined);
    await this.telegram.sendToUser(r.employeeId, `${paid ? '✅' : '❌'} <b>${esc(title)}</b>\n${esc(message)}`).catch(() => undefined);
  }
}
