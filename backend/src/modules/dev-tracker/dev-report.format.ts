/** Шаблоны отчётов для CEO (template-based, без LLM).
 *
 *  Чистый TS-шаблонизатор: по агрегатам строит русский markdown-отчёт.
 *  Не ходит в сеть и не трогает репозитории — unit-тестируется напрямую.
 */

export interface DevReportStats {
  created: number;
  done: number;
  doneOnTime: number;
  overdue: number;
  blocked: number;
  open: number;
  slaBreached: number;
}

export interface DevReportBlocker {
  id: string;
  title: string;
  reason: string | null;
  assignee: string | null;
  status: string;
}

export interface DevReportMember {
  assigneeId: string;
  name: string | null;
  done: number;
  open: number;
  overdue: number;
}

export interface DevReportPeriod {
  from: string;
  to: string;
}

export interface DevReportFormatInput {
  title: string;
  period: DevReportPeriod | null;
  stats: DevReportStats;
  blockers: DevReportBlocker[];
  members: DevReportMember[];
  /** Сумма storyPoints по завершённым (окно для week, scope для sprint/project). */
  velocity: number;
  /** Открытые задачи без исполнителя — для раздела «Риски». */
  unassignedOpen?: number;
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

const str = (v: unknown, fallback = '—'): string => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s === '' ? fallback : s;
};

/** Короткая дата YYYY-MM-DD из ISO/даты; мусор возвращаем как есть. */
function shortDate(v: string): string {
  if (!v) return v;
  const t = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : v;
}

/** Чистая функция: входные агрегаты → русский markdown-отчёт. */
export function formatDevReportMarkdown(input: DevReportFormatInput): string {
  const title = str(input?.title, 'Отчёт');
  const stats = input?.stats ?? {
    created: 0, done: 0, doneOnTime: 0, overdue: 0, blocked: 0, open: 0, slaBreached: 0,
  };
  const blockers = Array.isArray(input?.blockers) ? input.blockers : [];
  const members = Array.isArray(input?.members) ? input.members : [];
  const velocity = num(input?.velocity);
  const unassignedOpen = num(input?.unassignedOpen);

  const created = num(stats.created);
  const done = num(stats.done);
  const doneOnTime = num(stats.doneOnTime);
  const overdue = num(stats.overdue);
  const blocked = num(stats.blocked);
  const open = num(stats.open);
  const slaBreached = num(stats.slaBreached);

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  if (input?.period?.from && input?.period?.to) {
    lines.push(`Период: ${shortDate(input.period.from)} — ${shortDate(input.period.to)}`);
  } else {
    lines.push('Период: весь период');
  }
  lines.push('');
  lines.push('## Итоги цифрами');
  lines.push('');
  lines.push(`- Создано: ${created}`);
  lines.push(`- Завершено: ${done} (в срок: ${doneOnTime})`);
  lines.push(`- Открыто: ${open}`);
  lines.push(`- Просрочено: ${overdue}`);
  lines.push(`- Заблокировано: ${blocked}`);
  lines.push(`- Нарушено SLA: ${slaBreached}`);
  lines.push(`- Velocity: ${velocity} story points`);
  if (created > 0) {
    const pct = Math.round((done / created) * 100);
    lines.push(`- Прогресс: ${done}/${created} (${pct}%)`);
  }
  lines.push('');
  lines.push('## Блокеры');
  lines.push('');
  if (blockers.length === 0) {
    lines.push('Блокеров нет ✅');
  } else {
    for (const b of blockers) {
      const bTitle = str((b as any)?.title, '(без названия)');
      const reason = str((b as any)?.reason, 'причина не указана');
      const assignee = str((b as any)?.assignee, 'без исполнителя');
      const status = str((b as any)?.status, '—');
      lines.push(`- ${bTitle} — ${reason}; исполнитель: ${assignee}; статус: ${status}`);
    }
  }
  lines.push('');
  lines.push('## По сотрудникам');
  lines.push('');
  if (members.length === 0) {
    lines.push('Нет назначенных задач.');
  } else {
    lines.push('| Сотрудник | Завершено | Открыто | Просрочено |');
    lines.push('|---|---|---|---|');
    const sorted = [...members].sort(
      (a, b) => num((b as any)?.done) - num((a as any)?.done),
    );
    for (const m of sorted) {
      const name = str((m as any)?.name, 'Без имени');
      lines.push(`| ${name} | ${num((m as any)?.done)} | ${num((m as any)?.open)} | ${num((m as any)?.overdue)} |`);
    }
  }
  lines.push('');
  lines.push('## Риски');
  lines.push('');
  if (overdue === 0 && slaBreached === 0 && unassignedOpen === 0) {
    lines.push('Рисков не выявлено ✅');
  } else {
    lines.push(`- Просроченные задачи: ${overdue}`);
    lines.push(`- Нарушения SLA: ${slaBreached}`);
    lines.push(`- Открытые без исполнителя: ${unassignedOpen}`);
    if (blocked > 0) {
      lines.push(`- Заблокированные задачи: ${blocked}`);
    }
  }
  lines.push('');
  lines.push(`_Сформировано ${new Date().toISOString()}_`);
  lines.push('');
  return lines.join('\n');
}
