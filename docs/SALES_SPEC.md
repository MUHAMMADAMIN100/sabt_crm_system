# Продажи, этап 2 — договор API и правила (15.11.2026)

Единый источник правды для бэкенда и фронтенда роли «менеджер продаж»
(`sales_manager_smm`, `sales_manager_dev`; учитывать и `secondaryRole`).
Макеты: холст «Роль менеджера продаж» (Сегодня, Единая воронка, Карточка
лида, Передать в работу, Аналитика, телефон).

Схема — миграции `1834-SalesFunnelSchema` и `1835-SalesFunnelData`.
Общий код:
- `backend/src/modules/clients/lead-events.ts` — `recordLeadEvent()`;
- `backend/src/modules/clients/sales-settings.ts` — нормы KPI и комиссия;
- `frontend/src/types/sales.ts`, `frontend/src/services/sales.api.ts`,
  `frontend/src/lib/salesStages.ts`.

Время — Asia/Dushanbe (UTC+5), сервер в UTC. Даты `YYYY-MM-DD` — по
Душанбе. Деньги — сомони, «с.».

---

## 1. Единая воронка

Этап лида — только `status`. «Этап онбординга» (`onboardingStage`) больше
не используется и не показывается (колонка остаётся как история).

| status | Название | Вероятность по умолчанию |
|---|---|---|
| `new` | Новый | 10 |
| `waiting` | Контакт | 25 |
| `meeting` | Встреча | 40 |
| `proposal` | КП | 60 |
| `contract` | Договор | 80 |
| `won` | Выиграно | 100 |
| `lost` | Проиграно | 0 |

- Устаревшие `negotiating`, `on_hold`, `unknown` перенесены миграцией 1835;
  DTO их не принимает (400). Если встретятся в старых данных — показывать
  как «Контакт» / «Контакт» / «Новый».
- «На паузе» — флаг `onHold: boolean`, не этап.
- `lost` требует `lostReason` из списка: `price` Дорого, `competitor` Есть
  подрядчик, `not_lpr` Говорили не с ЛПР, `no_response` Пропал, не отвечает,
  `not_needed` Не нужно сейчас, `other` Другое (для `other` обязателен текст
  в `rejectionReason`). Без причины → 400 «Укажите причину проигрыша».
- KPI «Продвижения по воронке»: +1 только за первое достижение лидом этапа
  дальше прежнего (как раньше, вехи). Создание лида сразу в этапе дальше
  «Новый» продвижения не даёт. Достижения старых этапов онбординга в
  `lead_progress` эквивалентны: `meeting`≡stage `meeting`, `proposal`≡
  `kp_creation`, `contract`≡`contract`, `won`≡`implementation`,
  `waiting`≡`negotiation` (повторно не засчитываются).

## 2. Новые поля лида (`client_leads`)

`onHold` boolean · `nextStepAt` timestamptz (текст шага — `nextStep`) ·
`probability` int|null (null = по этапу) · `expectedCloseAt` date|null ·
`lostReason` varchar|null · `meetingResult` 'held'|'missed'|null (итог
текущей встречи `nextContactAt`; сбрасывается в null при переносе встречи) ·
`handoffAt`, `handoffById`, `handoffData` jsonb · `projectId` uuid|null.
`projects.leadId` uuid|null.

Ответ API лида (везде, где отдаётся лид) дополнительно содержит
`owner: { id, name } | null`.

## 3. Лента событий — `lead_events`

`{ id, leadId, userId, kind, data, createdAt }`, kinds — см.
`LeadEventKind` в `lead-events.ts`. Пишут:
- **ClientsService**: `created` (при создании), `stage` (смена status,
  data `{from,to,lostReason?}`), `owner`, `meeting_set` (новое/изменённое
  `nextContactAt`), `next_step` (изменились `nextStep`/`nextStepAt`),
  `hold` (смена `onHold`), `email` (когда `emailStatus` впервые стал `sent`
  через PATCH).
- **SalesService**: `call`, `email`, `meeting_done`, `meeting_missed`,
  `comment`, `handoff`, `project_linked`.
- **ProjectsService**: `project_linked` при создании проекта с `leadId`.

## 4. API модуля clients (`/api/clients`, ClientsService)

Существующие маршруты сохраняются. Изменения:

- `GET /clients` — как раньше (массив, лимит 500, для голосового помощника
  и старых экранов), в каждом элементе `owner`.
- **`GET /clients/list`** — список с серверной пагинацией.
  Параметры: `search`, `status` (через запятую), `interest`, `sphere`,
  `source`, `owner` = `me` | `all` | uuid (по умолчанию `me` для МП, `all`
  для руководства), `due` = `overdue` | `today` | `none` (без следующего
  шага), `hold` = `1` | `0`, `page` (1..), `pageSize` (10..100, по
  умолчанию 20), `sort` = `next` (ближайший контакт/шаг, по умолчанию) |
  `updated` | `created` | `potential`.
  Ответ: `{ items: Lead[], total, page, pageSize }`.
  «Ближайшее действие» лида = min(`nextContactAt` без итога встречи,
  `repeatCallAt`, `nextStepAt`). `overdue` — оно в прошлом; `today` —
  сегодня по Душанбе; `none` — нет ни одного в будущем и этап активный.
- **`GET /clients/board`** — все активные лиды для доски: этапы
  new…contract, плюс won/lost, изменённые за последние 30 дней. Параметры
  `owner`, `search`. Без лимита 500 (жёсткий предел 3000). Ответ
  `{ items: Lead[] }`.
- `POST /clients` — тело как раньше + новые поля + `force?: boolean`.
  Проверка дублей (в том же направлении): телефон (последние 9 цифр),
  Instagram (без `@`, без `instagram.com/`, нижний регистр), название
  (без регистра и пробелов по краям). Найдены и `force` не true → **409**
  `{ message: 'duplicate', duplicates: [{ id, name, status, ownerName }] }`.
  То же для создания лида из Директа и голосом (голос — сообщает о дубле).
- `PATCH /clients/:id` — новые поля; `status` только из списка §1;
  `lost` без причины → 400; `ownerId` — только пользователь с ролью
  продаж своего направления (или руководство); МП может передать **свой**
  лид другому МП того же направления; руководство — любой.
- **`POST /clients/:id/claim`** — взять себе лид без владельца своего
  направления. Ответ — лид.
- `DELETE /clients/:id` — лиды без владельца удаляет только руководство.
- `callType` ∈ `cold|neutral|hot|repeat`, `emailStatus` ∈
  `sent|answered|no_reply|rejected` — иначе 400.
- `GET /clients/stats` — «Открытый потенциал» без `won` и `lost`;
  новое поле `forecast` = Σ `dealPotential` × вероятность (своя или по
  этапу) / 100 по активным.
- `GET /clients/kpi` — нормы из `sales_settings` по направлению МП;
  метрика `meetings` считает только встречи, отмеченные «состоялась»
  (`lead_actions kind='meeting'` пишет SalesService); при назначении встречи
  в KPI больше ничего не пишется. Подпись `cold_calls` — «Звонки».
  Ключи метрик прежние.
- Напоминания о встречах и календарь пропускают `won`, `lost` и встречи с
  `meetingResult`.
- Отметка «Позвонить» от руководителя уходит и в Telegram.

## 5. API модуля sales (`/api/sales`, SalesService)

Все — `JwtAuthGuard` + права. Доступ к лиду: владелец; лид без владельца
своего направления — любой МП направления; руководство — любой.

- **`GET /sales/agenda`** → `{ overdue: AgendaItem[], today: AgendaItem[],
  tomorrow: AgendaItem[], attention: AgendaItem[] }` — по своим лидам
  (`ownerId = me`).
  `AgendaItem = { id, kind, at, leadId, leadName, status, onHold, note,
  phone, potential }`; `kind` = `meeting` | `callback` | `next_step` |
  `no_step` | `stale`. `id` — `${kind}:${leadId}`.
  - `meeting` — `nextContactAt`, `meetingResult` null;
  - `callback` — `repeatCallAt`; `next_step` — `nextStepAt` (note = `nextStep`);
  - просроченные — `at` < сейчас; today/tomorrow — по дню Душанбе;
  - `attention`: активные без будущего действия (`no_step`, до 20) и без
    активности 7+ дней (`stale`, до 20), `at` = null;
  - только активные этапы (new…contract), `onHold` — пропускать.
  Оплаты клиентов и свои задачи фронт берёт из существующих API.
- **`POST /sales/leads/:id/calls`** — тело
  `{ result: 'reached'|'no_answer'|'busy', outcome?: 'interested'|'wants_kp'|'thinking'|'later'|'refused', comment?: string ≤2000, next?: { kind: 'callback'|'meeting'|'step', at: ISO, text?: string ≤500 } }`.
  Эффект: событие `call`; `lead_actions kind='cold_call'` (не чаще 1 на лид
  в день, как сейчас); `lastContactAt` = сегодня, `lastActivityAt` = now;
  `callType` = `cold`, если пусто; `next`: callback → `repeatCallAt`,
  meeting → `nextContactAt` (+`meetingResult`=null, событие `meeting_set`),
  step → `nextStep`/`nextStepAt` (событие `next_step`). `result='reached'` у
  лида в `new` → этап `waiting` (с продвижением воронки). Ответ — лид.
- **`POST /sales/leads/:id/emails`** `{ comment? }` → событие `email`,
  `lead_actions kind='email'` (1 на лид в день), `emailStatus`='sent' если
  пусто. Ответ — лид.
- **`POST /sales/leads/:id/meeting`** `{ held: boolean, comment?, next? }`
  (next — как у звонка) → held: `meetingResult`='held', событие
  `meeting_done`, `lead_actions kind='meeting'` (1 на лид в день, at = now);
  этап `new`/`waiting` → `meeting`. Не состоялась: `meetingResult`='missed',
  событие `meeting_missed`. Нужна назначенная встреча (`nextContactAt`) не
  позже конца сегодняшнего дня, иначе 400. Ответ — лид.
- **`GET /sales/leads/:id/events`** → `LeadEvent[]` новые сверху, до 200:
  `{ id, kind, data, createdAt, user: { id, name } | null }`.
- **`POST /sales/leads/:id/comments`** `{ text: 1..2000 }` → `LeadEvent`.
- **`POST /sales/leads/:id/handoff`** — тело
  `{ direction: 'smm'|'development', product: string ≤200, amount: number > 0, firstPaymentAt: 'YYYY-MM-DD', note?: string ≤2000, sendBrief?: boolean }`.
  Эффект: этап `won` (через ClientsService — с продвижением воронки),
  `handoffAt/handoffById/handoffData`, событие `handoff`; уведомление в CRM
  и Telegram основателю, сооснователю и руководителю направления
  (`smm_director` / `dev_director`); задача руководителю направления (нет —
  основателю) «Создать проект: <лид>» со сроком завтра и данными передачи.
  Повторная передача → 409. Ответ — лид.
- **`GET /sales/handoffs?status=open|done`** — руководство и директора
  направлений: лиды с `handoffAt`; open — `projectId` null. Ответ
  `Handoff[] = { leadId, leadName, direction, product, amount,
  firstPaymentAt, note, sendBrief, handoffAt, manager: { id, name },
  projectId, contactPerson, contactPhone, contactInstagram }`.
- **`POST /sales/handoffs/:leadId/link`** `{ projectId }` — связать лид с
  проектом: `client_leads.projectId`, `projects.leadId`, событие
  `project_linked`, уведомление менеджеру «Проект создан». Руководство.
- **`GET /sales/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&direction=smm|development`**
  — руководство (`clients.kpi.all`). Ответ:
  ```
  { period: { from, to },
    totals: { leads, won, conversion, cycleDaysMedian, received|null, plan|null, expected|null },
    funnel: [{ status, count, conversionFromPrev|null }],   // new…won: лиды периода, дошедшие до этапа
    bySource: [{ source, leads, won, conversion }],
    byManager: [{ userId, name, role, leads, meetingsHeld, won, received|null, plan|null, kpiPercent|null }],
    lostReasons: [{ reason, count }] }
  ```
  «Лиды периода» — созданные в периоде; «дошёл до этапа» — текущий этап не
  ниже или веха в `lead_progress`. `cycleDaysMedian` — медиана дней от
  создания до `won` для выигранных в периоде.
- **`GET /sales/settings`** → `{ norms: { smm: Norms, development: Norms },
  commission: { [userId]: percent }, managers: [{ id, name, role }] }`.
  Читать: руководство; МП — только нормы и свой процент.
  **`PUT /sales/settings`** `{ norms?, commission? }` — основатель (нормы —
  ещё сооснователь и админ). `Norms = { funnel_progress, new_companies,
  cold_calls, personal_emails, meetings }` — целые 0..500.

## 6. Другие модули

- **Деньги только своих**: `/analytics/sales` для МП — только свои проекты
  (иначе 403); `stripFinance` для МП оставляет суммы только своих проектов;
  `/projects/:id/payments` и `send-payment-request` — только свой проект;
  запрос оплаты считает долг по «Финансам», а без связи с «Финансами» —
  400 с понятным текстом.
- **KPI один**: `/kpi/user` для ролей продаж (основной или второй) отдаёт
  те же 5 метрик и тот же процент, что `/clients/kpi`.
- **Напоминания**: утренний план (09:00) — плюс просроченные шаги,
  перезвоны и встречи без итога по своим лидам и число лидов без касания
  7+ дней; вечерний разбор (18:00) — плюс невыполненное по лидам за
  сегодня; менеджеру — просроченные оплаты своих клиентов (утром, до 5).
- **«Контроль» SMM**: отмечают только МП по SMM (и руководство), и только
  по своим проектам.
- **План продаж**: `GET` своего плана отдаёт ещё `commissionPercent|null`,
  `commissionAmount|null` (= получено × процент / 100) и
  `history: [{ ym, plan, received }]` за 6 прошлых месяцев.
- **Проекты**: `CreateProjectDto.leadId?` — при создании связать лид
  (как `POST /sales/handoffs/:leadId/link`). Создавать проекты МП
  по-прежнему не могут.

## 7. Интерфейс (кратко; детали — макеты)

- **Сегодня** (Панель МП): лента «Просрочено / Сегодня / Завтра» из
  `/sales/agenda` + оплаты клиентов + свои задачи; блок «Требует
  внимания» (`attention`); справа — план продаж (с комиссией, если задана),
  KPI с пояснением правил, оплаты клиентов.
- **Клиенты**: вид «Воронка» (`/clients/board`) и «Список»
  (`/clients/list`), чипы «Мои/Все», «Просрочено», «Сегодня», «Без шага»;
  на телефоне — карточки. Этап меняется кнопкой «→» и в карточке лида.
- **Карточка лида** (правая панель / шторка на телефоне): этапы, действия
  «Звонок / Письмо / Встреча / Директ», следующий шаг, сделка, контакты,
  история (`/sales/leads/:id/events`) и комментарий. Полная форма — «Все
  поля».
- **Звонок**: шторка «Результат / Итог / Комментарий / Следующий шаг».
- **Проиграно**: окно с причиной из списка. **Выиграно**: окно «Передать в
  работу».
- **Телефон**: нижняя панель МП «Сегодня · Клиенты · + · Директ · Ещё»;
  «+» — Новый лид / Звонок / Встреча.
- **Основатель**: «Аналитика продаж», «Заявки от продаж» (передачи) с
  созданием проекта по заявке, настройки норм и комиссии.
- «Онбординг» — перенаправление на «Клиенты», вид «Воронка».
