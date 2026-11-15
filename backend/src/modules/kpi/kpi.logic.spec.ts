import { KpiItem, salesActivityItem, salesDeadlineItem, salesKpiItems } from './kpi.logic';

// Общая оценка менеджера продаж (14.11.2026): «Соблюдено дедлайнов» без
// задач со сроком не ставит 0 %, выходной даёт «нет оценки», активные дни
// меряются теми же рабочими днями, что и нормы продаж.

describe('salesDeadlineItem — исключение, как у разработки', () => {
  it('нет задач со сроком в периоде — пункта нет (а не 0 %)', () => {
    expect(salesDeadlineItem({ done: 0, onTime: 0, withDeadline: 0 }, 0, 85)).toBeNull();
  });

  it('закрыты только задачи без срока — пункта тоже нет', () => {
    expect(salesDeadlineItem({ done: 3, onTime: 3, withDeadline: 0 }, 0, 85)).toBeNull();
  });

  it('сроки наступили, а закрытых нет — честные 0 %', () => {
    const it0 = salesDeadlineItem({ done: 0, onTime: 0, withDeadline: 0 }, 2, 85)!;
    expect(it0).toMatchObject({ key: 'deadline_rate', value: 0, percent: 0, done: false });
  });

  it('закрыто 4 из 5 в срок при норме 85 % — 80 % → 94 % нормы', () => {
    const it1 = salesDeadlineItem({ done: 5, onTime: 4, withDeadline: 5 }, 5, 85)!;
    expect(it1).toMatchObject({ value: 80, percent: 94, done: false });
  });

  it('закрыта задача с прошлым сроком (срок вне периода) — пункт есть', () => {
    expect(salesDeadlineItem({ done: 1, onTime: 0, withDeadline: 1 }, 0, 85)).toMatchObject({ value: 0, percent: 0 });
  });

  it('задачи без срока в долю не входят (15.11.2026)', () => {
    // 5 закрыто, со сроком 2, обе в срок — 100 %, а не 3/5 «бесплатных».
    expect(salesDeadlineItem({ done: 5, onTime: 2, withDeadline: 2 }, 2, 85))
      .toMatchObject({ value: 100, percent: 100, done: true });
  });
});

describe('salesActivityItem — активные дни продаж', () => {
  it('норма — рабочие дни, не больше 100 %', () => {
    expect(salesActivityItem(9, 9)).toMatchObject({ target: 9, percent: 100, done: true });
    expect(salesActivityItem(11, 9)).toMatchObject({ percent: 100 });
    expect(salesActivityItem(6, 12)).toMatchObject({ percent: 50, done: false });
  });
  it('выходной — пункта нет', () => {
    expect(salesActivityItem(1, 0)).toBeNull();
  });
});

describe('salesKpiItems — пункты продаж в общей оценке', () => {
  const item = (key: string, target: number): KpiItem => ({ key, label: key, target, value: 1, percent: 50, done: false });

  it('префикс sales_', () => {
    expect(salesKpiItems({ restDay: false, items: [item('meetings', 2)] }).map(i => i.key)).toEqual(['sales_meetings']);
  });

  it('выходной — пунктов нет, оценка уходит в «нет данных»', () => {
    expect(salesKpiItems({ restDay: true, items: [item('meetings', 0)] })).toEqual([]);
    expect(salesKpiItems(null)).toEqual([]);
  });
});
