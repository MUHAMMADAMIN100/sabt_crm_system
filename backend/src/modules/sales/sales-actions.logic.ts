import { BadRequestException } from '@nestjs/common';
import { dushanbeDay, dushanbeDayEnd } from '../clients/sales-kpi.logic';
import type { LeadEventKind } from '../clients/lead-events';
import type { CallDto, EmailDto, MeetingResultDto, NextActionDto } from './dto/sales.dto';

/**
 * Что делают действия менеджера с лидом (15.11.2026, SALES_SPEC §5).
 * Чистые функции: лид + тело + «сейчас» → правка полей, события ленты,
 * переход этапа и запись KPI. Сервис только применяет результат: поля —
 * напрямую в client_leads, этап — через ClientsService.updateWithAuth
 * (там продвижение воронки и событие «stage»), KPI — в lead_actions.
 */

/** Поля лида, которые читают действия. */
export interface ActionLead {
  id: string;
  status: string;
  nextContactAt?: Date | string | null;
  meetingResult?: string | null;
  repeatCallAt?: Date | string | null;
  nextStep?: string | null;
  callType?: string | null;
  emailStatus?: string | null;
  callRequested?: boolean | null;
}

export interface PlannedEvent {
  kind: LeadEventKind;
  data: Record<string, any>;
}

export interface ActionPlan {
  /** Поля client_leads, которые пишем напрямую (без ClientsService). */
  patch: Record<string, any>;
  events: PlannedEvent[];
  /** Новый этап (через ClientsService) или null. */
  stageTo: string | null;
  /** Запись в lead_actions для KPI или null. */
  kpi: { kind: 'cold_call' | 'email' | 'meeting'; at?: Date } | null;
}

/** Следующее действие в прошлом — ошибка ввода; запас — на часы браузера. */
const PAST_TOLERANCE_MS = 10 * 60_000;

/** Этапы, из которых «дозвонился» ведёт в «Контакт» (unknown ≡ new). */
const TO_WAITING_FROM = ['new', 'unknown'];
/** Этапы, из которых состоявшаяся встреча ведёт во «Встречу». */
const TO_MEETING_FROM = ['new', 'unknown', 'waiting', 'negotiating'];

const clean = (s?: string | null): string | undefined => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t ? t : undefined;
};

/** Убираем пустые ключи — в ленте событий не нужны «comment: undefined». */
const compact = (o: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
};

const timeOf = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Следующий шаг → поля и события. Общий для звонка и итога встречи. */
export function nextActionPlan(next: NextActionDto | undefined | null, now: Date): {
  patch: Record<string, any>; events: PlannedEvent[]; data: Record<string, any> | undefined;
} {
  if (!next) return { patch: {}, events: [], data: undefined };
  const at = new Date(next.at);
  if (!Number.isFinite(at.getTime())) throw new BadRequestException('Неверное время следующего шага');
  if (at.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    throw new BadRequestException('Следующий шаг — в прошлом: выберите время позже');
  }
  const text = clean(next.text);
  const iso = at.toISOString();
  if (next.kind === 'callback') {
    return { patch: { repeatCallAt: at }, events: [], data: compact({ kind: 'callback', at: iso, text }) };
  }
  if (next.kind === 'meeting') {
    // Новая встреча — итога у неё ещё нет (прежний итог относился к прошлой).
    return {
      patch: { nextContactAt: at, meetingResult: null },
      events: [{ kind: 'meeting_set', data: { at: iso } }],
      data: compact({ kind: 'meeting', at: iso, text }),
    };
  }
  if (!text) throw new BadRequestException('Опишите следующий шаг');
  return {
    patch: { nextStep: text, nextStepAt: at },
    events: [{ kind: 'next_step', data: { text, at: iso } }],
    data: { kind: 'step', at: iso, text },
  };
}

/**
 * Звонок: событие «call», KPI «Звонки» (cold_call, 1 на лид в день — дедуп
 * в SQL), последний контакт — сегодня, активность — сейчас, тип звонка —
 * «холодный», если не задан. «Дозвонился» у нового лида — этап «Контакт».
 *
 * Перезвон, срок которого наступил (сегодня или раньше), звонком выполнен —
 * снимаем, иначе он вечно висел бы в «Просрочено». Отметку руководителя
 * «Позвонить» снимает только состоявшийся разговор.
 */
export function callPlan(lead: ActionLead, dto: CallDto, now: Date): ActionPlan {
  const next = nextActionPlan(dto.next, now);
  const patch: Record<string, any> = {
    lastContactAt: dushanbeDay(now),
    lastActivityAt: now,
  };
  if (!clean(lead.callType)) patch.callType = 'cold';
  const callAt = timeOf(lead.repeatCallAt);
  if (callAt !== null && callAt <= dushanbeDayEnd(dushanbeDay(now)).getTime()) patch.repeatCallAt = null;
  if (dto.result === 'reached' && lead.callRequested) {
    patch.callRequested = false;
    patch.callRequestedAt = null;
    patch.callRequestedByName = null;
  }
  Object.assign(patch, next.patch);
  return {
    patch,
    events: [
      { kind: 'call', data: compact({ result: dto.result, outcome: dto.outcome, comment: clean(dto.comment), next: next.data }) },
      ...next.events,
    ],
    stageTo: dto.result === 'reached' && TO_WAITING_FROM.includes(String(lead.status)) ? 'waiting' : null,
    kpi: { kind: 'cold_call' },
  };
}

/** Письмо: событие «email», KPI «Письма» (1 на лид в день), «Написал», если
 *  статус письма ещё не задан (ответ клиента не затираем). */
export function emailPlan(lead: ActionLead, dto: EmailDto, now: Date): ActionPlan {
  const patch: Record<string, any> = { lastActivityAt: now };
  if (!clean(lead.emailStatus)) patch.emailStatus = 'sent';
  return {
    patch,
    events: [{ kind: 'email', data: compact({ comment: clean(dto?.comment) }) }],
    stageTo: null,
    kpi: { kind: 'email' },
  };
}

/**
 * Итог встречи. Нужна назначенная встреча не позже конца сегодняшнего дня:
 * «состоялась» про завтрашнюю — накрутка KPI. Состоялась — KPI «Встречи»
 * (at = сейчас, 1 на лид в день), этап new/waiting → «Встреча». Не
 * состоялась — только итог и событие.
 */
export function meetingPlan(lead: ActionLead, dto: MeetingResultDto, now: Date): ActionPlan {
  const meetAt = timeOf(lead.nextContactAt);
  if (meetAt === null || meetAt > dushanbeDayEnd(dushanbeDay(now)).getTime()) {
    throw new BadRequestException('Нет встречи на сегодня или раньше — сначала назначьте встречу');
  }
  const next = nextActionPlan(dto.next, now);
  const held = !!dto.held;
  const patch: Record<string, any> = { meetingResult: held ? 'held' : 'missed', lastActivityAt: now };
  if (held) patch.lastContactAt = dushanbeDay(now);
  // Следующая встреча (next.kind='meeting') сбросит итог — это уже другая встреча.
  Object.assign(patch, next.patch);
  const at = new Date(meetAt).toISOString();
  return {
    patch,
    events: [
      { kind: held ? 'meeting_done' : 'meeting_missed', data: compact({ at, comment: clean(dto.comment), next: next.data }) },
      ...next.events,
    ],
    stageTo: held && TO_MEETING_FROM.includes(String(lead.status)) ? 'meeting' : null,
    kpi: held ? { kind: 'meeting', at: now } : null,
  };
}
