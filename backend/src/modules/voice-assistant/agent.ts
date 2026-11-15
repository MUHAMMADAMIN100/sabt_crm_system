import { Logger } from '@nestjs/common';
import { AllChatFailed, chatStep, ChatMessage, ToolSpec } from './ai/chat';
import { AiProviderError, ProviderId } from './ai/providers';
import { ApiError } from './internal-api';
import { Button, NeedChoice, ToolContext, ToolDef, ToolError, WriteOutcome } from './tools/types';

const logger = new Logger('VoiceAgent');

export interface Executed { tool: string; args: any; outcome?: WriteOutcome; error?: string }
export interface PendingCall { tool: string; args: any }

/** ИИ написал, что действие сделано, но инструмент не вызывал — это неправда.
 *  Значок сам по себе — не заявление (15.11.2026): «✅ У вас 3 задачи» или
 *  «📸 Съёмки на завтра» — обычный ответ. Нужны слова о сделанном: в начале
 *  (после значка или без него) либо «значок … создана/перенесена/…» в строке. */
export const CLAIMS_ACTION = /^\s*(?:[▶⏸⏹✅💬🗑💰🧾📸]\uFE0F?\s*)?(сделано|готово|выполнено|записано|создан|перенес|отмечен|продолжил|начат|завершен|задача (создана|поставлена|закрыта))|[▶⏸⏹✅💬🗑💰🧾📸]\uFE0F?[^\n]{0,80}?(создан|перенес[её]н|отмечен|начат|заверш[её]н|закрыт|удал[её]н|отправлен|записан|пров[её]д[её]н|приложен|поставлен)[аоы]?(?![а-яё])/iu;
/** После требования выполнить — если ИИ всё ещё пишет «сделано», не верим. */
export const STRONG_CLAIM = /^\s*(?:[▶⏸⏹✅]\uFE0F?\s*)?(сделано|готово|выполнено|записано)|[▶⏸⏹✅]\uFE0F?[^\n]{0,80}?(создан|перенес[её]н|отмечен|начат|заверш[её]н|закрыт|удал[её]н|отправлен|записан|пров[её]д[её]н|приложен|поставлен)[аоы]?(?![а-яё])/iu;

/** Все поставщики ИИ отказали, но в этой реплике уже что-то записано
 *  (15.11.2026): сделанное и кнопки отмены не теряем — сервис их покажет. */
export class AgentAiFailed extends AllChatFailed {
  constructor(errors: AiProviderError[], readonly done: Executed[], readonly buttons: Button[][]) {
    super(errors);
  }
}

export type AgentResult =
  | { type: 'answer'; text: string; done: Executed[]; buttons: Button[][] }
  | { type: 'confirm'; text: string; done: Executed[]; pending: PendingCall[]; previews: string[]; buttons: Button[][] }
  | { type: 'choice'; text: string; done: Executed[]; question: string; options: string[]; buttons: Button[][] };

const ASK_CHOICE: ToolSpec = {
  type: 'function',
  function: {
    name: 'ask_choice',
    description:
      'Спросить человека, какой вариант он имел в виду, — кнопками. Вызывай, когда по сказанному нельзя '
      + 'однозначно выбрать задачу, человека, проект или параметр (например вид перерыва). 2–8 вариантов, '
      + 'каждый — короткая понятная подпись (название задачи и срок, имя сотрудника).',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Короткий вопрос по-русски.' },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 8 },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    },
  },
};

export function toSpec(t: ToolDef): ToolSpec {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
}

const MAX_STEPS = 8;
const MAX_RESULT_CHARS = 14_000;
/** Лимит OpenAI: не больше 128 инструментов в одном запросе. */
const MAX_SPECS = 128;

/**
 * Разбор одной реплики: ИИ выбирает инструменты, мы их выполняем.
 * Чтение — свободно; запись — сразу или (рискованное) через подтверждение.
 * После успешных записей без ошибок ИИ больше не зовём: итог показываем сами,
 * слово в слово из того, что реально сделано.
 */
export async function runAgent(params: {
  ctx: ToolContext;
  tools: ToolDef[];
  system: string;
  /** Разделы, которые ИИ может открыть сам (open_section): имя → описание и инструменты. */
  sections?: Record<string, { title: string; tools: ToolDef[] }>;
  history: ChatMessage[];
  userText: string;
}): Promise<AgentResult & { provider?: ProviderId; calls?: string[] }> {
  const { ctx, tools, system, history, userText, sections = {} } = params;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs: ToolSpec[] = [];
  // У OpenAI не больше 128 инструментов за запрос, а у основателя их ~155:
  // часть разделов подключается по словам заранее, остальные ИИ открывает сам.
  // Список собираем заново после каждого open_section: раздел, из которого
  // убрали инструменты ради места, снова виден в open_section (15.11.2026).
  const rebuildSpecs = () => {
    const closed = Object.entries(sections).filter(([, sec]) => sec.tools.some((t) => !byName.has(t.name)));
    specs.length = 0;
    specs.push(...[...byName.values()].map(toSpec), ASK_CHOICE);
    if (closed.length) {
      specs.push({
        type: 'function',
        function: {
          name: 'open_section',
          description: 'Открыть раздел CRM, если нужного инструмента нет в списке. Разделы: '
            + closed.map(([k, sec]) => `${k} — ${sec.title}`).join('; ') + '. После открытия инструменты раздела станут доступны.',
          parameters: {
            type: 'object',
            properties: { section: { type: 'string', enum: closed.map(([k]) => k) } },
            required: ['section'],
            additionalProperties: false,
          },
        },
      });
    }
  };
  rebuildSpecs();
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: userText }];
  const done: Executed[] = [];
  const buttons: Button[][] = [];
  let provider: ProviderId | undefined;
  let nudged = false;
  const calls: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await chatStep(messages, specs, provider).catch((e) => {
      // Записи этой реплики уже прошли — отдаём их вместе с ошибкой ИИ (15.11.2026).
      if (e instanceof AllChatFailed && done.length) throw new AgentAiFailed(e.errors, done, buttons);
      throw e;
    });
    provider = reply.provider;
    if (!reply.toolCalls.length) {
      const text = (reply.content || '').trim();
      // Защита от ложного «сделано»: ни одного вызова — а текст о действии.
      if (!calls.length && !nudged && CLAIMS_ACTION.test(text)) {
        nudged = true;
        logger.warn(`ИИ заявил действие без инструмента: «${text.slice(0, 120)}» — требую выполнить`);
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: 'Ты не вызвал ни одного инструмента — значит, ничего не сделано. Выполни просьбу инструментом или ответь, почему это невозможно. Не пиши, что сделано, пока инструмент не вернул ok.' });
        continue;
      }
      return { type: 'answer', text: nudged && STRONG_CLAIM.test(text) && !calls.length ? 'Не получилось выполнить просьбу. Скажите, пожалуйста, ещё раз.' : text, done, buttons, provider, calls };
    }
    messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.toolCalls });

    const pending: PendingCall[] = [];
    const previews: string[] = [];
    let choice: { question: string; options: string[] } | null = null;
    let writesOk = 0;
    let readsOrErrors = 0;

    for (const call of reply.toolCalls) {
      const name = call.function.name;
      calls.push(name);
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || '{}') || {};
      } catch {
        messages.push(toolResult(call.id, { error: 'Аргументы не разобраны: нужен корректный JSON.' }));
        readsOrErrors++;
        continue;
      }

      if (name === 'open_section') {
        const key = String(args.section);
        const sec = sections[key];
        const added = sec ? sec.tools.filter((t) => !byName.has(t.name)) : [];
        // Не больше 128 инструментов (+ ask_choice и open_section) — иначе
        // OpenAI отвергает весь запрос (15.11.2026). Место освобождаем,
        // убирая ещё не вызванные инструменты других разделов.
        const over = () => byName.size + added.length + 2 > MAX_SPECS;
        if (sec && over()) {
          const keep = new Set([...sec.tools.map((t) => t.name), ...calls]);
          for (const [otherKey, other] of Object.entries(sections)) {
            if (otherKey === key) continue;
            for (const t of other.tools) {
              if (!over()) break;
              if (byName.has(t.name) && !keep.has(t.name)) byName.delete(t.name);
            }
          }
        }
        const fits = !over();
        if (sec && fits) for (const t of added) byName.set(t.name, t);
        rebuildSpecs();
        messages.push(toolResult(call.id, !sec
          ? { error: 'Нет такого раздела.' }
          : !fits
            ? { error: 'Слишком много инструментов сразу — раздел не открыт. Ответь тем, что уже доступно, или попроси человека сказать проще.' }
            : { opened: key, tools: added.map((t) => t.name) }));
        readsOrErrors++;
        continue;
      }

      if (name === 'ask_choice') {
        const options = (Array.isArray(args.options) ? args.options : []).map((o: any) => String(o).trim()).filter(Boolean).slice(0, 8);
        if (options.length >= 2) choice = { question: String(args.question || 'Что вы имели в виду?'), options };
        messages.push(toolResult(call.id, { status: 'вопрос задан, жду ответа человека' }));
        continue;
      }

      const tool = byName.get(name);
      if (!tool) {
        messages.push(toolResult(call.id, { error: `Инструмента ${name} нет или он недоступен этому сотруднику.` }));
        readsOrErrors++;
        continue;
      }

      if (tool.kind === 'write' && tool.confirm?.(args, ctx)) {
        try {
          previews.push(tool.preview ? await tool.preview(args, ctx) : `${tool.name}`);
          pending.push({ tool: name, args });
          messages.push(toolResult(call.id, { status: 'ждёт подтверждения человека' }));
        } catch (e: any) {
          messages.push(toolResult(call.id, { error: errText(e) }));
          readsOrErrors++;
        }
        continue;
      }

      try {
        const res = await tool.run(args, ctx);
        if (tool.kind === 'write') {
          const outcome = res as WriteOutcome;
          done.push({ tool: name, args, outcome });
          if (outcome.buttons) buttons.push(...outcome.buttons);
          messages.push(toolResult(call.id, { ok: true, done: outcome.summary }));
          writesOk++;
        } else {
          messages.push(toolResult(call.id, res));
          readsOrErrors++;
        }
      } catch (e: any) {
        if (e instanceof NeedChoice) {
          choice = { question: e.question, options: e.options };
          messages.push(toolResult(call.id, { status: 'нужно уточнение — спрошено кнопками' }));
          continue;
        }
        const text = errText(e);
        if (!(e instanceof ToolError) && !(e instanceof ApiError)) {
          logger.error(`tool ${name} упал: ${e?.message || e}`, e?.stack);
        }
        if (e instanceof ToolError && e.buttons) buttons.push(...e.buttons);
        if (tool.kind === 'write') done.push({ tool: name, args, error: text });
        messages.push(toolResult(call.id, { error: text }));
        readsOrErrors++;
      }
    }

    if (choice) return { type: 'choice', text: (reply.content || '').trim(), done, ...choice, buttons, provider, calls };
    if (pending.length) return { type: 'confirm', text: (reply.content || '').trim(), done, pending, previews, buttons, provider, calls };
    if (writesOk > 0 && readsOrErrors === 0) return { type: 'answer', text: '', done, buttons, provider, calls };
  }
  return {
    type: 'answer',
    text: done.length ? '' : 'Не смог разобраться с просьбой за отведённые шаги. Скажите, пожалуйста, проще или по частям.',
    done,
    buttons,
    provider,
  };
}

function errText(e: any): string {
  if (e instanceof ToolError || e instanceof ApiError) return e.message;
  return 'Внутренняя ошибка при выполнении — попробуйте ещё раз.';
}

function toolResult(id: string, data: any): ChatMessage {
  let content = typeof data === 'string' ? data : JSON.stringify(data);
  if (content.length > MAX_RESULT_CHARS) content = `${content.slice(0, MAX_RESULT_CHARS)}… (обрезано)`;
  return { role: 'tool', tool_call_id: id, content };
}

/** Выполнить подтверждённые действия (без ИИ — ровно то, что показали). */
export async function runPending(ctx: ToolContext, tools: ToolDef[], calls: PendingCall[]): Promise<{ done: Executed[]; buttons: Button[][] }> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const done: Executed[] = [];
  const buttons: Button[][] = [];
  for (const c of calls) {
    const tool = byName.get(c.tool);
    if (!tool) { done.push({ tool: c.tool, args: c.args, error: 'Действие больше недоступно.' }); continue; }
    try {
      const outcome = (await tool.run(c.args, ctx)) as WriteOutcome;
      done.push({ tool: c.tool, args: c.args, outcome });
      if (outcome.buttons) buttons.push(...outcome.buttons);
    } catch (e: any) {
      if (e instanceof ToolError && e.buttons) buttons.push(...e.buttons);
      if (!(e instanceof ToolError) && !(e instanceof ApiError)) logger.error(`pending ${c.tool} упал: ${e?.message || e}`, e?.stack);
      done.push({ tool: c.tool, args: c.args, error: errText(e) });
    }
  }
  return { done, buttons };
}
