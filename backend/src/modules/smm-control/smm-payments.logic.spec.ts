import {
  CalPay, ClientOwner, FinClient, FinPlan, FinTx, calendarPays, cardPays, cleanHistory, managerOn, mayOwn,
  monthPayState, ownedPays, payScope, paymentItems, resolveFinanceLinks, toPayItem, withManagerChange,
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
    { id: 'f1', name: 'US2TJK', archived: false, direction: 'smm' },
    { id: 'f2', name: 'Остиум', archived: false, direction: 'smm' },
    { id: 'f3', name: 'Asan', archived: false, direction: 'smm' },
    { id: 'f4', name: 'Asan', archived: false, direction: 'smm' },
    { id: 'f5', name: 'Старый клиент', archived: true, direction: 'smm' },
  ];

  it('связывает по названию без учёта регистра, «ё» и знаков', () => {
    const links = resolveFinanceLinks([{ id: 'p1', name: 'us2tjk' }, { id: 'p2', name: 'ОСТИУМ!' }], clients);
    expect(links.get('p1')).toEqual({ client: clients[0], by: 'name' });
    expect(links.get('p2')).toEqual({ client: clients[1], by: 'name' });
  });

  it('порядок слов в названии не важен: «Доктор Манижа» и «Манижа Доктор» — один клиент', () => {
    const list = [{ id: 'f9', name: 'Доктор Манижа', archived: false, direction: 'smm' }, { id: 'f8', name: 'Остиум Умрона', archived: false, direction: 'smm' }];
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

  it('выбранного, но удалённого клиента ищет по названию', () => {
    const links = resolveFinanceLinks([{ id: 'p1', name: 'US2TJK', financeProjectId: 'нет-такого' }], clients);
    expect(links.get('p1')).toEqual({ client: clients[0], by: 'name' });
  });

  it('архивного клиента подхватывает, только если живого с таким названием нет — его прошлые деньги не теряются', () => {
    const list = [
      ...clients,
      { id: 'f6', name: 'Кофейня', archived: true, direction: 'smm' },
      { id: 'f7', name: 'Кофейня', archived: false, direction: 'smm' },
    ];
    const links = resolveFinanceLinks([{ id: 'p5', name: 'Старый клиент' }, { id: 'p6', name: 'Кофейня' }], list);
    expect(links.get('p5')).toEqual({ client: clients[4], by: 'name' });
    expect(links.get('p6')).toEqual({ client: list[6], by: 'name' });
  });

  it('по названию — только с клиентом SMM: проект «Alif» не берёт клиента разработки «Alif»', () => {
    const list = [{ id: 'dev', name: 'Alif', archived: false, direction: 'development' }];
    expect(resolveFinanceLinks([{ id: 'p', name: 'Alif' }], list).has('p')).toBe(false);
    // SMM-клиент «Alif» и клиент разработки «Alif» не делают название неоднозначным
    const both = [...list, { id: 'smm', name: 'Alif', archived: false, direction: 'smm' }];
    expect(resolveFinanceLinks([{ id: 'p', name: 'Alif' }], both).get('p')?.client.id).toBe('smm');
    // ручной выбор — по-прежнему любой клиент
    expect(resolveFinanceLinks([{ id: 'p', name: 'Alif', financeProjectId: 'dev' }], list).get('p')).toEqual({ client: list[0], by: 'manual' });
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
    // Сентябрь оплачен (якорь 14.09) — долга прошлого месяца нет.
    const items = pays({ cycleAnchor: '2026-09-14' }, [
      plan({ id: 'r', status: 'received', dueDate: '2026-10-14', paidAt: '2026-10-12', receivedTxId: 'linked' }),
    ], [tx({ id: 'linked', date: '2026-10-12' }), tx({ id: 'extra', date: '2026-10-03', amount: 700 }), tx({ id: 'salary', plain: false })]);
    expect(items.map(i => [i.key, i.state, i.amount])).toEqual([
      ['tx:extra', 'paid', 700],
      ['plan:r', 'paid', 4000],
    ]);
  });

  it('прогноз SMM: нет плана в месяце — тариф на день договора', () => {
    const items = pays({ contractDate: '2026-06-20', cycleAnchor: '2026-09-20' }, []);
    expect(items).toEqual([expect.objectContaining({ date: '2026-10-20', state: 'wait', amount: 4000, source: 'forecast' })]);
  });

  it('прогноз текущего месяца с прошедшим днём договора — просрочено', () => {
    const items = pays({ contractDate: '2026-06-05' }, []);
    expect(items.map(i => [i.date, i.state])).toEqual([['2026-10-05', 'late']]);
  });

  it('прогноза нет, если в месяце уже есть план или поступление', () => {
    expect(pays({ contractDate: '2026-06-20', cycleAnchor: '2026-09-20' }, [plan({ id: 'x', status: 'received', dueDate: '2026-10-20', paidAt: '2026-10-02' })]).map(i => i.source)).toEqual(['plan']);
    expect(pays({ contractDate: '2026-06-20', cycleAnchor: '2026-09-20' }, [], [tx({ date: '2026-10-02' })]).map(i => i.source)).toEqual(['tx']);
  });

  it('прогноз — не раньше начала договора и не дальше срока удержания', () => {
    expect(pays({ contractDate: '2026-11-03' }, [])).toEqual([]);
    const nov = calendarPays(client({ contractDate: '2026-06-20', retentionMonths: 0 } as any), [], [], '2026-11-01', '2026-11-30', TODAY);
    expect(nov.filter(i => i.date >= '2026-11-01')).toEqual([]);
  });

  it('прошлые месяцы не прогнозируем — там только факты и планы', () => {
    const sep = calendarPays(client({ contractDate: '2026-06-20', cycleAnchor: '2026-09-20' }), [], [], '2026-09-01', '2026-09-30', TODAY);
    expect(sep.filter(i => i.date < '2026-10-01')).toEqual([]);
  });

  it('разработка без планов: ничего не выдумываем', () => {
    expect(pays({ direction: 'development' }, [])).toEqual([]);
  });
});

describe('calendarPays — правила «Планирования» (14.11.2026)', () => {
  const NOV_FROM = '2026-11-01';
  const NOV_TO = '2026-11-30';

  it('не заплатил в октябре — 3 ноября долг ещё в «Просрочено», а не пропал 1-го числа', () => {
    // Сентябрь оплачен 5-го, за октябрь ни плана, ни денег.
    const items = calendarPays(client({ contractDate: '2026-06-05', cycleAnchor: '2026-09-05' }), [], [], NOV_FROM, NOV_TO, '2026-11-03');
    expect(items.map(i => [i.date, i.state, i.amount, i.source])).toEqual([
      ['2026-10-05', 'late', 4000, 'forecast'],
      ['2026-11-05', 'wait', 4000, 'forecast'],
    ]);
  });

  it('как в «Планировании»: с наступлением срока месяца остаётся один долг — текущий', () => {
    const items = calendarPays(client({ contractDate: '2026-06-05', cycleAnchor: '2026-09-05' }), [], [], NOV_FROM, NOV_TO, '2026-11-14');
    expect(items.map(i => [i.date, i.state])).toEqual([['2026-11-05', 'late']]);
  });

  it('просроченный план прошлого месяца не дублируется строкой по дню договора', () => {
    const items = calendarPays(client({ contractDate: '2026-06-05', cycleAnchor: '2026-09-05' }), [
      plan({ id: 'oct', ym: '2026-10', dueDate: '2026-10-05' }),
    ], [], NOV_FROM, NOV_TO, '2026-11-03');
    expect(items.map(i => [i.key, i.date, i.state])).toEqual([
      ['plan:oct', '2026-10-05', 'late'],
      ['fc:c1:2026-11', '2026-11-05', 'wait'],
    ]);
  });

  it('клиент на паузе — прошлый долг не показываем, как и в «Планировании»', () => {
    const items = calendarPays(client({ contractDate: '2026-06-05', cycleAnchor: '2026-09-05', status: 'paused' }), [], [], NOV_FROM, NOV_TO, '2026-11-03');
    expect(items).toEqual([]);
  });

  it('оплата отменённой (удалённой) операцией — не деньги', () => {
    // paidAt пуст: операция отменена, а связь с ней осталась.
    const items = calendarPays(client({ contractDate: '2026-06-20' }), [
      plan({ id: 'gone', ym: '2026-11', status: 'received', dueDate: '2026-11-03', paidAt: null, receivedTxId: 'cancelled-tx' }),
      plan({ id: 'cash', ym: '2026-10', status: 'received', dueDate: '2026-11-02', paidAt: null, receivedTxId: null, amount: 500 }),
    ], [], NOV_FROM, NOV_TO, '2026-11-14');
    expect(items.map(i => [i.key, i.state])).toEqual([['plan:cash', 'paid']]);
  });
});

describe('история менеджера: деньги — тому, кто вёл клиента в день оплаты', () => {
  it('без истории всё за текущим, как раньше', () => {
    expect(managerOn([], 'B', '2020-01-01')).toBe('B');
    expect(managerOn([], null, '2026-11-14')).toBeNull();
  });

  it('первая смена записывает и прежнего менеджера — его прошлое остаётся за ним', () => {
    const h = withManagerChange(undefined, 'A', 'B', '2026-11-15', '2026-06-01');
    expect(h).toEqual([{ managerId: 'A', from: '2026-06-01' }, { managerId: 'B', from: '2026-11-15' }]);
    expect(managerOn(h, 'B', '2026-05-01')).toBe('A');
    expect(managerOn(h, 'B', '2026-11-14')).toBe('A');
    expect(managerOn(h, 'B', '2026-11-15')).toBe('B');
  });

  it('первое назначение без прежнего менеджера: оплаты до него — его же (как при старом правиле)', () => {
    const h = withManagerChange(null, null, 'B', '2026-11-15');
    expect(h).toEqual([{ managerId: 'B', from: '2026-11-15' }]);
    expect(managerOn(h, 'B', '2026-11-01')).toBe('B');
  });

  it('тот же менеджер — история не меняется; сняли — после этого ничьё', () => {
    const h = withManagerChange(undefined, 'A', 'B', '2026-10-01', '2026-06-01');
    expect(withManagerChange(h, 'B', 'B', '2026-11-01')).toEqual(h);
    const off = withManagerChange(h, 'B', null, '2026-11-10');
    expect(managerOn(off, null, '2026-11-09')).toBe('B');
    expect(managerOn(off, null, '2026-11-10')).toBeNull();
  });

  it('мусор из базы отбрасывается, записи идут по датам', () => {
    expect(cleanHistory([{ managerId: 'B', from: '2026-11-15' }, { from: 'вчера' }, null, { managerId: 'A', from: '2026-06-01' }]))
      .toEqual([{ managerId: 'A', from: '2026-06-01' }, { managerId: 'B', from: '2026-11-15' }]);
    expect(cleanHistory('не массив')).toEqual([]);
  });

  it('смена посреди месяца: каждому — своё, ничего не теряется и не считается дважды', () => {
    const owner: ClientOwner = { current: 'B', live: true, history: withManagerChange(null, 'A', 'B', '2026-11-15', '2026-06-01') };
    const pays = calendarPays(client({ contractDate: '2026-06-03' }), [
      plan({ id: 'p1', ym: '2026-11', status: 'received', dueDate: '2026-11-03', paidAt: '2026-11-03', amount: 2000 }),
      plan({ id: 'p2', ym: '2026-11', partNo: 2, status: 'received', dueDate: '2026-11-18', paidAt: '2026-11-20', amount: 1500 }),
      plan({ id: 'p3', ym: '2026-11', partNo: 2, dueDate: '2026-11-25', amount: 500 }),
    ], [], '2026-11-01', '2026-11-30', '2026-11-21');
    const mine = (id: string) => ownedPays(pays, owner, m => m === id);
    expect(mine('A').map(i => [i.key, i.state])).toEqual([['plan:p1', 'paid']]);
    expect(mine('B').map(i => [i.key, i.state])).toEqual([['plan:p2', 'paid'], ['plan:p3', 'wait']]);
    const got = (id: string) => mine(id).filter(i => i.state === 'paid').reduce((s, i) => s + i.amount, 0);
    expect(got('A') + got('B')).toBe(3500);
    // бывший менеджер видит клиента, посторонний — нет
    expect(mayOwn(owner, m => m === 'A')).toBe(true);
    expect(mayOwn(owner, m => m === 'C')).toBe(false);
  });
});

describe('payScope — чей клиент «Финансов»', () => {
  const fin = (over: any) => ({ archived: false, direction: 'smm', salesManagerId: null, salesManagerHistory: null, ...over });
  const proj = (over: any) => ({ live: true, managerId: null, financeProjectId: null, ...over });

  it('CRM «Alif» (SMM) и клиент разработки «Alif»: деньги разработки — только менеджеру разработки', () => {
    const scope = payScope(
      [proj({ id: 'crm', name: 'Alif', managerId: 'smm-mgr' })],
      [fin({ id: 'f-smm', name: 'Alif' }), fin({ id: 'f-dev', name: 'Alif', direction: 'development', salesManagerId: 'dev-mgr' })],
    );
    expect(scope.get('f-smm')).toMatchObject({ projectId: 'crm', owner: { current: 'smm-mgr' } });
    expect(scope.get('f-dev')).toMatchObject({ projectId: null, name: 'Alif', owner: { current: 'dev-mgr' } });
  });

  it('у клиента несколько проектов: ручная связь важнее названия, живой — архивного', () => {
    const scope = payScope([
      proj({ id: 'old', name: 'Chrono', live: false, managerId: 'A' }),
      proj({ id: 'new', name: 'Chrono', managerId: 'B' }),
      proj({ id: 'manual', name: 'Другое имя', financeProjectId: 'f1', managerId: 'C' }),
    ], [fin({ id: 'f1', name: 'Chrono' })]);
    expect(scope.get('f1')?.projectId).toBe('manual');
    const noManual = payScope([
      proj({ id: 'old', name: 'Chrono', live: false, managerId: 'A' }),
      proj({ id: 'new', name: 'Chrono', managerId: 'B' }),
    ], [fin({ id: 'f1', name: 'Chrono' })]);
    expect(noManual.get('f1')?.projectId).toBe('new');
  });

  it('SMM-клиент без проекта CRM — ничей; история у клиента не из SMM — своя', () => {
    const scope = payScope([], [
      fin({ id: 'lonely', name: 'Без проекта', salesManagerId: 'A' }),
      fin({ id: 'site', name: 'Сайт', direction: 'maintenance', salesManagerId: 'B', salesManagerHistory: [{ managerId: 'A', from: '2026-01-01' }, { managerId: 'B', from: '2026-11-01' }] }),
    ]);
    expect(scope.has('lonely')).toBe(false);
    const site = scope.get('site');
    expect(site && managerOn(site.owner.history, 'B', '2026-10-20')).toBe('A');
  });

  it('архивный проект и архивный клиент: прошлые деньги остаются за менеджером, новых сроков нет', () => {
    const c = { ...client({ id: 'f-old', name: 'Ушедший', archived: true, contractDate: '2026-06-05' }), salesManagerId: null, salesManagerHistory: null };
    const scope = payScope([proj({ id: 'crm-old', name: 'Ушедший', live: false, managerId: 'A' })], [c]);
    const x = scope.get('f-old');
    expect(x?.owner).toMatchObject({ current: 'A', live: false });
    const pays = calendarPays(c, [
      plan({ id: 'got', projectId: 'f-old', ym: '2026-10', status: 'received', dueDate: '2026-10-05', paidAt: '2026-10-06' }),
      plan({ id: 'left', projectId: 'f-old', ym: '2026-11', dueDate: '2026-11-05' }),
    ], [], '2026-10-01', '2026-11-30', '2026-11-14');
    expect(ownedPays(pays, x?.owner as ClientOwner, m => m === 'A').map(i => [i.key, i.state])).toEqual([['plan:got', 'paid']]);
  });

  it('архивный проект CRM у живого клиента: ожидаемое ему не показываем, полученное — да', () => {
    const owner: ClientOwner = { current: 'A', history: [], live: false };
    const items = [
      { state: 'paid' as const, date: '2026-11-02' },
      { state: 'late' as const, date: '2026-11-05' },
    ];
    expect(ownedPays(items, owner, m => m === 'A')).toEqual([items[0]]);
  });
});

describe('одно правило сроков на всех экранах (договор 5-го, октябрь оплачен 20-го, плана на ноябрь нет)', () => {
  const TODAY_NOV = '2026-11-14';
  const c = client({ contractDate: '2026-08-05', cycleAnchor: '2026-10-20' });
  const plans = [plan({ id: 'oct', ym: '2026-10', status: 'received', dueDate: '2026-10-05', paidAt: '2026-10-20', receivedTxId: 't-oct' })];
  const txs: FinTx[] = [{ id: 't-oct', projectId: 'c1', date: '2026-10-20', amount: 4000, plain: true }];
  const nov = calendarPays(c, plans, txs, '2026-11-01', '2026-11-30', TODAY_NOV);
  const oct = calendarPays(c, plans, txs, '2026-10-01', '2026-10-31', TODAY_NOV);

  it('«Панель» и «Планирование»: ноябрь — прогноз на 5-е, просрочен; октябрь — получено 20-го', () => {
    expect(nov.map(i => [i.date, i.state, i.amount, i.source])).toEqual([['2026-11-05', 'late', 4000, 'forecast']]);
    // в окне октября — полученное; ноябрьский долг приходит и сюда — для «Просрочено»
    expect(oct.map(i => [i.date, i.state, i.amount])).toEqual([['2026-10-20', 'paid', 4000], ['2026-11-05', 'late', 4000]]);
  });

  it('карточка проекта: ближайшее — 5 ноября, просрочено', () => {
    const card = cardPays(calendarPays(c, plans, txs, '2026-11-07', '2027-11-30', TODAY_NOV), TODAY_NOV);
    expect(card.next).toMatchObject({ date: '2026-11-05', state: 'late' });
    expect(card.lastPaid).toBeNull();
  });

  it('«Календарь»: те же дни; полученная — в день прихода денег, а не в срок', () => {
    expect(nov.map(toPayItem)).toEqual([{ key: 'fc:c1:2026-11', date: '2026-11-05', dueDate: '2026-11-05', partNo: 1, state: 'late', paidAt: null }]);
    expect(oct.filter(i => i.date <= '2026-10-31').map(toPayItem))
      .toEqual([expect.objectContaining({ date: '2026-10-20', state: 'paid', paidAt: '2026-10-20' })]);
  });

  it('«Контроль»: ноябрь — просрочено, октябрь — оплачено', () => {
    expect(monthPayState(nov, '2026-11-01', '2026-11-30')).toBe('late');
    expect(monthPayState(oct, '2026-10-01', '2026-10-31')).toBe('paid');
  });
});

describe('карточка и «Контроль» по одним оплатам', () => {
  const pay = (over: Partial<CalPay>): CalPay => ({
    key: 'k', clientId: 'c1', date: '2026-11-10', ym: '2026-11', amount: 1, partNo: 1, state: 'wait', source: 'plan', ...over,
  });

  it('карточка: оплата за последнюю неделю — «оплачено», старше — нет', () => {
    expect(cardPays([pay({ key: 'a', state: 'paid', date: '2026-11-10' })], '2026-11-14').lastPaid?.key).toBe('a');
    expect(cardPays([pay({ key: 'a', state: 'paid', date: '2026-11-01' })], '2026-11-14').lastPaid).toBeNull();
  });

  it('«Контроль»: ждём оплату месяца; нечего показать — пусто; долг прошлого месяца — «просрочено»', () => {
    expect(monthPayState([pay({ state: 'paid', date: '2026-11-02' }), pay({ state: 'wait', date: '2026-11-20' })], '2026-11-01', '2026-11-30')).toBe('wait');
    expect(monthPayState([], '2026-11-01', '2026-11-30')).toBeNull();
    expect(monthPayState([pay({ state: 'late', date: '2026-10-05' })], '2026-11-01', '2026-11-30')).toBe('late');
  });
});
