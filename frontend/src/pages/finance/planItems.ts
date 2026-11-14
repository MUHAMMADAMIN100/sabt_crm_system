// Сборка денежного календаря «Планирования» — вынесена из FinancePlanningPage
// (14.11.2026), чтобы её можно было проверить тестами. Правила те же, что у
// календаря менеджера на сервере (smm-payments.logic → calendarPays): меняя
// одно, меняйте и другое.
import { formatDate, money, monthLabel, pluralRu, shiftYm } from './finlib';

// Проект «зарабатывает» — как на бэкенде (isEarningFinanceProject): не архивный
// и статус не в [lead, paused, done, archived]. Плановые доходы проектов на
// паузе не актуальны, пока проект не вернут в «Активный».
const NON_EARNING_PROJECT_STATUSES = new Set(['lead', 'paused', 'done', 'archived']);
export const isEarningProject = (p: any) => !!p && !p.archived && !NON_EARNING_PROJECT_STATUSES.has(p.status || 'active');

const DIR_LABEL: Record<string, string> = { smm: 'SMM', development: 'Development', design: 'Design', maintenance: 'Обслуживание' };
// Собрать список деталей операции (label/value), отбросив пустые.
const detailList = (rows: (({ label: string; value: any }) | null | false | undefined)[]) =>
  rows.filter((r): r is { label: string; value: any } => !!r && r.value != null && r.value !== '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

export interface PlanSources {
  /** Месяц календаря, 'YYYY-MM'. */
  calYm: string;
  /** Сегодня, 'YYYY-MM-DD'. */
  today: string;
  planned: any[];
  projects: any[];
  debts: any[];
  subscriptions: any[];
  /** expenseDetail('salary', calYm − 1): ЗП за прошлый месяц платим в этом. */
  salary: any;
  /** Операции журнала за месяц (все статусы). */
  txItems: any[];
  /** installmentsCalendar(calYm). */
  installments: any[];
}

/** Месяц плановой оплаты: по сроку, без срока — её месяц. */
const planYmOf = (p: any) => (p.dueDate ? String(p.dueDate).slice(0, 7) : (p.ym || ''));

/** Всё движение денег за месяц: приходы и расходы по дням. */
export function buildMonthItems(src: PlanSources): any[] {
  const { calYm, today } = src;
  const curYm = today.slice(0, 7);
  const salaryYm = shiftYm(calYm, -1);
  const lastDay = new Date(Number(calYm.slice(0, 4)), Number(calYm.slice(5, 7)), 0).getDate();
  const projById = new Map<string, any>(src.projects.map((p) => [p.id, p]));
  const debtById = new Map<string, any>(src.debts.map((d) => [d.id, d]));
  const txById = new Map<string, any>(src.txItems.map((t) => [t.id, t]));
  const items: any[] = [];

  // Операции, привязанные к полученным план-платежам — не дублируем в источнике 4.
  const linkedTxIds = new Set<string>();

  // 1. Плановые платежи: проект → доход, долг → расход. Показываем и expected
  // (не сделано), и received (сделано, приглушённо). Дата: dueDate; без неё —
  // долг на 10-е, проект — на день контракта проекта, иначе 1-е число.
  for (const p of src.planned) {
    if (p.status !== 'expected' && p.status !== 'received') continue;
    if (planYmOf(p) !== calYm) continue;
    const done = p.status === 'received';
    // Полученную оплату ставим на день, когда деньги ДЕЙСТВИТЕЛЬНО пришли, а
    // не на плановый срок: иначе приход 7-го висел на 1-м.
    const paidTx = done && p.receivedTxId ? txById.get(p.receivedTxId) : null;
    // 14.11.2026: деньги пришли в ДРУГОМ месяце (заплатили раньше срока или
    // позже) — там их и покажет сама операция (источник 4). Раньше такая
    // оплата считалась дважды: операцией в месяце прихода и «получено» здесь.
    // Полученное без операции («вне счёта») остаётся в своём месяце.
    if (done && p.receivedTxId && (!paidTx || paidTx.status === 'cancelled')) continue;
    if (p.receivedTxId) linkedTxIds.add(p.receivedTxId);
    let date = paidTx?.date ? String(paidTx.date).slice(0, 10)
      : (p.dueDate ? String(p.dueDate).slice(0, 10) : '');
    if (p.projectId) {
      const proj = projById.get(p.projectId);
      // Проект на паузе — ПЛАНОВЫЙ доход не актуален; уже полученный оставляем.
      if (!done && !isEarningProject(proj)) continue;
      if (!date) {
        const cday = proj?.contractDate ? Math.min(Number(String(proj.contractDate).slice(8, 10)) || 1, lastDay) : 1;
        date = `${calYm}-${pad(cday)}`;
      }
      items.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'income', status: 'completed', done,
        comment: proj?.name || 'Оплата по проекту', direction: proj?.direction ?? null,
        details: detailList([
          { label: 'Направление', value: proj ? (DIR_LABEL[proj.direction] || proj.direction) : null },
        ]) });
    } else if (p.debtId) {
      const debt = debtById.get(p.debtId);
      if (!date) {
        // День платежа долга — из настройки долга (по умолчанию 10-е).
        const dday = Math.min(Number(debt?.dueDay) || 10, lastDay);
        date = `${calYm}-${pad(dday)}`;
      }
      // Кредит или рассрочка банка (30.10.2026) — «Рассрочка», не «Долг».
      const bank = debt?.kind === 'bank';
      const debtName = debt?.name;
      items.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'expense', status: 'completed', done,
        // Настоящий долг отдают траншами, не помесячно (31.10.2026).
        comment: bank ? (debtName || 'Платёж банку') : (debtName ? `${debtName} · транш` : 'Транш долга'),
        details: detailList(bank ? [
          { label: 'Рассрочка', value: debtName },
          { label: 'Банк', value: debt?.counterparty },
          { label: 'Осталось банку', value: debt?.remaining != null ? money(Number(debt.remaining)) : null },
          { label: 'Платёж/мес', value: debt?.monthlyPayment ? money(Number(debt.monthlyPayment)) : null },
          { label: 'День оплаты', value: `${Number(debt?.dueDay) || 10}-го` },
        ] : [
          { label: 'Долг', value: debtName },
          { label: 'Осталось отдать', value: debt?.remaining != null ? money(Number(debt.remaining)) : null },
          { label: 'Вернуть до', value: debt?.dueDate ? new Date(String(debt.dueDate).slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'без срока' },
        ]) });
    }
  }
  // 1б. Долг со сроком «вернуть до» (03.11.2026): сумма вне траншей — в день
  // срока. Раньше такой долг в календаре не появлялся вовсе.
  for (const d of src.debts) {
    if (d.kind === 'bank' || !d.dueDate) continue;
    const due = String(d.dueDate).slice(0, 10);
    if (due.slice(0, 7) !== calYm) continue;
    const planned = src.planned
      .filter((p: any) => p.debtId === d.id && p.status === 'expected')
      .reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
    const left = r2(Number(d.remaining) - planned);
    if (!(left > 0.005)) continue;
    items.push({ id: `due-${d.id}`, date: due, amount: left, type: 'expense', status: 'completed', done: false,
      comment: `${d.name} · вернуть долг`,
      details: detailList([
        { label: 'Долг', value: d.name },
        { label: 'Осталось отдать', value: money(Number(d.remaining)) },
        { label: 'Вернуть до', value: formatDate(due) },
      ]) });
  }
  // 2. Аренда и подписки: активные, каждый месяц в день начала — с даты
  // начала (dueDate) до даты окончания (endDate). Оплаченный месяц — на
  // фактическую дату (paidMarks).
  for (const s of src.subscriptions) {
    if (!s.active) continue;
    const startYm = s.dueDate ? String(s.dueDate).slice(0, 7) : null;
    const endYmSub = s.endDate ? String(s.endDate).slice(0, 7) : null;
    if (startYm && calYm < startYm) continue;   // ещё не началась
    if (endYmSub && calYm > endYmSub) continue;  // уже закончилась
    // «Оплачено» = отметка paidMark ИЛИ фактическая оплата операциями
    // (транзакции с subscriptionId за этот месяц покрывают сумму подписки).
    const mark = (s.paidMarks || []).find((pm: any) => pm.ym === calYm);
    const subTx = src.txItems.filter((t: any) => t.subscriptionId === s.id && t.status !== 'cancelled');
    const paidViaTx = subTx.reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);
    const amount = Number(s.amount) || 0;
    const done = !!mark || paidViaTx >= amount - 0.005;
    // День платежа: заданный день месяца, иначе день начала подписки
    // («каждый месяц в день начала»), и только потом 1-е.
    const startDay = s.dueDate ? Number(String(s.dueDate).slice(8, 10)) : 0;
    const day = Math.min(Number(s.dueDay) || startDay || 1, lastDay);
    const lastPaid = subTx.length ? String(subTx[subTx.length - 1].date).slice(0, 10) : null;
    const paidDate = mark?.date ? String(mark.date).slice(0, 10) : lastPaid;
    const date = done && paidDate ? paidDate : `${calYm}-${pad(day)}`;
    if (s.endDate && !done && date > String(s.endDate).slice(0, 10)) continue; // позже окончания
    const details = detailList([
      { label: 'Категория', value: s.kind === 'rent' ? 'Аренда' : 'Подписка' },
      { label: 'Сумма/мес', value: money(amount) },
      { label: 'День оплаты', value: s.dueDay ? `${s.dueDay}-го` : null },
    ]);
    // 14.11.2026: оплачено частично — оплаченная часть на день оплаты (ушла),
    // в срок — только остаток, как «к оплате» на странице «Аренда и подписки».
    // Раньше вся сумма висела «ждём», а уже отданное нигде не считалось.
    if (!done && paidViaTx > 0.005) {
      items.push({ id: `subpaid-${s.id}`, date: lastPaid, amount: r2(paidViaTx), type: 'expense', status: 'completed',
        done: true, comment: `${s.name} · оплачено частично`, details });
    }
    items.push({ id: `sub-${s.id}`, date, amount: done ? amount : r2(amount - paidViaTx), type: 'expense',
      status: 'completed', done, comment: s.name, details });
  }
  // 3. Зарплата. Деньги уходят НЕ одним платежом 10-го: авансы и выплаты
  // разбросаны по месяцу. Показываем фактические выплаты на их днях (одной
  // строкой на день), а остаток обязательства — отдельной строкой впереди.
  const salCards = src.salary?.cards || {};
  const salToPay = Math.max(0, r2(Number(salCards.toPay || 0)));
  const salByDay = new Map<string, { sum: number; rows: { label: string; value: any }[] }>();
  for (const t of src.txItems) {
    if (t.status === 'cancelled' || t.type !== 'expense' || !t.employeeId) continue;
    const d = String(t.date || '').slice(0, 10);
    if (!d) continue;
    const cur = salByDay.get(d) || { sum: 0, rows: [] };
    cur.sum += Number(t.amount) || 0;
    cur.rows.push({ label: t.employeeName || t.comment || 'Выплата', value: money(Number(t.amount) || 0) });
    salByDay.set(d, cur);
  }
  for (const [d, v] of salByDay) {
    items.push({ id: `salpaid-${d}`, date: d, amount: r2(v.sum),
      type: 'expense', status: 'completed', done: d <= today, salaryYm,
      comment: v.rows.length > 1 ? `Зарплаты · ${pluralRu(v.rows.length, 'выплата', 'выплаты', 'выплат')}` : 'Зарплата',
      details: detailList([{ label: 'Всего за день', value: money(v.sum) }, ...v.rows]) });
  }
  if (salToPay > 0.005) {
    // Просроченный остаток не рисуем в прошлом: деньги, которые ещё не ушли,
    // уйдут начиная с сегодняшнего дня.
    const planned = `${calYm}-10`;
    const salDate = calYm === curYm && planned < today ? today : planned;
    const empCount = (src.salary?.rows || []).length;
    items.push({ id: `salary-${calYm}`, date: salDate, amount: salToPay, type: 'expense', status: 'completed', done: false,
      salaryYm, comment: `Зарплаты за ${monthLabel(salaryYm)} · осталось`,
      details: detailList([
        { label: 'За месяц', value: monthLabel(salaryYm, true) },
        { label: 'Сотрудников', value: empCount ? String(empCount) : null },
        { label: 'Фонд', value: salCards.fund ? money(Number(salCards.fund)) : null },
        { label: 'Уже выплачено', value: salCards.paid ? money(Number(salCards.paid)) : null },
        { label: 'Осталось доплатить', value: money(salToPay) },
        { label: 'Плановый день', value: `${monthLabel(calYm, true)}, 10-е` },
      ]) });
  }
  // 4. Прочие операции журнала за месяц (без привязки к ЗП/подписке/долгу/
  // полученному план-платежу). Прошедшие (≤ сегодня) — сделано, будущие — ждём.
  for (const t of src.txItems) {
    if (t.status === 'cancelled') continue;
    if (t.type !== 'income' && t.type !== 'expense') continue;
    if (t.employeeId || t.subscriptionId || t.debtId) continue;
    if (linkedTxIds.has(t.id)) continue; // уже показан как полученный план-платёж
    // Плановый доход проекта на паузе не актуален; фактический (прошедший) оставляем.
    const past = String(t.date || '').slice(0, 10) <= today;
    if (!past && t.projectId && !isEarningProject(projById.get(t.projectId))) continue;
    const txTitle = t.comment || t.categoryName || (t.type === 'income' ? 'Поступление' : 'Расход');
    items.push({ id: `tx-${t.id}`, date: t.date, amount: t.amount, type: t.type, status: 'completed', done: past,
      comment: txTitle,
      details: detailList([
        { label: 'Категория', value: t.categoryName },
        { label: 'Счёт', value: t.accountName },
        { label: 'Проект', value: t.projectId ? projById.get(t.projectId)?.name : null },
      ]) });
  }
  // 5. Прогноз повторяющегося дохода по SMM/обслуживанию на день договора —
  // текущий и будущие месяцы, где у проекта нет ни плана, ни поступления.
  if (calYm >= curYm) {
    const coveredProjIds = new Set<string>();
    for (const p of src.planned) {
      if (p.projectId && planYmOf(p) === calYm) coveredProjIds.add(p.projectId);
    }
    for (const t of src.txItems) {
      // Отменённая (удалённая) оплата месяц не закрывает (14.11.2026): иначе
      // после удаления ошибочной оплаты клиент пропадал из календаря.
      if (t.status === 'cancelled') continue;
      if (t.type === 'income' && t.projectId && String(t.date || '').slice(0, 7) === calYm) coveredProjIds.add(t.projectId);
    }
    for (const proj of projById.values()) {
      if (proj.direction !== 'smm' && proj.direction !== 'maintenance') continue;
      if (!isEarningProject(proj) || !(Number(proj.tariff) > 0)) continue;
      if (coveredProjIds.has(proj.id)) continue;
      const startYm = proj.contractDate ? String(proj.contractDate).slice(0, 7) : curYm;
      if (calYm < startYm) continue; // проект ещё не начался
      // Горизонт: срок вперёд от текущего месяца; «бессрочно» (null) = 12 мес.
      const horizonN = proj.retentionMonths != null ? Number(proj.retentionMonths) : 12;
      if (calYm > shiftYm(curYm, horizonN)) continue; // за пределом срока
      const cday = proj.contractDate ? Math.min(Number(String(proj.contractDate).slice(8, 10)) || 1, lastDay) : 1;
      items.push({ id: `fc-${proj.id}-${calYm}`, date: `${calYm}-${pad(cday)}`,
        amount: Number(proj.tariff), type: 'income', status: 'completed', done: false, comment: proj.name,
        direction: proj.direction,
        details: detailList([
          { label: 'Направление', value: DIR_LABEL[proj.direction] || proj.direction },
          { label: 'Прогноз', value: proj.retentionMonths ? `на ${proj.retentionMonths} мес. вперёд` : 'бессрочно (12 мес.)' },
        ]) });
    }
  }
  // 6. Рассрочки сотрудников. «Платит отдельно» — ожидаемый приход на свою
  // дату (просроченный — на сегодня). «Из зарплаты» и уже полученное —
  // пометка без влияния на деньги: полученное уже есть операцией в журнале.
  for (const x of src.installments) {
    const separate = x.method === 'separate';
    const late = x.status === 'overdue';
    const paidOff = x.status === 'done';
    const expected = separate && !paidOff;
    const date = late && x.date < today && calYm === curYm ? today : x.date;
    items.push({
      id: `inst-${x.key}`, date, amount: expected ? (Number(x.outstanding) || Number(x.amount)) : Number(x.amount),
      type: expected ? 'income' : 'note', status: 'completed',
      done: paidOff,
      comment: `Рассрочка · ${x.employeeName}${late ? ' · просрочено' : ''}`,
      installmentId: x.installmentId, installmentYm: x.ym, installmentMethod: x.method,
      details: detailList([
        { label: 'Что куплено', value: x.name },
        { label: 'Как возвращает', value: separate ? 'платит отдельно' : 'удерживаем из зарплаты' },
        { label: 'Срок', value: formatDate(x.date) },
        late ? { label: 'Статус', value: 'просрочено' } : paidOff ? { label: 'Статус', value: 'получено' } : null,
        { label: 'Остаток по рассрочке', value: money(Number(x.remaining) || 0) },
      ]) });
  }
  // Мелочь в одну строку: несколько мелких расходов за день (до 300 с.) —
  // одной строкой «Прочее · N операций», чтобы за ними было видно обязательства.
  const MINOR_MAX = 300;
  const byDate = new Map<string, any[]>();
  for (const it of items) {
    const d = String(it.date || '').slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(it);
  }
  const out: any[] = [];
  for (const [d, list] of byDate) {
    const minor = list.filter((x) => String(x.id).startsWith('tx-') && x.type === 'expense'
      && (Number(x.amount) || 0) <= MINOR_MAX);
    if (minor.length < 2) { out.push(...list); continue; }
    const rest = list.filter((x) => !minor.includes(x));
    const sum = minor.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    out.push(...rest);
    out.push({ id: `misc-${d}`, date: d, amount: r2(sum),
      type: 'expense', status: 'completed', done: minor.every((x) => x.done),
      comment: `Прочее · ${pluralRu(minor.length, 'операция', 'операции', 'операций')}`,
      details: detailList(minor.map((x) => ({ label: x.comment, value: money(Number(x.amount) || 0) }))) });
  }
  return out;
}

export interface LateSources {
  calYm: string;
  today: string;
  planned: any[];
  projects: any[];
  debts: any[];
  /** Строки SMM текущего месяца (incomeDirectionDetail('smm')). */
  smmRows: any[];
}

/** «Просрочено» за все месяцы (08.11.2026): не пришедшие оплаты клиентов и
 *  не отданные транши/платежи банкам из других месяцев. Подписки прошлых
 *  месяцев не берём: их оплату видно только по операциям того месяца. */
export function buildLateOther(src: LateSources): any[] {
  const { calYm, today } = src;
  const projById = new Map<string, any>(src.projects.map((p) => [p.id, p]));
  const debtById = new Map<string, any>(src.debts.map((d) => [d.id, d]));
  const out: any[] = [];
  for (const p of src.planned) {
    if (p.status !== 'expected') continue;
    const planYm = planYmOf(p);
    if (!planYm || planYm === calYm) continue;
    const [py, pm] = planYm.split('-').map(Number);
    const last = new Date(py, pm, 0).getDate();
    let date = p.dueDate ? String(p.dueDate).slice(0, 10) : '';
    if (p.projectId) {
      const proj = projById.get(p.projectId);
      if (!isEarningProject(proj)) continue;
      if (!date) {
        const cday = proj?.contractDate ? Math.min(Number(String(proj.contractDate).slice(8, 10)) || 1, last) : 1;
        date = `${planYm}-${pad(cday)}`;
      }
      if (date >= today) continue;
      out.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'income', status: 'completed', done: false,
        comment: proj?.name || 'Оплата по проекту', direction: proj?.direction ?? null,
        details: detailList([
          { label: 'Направление', value: proj ? (DIR_LABEL[proj.direction] || proj.direction) : null },
          { label: 'Срок был', value: formatDate(date) },
        ]) });
    } else if (p.debtId) {
      const debt = debtById.get(p.debtId);
      if (!date) date = `${planYm}-${pad(Math.min(Number(debt?.dueDay) || 10, last))}`;
      if (date >= today) continue;
      const bank = debt?.kind === 'bank';
      const debtName = debt?.name;
      out.push({ id: `pp-${p.id}`, date, amount: p.amount, type: 'expense', status: 'completed', done: false,
        comment: bank ? (debtName || 'Платёж банку') : (debtName ? `${debtName} · транш` : 'Транш долга'),
        details: detailList([
          { label: bank ? 'Рассрочка' : 'Долг', value: debtName },
          bank ? { label: 'Банк', value: debt?.counterparty } : null,
          { label: 'Срок был', value: formatDate(date) },
        ]) });
    }
  }
  // SMM-клиенты, не заплатившие в срок по дню договора (срок в другом месяце:
  // свой месяц уже есть в календаре строкой прогноза). Срок из сохранённого
  // плана (due.planned) не берём — этот план уже есть выше, иначе долг
  // клиента считался дважды (14.11.2026).
  for (const r of src.smmRows) {
    if (r?.due?.planned) continue;
    const due = r?.due?.date ? String(r.due.date).slice(0, 10) : '';
    const amount = Number(r?.overdue) || 0;
    if (!due || amount <= 0.005 || due >= today || due.slice(0, 7) === calYm) continue;
    out.push({ id: `smmdue-${r.project?.id}-${due}`, date: due, amount, type: 'income', status: 'completed', done: false,
      comment: r.project?.name || 'SMM-клиент',
      details: detailList([
        { label: 'Направление', value: 'SMM' },
        { label: 'Срок был', value: formatDate(due) },
        { label: 'Не оплачено', value: money(amount) },
      ]) });
  }
  return out;
}
