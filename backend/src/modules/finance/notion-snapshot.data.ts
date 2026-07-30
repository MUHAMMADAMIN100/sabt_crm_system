// Снимок реальных данных финансов из Notion на 2026-07-07.
// Применяется FinanceService.seedNotionSnapshot() один раз: только пока в
// журнале нет ни одной транзакции (см. гвард в сервисе). Стартовые балансы
// подобраны так, чтобы startBalance + Σ(операций) дал точь-в-точь балансы
// Notion: Alif 2480.17, Dushanbe city 2714.21, Cash 500.

/** Счета: ключ → имя и стартовый остаток. */
export const NOTION_ACCOUNTS: Array<{ key: string; name: string; startBalance: number; color: string }> = [
  { key: 'alif',          name: 'Alif',          startBalance: 1090.17, color: '#22c55e' },
  { key: 'dushanbe_city', name: 'Dushanbe city', startBalance: 1644.21, color: '#f59e0b' },
  { key: 'cash',          name: 'Cash',          startBalance: -200,    color: '#94a3b8' },
];

/** Искажённые имена клиентов из старого сида → правильные из Notion. */
export const NOTION_PROJECT_RENAMES: Record<string, string> = {
  'Серенак': 'Сеченак',
  'Оке Дем Центр': 'Аке Нем Центр',
  'Клиника Насмин': 'Клиника Жасмин',
  'Чармаи Бехор': 'Чашмаи Дехот',
};

/** Проекты SMM точь-в-точь по таблице Notion (порядок = position).
 *  «не работаем» → archived. Javonon/Arhideya (development) не трогаем. */
export const NOTION_PROJECTS: Array<{
  name: string; tariff: number; contractDate: string | null; note: string | null; archived: boolean;
}> = [
  { name: 'Клиника Индотач', tariff: 3500, contractDate: '2026-07-04', note: '30 июля второй транш',                       archived: false },
  { name: 'Сеченак',         tariff: 3500, contractDate: '2026-06-30', note: '28 июля второй транш',                       archived: false },
  { name: 'Аке Нем Центр',   tariff: 3500, contractDate: '2026-06-09', note: '9 июля должны оплатить за июль',             archived: false },
  { name: 'Клиника Жасмин',  tariff: 3500, contractDate: '2026-06-26', note: '24 июля второй транш',                       archived: false },
  { name: 'Asan',            tariff: 2500, contractDate: '2026-06-01', note: 'за июль не оплачено',                        archived: false },
  { name: 'Iram cinema',     tariff: 3500, contractDate: '2026-06-02', note: null,                                         archived: false },
  { name: 'Furug clinic',    tariff: 3000, contractDate: '2026-05-01', note: 'за июль не оплачено',                        archived: false },
  { name: 'Tez zet',         tariff: 2300, contractDate: '2026-03-31', note: 'Закрыл за апрель, 1200 должен за это месяц', archived: true },
  { name: 'Mycom.tj',        tariff: 3100, contractDate: '2026-05-03', note: null,                                         archived: true },
  { name: 'Nozima clinic',   tariff: 2500, contractDate: '2026-05-06', note: null,                                         archived: true },
  { name: 'Madadpharm',      tariff: 2250, contractDate: '2026-04-17', note: null,                                         archived: true },
  { name: 'Manilla Street',  tariff: 3000, contractDate: '2026-05-14', note: null,                                         archived: true },
  { name: 'Shakl',           tariff: 2500, contractDate: null,         note: null,                                         archived: true },
  { name: 'Toj Iran',        tariff: 3000, contractDate: null,         note: null,                                         archived: true },
  { name: 'Sorena Taile',    tariff: 3100, contractDate: '2026-04-06', note: null,                                         archived: true },
  { name: 'Exclusive',       tariff: 3500, contractDate: '2026-05-06', note: null,                                         archived: true },
  { name: 'Чашмаи Дехот',    tariff: 3500, contractDate: '2026-04-30', note: null,                                         archived: true },
  { name: 'Architech',       tariff: 0,    contractDate: null,         note: 'Должен 1500',                                archived: true },
];

/** Сотрудники: ЗП = колонка June, аванс = колонка Avans из Notion. */
export const NOTION_EMPLOYEES: Array<{
  name: string; salary: number; advance: number; role: string; hireDate: string;
}> = [
  { name: 'Навруз Марданов Шаймарданович',    salary: 4000, advance: 700,  role: 'Руководитель SMM',             hireDate: '2026-03-26' },
  { name: 'Лашкарова Саврибегим Эраджевна',   salary: 3000, advance: 0,    role: 'Менеджер продаж (SMM)',        hireDate: '2026-03-26' },
  { name: 'Туразода Мухаммадамин Махмад',     salary: 3500, advance: 0,    role: 'Разработчик',                  hireDate: '2026-03-26' },
  { name: 'Маюнусова Фарзона Фирдавсовна',    salary: 2500, advance: 0,    role: 'Сторисмейкер',                 hireDate: '2026-03-26' },
  { name: 'Оембекова Амина Руслановна',       salary: 1500, advance: 500,  role: 'Видеограф',                    hireDate: '2026-04-30' },
  { name: 'Розикова Хуснидабону',             salary: 3500, advance: 500,  role: 'Дизайнер',                     hireDate: '2026-05-06' },
  { name: 'Сабрина Облокулова',                salary: 3000, advance: 2000, role: 'Менеджер продаж (Разработка)', hireDate: '2026-05-08' },
  { name: 'Хакимова Марьям Хуршедовна',        salary: 1500, advance: 0,    role: 'Организатор',                  hireDate: '2026-05-09' },
  { name: 'Рабиев Махмуд',                     salary: 1500, advance: 500,  role: 'Видеограф',                    hireDate: '2026-05-15' },
  { name: 'Бобоев Азам',                       salary: 2000, advance: 0,    role: 'Монтажёр',                     hireDate: '2026-06-01' },
  { name: 'Мехринисо Саидова Косимовна',       salary: 0,    advance: 0,    role: 'SMM специалист',               hireDate: '2026-06-01' },
  { name: 'Бехруз Миров',                      salary: 5000, advance: 1000, role: 'Руководитель по видеографии',  hireDate: '2026-06-11' },
  { name: 'Завков Самад',                      salary: 1500, advance: 200,  role: 'Видеограф',                    hireDate: '2026-06-12' },
];

/** Фактические суммы из старой помесячной зарплатной таблицы Notion.
 *
 * Это НЕ история ставок: в ячейке могла быть финальная выплата после аванса
 * или сумма с бонусом. Поэтому значения сохраняются только как исторический
 * факт выплаты и никогда не записываются в salaryHistory. Июнь и июль
 * намеренно отсутствуют — их учёт уже ведётся в CRM.
 *
 * Колонка «Initial payment» из исходной таблицы не импортируется: у неё нет
 * однозначного месяца, а выдумывать дату финансовой операции нельзя. */
export const NOTION_PAYROLL_HISTORY: Array<{
  name: string;
  paidByYm: Record<string, number>;
}> = [
  { name: 'Лашкарова Саврибегим Эраджевна', paidByYm: { '2026-03': 2800, '2026-04': 3400, '2026-05': 3000 } },
  { name: 'Маюнусова Фарзона Фирдавсовна', paidByYm: { '2026-03': 2500, '2026-04': 2500, '2026-05': 2500 } },
  { name: 'Туразода Мухаммадамин Махмад', paidByYm: { '2026-03': 1500, '2026-04': 2500, '2026-05': 3500 } },
  { name: 'Навруз Марданов Шаймарданович', paidByYm: { '2026-04': 3000, '2026-05': 4000 } },
  { name: 'Оембекова Амина Руслановна', paidByYm: { '2026-04': 1500, '2026-05': 1500 } },
  { name: 'Розикова Хуснидабону', paidByYm: { '2026-05': 2500 } },
  { name: 'Рабиев Махмуд', paidByYm: { '2026-05': 1500 } },
  { name: 'Сабрина Облокулова', paidByYm: { '2026-05': 2350 } },
  { name: 'Хакимова Марьям Хуршедовна', paidByYm: { '2026-05': 1500 } },
];

/** Ранние фиксированные ставки, которые владелец подтвердил отдельно от
 *  помесячных сумм выплат. */
export const NOTION_CONFIRMED_SALARY_HISTORY: Array<{
  name: string;
  effectiveYm: string;
  salary: number;
}> = [
  { name: 'Навруз Марданов Шаймарданович', effectiveYm: '2026-03', salary: 4_000 },
];

/** Журнал операций точь-в-точь по Notion (26 июня — 8 июля).
 *  account/from/to — ключи счетов; cat — [имя, тип] категории (null — без
 *  категории, как «Долг Мухаммаду» в Notion); project — клиент дохода SMM. */
export const NOTION_TRANSACTIONS: Array<{
  date: string; type: 'income' | 'expense' | 'transfer'; amount: number;
  account?: string; from?: string; to?: string;
  cat?: [string, 'income' | 'expense'] | null; project?: string; comment: string;
}> = [
  { date: '2026-06-26', type: 'income',   amount: 1500, account: 'alif',          cat: ['SMM', 'income'],           project: 'Клиника Жасмин',  comment: 'Клиника Жасмин — остаток 2к от 3500' },
  { date: '2026-06-30', type: 'income',   amount: 1750, account: 'cash',          cat: ['SMM', 'income'],           project: 'Аке Нем Центр',   comment: 'Оплата за Аке' },
  { date: '2026-06-30', type: 'income',   amount: 2100, account: 'cash',          cat: ['SMM', 'income'],           project: 'Сеченак',         comment: 'Оплата за Сеченак — Тариф 3500' },
  { date: '2026-06-30', type: 'expense',  amount: 1000, account: 'cash',          cat: ['Прочее', 'expense'],                                   comment: 'Фирузу оплата' },
  { date: '2026-07-01', type: 'expense',  amount: 500,  account: 'alif',          cat: ['Прочее', 'expense'],                                   comment: 'Аванс Сабрине' },
  { date: '2026-07-02', type: 'income',   amount: 3500, account: 'dushanbe_city', cat: ['SMM', 'income'],           project: 'Iram cinema',     comment: 'Ирам синема' },
  { date: '2026-07-02', type: 'income',   amount: 5500, account: 'cash',          cat: ['Прочее', 'income'],                                    comment: 'Долг от Мухаммада — Долг для компании' },
  { date: '2026-07-02', type: 'income',   amount: 1770, account: 'dushanbe_city', cat: ['SMM', 'income'],           project: 'Mycom.tj',        comment: 'Майком остаток' },
  { date: '2026-07-03', type: 'income',   amount: 450,  account: 'dushanbe_city', cat: ['SMM', 'income'],                                       comment: 'Бейби спа' },
  { date: '2026-07-03', type: 'expense',  amount: 50,   account: 'alif',          cat: ['Прочее', 'expense'],                                   comment: 'Railway — для деплоя бэкенд' },
  { date: '2026-07-04', type: 'expense',  amount: 1860, account: 'alif',          cat: ['Прочее', 'expense'],                                   comment: 'Подписка на клауд' },
  { date: '2026-07-04', type: 'expense',  amount: 700,  account: 'dushanbe_city', cat: ['Прочее', 'expense'],                                   comment: 'Аванс Навруз' },
  { date: '2026-07-04', type: 'expense',  amount: 750,  account: 'dushanbe_city', cat: ['Прочее', 'expense'],                                   comment: 'Аванс Хуснида' },
  { date: '2026-07-04', type: 'transfer', amount: 650,  from: 'cash', to: 'alif',                                                              comment: 'Трансфер' },
  { date: '2026-07-04', type: 'income',   amount: 800,  account: 'dushanbe_city', cat: ['SMM', 'income'],           project: 'Клиника Индотач', comment: 'Проект Индотач — У Мухаммада' },
  { date: '2026-07-04', type: 'income',   amount: 850,  account: 'alif',          cat: ['SMM', 'income'],           project: 'Клиника Индотач', comment: 'Проект Индотач — У Мухаммада' },
  { date: '2026-07-06', type: 'income',   amount: 1800, account: 'alif',          cat: ['Прочее', 'income'],                                    comment: 'Возврат заблокированного Клауд кода' },
  { date: '2026-07-06', type: 'expense',  amount: 1600, account: 'alif',          cat: ['Прочее', 'expense'],                                   comment: 'Покупка петлички' },
  { date: '2026-07-06', type: 'expense',  amount: 2000, account: 'cash',          cat: ['Прочее', 'expense'],                                   comment: 'Аренда офиса 2' },
  { date: '2026-07-06', type: 'expense',  amount: 4000, account: 'dushanbe_city', cat: ['Прочее', 'expense'],                                   comment: 'Аренда офиса 2' },
  { date: '2026-07-06', type: 'income',   amount: 1000, account: 'alif',          cat: ['Прочее', 'income'],                                    comment: 'Упаковка проекта iaf.tj — У Мухаммада' },
  { date: '2026-07-06', type: 'expense',  amount: 400,  account: 'alif',          cat: ['Реклама (ADS)', 'expense'],                            comment: 'На рекламу' },
  { date: '2026-07-07', type: 'expense',  amount: 5000, account: 'alif',          cat: null,                                                    comment: 'Долг Мухаммаду' },
  { date: '2026-07-08', type: 'transfer', amount: 5000, from: 'cash', to: 'alif',                                                              comment: 'Трансфер' },
];
