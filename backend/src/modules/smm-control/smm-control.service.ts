import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SmmProjectCheck } from './smm-project-check.entity';
import { Project } from '../projects/project.entity';

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Кто видит и правит все проекты раздела. */
const MANAGE_ROLES = ['admin', 'founder', 'smm_director'];
/** Кто видит оплату: деньги — только владельцу и админу. */
const MONEY_ROLES = ['admin', 'founder'];
const MOODS = ['good', 'meh', 'bad'];

type Actor = { id: string; role?: string | null; secondaryRole?: string | null };

const todayDushanbe = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
const shiftDay = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 864e5);
/** Цикл проекта, в который попадает день ref, по дню старта (как в умном календаре). */
const cycleOf = (ref: string, day: number): { start: string; end: string } => {
  const [y, m, d] = ref.split('-').map(Number);
  const dim = (yy: number, mm0: number) => new Date(Date.UTC(yy, mm0 + 1, 0)).getUTCDate();
  let sy = y, sm = m - 1;
  if (d < Math.min(day, dim(sy, sm))) { sm -= 1; if (sm < 0) { sm = 11; sy -= 1; } }
  const start = new Date(Date.UTC(sy, sm, Math.min(day, dim(sy, sm))));
  const ny = sm === 11 ? sy + 1 : sy, nm = (sm + 1) % 12;
  const end = new Date(Date.UTC(ny, nm, Math.min(day, dim(ny, nm))));
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};
/** Название без регистра, «ё» и знаков — чтобы связать SMM-проект с проектом в Финансах. */
const nameKey = (s?: string | null) => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ').trim();

@Injectable()
export class SmmControlService {
  constructor(
    @InjectRepository(SmmProjectCheck) private repo: Repository<SmmProjectCheck>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private ds: DataSource,
  ) {}

  private rolesOf(a: Actor) { return [a.role, a.secondaryRole].filter(Boolean) as string[]; }

  /**
   * Раздел «Контроль» за месяц: по каждому активному SMM-проекту — отметки
   * людей (клиент доволен, на связи, отчёт) и то, что считается само:
   * свежесть аккаунта (дни без постов, полоса за 14 дней), рилсы и посты
   * по норме за месяц, «по плану» — вышло / должно было выйти к сегодня в
   * цикле проекта, сторис за 7 дней, оплата (только руководству).
   * Свежесть считается от сегодняшнего дня, у прошлых месяцев — от их конца.
   */
  async list(ym: string | undefined, actor: Actor) {
    const today = todayDushanbe();
    const month = YM_RE.test(ym || '') ? (ym as string) : today.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const ref = monthEnd < today ? monthEnd : today;
    const from14 = shiftDay(ref, -13);
    const from7 = shiftDay(ref, -6);
    const roles = this.rolesOf(actor);
    const manage = roles.some(r => MANAGE_ROLES.includes(r));
    const seeMoney = roles.some(r => MONEY_ROLES.includes(r));

    const projects = await this.projectRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.members', 'members')
      .where('p.projectType = :type', { type: 'SMM' })
      .andWhere('p.isArchived = false')
      .getMany();
    const live = projects.filter(p => String(p.status) !== 'archived');
    const ids = live.map(p => p.id);
    if (!ids.length) return { ym: month, today, ref, seeMoney, projects: [] };

    // Имена специалистов (назначение «Схемы» — smmData.smmSpecialistIds).
    const specIds = new Set<string>();
    for (const p of live) for (const id of ((p.smmData as any)?.smmSpecialistIds || [])) if (typeof id === 'string') specIds.add(id);
    const users: Array<{ id: string; name: string }> = specIds.size
      ? await this.ds.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [[...specIds]])
      : [];
    const userName = new Map(users.map(u => [u.id, u.name]));

    // Опубликованные рилсы и посты за месяц — по норме.
    const counts: Array<{ projectId: string; kind: string; n: number }> = await this.ds.query(
      `SELECT ci."projectId" AS "projectId",
              CASE WHEN ci."contentType" IN ('reel', 'video') THEN 'reel' ELSE 'post' END AS kind,
              COUNT(*)::int AS n
         FROM content_plan_items ci
        WHERE ci."projectId" = ANY($1::uuid[])
          AND ci."shootForItemId" IS NULL
          AND ci.status = 'published'
          AND ci."contentType" IN ('reel', 'video', 'post', 'design', 'carousel')
          AND ci."publishDate"::date BETWEEN $2::date AND $3::date
        GROUP BY 1, 2`,
      [ids, monthStart, monthEnd],
    );
    // Последняя публикация до опорного дня — «свежесть».
    const lasts: Array<{ projectId: string; last: string }> = await this.ds.query(
      `SELECT ci."projectId" AS "projectId", to_char(MAX(ci."publishDate"::date), 'YYYY-MM-DD') AS last
         FROM content_plan_items ci
        WHERE ci."projectId" = ANY($1::uuid[])
          AND ci."shootForItemId" IS NULL
          AND ci.status = 'published'
          AND ci."contentType" <> 'story'
          AND ci."publishDate"::date <= $2::date
        GROUP BY 1`,
      [ids, ref],
    );
    // Дни с публикациями и дни со сторис — полоса за 14 дней и сторис за 7.
    const postDays: Array<{ projectId: string; d: string }> = await this.ds.query(
      `SELECT ci."projectId" AS "projectId", to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS d
         FROM content_plan_items ci
        WHERE ci."projectId" = ANY($1::uuid[])
          AND ci."shootForItemId" IS NULL
          AND ci.status = 'published'
          AND ci."contentType" <> 'story'
          AND ci."publishDate"::date BETWEEN $2::date AND $3::date
        GROUP BY 1, 2`,
      [ids, from14, ref],
    );
    const storyDays: Array<{ projectId: string; d: string }> = await this.ds.query(
      `SELECT sl."projectId" AS "projectId", to_char(sl.date::date, 'YYYY-MM-DD') AS d
         FROM story_logs sl
        WHERE sl."projectId" = ANY($1::uuid[])
          AND sl."storiesCount" > 0
          AND sl.date::date BETWEEN $2::date AND $3::date
        GROUP BY 1, 2`,
      [ids, from14, ref],
    );
    // «По плану»: сколько рилсов и постов вышло в ЦИКЛЕ проекта и сколько
    // должно было выйти к опорному дню. Цикл не задан — считаем по месяцу.
    const winOf = new Map<string, { start: string; end: string }>();
    for (const p of live) {
      const day = Number((p.smmData as any)?.cycleStartDay);
      winOf.set(p.id, Number.isFinite(day) && day >= 1 ? cycleOf(ref, day) : { start: monthStart, end: monthEnd });
    }
    const minStart = [...winOf.values()].reduce((a, w) => (w.start < a ? w.start : a), monthStart);
    const cyclePubs: Array<{ projectId: string; d: string }> = await this.ds.query(
      `SELECT ci."projectId" AS "projectId", to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS d
         FROM content_plan_items ci
        WHERE ci."projectId" = ANY($1::uuid[])
          AND ci."shootForItemId" IS NULL
          AND ci.status = 'published'
          AND ci."contentType" IN ('reel', 'video', 'post', 'design', 'carousel')
          AND ci."publishDate"::date BETWEEN $2::date AND $3::date`,
      [ids, minStart, ref],
    );
    const postSet = new Set(postDays.map(r => `${r.projectId}|${r.d}`));
    const storySet = new Set(storyDays.map(r => `${r.projectId}|${r.d}`));

    const checks = await this.repo.find({ where: { ym: month } });
    const checkOf = new Map(checks.map(c => [c.projectId, c]));
    const byIds = new Set<string>();
    for (const c of checks) for (const id of [c.moodById, c.contactById, c.reportById]) if (id) byIds.add(id);
    const byUsers: Array<{ id: string; name: string }> = byIds.size
      ? await this.ds.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [[...byIds]])
      : [];
    for (const u of byUsers) userName.set(u.id, u.name);

    // Оплата за месяц — из Финансов, по совпадению названия проекта.
    const payOf = seeMoney ? await this.paymentsByName(month, today) : new Map<string, string>();

    const rows = live.map(p => {
      const sd: any = p.smmData || {};
      const spec: string[] = (sd.smmSpecialistIds || []).filter((x: any) => typeof x === 'string');
      const c = checkOf.get(p.id);
      const last = lasts.find(r => r.projectId === p.id)?.last || null;
      const strip: string[] = [];
      for (let k = 13; k >= 0; k--) {
        const d = shiftDay(ref, -k);
        strip.push(postSet.has(`${p.id}|${d}`) ? 'p' : storySet.has(`${p.id}|${d}`) ? 's' : '.');
      }
      const stories7: string[] = [];
      for (let k = 6; k >= 0; k--) stories7.push(storySet.has(`${p.id}|${shiftDay(ref, -k)}`) ? '1' : '0');
      const n = (kind: string) => counts.find(r => r.projectId === p.id && r.kind === kind)?.n || 0;
      const win = winOf.get(p.id)!;
      const norm = (Number(sd.normReels) || 0) + (Number(sd.normPosts) || 0);
      const total = daysBetween(win.start, win.end) + 1;
      const elapsed = Math.max(0, Math.min(total, daysBetween(win.start, ref) + 1));
      const plan = norm > 0 ? {
        done: cyclePubs.filter(r => r.projectId === p.id && r.d >= win.start && r.d <= ref).length,
        norm,
        expected: Math.floor(norm * elapsed / total),
        start: win.start, end: win.end,
      } : null;
      const isMine = p.managerId === actor.id
        || (p.members || []).some(x => x.id === actor.id)
        || spec.includes(actor.id);
      return {
        id: p.id, name: p.name,
        specialists: spec.map(id => ({ id, name: userName.get(id) || 'Сотрудник' })),
        canEdit: manage || isMine,
        mood: c?.mood ?? null, moodNote: c?.moodNote ?? null, moodAt: c?.moodAt ?? null,
        moodBy: c?.moodById ? userName.get(c.moodById) || null : null,
        contact: !!c?.contact, contactAt: c?.contactAt ?? null,
        report: !!c?.report, reportAt: c?.reportAt ?? null,
        lastPost: last, daysSincePost: last ? daysBetween(last, ref) : null,
        strip: strip.join(''), stories7: stories7.join(''),
        reels: { done: n('reel'), norm: Number(sd.normReels) || 0 },
        posts: { done: n('post'), norm: Number(sd.normPosts) || 0 },
        plan,
        payment: seeMoney ? (payOf.get(nameKey(p.name)) ?? null) : undefined,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return { ym: month, today, ref, seeMoney, projects: rows };
  }

  /** Статус оплаты месяца по названию проекта: paid — всё получено, late —
   *  есть ожидаемый платёж с прошедшим сроком, wait — ждём по сроку.
   *  Проекты Финансов с одинаковым названием не связываем — лучше «—»,
   *  чем чужая оплата. */
  private async paymentsByName(month: string, today: string): Promise<Map<string, string>> {
    const rows: Array<{ name: string; status: string; dueDate: string | null }> = await this.ds.query(
      `SELECT fp.name AS name, pp.status AS status, to_char(pp."dueDate", 'YYYY-MM-DD') AS "dueDate"
         FROM finance_projects fp
         JOIN finance_planned_payments pp ON pp."projectId" = fp.id
        WHERE COALESCE(fp.archived, false) = false AND pp.ym = $1`,
      [month],
    ).catch(() => []);
    const names: Array<{ name: string }> = await this.ds.query(
      `SELECT name FROM finance_projects WHERE COALESCE(archived, false) = false`,
    ).catch(() => []);
    const dupes = new Set<string>();
    const seen = new Set<string>();
    for (const r of names) { const k = nameKey(r.name); if (seen.has(k)) dupes.add(k); seen.add(k); }
    const agg = new Map<string, { any: boolean; open: boolean; late: boolean }>();
    for (const r of rows) {
      const k = nameKey(r.name);
      if (dupes.has(k)) continue;
      const a = agg.get(k) || { any: false, open: false, late: false };
      a.any = true;
      if (r.status !== 'received') {
        a.open = true;
        if (r.dueDate && r.dueDate < today) a.late = true;
      }
      agg.set(k, a);
    }
    const out = new Map<string, string>();
    for (const [k, a] of agg) out.set(k, a.late ? 'late' : a.open ? 'wait' : 'paid');
    return out;
  }

  /** Отметка по проекту за месяц: отзыв клиента, «на связи», «отчёт».
   *  SMM-специалист — только по своим проектам, руководство — по всем. */
  async update(projectId: string, dto: any, actor: Actor) {
    const ym = String(dto?.ym || '');
    if (!YM_RE.test(ym)) throw new BadRequestException('Некорректный месяц');
    const project = await this.projectRepo.findOne({ where: { id: projectId }, relations: ['members'] });
    if (!project) throw new NotFoundException('Проект не найден');
    const roles = this.rolesOf(actor);
    if (!roles.some(r => MANAGE_ROLES.includes(r))) {
      const spec: string[] = ((project.smmData as any)?.smmSpecialistIds || []);
      const mine = project.managerId === actor.id
        || (project.members || []).some(x => x.id === actor.id)
        || spec.includes(actor.id);
      if (!roles.includes('smm_specialist') || !mine) {
        throw new ForbiddenException('Отмечать можно только по своим проектам');
      }
    }

    let row = await this.repo.findOne({ where: { projectId, ym } });
    if (!row) row = this.repo.create({ projectId, ym, contact: false, report: false });
    const now = new Date();
    if ('mood' in (dto || {})) {
      const mood = dto.mood == null ? null : String(dto.mood);
      if (mood !== null && !MOODS.includes(mood)) throw new BadRequestException('Неизвестная оценка');
      row.mood = mood as any;
      const note = typeof dto.moodNote === 'string' ? dto.moodNote.trim().slice(0, 300) : '';
      row.moodNote = mood ? (note || null) : null;
      row.moodAt = mood ? now : null;
      row.moodById = mood ? actor.id : null;
    }
    if ('contact' in (dto || {})) {
      row.contact = !!dto.contact;
      row.contactAt = row.contact ? now : null;
      row.contactById = row.contact ? actor.id : null;
    }
    if ('report' in (dto || {})) {
      row.report = !!dto.report;
      row.reportAt = row.report ? now : null;
      row.reportById = row.report ? actor.id : null;
    }
    try {
      return await this.repo.save(row);
    } catch {
      // Две отметки одновременно: строку месяца уже создали — дописываем в неё.
      const existing = await this.repo.findOne({ where: { projectId, ym } });
      if (!existing) throw new BadRequestException('Не удалось сохранить отметку');
      Object.assign(existing, {
        mood: row.mood, moodNote: row.moodNote, moodAt: row.moodAt, moodById: row.moodById,
        contact: row.contact, contactAt: row.contactAt, contactById: row.contactById,
        report: row.report, reportAt: row.reportAt, reportById: row.reportById,
      });
      return this.repo.save(existing);
    }
  }
}
