import { ApiError } from '../internal-api';
import { checkDate, checkTime, fmtDateRu } from './common';
import { ensureEmployee } from './people.tools';
import { NeedChoice, ToolDef, ToolError, WriteOutcome } from './types';

/**
 * Рабочий день — раздел «Смена» на сайте (ShiftButton / ShiftCard):
 * «Начать работу», «Перерыв» (обед / по работе / личное), «Продолжить»,
 * «Завершить», «Приду позже», «Забыл отметить». Основателю кнопка смены на
 * сайте не показывается — и в боте её нет.
 */
const notFounder = (u: any) => u.role !== 'founder';
const isTop = (u: any) => [u.role, u.secondaryRole].some((r) => r === 'admin' || r === 'founder');

const hm = (min: number) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
};
const PAUSE_RU: Record<string, string> = { lunch: 'обед', work: 'по работе', personal: 'личное' };

function shiftError(err: any): Error {
  return err instanceof ApiError ? new ToolError(err.message) : err;
}

export const shiftStatus: ToolDef<{ month?: boolean }> = {
  name: 'shift_status',
  kind: 'read',
  description: 'Моя смена: «сколько я сегодня отработал», «во сколько я начал», «я на смене?», «я опоздал?»; month=true — «сколько я отработал за месяц».',
  parameters: {
    type: 'object',
    properties: { month: { type: 'boolean', description: 'Итоги текущего месяца.' } },
    additionalProperties: false,
  },
  available: notFounder,
  async run(args, ctx) {
    const my: any = await ctx.api.get('/work-shifts/my');
    const out: Record<string, any> = {
      state: my?.state === 'working' ? 'работаю' : my?.state === 'paused' ? `перерыв (${PAUSE_RU[my?.pauseKind] || 'личное'}) с ${my?.pausedSince || '?'}` : 'смена не идёт',
      todayWorked: hm(my?.todayMinutes),
      startedAt: my?.dayStartedLabel || null,
      late: !!my?.isLate,
      leftToNorm: hm(my?.leftMinutes),
    };
    if (args.month) {
      const res: any = await ctx.api.get('/work-shifts/my-month');
      const m = res?.item || {};
      out.month = {
        worked: hm(m.totalMinutes),
        workedDays: m.workedDays ?? 0,
        averagePerDay: hm(m.avgMinutes),
        lateDays: Array.isArray(m.lateDays) ? m.lateDays.length : 0,
        ...(m.normMinutes != null ? { norm: hm(m.normMinutes) } : {}),
      };
    }
    return out;
  },
};

export const shiftStart: ToolDef<Record<string, never>> = {
  name: 'shift_start',
  kind: 'write',
  description: '«Начни работу», «начинаю рабочий день», «я на работе», а после перерыва — «продолжи», «вернулся».',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: notFounder,
  async run(_args, ctx): Promise<WriteOutcome> {
    const before: any = await ctx.api.get('/work-shifts/my');
    if (before?.state === 'working') return { summary: `ℹ️ Смена уже идёт с ${before.dayStartedLabel || 'утра'}` };
    let after: any;
    try { after = await ctx.api.post('/work-shifts/start'); } catch (e) { throw shiftError(e); }
    const resumed = before?.state === 'paused' || (before?.todayMinutes ?? 0) > 0;
    return {
      summary: resumed
        ? `▶️ Продолжили работу. Сегодня уже ${hm(after?.todayMinutes ?? before?.todayMinutes)}`
        : `▶️ Рабочий день начат в ${ctx.nowTime}${after?.isLate ? ' (позже графика)' : ''}`,
    };
  },
};

/** Вид перерыва — только по словам человека. Личное в часы не идёт, обед —
 *  до часа, по работе — целиком: угадывать тут нельзя, это деньги. */
const PAUSE_WORDS: Record<'lunch' | 'work' | 'personal', RegExp> = {
  lunch: /обед|поесть|покушать|кушать|перекус|хӯрок|хурок|наҳор|нахор|таом/i,
  work: /по работе|съ[её]мк|клиент|выехал|выезжа|на объект|встреч|мизоҷ|мизоч|кори корӣ|бо кор/i,
  personal: /личн|по делам|по своим|врач|больниц|домой по|шахсӣ|шахси|кори худ/i,
};

export function pauseKindFromSpeech(text: string): 'lunch' | 'work' | 'personal' | null {
  const hits = (Object.keys(PAUSE_WORDS) as Array<'lunch' | 'work' | 'personal'>).filter((k) => PAUSE_WORDS[k].test(text));
  return hits.length === 1 ? hits[0] : null;
}

export const shiftPause: ToolDef<{ kind?: 'lunch' | 'work' | 'personal' }> = {
  name: 'shift_pause',
  kind: 'write',
  description:
    'Перерыв в смене: «поставь на паузу», «я на обед», «выехал к клиенту». Вид перерыва бот определит сам по словам '
    + 'человека и при необходимости спросит кнопками — просто вызови инструмент.',
  parameters: {
    type: 'object',
    properties: { kind: { type: 'string', enum: ['lunch', 'work', 'personal'], description: 'Только если причина прямо названа.' } },
    additionalProperties: false,
  },
  available: notFounder,
  async run(args, ctx): Promise<WriteOutcome> {
    const kind = pauseKindFromSpeech(ctx.utterance);
    if (!kind) throw new NeedChoice('Какой перерыв?', ['Обед', 'По работе (выехал / на съёмку)', 'Личное']);
    let after: any;
    try { after = await ctx.api.post('/work-shifts/pause', { kind }); } catch (e) { throw shiftError(e); }
    return { summary: `⏸ Перерыв (${PAUSE_RU[kind]}) с ${ctx.nowTime}. Отработано сегодня: ${hm(after?.todayMinutes)}` };
  },
};

export const shiftStop: ToolDef<Record<string, never>> = {
  name: 'shift_stop',
  kind: 'write',
  description: '«Закончи рабочий день», «завершить смену», «я ушёл домой».',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  available: notFounder,
  async run(_args, ctx): Promise<WriteOutcome> {
    let after: any;
    try { after = await ctx.api.post('/work-shifts/stop'); } catch (e) { throw shiftError(e); }
    return { summary: `⏹ Рабочий день завершён в ${ctx.nowTime}. Итого сегодня: ${hm(after?.todayMinutes)}` };
  },
};

export const shiftNotice: ToolDef<{ date: string; time: string; reason?: string }> = {
  name: 'shift_late_notice',
  kind: 'write',
  description: '«Приду позже» — предупредить заранее: дата, во сколько придёт, причина. Руководство одобряет на сайте.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      time: { type: 'string', description: 'Во сколько придёт, ЧЧ:ММ.' },
      reason: { type: 'string' },
    },
    required: ['date', 'time'],
    additionalProperties: false,
  },
  available: notFounder,
  async run(args, ctx): Promise<WriteOutcome> {
    const date = checkDate(args.date);
    const time = checkTime(args.time);
    try {
      await ctx.api.post('/work-shifts/notices', { date, time, ...(args.reason ? { reason: String(args.reason).slice(0, 500) } : {}) });
    } catch (e) { throw shiftError(e); }
    return { summary: `🕘 Предупреждение отправлено: ${fmtDateRu(date)} приду к ${time}. Ждёт одобрения руководства` };
  },
};

export const shiftEditRequest: ToolDef<{ date?: string; field: 'start' | 'end'; time: string; note?: string }> = {
  name: 'shift_fix_time',
  kind: 'write',
  description: '«Забыл отметить» — попросить поправить время начала (start) или конца (end) смены за день. Нужна проверка руководства.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' },
      field: { type: 'string', enum: ['start', 'end'] },
      time: { type: 'string', description: 'Правильное время ЧЧ:ММ.' },
      note: { type: 'string' },
    },
    required: ['field', 'time'],
    additionalProperties: false,
  },
  available: notFounder,
  async run(args, ctx): Promise<WriteOutcome> {
    const date = args.date ? checkDate(args.date) : ctx.today;
    const time = checkTime(args.time);
    try {
      await ctx.api.post('/work-shifts/edit-request', {
        date, field: args.field, time, ...(args.note ? { note: String(args.note).slice(0, 500) } : {}),
      });
    } catch (e) { throw shiftError(e); }
    return { summary: `🛠 Запрос на правку отправлен: ${fmtDateRu(date)}, ${args.field === 'start' ? 'начало' : 'конец'} — ${time}` };
  },
};

export const teamShifts: ToolDef<{ date?: string }> = {
  name: 'team_shift_status',
  kind: 'read',
  description: 'Кто сейчас работает, кто на перерыве, кто опоздал, кто не пришёл (только админ и основатель).',
  parameters: {
    type: 'object',
    properties: { date: { type: 'string', description: 'ГГГГ-ММ-ДД, по умолчанию сегодня.' } },
    additionalProperties: false,
  },
  available: isTop,
  async run(args, ctx) {
    const res: any = await ctx.api.get('/work-shifts/team', args.date ? { date: checkDate(args.date) } : undefined);
    const ST: Record<string, string> = { working: 'работает', paused: 'перерыв', closed: 'закончил', off: 'отгул/отпуск', absent: 'не начинал' };
    return {
      people: (res?.items || []).map((p: any) => ({
        ref: ctx.refs.add('E', p.id, p.name),
        name: p.name,
        status: ST[p.status] || p.status,
        ...(p.startedLabel ? { started: p.startedLabel } : {}),
        ...(p.late ? { late: true } : {}),
        ...(p.pauseKind ? { pause: PAUSE_RU[p.pauseKind] || p.pauseKind } : {}),
        today: hm(p.todayMinutes),
      })),
    };
  },
};

export const setAbsence: ToolDef<{ employee: string; date: string; kind: 'dayoff' | 'vacation' | 'sick'; note?: string }> = {
  name: 'set_absence',
  kind: 'write',
  description: 'Отметить сотруднику отгул (dayoff), отпуск (vacation) или больничный (sick) на дату — только админ и основатель.',
  parameters: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'Метка сотрудника E…' },
      date: { type: 'string', description: 'ГГГГ-ММ-ДД' },
      kind: { type: 'string', enum: ['dayoff', 'vacation', 'sick'] },
      note: { type: 'string' },
    },
    required: ['employee', 'date', 'kind'],
    additionalProperties: false,
  },
  available: isTop,
  confirm: () => true,
  async preview(args, ctx) {
    const emp = ensureEmployee(ctx, args.employee);
    const KIND: Record<string, string> = { dayoff: 'Отгул', vacation: 'Отпуск', sick: 'Больничный' };
    return `🗓 ${KIND[args.kind] || args.kind}: ${emp.label}, ${fmtDateRu(checkDate(args.date))}${args.note ? `\n📝 ${args.note}` : ''}`;
  },
  async run(args, ctx): Promise<WriteOutcome> {
    const emp = ensureEmployee(ctx, args.employee);
    const date = checkDate(args.date);
    const kind = ['dayoff', 'vacation', 'sick'].includes(args.kind) ? args.kind : 'dayoff';
    try {
      await ctx.api.post('/work-shifts/absence', {
        employeeId: emp.id, date, kind, ...(args.note ? { note: String(args.note).slice(0, 500) } : {}),
      });
    } catch (e) { throw shiftError(e); }
    const KIND: Record<string, string> = { dayoff: 'отгул', vacation: 'отпуск', sick: 'больничный' };
    return {
      summary: `🗓 ${emp.label}: ${KIND[kind]} на ${fmtDateRu(date)}`,
      undo: [{ method: 'DELETE', path: `/work-shifts/absence?employeeId=${encodeURIComponent(emp.id)}&date=${date}` }],
    };
  },
};

export const SHIFT_TOOLS: ToolDef[] = [
  shiftStatus, shiftStart, shiftPause, shiftStop, shiftNotice, shiftEditRequest, teamShifts, setAbsence,
];
