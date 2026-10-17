import {
  FinClient, FinPlan, FinTx, calendarPays, paymentItems, resolveFinanceLinks,
} from './smm-payments.logic';

// Сроки оплаты SMM-клиентов для менеджеров (решение владельца 12.10.2026):
// источник — плановые оплаты «Финансов». Проверяем, что менеджер видит то же,
// что владелец: просроченное, сегодняшнее, ближайшее и недавно оплаченное.

const TODAY = '2026-10-13';

const client = (over: Partial<FinClient> = {}): FinClient => ({
  id: 'c1', name: 'US2TJK', direction: 'smm', tariff: 4000,
  contractDate: '2026-06-14', cycleAnchor: null, archived: false, status: 'active', ...over,
});
let seq = 0;
const plan = (over: Partial<FinPlan> = {}): FinPlan => ({
  id: `p${++seq}`, projectId: 'c1', ym: '2026-10', partNo: 1, status: 'expected',
  dueDate: '2026-10-14', amount: 4000, paidAt: null, ...over,
});

describe('paymentItems — что видит менеджер', () => {
  it('ожидаемая оплата: впереди — «ждём», сегодня — «сегодня», прошла — «просрочено»', () => {
    const items = paymentItems(client(), [
      plan({ id: 'a', dueDate: '2026-10-20' }),
      plan({ id: 'b', dueDate: TODAY }),
      plan({ id: 'c', dueDate: '2026-10-09', ym: '2026-10' }),
    ], TODAY);
    expect(items.map(i => [i.dueDate, i.state])).toEqual([
      ['2026-10-09', 'late'],
      [TODAY, 'today'],
      ['2026-10-20', 'wait'],
    ]);
  });

  it('оплата, полученная за последнюю неделю, видна как «оплачено», более старая — нет', () => {
    const items = paymentItems(client(), [
      plan({ id: 'fresh', status: 'received', dueDate: '2026-10-10', paidAt: '2026-10-10' }),
      plan({ id: 'old', status: 'received', dueDate: '2026-09-14', ym: '2026-09', paidAt: '2026-09-14' }),
      plan({ id: 'next', dueDate: '2026-11-10', ym: '2026-11' }),
    ], TODAY);
    expect(items.map(i => [i.key, i.state])).toEqual([
      ['plan:next', 'wait'],
      ['plan:fresh', 'paid'],
    ]);
    expect(items[1].paidAt).toBe('2026-10-10');
  });

  it('частичная оплата: аванс «оплачено» и остаток вторым сроком', () => {
    const items = paymentItems(client(), [
      plan({ id: 'adv', status: 'received', amount: 2000, dueDate: '2026-10-08', paidAt: '2026-10-08' }),
      plan({ id: 'rest', partNo: 2, amount: 2000, dueDate: '2026-10-23' }),
    ], TODAY);
    expect(items.map(i => [i.partNo, i.state, i.dueDate])).toEqual([
      [2, 'wait', '2026-10-23'],
      [1, 'paid', '2026-10-08'],
    ]);
  });

  it('клиент на паузе, в архиве или лид — оплат менеджеру не показываем', () => {
    const plans = [plan({ dueDate: '2026-10-09' })];
    expect(paymentItems(client({ status: 'paused' }), plans, TODAY)).toEqual([]);
    expect(paymentItems(client({ archived: true }), plans, TODAY)).toEqual([]);
    expect(paymentItems(client({ status: 'lead' }), plans, TODAY)).toEqual([]);
  });

  it('чужие планы не подмешиваются', () => {
    const items = paymentItems(client({ cycleAnchor: '2026-09-14' }), [plan({ projectId: 'other', dueDate: '2026-10-09' })], TODAY);
    // своих ожидаемых нет — срабатывает срок по дню последней полной оплаты (14-е число)
    expect(items.map(i => [i.dueDate, i.state])).toEqual([['2026-10-14', 'wait']]);
  });

  describe('новый клиент без плановых оплат — срок по дню договора', () => {
    it('договор впереди: первая оплата в день договора', () => {
      const items = paymentItems(client({ contractDate: '2026-10-20' }), [], TODAY);
      expect(items).toEqual([expect.objectContaining({ dueDate: '2026-10-20', state: 'wait', partNo: 1 })]);
    });

    it('договор подписан, а оплаты не было — просрочено с дня договора', () => {
      const items = paymentItems(client({ contractDate: '2026-09-25' }), [], TODAY);
      expect(items).toEqual([expect.objectContaining({ dueDate: '2026-09-25', state: 'late' })]);
    });

    it('срок в день договора — «сегодня»', () => {
      const items = paymentItems(client({ contractDate: TODAY }), [], TODAY);
      expect(items).toEqual([expect.objectContaining({ dueDate: TODAY, state: 'today' })]);
    });

    it('цикл закрыт оплатой — следующий срок через месяц от неё', () => {
      const items = paymentItems(client({ cycleAnchor: '2026-10-05' }), [], TODAY);
      expect(items).toEqual([expect.objectContaining({ dueDate: '2026-11-05', state: 'wait' })]);
    });

    it('31-е число в коротком месяце переносится на его последний день', () => {
      const items = paymentItems(client({ contractDate: '2026-01-31', cycleAnchor: '2027-01-31' }), [], '2027-02-10');
      expect(items).toEqual([expect.objectContaining({ dueDate: '2027-02-28', state: 'wait' })]);
    });

    it('без тарифа или без даты договора срока нет', () => {
      expect(paymentItems(client({ tariff: 0 }), [], TODAY)).toEqual([]);
      expect(paymentItems(client({ contractDate: null }), [], TODAY)).toEqual([]);
    });

    it('клиент не SMM-направления: по дню договора срок не считаем', () => {
      expect(paymentItems(client({ direction: 'development' }), [], TODAY)).toEqual([]);
    });
  });
});

describe('resolveFinanceLinks — какой клиент «Финансов» у проекта', () => {
  const clients = [
    { id: 'f1', name: 'US2TJK', archived: false },
    { id: 'f2', name: 'Остиум', archived: false },
    { id: 'f3', name: 'Asan', archived: false },
    { id: 'f4', name: 'Asan', archived: false },
    { id: 'f5', name: 'Старый клиент', archived: true },
  ];

  it('связывает по названию без учёта регистра, «ё» и знаков', () => {
    const links = resolveFinanceLinks([{ id: 'p1', name: 'us2tjk' }, { id: 'p2', name: 'ОСТИУМ!' }], clients);
    expect(links.get('p1')).toEqual({ client: clients[0], by: 'name' });
    expect(links.get('p2')).toEqual({ client: clients[1], by: 'name' });
  });

  it('порядок слов в названии не важен: «Доктор Манижа» и «Манижа Доктор» — один клиент', () => {
    const list = [{ id: 'f9', name: 'Доктор Манижа', archived: false }, { id: 'f8', name: 'Остиум Умрона', archived: false }];
    const links = resolveFinanceLinks([{ id: 'p9', name: 'Манижа Доктор' }, { id: 'p8', name: 'Остиум' }], list);
    expect(links.get('p9')).toEqual({ client: list[0], by: 'name' });
    // другое название — не связываем, даже если одно слово общее
    expect(links.has('p8')).toBe(false);
  });

  it('два клиента с одним названием не связывает — нужен выбор владельца', () => {
    const links = resolveFinanceLinks([{ id: 'p3', name: 'Asan' }], clients);
    expect(links.has('p3')).toBe(false);
  });

  it('выбор владельца важнее названия и снимает неоднозначность', () => {
    const links = resolveFinanceLinks([
      { id: 'p3', name: 'Asan', financeProjectId: 'f4' },
      { id: 'p1', name: 'US2TJK', financeProjectId: 'f2' },
    ], clients);
    expect(links.get('p3')).toEqual({ client: clients[3], by: 'manual' });
    expect(links.get('p1')).toEqual({ client: clients[1], by: 'manual' });
  });

  it('архивного клиента по названию не подхватывает; выбранного, но удалённого — ищет по названию', () => {
    const links = resolveFinanceLinks([
      { id: 'p5', name: 'Старый клиент' },
      { id: 'p1', name: 'US2TJK', financeProjectId: 'нет-такого' },
    ], clients);
    expect(links.has('p5')).toBe(false);
    expect(links.get('p1')).toEqual({ client: clients[0], by: 'name' });
  });
});

describe('calendarPays — деньги в календаре менеджера, как в «Планировании»', () => {
  const FROM = '2026-10-01';
  const TO = '2026-10-31';
  const tx = (over: Partial<FinTx> = {}): FinTx => ({ id: 't1', projectId: 'c1', date: '2026-10-05', amount: 2000, plain: true, ...over });
  const pays = (c: Partial<FinClient> & { retentionMonths?: number | null }, ps: FinPlan[], ts: FinTx[] = []) =>
    calendarPays(client(c), ps, ts, FROM, TO, TODAY);

  it('ждём, сегодня, получено — с суммами; полученная стоит в день прихода денег', () => {
    const items = pays({}, [
      plan({ id: 'w', dueDate: '2026-10-25', amount: 3500 }),
      plan({ id: 't', dueDate: TODAY, amount: 3000 }),
      plan({ id: 'p', status: 'received', dueDate: '2026-10-06', paidAt: '2026-10-07', amount: 5500 }),
    ]);
    expect(items.map(i => [i.date, i.state, i.amount])).toEqual([
      ['2026-10-07', 'paid', 5500],
      [TODAY, 'today', 3000],
      ['2026-10-25', 'wait', 3500],
    ]);
  });

  it('просроченная из прошлого месяца приходит и вне окна — для «Просрочено»', () => {
    const items = pays({}, [plan({ id: 'old', ym: '2026-09', dueDate: '2026-09-23', amount: 5500 })]);
    // Октябрь без плана — прогноз по тарифу, как у владельца.
    expect(items.map(i => [i.date, i.state, i.amount, i.source])).toEqual([
      ['2026-09-23', 'late', 5500, 'plan'],
      ['2026-10-14', 'wait', 4000, 'forecast'],
    ]);
  });

  it('план без срока — в день договора своего месяца', () => {
    const items = pays({ contractDate: '2026-06-14' }, [plan({ id: 'n', dueDate: null, ym: '2026-10' })]);
    expect(items.map(i => [i.date, i.state])).toEqual([['2026-10-14', 'wait']]);
  });

  it('клиент на паузе: ожидаемые и прогноз не показываем, полученные — да', () => {
    const items = pays({ status: 'paused' }, [
      plan({ id: 'e', dueDate: '2026-10-09' }),
      plan({ id: 'r', status: 'received', dueDate: '2026-10-02', paidAt: '2026-10-02' }),
    ]);
    expect(items.map(i => i.key)).toEqual(['plan:r']);
  });

  it('поступление без плана — «получено»; привязанное к плану второй раз не идёт', () => {
    const items = pays({}, [
      plan({ id: 'r', status: 'received', dueDate: '2026-10-14', paidAt: '2026-10-12', receivedTxId: 'linked' }),
    ], [tx({ id: 'linked', date: '2026-10-12' }), tx({ id: 'extra', date: '2026-10-03', amount: 700 }), tx({ id: 'salary', plain: false })]);
    expect(items.map(i => [i.key, i.state, i.amount])).toEqual([
      ['tx:extra', 'paid', 700],
      ['plan:r', 'paid', 4000],
    ]);
  });

  it('прогноз SMM: нет плана в месяце — тариф на день договора', () => {
    const items = pays({ contractDate: '2026-06-20' }, []);
    expect(items).toEqual([expect.objectContaining({ date: '2026-10-20', state: 'wait', amount: 4000, source: 'forecast' })]);
  });

  it('прогноз текущего месяца с прошедшим днём договора — просрочено', () => {
    const items = pays({ contractDate: '2026-06-05' }, []);
    expect(items.map(i => [i.date, i.state])).toEqual([['2026-10-05', 'late']]);
  });

  it('прогноза нет, если в месяце уже есть план или поступление', () => {
    expect(pays({ contractDate: '2026-06-20' }, [plan({ id: 'x', status: 'received', dueDate: '2026-10-20', paidAt: '2026-10-02' })]).map(i => i.source)).toEqual(['plan']);
    expect(pays({ contractDate: '2026-06-20' }, [], [tx({ date: '2026-10-02' })]).map(i => i.source)).toEqual(['tx']);
  });

  it('прогноз — не раньше начала договора и не дальше срока удержания', () => {
    expect(pays({ contractDate: '2026-11-03' }, [])).toEqual([]);
    const nov = calendarPays(client({ contractDate: '2026-06-20', retentionMonths: 0 } as any), [], [], '2026-11-01', '2026-11-30', TODAY);
    expect(nov.filter(i => i.date >= '2026-11-01')).toEqual([]);
  });

  it('прошлые месяцы не прогнозируем — там только факты и планы', () => {
    const sep = calendarPays(client({ contractDate: '2026-06-20' }), [], [], '2026-09-01', '2026-09-30', TODAY);
    expect(sep.filter(i => i.date < '2026-10-01')).toEqual([]);
  });

  it('разработка без планов: ничего не выдумываем', () => {
    expect(pays({ direction: 'development' }, [])).toEqual([]);
  });
});
