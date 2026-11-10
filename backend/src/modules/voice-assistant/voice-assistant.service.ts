import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { IncomingFile, TelegramService } from '../telegram/telegram.service';
import { AllChatFailed, ChatMessage } from './ai/chat';
import { AiProviderError, explainAllFailed } from './ai/providers';
import { AllSpeechFailed, transcribe } from './ai/speech';
import { AgentResult, Executed, PendingCall, runAgent, runPending } from './agent';
import { ApiError, UserApi } from './internal-api';
import { buildSnapshot, systemPrompt } from './prompt';
import { RefTable } from './refs';
import { esc, nowTimeDushanbe, todayDushanbe } from './tools/common';
import { PEOPLE_TOOLS } from './tools/people.tools';
import { SHIFT_TOOLS } from './tools/shifts.tools';
import { TASK_TOOLS } from './tools/tasks.tools';
import { CLIENT_TOOLS } from './tools/clients.tools';
import { SMM_TOOLS } from './tools/smm.tools';
import { FINANCE_TOOLS } from './tools/finance.tools';
import { SALARY_TOOLS } from './tools/salary.tools';
import { DB_TOOLS, DbRunner } from './tools/db.tools';
import { ATTENDANCE_TOOLS } from './tools/attendance.tools';
import { PROJECTS_TOOLS } from './tools/projects.tools';
import { CONTENT_TOOLS } from './tools/content.tools';
import { FINANCE2_TOOLS } from './tools/finance2.tools';
import { DEV_TOOLS } from './tools/dev.tools';
import { DIRECT_TOOLS } from './tools/direct.tools';
import { ADMIN_TOOLS } from './tools/admin.tools';
import { BRIEF_TOOLS } from './tools/brief.tools';
import { MISC_TOOLS } from './tools/misc.tools';
import { FINANCE3_TOOLS } from './tools/finance3.tools';
import { FILES_TOOLS } from './tools/files.tools';
import { AttachedFile, Button, ToolContext, ToolDef, UndoStep } from './tools/types';

/** Все инструменты. Кому какие видны — решает available(user). */
export const ALL_TOOLS: ToolDef[] = [...TASK_TOOLS, ...PEOPLE_TOOLS, ...SHIFT_TOOLS, ...CLIENT_TOOLS, ...SMM_TOOLS, ...FINANCE_TOOLS, ...SALARY_TOOLS, ...DB_TOOLS,
  ...ATTENDANCE_TOOLS,
  // set_dev_stage из проектов дублирует set_dev_project_stage доски «Разработка».
  ...PROJECTS_TOOLS.filter((t) => t.name !== 'set_dev_stage'),
  ...CONTENT_TOOLS, ...FINANCE2_TOOLS, ...DEV_TOOLS, ...DIRECT_TOOLS, ...ADMIN_TOOLS, ...BRIEF_TOOLS, ...MISC_TOOLS, ...FINANCE3_TOOLS, ...FILES_TOOLS,
];

/** Разделы помощника. У OpenAI не больше 128 инструментов за запрос, а всего
 *  их ~160: ядро (задачи, люди, смена, база) — всегда, разделы — по словам
 *  просьбы и недавнего разговора, остальные ИИ открывает сам (open_section). */
// «Моя зарплата» и «моя статистика» — у каждого сотрудника (как на сайте), поэтому в ядре:
// без них на «сколько я заработал» ИИ отвечал «нет доступа» (прогон 10.11.2026).
const CORE_TOOLS: ToolDef[] = [...TASK_TOOLS, ...PEOPLE_TOOLS, ...SHIFT_TOOLS, ...DB_TOOLS,
  ...MISC_TOOLS.filter((t) => t.name === 'my_salary' || t.name === 'my_profile_stats')];
const SECTIONS: Array<{ key: string; title: string; tools: ToolDef[]; words: RegExp }> = [
  { key: 'finance', title: 'финансы: операции, баланс, долги, подписки, зарплата (штраф, премия, аванс), транспорт',
    tools: [...FINANCE_TOOLS, ...FINANCE2_TOOLS, ...SALARY_TOOLS, ...FINANCE3_TOOLS],
    words: /стать[яиюей]|инвентар|актив|амортиз|прогноз|закр(ой|ыть) месяц|переоткр|штраф|оштраф|ашраф|преми|бонус|аванс|зарплат|расход|доход|оплат|баланс|сч[её]т|долг|подписк|рассроч|сомони|деньг|финанс|транспорт|такси|ведомост|ҷарима|чарима|маош|пул/i },
  { key: 'attendance', title: 'опоздания и штрафы за них, отпуска, графики работы, просьбы «приду позже» и правки смен, табель',
    tools: ATTENDANCE_TOOLS, words: /опозд|отпуск|график|табел|приду позже|правк|отгул|прост[иь]|дер омад/i },
  { key: 'clients', title: 'клиенты и лиды, Директ Instagram (чаты, ответы клиентам)',
    tools: [...CLIENT_TOOLS, ...DIRECT_TOOLS], words: /лид|клиент|директ|инстаграм|instagram|чат|переговор|договор|мизоҷ|мизоч/i },
  { key: 'smm', title: 'контент-план, публикации, рилсы, съёмки и видеографы, сторис, СММ-контроль, реклама проектов',
    tools: [...SMM_TOOLS, ...CONTENT_TOOLS], words: /рилс|сторис|пост|публикац|съ[её]мк|контент|монтаж|видеограф|реклам|таргет|продюсер|смм|smm|сценари/i },
  { key: 'projects', title: 'проекты: карточка, создать, статус, архив, участники, объявления, бриф, оплата проекта',
    tools: [...PROJECTS_TOOLS.filter((t) => t.name !== 'set_dev_stage'), ...BRIEF_TOOLS], words: /проект|архив|объявлен|бриф|лойиҳа|лойиха/i },
  { key: 'dev', title: 'доска «Разработка»: карточки, этапы, исполнители',
    tools: DEV_TOOLS, words: /карточк|доск|разработ|этап|баг|dev/i },
  { key: 'admin', title: 'сотрудники и их карточки, доступы, блокировка, чек-листы задач, заметки, уведомления, календарь, мои отчёты',
    tools: ADMIN_TOOLS, words: /сотрудник|доступ|заблок|разблок|чек-?лист|пункт|заметк|уведомлен|календар|отч[её]т|должност|на работу/i },
];
SECTIONS.push({
  key: 'misc', title: 'аналитика и KPI, моя зарплата и статистика, цели, тарифы СММ, справочник организатора съёмок, планы продаж, спринты, повтор недели задач, лента активности',
  tools: MISC_TOOLS,
  words: /аналитик|kpi|кпи|показател|статистик|цел[ьи]|тариф|справочник|организатор|модел|локац|план продаж|спринт|повтор|моя зарплат|мою зарплат|риск|активност|рейтинг|выручк/i,
});
const MAX_TOOLS = 120;
/** Инструменты файлов видны ИИ только когда человек прислал файл. */
const FILE_TOOL_NAMES = new Set(FILES_TOOLS.map((t) => t.name));

/** Для ИИ: к сообщению приложен файл (сам файл ему не показываем). */
function fileNote(file: IncomingFile): string {
  const what = file.kind === 'photo' ? 'фото' : `документ «${file.name}»`;
  return `(Человек прислал ${what}. Приложить его можно инструментом attach_task_result или attach_transport_receipt — только если просьба об этом. Содержимое файла тебе недоступно.)`;
}

const SESSION_TTL_MS = 20 * 60_000;
const HISTORY_MAX = 4;
const UNDO_TTL_MS = 60 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;
/** Файл без подписи ждёт слов «к чему приложить» столько же. */
const PENDING_FILE_TTL_MS = 15 * 60_000;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 40;
const MAX_VOICE_SEC = 180;

/** history — короткие строки «просьба → итог». В подсказку ИИ они идут
 *  отдельным блоком, а не репликами бота: реплики ИИ копировал и писал
 *  «сделано», ничего не сделав (прогон 09.11.2026). */
interface Session { refs: RefTable; history: string[]; at: number }
type Notice = { userId: string; text: string };
interface UndoEntry { chatId: number; userId: string; steps: UndoStep[]; undoNotify: Notice[]; at: number }
interface ConfirmEntry { chatId: number; userId: string; calls: PendingCall[]; refs: ReturnType<RefTable['toJSON']>; utterance: string; file?: IncomingFile; at: number }
interface ChoiceEntry { chatId: number; userId: string; utterance: string; options: string[]; replyTaskId: string | null; file?: IncomingFile; at: number }

export interface IncomingMeta {
  /** Задача, на сообщение о которой человек ответил (reply). */
  replyTaskId?: string | null;
}

/**
 * Голосовой (и текстовый) помощник в Telegram-боте.
 *
 * Человек говорит — бот делает в CRM ровно то, что сказано, от его имени и
 * с его правами (через собственный API), или отвечает на вопрос прямо в чате.
 * Простые действия — сразу с «↩ Отменить», рискованные — после «Подтвердить».
 */
@Injectable()
export class VoiceAssistantService implements OnModuleInit {
  private readonly logger = new Logger(VoiceAssistantService.name);
  private readonly sessions = new Map<number, Session>();
  private readonly undos = new Map<string, UndoEntry>();
  private readonly confirms = new Map<string, ConfirmEntry>();
  private readonly choices = new Map<string, ChoiceEntry>();
  private readonly rate = new Map<string, number[]>();
  /** Присланный файл, которому ещё не сказали, куда приложить. */
  private readonly pendingFiles = new Map<number, { file: IncomingFile; at: number }>();
  /** Один разбор на чат за раз: второе голосовое ждёт первое, а не мешает ему. */
  private readonly chains = new Map<number, Promise<unknown>>();

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly jwt: JwtService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** Чтение базы для основателя: транзакция READ ONLY + таймаут 8 с —
   *  записать что-либо невозможно на уровне самой БД. */
  private readonly dbRead: DbRunner = async (sql: string) => {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.query('BEGIN READ ONLY');
      await qr.query("SET LOCAL statement_timeout = '8000'");
      return await qr.query(sql);
    } finally {
      await qr.query('ROLLBACK').catch(() => undefined);
      await qr.release();
    }
  };

  onModuleInit(): void {
    this.telegram.registerAssistant(this);
  }

  // ─── Входы ────────────────────────────────────────────────────────────

  async handleVoice(chatId: number, fileId: string, durationSec: number, meta: IncomingMeta = {}): Promise<boolean> {
    const user = await this.userByChat(chatId);
    if (!user) return false;
    return this.serial(chatId, async () => {
      if (durationSec > MAX_VOICE_SEC) {
        await this.telegram.sendMessage(chatId, '🎤 Слишком длинное сообщение. Скажите короче — до трёх минут.');
        return true;
      }
      if (!this.allow(user.id)) {
        await this.telegram.sendMessage(chatId, '⏳ Слишком много просьб подряд. Подождите пару минут.');
        return true;
      }
      const stopTyping = this.typing(chatId);
      try {
        const file = this.pendingFile(chatId);
        const ctx = this.context(user, chatId, '', undefined, file);
        const audioP = this.telegram.downloadFile(fileId);
        const snapshot = await buildSnapshot(ctx, meta.replyTaskId);
        const audio = await audioP;
        let text: string;
        try {
          text = (await transcribe(audio, snapshot.speechHint)).text;
        } catch (e: any) {
          if (e instanceof AllSpeechFailed) {
            this.logger.error(`распознавание не удалось: ${e.message}`);
            await this.telegram.sendMessage(chatId, explainAllFailed(e.errors));
            return true;
          }
          throw e;
        }
        if (!text.trim()) {
          await this.telegram.sendMessage(chatId, '🤔 Не расслышал ни слова. Повторите, пожалуйста, ближе к микрофону.');
          return true;
        }
        ctx.utterance = text;
        await this.process(chatId, user, ctx, snapshot, text, true, meta.replyTaskId || null, false, file);
        return true;
      } catch (e: any) {
        await this.failSoft(chatId, e);
        return true;
      } finally {
        stopTyping();
      }
    });
  }

  async handleText(chatId: number, text: string, meta: IncomingMeta = {}): Promise<boolean> {
    const user = await this.userByChat(chatId);
    if (!user) return false;
    const clean = String(text || '').trim();
    if (!clean) return false;
    return this.serial(chatId, async () => {
      if (!this.allow(user.id)) {
        await this.telegram.sendMessage(chatId, '⏳ Слишком много просьб подряд. Подождите пару минут.');
        return true;
      }
      const stopTyping = this.typing(chatId);
      try {
        const file = this.pendingFile(chatId);
        const ctx = this.context(user, chatId, clean, undefined, file);
        const snapshot = await buildSnapshot(ctx, meta.replyTaskId);
        await this.process(chatId, user, ctx, snapshot, clean, false, meta.replyTaskId || null, false, file);
      } catch (e: any) {
        await this.failSoft(chatId, e);
      } finally {
        stopTyping();
      }
      return true;
    });
  }

  /** Фото или документ в чат. С подписью — подпись это просьба; без неё
   *  спрашиваем, к чему приложить, и ждём следующее голосовое или текст. */
  async handleFile(chatId: number, file: IncomingFile, caption: string, meta: IncomingMeta = {}): Promise<boolean> {
    const user = await this.userByChat(chatId);
    if (!user) return false;
    return this.serial(chatId, async () => {
      if (!this.allow(user.id)) {
        await this.telegram.sendMessage(chatId, '⏳ Слишком много просьб подряд. Подождите пару минут.');
        return true;
      }
      this.pendingFiles.set(chatId, { file, at: Date.now() });
      const clean = String(caption || '').trim();
      if (!clean) {
        await this.telegram.sendMessage(chatId,
          `📎 Получил ${file.kind === 'photo' ? 'фото' : `файл «${esc(file.name)}»`}. К чему приложить?\n`
          + 'Скажите голосом или напишите, например: «приложи к задаче Макет» или «это чек за такси, 30 сомони, проект Архидея».');
        return true;
      }
      const stopTyping = this.typing(chatId);
      try {
        const ctx = this.context(user, chatId, clean, undefined, file);
        const snapshot = await buildSnapshot(ctx, meta.replyTaskId);
        await this.process(chatId, user, ctx, snapshot, clean, false, meta.replyTaskId || null, false, file);
      } catch (e: any) {
        await this.failSoft(chatId, e);
      } finally {
        stopTyping();
      }
      return true;
    });
  }

  /** Кнопки помощника: va:undo|ok|no:<ключ>, va:ch:<ключ>:<n>.
   *  Возвращает текст всплывашки, или null — это не наша кнопка. */
  async handleCallback(chatId: number, data: string): Promise<{ toast: string; append?: string } | null> {
    const m = /^va:(undo|ok|no|ch):([a-z0-9]+)(?::(\d+))?$/.exec(data);
    if (!m) return null;
    const [, action, key, idx] = m;
    const user = await this.userByChat(chatId);
    if (!user) return { toast: 'Чат не привязан к сотруднику' };

    if (action === 'undo') {
      const u = this.undos.get(key);
      if (!u || u.chatId !== chatId || u.userId !== user.id) return { toast: 'Отменить уже нельзя — измените на сайте' };
      this.undos.delete(key);
      const api = new UserApi(this.jwt, user);
      const failed: string[] = [];
      for (const s of u.steps) {
        try { await api.request(s.method, s.path, s.body); } catch (e: any) { failed.push(e instanceof ApiError ? e.message : String(e?.message || e)); }
      }
      if (failed.length) {
        await this.telegram.sendMessage(chatId, `⚠️ Отменить удалось не всё: ${esc(failed.join('; '))}`);
        return { toast: 'Отменено частично', append: '↩️ Отменено частично' };
      }
      await this.notifyPeople(u.undoNotify);
      return { toast: 'Отменено', append: '↩️ Отменено' };
    }

    if (action === 'ok' || action === 'no') {
      const c = this.confirms.get(key);
      if (!c || c.chatId !== chatId || c.userId !== user.id) return { toast: 'Запрос устарел — скажите заново' };
      this.confirms.delete(key);
      if (action === 'no') return { toast: 'Отменено', append: '✕ Не стали делать' };
      return this.serial(chatId, async () => {
        const ctx = this.context(user, chatId, c.utterance, RefTable.fromJSON(c.refs), c.file);
        const { done, buttons } = await runPending(ctx, ALL_TOOLS.filter((t) => !t.available || t.available(user)), c.calls);
        this.releaseFileIfUsed(chatId, done);
        await this.sendResult(chatId, user, { type: 'answer', text: '', done, buttons }, null);
        return { toast: done.some((d) => d.error) ? 'Не всё получилось' : 'Готово', append: '✓ Подтверждено' };
      });
    }

    // Выбор варианта — заново разбираем ту же фразу с уточнением.
    const ch = this.choices.get(key);
    if (!ch || ch.chatId !== chatId || ch.userId !== user.id) return { toast: 'Запрос устарел — скажите заново' };
    const option = ch.options[Number(idx)];
    if (option === undefined) return { toast: 'Вариант не найден' };
    this.choices.delete(key);
    void this.serial(chatId, async () => {
      const stopTyping = this.typing(chatId);
      try {
        // Уточнение — часть сказанного: по нему и ИИ, и инструменты
        // (например вид перерыва) понимают выбор. Иначе бот спрашивал бы снова.
        const clarified = `${ch.utterance}\n\n(Человек уточнил кнопкой: «${option}»)`;
        const ctx = this.context(user, chatId, clarified, undefined, ch.file);
        const snapshot = await buildSnapshot(ctx, ch.replyTaskId);
        await this.process(chatId, user, ctx, snapshot, clarified, false, ch.replyTaskId, true, ch.file);
      } catch (e: any) {
        await this.failSoft(chatId, e);
      } finally {
        stopTyping();
      }
    });
    return { toast: option.slice(0, 60), append: `👉 ${esc(option)}` };
  }

  // ─── Разбор ───────────────────────────────────────────────────────────

  private async process(
    chatId: number, user: User, ctx: ToolContext, snapshot: { text: string }, userText: string,
    fromVoice: boolean, replyTaskId: string | null, isClarification = false, file?: IncomingFile,
  ): Promise<void> {
    const session = this.session(chatId, ctx.refs);
    const can = (t: ToolDef) => !t.available || t.available(user);
    const tools: ToolDef[] = [...CORE_TOOLS, ...(file ? FILES_TOOLS : [])].filter(can);
    const sections: Record<string, { title: string; tools: ToolDef[] }> = {};
    for (const sec of SECTIONS) {
      const own = sec.tools.filter(can);
      if (own.length) sections[sec.key] = { title: sec.title, tools: own };
    }
    // Сначала — разделы по словам ТЕКУЩЕЙ просьбы, потом по недавнему
    // разговору, пока влезает: иначе «счёт» из прошлой фразы вытеснял
    // «заметку» из нынешней (прогон 10.11.2026).
    for (const text of [userText, session.history.join(' ')]) {
      for (const sec of SECTIONS) {
        const own = sections[sec.key]?.tools;
        if (!own || !sec.words.test(text) || own.every((t) => tools.includes(t))) continue;
        const fresh = own.filter((t) => !tools.includes(t));
        if (tools.length + fresh.length <= MAX_TOOLS) tools.push(...fresh);
      }
    }
    const started = Date.now();
    let result: AgentResult;
    try {
      result = await runAgent({ ctx, tools, system: systemPrompt(ctx, snapshot as any, session.history, ALL_TOOLS.filter((t) => !can(t)).map((t) => t.name)), history: [], userText: file ? `${userText}\n\n${fileNote(file)}` : userText, sections });
    } catch (e: any) {
      if (e instanceof AllChatFailed) {
        this.logger.error(`ИИ не ответил: ${e.message}`);
        await this.telegram.sendMessage(chatId, (fromVoice ? `🎤 <i>«${esc(userText)}»</i>\n\n` : '') + explainAllFailed(e.errors));
        return;
      }
      throw e;
    }
    this.logger.log(
      `[voice] user=${user.id} ${fromVoice ? 'голос' : 'текст'} ${Date.now() - started}мс → ${result.type}`
      + ` вызовы=[${(result as any).calls?.join(',') || ''}] ${result.done.map((d) => `${d.tool}${d.error ? '✗' : '✓'}`).join(',')} «${userText.slice(0, 120)}»`,
    );

    this.releaseFileIfUsed(chatId, result.done);

    // История: что сказал человек и что вышло — для «и поставь ей срок на пятницу».
    session.history.push(`«${userText.slice(0, 300)}» → ${this.historyNote(result)}`);
    while (session.history.length > HISTORY_MAX) session.history.shift();
    session.at = Date.now();

    const head = fromVoice && !isClarification ? `🎤 <i>«${esc(userText)}»</i>\n\n` : '';
    await this.sendResult(chatId, user, result, head, ctx, replyTaskId, file);
  }

  private async sendResult(
    chatId: number, user: User, result: AgentResult, head: string | null, ctx?: ToolContext, replyTaskId?: string | null, file?: IncomingFile,
  ): Promise<void> {
    const lines: string[] = [];
    const undo: UndoStep[] = [];
    const notices: Notice[] = [];
    const undoNotices: Notice[] = [];
    for (const d of result.done) {
      if (d.outcome) {
        lines.push(esc(d.outcome.summary));
        if (d.outcome.undo) undo.unshift(...[...d.outcome.undo].reverse());
        if (d.outcome.notify) notices.push(...d.outcome.notify);
        if (d.outcome.undoNotify) undoNotices.push(...d.outcome.undoNotify);
      } else if (d.error && !result.text) {
        lines.push(`⚠️ ${esc(d.error)}`);
      }
    }
    if (result.text) lines.push(esc(result.text));

    const buttons: Button[][] = [...result.buttons];
    if (result.type === 'confirm' && ctx) {
      const key = this.key();
      this.confirms.set(key, {
        chatId, userId: user.id, calls: result.pending, refs: ctx.refs.toJSON(), utterance: ctx.utterance, file, at: Date.now(),
      });
      lines.push(`Проверьте, пожалуйста:\n\n${result.previews.map(esc).join('\n\n')}`);
      buttons.unshift([{ text: '✓ Подтвердить', callback_data: `va:ok:${key}` }, { text: '✕ Отмена', callback_data: `va:no:${key}` }]);
    }
    if (result.type === 'choice' && ctx) {
      const key = this.key();
      this.choices.set(key, { chatId, userId: user.id, utterance: ctx.utterance, options: result.options, replyTaskId: replyTaskId ?? null, file, at: Date.now() });
      lines.push(`❓ ${esc(result.question)}`);
      result.options.forEach((o, i) => buttons.push([{ text: o.slice(0, 60), callback_data: `va:ch:${key}:${i}` }]));
    }
    if (undo.length) {
      const key = this.key();
      this.undos.set(key, { chatId, userId: user.id, steps: undo, undoNotify: undoNotices, at: Date.now() });
      buttons.push([{ text: '↩ Отменить', callback_data: `va:undo:${key}` }]);
    }
    if (!lines.length) lines.push('🤔 Не понял, что нужно сделать. Например: «Задачу "Макет" — на готово» или «Какие задачи у меня на завтра?»');
    this.sweep();
    await this.telegram.sendMessage(chatId, `${head || ''}${lines.join('\n')}`.slice(0, 4000), buttons.length ? buttons : undefined);
    await this.notifyPeople(notices);
  }

  /** Сообщения другим людям (штраф/премия — сотруднику). Сбой доставки
   *  не отменяет сделанное: запись в CRM уже есть. */
  private async notifyPeople(list: Notice[] = []): Promise<void> {
    for (const n of list) {
      await this.telegram.sendToUser(n.userId, n.text).catch((e) => this.logger.warn(`уведомление ${n.userId}: ${e?.message || e}`));
    }
  }

  private historyNote(r: AgentResult): string {
    const did = r.done.map((d) => (d.outcome ? `итог: ${d.outcome.summary}` : `ошибка ${d.tool}: ${d.error}`));
    if (r.type === 'confirm') did.push(`ждёт подтверждения: ${r.previews.join(' / ')}`);
    if (r.type === 'choice') did.push(`спросили: ${r.question} (${r.options.join(' / ')})`);
    if (r.text) did.push(`ответ: ${r.text}`);
    return did.join('; ').replace(/\s+/g, ' ').slice(0, 600) || 'без действий';
  }

  // ─── Служебное ────────────────────────────────────────────────────────

  private context(user: User, chatId: number, utterance: string, refs?: RefTable, file?: IncomingFile): ToolContext {
    const session = this.sessions.get(chatId);
    const fresh = session && Date.now() - session.at < SESSION_TTL_MS && session.refs;
    return {
      user,
      api: new UserApi(this.jwt, user),
      refs: refs || fresh || new RefTable(),
      today: todayDushanbe(),
      nowTime: nowTimeDushanbe(),
      utterance,
      ...(file ? { file: this.attached(file) } : {}),
      // Чтение базы — только основателю (решение владельца 09.11.2026).
      ...(user.role === 'founder' || user.secondaryRole === 'founder' ? { db: this.dbRead } : {}),
    } as ToolContext;
  }

  /** Файл из Telegram для инструментов: содержимое качаем только по требованию. */
  private attached(file: IncomingFile): AttachedFile {
    return { name: file.name, mime: file.mime, kind: file.kind, download: () => this.telegram.downloadFile(file.fileId) };
  }

  /** Ждущий файл чата, если он ещё свежий. */
  private pendingFile(chatId: number): IncomingFile | undefined {
    const p = this.pendingFiles.get(chatId);
    if (!p) return undefined;
    if (Date.now() - p.at > PENDING_FILE_TTL_MS) { this.pendingFiles.delete(chatId); return undefined; }
    return p.file;
  }

  /** Файл ушёл в CRM — забываем его, чтобы он не приложился дважды. */
  private releaseFileIfUsed(chatId: number, done: Executed[]): void {
    if (done.some((d) => FILE_TOOL_NAMES.has(d.tool) && d.outcome)) this.pendingFiles.delete(chatId);
  }

  private session(chatId: number, refs: RefTable): Session {
    const s = this.sessions.get(chatId);
    if (s && Date.now() - s.at < SESSION_TTL_MS) { s.refs = refs; return s; }
    const fresh: Session = { refs, history: [], at: Date.now() };
    this.sessions.set(chatId, fresh);
    return fresh;
  }

  private async userByChat(chatId: number): Promise<User | null> {
    const userId = await this.telegram.resolveUserIdByChat(chatId);
    if (!userId) return null;
    const user = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
    if (!user || !user.isActive || user.isBlocked) return null;
    return user;
  }

  private allow(userId: string): boolean {
    const now = Date.now();
    const list = (this.rate.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (list.length >= RATE_MAX) { this.rate.set(userId, list); return false; }
    list.push(now);
    this.rate.set(userId, list);
    return true;
  }

  private serial<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(chatId) || Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(chatId, next.catch(() => undefined));
    return next;
  }

  /** «Печатает…» в чате, пока идёт разбор: Telegram гасит его через 5 с. */
  private typing(chatId: number): () => void {
    void this.telegram.sendChatAction(chatId, 'typing');
    const timer = setInterval(() => void this.telegram.sendChatAction(chatId, 'typing'), 4500);
    return () => clearInterval(timer);
  }

  private async failSoft(chatId: number, e: any): Promise<void> {
    this.logger.error(`голосовой помощник: ${e?.message || e}`, e?.stack);
    const msg = e instanceof AiProviderError
      ? explainAllFailed([e])
      : '⚠️ Не получилось обработать сообщение. Попробуйте ещё раз через минуту.';
    await this.telegram.sendMessage(chatId, msg).catch(() => undefined);
  }

  private key(): string {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(-10);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.undos) if (now - v.at > UNDO_TTL_MS) this.undos.delete(k);
    for (const [k, v] of this.confirms) if (now - v.at > PENDING_TTL_MS) this.confirms.delete(k);
    for (const [k, v] of this.choices) if (now - v.at > PENDING_TTL_MS) this.choices.delete(k);
    for (const [k, v] of this.sessions) if (now - v.at > SESSION_TTL_MS) this.sessions.delete(k);
    for (const [k, v] of this.pendingFiles) if (now - v.at > PENDING_FILE_TTL_MS) this.pendingFiles.delete(k);
    for (const [k, v] of this.rate) if (!v.some((t) => now - t < RATE_WINDOW_MS)) this.rate.delete(k);
  }

  /** Для тестов. */
  get _state() {
    return { pendingFiles: this.pendingFiles, sessions: this.sessions, undos: this.undos, confirms: this.confirms, choices: this.choices };
  }
}

export type { Executed };
