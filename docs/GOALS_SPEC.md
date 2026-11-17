# Цели компании — «Компас компании» (каскад компания → отдел → сотрудник)

Решение владельца 16.11.2026: вариант 2 (каскад), этапы 1–3. Обратный расчёт
продаж (вариант 3) — позже, отдельной задачей. Макеты: холст «Каскад целей
компании» (Compass, Department, GoalEditor, PhoneGoals, PhoneCheckin).

Решения владельца:
- **Период — месяц** на всех уровнях (`ym` = `YYYY-MM`). Квартала нет.
- **Видимость:** цели и результаты компании видят все; сотрудник видит свою
  цепочку «моя цель → результат отдела → результат компании» и результаты
  своего отдела. Экраны отделов, «Требует внимания», цели и цифры по людям —
  только основатель/админ и руководители отделов.
- Премии к целям не привязываем.

## 1. Понятия

| Уровень | Сущность | Кто ставит |
|---|---|---|
| Компания | **Цель** (`goal_objectives`) — качественная формулировка, 2–4 **результата компании** (`goal_key_results`, level=`company`) | основатель/админ |
| Отдел | **Результат отдела** (`goal_key_results`, level=`department`), каждый работает на результат компании (`parentId`) | руководитель отдела, основатель/админ |
| Сотрудник | **Цель месяца** (`employee_goals`, уже есть, до 3 на месяц) + новое поле `keyResultId` → результат отдела (или компании) | руководитель отдела, основатель/админ (как сейчас) |

«Результат» (КР) — измеримый: источник цифры, цель (`target`), единица.

## 2. Отделы

Отдельной таблицы нет — отделы собираются из ролей (`backend/src/modules/goals/departments.ts`):

| key | Название | Роли (основная роль сотрудника) | Руководитель по умолчанию |
|---|---|---|---|
| `sales` | Продажи | sales_manager_smm, sales_manager_dev | основатель (founder) |
| `smm` | SMM-производство | smm_director, smm_specialist, designer, videographer, video_editor, producer, targetologist, stories_checker | активный пользователь с ролью (основной или второй) smm_director |
| `dev` | Разработка | dev_director, pm_dev, developer | активный пользователь с ролью (основной или второй) dev_director |
| `management` | Управление и финансы | admin, founder, employee | основатель (founder) |

- Член отдела — по **основной** роли (`users.role`), только `isActive = true`.
- Руководитель: переопределение в `goal_settings.leaders` (`{ sales?: userId, ... }`),
  иначе по умолчанию. Если по умолчанию несколько — первый по имени. Нет никого — основатель.
- Пользователь может руководить несколькими отделами (основатель — продажами и управлением).

## 3. Таблицы (миграция `1836000000000-CompanyGoals.ts`, всё `IF NOT EXISTS`)

```sql
goal_objectives (
  id uuid PK default uuid_generate_v4(),
  ym varchar(7) NOT NULL,
  title varchar(200) NOT NULL,
  "ownerId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "sortOrder" int NOT NULL DEFAULT 0,
  "createdById" uuid NULL,
  "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now()
)  -- index (ym)

goal_key_results (
  id uuid PK,
  ym varchar(7) NOT NULL,
  level varchar(16) NOT NULL,              -- 'company' | 'department'
  department varchar(16) NULL,             -- key отдела; NULL у company
  "objectiveId" uuid NULL REFERENCES goal_objectives(id) ON DELETE CASCADE,  -- только company
  "parentId" uuid NULL REFERENCES goal_key_results(id) ON DELETE SET NULL,   -- только department → company КР
  title varchar(200) NOT NULL,
  source varchar(40) NOT NULL DEFAULT 'manual',  -- ключ источника (§4)
  "sourceParams" jsonb NOT NULL DEFAULT '{}',    -- { direction?: 'smm'|'development', kpiKey?: string }
  target numeric(15,2) NOT NULL,
  unit varchar(12) NOT NULL DEFAULT 'count',     -- 'money' | 'count' | 'percent'
  "manualValue" numeric(15,2) NULL,              -- только source='manual'
  "ownerId" uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  "sortOrder" int NOT NULL DEFAULT 0,
  "createdById" uuid NULL,
  "createdAt", "updatedAt"
)  -- index (ym), (ym, department), (parentId)

goal_checkins (
  id uuid PK,
  "keyResultId" uuid NOT NULL REFERENCES goal_key_results(id) ON DELETE CASCADE,
  "weekStart" date NOT NULL,               -- понедельник недели по Душанбе
  status varchar(12) NOT NULL,             -- 'on_track' | 'at_risk' | 'off_track'
  comment text NULL,
  "userId" uuid NULL,
  "createdAt", "updatedAt",
  UNIQUE ("keyResultId", "weekStart")
)

goal_initiatives (
  id uuid PK,
  "keyResultId" uuid NOT NULL REFERENCES goal_key_results(id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL,               -- 'project' | 'task'
  "refId" uuid NOT NULL,
  "createdById" uuid NULL,
  "createdAt" timestamptz DEFAULT now(),
  UNIQUE ("keyResultId", kind, "refId")
)

goal_settings (key varchar(40) PK, value jsonb NOT NULL, "updatedById" uuid NULL, "updatedAt" timestamptz DEFAULT now())

ALTER TABLE employee_goals ADD COLUMN IF NOT EXISTS "keyResultId" uuid NULL
  REFERENCES goal_key_results(id) ON DELETE SET NULL;   -- + index
```

Плюс значения enum уведомлений (`notifications.type` — PG enum, см. миграцию 1822):
`goal_checkin`, `goal_digest`. `down()` удаляет таблицы и колонку (значения enum не трогает).
Модуль также дублирует DDL в `onModuleInit` (как clients/sales), чтобы сервер не падал без миграции.

## 4. Источники цифр (`backend/src/modules/goals/goal-sources.ts`)

Файл без DI Nest: функции принимают `DataSource`/`EntityManager` и окно
`{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }` (to = min(конец месяца, сегодня по Душанбе)).
Каждый источник отдаёт `{ value: number | null, detail?: string }`; `null` — нет данных.
Ошибка запроса → `value: null` + warn в лог (страница не падает).

`kind` определяет правило статуса (§5): `sum` — накапливается за месяц (есть темп);
`rate` — доля/процент, больше — лучше; `lower` — меньше — лучше.

| key | Название в UI | unit | kind | params | Что считаем |
|---|---|---|---|---|---|
| `revenue` | Финансы — полученные оплаты | money | sum | direction? (`smm`/`development`/`design`/`maintenance`) | Доход за период по правилам «Финансов» (то же, что отчёт/дашборд финансов считает доходом месяца: income, не cancelled, без переводов). direction — по направлению финансового проекта. |
| `overdue_share` | Финансы — просроченные оплаты | percent | lower | — | Из плановых оплат клиентов со сроком в [from, вчера] — доля суммы, не оплаченной к сроку (сейчас не оплачена или оплачена позже срока, если дата оплаты известна). detail: «N клиентов, сумма X с.» — текущие неоплаченные просрочки. Опираться на существующее определение просрочки в finance/smm-payments. |
| `smm_retention` | Финансы — удержание SMM-клиентов | percent | rate | — | Из SMM-клиентов, которые платили в прошлом месяце, доля тех, кто платит/должен платить в этом (не ушёл, проект не в архиве). Найти существующую логику активных SMM-клиентов (finance projects / smm-payments). |
| `won_deals` | Продажи — выигранные сделки | count | sum | direction?, ownerId? | Лиды, перешедшие в `won` в периоде. Дата выигрыша — как `wonRows` в sales-analytics.service.ts (lead_progress → handoffAt → updatedAt). |
| `new_leads` | Продажи — новые лиды | count | sum | direction?, ownerId? | `client_leads.createdAt` в периоде (по Душанбе). |
| `content_ontime` | Контент-план — публикации в срок | percent | rate | userId? | Как `deliveries` (kind=content, smm) в profile-stats.service.ts: карточки SMM-проектов (не сторис, не съёмки) со сроком в периоде ≤ сегодня; в срок = опубликовано не позже даты (день по Душанбе). userId — только проекты специалиста. |
| `tasks_ontime` | Задачи — выполнено в срок | percent | rate | department?, userId? | Задачи с дедлайном в периоде (≤ сейчас, не cancelled): доля сделанных к дедлайну. department=`dev` — задачи dev-проектов (типы из DEV_PROJECT_TYPES), `smm` — SMM-проектов; без него — все. userId — исполнитель (assigneeId или task_assignees). |
| `stories_norm` | Сторис — дни по норме | percent | rate | — | По всем активным SMM-проектам со сторис: доля пар (проект, день) периода, где сторис отмечены (логика как storyDays в profile-stats, но по всей компании). |
| `kpi_efficiency` | KPI — средняя эффективность | percent | rate | department? | Среднее `overallPercent` KpiService.getUserKpi за месяц по членам отдела (без noData). Без department — по всем, у кого есть KPI. |
| `rollup` | По результатам отделов | percent | rate | — | Только для КР компании: среднее `progress` (§5, 0–100, с потолком 100) привязанных результатов отделов. Нет привязанных — null. target фиксирован 100. |
| `manual` | Вручную | count/money/percent (выбирает автор) | sum | — | value = `manualValue` (ставит ответственный/руководитель). |

`trend` («+18 000 за неделю»): для источников с данными — value(from..to) − value(from..to−7 дней),
если to−7 ≥ from; иначе null. Для `manual` и `rollup` — null.

Кэш значений: 60 с на (source, params, ym) через `cachedResponse` (common/response-cache).

Цели месяца сотрудников (profile-stats) получают новые измеримые показатели, считаемые этими же функциями с `userId`/`ownerId` = сотрудник:
`won_deals` («Выигранные сделки», шт.), `content_ontime` («Публикации в срок», %), `tasks_ontime` («Задачи в срок», %).
Показываются в списке метрик только тем, кому подходят: won_deals — менеджерам продаж; content_ontime — smm_specialist; tasks_ontime — всем.

## 5. Статус и прогресс (`goals.logic.ts`, чистые функции + spec)

- `elapsed(ym, today)`: прошедший месяц → 1; будущий → 0; текущий → день/дней в месяце.
- `progress` (0–100+, для полосы): sum/rate → value/target·100; lower → value ≤ target ? 100 : target/value·100 (value=0 → 100). null при value=null.
- `pace` (черта на полосе): только sum → elapsed·100; иначе null.
- `status`:
  - value = null → `none`.
  - **sum**: value ≥ target → `on_track` (или `done`, если месяц прошёл); в первые 5 дней текущего месяца → `on_track`;
    иначе ratio = value / (target·elapsed): ≥ 0.9 → `on_track`, ≥ 0.7 → `at_risk`, иначе `off_track`.
    Прошедший месяц: value ≥ target → `done`, иначе `missed`.
  - **rate**: value ≥ target → `on_track`; value ≥ target − tol → `at_risk`; иначе `off_track`. tol = unit percent ? 3 (п.п.) : 5 % от target.
    Прошедший месяц: `done` / `missed`.
  - **lower**: value ≤ target → `on_track`; value ≤ target + tol → `at_risk`; иначе `off_track`. Прошедший — `done`/`missed`.
  - **manual**: value ≥ target → `done`; иначе статус последней отметки недели (если есть) или `none`.
- Статус отдела/цели = худший из статусов его КР (порядок: off_track/missed > at_risk > on_track > done > none).
- Отметка недели руководителя (`checkin.status`) показывается рядом, автоматический статус не перекрывает.

## 6. Доступ (`goals-access.ts`)

- `isTop` — role или secondaryRole ∈ {admin, founder}.
- `leads(user)` — ключи отделов, где он руководитель (§2).
- `details` = isTop || leads.length > 0.
- Цели и КР компании: читают все; создают/правят/удаляют — isTop.
- КР отдела: читают — details (все отделы) или члены отдела (свой отдел); правят — isTop или руководитель отдела.
- Отметка недели: КР отдела — isTop или руководитель отдела; КР компании — isTop или ownerId.
- `manualValue`: те же, кто может отметить статус.
- Инициативы: те же, кто правит КР.
- Цели месяца сотрудникам (profile-stats `canManage`): как сейчас + руководитель отдела (по §2) — членам своего отдела.
  `keyResultId` цели — КР того же `ym`; иначе 400.
- «Требует внимания», экран отдела, таблица людей, «Скопировать месяц», настройки руководителей — только details
  (настройки — только isTop).

## 7. API (`GoalsController`, префикс `/compass`, JwtAuthGuard)

Существующие `/goals/*` (цели месяца, profile-stats) не трогаем.

```
GET    /compass?ym=YYYY-MM                     → CompassView
GET    /compass/departments/:key?ym=           → DepartmentView        (details или член отдела; people — только details)
GET    /compass/sources?ym=                    → { sources: SourceMeta[], kpiKeys: {key,label}[] }
GET    /compass/sources/preview?source=&ym=&direction=&kpiKey=&department=  → { value, detail, unit }
POST   /compass/objectives                     { ym, title, ownerId? }            → CompassView
PATCH  /compass/objectives/:id                 { title?, ownerId?, sortOrder? }   → CompassView
DELETE /compass/objectives/:id                                                    → CompassView
POST   /compass/key-results                    KeyResultInput                      → KeyResultView
PATCH  /compass/key-results/:id                Partial<KeyResultInput> & { manualValue? } → KeyResultView
DELETE /compass/key-results/:id                                                   → { ok: true }
POST   /compass/key-results/:id/checkin        { status, comment? }               → KeyResultView   (неделя = текущая)
POST   /compass/key-results/:id/initiatives    { kind: 'project'|'task', refId }  → KeyResultView
DELETE /compass/initiatives/:id                                                   → { ok: true }
POST   /compass/key-results/:id/distribute     { items: [{ userId, target }] }    → { created: number, skipped: [{userId, reason}] }
GET    /compass/checkin                        → CheckinView (КР отделов, которыми руководит actor; КР компании, где он owner)
POST   /compass/checkin                        { items: [{ keyResultId, status, comment? }] } → CheckinView
POST   /compass/copy-month                     { fromYm, toYm }                   → { objectives, keyResults }  (isTop — всё; руководитель — свои отделы; уже существующие в toYm с тем же title не дублируются)
GET    /compass/settings                       → { leaders: Record<DeptKey, {id,name}|null>, overrides: Record<DeptKey, string|null>, candidates: {id,name,role}[] }   (isTop)
PUT    /compass/settings                       { leaders: Partial<Record<DeptKey, string|null>> } → то же
GET    /compass/people?search=                 → { id, name, role, department }[]  (для выбора ответственного; details)
```

`KeyResultInput`: `{ ym, level, department?, objectiveId?, parentId?, title, source, sourceParams?, target, unit?, ownerId?, sortOrder? }`.
Проверки: company → objectiveId обязателен и того же ym, department пуст; department → department ∈ ключи,
parentId (если есть) — company КР того же ym; source ∈ каталог; `rollup` только для company; target > 0;
unit для не-manual берётся из каталога; title 1–200.

`distribute` — только source `won_deals`, КР отдела `sales`: создаёт цели месяца сотрудникам
(title «N новых клиентов» / «N новых проектов» по направлению менеджера, metric `won_deals`, target, keyResultId),
лимит 3 цели на месяц соблюдается (skipped с reason).

Ответы — интерфейсы в `frontend/src/types/goals.ts` (единый источник формы ответа; бэкенд обязан совпадать).

### «Требует внимания» (`attention`, только details)
- КР со статусом off_track или at_risk (сначала off_track): «{title}: {value} при цели {target}».
- `overdue_share` КР или всегда (если есть просрочки): «N клиентов не платят больше 14 дней, сумма X с.» → ссылка `/finance`.
- Планы продаж vs выручка: если есть КР `revenue` уровня company и сумма `sales_plans.amount` за ym < target — «Планы продаж менеджеров X с., цель по выручке Y с. — не хватает Z с.» → ссылка `/employees/sales-plan`.
- Отделы, у которых есть КР, но нет отметки за текущую неделю (после понедельника) — «{Отдел} не отметил статус недели».
- Члены отдела без цели месяца (details): «{Отдел}: N сотрудников без цели на месяц».

## 8. Планировщики (`goals.scheduler.ts`, TZ Asia/Dushanbe)

- **Пн 10:00** — руководителям отделов, у которых есть КР текущего месяца: колокольчик (`goal_checkin`) + Telegram
  «Отметьте статус недели по целям отдела «{name}»» с кнопкой-ссылкой на `/compass?checkin=1`.
- **Вт 10:00** — основателям (role founder, активные): дайджест (`goal_digest`), только если есть что сказать:
  КР off_track/at_risk и отделы без отметки этой недели. Ссылка `/compass`.
- **1-е число 10:00** — если на новый месяц нет целей компании, а в прошлом были: основателям «Поставьте цели на {месяц}» →
  `/compass` (там кнопка «Перенести цели прошлого месяца»). Руководителям отделов — то же про результаты отдела.
- Ссылки в Telegram — как в существующих напоминаниях (базовый URL фронтенда из того же места, что использует TelegramService/FinanceScheduler).

## 9. Фронтенд

- Маршрут `/compass` («Компас») — всем ролям; в боковом меню и в «Ещё» на телефоне. `/compass/:dept` — отдел.
- **CompassPage**: переключатель месяца (◀ ноябрь 2026 ▶), «прошло N % месяца · до конца N дней», счётчики статусов;
  isTop — «Новая цель», «Перенести цели прошлого месяца» (если месяц пуст), «Руководители отделов» (настройки).
  Цели (карточки) → КР строками: название, отделы, которые на него работают, источник, факт / цель, полоса с чертой темпа,
  тренд за неделю, отметка недели, статус-чип. Справа «Требует внимания» (details). Ниже «Отделы» (details: все; иначе — свой).
  Сотрудник (не details): цели компании + «Моя цепочка» (мои цели месяца → КР отдела → КР компании) + КР своего отдела.
  `?checkin=1` открывает лист отметки недели.
- **DepartmentPage** `/compass/:dept`: КР отдела (на что работает, комментарий отметки, статусы последних 5 недель,
  «Что работает на результат» — инициативы + «Привязать проект или задачу»), «Отметить статус недели»,
  «Новый результат», таблица «Цели людей · {месяц}» (сотрудник, роль, цель, прогресс, на что работает, статус;
  «нет цели» подсвечено, кнопка «Поставить цель» ведёт в карточку сотрудника `/employees/:id`).
- **KeyResultModal** (макет GoalEditor): уровень, отдел, «Работает на» (цель компании / результат компании),
  название, источник (радио-карточки с подсказкой) + параметры + «Сейчас по этому источнику: N», цель + единица,
  ответственный, для won_deals в отделе sales — «Разложить по менеджерам».
- **CheckinSheet** (макет PhoneCheckin): по каждому КР — «В графике / Риск / Отстаём» + комментарий; «Отправить статус».
- **Цели месяца сотрудника**: в редакторе (EmployeeGoals) — выбор «Работает на» (КР отдела сотрудника и компании за этот месяц)
  и новые показатели; в профиле (ProfileStats «Мои цели») — цепочка «→ отдел … · → компания …».
- Формат: деньги `141 000 с.`, проценты `93 %`, шт. — число. Цвета статусов: on_track/done — зелёный, at_risk — жёлтый,
  off_track/missed — красный, none — серый. Тексты — по-русски, без жаргона.

## 10. Не входит

Обратный расчёт продаж, квартальные/годовые цели, премии за цели, история значений КР по дням (тренд считается на лету).
