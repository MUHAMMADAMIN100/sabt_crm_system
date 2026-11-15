/** Правила общей оценки KPI, вынесенные из KpiService ради тестов. */

/** Универсальная KPI-метрика. */
export interface KpiItem {
  key: string;
  label: string;
  target: number;
  value: number;
  percent: number;
  done: boolean;
}

/** «Соблюдено дедлайнов» менеджера продаж (14.11.2026). Нет в периоде задач
 *  со сроком — пункта нет, как у разработки: соблюдать нечего, и 0 % не тянет
 *  оценку вниз. Задачи без срока сами пункт не создают и в долю не входят
 *  (15.11.2026: раньше шли «в срок» и накручивали процент). Сроки были, а
 *  закрытых задач нет — честные 0 %.
 *  t — закрытые в периоде (всего / в срок / из них со сроком);
 *  dueInPeriod — задачи со сроком в периоде, срок которых наступил или сданные. */
export function salesDeadlineItem(
  t: { done: number; onTime: number; withDeadline: number },
  dueInPeriod: number,
  target: number,
): KpiItem | null {
  if (dueInPeriod <= 0 && t.withDeadline <= 0) return null;
  const closed = Math.max(0, t.withDeadline);
  const rate = closed > 0 ? Math.round((Math.min(t.onTime, closed) / closed) * 100) : 0;
  return {
    key: 'deadline_rate',
    label: 'Соблюдено дедлайнов',
    target,
    value: rate,
    percent: closed > 0 ? Math.min(100, Math.round((rate / target) * 100)) : 0,
    done: closed > 0 && rate >= target,
  };
}

/** «Активных дней» менеджера продаж: норма — те же рабочие дни, что у норм
 *  продаж (пн–сб, уже наступившие, без отпуска). Ни одного — пункта нет. */
export function salesActivityItem(activeDays: number, workDays: number): KpiItem | null {
  if (!(workDays > 0)) return null;
  return {
    key: 'activity_days',
    label: 'Активных дней',
    target: workDays,
    value: activeDays,
    percent: Math.min(100, Math.round((activeDays / workDays) * 100)),
    done: activeDays >= workDays,
  };
}

/** Пункты KPI продаж в общей оценке, с префиксом sales_ (чтобы не
 *  пересекаться с универсальными). Выходной (нет рабочих дней) — пунктов
 *  нет: норма не считается, а без других пунктов оценки нет (noData). */
export function salesKpiItems(
  sales: { restDay?: boolean; items?: KpiItem[] } | null | undefined,
): KpiItem[] {
  if (!sales?.items || sales.restDay) return [];
  return sales.items.filter(i => i.target > 0).map(i => ({ ...i, key: `sales_${i.key}` }));
}
