import { hasGrant } from '../../auth/permissions';
import { ApiError } from '../internal-api';
import { addDays, checkDate, fmtDateRu, matchScore, roles } from './common';
import { ToolContext, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Файлы, присланные в чат бота, — внутрь CRM.
 *  - attach_task_result: файл как результат задачи (как кнопка «Результат»
 *    и загрузка файла на странице задачи);
 *  - attach_transport_receipt: заявка на транспорт с фото чека.
 * Клиентам в Instagram файлы НЕ отправляем (решение владельца).
 */

const TRANSPORT_ROLES = ['smm_specialist', 'videographer'];
const TRANSPORT_MAX = 5000;
const RECEIPT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RECEIPT_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
/** Сервер принимает чек до 2 МБ в base64, то есть ~1,5 МБ самого файла. */
const RECEIPT_MAX_BYTES = 1_500_000;

const apiErr = (e: unknown): unknown => (e instanceof ApiError ? new ToolError(e.message) : e);
const money = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом.`;

function needFile(ctx: ToolContext) {
  if (!ctx.file) {
    throw new ToolError('Файла нет: пришлите фото или документ в чат, а потом скажите, куда его приложить.');
  }
  return ctx.file;
}

function toBlob(buf: Buffer, mime: string): Blob {
  return new Blob([new Uint8Array(buf)], { type: mime });
}

/** Безопасное имя для записи в результат (как в кнопке «Результат»). */
function safeName(name: string): string {
  return (name || 'file').replace(/[^\p{L}\p{N}_.\-]+/gu, '_').slice(0, 80) || 'file';
}

// ─── Результат задачи ───────────────────────────────────────────────────

export const attachTaskResult: ToolDef<{ task: string }> = {
  name: 'attach_task_result',
  kind: 'write',
  description:
    'Приложить присланный в чат файл (фото/документ) к задаче как результат работы: '
    + '«приложи это к задаче Макет», «вот результат по задаче Лендинг», «прикрепи файл к задаче». '
    + 'Работает только когда человек прислал файл. Файл уходит в карточку задачи внутри CRM, '
    + 'клиентам и в Instagram НИЧЕГО не отправляется. НЕ для чека на транспорт (attach_transport_receipt) '
    + 'и НЕ для комментария к задаче (comment_task).',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string', description: 'Метка задачи T… (найдите через find_tasks).' } },
    required: ['task'],
    additionalProperties: false,
  },
  available: (user) => hasGrant(user, 'files.upload'),
  async run(args, ctx): Promise<WriteOutcome> {
    const file = needFile(ctx);
    const entry = ctx.refs.resolve('T', args.task);
    if (!entry) throw new ToolError(`Нет задачи с меткой «${args.task}». Сначала найдите её через find_tasks.`);

    let task: any;
    try { task = await ctx.api.get(`/tasks/${entry.id}`); } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) throw new ToolError('Эта задача недоступна или уже удалена.');
      throw apiErr(e);
    }
    const title = task?.title || entry.label;

    const buf = await file.download();
    const form = new FormData();
    form.append('file', toBlob(buf, file.mime), file.name);
    let attachment: any;
    try { attachment = await ctx.api.upload('/files/upload', form, { taskId: entry.id }); } catch (e) { throw apiErr(e); }

    let result: any;
    try {
      result = await ctx.api.post(`/tasks/${entry.id}/results`, {
        type: 'file',
        content: `Результат из Telegram: ${file.name}`.slice(0, 500),
        fileName: safeName(file.name),
        filePath: attachment?.path,
      });
    } catch (e) {
      if (attachment?.id) await ctx.api.delete(`/files/${attachment.id}`).catch(() => undefined);
      throw apiErr(e);
    }

    const undo: NonNullable<WriteOutcome['undo']> = [];
    if (result?.id) undo.push({ method: 'DELETE', path: `/tasks/${entry.id}/results/${result.id}` });
    if (attachment?.id) undo.push({ method: 'DELETE', path: `/files/${attachment.id}` });
    return {
      summary: `📎 Файл «${file.name}» приложен к задаче «${title}» как результат`,
      undo: undo.length ? undo : undefined,
    };
  },
};

// ─── Чек к заявке на транспорт ──────────────────────────────────────────

interface ReceiptArgs { project: string; amount: number; date?: string; note?: string }

async function prepareReceipt(args: ReceiptArgs, ctx: ToolContext) {
  const file = needFile(ctx);
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  const isImage = RECEIPT_MIMES.has(file.mime) && (file.kind === 'photo' || RECEIPT_EXTS.includes(ext));
  if (!isImage) throw new ToolError('Чек должен быть фото: JPG, PNG или WEBP. Пришлите фото чека.');

  const amount = Math.round((Number(args.amount) || 0) * 100) / 100;
  if (!(amount > 0) || amount > TRANSPORT_MAX) throw new ToolError(`Сумма заявки — от 1 до ${TRANSPORT_MAX} сомони.`);
  const date = args.date ? checkDate(args.date, 'дата поездки') : ctx.today;
  if (date > ctx.today) throw new ToolError('Дата поездки не может быть в будущем.');
  if (date < addDays(ctx.today, -60)) throw new ToolError('Заявку можно подать за поездку не старше 60 дней.');

  let projects: any[];
  try { projects = (await ctx.api.get<any[]>('/transport-requests/projects')) || []; } catch (e) { throw apiErr(e); }
  const byRef = ctx.refs.resolve('P', args.project);
  let project = byRef ? projects.find((p) => p.id === byRef.id) : undefined;
  if (!project) {
    const scored = projects.map((p) => ({ p, sc: matchScore(p.name, String(args.project || '')) })).filter((x) => x.sc >= 0.5);
    const best = scored.length ? Math.max(...scored.map((x) => x.sc)) : 0;
    const top = scored.filter((x) => x.sc === best);
    if (!top.length) throw new ToolError(`Не нашёл проект «${args.project}». Назовите проект точнее.`);
    const mine = top.filter((x) => x.p.mine);
    const pool = mine.length ? mine : top;
    const names = new Set<string>(pool.map((x) => x.p.name));
    if (pool.length > 1) {
      throw new ToolError(names.size === 1
        ? `В CRM несколько проектов с названием «${pool[0].p.name}» — подайте заявку на сайте, чтобы выбрать нужный.`
        : `Подходит несколько проектов: ${[...names].slice(0, 6).join(', ')}. Уточните через ask_choice.`);
    }
    project = pool[0].p;
  }
  const note = args.note ? String(args.note).trim().slice(0, 300) : '';
  return {
    file, project, amount, date, note,
    preview: `🚗 ЗАЯВКА НА ТРАНСПОРТ ${money(amount)} С ЧЕКОМ\nПроект: ${project.name}\n📅 Поездка: ${fmtDateRu(date)}${note ? `\n📝 ${note}` : ''}\n🧾 Чек: фото «${file.name}»\nЗаявка уйдёт основателю на оплату.`,
  };
}

export const attachTransportReceipt: ToolDef<ReceiptArgs> = {
  name: 'attach_transport_receipt',
  kind: 'write',
  description:
    'Фото чека на транспорт: подать заявку на возврат денег за проезд ВМЕСТЕ с присланным фото чека '
    + '(только SMM-специалист и видеограф): «это чек за такси, 30 сомони, проект Архидея». '
    + 'Сайт принимает чек только при подаче заявки, поэтому инструмент создаёт новую заявку с чеком; '
    + 'к уже поданной заявке чек добавить нельзя. Нужны фото, проект и сумма (до 5000). '
    + 'Если заявка без чека — transport_create. НЕ для результата задачи (attach_task_result).',
  parameters: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Проект поездки.' },
      amount: { type: 'number', description: 'Сумма, сомони.' },
      date: { type: 'string', description: 'Дата поездки ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      note: { type: 'string', description: 'Куда ездил.' },
    },
    required: ['project', 'amount'],
    additionalProperties: false,
  },
  available: (user) => roles(user).some((r) => TRANSPORT_ROLES.includes(r)),
  confirm: () => true,
  async preview(args, ctx) {
    return (await prepareReceipt(args, ctx)).preview;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const p = await prepareReceipt(args, ctx);
    const buf = await p.file.download();
    if (buf.length > RECEIPT_MAX_BYTES) throw new ToolError('Фото чека слишком тяжёлое — пришлите другое или скриншот.');
    const form = new FormData();
    form.append('projectId', p.project.id);
    form.append('amount', String(p.amount));
    form.append('date', p.date);
    if (p.note) form.append('note', p.note);
    form.append('receipt', toBlob(buf, p.file.mime), p.file.name);
    let res: any;
    try { res = await ctx.api.upload('/transport-requests', form); } catch (e) { throw apiErr(e); }
    return {
      summary: `🚗 Заявка на транспорт с чеком подана: ${money(p.amount)} · ${p.project.name}`,
      undo: res?.id ? [{ method: 'DELETE', path: `/transport-requests/${res.id}` }] : undefined,
    };
  },
};

export const FILES_TOOLS: ToolDef[] = [attachTaskResult, attachTransportReceipt];
