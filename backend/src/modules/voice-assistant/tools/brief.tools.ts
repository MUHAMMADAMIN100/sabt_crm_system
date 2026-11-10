import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { ToolContext, ToolDef, ToolError, UndoStep, WriteOutcome } from './types';

/**
 * Бриф СММ-проекта голосом: человек рассказывает о клиенте, ИИ раскладывает
 * рассказ по вопросам анкеты (те же 37 вопросов, что на сайте —
 * frontend/src/lib/briefSchema.ts), инструмент сохраняет через PATCH /projects/:id/brief.
 * Чтение готового брифа (project_brief), очистка и ссылка клиенту — в projects.tools.ts.
 */

export interface BriefQuestion { key: string; num: number; section: string; label: string }

const SECTIONS: Array<{ title: string; questions: string[] }> = [
  { title: 'Контакты и организация', questions: [
    'Название компании / бренда.',
    'ФИО и должность контактного лица.',
    'Кто принимает финальные решения и согласует контент (ЛПР)? Контакты.',
    'Удобные каналы и время связи.',
    'Кто со стороны клиента предоставляет фактуру (фото, информацию о продукте)?',
  ] },
  { title: 'О компании и продукте', questions: [
    'Сфера деятельности, ключевые продукты / услуги.',
    'Миссия, ценности, история бренда.',
    'УТП — чем вы лучше конкурентов (3–5 пунктов)?',
    'География работы (город, районы, доставка?).',
    'Ценовой сегмент (эконом / средний / премиум).',
    'Сильные и слабые стороны продукта (честно).',
    'Сайт и все действующие соцсети.',
    'Хиты продаж / самые маржинальные позиции для активного продвижения.',
  ] },
  { title: 'Целевая аудитория', questions: [
    'Опишите текущих клиентов (пол, возраст, доход, гео, интересы).',
    'Кого хотите привлекать дополнительно?',
    'Какие проблемы / потребности клиента решает ваш продукт?',
    'Барьеры и возражения перед покупкой?',
  ] },
  { title: 'Конкуренты', questions: [
    '3–5 основных конкурентов (ссылки на их соцсети).',
    'Что нравится / не нравится в их соцсетях?',
    'Чем хотите от них отличаться?',
  ] },
  { title: 'Бренд, голос и визуал', questions: [
    'Есть ли брендбук / гайдлайн? Логотип, фирменные цвета, шрифты.',
    'Tone of Voice: на «ты» / «вы», экспертно / по-дружески / с юмором?',
    'Стоп-слова и темы-табу (о чём нельзя писать).',
    'Референсы: аккаунты, которые нравятся, и что именно в них нравится.',
  ] },
  { title: 'Цели и задачи', questions: [
    'Главная цель SMM (продажи / узнаваемость / трафик / лояльность)?',
    'На чём сделать акцент?',
    'Желаемый результат через 3 и 6 месяцев?',
    'Был ли опыт SMM раньше? Что получилось / не получилось?',
  ] },
  { title: 'Контент и продакшн', questions: [
    'Готовы ли сотрудники / руководитель появляться в кадре? Если привлекаем модель — какую? Кто будет в кадре?',
    'Какой бюджет готовы выделить на привлечение моделей (за съёмку / в месяц)? Сумма и валюта.',
    'Можно ли снимать на ваших локациях? Контактное лицо и график доступа.',
    'Есть ли готовый фото / видеоматериал, который можно использовать?',
    'Особые пожелания по подаче контента (что обязательно показывать, что точно не показывать).',
  ] },
  { title: 'Рекламный бюджет и доступы', questions: [
    'Рекламный бюджет на платное продвижение в месяц. Сумма и валюта.',
    'Приоритетная цель рекламы (заявки / трафик / охват / подписчики)?',
    'Доступы к аккаунтам и рекламным кабинетам (передаются отдельно по защищённому каналу).',
    'Подключённые системы аналитики / CRM, если есть.',
  ] },
];

export const BRIEF_QUESTIONS: BriefQuestion[] = (() => {
  const out: BriefQuestion[] = [];
  for (const s of SECTIONS) {
    for (const label of s.questions) {
      const num = out.length + 1;
      out.push({ key: `q${num}`, num, section: s.title, label });
    }
  }
  return out;
})();

const TOTAL = BRIEF_QUESTIONS.length;
const MAX_ANSWER = 4000;
const BY_KEY = new Map(BRIEF_QUESTIONS.map((q) => [q.key, q]));

const shortLabel = (q: BriefQuestion): string => {
  const t = q.label.replace(/\s*\(.*?\)/g, '').replace(/[?.]+$/, '').trim();
  return t.length > 38 ? `${t.slice(0, 37)}…` : t;
};
const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function apiErr(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  if (e.status === 403 && /^not allowed$/i.test(e.message.trim())) return new ToolError('У вас нет прав на бриф этого проекта.');
  if (e.status === 404 && /not found/i.test(e.message)) return new ToolError('Проект не найден или уже удалён.');
  return new ToolError(e.message);
}

/** «q5», «Q5», «5», «вопрос 5» → ключ q5; иначе null. */
function normKey(raw: unknown): string | null {
  const m = /^\s*(?:вопрос\s*)?q?\s*№?\s*(\d{1,2})\s*$/i.exec(String(raw ?? ''));
  if (!m) return null;
  const key = `q${Number(m[1])}`;
  return BY_KEY.has(key) ? key : null;
}

interface BriefState {
  tariff: string | null;
  clientSignature: string;
  managerSignature: string;
  clientPhone: string;
  answers: Record<string, string>;
  /** Бриф у проекта вообще был (а не null). */
  existed: boolean;
}

async function loadBrief(ctx: ToolContext, ref: unknown): Promise<{ id: string; label: string; state: BriefState }> {
  const e = ctx.refs.resolve('P', ref);
  if (!e) throw new ToolError(`Нет проекта с меткой «${ref}». Сначала найдите его через list_projects.`);
  let p: any;
  try { p = await ctx.api.get(`/projects/${e.id}`); } catch (err) { throw apiErr(err); }
  if (p?.projectType !== 'SMM') throw new ToolError('Бриф есть только у СММ-проектов.');
  const b = p.brief && typeof p.brief === 'object' ? p.brief : null;
  const answers: Record<string, string> = {};
  if (b?.answers && typeof b.answers === 'object') {
    for (const [k, v] of Object.entries(b.answers)) if (typeof v === 'string') answers[k] = v;
  }
  return {
    id: e.id,
    label: e.label,
    state: {
      tariff: typeof b?.tariff === 'string' && b.tariff ? b.tariff : null,
      clientSignature: typeof b?.clientSignature === 'string' ? b.clientSignature : '',
      managerSignature: typeof b?.managerSignature === 'string' ? b.managerSignature : '',
      clientPhone: typeof b?.clientPhone === 'string' ? b.clientPhone : '',
      answers,
      existed: !!b,
    },
  };
}

/** Тело PATCH — ровно те поля, что шлёт вкладка «Бриф» на сайте. */
const briefBody = (s: BriefState, answers: Record<string, string>) => ({
  tariff: s.tariff,
  clientSignature: s.clientSignature,
  managerSignature: s.managerSignature,
  clientPhone: s.clientPhone,
  answers,
});

function undoSteps(ctx: ToolContext, projectId: string, before: BriefState): UndoStep[] {
  if (!before.existed && hasGrant(ctx.user, 'projects.brief.clear')) {
    return [{ method: 'DELETE', path: `/projects/${projectId}/brief` }];
  }
  return [{ method: 'PATCH', path: `/projects/${projectId}/brief`, body: briefBody(before, before.answers) }];
}

function progressText(label: string, answers: Record<string, string>): string {
  const filled = BRIEF_QUESTIONS.filter((q) => asText(answers[q.key]));
  const empty = BRIEF_QUESTIONS.filter((q) => !asText(answers[q.key]));
  const fmt = (list: BriefQuestion[]) => list.map((q) => `${q.num}. ${shortLabel(q)}`).join('; ');
  return `Бриф «${label}»: заполнено ${filled.length} из ${TOTAL}`
    + (filled.length ? `: ${fmt(filled)}` : '')
    + (empty.length ? `\nНе заполнено (${empty.length}): ${fmt(empty)}` : '\nВсе вопросы заполнены.');
}

const can = (u: any) => hasGrant(u, 'projects.brief.manage');

// ─── brief_questions ────────────────────────────────────────────────────

export const briefQuestions: ToolDef<{ project: string }> = {
  name: 'brief_questions',
  kind: 'read',
  description:
    'Анкета брифа СММ-проекта: все 37 вопросов с ключами (q1…q37), разделами и ТЕКУЩИМИ ответами. '
    + 'ВСЕГДА вызывай перед brief_fill / brief_answer, чтобы знать, какой ключ какому вопросу соответствует и что уже заполнено. '
    + 'Также для «что заполнено в брифе Архидеи», «какие вопросы брифа остались». Только СММ-проекты.',
  parameters: {
    type: 'object',
    properties: { project: { type: 'string', description: 'Метка проекта P…' } },
    required: ['project'],
    additionalProperties: false,
  },
  async run(args, ctx) {
    const { label, state } = await loadBrief(ctx, args.project);
    const filled = BRIEF_QUESTIONS.filter((q) => asText(state.answers[q.key])).length;
    return {
      project: label,
      filled,
      total: TOTAL,
      questions: BRIEF_QUESTIONS.map((q) => ({
        key: q.key, section: q.section, question: q.label, answer: asText(state.answers[q.key]) || null,
      })),
    };
  },
};

// ─── brief_fill ─────────────────────────────────────────────────────────

interface FillArgs { project: string; answers: Record<string, string>; overwrite?: boolean }

interface FillPlan {
  /** Ключ → новый текст (только то, что реально будет записано). */
  write: Record<string, string>;
  /** Было → станет для перезаписываемых. */
  replaced: Array<{ q: BriefQuestion; was: string; now: string }>;
  /** Уже есть ответ, перезапись не просили — не тронуто. */
  kept: BriefQuestion[];
}

function parseAnswers(raw: unknown): Array<{ q: BriefQuestion; text: string }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('Передайте answers — объект вида {"q1": "текст", "q6": "текст"}.');
  }
  const out = new Map<string, { q: BriefQuestion; text: string }>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normKey(k);
    if (!key) throw new ToolError(`Нет вопроса с ключом «${k}». Ключи — q1…q${TOTAL} (см. brief_questions).`);
    const text = asText(v);
    if (!text) continue;
    if (text.length > MAX_ANSWER) throw new ToolError(`Ответ на ${key} слишком длинный (больше ${MAX_ANSWER} символов).`);
    out.set(key, { q: BY_KEY.get(key)!, text });
  }
  if (!out.size) throw new ToolError('Нечего записывать: нет ни одного непустого ответа.');
  return [...out.values()];
}

function planFill(state: BriefState, items: Array<{ q: BriefQuestion; text: string }>, overwrite: boolean): FillPlan {
  const plan: FillPlan = { write: {}, replaced: [], kept: [] };
  for (const { q, text } of items) {
    const was = asText(state.answers[q.key]);
    if (!was) { plan.write[q.key] = text; continue; }
    if (was === text) continue;
    if (!overwrite) { plan.kept.push(q); continue; }
    plan.write[q.key] = text;
    plan.replaced.push({ q, was, now: text });
  }
  return plan;
}

export const briefFill: ToolDef<FillArgs> = {
  name: 'brief_fill',
  kind: 'write',
  description:
    'Заполнить бриф СММ-проекта из РАССКАЗА человека о клиенте (одно или несколько голосовых). '
    + 'Пример: «Архидея — студия дизайна интерьеров в Душанбе, средний сегмент, хотят больше заявок, конкуренты — Дом и Стиль». '
    + 'Порядок: 1) вызови brief_questions и получи ключи; 2) разложи сказанное по вопросам и передай answers = {"q1": "текст", ...}. '
    + 'ПРАВИЛА РАЗБОРА: бери ТОЛЬКО то, что человек реально сказал; ничего не выдумывай, не додумывай и не обобщай; '
    + 'если не уверен, к какому вопросу относится фраза или что именно имелось в виду, — этот вопрос НЕ заполняй и спроси человека; '
    + 'формулируй ответ коротко и близко к словам человека, без украшений; один факт клади в тот вопрос, где он отвечает по смыслу '
    + '(одно и то же в несколько вопросов не копируй). Вопросы, о которых не сказано, просто пропусти. '
    + 'Уже заполненные ответы НЕ затираются: они остаются как есть, и бот так и скажет. '
    + 'Только если человек прямо просит заменить/переписать — overwrite=true (тогда будет подтверждение «было → станет»). '
    + 'Дополнить уже заполненный ответ — тоже overwrite=true с ответом целиком (старый текст + новое). '
    + 'После выполнения бот сам покажет, сколько заполнено и каких вопросов не хватает. '
    + 'НЕ для правки одного ответа (для этого brief_answer), НЕ для очистки брифа (clear_project_brief).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      answers: {
        type: 'object',
        description: 'Ключ вопроса (q1…q37) → текст ответа. Только то, что реально сказано.',
        additionalProperties: { type: 'string' },
      },
      overwrite: { type: 'boolean', description: 'true только если человек прямо просит заменить уже заполненные ответы.' },
    },
    required: ['project', 'answers'],
    additionalProperties: false,
  },
  available: can,
  confirm: (args) => args.overwrite === true,
  async preview(args, ctx) {
    const items = parseAnswers(args.answers);
    const { label, state } = await loadBrief(ctx, args.project);
    const plan = planFill(state, items, args.overwrite === true);
    const lines = [`📝 ЗАМЕНИТЬ ОТВЕТЫ В БРИФЕ «${label}»`];
    for (const r of plan.replaced) {
      lines.push(`${r.q.num}. ${shortLabel(r.q)}\n   было: ${clip(r.was)}\n   станет: ${clip(r.now)}`);
    }
    for (const k of Object.keys(plan.write)) {
      if (plan.replaced.some((r) => r.q.key === k)) continue;
      const q = BY_KEY.get(k)!;
      lines.push(`+ ${q.num}. ${shortLabel(q)}: ${clip(plan.write[k])}`);
    }
    return lines.join('\n');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const items = parseAnswers(args.answers);
    const { id, label, state } = await loadBrief(ctx, args.project);
    const plan = planFill(state, items, args.overwrite === true);
    const written = Object.keys(plan.write);
    const keptNote = plan.kept.length
      ? `Не тронуто (уже есть ответ): ${plan.kept.map((q) => `${q.num}. ${shortLabel(q)}`).join('; ')}. Чтобы заменить — скажите явно.`
      : '';
    if (!written.length) {
      throw new ToolError(`${keptNote || 'Все эти ответы уже записаны в брифе.'}\n${progressText(label, state.answers)}`);
    }
    const merged = { ...state.answers, ...plan.write };
    try { await ctx.api.patch(`/projects/${id}/brief`, briefBody(state, merged)); } catch (err) { throw apiErr(err); }
    const nums = written.map((k) => BY_KEY.get(k)!.num).sort((a, b) => a - b).join(', ');
    const changed = plan.replaced.map((r) => `${r.q.num}: «${clip(r.was, 60)}» → «${clip(r.now, 60)}»`);
    const lines = [`📝 В бриф «${label}» записано ответов: ${written.length} (${nums})`];
    if (changed.length) lines.push(`Заменено: ${changed.join('; ')}`);
    if (keptNote) lines.push(keptNote);
    lines.push(progressText(label, merged));
    return { summary: lines.join('\n'), undo: undoSteps(ctx, id, state) };
  },
};

// ─── brief_answer ───────────────────────────────────────────────────────

function checkAnswerArgs(args: { key: string; text: string }): { key: string; text: string } {
  const key = normKey(args.key);
  if (!key) throw new ToolError(`Нет вопроса с ключом «${args.key}». Ключи — q1…q${TOTAL} (см. brief_questions).`);
  const text = asText(args.text);
  if (!text) throw new ToolError('Пустой ответ записать нельзя. Чтобы стереть бриф целиком — clear_project_brief.');
  if (text.length > MAX_ANSWER) throw new ToolError(`Ответ слишком длинный (больше ${MAX_ANSWER} символов).`);
  return { key, text };
}

export const briefAnswer: ToolDef<{ project: string; key: string; text: string }> = {
  name: 'brief_answer',
  kind: 'write',
  description:
    'Поправить ОДИН ответ в брифе СММ-проекта (или записать один вопрос): «в брифе Архидеи аудитория — женщины 25–40», '
    + '«в брифе Кофеина бюджет на рекламу 500 долларов в месяц». Ключ вопроса (q1…q37) возьми из brief_questions: '
    + '«аудитория» = вопрос про текущих клиентов (q14) или про тех, кого хотят привлекать (q15) — если неясно, какой из них, спроси. '
    + 'Текст — только то, что сказал человек, без выдумок. Старый ответ заменяется целиком (покажет «было → станет» и спросит подтверждение). '
    + 'НЕ для рассказа о клиенте из нескольких фактов (для этого brief_fill), НЕ для очистки (clear_project_brief).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Метка проекта P…' },
      key: { type: 'string', description: 'Ключ вопроса q1…q37' },
      text: { type: 'string', description: 'Новый текст ответа целиком.' },
    },
    required: ['project', 'key', 'text'],
    additionalProperties: false,
  },
  available: can,
  confirm: () => true,
  async preview(args, ctx) {
    const { key, text } = checkAnswerArgs(args);
    const { label, state } = await loadBrief(ctx, args.project);
    const q = BY_KEY.get(key)!;
    const was = asText(state.answers[key]);
    return [
      `📝 ПРАВКА ОТВЕТА В БРИФЕ «${label}»`,
      `${q.num}. ${shortLabel(q)}`,
      `было: ${was ? clip(was) : '— пусто —'}`,
      `станет: ${clip(text)}`,
    ].join('\n');
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const { key, text } = checkAnswerArgs(args);
    const { id, label, state } = await loadBrief(ctx, args.project);
    const q = BY_KEY.get(key)!;
    const was = asText(state.answers[key]);
    if (was === text) throw new ToolError(`В брифе «${label}» ответ на вопрос ${q.num} уже такой.`);
    const merged = { ...state.answers, [key]: text };
    try { await ctx.api.patch(`/projects/${id}/brief`, briefBody(state, merged)); } catch (err) { throw apiErr(err); }
    const change = `${was ? `«${clip(was, 60)}» → ` : ''}«${clip(text, 100)}»`;
    return {
      summary: `📝 Бриф «${label}», вопрос ${q.num} (${shortLabel(q)}): ${change}\n${progressText(label, merged)}`,
      undo: undoSteps(ctx, id, state),
    };
  },
};

export const BRIEF_TOOLS: ToolDef[] = [briefQuestions, briefFill, briefAnswer];
