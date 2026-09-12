# Sabt — CRM/ERP агентства WeBrand

Внутренняя система SMM-агентства WeBrand (Душанбе). Закрывает полный цикл работы
агентства: **лид → проект и тариф → производство контента → публикация → реклама →
финансы → зарплаты и KPI**. Три направления: SMM-сопровождение, разработка
(сайты, боты, CRM, магазины), дизайн.

Интерфейс русский, валюта — сомони (TJS).

> **Полное техническое задание — в [`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md).** Это главный
> документ системы: модули, все роли, бизнес-правила. Финансовый модуль описан
> отдельно в [`FINANCE_SPEC.md`](FINANCE_SPEC.md).

---

## Стек

**Бэкенд** — NestJS 10, TypeORM, PostgreSQL (Supabase), Socket.IO, Passport/JWT.
JWT живёт в httpOnly-cookie, есть refresh-токены с ротацией, 2FA (TOTP),
rate-limit, журнал безопасности, строгий CORS-allowlist.

**Фронтенд** — React 18, Vite, TypeScript, Tailwind, Zustand, TanStack Query v5,
socket.io-client. Все страницы грузятся лениво; тема тёмная (зафиксирована для
всей компании), акцентный цвет задаётся основателем и раздаётся всем.

**Деплой** — бэкенд на Railway (авто из `main`), фронтенд на Vercel, база — Supabase.
Миграции на проде применяются при старте (`migrationsRun`), `synchronize` выключен.

---

## Разделы системы

| Раздел | Что внутри |
|---|---|
| **Панель** | Ролевой дашборд: у основателя — пульс компании, у руководителей — нагрузка команды, у SMM-специалиста — панель дня (календарь + отметки) |
| **СММ** | Умный календарь (производство контента), Сторисы, Проекты со схемой нагрузки специалистов |
| **Финансы** | Обзор, доход/расход по направлениям, планирование, транзакции, инвентарь, зарплаты. Доступ по гранту `finance.manage` |
| **Задачи** | Поручения от руководства, мультиисполнители, чек-листы, результаты, тайм-трекер |
| **Календарь** | Задачи с дедлайнами, съёмки, дни рождения |
| **Сотрудники** | Кадры, KPI, доступы, оргструктура |
| **База клиентов** | Лиды и воронка продаж, онбординг |
| **Аналитика, Риски, Архив, Файлы, ИИ-помощник** | Вспомогательные разделы |

**Роли** — 21 (от основателя до исполнителей), плюс необязательная вторая роль и
персональные гранты поверх роли, выдаваемые на странице «Доступы сотрудников».
Подробная таблица — в [`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md), раздел 3.

---

## Структура репозитория

```
sabt_crm_system/
├── backend/            # NestJS: 34 модуля, ~44 сущности, миграции
│   └── src/
│       ├── modules/    # auth, users, projects, content-plan, stories,
│       │               # finance, kpi, tasks, clients, telegram, …
│       ├── common/     # сегментация по направлениям, общие утилиты
│       └── database/   # миграции TypeORM
├── frontend/           # React SPA
│   └── src/
│       ├── pages/      # dashboard, smm, finance, tasks, employees, …
│       ├── components/ # UI, проекты, сторис, KPI
│       ├── services/   # API-слой (axios)
│       ├── store/      # Zustand (auth, тема)
│       └── lib/        # права, тема, утилиты
├── docs/               # MOBILE_API, обзор финмодуля, безопасность, openapi.json
├── fin-webrand/        # Автономный прототип финмодуля (эталон-референс, не деплоится)
└── SYSTEM_PROMPT.md    # Главный документ системы
```

---

## Запуск локально

Нужны Node.js 18+ и доступ к PostgreSQL (проще всего — строка подключения от Supabase).

```bash
npm install                      # монорепо: npm workspaces

# бэкенд
cd backend
cp .env.example .env             # заполнить DATABASE_URL и JWT_SECRET
npm run start:dev                # http://localhost:3000/api, Swagger на /api/docs

# фронтенд (в другом терминале)
cd frontend
npm run dev                      # http://localhost:5173
```

Обязательные переменные бэкенда — `DATABASE_URL` и `JWT_SECRET` (минимум 32 символа):
без них приложение намеренно не стартует. Остальные (Brevo, Telegram, Gemini,
`META_VERIFY_TOKEN`) необязательны — соответствующие интеграции просто отключаются.

В dev-режиме схема синхронизируется автоматически (`synchronize: on`); на проде —
только миграциями.

---

## Полезные команды

```bash
# бэкенд
npm run start:dev            # разработка с hot-reload
npm run build                # сборка
npm run test                 # юнит-тесты
npm run migration:generate   # сгенерировать миграцию по изменениям сущностей
npm run migration:run        # применить миграции

# фронтенд
npm run dev                  # разработка
npm run build                # tsc + vite build (здесь ловятся ошибки типов)
npm run test                 # vitest
```

---

## Документация

| Файл | О чём |
|---|---|
| [`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md) | Главный документ: модули, роли, бизнес-правила |
| [`FINANCE_SPEC.md`](FINANCE_SPEC.md) | Спецификация финансового модуля |
| [`docs/MOBILE_API.md`](docs/MOBILE_API.md) | Гайд по API для мобильного приложения |
| [`docs/SECURITY_AND_BACKUP.md`](docs/SECURITY_AND_BACKUP.md) | Секреты, бэкапы, операционные проверки |
| [`docs/FINANCE_MODULE_REVIEW.md`](docs/FINANCE_MODULE_REVIEW.md) | Аудит и история финмодуля |
| [`docs/openapi.json`](docs/openapi.json) | Машинная спецификация эндпоинтов |
