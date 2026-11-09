import { matchScore, norm } from './common';
import { ToolContext, ToolDef, ToolError } from './types';

const ROLE_RU: Record<string, string> = {
  admin: 'админ', founder: 'основатель', smm_director: 'руководитель СММ', dev_director: 'руководитель разработки',
  smm_specialist: 'СММ-специалист', designer: 'дизайнер', sales_manager_smm: 'менеджер продаж СММ',
  sales_manager_dev: 'менеджер продаж разработки', pm_dev: 'проект-менеджер разработки', developer: 'разработчик',
  videographer: 'видеограф', video_editor: 'монтажёр', producer: 'продюсер', targetologist: 'таргетолог',
  stories_checker: 'проверяющий сторис', employee: 'сотрудник',
};

/** Сотрудники, которых человек видит на сайте (GET /employees сам режет по
 *  направлению). Метка E… — это id учётки (userId): задачи и смены живут на нём. */
export async function loadEmployees(ctx: ToolContext): Promise<Array<{ ref: string; name: string; position?: string; role?: string }>> {
  const list = await ctx.api.get<any[]>('/employees');
  return (Array.isArray(list) ? list : [])
    .filter((e) => e?.userId && (e.status || 'active') === 'active' && e.user?.isActive !== false)
    .map((e) => {
      const name = String(e.fullName || e.user?.name || '').trim();
      const role = e.user?.role ? ROLE_RU[e.user.role] || e.user.role : undefined;
      return { ref: ctx.refs.add('E', e.userId, name), name, position: e.position || undefined, role };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export const findEmployees: ToolDef<{ name?: string }> = {
  name: 'find_employees',
  kind: 'read',
  description: 'Найти сотрудника по имени (с учётом падежей: «Фирузу» → Фируз). Без имени — весь список.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Имя или фамилия, как прозвучало.' } },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const all = await loadEmployees(ctx);
    const q = norm(args.name);
    if (!q) return { total: all.length, employees: all };
    const scored = all
      .map((e) => ({ e, s: matchScore(e.name, q) }))
      .filter((x) => x.s >= 0.5)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e);
    return { total: scored.length, employees: scored.slice(0, 15) };
  },
};

const TYPE_GROUP: Record<string, string> = {
  SMM: 'smm', Дизайн: 'design',
  'Web сайт': 'dev', Лендинг: 'dev', 'Телеграм бот': 'dev', 'CRM система': 'dev', 'Интернет магазин': 'dev',
};

interface ProjectsArgs { type?: 'smm' | 'dev' | 'design' | 'any'; archived?: boolean; text?: string; mine_only?: boolean }

export const listProjects: ToolDef<ProjectsArgs> = {
  name: 'list_projects',
  kind: 'read',
  description:
    'Проекты, которые человек видит на сайте: сколько их и какие. «Сколько у меня проектов», «какие СММ-проекты», '
    + '«найди проект Архидея». Возвращает метки P…',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['smm', 'dev', 'design', 'any'], description: 'smm — СММ, dev — разработка (сайты, боты, CRM), design — дизайн.' },
      archived: { type: 'boolean', description: 'true — только архив. По умолчанию активные.' },
      text: { type: 'string', description: 'Слова из названия.' },
      mine_only: { type: 'boolean', description: 'Только где я менеджер или участник.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const list = await ctx.api.get<any[]>('/projects', args.archived ? { archived: 'true' } : undefined);
    let items = (Array.isArray(list) ? list : []).filter((p) => !!p?.id);
    if (args.type && args.type !== 'any') items = items.filter((p) => (TYPE_GROUP[p.projectType] || 'other') === args.type);
    if (args.mine_only) {
      items = items.filter((p) => p.managerId === ctx.user.id
        || (p.members || []).some((m: any) => m?.id === ctx.user.id || m?.userId === ctx.user.id)
        || (p.smmData?.smmSpecialistIds || []).includes(ctx.user.id));
    }
    if (args.text && String(args.text).trim()) {
      items = items
        .map((p) => ({ p, s: matchScore(p.name, String(args.text)) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p);
    }
    const byType: Record<string, number> = {};
    for (const p of items) byType[p.projectType || 'другое'] = (byType[p.projectType || 'другое'] || 0) + 1;
    return {
      total: items.length,
      byType,
      projects: items.slice(0, 60).map((p) => ({
        ref: ctx.refs.add('P', p.id, p.name),
        name: p.name,
        type: p.projectType,
        status: p.status,
        ...(p.isArchived ? { archived: true } : {}),
      })),
    };
  },
};

export const PEOPLE_TOOLS: ToolDef[] = [findEmployees, listProjects];

export function ensureEmployee(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('E', ref);
  if (!e) throw new ToolError(`Нет сотрудника с меткой «${ref}». Найдите его через find_employees.`);
  return e;
}
