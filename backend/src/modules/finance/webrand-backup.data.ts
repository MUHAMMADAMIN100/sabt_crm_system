/* eslint-disable */
// АВТО-СГЕНЕРИРОВАНО из fin-webrand/webrand-backup-2026-07-01.json.
// Встроенный сид-снимок WebRand, чтобы посев БД работал на проде (Railway),
// где корневой файл fin-webrand/*.json отсутствует в деплое бэкенда.
// Используется в FinanceService.readWebRandBackup(). Только для первичного
// посева пустых таблиц — существующие данные не затираются.

export const WEBRAND_BACKUP: any = {
  "__meta": {
    "dbName": "fin_web_system",
    "dbVersion": 20,
    "exportedAt": "2026-07-01T07:20:07.529Z",
    "note": "Полный дамп всех данных фин-системы WebRand. Совместим с кнопкой «Импорт JSON» в Настройках."
  },
  "accounts": [
    {
      "id": "id-s7hyzqa409476a",
      "name": "Alif",
      "kind": "bank",
      "openingBalance": 1090,
      "color": "#22c55e",
      "order": 0
    },
    {
      "id": "id-5e3ba6mo82a3c4",
      "name": "DC",
      "kind": "bank",
      "openingBalance": 1644,
      "color": "#f59e0b",
      "order": 1
    },
    {
      "id": "id-j3ath9cx9861a4",
      "name": "Наличные",
      "kind": "cash",
      "openingBalance": 5500,
      "color": "#94a3b8",
      "order": 2
    }
  ],
  "categories": [
    {
      "id": "cat-smm",
      "name": "SMM",
      "kind": "income",
      "icon": "smm",
      "color": "#16a34a",
      "order": 0
    },
    {
      "id": "cat-smm-part1",
      "name": "SMM часть 1",
      "kind": "income",
      "icon": "smm",
      "color": "#16a34a",
      "order": 1
    },
    {
      "id": "cat-smm-part2",
      "name": "SMM часть 2",
      "kind": "income",
      "icon": "smm",
      "color": "#22c55e",
      "order": 2
    },
    {
      "id": "cat-development",
      "name": "Development",
      "kind": "income",
      "icon": "development",
      "color": "#0ea5e9",
      "order": 3
    },
    {
      "id": "cat-design",
      "name": "Design",
      "kind": "income",
      "icon": "design",
      "color": "#a855f7",
      "order": 4
    },
    {
      "id": "cat-debt-repay",
      "name": "Возврат долга",
      "kind": "income",
      "icon": "plus",
      "color": "#14b8a6",
      "order": 5
    },
    {
      "id": "cat-other-income",
      "name": "Прочее",
      "kind": "income",
      "icon": "dots",
      "color": "#64748b",
      "order": 6
    },
    {
      "id": "cat-salary",
      "name": "Зарплата",
      "kind": "expense",
      "icon": "salary",
      "color": "#f97316",
      "order": 7
    },
    {
      "id": "cat-ads",
      "name": "Реклама (ADS)",
      "kind": "expense",
      "icon": "target",
      "color": "#ef4444",
      "order": 8
    },
    {
      "id": "cat-rent",
      "name": "Аренда",
      "kind": "expense",
      "icon": "building",
      "color": "#e11d48",
      "order": 9
    },
    {
      "id": "cat-subscription",
      "name": "Подписки",
      "kind": "expense",
      "icon": "transactions",
      "color": "#d946ef",
      "order": 10
    },
    {
      "id": "cat-transport",
      "name": "Транспорт",
      "kind": "expense",
      "icon": "car",
      "color": "#0891b2",
      "order": 11
    },
    {
      "id": "cat-print",
      "name": "Печать",
      "kind": "expense",
      "icon": "printer",
      "color": "#7c3aed",
      "order": 12
    },
    {
      "id": "cat-taxes",
      "name": "Налоги",
      "kind": "expense",
      "icon": "percent",
      "color": "#b45309",
      "order": 13
    },
    {
      "id": "cat-debt",
      "name": "Долг",
      "kind": "expense",
      "icon": "receipt",
      "color": "#d97706",
      "order": 14
    },
    {
      "id": "cat-other-expense",
      "name": "Прочее",
      "kind": "expense",
      "icon": "dots",
      "color": "#64748b",
      "order": 15
    },
    {
      "id": "cat-half-repayment",
      "name": "Half Repayment",
      "kind": "saving",
      "icon": "income",
      "color": "#7c3aed",
      "order": 16
    }
  ],
  "transactions": [],
  "clients": [
    {
      "id": "id-z7ouvxr58e2620",
      "name": "Серенак",
      "group": "smm",
      "tariff": 3500,
      "contractDate": "2026-06-30",
      "status": "active"
    },
    {
      "id": "id-zcfrfuoy5cab58",
      "name": "Оке Дем Центр",
      "group": "smm",
      "tariff": 3500,
      "contractDate": "2026-06-09",
      "status": "active"
    },
    {
      "id": "id-ed42lrxy2f728b",
      "name": "Клиника Насмин",
      "group": "smm",
      "tariff": 3500,
      "contractDate": "2026-06-26",
      "status": "active"
    },
    {
      "id": "id-o2xdgmsk035edb",
      "name": "Asan",
      "group": "smm",
      "tariff": 2500,
      "contractDate": "2026-06-01",
      "status": "active"
    },
    {
      "id": "id-a1d7f0p9c2c41c",
      "name": "Iram cinema",
      "group": "smm",
      "tariff": 3500,
      "contractDate": "2026-05-30",
      "status": "active"
    },
    {
      "id": "id-s1i7ln1m4be37f",
      "name": "Furug clinic",
      "group": "smm",
      "tariff": 3000,
      "contractDate": "2026-05-01",
      "status": "active"
    },
    {
      "id": "id-syrfo9rsec680d",
      "name": "Nozima clinic",
      "group": "smm",
      "tariff": 2500,
      "contractDate": "2026-05-06",
      "status": "active"
    },
    {
      "id": "id-hgv3pq183cb4d7",
      "name": "Mycom.tj",
      "group": "smm",
      "tariff": 3100,
      "contractDate": "2026-05-03",
      "status": "active"
    },
    {
      "id": "id-4kjhtx8p2b56a7",
      "name": "Tez zet",
      "group": "smm",
      "tariff": 2300,
      "contractDate": "2026-03-31",
      "status": "archived"
    },
    {
      "id": "id-grxqkq4r1552b0",
      "name": "Madadpharm",
      "group": "smm",
      "tariff": 2250,
      "contractDate": "2026-04-17",
      "status": "archived"
    },
    {
      "id": "id-kcci9d42fcde4d",
      "name": "Manilla Street",
      "group": "smm",
      "tariff": 3000,
      "contractDate": "2026-05-14",
      "status": "archived"
    },
    {
      "id": "id-ufm8ufef730c47",
      "name": "Shakl",
      "group": "smm",
      "tariff": 2500,
      "status": "archived"
    },
    {
      "id": "id-upnk6ucdbe4c4e",
      "name": "Toj Iran",
      "group": "smm",
      "tariff": 3000,
      "status": "archived"
    },
    {
      "id": "id-m1i9q46706bd85",
      "name": "Sorena Taile",
      "group": "smm",
      "tariff": 3100,
      "contractDate": "2026-04-06",
      "status": "archived"
    },
    {
      "id": "id-r168pt0e0a2440",
      "name": "Exclusive",
      "group": "smm",
      "tariff": 3500,
      "contractDate": "2026-05-06",
      "status": "archived"
    },
    {
      "id": "id-4ud6vktzc97cdd",
      "name": "Чармаи Бехор",
      "group": "smm",
      "tariff": 3500,
      "contractDate": "2026-04-30",
      "status": "archived"
    },
    {
      "id": "id-m52gurk2bf1808",
      "name": "Architech",
      "group": "smm",
      "tariff": 0,
      "status": "archived"
    },
    {
      "id": "id-36pqeii9c0df67",
      "name": "Javonon",
      "group": "development",
      "tariff": 25000,
      "status": "active"
    },
    {
      "id": "id-7nom7ie6537ee7",
      "name": "Arhideya",
      "group": "development",
      "tariff": 20000,
      "status": "active"
    }
  ],
  "plannedPayments": [
    {
      "id": "id-pzygzs4tfc0df3",
      "clientId": "id-36pqeii9c0df67",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 15000,
      "status": "received"
    },
    {
      "id": "id-zytkwtcxc0b555",
      "clientId": "id-36pqeii9c0df67",
      "ym": "2026-07",
      "partNo": 1,
      "amount": 5000,
      "status": "expected"
    },
    {
      "id": "id-ox0yq64n4436cf",
      "clientId": "id-36pqeii9c0df67",
      "ym": "2026-08",
      "partNo": 1,
      "amount": 5000,
      "status": "expected"
    },
    {
      "id": "id-b0xphlmc7ce5f9",
      "clientId": "id-7nom7ie6537ee7",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 5000,
      "status": "received"
    },
    {
      "id": "id-bet3mhb692c781",
      "clientId": "id-7nom7ie6537ee7",
      "ym": "2026-07",
      "partNo": 1,
      "amount": 10000,
      "status": "expected"
    },
    {
      "id": "id-srhzz763fe94f3",
      "clientId": "id-7nom7ie6537ee7",
      "ym": "2026-08",
      "partNo": 1,
      "amount": 5000,
      "status": "expected"
    },
    {
      "id": "id-qh0qb1rx8866bf",
      "clientId": "id-zcfrfuoy5cab58",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 1750,
      "status": "received"
    },
    {
      "id": "id-e6giuzqe696244",
      "clientId": "id-o2xdgmsk035edb",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 2500,
      "status": "received"
    },
    {
      "id": "id-aa7kodlu4af4b0",
      "clientId": "id-a1d7f0p9c2c41c",
      "ym": "2026-05",
      "partNo": 1,
      "amount": 3500,
      "status": "received"
    },
    {
      "id": "id-n5ohd3e0207983",
      "clientId": "id-s1i7ln1m4be37f",
      "ym": "2026-05",
      "partNo": 1,
      "amount": 3000,
      "status": "received"
    },
    {
      "id": "id-mse7ivhsa46cd4",
      "clientId": "id-syrfo9rsec680d",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 1250,
      "status": "received"
    },
    {
      "id": "id-b4kwgszb1b9711",
      "clientId": "id-hgv3pq183cb4d7",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 1330,
      "status": "received"
    },
    {
      "id": "id-r7ummnivac6ff6",
      "clientId": "id-4kjhtx8p2b56a7",
      "ym": "2026-03",
      "partNo": 1,
      "amount": 2200,
      "status": "received"
    },
    {
      "id": "id-dzg67u6z982a40",
      "clientId": "id-grxqkq4r1552b0",
      "ym": "2026-04",
      "partNo": 1,
      "amount": 2250,
      "status": "received"
    },
    {
      "id": "id-s51l88he6acab0",
      "debtId": "id-8viis1et10b882",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 3500,
      "status": "expected"
    },
    {
      "id": "id-3vh7ujzn62d21a",
      "debtId": "id-kt0wgopb530329",
      "ym": "2026-06",
      "partNo": 1,
      "amount": 500,
      "status": "expected"
    },
    {
      "id": "id-l07404xd29c4ac",
      "debtId": "id-kt0wgopb530329",
      "ym": "2026-07",
      "partNo": 1,
      "amount": 500,
      "status": "expected"
    }
  ],
  "employees": [
    {
      "id": "id-qfwy3mfzddc999",
      "name": "Navruz Mardanov Shaymardanovich",
      "salary": 4000,
      "advance": 0,
      "role": "Руководитель SMM",
      "hireDate": "2026-03-26",
      "status": "active"
    },
    {
      "id": "id-dhiqtdmj462eb7",
      "name": "Lashkarova Savribegim Eradzhevna",
      "salary": 3000,
      "advance": 0,
      "role": "Менеджер продаж (SMM)",
      "hireDate": "2026-03-26",
      "status": "active"
    },
    {
      "id": "id-fv9ye2o7c7f120",
      "name": "Turazoda Muhammadamin Mahmad",
      "salary": 3500,
      "advance": 0,
      "role": "Разработчик",
      "hireDate": "2026-03-26",
      "status": "active"
    },
    {
      "id": "id-9cd2ia11fe6a29",
      "name": "Mayunusova Farzona Firdavsovna",
      "salary": 2500,
      "advance": 0,
      "role": "Сторисмейкер",
      "hireDate": "2026-03-26",
      "status": "active"
    },
    {
      "id": "id-9he116r983f294",
      "name": "Oyembekova Amina Ruslanovna",
      "salary": 1500,
      "advance": 0,
      "role": "Видеограф",
      "hireDate": "2026-04-30",
      "status": "active"
    },
    {
      "id": "id-d038957hdfd0a0",
      "name": "Rozikova Khusnidabonu",
      "salary": 3500,
      "advance": 0,
      "role": "Дизайнер",
      "hireDate": "2026-05-06",
      "status": "active"
    },
    {
      "id": "id-wdyailoedebc70",
      "name": "Sabrina Oblokulova",
      "salary": 3000,
      "advance": 1500,
      "role": "Менеджер продаж (Разработка)",
      "hireDate": "2026-05-08",
      "status": "active"
    },
    {
      "id": "id-pgwc30kpf2880a",
      "name": "Khakimova Maryam Khurshedovna",
      "salary": 1500,
      "advance": 0,
      "role": "Организатор",
      "hireDate": "2026-05-09",
      "status": "active"
    },
    {
      "id": "id-akh4w7iq947a81",
      "name": "Rabiev Mahmud",
      "salary": 1500,
      "advance": 500,
      "role": "Видеограф",
      "hireDate": "2026-05-15",
      "status": "active"
    },
    {
      "id": "id-9e6iw4sz21185f",
      "name": "Boboev Azam",
      "salary": 2000,
      "advance": 0,
      "role": "Монтажёр",
      "hireDate": "2026-06-01",
      "status": "active"
    },
    {
      "id": "id-0qw23eebc728a4",
      "name": "Mehriniso Saidova Kosimovna",
      "salary": 0,
      "advance": 0,
      "role": "SMM специалист",
      "hireDate": "2026-06-01",
      "status": "active"
    },
    {
      "id": "id-lisi7awf1ea9e6",
      "name": "Behruz Mirov",
      "salary": 5000,
      "advance": 1000,
      "role": "Руководитель по видеографии",
      "hireDate": "2026-06-11",
      "status": "active"
    },
    {
      "id": "id-02gjwm277cdef5",
      "name": "Zavkov Samad",
      "salary": 1500,
      "advance": 0,
      "role": "Видеограф",
      "hireDate": "2026-06-12",
      "status": "active"
    }
  ],
  "subscriptions": [
    {
      "id": "id-r90xppva402b1b",
      "name": "Аренда офиса",
      "amount": 6000,
      "kind": "rent",
      "accountId": "id-s7hyzqa409476a",
      "active": true
    },
    {
      "id": "id-1r7itvd09d360a",
      "name": "Claude",
      "amount": 2000,
      "kind": "subscription",
      "accountId": "id-s7hyzqa409476a",
      "active": true
    },
    {
      "id": "id-zm2voiyjd373c9",
      "name": "Adobe",
      "amount": 100,
      "kind": "subscription",
      "accountId": "id-s7hyzqa409476a",
      "active": true
    },
    {
      "id": "id-ns9ooslwa9b58c",
      "name": "Capcut",
      "amount": 500,
      "kind": "subscription",
      "accountId": "id-s7hyzqa409476a",
      "active": true
    },
    {
      "id": "id-p4svk6qw00d345",
      "name": "Server",
      "amount": 200,
      "kind": "subscription",
      "accountId": "id-s7hyzqa409476a",
      "active": true
    }
  ],
  "debts": [
    {
      "id": "id-8viis1et10b882",
      "name": "Камера (рассрочка)",
      "totalAmount": 3500,
      "paidBefore": 0,
      "monthlyPayment": 3500,
      "accountId": "id-s7hyzqa409476a"
    },
    {
      "id": "id-kt0wgopb530329",
      "name": "Долг Мухаммаду",
      "totalAmount": 1000,
      "paidBefore": 0,
      "monthlyPayment": 500,
      "accountId": "id-s7hyzqa409476a"
    }
  ],
  "meta": [
    {
      "key": "seeded",
      "value": "2026-07-01T07:15:04.539Z"
    }
  ]
};
