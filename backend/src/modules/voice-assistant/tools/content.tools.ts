import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { addDays, checkDate, checkTime, fmtDateRu, matchScore, roles, splitDushanbe } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Контент-план, производство, СММ-контроль, реклама проекта — всё, что есть на
 * сайте сверх smm.tools.ts (там: план на даты, статус, перенос, «моя работа»,
 * сторис, отчёт). Права повторяют сайт; сервер проверит сам.
 *
 * Права продюсера (09.11.2026): он правит производство (съёмки, монтаж, дизайн
 * через move_content), публикации и их тексты — СММ; поэтому правка темы/
 * сценария/подписи ему недоступна (нет content-plan.edit).
 */

const apiErr = (e: any) => (e instanceof ApiError ? new ToolError(e.message) : e);
const hasRole = (u: any, list: string[]) => roles(u).some((r) => list.includes(r));

const TOP_ROLES = ['admin', 'founder'];
const SMM_ROLES = ['admin', 'founder', 'smm_director', 'smm_specialist'];
const CALENDAR_ROLES = [...SMM_ROLES, 'sales_manager_smm', 'sales_manager_dev', 'producer'];
const CONTROL_READ_ROLES = [...SMM_ROLES, 'producer', 'sales_manager_smm', 'sales_manager_dev'];
const CONTROL_WRITE_ROLES = [...SMM_ROLES, 'sales_manager_smm', 'sales_manager_dev'];
// Как MANAGE_ROLES во вкладке «Реклама» (ProjectAdsTab.tsx): таргетолог кнопок не видит.
const ADS_WRITE_ROLES = SMM_ROLES;
const PRODUCER_VIEW_ROLES = ['admin', 'founder', 'producer'];

const STAGE_RU: Record<string, string> = { shoot: 'Съёмка', edit: 'Монтаж', design: 'Дизайн' };
const TYPE_RU: Record<string, string> = { reel: 'рилс', design: 'пост/дизайн', post: 'пост', carousel: 'карусель', story: 'сторис', video: 'видео' };
const STATUS_RU: Record<string, string> = {
  planned: 'Запланировано', preparing: 'Подготовка', in_production: 'В производстве', on_review: 'На проверке',
  on_approval: 'На согласовании', approved: 'Утверждено', published: 'Опубликовано', cancelled: 'Отменено',
};
const APPROVAL_RU: Record<string, string> = {
  pending: 'ждёт согласования', approved: 'согласовано', changes_requested: 'клиент просит правки', rejected: 'отклонено',
};
const MOOD_RU: Record<string, string> = { good: 'доволен', meh: 'нейтрально', bad: 'недоволен' };
const CHANNEL_RU: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', telegram: 'Telegram', google: 'Google Ads', other: 'Другое',
};
const AD_STATUS_RU: Record<string, string> = { planned: 'запланирована', running: 'идёт', finished: 'завершена' };
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const dayOf = (v: unknown): string | null => {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return splitDushanbe(s)?.date ?? null;
};

function projectEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('P', ref);
  if (!e) throw new ToolError(`Нет проекта с меткой «${ref}». Найдите его через list_projects.`);
  return e;
}

function itemEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('I', ref);
  if (!e) throw new ToolError(`Нет карточки с меткой «${ref}». Сначала найдите её через smm_plan, content_unscheduled или my_work.`);
  return e;
}

function personEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('E', ref);
  if (!e) throw new ToolError(`Нет сотрудника с меткой «${ref}». Найдите его через find_employees или videographers.`);
  return e;
}

async function loadItem(ctx: ToolContext, id: string): Promise<any> {
  try { return await ctx.api.get(`/content-plan/${id}`); } catch (e) { throw apiErr(e); }
}

const typeLabel = (t: unknown) => TYPE_RU[String(t)] || 'публикация';

/** Этап карточки подготовки; у старых карточек без этапа — по типу родителя (как в календаре). */
async function stageOf(ctx: ToolContext, item: any): Promise<string | null> {
  if (!item?.shootForItemId) return null;
  if (item.prepStage) return String(item.prepStage);
  const parent = await loadItem(ctx, item.shootForItemId).catch(() => null);
  return String(parent?.contentType) === 'post' ? 'design' : 'shoot';
}

// ─── Чтение: контент-план ───────────────────────────────────────────────

export const contentItem: ToolDef<{ item: string }> = {
  name: 'content_item',
  kind: 'read',
  description:
    'Подробности одной карточки контент-плана: тема, тип, статус, дата и время, сценарий, подпись, исполнитель, согласование. '
    + '«Прочитай сценарий рилса про осень», «какая подпись у поста». Метка I… берётся из smm_plan / content_unscheduled / my_work.',
  parameters: {
    type: 'object',
    properties: { item: { type: 'string', description: 'Метка I…' } },
    required: ['item'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, [...CALENDAR_ROLES, 'videographer', 'video_editor', 'designer']),
  async run(args, ctx) {
    const e = itemEntry(ctx, args.item);
    const it = await loadItem(ctx, e.id);
    const when = it.publishDate ? dayOf(it.publishDate) : null;
    const clip = (v: unknown, n: number) => (v ? String(v).slice(0, n) : undefined);
    return {
      label: e.label,
      kind: it.shootForItemId ? `подготовка (${STAGE_RU[it.prepStage] || 'съёмка'})` : typeLabel(it.contentType),
      topic: it.topic,
      status: STATUS_RU[it.status] || it.status,
      date: when ? fmtDateRu(when) : 'без даты',
      ...(it.publishTime ? { time: it.publishTime } : {}),
      ...(it.shootPlace ? { place: it.shootPlace } : {}),
      ...(it.assignee?.name ? { assignee: it.assignee.name } : {}),
      ...(it.approvalStatus ? { approval: APPROVAL_RU[it.approvalStatus] || it.approvalStatus } : {}),
      script: clip(it.scriptText, 3000),
      caption: clip(it.caption, 1500),
      comments: clip(it.comments, 800),
      fileLink: clip(it.fileLink, 300),
    };
  },
};

export const contentHistory: ToolDef<{ item: string }> = {
  name: 'content_history',
  kind: 'read',
  description:
    'История карточки контент-плана: когда и кто переносил, закрывал, отменял. «Сколько раз переносили рилс про осень», '
    + '«кто отменил съёмку». Метка I…',
  parameters: {
    type: 'object',
    properties: { item: { type: 'string', description: 'Метка I…' } },
    required: ['item'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CALENDAR_ROLES),
  async run(args, ctx) {
    const e = itemEntry(ctx, args.item);
    let rows: any[];
    try { rows = await ctx.api.get<any[]>(`/content-plan/item/${e.id}/history`); } catch (err) { throw apiErr(err); }
    const day = (v: unknown) => (v ? fmtDateRu(String(v).slice(0, 10)) : 'без даты');
    return {
      card: e.label,
      total: (rows || []).length,
      events: (rows || []).map((r) => {
        const what = r.kind === 'move' ? `перенос: ${day(r.from)} → ${day(r.to)}`
          : r.kind === 'status' ? `статус: ${STATUS_RU[r.from] || r.from} → ${STATUS_RU[r.to] || r.to}`
            : String(r.kind || 'изменение');
        return { at: r.at, who: r.who || 'система', what };
      }),
    };
  },
};

export const contentUnscheduled: ToolDef<{ project?: string; text?: string }> = {
  name: 'content_unscheduled',
  kind: 'read',
  description:
    'Контент «Не запланировано» — рилсы, посты и подготовка без даты (заготовки «Рилс 3», «Пост 2»). '
    + '«Что у Архидеи не поставлено на даты», «найди заготовку рилса». Метки I… для content_edit / move_content. '
    + 'Не для календаря на даты — там smm_plan.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      text: { type: 'string', description: 'Слова из темы.' },
    },
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CALENDAR_ROLES),
  async run(args, ctx) {
    const project = args.project ? projectEntry(ctx, args.project) : null;
    let res: any;
    try {
      res = await ctx.api.get('/content-plan/smm-calendar', { from: ctx.today, to: ctx.today, ...(project ? { projectId: project.id } : {}) });
    } catch (e) { throw apiErr(e); }
    let rows: any[] = (res?.backlog || []).filter((b: any) => b.itemId && (!project || b.projectId === project.id));
    if (args.text && String(args.text).trim()) {
      rows = rows.filter((b) => matchScore(`${b.topic || ''} ${b.title || ''}`, String(args.text)) >= 0.5);
    }
    return {
      total: rows.length,
      items: rows.slice(0, 40).map((b) => {
        const isPrep = b.kind === 'shoot';
        const what = isPrep ? `${STAGE_RU[b.prepStage] || 'Съёмка'} «${b.title || ''}»` : `${typeLabel(b.contentType)} «${b.topic || ''}»`;
        return {
          ref: ctx.refs.add('I', b.itemId, `${b.projectName}: ${what}`),
          project: b.projectName,
          what,
          ...(b.scriptText ? { hasScript: true } : {}),
        };
      }),
    };
  },
};

// ─── Создание, правка, удаление публикации ──────────────────────────────

interface CreateArgs { project: string; type: 'reel' | 'post' | 'carousel'; topic: string; date?: string; time?: string; script_text?: string; caption?: string }

export const contentCreate: ToolDef<CreateArgs> = {
  name: 'content_create',
  kind: 'write',
  description:
    'Добавить публикацию в контент-план проекта: «добавь рилс про осеннюю коллекцию Архидее на 15 ноября», '
    + '«заведи пост …». type: reel — рилс, post — пост, carousel — карусель. Дата и время необязательны (без даты попадёт в «Не запланировано»). '
    + 'Для рилса с датой съёмка заводится сама. НЕ для сторис, НЕ для рекламы (там project_ad_create), НЕ для переноса существующей карточки (move_content).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка СММ-проекта P…' },
      type: { type: 'string', enum: ['reel', 'post', 'carousel'] },
      topic: { type: 'string', description: 'Тема (до 300 символов).' },
      date: { type: 'string', description: 'День выхода ГГГГ-ММ-ДД.' },
      time: { type: 'string', description: 'Время выхода ЧЧ:ММ (только вместе с датой).' },
      script_text: { type: 'string', description: 'Сценарий / описание, если продиктовано.' },
      caption: { type: 'string', description: 'Подпись к публикации, если продиктована.' },
    },
    required: ['project', 'type', 'topic'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'content-plan.create'),
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    if (!['reel', 'post', 'carousel'].includes(args.type)) throw new ToolError('Тип публикации: рилс, пост или карусель.');
    const topic = String(args.topic || '').trim();
    if (!topic) throw new ToolError('О чём публикация? Назовите тему.');
    if (topic.length > 300) throw new ToolError('Тема длиннее 300 символов — сократите.');
    const date = args.date ? checkDate(args.date) : null;
    if (date && date < ctx.today) throw new ToolError(`Дата ${fmtDateRu(date)} уже прошла.`);
    const time = args.time ? checkTime(args.time) : null;
    if (time && !date) throw new ToolError('Время указано без даты. На какой день поставить?');
    const body: Record<string, any> = { projectId: p.id, contentType: args.type, topic };
    if (date) body.publishDate = date;
    if (args.script_text && String(args.script_text).trim()) body.scriptText = String(args.script_text).trim().slice(0, 10000);
    if (args.caption && String(args.caption).trim()) body.caption = String(args.caption).trim().slice(0, 5000);
    let created: any;
    try { created = await ctx.api.post('/content-plan', body); } catch (e) { throw apiErr(e); }
    if (!created?.id) throw new ToolError('Сайт не вернул созданную карточку — проверьте контент-план.');
    if (time) {
      try { await ctx.api.patch(`/content-plan/smart-item/${created.id}`, { publishTime: time }); } catch (e) {
        throw new ToolError(`Карточка создана, но время ${time} поставить не удалось: ${(apiErr(e) as Error).message}`);
      }
    }
    const label = `${p.label}: ${typeLabel(args.type)} «${topic}»`;
    const ref = ctx.refs.add('I', created.id, label);
    return {
      summary: `🎬 Добавлено в контент-план: ${label}${date ? `, ${fmtDateRu(date)}${time ? ` ${time}` : ''}` : ' (без даты)'} [${ref}]`,
      undo: [{ method: 'DELETE', path: `/content-plan/${created.id}` }],
    };
  },
};

interface EditArgs { item: string; topic?: string; script_text?: string; caption?: string; comment?: string; file_link?: string }

const EDIT_FIELDS: Array<{ arg: keyof EditArgs; field: string; max: number; name: string }> = [
  { arg: 'topic', field: 'topic', max: 300, name: 'тема' },
  { arg: 'script_text', field: 'scriptText', max: 10000, name: 'сценарий' },
  { arg: 'caption', field: 'caption', max: 5000, name: 'подпись' },
  { arg: 'comment', field: 'comments', max: 2000, name: 'комментарий' },
  { arg: 'file_link', field: 'fileLink', max: 2000, name: 'ссылка на материал' },
];

export const contentEdit: ToolDef<EditArgs> = {
  name: 'content_edit',
  kind: 'write',
  description:
    'Изменить текст публикации контент-плана: тему, сценарий, подпись, комментарий, ссылку на материал. '
    + '«Поменяй тему рилса на …», «допиши в сценарий …» (передайте ПОЛНЫЙ новый текст — он заменяет прежний), «подпись к посту: …». '
    + 'Пустая строка очищает поле. НЕ для даты/времени/места (move_content), НЕ для статуса (set_content_status), НЕ для исполнителя (content_assign). '
    + 'Продюсеру недоступно: публикации правит СММ.',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка I… публикации (не карточки подготовки).' },
      topic: { type: 'string' },
      script_text: { type: 'string', description: 'Полный новый сценарий.' },
      caption: { type: 'string', description: 'Полная новая подпись.' },
      comment: { type: 'string' },
      file_link: { type: 'string' },
    },
    required: ['item'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'content-plan.edit'),
  async run(args, ctx): Promise<WriteOutcome> {
    const e = itemEntry(ctx, args.item);
    const body: Record<string, any> = {};
    const changed: string[] = [];
    for (const f of EDIT_FIELDS) {
      const raw = args[f.arg];
      if (raw === undefined || raw === null) continue;
      const v = String(raw).trim();
      if (f.field === 'topic' && !v) throw new ToolError('Тема не может быть пустой.');
      if (v.length > f.max) throw new ToolError(`Поле «${f.name}» длиннее ${f.max} символов.`);
      body[f.field] = v || null;
      changed.push(f.name);
    }
    if (!changed.length) throw new ToolError('Не понял, что менять в карточке: тему, сценарий или подпись?');
    const old = await loadItem(ctx, e.id);
    if (old.shootForItemId) throw new ToolError('Это карточка подготовки (съёмка/монтаж/дизайн). Тексты правятся у самой публикации.');
    try { await ctx.api.patch(`/content-plan/${e.id}`, body); } catch (err) { throw apiErr(err); }
    const undoBody: Record<string, any> = {};
    for (const key of Object.keys(body)) undoBody[key] = old[key] ?? null;
    return {
      summary: `✏️ ${e.label}: изменено — ${changed.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/content-plan/${e.id}`, body: undoBody }],
    };
  },
};

export const contentDelete: ToolDef<{ item: string }> = {
  name: 'content_delete',
  kind: 'write',
  description:
    'УДАЛИТЬ публикацию из контент-плана (вместе с её съёмкой, монтажом и дизайном). «Удали рилс про осень». '
    + 'Не путать с «отмени» — это set_content_status со статусом cancelled (карточка остаётся). Всегда с подтверждением.',
  parameters: {
    type: 'object',
    properties: { item: { type: 'string', description: 'Метка I…' } },
    required: ['item'],
    additionalProperties: false,
  },
  available: (u) => hasGrant(u as any, 'content-plan.delete'),
  confirm: () => true,
  async preview(args, ctx) {
    const e = itemEntry(ctx, args.item);
    const it = await loadItem(ctx, e.id);
    const when = it.publishDate ? dayOf(it.publishDate) : null;
    return `🗑 УДАЛИТЬ ИЗ КОНТЕНТ-ПЛАНА\n${e.label}${when ? `\n📅 ${fmtDateRu(when)}` : ''}`
      + `\n⚠️ Исчезнут и связанные карточки съёмки, монтажа и дизайна. Вернуть нельзя.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = itemEntry(ctx, args.item);
    try { await ctx.api.delete(`/content-plan/${e.id}`); } catch (err) { throw apiErr(err); }
    return { summary: `🗑 Удалено из контент-плана: ${e.label}` };
  },
};

// ─── Исполнители: видеограф, монтажёр, дизайнер ─────────────────────────

export const videographers: ToolDef<Record<string, never>> = {
  name: 'videographers',
  kind: 'read',
  description:
    'Видеографы агентства и кто из них основной (по умолчанию для новых съёмок). «Кто у нас основной видеограф», '
    + '«каким видеографам можно передать съёмку». Метки E… для content_assign.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: (u) => hasRole(u, [...CALENDAR_ROLES, 'videographer']),
  async run(_args, ctx) {
    let res: any;
    try { res = await ctx.api.get('/content-plan/shoot-assignees'); } catch (e) { throw apiErr(e); }
    const list: any[] = res?.candidates || [];
    return {
      canManage: !!res?.canManage,
      default: list.find((c) => c.id === res?.defaultId)?.name ?? null,
      videographers: list.map((c) => ({ ref: ctx.refs.add('E', c.id, c.name), name: c.name, isDefault: c.id === res?.defaultId })),
    };
  },
};

interface AssignArgs { item: string; person?: string; unassign?: boolean }

const ROLE_WORD: Record<string, string> = { shoot: 'ВИДЕОГРАФА', edit: 'МОНТАЖЁРА', design: 'ДИЗАЙНЕРА' };

export const contentAssign: ToolDef<AssignArgs> = {
  name: 'content_assign',
  kind: 'write',
  description:
    'Назначить исполнителя на карточку подготовки: видеографа на СЪЁМКУ, монтажёра на МОНТАЖ, дизайнера на ДИЗАЙН '
    + '(«поставь Ахмада на съёмку рилса про осень», «монтаж отдай Фирузу»). Метка I… — именно карточки съёмки/монтажа/дизайна '
    + '(из smm_plan, видны как «Съёмка/Монтаж/Дизайн «…»»), не самой публикации. person — метка E… сотрудника нужной роли; '
    + 'unassign=true снимает исполнителя. Назначает руководство (основатель/админ); видеограф может передать свою съёмку другому видеографу. '
    + 'Всегда с подтверждением. НЕ для задач (update_task).',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Метка I… карточки подготовки.' },
      person: { type: 'string', description: 'Метка E… сотрудника.' },
      unassign: { type: 'boolean', description: 'Снять исполнителя (вместо person).' },
    },
    required: ['item'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, [...TOP_ROLES, 'videographer']),
  confirm: () => true,
  async preview(args, ctx) {
    const e = itemEntry(ctx, args.item);
    const item = await loadItem(ctx, e.id);
    const stage = await stageOf(ctx, item);
    if (!stage) throw new ToolError('Исполнителя назначают на карточки съёмки, монтажа или дизайна, а не на саму публикацию.');
    const who = args.unassign ? null : personEntry(ctx, args.person);
    if (!args.unassign && !args.person) throw new ToolError('Кого назначить? Назовите сотрудника или скажите «снять исполнителя».');
    return who
      ? `👤 НАЗНАЧИТЬ ${ROLE_WORD[stage] || 'ИСПОЛНИТЕЛЯ'}\n${e.label}\n→ ${who.label}`
      : `👤 СНЯТЬ ИСПОЛНИТЕЛЯ\n${e.label}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const e = itemEntry(ctx, args.item);
    if (!args.unassign && !args.person) throw new ToolError('Кого назначить? Назовите сотрудника или скажите «снять исполнителя».');
    const who = args.unassign ? null : personEntry(ctx, args.person);
    const item = await loadItem(ctx, e.id);
    const stage = await stageOf(ctx, item);
    if (!stage) throw new ToolError('Исполнителя назначают на карточки съёмки, монтажа или дизайна, а не на саму публикацию.');
    const isTop = hasRole(ctx.user, TOP_ROLES);
    const ownShoot = stage === 'shoot' && item.assigneeId === ctx.user.id;
    if (!isTop && !ownShoot) {
      throw new ToolError('Назначать исполнителя может руководство. Видеограф может передать только свою съёмку.');
    }
    const path = isTop ? `/content-plan/prep/${e.id}/assignee` : `/content-plan/shoot/${e.id}/assignee`;
    try { await ctx.api.patch(path, { userId: who ? who.id : null }); } catch (err) { throw apiErr(err); }
    const oldId: string | null = item.assigneeId ?? null;
    return {
      summary: who ? `👤 ${e.label} → ${who.label}` : `👤 ${e.label}: исполнитель снят`,
      // Отменить передачу своей съёмки может только тот, у кого она осталась: у видеографа — нет.
      undo: isTop ? [{ method: 'PATCH', path, body: { userId: oldId } }] : undefined,
    };
  },
};

export const setDefaultVideographer: ToolDef<{ person?: string; clear?: boolean }> = {
  name: 'set_default_videographer',
  kind: 'write',
  description:
    'Назначить ОСНОВНОГО видеографа: за ним закрепляются все новые съёмки, а будущие незакрытые съёмки проектов без своего видеографа '
    + 'переезжают к нему. «Сделай Ахмада основным видеографом». clear=true — убрать основного. Только основатель/админ, с подтверждением. '
    + 'НЕ для одной съёмки (content_assign).',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Метка E… видеографа.' },
      clear: { type: 'boolean', description: 'Убрать основного видеографа.' },
    },
    additionalProperties: false,
  },
  available: (u) => hasRole(u, TOP_ROLES),
  confirm: () => true,
  async preview(args, ctx) {
    if (args.clear) return '👤 УБРАТЬ ОСНОВНОГО ВИДЕОГРАФА\nНовые съёмки больше не будут закрепляться за одним человеком.';
    if (!args.person) throw new ToolError('Кого сделать основным видеографом?');
    const who = personEntry(ctx, args.person);
    return `👤 НАЗНАЧИТЬ ОСНОВНОГО ВИДЕОГРАФА\n→ ${who.label}\n⚠️ Его получат новые съёмки и будущие незакрытые съёмки проектов без своего видеографа.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    if (!args.clear && !args.person) throw new ToolError('Кого сделать основным видеографом?');
    const who = args.clear ? null : personEntry(ctx, args.person);
    let res: any;
    try { res = await ctx.api.patch('/content-plan/default-videographer', { userId: who ? who.id : null }); } catch (e) { throw apiErr(e); }
    const moved = Number(res?.moved) || 0;
    return {
      summary: who
        ? `👤 Основной видеограф: ${who.label}${moved ? `. Передано будущих съёмок: ${moved}` : ''}`
        : '👤 Основной видеограф снят',
    };
  },
};

// ─── Панель продюсера ───────────────────────────────────────────────────

export const producerShoots: ToolDef<{ date_from?: string; date_to?: string }> = {
  name: 'producer_shoots',
  kind: 'read',
  description:
    'Панель продюсера: съёмки СММ-проектов на даты — время, проект, адрес, контакт клиента, видеограф, готов ли сценарий, снято ли. '
    + '«Какие съёмки на этой неделе», «где и когда съёмка Архидеи, кто едет, есть сценарий?». Метки I… у съёмок. '
    + 'Для продюсера, основателя, админа.',
  parameters: {
    type: 'object',
    properties: {
      date_from: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      date_to: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию +6 дней.' },
    },
    additionalProperties: false,
  },
  available: (u) => hasRole(u, PRODUCER_VIEW_ROLES),
  async run(args, ctx) {
    const from = args.date_from ? checkDate(args.date_from) : ctx.today;
    const to = args.date_to ? checkDate(args.date_to) : addDays(from, 6);
    if (to < from) throw new ToolError('Конец периода раньше начала.');
    let res: any;
    try { res = await ctx.api.get('/producer/shoots', { from, to }); } catch (e) { throw apiErr(e); }
    const items: any[] = res?.items || [];
    return {
      period: from === to ? fmtDateRu(from) : `${fmtDateRu(from)} — ${fmtDateRu(to)}`,
      total: items.length,
      shoots: items.slice(0, 40).map((s) => ({
        ref: ctx.refs.add('I', s.id, `${s.projectName}: Съёмка «${s.title || ''}»`),
        date: s.date ? fmtDateRu(s.date) : 'без даты',
        time: s.time || 'весь день',
        project: s.projectName,
        title: s.title,
        videographer: s.videographer || 'не назначен',
        script: s.hasScript ? 'есть' : 'нет',
        done: !!s.done,
        ...(s.address ? { address: s.address } : {}),
        ...(s.contact ? { contact: s.contact } : {}),
        ...(s.smm ? { smm: s.smm } : {}),
      })),
    };
  },
};

// ─── Авто-заготовки и авто-план ─────────────────────────────────────────

interface FillArgs { project: string; reels?: number; posts?: number }

async function calendarProject(ctx: ToolContext, projectId: string): Promise<any> {
  let res: any;
  try { res = await ctx.api.get('/content-plan/smm-calendar', { from: ctx.today, to: ctx.today, projectId }); } catch (e) { throw apiErr(e); }
  const p = (res?.projects || []).find((x: any) => x.id === projectId);
  if (!p) throw new ToolError('Это не СММ-проект или он в архиве: контент-план ведётся только у активных СММ-проектов.');
  return p;
}

export const contentFillToNorm: ToolDef<FillArgs> = {
  name: 'content_fill_to_norm',
  kind: 'write',
  description:
    'Создать заготовки «Рилс N» / «Пост N» под норму цикла проекта (кнопка «догенерировать» в умном календаре). '
    + '«Сделай заготовки на месяц для Архидеи». Без reels/posts берётся норма проекта. ВНИМАНИЕ: лишние пустые заготовки '
    + '(«Рилс N» сверх нормы) удаляются. Всегда с подтверждением. НЕ расставляет по датам — для этого content_auto_plan.',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка СММ-проекта P…' },
      reels: { type: 'integer', description: 'Сколько рилсов должно быть за цикл (0–999). По умолчанию норма проекта.' },
      posts: { type: 'integer', description: 'Сколько постов за цикл (0–999). По умолчанию норма проекта.' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, SMM_ROLES),
  confirm: () => true,
  async preview(args, ctx) {
    const p = projectEntry(ctx, args.project);
    const { reels, posts } = await fillCounts(args, ctx, p.id);
    return `🧩 ЗАГОТОВКИ ПОД НОРМУ ЦИКЛА\n📁 ${p.label}\nРилсов: ${reels}, постов: ${posts}`
      + `\n⚠️ Пустые заготовки сверх этого числа удалятся.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    const { reels, posts } = await fillCounts(args, ctx, p.id);
    try { await ctx.api.post('/content-plan/smart-generate', { projectId: p.id, reels, posts }); } catch (e) { throw apiErr(e); }
    return { summary: `🧩 ${p.label}: заготовки под норму цикла — рилсов ${reels}, постов ${posts}` };
  },
};

async function fillCounts(args: FillArgs, ctx: ToolContext, projectId: string): Promise<{ reels: number; posts: number }> {
  const check = (v: unknown, name: string): number => {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 999) throw new ToolError(`${name}: число от 0 до 999.`);
    return n;
  };
  if (args.reels !== undefined && args.posts !== undefined) return { reels: check(args.reels, 'Рилсы'), posts: check(args.posts, 'Посты') };
  const p = await calendarProject(ctx, projectId);
  const reels = args.reels !== undefined ? check(args.reels, 'Рилсы') : p.normReels;
  const posts = args.posts !== undefined ? check(args.posts, 'Посты') : p.normPosts;
  if (reels == null || posts == null) throw new ToolError('У проекта не задана норма рилсов и постов. Скажите, сколько нужно.');
  return { reels, posts };
}

interface AutoRules {
  reelDays: number[]; postDays: number[]; reelTime: string; postTime: string
  shootLead: number; shootTime: string; sep: boolean; spread: boolean; auto: boolean
}

/** Правила по умолчанию. auto=false: голосом периодический автозапуск не включаем. */
const DEFAULT_RULES: AutoRules = {
  reelDays: [0, 2, 4], postDays: [1, 3], reelTime: '19:00', postTime: '12:00',
  shootLead: 2, shootTime: '11:00', sep: true, spread: true, auto: false,
};

const weekdayOf = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
const maxIso = (...xs: string[]) => xs.reduce((a, b) => (a > b ? a : b));

/** Окно цикла проекта — как activeCycleWindow на сервере. */
export function cycleWindow(cycleStartDay: unknown, anchor: unknown, today: string): { start: string; end: string } | null {
  const day = Number(cycleStartDay);
  if (!Number.isFinite(day) || day < 1) return null;
  const ref = typeof anchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchor) && today < anchor ? anchor : today;
  const [y, m, d] = ref.split('-').map(Number);
  const dim = (yy: number, mm0: number) => new Date(Date.UTC(yy, mm0 + 1, 0)).getUTCDate();
  let sy = y, sm = m - 1;
  if (d < Math.min(day, dim(sy, sm))) { sm -= 1; if (sm < 0) { sm = 11; sy -= 1; } }
  const start = new Date(Date.UTC(sy, sm, Math.min(day, dim(sy, sm))));
  const ey = start.getUTCFullYear(), em = start.getUTCMonth() + 1;
  const end = new Date(Date.UTC(ey, em, Math.min(day, dim(ey, em))));
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Раскладка по дням — та же логика, что ContentPlanService.planDates и AutoPlanModal на сайте. */
export function planDates(input: {
  window: { start: string; end: string }; today: string; startFrom: string
  rules: AutoRules; reels: number; posts: number; taken: Set<string>; busy: Set<string>
}): { reels: string[]; posts: string[] } {
  const { window: w, rules } = input;
  const rMin = maxIso(w.start, input.startFrom, addDays(input.today, 1 + rules.shootLead));
  const pMin = maxIso(w.start, input.startFrom, addDays(input.today, 2));
  const cands = (min: string, days: number[]) => {
    const out: string[] = [];
    for (let d = min, guard = 0; d <= w.end && guard < 400; d = addDays(d, 1), guard++) {
      if (days.includes(weekdayOf(d))) out.push(d);
    }
    return out;
  };
  const prefer = (pool: string[], bad: Set<string>, k: number) => {
    const ok = pool.filter((d) => !bad.has(d));
    return ok.length >= k ? ok : pool;
  };
  const pick = (pool: string[], k: number) => {
    if (k <= 0) return [];
    if (pool.length <= k) return pool.slice();
    const out: string[] = [];
    for (let i = 0; i < k; i++) out.push(pool[Math.floor((i + 0.5) * pool.length / k)]);
    return out;
  };
  let rPool = prefer(cands(rMin, rules.reelDays), input.taken, input.reels);
  if (rules.spread) rPool = prefer(rPool, input.busy, input.reels);
  const reels = pick(rPool, input.reels);
  let pPool = prefer(cands(pMin, rules.postDays), input.taken, input.posts);
  if (rules.sep) pPool = prefer(pPool, new Set(reels), input.posts);
  if (rules.spread) pPool = prefer(pPool, input.busy, input.posts);
  return { reels, posts: pick(pPool, input.posts) };
}

interface AutoPlanResult {
  rules: AutoRules
  window: { start: string; end: string }
  reels: Array<{ itemId: string | null; date: string }>
  posts: Array<{ itemId: string | null; date: string }>
  newStubs: number
}

const stubNum = (e: any) => Number(String(e.topic || '').replace(/\D+/g, '')) || 9999;
const byStub = (a: any, b: any) => stubNum(a) - stubNum(b) || String(a.topic || '').localeCompare(String(b.topic || ''), 'ru');

async function buildAutoPlan(ctx: ToolContext, projectId: string, startFrom?: string): Promise<AutoPlanResult> {
  const tomorrow = addDays(ctx.today, 1);
  // Окно цикла нужно до выбора диапазона календаря: берём проект, затем цикл.
  const proj = await calendarProject(ctx, projectId);
  const win = cycleWindow(proj.cycleStartDay, proj.cycleAnchor, ctx.today) ?? { start: tomorrow, end: addDays(ctx.today, 30) };
  let cal: any;
  try { cal = await ctx.api.get('/content-plan/smm-calendar', { from: win.start, to: win.end }); } catch (e) { throw apiErr(e); }
  const project = (cal?.projects || []).find((p: any) => p.id === projectId) ?? proj;
  const rules: AutoRules = { ...DEFAULT_RULES, ...(project.autoPlan || {}) };

  const pubs = (cal?.events || []).filter((e: any) => e.kind === 'publication' && e.contentType !== 'story' && !!e.date);
  const isReel = (e: any) => e.contentType === 'reel';
  const scheduled = pubs.filter((e: any) => e.projectId === projectId && e.date >= win.start && e.date <= win.end);
  const backlog = (cal?.backlog || []).filter((b: any) => b.projectId === projectId && b.kind === 'publication' && b.itemId);
  const blR = backlog.filter(isReel).sort(byStub);
  const blP = backlog.filter((e: any) => !isReel(e)).sort(byStub);
  const schedR = scheduled.filter(isReel).length;
  const schedP = scheduled.length - schedR;
  const normR = Number(project.normReels) || 0;
  const normP = Number(project.normPosts) || 0;
  const needR = normR > 0 ? Math.max(0, normR - schedR) : blR.length;
  const needP = normP > 0 ? Math.max(0, normP - schedP) : blP.length;
  if (!needR && !needP) throw new ToolError('По этому проекту всё уже расставлено по норме цикла — расставлять нечего.');

  const specs = new Set<string>(project.specialistIds || []);
  const related = new Set<string>((cal?.projects || [])
    .filter((p: any) => p.id !== projectId && (p.specialistIds || []).some((s: string) => specs.has(s)))
    .map((p: any) => p.id));
  const busy = new Set<string>(pubs.filter((e: any) => related.has(e.projectId)).map((e: any) => String(e.date)));
  const taken = new Set<string>(scheduled.map((e: any) => String(e.date)));

  const start = startFrom ? maxIso(checkDate(startFrom), tomorrow) : maxIso(win.start, tomorrow);
  const plan = planDates({ window: win, today: ctx.today, startFrom: start, rules, reels: needR, posts: needP, taken, busy });
  if (!plan.reels.length && !plan.posts.length) {
    throw new ToolError('В окне цикла не нашлось подходящих дней по правилам проекта (дни недели, время на съёмку). Попробуйте позже начало или другие дни.');
  }
  return {
    rules, window: win,
    reels: plan.reels.slice().sort().map((date, i) => ({ date, itemId: blR[i]?.itemId ?? null })),
    posts: plan.posts.slice().sort().map((date, i) => ({ date, itemId: blP[i]?.itemId ?? null })),
    newStubs: plan.reels.filter((_, i) => !blR[i]).length + plan.posts.filter((_, i) => !blP[i]).length,
  };
}

const fmtDays = (dates: string[]) => (dates.length ? dates.map((d) => `${fmtDateRu(d)} (${WEEKDAYS_SHORT[weekdayOf(d)]})`).join(', ') : '—');

export const contentAutoPlan: ToolDef<{ project: string; start_from?: string }> = {
  name: 'content_auto_plan',
  kind: 'write',
  description:
    'Авто-план: расставить рилсы и посты проекта по датам цикла по его правилам (дни недели, время, съёмка за 2 дня до выхода) — '
    + 'как кнопка «Расставить» в умном календаре. «Расставь контент-план Архидеи на месяц». Недостающее до нормы создаётся заготовками. '
    + 'Показывает даты и ждёт подтверждения. НЕ создаёт одну публикацию (content_create) и не двигает отдельную (move_content).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка СММ-проекта P…' },
      start_from: { type: 'string', description: 'С какого дня начинать ГГГГ-ММ-ДД (по умолчанию с начала цикла/завтра).' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, SMM_ROLES),
  confirm: () => true,
  async preview(args, ctx) {
    const p = projectEntry(ctx, args.project);
    const plan = await buildAutoPlan(ctx, p.id, args.start_from);
    return `🗓 РАССТАВИТЬ КОНТЕНТ-ПЛАН ПО ПРАВИЛАМ\n📁 ${p.label}\nЦикл: ${fmtDateRu(plan.window.start)} — ${fmtDateRu(plan.window.end)}`
      + `\n🎬 Рилсы (${plan.reels.length}): ${fmtDays(plan.reels.map((x) => x.date))}`
      + `\n🖼 Посты (${plan.posts.length}): ${fmtDays(plan.posts.map((x) => x.date))}`
      + (plan.newStubs ? `\n➕ Новых заготовок: ${plan.newStubs}` : '')
      + `\nДля рилсов заведутся съёмки. Правила проекта сохранятся.`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    const plan = await buildAutoPlan(ctx, p.id, args.start_from);
    let res: any;
    try {
      res = await ctx.api.post(`/content-plan/auto-plan/${p.id}`, { rules: plan.rules, reels: plan.reels, posts: plan.posts });
    } catch (e) { throw apiErr(e); }
    const placed = Number(res?.placed) || 0;
    const skipped = Number(res?.skipped) || 0;
    return { summary: `🗓 ${p.label}: расставлено публикаций ${placed}${skipped ? `, пропущено ${skipped}` : ''}` };
  },
};

// ─── СММ-контроль ───────────────────────────────────────────────────────

const checkYm = (v: unknown, today: string): string => {
  if (v === undefined || v === null || v === '') return today.slice(0, 7);
  const s = String(v).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ToolError(`Неверный месяц «${s}». Нужен формат ГГГГ-ММ.`);
  return s;
};

export const smmControlList: ToolDef<{ ym?: string; project?: string; text?: string }> = {
  name: 'smm_control_list',
  kind: 'read',
  description:
    'СММ-контроль по проектам за месяц: настроение клиента, «на связи», «отчёт клиенту отправлен», «реклама идёт», '
    + 'дни без постов, рилсы/посты по норме и «по плану», специалисты. «Кто из клиентов недоволен», «по каким проектам нет отчёта», '
    + '«как дела у Архидеи в контроле». Метки P…',
  parameters: {
    type: 'object',
    properties: {
      ym: { type: 'string', description: 'Месяц ГГГГ-ММ, по умолчанию текущий.' },
      project: { type: 'string', description: 'Метка проекта P… — один проект.' },
      text: { type: 'string', description: 'Слова из названия проекта.' },
    },
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CONTROL_READ_ROLES),
  async run(args, ctx) {
    const ym = checkYm(args.ym, ctx.today);
    let res: any;
    try { res = await ctx.api.get('/smm-control', { ym }); } catch (e) { throw apiErr(e); }
    let rows: any[] = res?.projects || [];
    if (args.project) { const p = projectEntry(ctx, args.project); rows = rows.filter((r) => r.id === p.id); }
    if (args.text && String(args.text).trim()) rows = rows.filter((r) => matchScore(r.name, String(args.text)) >= 0.5);
    return {
      month: ym,
      total: rows.length,
      projects: rows.slice(0, 60).map((r) => ({
        ref: ctx.refs.add('P', r.id, r.name),
        project: r.name,
        specialists: (r.specialists || []).map((s: any) => s.name),
        mood: r.mood ? `${MOOD_RU[r.mood] || r.mood}${r.moodNote ? ` — ${r.moodNote}` : ''}` : 'не отмечено',
        contact: !!r.contact,
        reportSent: !!r.report,
        adsRunning: !!r.ads?.running,
        daysSincePost: r.daysSincePost,
        reels: r.reels ? `${r.reels.done}/${r.reels.norm}` : undefined,
        posts: r.posts ? `${r.posts.done}/${r.posts.norm}` : undefined,
        ...(r.plan ? { plan: `${r.plan.done} из ${r.plan.expected} к сегодня (норма ${r.plan.norm})` } : {}),
        ...(r.payment ? { payment: ({ paid: 'оплачено', late: 'просрочено', wait: 'ждём' } as Record<string, string>)[r.payment] || r.payment } : {}),
        canMark: !!r.canEdit,
      })),
    };
  },
};

interface MarkArgs { project: string; ym?: string; mood?: 'good' | 'meh' | 'bad' | 'none'; mood_note?: string; contact?: boolean; report?: boolean; ads?: boolean }

export const smmControlMark: ToolDef<MarkArgs> = {
  name: 'smm_control_mark',
  kind: 'write',
  description:
    'Отметка в СММ-контроле по проекту за месяц. mood: good — клиент доволен, meh — нейтрально, bad — недоволен, none — снять оценку '
    + '(mood_note — пояснение). contact=true — «на связи с клиентом». report=true — «отчёт клиенту отправлен» (только ОТМЕТКА, '
    + 'ничего клиенту не отправляется). ads=true/false — «реклама идёт / остановлена» (держится, пока не выключат). '
    + '«Отметь, что Архидея недовольна — просит другой стиль», «отчёт Архидее отправили». '
    + 'НЕ создаёт и не меняет рекламные кампании (project_ad_*).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка СММ-проекта P…' },
      ym: { type: 'string', description: 'Месяц ГГГГ-ММ, по умолчанию текущий.' },
      mood: { type: 'string', enum: ['good', 'meh', 'bad', 'none'] },
      mood_note: { type: 'string', description: 'Пояснение к оценке (до 300 символов).' },
      contact: { type: 'boolean' },
      report: { type: 'boolean' },
      ads: { type: 'boolean' },
    },
    required: ['project'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, CONTROL_WRITE_ROLES),
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    const ym = checkYm(args.ym, ctx.today);
    if (args.mood !== undefined && !['good', 'meh', 'bad', 'none'].includes(args.mood)) throw new ToolError('Оценка клиента: доволен, нейтрально или недоволен.');
    const noteGiven = typeof args.mood_note === 'string' && args.mood_note.trim() !== '';
    const touches = args.mood !== undefined || noteGiven || typeof args.contact === 'boolean'
      || typeof args.report === 'boolean' || typeof args.ads === 'boolean';
    if (!touches) throw new ToolError('Не понял, что отметить: оценку клиента, «на связи», отчёт или рекламу?');

    let list: any;
    try { list = await ctx.api.get('/smm-control', { ym }); } catch (e) { throw apiErr(e); }
    const row = (list?.projects || []).find((r: any) => r.id === p.id);
    if (!row) throw new ToolError(`Проекта «${p.label}» нет в СММ-контроле за ${ym} (только активные СММ-проекты).`);

    const body: Record<string, any> = { ym };
    const undoBody: Record<string, any> = { ym };
    const parts: string[] = [];
    if (args.mood !== undefined || noteGiven) {
      const mood = args.mood === undefined ? row.mood : args.mood === 'none' ? null : args.mood;
      if (!mood) throw new ToolError('Пояснение без оценки не сохранить. Какая оценка клиента: доволен, нейтрально или недоволен?');
      body.mood = args.mood === 'none' ? null : mood;
      if (body.mood && noteGiven) body.moodNote = String(args.mood_note).trim().slice(0, 300);
      else if (body.mood && args.mood === undefined) body.moodNote = row.moodNote ?? '';
      undoBody.mood = row.mood ?? null;
      undoBody.moodNote = row.moodNote ?? '';
      parts.push(body.mood ? `клиент ${MOOD_RU[body.mood]}${body.moodNote ? ` («${body.moodNote}»)` : ''}` : 'оценка снята');
    }
    if (typeof args.contact === 'boolean') {
      body.contact = args.contact; undoBody.contact = !!row.contact;
      parts.push(args.contact ? 'на связи' : '«на связи» снято');
    }
    if (typeof args.report === 'boolean') {
      body.report = args.report; undoBody.report = !!row.report;
      parts.push(args.report ? 'отчёт отправлен' : 'отметка об отчёте снята');
    }
    if (typeof args.ads === 'boolean') {
      body.ads = args.ads; undoBody.ads = !!row.ads?.running;
      parts.push(args.ads ? 'реклама идёт' : 'реклама остановлена');
    }
    try { await ctx.api.patch(`/smm-control/${p.id}`, body); } catch (e) { throw apiErr(e); }
    return {
      summary: `📊 ${p.label} (${ym}): ${parts.join(', ')}`,
      undo: [{ method: 'PATCH', path: `/smm-control/${p.id}`, body: undoBody }],
    };
  },
};

// ─── Реклама проекта ────────────────────────────────────────────────────

/** Метка A хранит «проект:реклама» — для пути API нужны оба id. */
function adEntry(ctx: ToolContext, ref: unknown) {
  const e = ctx.refs.resolve('A', ref);
  const [projectId, adId] = (e?.id || '').split(':');
  if (!e || !projectId || !adId) throw new ToolError(`Нет рекламы с меткой «${ref}». Сначала откройте список через project_ads_list.`);
  return { ...e, projectId, adId };
}

const adPath = (projectId: string, adId?: string) => `/projects/${projectId}/ads${adId ? `/${adId}` : ''}`;
const money = (v: unknown) => `${Number(v).toLocaleString('ru-RU')} сомони`;
const adStart = (date: string) => `${date}T09:00`;
const adEnd = (date: string) => `${date}T18:00`;

function adSummary(ad: any): Record<string, any> {
  const s = dayOf(ad.startDate), e = dayOf(ad.endDate);
  return {
    title: ad.title,
    channel: CHANNEL_RU[ad.channel] || ad.channel,
    status: AD_STATUS_RU[ad.status] || ad.status,
    ...(ad.budget != null && Number(ad.budget) > 0 ? { budget: money(ad.budget), payer: ad.budgetSource === 'company' ? 'компания' : 'клиент' } : {}),
    ...(ad.dailyBudget != null && Number(ad.dailyBudget) > 0 ? { perDay: money(ad.dailyBudget) } : {}),
    period: `${s ? fmtDateRu(s) : '?'} — ${e ? fmtDateRu(e) : '?'}`,
    ...(ad.note ? { note: String(ad.note).slice(0, 300) } : {}),
  };
}

export const projectAdsList: ToolDef<{ project: string }> = {
  name: 'project_ads_list',
  kind: 'read',
  description:
    'Рекламные кампании проекта: название, канал, статус, бюджет и кто платит, период. «Какая реклама идёт у Архидеи», '
    + '«сколько бюджет рекламы». Метки A… для project_ad_update / project_ad_delete. '
    + 'Не путать с флажком «реклама идёт» в СММ-контроле (smm_control_list).',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const p = projectEntry(ctx, args.project);
    let ads: any[];
    try { ads = await ctx.api.get<any[]>(adPath(p.id)); } catch (e) { throw apiErr(e); }
    return {
      project: p.label,
      total: (ads || []).length,
      ads: (ads || []).slice(0, 40).map((a) => ({
        ref: ctx.refs.add('A', `${p.id}:${a.id}`, `${p.label}: реклама «${a.title}»`),
        ...adSummary(a),
        ...(a.targetologistId && ctx.refs.label('E', a.targetologistId) ? { targetologist: ctx.refs.label('E', a.targetologistId) } : {}),
      })),
    };
  },
};

interface AdFields {
  title?: string; channel?: string; budget?: number; daily_budget?: number; budget_source?: 'company' | 'client'
  status?: 'planned' | 'running' | 'finished'; start_date?: string; end_date?: string; note?: string; targetologist?: string
}
const AD_PROPS = {
  title: { type: 'string', description: 'Название кампании.' },
  channel: { type: 'string', enum: ['instagram', 'tiktok', 'facebook', 'youtube', 'telegram', 'google', 'other'] },
  budget: { type: 'number', description: 'Общий бюджет, сомони.' },
  daily_budget: { type: 'number', description: 'Дневной бюджет, сомони.' },
  budget_source: { type: 'string', enum: ['company', 'client'], description: 'Кто платит: company — наша компания, client — клиент. Не угадывайте — спросите.' },
  status: { type: 'string', enum: ['planned', 'running', 'finished'], description: 'planned — запланирована, running — идёт, finished — завершена.' },
  start_date: { type: 'string', description: 'Начало ГГГГ-ММ-ДД.' },
  end_date: { type: 'string', description: 'Конец ГГГГ-ММ-ДД.' },
  note: { type: 'string' },
  targetologist: { type: 'string', description: 'Метка E… таргетолога.' },
};

function checkAmount(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ToolError(`${name}: нужно число не меньше нуля.`);
  return n;
}

/** Поля формы → тело запроса (ровно поля DTO). */
function adBody(args: AdFields, ctx: ToolContext): Record<string, any> {
  const body: Record<string, any> = {};
  if (args.title !== undefined) {
    const t = String(args.title).trim();
    if (!t) throw new ToolError('Название рекламы не может быть пустым.');
    body.title = t.slice(0, 300);
  }
  if (args.channel !== undefined) {
    if (!CHANNEL_RU[args.channel]) throw new ToolError('Неизвестный канал рекламы.');
    body.channel = args.channel;
  }
  if (args.budget !== undefined) body.budget = checkAmount(args.budget, 'Бюджет');
  if (args.daily_budget !== undefined) body.dailyBudget = checkAmount(args.daily_budget, 'Дневной бюджет');
  if (args.budget_source !== undefined) {
    if (!['company', 'client'].includes(args.budget_source)) throw new ToolError('Платит либо компания, либо клиент.');
    body.budgetSource = args.budget_source;
  }
  if (args.status !== undefined) {
    if (!AD_STATUS_RU[args.status]) throw new ToolError('Статус рекламы: запланирована, идёт или завершена.');
    body.status = args.status;
  }
  if (args.start_date !== undefined) body.startDate = adStart(checkDate(args.start_date));
  if (args.end_date !== undefined) body.endDate = adEnd(checkDate(args.end_date));
  if (args.note !== undefined) body.note = String(args.note).trim().slice(0, 2000);
  if (args.targetologist !== undefined) body.targetologistId = personEntry(ctx, args.targetologist).id;
  return body;
}

const moneyWarning = (source: unknown, budget: unknown) => (source === 'company' && Number(budget) > 0
  ? `\n⚠️ Платит КОМПАНИЯ: ${money(budget)} добавится к бюджету проекта (счёт клиенту).` : '');

export const projectAdCreate: ToolDef<AdFields & { project: string }> = {
  name: 'project_ad_create',
  kind: 'write',
  description:
    'Создать рекламную кампанию проекта: «запусти рекламу в Instagram для Архидеи, 500 сомони от клиента, с 12 по 20 ноября». '
    + 'Обязательно: название, даты начала и конца; если назван бюджет — обязательно, кто платит (компания или клиент). '
    + 'Уведомляет менеджера проекта и таргетолога. Всегда с подтверждением. НЕ для отметки «реклама идёт» в контроле (smm_control_mark).',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' }, ...AD_PROPS },
    required: ['project', 'title', 'start_date', 'end_date'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, ADS_WRITE_ROLES),
  confirm: () => true,
  async preview(args, ctx) {
    const p = projectEntry(ctx, args.project);
    const body = prepareCreate(args, ctx);
    return `📢 СОЗДАТЬ РЕКЛАМУ\n📁 ${p.label}\n«${body.title}» · ${CHANNEL_RU[body.channel]}\n📅 ${fmtDateRu(args.start_date as string)} — ${fmtDateRu(args.end_date as string)}`
      + (body.budget > 0 ? `\n💰 ${money(body.budget)}${body.dailyBudget ? `, ${money(body.dailyBudget)}/день` : ''} · платит ${body.budgetSource === 'company' ? 'КОМПАНИЯ' : 'клиент'}` : '')
      + moneyWarning(body.budgetSource, body.budget);
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = projectEntry(ctx, args.project);
    const body = prepareCreate(args, ctx);
    let created: any;
    try { created = await ctx.api.post(adPath(p.id), body); } catch (e) { throw apiErr(e); }
    if (!created?.id) throw new ToolError('Сайт не вернул созданную рекламу — проверьте вкладку «Реклама».');
    const ref = ctx.refs.add('A', `${p.id}:${created.id}`, `${p.label}: реклама «${body.title}»`);
    return {
      summary: `📢 Реклама создана: ${p.label} · «${body.title}» · ${CHANNEL_RU[body.channel]}${body.budget > 0 ? ` · ${money(body.budget)} (${body.budgetSource === 'company' ? 'компания' : 'клиент'})` : ''} [${ref}]`,
      undo: [{ method: 'DELETE', path: adPath(p.id, created.id) }],
    };
  },
};

function prepareCreate(args: AdFields, ctx: ToolContext): Record<string, any> {
  const body = adBody(args, ctx);
  if (!body.title) throw new ToolError('Как назвать рекламную кампанию?');
  if (!args.start_date || !args.end_date) throw new ToolError('С какого по какое число идёт реклама?');
  if (args.end_date < args.start_date) throw new ToolError('Конец рекламы раньше начала.');
  if (!body.channel) body.channel = 'instagram';
  if (body.budget > 0 && !body.budgetSource) {
    throw new ToolError('Кто платит за рекламу — компания или клиент? От этого зависит бюджет проекта, угадывать нельзя.');
  }
  if (!body.budgetSource) body.budgetSource = 'client';
  return body;
}

export const projectAdUpdate: ToolDef<AdFields & { ad: string }> = {
  name: 'project_ad_update',
  kind: 'write',
  description:
    'Изменить рекламную кампанию: статус («запустили» → running, «закончилась» → finished), даты, канал, название, заметку, таргетолога, '
    + 'бюджет. «Реклама Архидеи теперь идёт», «продли рекламу до 25 ноября». Если меняются бюджет, дневной бюджет или кто платит — '
    + 'с подтверждением. Метка A… из project_ads_list. НЕ удаляет (project_ad_delete).',
  parameters: {
    type: 'object',
    properties: { ad: { type: 'string', description: 'Метка A…' }, ...AD_PROPS },
    required: ['ad'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, ADS_WRITE_ROLES),
  confirm: (args) => args.budget !== undefined || args.daily_budget !== undefined || args.budget_source !== undefined,
  async preview(args, ctx) {
    const a = adEntry(ctx, args.ad);
    const body = adBody(args, ctx);
    if (!Object.keys(body).length) throw new ToolError('Не понял, что изменить в рекламе.');
    const old = await loadAd(ctx, a.projectId, a.adId);
    const source = body.budgetSource ?? old.budgetSource;
    const budget = body.budget ?? old.budget;
    return `💰 ИЗМЕНИТЬ РЕКЛАМУ (деньги)\n${a.label}`
      + (body.budget !== undefined ? `\nБюджет: ${money(old.budget || 0)} → ${money(body.budget)}` : '')
      + (body.dailyBudget !== undefined ? `\nВ день: ${money(body.dailyBudget)}` : '')
      + (body.budgetSource !== undefined ? `\nПлатит: ${old.budgetSource === 'company' ? 'компания' : 'клиент'} → ${body.budgetSource === 'company' ? 'КОМПАНИЯ' : 'клиент'}` : '')
      + (source === 'company' && Number(budget) > 0 ? `
⚠️ Платит КОМПАНИЯ: бюджет проекта пересчитается (счёт клиенту).` : '');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const a = adEntry(ctx, args.ad);
    const body = adBody(args, ctx);
    if (!Object.keys(body).length) throw new ToolError('Не понял, что изменить в рекламе.');
    const old = await loadAd(ctx, a.projectId, a.adId);
    const startD = body.startDate ? args.start_date! : dayOf(old.startDate);
    const endD = body.endDate ? args.end_date! : dayOf(old.endDate);
    if (startD && endD && endD < startD) throw new ToolError('Конец рекламы раньше начала.');
    try { await ctx.api.patch(adPath(a.projectId, a.adId), body); } catch (e) { throw apiErr(e); }
    const undoBody: Record<string, any> = {};
    for (const key of Object.keys(body)) {
      const prev = old[key];
      undoBody[key] = (key === 'startDate' || key === 'endDate') ? String(prev).slice(0, 16)
        : (key === 'budget' || key === 'dailyBudget') ? (prev == null ? 0 : Number(prev)) : prev ?? '';
    }
    const what: string[] = [];
    if (body.status) what.push(`статус: ${AD_STATUS_RU[body.status]}`);
    if (body.budget !== undefined) what.push(`бюджет ${money(body.budget)}`);
    if (body.budgetSource) what.push(`платит ${body.budgetSource === 'company' ? 'компания' : 'клиент'}`);
    if (body.startDate || body.endDate) what.push('даты');
    if (body.title) what.push('название');
    if (body.channel) what.push(`канал ${CHANNEL_RU[body.channel]}`);
    if (body.targetologistId) what.push('таргетолог');
    if (body.note !== undefined) what.push('заметка');
    if (body.dailyBudget !== undefined) what.push('дневной бюджет');
    return {
      summary: `📢 ${a.label}: ${what.join(', ')}`,
      undo: [{ method: 'PATCH', path: adPath(a.projectId, a.adId), body: undoBody }],
    };
  },
};

async function loadAd(ctx: ToolContext, projectId: string, adId: string): Promise<any> {
  let ads: any[];
  try { ads = await ctx.api.get<any[]>(adPath(projectId)); } catch (e) { throw apiErr(e); }
  const ad = (ads || []).find((x) => x.id === adId);
  if (!ad) throw new ToolError('Такой рекламы уже нет в проекте.');
  return ad;
}

export const projectAdDelete: ToolDef<{ ad: string }> = {
  name: 'project_ad_delete',
  kind: 'write',
  description:
    'УДАЛИТЬ рекламную кампанию проекта. «Удали рекламу …». Если платила компания — бюджет проекта уменьшится на её сумму. '
    + 'Не путать с «завершена» (project_ad_update status=finished). Всегда с подтверждением.',
  parameters: {
    type: 'object',
    properties: { ad: { type: 'string', description: 'Метка A…' } },
    required: ['ad'],
    additionalProperties: false,
  },
  available: (u) => hasRole(u, ADS_WRITE_ROLES),
  confirm: () => true,
  async preview(args, ctx) {
    const a = adEntry(ctx, args.ad);
    const ad = await loadAd(ctx, a.projectId, a.adId);
    const s = adSummary(ad);
    return `🗑 УДАЛИТЬ РЕКЛАМУ\n${a.label}\n${s.channel} · ${s.period}${s.budget ? ` · ${s.budget} (${s.payer})` : ''}`
      + (ad.budgetSource === 'company' && Number(ad.budget) > 0 ? `\n⚠️ Бюджет проекта уменьшится на ${money(ad.budget)}.` : '')
      + '\nВернуть нельзя.';
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const a = adEntry(ctx, args.ad);
    try { await ctx.api.delete(adPath(a.projectId, a.adId)); } catch (e) { throw apiErr(e); }
    return { summary: `🗑 Реклама удалена: ${a.label}` };
  },
};

export const CONTENT_TOOLS: ToolDef[] = [
  contentItem, contentHistory, contentUnscheduled,
  contentCreate, contentEdit, contentDelete,
  videographers, contentAssign, setDefaultVideographer, producerShoots,
  contentFillToNorm, contentAutoPlan,
  smmControlList, smmControlMark,
  projectAdsList, projectAdCreate, projectAdUpdate, projectAdDelete,
];
