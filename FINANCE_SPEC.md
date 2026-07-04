# FINANCE_SPEC — Полная имплементационная спецификация финансовой системы WebRand в CRM (sabt_crm_system)

> Версия: 2026-07-04. Эталон: standalone-приложение `fin-webrand` (React 19 + Vite + Dexie/IndexedDB) + backup `webrand-backup-2026-07-01.json`. Цель документа — чтобы по нему можно было реализовать/довести финмодуль CRM до паритета с эталоном «шаг в шаг».

---

## 1. Назначение и контекст

### 1.1 Что это

Финансовая система digital-агентства **WebRand** (SMM / Web-разработка / Дизайн), встроенная в CRM `sabt_crm_system` как раздел «Финансы». Единственная валюта — **сомони (TJS)**, отображается суффиксом **« с.»** (например, «12 500 с.»). Отрицательных сумм в данных не бывает — знак операции определяется её типом.

### 1.2 Главный архитектурный принцип

**Журнал транзакций — единственный источник правды.** Все производные показатели ВЫЧИСЛЯЮТСЯ, а не хранятся снимками:

- балансы счетов = стартовый баланс + сумма эффектов всех транзакций (сквозные, НЕ по месяцу);
- доход/расход/прибыль за месяц = агрегаты транзакций месяца;
- разбивки по категориям/направлениям/статьям = группировки транзакций;
- дебиторка («ожидается к получению») = агрегаты плановых оплат `status='expected'`;
- остатки долгов = `totalAmount − paidBefore − Σ погашений (транзакции с debtId)`;
- «к выплате ЗП» = `max(0, фонд − авансы − выплачено за месяц)`.

Переключатель месяца (`MonthNav`) фильтрует **только суммы за период** (по `ym = date.slice(0,7)`); балансы счетов месяцем не фильтруются.

### 1.3 Роли и доступ

Весь раздел закрыт правом **`finance.manage`**, роли `FOUNDER` / `CO_FOUNDER` (guards: `JwtAuthGuard, RolesGuard, PermissionsGuard, FinanceAccessGuard`; на фронте — `RoleGuard`).

> ⚠️ `RolesGuard`/`PermissionsGuard` читают метаданные только с обработчиков (`getHandler`), поэтому классовые `@Roles`/`@RequirePerm` сами по себе доступ НЕ ограничивают. Реальное ограничение даёт `FinanceAccessGuard` (`finance-access.guard.ts`): `hasGrant(user, 'finance.manage')` — нативно у FOUNDER/CO_FOUNDER либо персональный грант `extraPermissions`.

### 1.4 Словарь

| Термин | Значение |
|---|---|
| Направление дохода (`IncomeGroup`) | `smm`, `development`, `design` |
| Статья расхода (`ExpenseGroup`) | `salary`, `rent_subs`, `debts` (всё прочее — «Прочее») |
| Тип операции (`TxType`) | `income`, `expense`, `transfer`, `saving` |
| Плановая оплата | Запись «ожидается/получено» по проекту или долгу за конкретный месяц (`ym`), у SMM — с частью 1/2 |
| «Освоено вне счёта» | Плановая оплата `received` БЕЗ связанной транзакции (`receivedTxId=null`) — учтено в направлении, но не проходило по счёту (исторические данные/импорт) |
| `ym` | Строка `YYYY-MM` |

---

## 2. Архитектура в CRM

### 2.1 Backend — NestJS + TypeORM (PostgreSQL)

- **`synchronize` ВЫКЛЮЧЕН.** Схема поднимается вручную в `FinanceService.onModuleInit`: `CREATE TABLE IF NOT EXISTS` для всех 8 таблиц + аддитивные `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для новых колонок. Только аддитивные изменения; ошибки DDL глушатся в `warn` (не роняют старт).
- Там же в `onModuleInit`: перевод старых enum-колонок транзакции в `varchar` (справочники стали динамическими), затем `seedDefaults()` → `seedWebRand()` (идемпотентный посев, см. §4), затем бэкфиллы (legacy enum `account` → `accountId` по `key`; статус сотрудника `inactive` → `fired`).
- Один модуль: `finance.module.ts` регистрирует 8 сущностей через `TypeOrmModule.forFeature`. Один контроллер (`/finance`, ~45 маршрутов), один сервис (~1300 строк — вся бизнес-логика и расчёты).

Файлы (абсолютные пути, каталог `/Users/jovidonpirov/Desktop/srmm/sabt_crm_system/backend/src/modules/finance/`):

| Файл | Назначение |
|---|---|
| `finance.controller.ts` | Все REST-эндпоинты (см. §7) |
| `finance.service.ts` | Бизнес-логика, расчёты, DDL в `onModuleInit`, посев |
| `finance.module.ts` | Регистрация сущностей |
| `finance-transaction.entity.ts` | Транзакция (лежит в корне модуля) |
| `entities/finance-account.entity.ts` | Счёт |
| `entities/finance-category.entity.ts` | Категория |
| `entities/finance-project.entity.ts` | Проект/клиент |
| `entities/finance-employee.entity.ts` | Сотрудник |
| `entities/finance-subscription.entity.ts` | Аренда/подписка |
| `entities/finance-debt.entity.ts` | Долг |
| `entities/finance-planned-payment.entity.ts` | Плановая оплата |
| `dto/` | 17 DTO (Create/Update пары, PayNow, Receive и т.д.) |
| `webrand-backup.data.ts` | Встроенный снимок бэкапа WebRand для посева (используется, если JSON-файл недоступен, напр. на Railway) |

### 2.2 Frontend — React + react-query

Каталог `/Users/jovidonpirov/Desktop/srmm/sabt_crm_system/frontend/src/pages/finance/`:

| Файл | Назначение |
|---|---|
| `FinanceOverviewPage.tsx` | Обзор (дашборд) |
| `FinanceIncomePage.tsx` | Доход: направления + детали SMM/Dev/Design (дрилл-даун через `useState`, без вложенных роутов) |
| `FinanceExpensePage.tsx` | Расход: карточки + детали salary/subscriptions/debts/other |
| `FinanceTransactionsPage.tsx` | Журнал транзакций (инлайн-редактирование) |
| `FinanceSettingsPage.tsx` | Настройки: счета, справочники, бэкап, сброс |
| `OperationModal.tsx` | Универсальная модалка операции (4 таба, создание/редактирование, инлайн-категория) |
| `financeUi.tsx` | Примитивы: `MonthNav`, `MonthRangeNav`, `Stat`, `Badge`, `ProgressBar`, `SectionTitle`, `EmptyState`, `AlertBar`, `CellInput`, `TableCard`, `BackLink` |
| `financeUtils.ts` | `money`, датные хелперы (`currentYm/shiftYm/monthLabel/todayISO/ymOf/formatDate`), `DIRECTIONS`, `TYPE_LABEL/TYPE_COLOR/TYPE_SIGN`, `GROUP_META` |
| `financeIcons.tsx` | `CatIcon` + `ICON_MAP` (строковое имя иконки → lucide-компонент) |

API-клиент: `frontend/src/services/api.service.ts` → объект **`financeApi`** (строки ~319–384) — единственная точка вызова бэкенда.

Роутинг (`App.tsx`, `Sidebar.tsx`) — 5 вкладок: `finance` (Обзор), `finance/income`, `finance/expense`, `finance/transactions`, `finance/settings`.

**Конвенция react-query:** все ключи начинаются с `['finance', …]` (`['finance','overview',ym]`, `['finance','income-detail','smm',ym]` …). Мутации делают «ковровую» инвалидацию `invalidateQueries({ queryKey: ['finance'] })`. Тосты — `react-hot-toast`; текст ошибки — `e?.response?.data?.message || 'Ошибка'`.

### 2.3 Эталон (для сверки)

`/Users/jovidonpirov/Desktop/srmm/sabt_crm_system/fin-webrand/src/**` — модель `db/types.ts`, расчёты `lib/calc.ts`, форматирование `lib/format.ts`, константы `lib/constants.ts`, мутации `state/data.ts`, сид `db/initialData.ts`, точные данные `webrand-backup-2026-07-01.json`. Спека HANDOFF.md (`/Users/jovidonpirov/Desktop/fin webrand/HANDOFF.md`) — §13/§14 УСТАРЕЛИ, источник правды по сид-данным — initialData/backup (см. §4).

---

## 3. Доменная модель

Базовые типы:

```ts
type ID = string;                     // в CRM — uuid
type TxType = 'income' | 'expense' | 'transfer' | 'saving';
type IncomeGroup  = 'smm' | 'development' | 'design';
type ExpenseGroup = 'salary' | 'rent_subs' | 'debts';
type Group = IncomeGroup | ExpenseGroup;   // 6 групп
```

### 3.1 Account — счёт (`finance_accounts`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `key` | `'alif'\|'dushanbe_city'\|'cash'\|null` | Системный ключ (для бэкфиллов legacy-поля `account`) |
| `name` | string | Alif / DC (Dushanbe City) / Наличные |
| `kind` | `'bank'\|'cash'\|'savings'` | Тип счёта |
| `startBalance` | decimal | Стартовый баланс на момент запуска системы (эталонное `openingBalance`) |
| `color` | string | HEX-цвет точки счёта |
| `position` | int | Порядок сортировки |
| `createdAt` | timestamp | |

Текущий баланс НЕ хранится: `balance = startBalance + Σ effectOnAccount(tx)` по всей истории. Удаление счёта запрещено, если по нему есть операции.

### 3.2 Category — гибкая категория (`finance_categories`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | |
| `type` | `'income'\|'expense'\|'saving'\|'transfer'` | К какому типу операций относится |
| `key` | string\|null | Системный ключ (`smm`, `smm1`, `smm2`, `development`, `design`, `salary`, `rent`, `subscription`, `debt`, `debt_return`, …) — по нему определяется `group` |
| `builtin` | bool | Системная: нельзя удалить, нельзя менять `type` |
| `icon` | string | Имя иконки (маппится в `ICON_MAP`/`Icon.tsx`) |
| `color` | string | HEX |
| `position` | int | |
| `createdAt` | timestamp | |

Категории без системного ключа (созданные на лету) → `group=undefined` → расходы по ним суммируются в «Прочее».

### 3.3 Transaction — операция, ядро системы (`finance_transactions`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `type` | varchar | `income\|expense\|transfer\|saving` |
| `amount` | decimal(15,2) | **ВСЕГДА положительное**; знак задаёт тип |
| `date` | date (ISO `yyyy-mm-dd`) | Реальная дата операции — основа месячных агрегатов |
| `accountId` | uuid\|null | Счёт: получатель для income/saving, источник для expense |
| `fromAccountId` | uuid\|null | Источник (для transfer) |
| `toAccountId` | uuid\|null | Получатель (для transfer) |
| `categoryId` | uuid\|null | Гибкая категория (журнал + разбивка дашборда) |
| `projectId` | uuid\|null | Проект-доход |
| `employeeId` | uuid\|null | Выплата ЗП |
| `debtId` | uuid\|null | Погашение долга |
| `subscriptionId` | uuid\|null | Оплата подписки/аренды |
| `comment` | string\|null | |
| `status` | `'completed'\|'pending'\|'cancelled'` | default `completed`; `cancelled` исключается из ВСЕХ расчётов |
| `createdById` / `createdBy` | uuid / User | Автор |
| `createdAt`, `updatedAt` | timestamp | |
| *legacy (nullable)* | | `account` (enum-строка), `splits` (jsonb), `category` (строка-название), `description`, `counterparty`, `project`, `paymentMethod` — только совместимость |

**Эффект на счёт** (`effectOnAccount(t, accId)`): `+amount`, если счёт — получатель; `−amount`, если источник. income → +получатель; expense → −источник; transfer → оба; saving → +получатель (источника нет).

В эталоне также есть `plannedPaymentId` на транзакции; в CRM связь обратная — `PlannedPayment.receivedTxId` (этого достаточно, связь 1:1).

### 3.4 Project / Client — проект (`finance_projects`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | |
| `direction` | `'smm'\|'development'\|'design'` | Направление дохода |
| `tariff` | decimal | SMM — цена/мес; Dev/Design — полная сумма проекта/этапа |
| `status` | `'lead'\|'active'\|'done'\|'archived'` | default `active`; `lead` исключается из плана |
| `archived` | bool | Флаг архива (⚠️ дублирует `status='archived'` — см. §9.8) |
| `contractDate` | date\|null | Дата контракта; её ДЕНЬ МЕСЯЦА задаёт цикл оплаты SMM |
| `multiMonth` | bool | Только design: брендбук/логобук → матричная оплата по месяцам (как Dev); иначе разовая работа |
| `note` | string\|null | Инлайн-комментарий в таблицах |
| `position` | int | |
| `createdAt` | timestamp | |

Удаление проекта — каскад: удаляются его доходные транзакции + плановые оплаты + сам проект.

### 3.5 PlannedPayment — плановая оплата (`finance_planned_payments`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `projectId` | uuid\|null | Для дохода по проекту |
| `debtId` | uuid\|null | Для графика погашения долга |
| `ym` | char(7) `YYYY-MM` | Месяц оплаты |
| `partNo` | `1\|2` | SMM — часть 1/2; dev/design/долги — всегда 1 |
| `amount` | decimal | |
| `status` | `'expected'\|'received'` | Ожидается / получено |
| `receivedTxId` | uuid\|null | Связанная транзакция (income по проекту / expense по долгу). `received` без `receivedTxId` = «освоено вне счёта» |
| `auto` | bool | Создана автоматически из журнала (`syncSmmPartLink`) |
| `createdAt` | timestamp | |

`projectId` и `debtId` взаимоисключающи (в реляционной модели — nullable FK + желательно CHECK `(projectId IS NULL) <> (debtId IS NULL)`). На `receivedTxId` нужен индекс/FK — связь «транзакция↔план» явная (урок эталона §9.3).

### 3.6 Employee — сотрудник (`finance_employees`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | ФИО |
| `role` | string\|null | Должность |
| `salary` | decimal | Оклад/мес |
| `advance` | decimal | Типовой аванс |
| `hireDate` | date\|null | Дата приёма |
| `status` | `'active'\|'fired'` | Уволенные не входят в фонд/подсчёты |
| `position` | int | |
| `createdAt` | timestamp | |

### 3.7 Subscription — регулярный расход (`finance_subscriptions`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | |
| `kind` | `'rent'\|'subscription'` | Аренда / подписка |
| `amount` | decimal | В месяц |
| `active` | bool | Только active входят в «Регулярные/мес» |
| `position` | int | |
| `createdAt` | timestamp | |

⚠️ В эталоне есть `accountId` (типовой счёт списания) — в CRM не хранится, при посеве игнорируется (см. чек-лист §10).

### 3.8 Debt — долг/рассрочка (`finance_debts`)

| Поле | Тип | Описание |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | |
| `counterparty` | string\|null | |
| `totalAmount` | decimal | Полная сумма долга |
| `paidBefore` | decimal | Погашено до старта системы |
| `monthlyPayment` | decimal\|null | Платёж/мес (основа авто-графика) |
| `note` | string\|null | |
| `position` | int | |
| `createdAt` | timestamp | |

Остаток: `debtRemaining = max(0, totalAmount − paidBefore − Σ amount расходных транзакций с этим debtId)`.

---

## 4. Сид-данные (точные значения из backup `webrand-backup-2026-07-01.json` ≡ `initialData.ts`)

Посев идемпотентный (`seedWebRand`): каждый блок выполняется ТОЛЬКО если целевая таблица пуста; существующее не затирается. Журнал `transactions` при сиде **ПУСТОЙ** — поэтому посеянные `received`-планы без `receivedTxId` формируют исторический `paidLife` и «освоено вне счёта». Плановые оплаты при посеве резолвятся **по имени** проекта/долга (backup-id ≠ uuid CRM).

### 4.1 Счета (3)

| Название | kind | Стартовый баланс | Цвет |
|---|---|---:|---|
| Alif | bank | **1 090** | `#22c55e` (зелёный) |
| DC (Dushanbe City) | bank | **1 644** | `#f59e0b` (оранжевый) |
| Наличные | cash | **5 500** | `#94a3b8` (серый) |

(Стартовые балансы проставляются по key/имени только если текущий `startBalance === 0`.)

### 4.2 Категории (17, DEFAULT_CATEGORIES)

**Доход:** SMM `#16a34a` · **SMM часть 1** `#16a34a` · **SMM часть 2** `#22c55e` · Development `#0ea5e9` · Design `#a855f7` · Возврат долга `#14b8a6` · Прочее `#64748b`.
**Расход:** Зарплата `#f97316` · Реклама (ADS) `#ef4444` · Аренда `#e11d48` · Подписки `#d946ef` · Транспорт `#0891b2` · Печать `#7c3aed` · Налоги `#b45309` · Долг `#d97706` · Прочее `#64748b`.
**Накопление:** Half Repayment `#7c3aed`.
Эталонные стабильные id: `cat-smm`, `cat-smm-part1`, `cat-smm-part2`, `cat-development`, `cat-design`, `cat-debt-repay`, `cat-other-income`, `cat-salary`, `cat-ads`, `cat-rent`, `cat-subscription`, `cat-transport`, `cat-print`, `cat-taxes`, `cat-debt`, `cat-other-expense`, `cat-half-repayment`. В CRM их роль играют `key` (`smm`,`smm1`,`smm2`,`development`,`design`,`debt_return`,`salary`,`rent`,`subscription`,`debt` …) + `builtin=true`.

### 4.3 Проекты (19)

**SMM активные (8):**

| Проект | Тариф/мес | Дата контракта |
|---|---:|---|
| Серенак | 3 500 | 2026-06-30 |
| Оке Дем Центр | 3 500 | 2026-06-09 |
| Клиника Насмин | 3 500 | 2026-06-26 |
| Asan | 2 500 | 2026-06-01 |
| Iram cinema | 3 500 | 2026-05-30 |
| Furug clinic | 3 000 | 2026-05-01 |
| Nozima clinic | 2 500 | 2026-05-06 |
| Mycom.tj | 3 100 | 2026-05-03 |

Σ тарифов активных SMM = **25 100**.

**SMM в архиве (9):** Tez zet 2 300 (2026-03-31) · Madadpharm 2 250 (2026-04-17) · Manilla Street 3 000 (2026-05-14) · Shakl 2 500 (без даты) · Toj Iran 3 000 (без даты) · Sorena Taile 3 100 (2026-04-06) · Exclusive 3 500 (2026-05-06) · Чармаи Бехор 3 500 (2026-04-30) · Architech 0 (без даты).

**Development активные (2):** **Javonon 25 000** · **Arhideya 20 000** (даты контрактов не заданы). Σ = **45 000**.
**Design:** проектов в сиде НЕТ (Σ = 0).

⚠️ Посев НЕ проставляет `status` (все — `active`); из бэкапа читается только `archived = (status==='archived')`.

### 4.4 Сотрудники (13, все active)

| ФИО | Оклад | Аванс | Должность | Приём |
|---|---:|---:|---|---|
| Navruz Mardanov Shaymardanovich | 4 000 | 0 | Руководитель SMM | 2026-03-26 |
| Lashkarova Savribegim Eradzhevna | 3 000 | 0 | Менеджер продаж (SMM) | 2026-03-26 |
| Turazoda Muhammadamin Mahmad | 3 500 | 0 | Разработчик | 2026-03-26 |
| Mayunusova Farzona Firdavsovna | 2 500 | 0 | Сторисмейкер | 2026-03-26 |
| Oyembekova Amina Ruslanovna | 1 500 | 0 | Видеограф | 2026-04-30 |
| Rozikova Khusnidabonu | 3 500 | 0 | Дизайнер | 2026-05-06 |
| Sabrina Oblokulova | 3 000 | **1 500** | Менеджер продаж (Разработка) | 2026-05-08 |
| Khakimova Maryam Khurshedovna | 1 500 | 0 | Организатор | 2026-05-09 |
| Rabiev Mahmud | 1 500 | **500** | Видеограф | 2026-05-15 |
| Boboev Azam | 2 000 | 0 | Монтажёр | 2026-06-01 |
| Mehriniso Saidova Kosimovna | **0** | 0 | SMM специалист (оклад не задан) | 2026-06-01 |
| Behruz Mirov | 5 000 | **1 000** | Руководитель по видеографии | 2026-06-11 |
| Zavkov Samad | 1 500 | 0 | Видеограф | 2026-06-12 |

**Фонд ЗП = 32 500; авансы = 3 000 → «К выплате» на чистом сиде = 29 500.**

### 4.5 Аренда и подписки (5, все active; в бэкапе счёт списания — Alif)

| Позиция | kind | Сумма/мес |
|---|---|---:|
| Аренда офиса | rent | 6 000 |
| Claude | subscription | 2 000 |
| Capcut | subscription | 500 |
| Server | subscription | 200 |
| Adobe | subscription | 100 |
| **Итого** | | **8 800** |

### 4.6 Долги (2; счёт в бэкапе — Alif)

| Долг | totalAmount | paidBefore | monthlyPayment |
|---|---:|---:|---:|
| Камера (рассрочка) | **3 500** | 0 | **3 500** |
| Долг Мухаммаду | **1 000** | 0 | **500** |

Σ остаток = **4 500**. (⚠️ HANDOFF §13/§14 с цифрами 6000/2000/«7000» — устарел.)

### 4.7 Плановые оплаты (17)

**Development:**
- Javonon: 15 000 (2026-06, **received**), 5 000 (2026-07, expected), 5 000 (2026-08, expected);
- Arhideya: 5 000 (2026-06, **received**), 10 000 (2026-07, expected), 5 000 (2026-08, expected).

**SMM (все received, partNo=1):** Оке Дем Центр 1 750 (2026-06) · Asan 2 500 (2026-06) · Iram cinema 3 500 (2026-05) · Furug clinic 3 000 (2026-05) · Nozima clinic 1 250 (2026-06) · Mycom.tj 1 330 (2026-06) · Tez zet 2 200 (2026-03) · Madadpharm 2 250 (2026-04).

**Долги (expected):** Камера 3 500 (2026-06) · Мухаммаду 500 (2026-06) и 500 (2026-07).

Received-планы посеяны **без `receivedTxId`** (журнал пуст) → это «освоено вне счёта».

### 4.8 Контрольные цифры на чистом сиде (для приёмочного теста)

| Показатель | Значение |
|---|---:|
| К выплате ЗП | **29 500** |
| Регулярные / мес | **8 800** |
| Всего должны | **4 500** |
| Ожидается к получению (Σ expected по проектам) | **25 000** |
| Возможный доход (Σ тарифов активных): 25 100 SMM + 45 000 Dev + 0 Design | **70 100** |
| Балансы: Alif 1 090 · DC 1 644 · Наличные 5 500 | Σ **8 234** |

---

## 5. Экраны — полное ТЗ

Навигация: 5 вкладок — **Обзор · Доход · Расход · Транзакции · Настройки** (в эталоне сайдбар 220px, сворачивается в иконки <1000px; внизу плашка «сомони (TJS)»; бренд «Fin System / WebRand»).

### 5.1 Обзор (`FinanceOverviewPage`, эталон `Dashboard.tsx`)

Шапка: заголовок «Обзор» + `MonthNav` + кнопка «＋ Операция» (открывает `OperationModal`, defaultTab='income'). Блоки сверху вниз:

1. **Балансы счетов** — сетка карточек (auto-fit): цветная точка + имя счёта + текущий сквозной баланс.
2. **Ряд «Доход / Расход / Overall»** (grid 1fr 1fr 300px):
   - **Доход** (кликабельна → Доход): итоговая сумма income-операций месяца + разбивка по **категориям** (иконка+цвет+имя, сумма; сортировка по убыванию; «Нет операций» если пусто). Подвал «Открыть детали →».
   - **Расход** — аналогично по expense.
   - **Overall** — пирог (recharts): Доход `#16a34a` vs Расход `#e11d48`, innerRadius 42 / outerRadius 66, tooltip в `money`. Внизу «Прибыль» = income − expense (класс pos/neg, со знаком).
3. **План/факт** (grid-2):
   - **Доход по направлениям**: заголовочная цифра = «Возможный доход» (Σ планов); по каждому из 3 направлений строка «получено / план», где план = Σ тарифов проектов направления со `status ∉ {lead, archived}`, факт = Σ received-планов месяца по направлению. Футер «Получено за месяц» = Σ фактов. Клик → Доход.
   - **Расход по статьям**: план salary = `salaryToPay`, rent_subs = `subsMonthly`, debts = `debtsMonthly`; факт = расходы месяца соответствующей группы. Футер «Потрачено за месяц». Клик → Расход.
4. **4 stat-карточки** (кликабельны):
   - «Ожидается к получению» = Σ expected-планов **проектов** (без долгов, без фильтра по месяцу) → Доход;
   - «К выплате ЗП за месяц» = `max(0, фонд − авансы − выплачено)`; sub «фонд {X} − авансы − выплачено» → Расход/Зарплата;
   - «Всего должны» = Σ остатков долгов (тон neg) → Расход/Долги;
   - «Регулярные / мес» = Σ активных подписок+аренды → Расход/Аренда и подписки.
5. **«Транзакции за месяц»**: последние операции месяца (в CRM — 15 строк) + кнопка «Все операции →». Таблица `TxRow` с hover-действиями ✎/🗑; двойной клик = редактировать.

**Колонки таблицы транзакций:** Дата (`formatDate`, muted) · Тип (цветной badge) · Статья/описание (иконка+цвет категории, имя; второй строкой comment mini muted) · Счёт (transfer: «from → to», иначе один счёт) · Клиент (имя проекта ?? имя сотрудника ?? «—») · Сумма (income/saving «+» pos; expense «−» neg; transfer без знака muted) · действия. Пустое состояние: иконка wallet + «Нет операций за период».

### 5.2 Доход — список направлений

Шапка + `MonthNav`. Три карточки (grid-3, кликабельны → детали):
- значение = **получено на счёт** за месяц (`cashReceived`: received-планы С `receivedTxId`);
- подпись «{N} проектов» (status ∉ {lead, archived}); для SMM дополнительно «· ожидается {Σ expected SMM за месяц}» (amber);
- «Открыть →». Под сеткой mini-подпись о выбранном месяце.

### 5.3 Доход → SMM (`SmmDetail`, эталон `SmmTable`)

Помесячный учёт по частям 1/2.

- **3 stat:** «Ожидается» (Σ expected-частей месяца) · «Получено на счёт» (Σ received с txId; sub «освоено вне счёта: {Σ received без txId}» если >0) · «Всего за месяц» (expected + receivedCash).
- **Амбер-алерт** (`AlertBar`), если есть проекты по сроку: «Получить оплату: {needPay}» и/или «Получить остаток: {needRest}» (механика §6.3).
- **Таблица:** Проект · Дата контракта · Тариф · **Часть 1** · **Часть 2** · Полная оплата · Комментарий · действия. Футер Итого (Σ тариф, Σ часть1, Σ часть2, Σ полная).
  - Под именем проекта бейдж-алерт «получить оплату» (wait) или «получить остаток» (transfer) по `smmAlert`.
  - Ячейка Часть 1/2 — три состояния: план отсутствует → кнопка «＋» (`PayPartModal` — записать оплату сразу как received + транзакция); `expected` → амбер-бейдж суммы + кнопка «Получено» (`ReceiveModal`: счёт+дата → receive); `received` → зелёный «✓ {сумма}» + «↩» (отмена: удалить операцию и план).
  - «Полная оплата»: `paidLife` = Σ ВСЕХ received-планов проекта за всю историю; если `tariff>0 && paidLife>=tariff` → бейдж «оплачено», иначе «{paidLife} / {tariff}».
  - Комментарий — инлайн-input (`CellInput`), сохранение в `project.note` по blur.
  - Действия: ✎ (`ProjectModal`), архив, 🗑 (confirm; каскад).
- **`PayPartModal`:** сумма (по умолчанию: часть 1 = тариф, часть 2 = 0), дата (today), «На счёт». Валидация: `remaining = tariff − Σ(планов проекта за ЭТОТ ym)`; `overLimit`, если `amount > remaining` (помесячный cap!).
- Внизу — сворачиваемый **«Архив проектов ({N})»**: Проект · Дата контракта · Тариф + «Вернуть» / 🗑.

### 5.4 Доход → Development (`DevelopmentDetail` = stat-карточки + `MatrixTable`)

- **3 stat:** «Ожидается за месяц» (Σ expected текущего месяца) · «Получено за месяц» (Σ received текущего месяца) · «Всего сумма» (Σ тарифов); sub — `monthLabel(ym)` / «{N} проектов».
- **Матрица проект × 6 месяцев** (`MonthRangeNav` листает окно ‹/›; старт окна = самый ранний из {дат контрактов, ym планов, текущий месяц}):
  - Колонки: Проект (имя + **прогресс-бар** `paidLife/tariff` + подпись «{paidLife} / {tariff}») · Сумма (тариф) · 6 колонок месяцев · Комментарий (инлайн note) · действия.
  - Ячейка месяца: пусто → «＋» (`DevCellModal` create); есть планы → бейджи (`ok`=received / `wait`=expected), клик открывает `DevCellModal` для управления.
  - Футер Итого: Σ тарифов + Σ по каждому месяцу.
- **`DevCellModal`:**
  - create: сумма + чекбокс «Уже получено (создать доход)» → если да: дата+счёт → `payNow` (операция + received-план); если нет — expected-план;
  - существующий план: expected → «Отметить полученным» (receive) / «Удалить план»; received → «Отменить оплату» (unreceive);
  - валидация: `scheduledLife` = Σ ВСЕХ планов проекта (все месяцы, любой статус); `remaining = tariff − scheduledLife`; `overLimit` по остатку проекта (**lifetime cap** — отличие от помесячного cap SMM).
- Внизу «Архив проектов».

### 5.5 Доход → Design (`DesignDetail`) — гибрид

- **3 stat:** «Ожидается за месяц» = `expectedMatrix + expectedSimple` (expectedMatrix — expected-планы multiMonth-проектов за месяц; expectedSimple — Σ по разовым с датой контракта в текущем месяце: `max(0, tariff − paid)`, где `paid` — Σ доходных транзакций проекта) · «Получено за месяц» (income-операции месяца направления design) · «Всего сумма» (Σ тарифов).
- **«Разовые работы»** (`!multiMonth`): Название · Дата · Сумма · Комментарий (инлайн) · Статус · действия. Оплачено (`paid >= tariff`) → бейдж «✓ оплачено»; иначе кнопка «Записать оплату» (`RecordIncomeModal` — доход на полную сумму/остаток). «＋ Добавить работу»; `WorkModal` (правка; «Отменить оплату» = удалить доходные операции проекта; удалить). Двойной клик — редактировать.
- **«Брендбуки и логобуки»** (multiMonth): та же `MatrixTable`, что и в Development (показывать секцию, если есть multiMonth-проекты).
- Внизу «Архив проектов».

### 5.6 Расход — карточки (`ExpenseCards`)

Grid-4, кликабельны:
- **Зарплата**: `salaryToPay`; sub «{N} сотрудников»;
- **Аренда и подписки**: `subsMonthly` (Σ active); sub «{N} позиций»;
- **Долги**: `debtsMonthly` = Σ min(платёж/мес, остаток) (поле `debts.monthly` из `expenseSummary`); sub «остаток {Σ remaining}» / «нет долгов»;
- **Прочее**: Σ expense-операций месяца с группой ∉ {salary, rent_subs, debts}; sub «реклама, транспорт, налоги…».
В CRM дополнительно hint «потрачено за месяц …» на каждой карточке.

### 5.7 Расход → Зарплата (`SalarySection`)

- **4 stat:** «Фонд ЗП / мес» (Σ окладов active) · «Авансы (выдано)» (Σ авансов active) · «Выплачено за месяц» (pos) · «К выплате за месяц» (neg; sub «фонд − авансы − выплачено»).
- Плашка-chip **«Выплата ЗП — каждое 10-е число месяца»** + кнопка «＋ Сотрудник».
- Таблица: ФИО · Должность · Дата приёма · ЗП · Аванс · Статус · ✎. Футер Итого (Σ ЗП, Σ Аванс).
  - Статус строки: `salary>0 && выплаченоМесяца>=salary` → бейдж «✓ выплачено» + «↩» (отмена = удалить salary-операции сотрудника за месяц); иначе кнопка **«Выплатить»** (`SalaryPayModal`).
  - `SalaryPayModal`: сумма (по умолчанию `остаток || оклад`), дата по умолчанию **`${ym}-10`** (10-е число!), «Со счёта» → expense-операция (группа salary, категория «Зарплата», employeeId, comment «Зарплата»).
- Сворачиваемый **«Ушедшие сотрудники ({N})»** (`status='fired'`, приглушённые, opacity 0.7) — не входят в фонд.
- `EmployeeFormModal`: ФИО / должность / дата приёма / ЗП / аванс / статус (Работает/Ушёл) / удалить.

### 5.8 Расход → Аренда и подписки (`SubscriptionsSection`)

- **1 stat** «Аренда + подписки / мес» (Σ active). Кнопка «＋ Добавить расход».
- Таблица: Позиция · Тип (Аренда/Подписка) · Сумма/мес · **Статус месяца** · действия. Футер Итого (Σ всех, включая неактивные).
  - Оплачено за месяц (Σ операций месяца по subscriptionId ≥ amount) → бейдж «оплачено» + **дата последней оплаты** (`formatDate`) + «↩» (отмена = удалить операции месяца); иначе «не оплачено» + кнопка «✓ оплатить» → expense-операция (группа rent_subs, категория Аренда/Подписки по kind, счёт = типовой счёт подписки ?? первый, subscriptionId, comment = name, date = today).
  - ✎ (`SubFormModal`: название/тип/сумма; в CRM + active; удалить).

### 5.9 Расход → Долги (`DebtsSection`)

- **3 stat:** «Всего должны» (Σ remaining; sub «из {Σ totalAmount}») · «Должны за месяц» (Σ expected-планов долгов текущего месяца; sub monthLabel) · «Долгов» (кол-во с remaining>0).
- **Матрица долг × 6 месяцев** (`MonthRangeNav` ‹/›): Наименование (имя + **прогресс** `(total−remaining)/total`, амбер + «осталось {remaining} из {total}») · Сумма · 6 месяцев · ✎. Футер Итого per-month.
  - Ячейка: «＋» (`DebtCellModal` create) или бейджи планов (ok/wait).
  - `DebtCellModal`: create — сумма (по умолчанию monthlyPayment) + чекбокс «Уже оплачено (создать расход)» (да → payNow-расход; нет → expected-план); существующий — expected: «Отметить оплаченным» / «Удалить план»; received: «Отменить оплату». Валидация: `scheduled` = Σ всех планов долга; `remaining = totalAmount − scheduled`; overLimit.
  - `DebtFormModal`: Наименование / Контрагент / Платёж-в-мес / Сумма долга / Погашено до старта. **При сохранении → `regenerateDebtSchedule(id)`** (авто-график §6.5). Удаление долга стирает и его график.

### 5.10 Расход → Прочее (`OtherSection`)

- **1 stat** «Прочие расходы за месяц» (neg).
- Таблица: Категория (иконка+цвет+имя) · Сумма · **Доля** (ProgressBar + %). Футер Итого.
- Строки = expense-операции месяца с группой ∉ {salary, rent_subs, debts}, сгруппированы по `categoryId`, по убыванию. Подпись: такие расходы заводятся через «Транзакции».

### 5.11 Транзакции (`FinanceTransactionsPage`) — инлайн-журнал «как в Notion»

- Шапка: 3 цветные quick-add кнопки **«＋ Доход» (green) / «＋ Расход» (red) / «＋ Перевод» (accent)** → `OperationModal` с нужным типом. (Эталон «Накопление» в quick-add тоже не имеет — только в модалке/фильтре.)
- Тулбар: поиск (по comment + имени категории; debounce 300мс) + сегментированный фильтр по типу (Все/Доход/Расход/Перевод/Накопление) + `MonthNav` с тумблером «За всё время / По месяцам» + счётчик «Всего: {N}».
- **Инлайн-таблица** (`TxRow`), каждая ячейка редактируется на месте:
  - Дата — `input type=date`;
  - Тип — `<select>`-бейдж с цветом типа; **смена типа сбрасывает** `categoryId`/`group` и чистит неприменимые счета (income/saving → убирает from; expense → убирает to);
  - Категория — select категорий с `kind === type` (для transfer — «—»); выбор ставит `categoryId` + `group = categoryGroup(catId)`;
  - Описание — input, commit по blur;
  - Сумма — input decimal, right-align, парсинг `parseFloat(v.replace(',', '.'))`, commit по blur;
  - «Со счёта» / «На счёт» — select-ы, активность по типу (fromActive: expense/transfer; toActive: income/transfer/saving);
  - 🗑 удаление с confirm; ✎ — полная форма (`OperationModal` edit).
  - Все правки идут через `updateTransaction` → на сервере срабатывает `syncSmmPartLink` (§6.4).
- Пагинация: pageSize 100. Пустое состояние: wallet + «Нет операций — добавьте кнопками сверху».
- `to`-граница месяца вычисляется как реальный последний день месяца (не «-31»).

### 5.12 Настройки (`FinanceSettingsPage`)

- **Счета и стартовые балансы**: таблица Счёт (точка+имя) · Стартовый (инлайн-редактирование `startBalance`) · (в CRM также Доход/Расход) · Текущий (из `accountsBalances`) · ✎; футер-итого. `AccountModal`: название/тип/цвет из палитры 8 цветов. «＋ Счёт».
- **Директории** (универсальный список: заголовок, таблица, «＋ Добавить», ✎/🗑 с confirm, двойной клик — редактировать):
  - **Категории** — иконка+цвет+тип; бейдж «системная» (builtin: тип/удаление заблокированы). `CategoryModal`: название/тип/цвет/иконка из `ICON_NAMES`.
  - **Проекты/клиенты** — название (+бейджи «архив»/«по месяцам»), направление, контракт, тариф. `ProjectModal`: направление, тариф, дата контракта, **статус (lead/active/done/archived)**, для design — multiMonth, archived.
  - **Сотрудники** — `EmployeeModal`.
  - **Аренда и подписки** — `SubscriptionModal`.
  - **Долги** — + кнопка **«Пересобрать график»** (`regenerateDebtSchedule`). `DebtModal`. (⚠️ в эталоне из Settings-формы regenerate НЕ вызывался — только из формы на странице Долгов; в CRM он вызывается автоматически в createDebt/updateDebt + вручную кнопкой.)
- **Резервная копия**: Экспорт JSON (дамп всех таблиц; в CRM — Blob `finance-backup-YYYY-MM.json`, `version: 2`) / Импорт JSON (полная замена: reset → bulkAdd; при отсутствии accounts/categories — `seedDefaults`). Совместимо с backup-файлом WebRand.
- **Опасная зона**: «Сбросить все данные» (двойной confirm) → очистка всех 8 таблиц в правильном порядке + пересев.

### 5.13 OperationModal (универсальная модалка операции)

Табы: Доход / Расход / Перевод / **Накопление** (type-tabs: green/red/accent/violet). Режимы создания и редактирования. Поля по типу:
- общие: сумма (>0), дата, комментарий, категория (фильтр по типу);
- income: счёт-получатель + проект;
- expense: счёт-источник + сотрудник + долг (+subscriptionId при оплате из раздела подписок);
- transfer: со счёта / на счёт (валидация from ≠ to), категории нет;
- saving: счёт-получатель.
**Инлайн-создание категории**: пункт «＋ Новая категория…» → инпут → `createCategory({name, type})` → автоселект. Новая категория: серый `#64748b`, иконка-дефолт по типу, `group=undefined` → расход попадает в «Прочее». Подпись в модалке: «Новые категории (кроме ЗП/Аренды/Долгов) суммируются в Прочее». Кнопка сохранения заблокирована, пока не выполнена валидация (`canSave`).

---

## 6. Механики и формулы (детально)

### 6.1 Плановые оплаты: жизненный цикл expected/received

- `expected` — запланировано (дебиторка/график); `received` — получено/оплачено.
- **receive** (`POST /planned-payments/:id/receive`, body: accountId+date): в БД-транзакции создаётся связанная операция (`buildLinkedTx`): для проекта — **income** с категорией направления (smm/development/design) и `projectId`; для долга — **expense** с категорией «Долг» и `debtId`; затем `status='received'`, `receivedTxId=tx.id`.
- **unreceive**: удаляет связанную транзакцию, возвращает `expected`, `receivedTxId=null`.
- **payNow**: создаёт операцию + план сразу `received` (auto=false) — используется чекбоксом «Уже получено/оплачено» в ячейках матриц и `PayPartModal`.
- **removeTransaction**: для связанных планов (`receivedTxId = txId`): `auto=true` → план удаляется; ручной → возвращается в `expected`, `receivedTxId=null`.

### 6.2 «На счёт vs освоено»

Две метрики «получено»:
- `received` (всего) = Σ received-планов месяца по группе (проекты не archived) — включает «освоено вне счёта». Используется в **Обзоре** (fact плана/факта).
- `receivedCash` (на счёт) = то же, но ТОЛЬКО планы с `receivedTxId`. Используется в карточках страницы **Доход** и stat «Получено на счёт» в SMM.
- `spentOffAccount` («освоено вне счёта») = received БЕЗ `receivedTxId` — показывается sub-подписью в SMM-stat. Возникает только из посева/импорта (через UI receive/payNow всегда создаётся транзакция).

### 6.3 SMM: части 1/2 и алерт оплаты (`smmAlert(project, plans, today)`)

Цикл оплаты привязан ко **ДНЮ месяца из даты контракта**:

```
day    = день месяца contractDate (ISO симв. 8–9)
если нет contractDate или tariff <= 0 → null
anchor = дата с этим днём в ТЕКУЩЕМ месяце (с обрезкой по длине месяца);
         если anchor > today → берём предыдущий месяц
         (anchor = последний уже наступивший «день контракта» = начало текущего цикла)
если anchor < contractDate → null (цикл ещё не начался)
recv   = Σ received-планов проекта за месяц anchor (anchorYm)
если recv >= tariff → null (цикл оплачен)
если recv <= 0      → 'pay'  («получить оплату»: день настал, ничего не получено)
иначе daysIn = floor((today − anchor) / 86_400_000)
      если daysIn >= 24 → 'rest' («получить остаток»), иначе null
```

Смысл цикла: день 0 = Часть 1 («оплату»); **+24 дня** → пора добирать остаток (Часть 2, «остаток»); **~30 дней** → anchor сдвигается на следующий месяц = новый цикл. Счётчики `needPay`/`needRest` — количество проектов в каждом состоянии (для `AlertBar`).

### 6.4 Синхронизация журнал ↔ SMM-таблица (`syncSmmPartLink`)

Вызывается после каждого create/update транзакции:
- если операция `type='income'` + есть `projectId` + категория с key `smm1`/`smm2` → создаётся/обновляется **авто-план**: `{ projectId, ym = date.slice(0,7), partNo = 1|2 по категории, amount, status:'received', receivedTxId: tx.id, auto: true }`. Так доход, забитый в журнале с категорией «SMM часть N» и проектом, появляется в помесячной таблице SMM;
- если категория сменилась и больше не smm1/smm2 → авто-план удаляется;
- поиск существующего авто-плана — по `receivedTxId = txId AND auto = true`.

### 6.5 Матрицы Dev/Design и cap по тарифу

`buildMatrix(projects, planned, months)` — окно 6 месяцев:
- `rows[]`: `{ project{id,name,tariff,note,multiMonth}, paidLife, scheduledLife, cells[] }`, где `paidLife` = Σ received-планов проекта за ВСЮ историю; `scheduledLife` = Σ ВСЕХ планов проекта (любой статус); `cell = { ym, plans:[{id,amount,status,txId}], received, expected }`;
- `totals`: `{ tariff: Σ тарифов, perMonth:[{ym,total}] }`;
- старт окна по умолчанию = min{даты контрактов, ym планов, текущий месяц}.

**Cap-правила (важно, они разные!):**
- Dev/Design-матрица: **lifetime cap** — `remaining = tariff − scheduledLife`; нельзя запланировать/оплатить больше полного тарифа за всё время.
- SMM `PayPartModal`: **помесячный cap** — `remaining = tariff − Σ(планов проекта за этот ym)`; при этом колонка «Полная оплата» показывает lifetime `paidLife` — две разные метрики в одной таблице.
- Прогресс строки: `pct = min(100, round(paidLife / tariff × 100))`.

### 6.6 Авто-график долгов (`regenerateDebtSchedule(debtId)`)

```
monthly = debt.monthlyPayment ?? 0
удалить все expected-планы долга (received СОХРАНИТЬ)
если monthly <= 0 → выход (график ведётся вручную по ячейкам)
remaining = max(0, totalAmount − paidBefore − Σ received)
ym = currentYm()
пока remaining > 0 (guard ≤ 240 итераций):
    если в ym уже есть received-план → пропустить месяц
    иначе amount = min(monthly, remaining); создать expected-план {debtId, ym, amount}
    remaining −= amount; ym = shiftYm(ym, +1)
```

Последний месяц = остаток (пример: 12 100 при 2 539/мес → 2539×4 + 1944). В CRM вызывается автоматически из `createDebt`/`updateDebt` и вручную эндпоинтом `POST /finance/debts/:id/regenerate-schedule`.

### 6.7 Зарплата

```
salaryFund     = Σ salary  сотрудников status='active'
salaryAdvances = Σ advance сотрудников status='active'
salaryPaid     = Σ расходов месяца группы salary (есть employeeId ИЛИ категория key='salary')
salaryToPay    = max(0, salaryFund − salaryAdvances − salaryPaid)
```

Per-строка: `paid` = Σ расходов месяца с этим employeeId; статус «выплачено» = `salary>0 && paid>=salary`; `toPayRow = max(0, salary − paid)` (⚠️ аванс на уровне строки не вычитается — только в итоговой карточке; известное визуальное расхождение, см. §10). Дата выплаты по умолчанию — `${ym}-10`. Отмена (`cancelSalaryMonth`) — удалить salary-операции сотрудника за месяц. Уволенные не входят ни в фонд, ни в статусы.

### 6.8 Долги — остаток и «план месяца»

`debtRemaining = max(0, totalAmount − paidBefore − Σ расходов с debtId)`.
«План» долга считается двумя метриками с разным назначением (сведено 2026-07-04):
- **`monthly` (месячное обязательство)** = `Σ min(monthlyPayment, remaining)` — карточка «Долги» на странице Расход (`expenseSummary.debts.monthly`) и план/факт Обзора (`debtPlan`). На чистом сиде = **4 000** (Камера 3 500 + Мухаммаду 500) — совпадает со скриншотом эталона;
- **`dueMonth` (по графику)** = Σ expected-планов долгов текущего месяца — stat «Должны за месяц» в детали Долгов (§5.9).

### 6.9 Overview: план/факт и исключение lead

- План дохода направления = Σ `tariff` проектов направления со `status !== 'lead'` и не archived. Факт = Σ received-планов месяца по направлению (включая «освоено вне счёта»).
- План расхода: salary = `salaryToPay`; rent_subs = Σ active-подписок; debts = см. §6.8. Факт = Σ expense-операций месяца соответствующей группы (группа операции определяется по FK: employeeId→salary, subscriptionId→rent_subs, debtId→debts, иначе по key категории, иначе — Прочее).
- `expectedIncome` («Ожидается к получению») = Σ ВСЕХ expected-планов по проектам (без месяца, без долгов).
- `profit = income − expense` (transfer не влияет; saving в эталонном `monthlySeries` идёт в expense-ветку).
- ⚠️ Прямые доходные транзакции без плановой оплаты в план/факт направлений не попадают (но попадают в income месяца, разбивку по категориям и балансы) — фиксируем как осознанное поведение.

### 6.10 Архив и удаление проектов

`archive` → `archived=true` (эталон: `status='archived'`); `unarchive` → active. Архивные исключаются из активных таблиц и plan/fact, но история сохраняется. `deleteProject` — каскад: income-операции + планы + проект.

### 6.11 Форматирование

- `money(n, withSign?)` — `Intl.NumberFormat('ru-RU')`: целые без дробей, иначе 2 знака; суффикс « с.»; withSign добавляет «+».
- `formatDate(iso)` → «26 март 2026» (день + короткий месяц без точки + год, БЕЗ « г.»). `monthLabel(ym, long?)` — «июль 2026» / «июл. 26», без « г.». `ymOf = date.slice(0,7)`; `dueDateForMonth(ym, day)` — с обрезкой дня по длине месяца.

---

## 7. API-контракт CRM (префикс `/finance`; guards см. §1.3)

### 7.1 Дашборды и расчёты

| Метод/путь | Назначение | Параметры | Ответ |
|---|---|---|---|
| `GET /overview?ym=` | Дашборд месяца (без ym — текущий) | `ym` | `{ ym, income, expense, profit, balances[], incomeByCategory[], expenseByCategory[], incomePlan[], expensePlan[], stats{expectedIncome, salaryToPay, salaryFund, salaryAdvances, salaryPaid, totalDebt, subsMonthly}, transactions[] (decorated), + legacy-алиасы }` |
| `GET /income/directions?ym=` | Карточки 3 направлений | `ym` | по направлению: получено(cash)/план/кол-во проектов/expected |
| `GET /income/directions/:direction?ym=&start=` | Деталь направления | `direction: smm\|development\|design` | SMM: `{rows[{project, part1, part2, paidLife, fullyPaid, alert}], stats{expected, receivedCash, spentOffAccount, total}, totals{tariff,part1,part2,full}, needPay, needRest, archived[]}`; development: `{kind:'matrix', months, rows, totals, stats}`; design: `{simple[], matrix, stats}` |
| `GET /expense/summary?ym=` | 4 карточки расхода | `ym` | обязательство+факт по salary/subscriptions/debts/other |
| `GET /expense/detail/:kind?ym=&start=` | Деталь статьи | `kind: salary\|subscriptions\|debts\|other` | salary: `{cards, rows[{id,name,role,hireDate,salary,advance,status,paid,toPay}], fired[]}`; debts: матрица `{rows[{debt, remaining, progress, cells}], totals, stats{totalDebt,dueMonth,count}}`; subscriptions/other — таблицы |
| `GET /accounts/balances` | Балансы по счетам | — | `{ perAccount[{accountId,…,startBalance,income,expense,balance}], totals }` |

Форма `decorate()` транзакции: `id, date, type, amount, status, comment, categoryId/Name/Icon/Color, group (smm|development|design|salary|rent_subs|debts|null), projectId+projectName, employeeId+employeeName, debtId+debtName, subscriptionId, accountId+accountName, fromAccountId+fromAccountName, toAccountId+toAccountName`.

### 7.2 Транзакции

| Метод/путь | Назначение |
|---|---|
| `GET /transactions?type=&search=&from=&to=&page=&pageSize=` | Журнал (pageSize по умолчанию 100; search по comment+категории) |
| `POST /operations` | Создать операцию (createdById = req.user.id). Валидация: amount>0; transfer — разные from/to; income/expense/saving — accountId обязателен; income берёт projectId; expense — employeeId/debtId/subscriptionId; название категории дублируется в legacy-поле `category`. После — `syncSmmPartLink` |
| `PATCH /transactions/:id` | Инлайн-правка (после — `syncSmmPartLink`) |
| `DELETE /transactions/:id` | Удаление (связанные планы: auto → удалить, ручные → expected) |

### 7.3 Плановые оплаты

| Метод/путь | Тело | Назначение |
|---|---|---|
| `GET /planned-payments?projectId=&debtId=&ym=` | — | Список |
| `POST /planned-payments` | `{projectId?\|debtId?, ym /^\d{4}-\d{2}$/, partNo?, amount}` | Создать expected |
| `POST /planned-payments/pay-now` | `{…то же + accountId, date}` | Операция + received-план сразу |
| `POST /planned-payments/:id/receive` | `{accountId, date}` | Получить (создаёт связанную операцию) |
| `POST /planned-payments/:id/unreceive` | — | Отменить (удаляет операцию, → expected) |
| `DELETE /planned-payments/:id` | — | Удалить план |

### 7.4 Справочники — одинаковый CRUD (GET / POST / PATCH `:id` / DELETE `:id`)

`/accounts` · `/categories` · `/projects` · `/employees` · `/subscriptions` · `/debts` (+ `POST /debts/:id/regenerate-schedule`). Update-DTO = `PartialType(Create)`. Ограничения: счёт с операциями не удалить; builtin-категорию не удалить/не сменить type; удаление проекта каскадное; удаление долга удаляет график.

### 7.5 Бэкап и сброс

| Метод/путь | Назначение |
|---|---|
| `GET /backup/export` | Дамп всех 8 таблиц, `{version: 2, …}` |
| `POST /backup/import` | resetAll(false) → сохранить присланные массивы; без accounts/categories → seedDefaults |
| `POST /reset` | Очистка всех таблиц в правильном порядке + пересев (resetAll(true)) |

### 7.6 Что добавить (для полного паритета/развития)

1. **`GET /finance/trend?from=&to=`** — помесячный ряд `[{ym, income, expense, profit}]` (эталонная `monthlySeries`; transfer игнорировать, saving — решить: в expense-ветку как в эталоне или отдельно) — под будущую страницу «Динамика».
2. **`GET /finance/export/xlsx?scope=transactions|salary|debts|matrix&ym=`** — выгрузка таблиц в Excel/CSV (нет ни на бэке, ни на фронте).
3. В `incomeDirectionDetail('development'|'design')` добавить в stats `receivedCash`/`spentOffAccount` (сейчас различие «на счёт vs освоено» есть только в SMM).
4. `accountId` у Subscription/Debt (типовой счёт списания) — колонка + использование в «оплатить»/receive по умолчанию.
5. Унифицировать «план долгов за месяц» (§6.8) — один источник (график плановых).
6. Единый механизм архива проекта (`status='archived'` ↔ `archived` boolean) — оставить одно поле или жёстко синхронизировать; фильтр `lead` добавить и в `incomeDirectionDetail('smm')`.

---

## 8. UI-конвенции

- **Иконки**: минималистичные 2D line (в эталоне свой `Icon.tsx`: сетка 24×24, `stroke=currentColor`, `strokeWidth=1.7`, скруглённые концы, `fill=none`; в CRM — lucide через `ICON_MAP`, тоже line-стиль, цвет через currentColor). В `<option>` SVG не вставлять — только текст. Базовый набор имён: overview, income, expense, transactions, settings, currency, smm, development, design, salary, building, receipt, plus, close, edit, trash, archive, check, undo, copy, download, upload, arrowRight, chevronLeft/Right, car, printer, percent, target, dots, folder, checkCircle, wallet.
- **Валюта**: только сомони, «{число} с.» (ru-RU; целые — без дробей, иначе 2 знака). Отрицательных `amount` не бывает — знак задаёт тип.
- **Даты**: `formatDate` → «26 март 2026» (без « г.», короткий месяц без точки), `.nowrap`. `monthLabel` без « г.»; в переключателе месяца заглавная только первая буква (через `::first-letter`, НЕ `text-transform:capitalize`).
- **Цвета счетов**: Alif `#22c55e`, DC `#f59e0b`, Наличные `#94a3b8`. Палитра выбора (счета/категории): `#22c55e #3b82f6 #f59e0b #8b5cf6 #ef4444 #14b8a6 #ec4899 #6366f1`.
- **Цвета групп**: smm `#16a34a`, development `#0ea5e9`, design `#a855f7`, salary `#f97316`, rent_subs `#e11d48`, debts `#d97706`. Типы: income green / expense red `#e11d48` / transfer accent `#2563eb` / saving violet `#7c3aed`.
- **CSS-переменные эталона (светлая тема, dark нет)**: `--bg #f6f7f9`, `--surface #fff`, `--surface-2 #f1f3f6`, `--border #e7e9ee`, `--text #16191d`, `--muted #878d98`, `--accent #2563eb`(+soft `#eaf1ff`), `--green #16a34a`(+soft), `--red #e11d48`(+soft), `--amber #d97706`(+soft), `--violet #7c3aed`; `--radius 14px`, `--radius-sm 9px`.
- **Бейджи**: `.badge.income/expense/transfer/saving` (soft-фон+цвет); `.badge.ok` (зелёный, received/оплачено); `.badge.wait` (амбер, expected).
- **Таблицы**: `th` uppercase mini muted; `.num` right-align + `tabular-nums`; `tfoot` — жирный Итог с верхней рамкой; `.row-actions` появляются на hover; `.cell-input` — прозрачный инлайн-input с рамкой на hover. Прогресс-бары зелёные (долги — амбер). Широкие таблицы — в контейнере с horizontal scroll (`TableCard`).
- **Сетки/адаптив**: grid-2/3/4, балансы auto-fit minmax(190px), overview 1fr 1fr 300px; <1180px 4→2; <1000px сайдбар в иконки, 3→2; <720px — 1 колонка. Кликабельные карточки: pointer, accent-рамка на hover, сдвиг на active.
- **TYPE_LABEL**: income «Доход», expense «Расход», transfer «Перевод», saving «Накопление».

---

## 9. Важные баги/уроки эталона (НЕ повторять)

1. **Двойной сид (StrictMode)** — в эталоне лечился singleton-промисом + флагом `meta.seeded` в одной транзакции. В CRM: посев обязан быть идемпотентным (проверки `count()===0` / ON CONFLICT), запускаться один раз при старте.
2. **Пустые данные на первом рендере** — модалки, берущие «дефолтный счёт = первый», обязаны выставлять его через `useEffect` после загрузки списка (`if (!accountId && accounts.length) setAccountId(accounts[0].id)`), иначе сохранение молча не срабатывает (реальный баг ReceiveModal в эталоне). Не полагаться на «первый элемент» до загрузки query.
3. **Неявные связи** — в Dexie неиндексированные поля (`receivedTxId`, `subscriptionId`, `auto`) при `.where()` МОЛЧА ломали отмену оплат и удаления. Урок для CRM: связи «транзакция↔план» проектировать явными FK/индексами; поиск авто-планов — по индексированному `receivedTxId`.
4. **projectId/debtId у плана взаимоисключающи** — nullable FK + CHECK (или discriminated union в типах); в коде обрабатывать null (`ids.has(p.projectId ?? '')`).
5. **`window.confirm` в превью-окружениях авто-отклоняется** — при автоматизированном тестировании проверять результат удаления/отмены по данным БД/API, а не по UI.
6. **HMR** на крупных правках может «Failed to reload» — проверять production-build.
7. **React `onBlur`** = нативный `focusout`, не `blur` — важно при e2e-тестах инлайн-полей журнала.
8. **Два механизма архива** (boolean `archived` и `status='archived'`) могут рассинхронизироваться; `lead` фильтруется в overview/incomeDirections, но НЕ в `incomeDirectionDetail('smm')` — лиды попадают в таблицу SMM. Свести к одному источнику.
9. **Точка пересборки графика долга**: в эталоне `regenerateDebtSchedule` вызывался ТОЛЬКО из формы долга на странице Долгов (не из Settings) — в CRM решено вызывать в create/update + отдельной кнопкой; помнить, что regenerate стирает expected-планы (ручные правки графика).
10. **Устаревшие данные HANDOFF §13/§14** — не брать оттуда сид-значения; источник правды — backup JSON (§4).

---

## 10. ЧЕК-ЛИСТ ПАРИТЕТА (эталон fin-webrand ↔ CRM, на 2026-07-04)

| # | Фича | Эталон | В CRM сейчас | Что доделать |
|---|---|---|---|---|
| 1 | Обзор: балансы, пирог, план/факт, 4 stat, транзакции месяца | есть | **готово** (2026-07-04: список заменён полной таблицей §5.1 — Дата·Тип·Статья·Счёт·Клиент·Сумма, dblclick=редактировать) | — |
| 2 | Доход: 3 карточки направлений (cash-получено, expected по SMM) | есть | **готово** | — |
| 3 | SMM: части 1/2, PayPartModal/ReceiveModal, «Полная оплата», итоги | есть | **готово** | — |
| 4 | Алерты SMM «получить оплату/остаток» (день контракта, +24 дня) | есть | **готово** (`smmAlert` на сервере, `AlertBar`+бейджи на фронте) | — |
| 5 | «На счёт vs освоено» | SMM-таблица | **частично** (только SMM-деталь) | Добавить receivedCash/spentOffAccount в stats Development/Design (бэк+фронт) |
| 6 | Матрица Development (окно 6 мес, прогресс, lifetime cap) | есть | **готово** (`buildMatrix`, `MatrixTable`, `scheduledLife`) | — |
| 7 | Design: разовые работы + брендбуки-матрица | есть | **готово** | — |
| 8 | Архив проектов (свернуть/вернуть/удалить) | есть | **готово** (во всех 3 направлениях + настройки) | — |
| 9 | Зарплата: Фонд/Авансы/Выплачено/К выплате, выплата 10-го, отмена, уволенные | есть | **готово** | Опционально: per-row `toPay` не вычитает аванс (расхождение строки и итога) — решить и зафиксировать |
| 10 | Аренда+подписки: оплата/отмена/дата последней оплаты | есть | **готово** | Опционально: хранить `accountId` подписки (сейчас игнорируется при посеве), подставлять в оплату |
| 11 | Долги: матрица, авто-график regenerateDebtSchedule | есть | **готово** (2026-07-04: карточка «Долги» на Расходе показывает `monthly` = Σ min(платёж, остаток) — как эталон и Обзор; `dueMonth` остался для stat «Должны за месяц») | — |
| 12 | Прочее: гибкие категории, доли с ProgressBar | есть | **готово** | — |
| 13 | Транзакции: инлайн-журнал, quick-add, фильтры/поиск/пагинация | есть | **готово** | Quick-add «Накопление» отсутствует (в эталоне тоже — расхождения нет; добавить по желанию) |
| 14 | Категория на лету → «Прочее» | есть | **готово** (`OperationModal`) | — |
| 15 | syncSmmPartLink (журнал → SMM-таблица) | есть | **готово** (сервер) | — |
| 16 | Настройки: счета+балансы, справочники, статусы проектов | есть | **готово** (2026-07-04: добавлено инлайн-редактирование `startBalance` прямо в таблице счетов) | Статус `done` без спецповедения; `lead` не отфильтрован в SMM-детали; `archived`(bool) vs `status='archived'` — синхронизировать |
| 17 | Бэкап: экспорт/импорт JSON, сброс | есть | **готово** (version:2, совместим с backup WebRand) | — |
| 18 | Идемпотентный посев WebRand (точные сид-данные §4) | есть | **готово** (`seedWebRand`, встроенный снимок, резолв по именам) | Посев не проставляет `status` проектов (все active) — при необходимости добавить маппинг lead/done |
| 19 | Страница «Динамика/тренд» (помесячный income/expense/profit) | заготовка `monthlySeries` (UI не отрисован) | **НЕТ** (ни роута, ни эндпоинта; только pie за месяц) | Эндпоинт `GET /finance/trend` + вкладка/блок с line-графиком (recharts уже подключён) |
| 20 | Экспорт в Excel/CSV | нет (только JSON) | **НЕТ** | Если требуется: эндпоинт xlsx/csv + кнопки выгрузки (транзакции/ЗП/долги/матрицы) |
| 21 | Цвета счетов/палитра, иконки, « с.», форматы дат | есть | **готово** (`money`, `formatDate`, палитра 8 цветов, lucide-иконки) | — |
| 22 | Saving-операции и накопительные счета | базово | **базово готово** (в балансе учитываются) | Отдельного дашборда накоплений нет ни там, ни там |

### Исправления 2026-07-04 (доводка «данные не добавляются» и паритета)

1. **Доступ реально закрыт** — добавлен `FinanceAccessGuard` (классовые `@Roles/@RequirePerm` гарды не читали → финансы были открыты любому залогиненному). Проверено: manager → 403, founder → 200.
2. **`OperationModal`: счёт по умолчанию** через `useEffect` после загрузки списка (урок §9.2) — раньше кнопка «Добавить» была заблокирована, пока счёт не выбран вручную (выглядело как «данные не добавляются»).
3. **Баг `${ym}-31`** при отмене выплаты ЗП и оплаты подписки → `monthEndISO(ym)` (реальный последний день месяца); тот же хелпер переиспользован в журнале.
4. **`PATCH /transactions/:id` при смене типа чистит неприменимые поля** (§5.11): не-transfer → from/to=null; transfer → accountId/categoryId/привязки=null; income теряет employeeId/debtId/subscriptionId, expense — projectId. Проверено API: transfer→income обнуляет from/to.
5. **Цвета счетов** сеются/бэкфиллятся (§4.1): Alif `#22c55e`, DC `#f59e0b`, Наличные `#94a3b8` (раньше `color=null` — точки без цвета).
6. **Обзор**: «Транзакции за месяц» — полная таблица §5.1 вместо упрощённого списка.
7. **Настройки**: инлайн-редактирование `startBalance` в таблице счетов (§5.12), сохранение по blur/Enter.
8. **`formatDate`** — как в эталоне: «26 март 2026» → короткий месяц БЕЗ точки, без « г.».
9. **Карточка «Долги»** на Расходе = `monthly` (Σ min(платёж/мес, остаток)) = 4 000 на сиде — совпадает со скриншотом эталона.

**Резюме паритета:** ядро (журнал, планы, SMM-алерты, матрицы, зарплата, долги, подписки, посев, бэкап) — реализовано. Осталось (опционально; в эталоне этого тоже нет): (1) страница «Динамика» + trend-эндпоинт; (2) экспорт Excel; (3) «на счёт vs освоено» в Dev/Design; (4) консистентность статусов проекта (lead/done/archived); (5) мелочи: аванс в per-row toPay, accountId у подписок/долгов.
