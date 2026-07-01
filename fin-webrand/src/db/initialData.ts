// Начальные данные агентства WebRand (соответствуют резервной копии
// webrand-backup-2026-07-01.json). Засеваются один раз при первом запуске
// вместе с категориями (см. seed.ts). Журнал операций (transactions) — пустой.

import type { Account, Client, Employee, Subscription, Debt, PlannedPayment } from './types';

export const INITIAL_ACCOUNTS: Account[] = [
  { id: 'id-s7hyzqa409476a', name: 'Alif', kind: 'bank', openingBalance: 1090, color: '#22c55e', order: 0 },
  { id: 'id-5e3ba6mo82a3c4', name: 'DC', kind: 'bank', openingBalance: 1644, color: '#f59e0b', order: 1 },
  { id: 'id-j3ath9cx9861a4', name: 'Наличные', kind: 'cash', openingBalance: 5500, color: '#94a3b8', order: 2 },
];

export const INITIAL_CLIENTS: Client[] = [
  { id: 'id-z7ouvxr58e2620', name: 'Серенак', group: 'smm', tariff: 3500, contractDate: '2026-06-30', status: 'active' },
  { id: 'id-zcfrfuoy5cab58', name: 'Оке Дем Центр', group: 'smm', tariff: 3500, contractDate: '2026-06-09', status: 'active' },
  { id: 'id-ed42lrxy2f728b', name: 'Клиника Насмин', group: 'smm', tariff: 3500, contractDate: '2026-06-26', status: 'active' },
  { id: 'id-o2xdgmsk035edb', name: 'Asan', group: 'smm', tariff: 2500, contractDate: '2026-06-01', status: 'active' },
  { id: 'id-a1d7f0p9c2c41c', name: 'Iram cinema', group: 'smm', tariff: 3500, contractDate: '2026-05-30', status: 'active' },
  { id: 'id-s1i7ln1m4be37f', name: 'Furug clinic', group: 'smm', tariff: 3000, contractDate: '2026-05-01', status: 'active' },
  { id: 'id-syrfo9rsec680d', name: 'Nozima clinic', group: 'smm', tariff: 2500, contractDate: '2026-05-06', status: 'active' },
  { id: 'id-hgv3pq183cb4d7', name: 'Mycom.tj', group: 'smm', tariff: 3100, contractDate: '2026-05-03', status: 'active' },
  { id: 'id-4kjhtx8p2b56a7', name: 'Tez zet', group: 'smm', tariff: 2300, contractDate: '2026-03-31', status: 'archived' },
  { id: 'id-grxqkq4r1552b0', name: 'Madadpharm', group: 'smm', tariff: 2250, contractDate: '2026-04-17', status: 'archived' },
  { id: 'id-kcci9d42fcde4d', name: 'Manilla Street', group: 'smm', tariff: 3000, contractDate: '2026-05-14', status: 'archived' },
  { id: 'id-ufm8ufef730c47', name: 'Shakl', group: 'smm', tariff: 2500, status: 'archived' },
  { id: 'id-upnk6ucdbe4c4e', name: 'Toj Iran', group: 'smm', tariff: 3000, status: 'archived' },
  { id: 'id-m1i9q46706bd85', name: 'Sorena Taile', group: 'smm', tariff: 3100, contractDate: '2026-04-06', status: 'archived' },
  { id: 'id-r168pt0e0a2440', name: 'Exclusive', group: 'smm', tariff: 3500, contractDate: '2026-05-06', status: 'archived' },
  { id: 'id-4ud6vktzc97cdd', name: 'Чармаи Бехор', group: 'smm', tariff: 3500, contractDate: '2026-04-30', status: 'archived' },
  { id: 'id-m52gurk2bf1808', name: 'Architech', group: 'smm', tariff: 0, status: 'archived' },
  { id: 'id-36pqeii9c0df67', name: 'Javonon', group: 'development', tariff: 25000, status: 'active' },
  { id: 'id-7nom7ie6537ee7', name: 'Arhideya', group: 'development', tariff: 20000, status: 'active' },
];

export const INITIAL_EMPLOYEES: Employee[] = [
  { id: 'id-qfwy3mfzddc999', name: 'Navruz Mardanov Shaymardanovich', salary: 4000, advance: 0, role: 'Руководитель SMM', hireDate: '2026-03-26', status: 'active' },
  { id: 'id-dhiqtdmj462eb7', name: 'Lashkarova Savribegim Eradzhevna', salary: 3000, advance: 0, role: 'Менеджер продаж (SMM)', hireDate: '2026-03-26', status: 'active' },
  { id: 'id-fv9ye2o7c7f120', name: 'Turazoda Muhammadamin Mahmad', salary: 3500, advance: 0, role: 'Разработчик', hireDate: '2026-03-26', status: 'active' },
  { id: 'id-9cd2ia11fe6a29', name: 'Mayunusova Farzona Firdavsovna', salary: 2500, advance: 0, role: 'Сторисмейкер', hireDate: '2026-03-26', status: 'active' },
  { id: 'id-9he116r983f294', name: 'Oyembekova Amina Ruslanovna', salary: 1500, advance: 0, role: 'Видеограф', hireDate: '2026-04-30', status: 'active' },
  { id: 'id-d038957hdfd0a0', name: 'Rozikova Khusnidabonu', salary: 3500, advance: 0, role: 'Дизайнер', hireDate: '2026-05-06', status: 'active' },
  { id: 'id-wdyailoedebc70', name: 'Sabrina Oblokulova', salary: 3000, advance: 1500, role: 'Менеджер продаж (Разработка)', hireDate: '2026-05-08', status: 'active' },
  { id: 'id-pgwc30kpf2880a', name: 'Khakimova Maryam Khurshedovna', salary: 1500, advance: 0, role: 'Организатор', hireDate: '2026-05-09', status: 'active' },
  { id: 'id-akh4w7iq947a81', name: 'Rabiev Mahmud', salary: 1500, advance: 500, role: 'Видеограф', hireDate: '2026-05-15', status: 'active' },
  { id: 'id-9e6iw4sz21185f', name: 'Boboev Azam', salary: 2000, advance: 0, role: 'Монтажёр', hireDate: '2026-06-01', status: 'active' },
  { id: 'id-0qw23eebc728a4', name: 'Mehriniso Saidova Kosimovna', salary: 0, advance: 0, role: 'SMM специалист', hireDate: '2026-06-01', status: 'active' },
  { id: 'id-lisi7awf1ea9e6', name: 'Behruz Mirov', salary: 5000, advance: 1000, role: 'Руководитель по видеографии', hireDate: '2026-06-11', status: 'active' },
  { id: 'id-02gjwm277cdef5', name: 'Zavkov Samad', salary: 1500, advance: 0, role: 'Видеограф', hireDate: '2026-06-12', status: 'active' },
];

export const INITIAL_SUBSCRIPTIONS: Subscription[] = [
  { id: 'id-r90xppva402b1b', name: 'Аренда офиса', amount: 6000, kind: 'rent', accountId: 'id-s7hyzqa409476a', active: true },
  { id: 'id-1r7itvd09d360a', name: 'Claude', amount: 2000, kind: 'subscription', accountId: 'id-s7hyzqa409476a', active: true },
  { id: 'id-zm2voiyjd373c9', name: 'Adobe', amount: 100, kind: 'subscription', accountId: 'id-s7hyzqa409476a', active: true },
  { id: 'id-ns9ooslwa9b58c', name: 'Capcut', amount: 500, kind: 'subscription', accountId: 'id-s7hyzqa409476a', active: true },
  { id: 'id-p4svk6qw00d345', name: 'Server', amount: 200, kind: 'subscription', accountId: 'id-s7hyzqa409476a', active: true },
];

export const INITIAL_DEBTS: Debt[] = [
  { id: 'id-8viis1et10b882', name: 'Камера (рассрочка)', totalAmount: 3500, paidBefore: 0, monthlyPayment: 3500, accountId: 'id-s7hyzqa409476a' },
  { id: 'id-kt0wgopb530329', name: 'Долг Мухаммаду', totalAmount: 1000, paidBefore: 0, monthlyPayment: 500, accountId: 'id-s7hyzqa409476a' },
];

export const INITIAL_PLANNED_PAYMENTS: PlannedPayment[] = [
  { id: 'id-pzygzs4tfc0df3', clientId: 'id-36pqeii9c0df67', ym: '2026-06', partNo: 1, amount: 15000, status: 'received' },
  { id: 'id-zytkwtcxc0b555', clientId: 'id-36pqeii9c0df67', ym: '2026-07', partNo: 1, amount: 5000, status: 'expected' },
  { id: 'id-ox0yq64n4436cf', clientId: 'id-36pqeii9c0df67', ym: '2026-08', partNo: 1, amount: 5000, status: 'expected' },
  { id: 'id-b0xphlmc7ce5f9', clientId: 'id-7nom7ie6537ee7', ym: '2026-06', partNo: 1, amount: 5000, status: 'received' },
  { id: 'id-bet3mhb692c781', clientId: 'id-7nom7ie6537ee7', ym: '2026-07', partNo: 1, amount: 10000, status: 'expected' },
  { id: 'id-srhzz763fe94f3', clientId: 'id-7nom7ie6537ee7', ym: '2026-08', partNo: 1, amount: 5000, status: 'expected' },
  { id: 'id-qh0qb1rx8866bf', clientId: 'id-zcfrfuoy5cab58', ym: '2026-06', partNo: 1, amount: 1750, status: 'received' },
  { id: 'id-e6giuzqe696244', clientId: 'id-o2xdgmsk035edb', ym: '2026-06', partNo: 1, amount: 2500, status: 'received' },
  { id: 'id-aa7kodlu4af4b0', clientId: 'id-a1d7f0p9c2c41c', ym: '2026-05', partNo: 1, amount: 3500, status: 'received' },
  { id: 'id-n5ohd3e0207983', clientId: 'id-s1i7ln1m4be37f', ym: '2026-05', partNo: 1, amount: 3000, status: 'received' },
  { id: 'id-mse7ivhsa46cd4', clientId: 'id-syrfo9rsec680d', ym: '2026-06', partNo: 1, amount: 1250, status: 'received' },
  { id: 'id-b4kwgszb1b9711', clientId: 'id-hgv3pq183cb4d7', ym: '2026-06', partNo: 1, amount: 1330, status: 'received' },
  { id: 'id-r7ummnivac6ff6', clientId: 'id-4kjhtx8p2b56a7', ym: '2026-03', partNo: 1, amount: 2200, status: 'received' },
  { id: 'id-dzg67u6z982a40', clientId: 'id-grxqkq4r1552b0', ym: '2026-04', partNo: 1, amount: 2250, status: 'received' },
  { id: 'id-s51l88he6acab0', debtId: 'id-8viis1et10b882', ym: '2026-06', partNo: 1, amount: 3500, status: 'expected' },
  { id: 'id-3vh7ujzn62d21a', debtId: 'id-kt0wgopb530329', ym: '2026-06', partNo: 1, amount: 500, status: 'expected' },
  { id: 'id-l07404xd29c4ac', debtId: 'id-kt0wgopb530329', ym: '2026-07', partNo: 1, amount: 500, status: 'expected' },
];
