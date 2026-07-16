# Sabt CRM — API-гайд для мобильного приложения (Flutter)

Пакет для разработчика мобильного клиента. Бэкенд уже готов и менять его не нужно:
приложение — обычный HTTP-клиент к существующему REST API + Socket.IO.

- **Прод API**: `https://sabtcrmsystem-production.up.railway.app/api`
- **OpenAPI-спецификация**: [`docs/openapi.json`](./openapi.json) — все 213 endpoint'ов со схемами.
  Можно сгенерировать Dart-клиент: `openapi-generator generate -i docs/openapi.json -g dart-dio`.
- Бэкенд: NestJS 10 + PostgreSQL. Веб-фронт: React (репозиторий `frontend/` — образец
  использования каждого endpoint'а, если что-то неочевидно).

---

## 1. Аутентификация (Bearer — уже поддерживается)

JWT. Веб использует httpOnly-cookie, но **все endpoint'ы одновременно принимают
`Authorization: Bearer <token>`** — мобильному клиенту cookies не нужны.

### Логин
```
POST /auth/login
{ "email": "...", "password": "..." }

200 → { "token": "<JWT, живёт 15 минут>",
        "refreshToken": "<живёт 30 дней>",
        "user": { id, name, email, role, secondaryRole, avatar, ... } }
```
- Если у пользователя включена 2FA — добавить поле `"twoFactorCode": "123456"`
  (TOTP из Google Authenticator). Без кода при включённой 2FA придёт 401.
- Rate limit: 10 попыток/мин.

### Обновление токена
```
POST /auth/refresh
{ "refreshToken": "<сохранённый>" }

200 → { "accessToken", "refreshToken", "user" }   // refresh РОТИРУЕТСЯ — сохранить новый!
```
Рекомендуемая схема во Flutter: interceptor (dio) — при 401 дёрнуть refresh,
повторить запрос; refreshToken хранить в `flutter_secure_storage`.

### Прочее
- `GET /auth/me` — профиль текущего пользователя (проверка живости токена).
- `POST /auth/logout` — инвалидация refresh-сессии.
- `POST /auth/heartbeat` — «я в сети», веб шлёт раз в несколько минут; желательно
  повторить (учёт рабочих сессий/часов).

## 2. Формат ошибок и правила API

- Ошибки NestJS: `{ "message": string | string[], "error": "...", "statusCode": 400 }`.
  `message` бывает массивом (ошибки валидации) — показывать первую/все.
- **Строгая валидация**: неизвестные поля в body → 400 (`property X should not exist`).
  Слать только те поля, что в OpenAPI-схеме.
- Даты-«дни» — строки `YYYY-MM-DD`; timestamps — ISO 8601 (UTC). Бизнес-таймзона —
  **Asia/Dushanbe (UTC+5)**: «сегодня» в продуктовой логике считается по ней.
- Деньги — сомони (`с.`/`смн`), числа.
- RBAC: у пользователя `role` + опционально `secondaryRole` (обе роли равноправны
  в проверках) + `extraPermissions` (персональные гранты). 403 = не показывать экран.

## 3. Роли (значение → русское название)

| role | Название |
|---|---|
| founder / co_founder | Основатель / Сооснователь |
| admin | Администратор |
| smm_director | Руководитель SMM |
| video_director | Руководитель по видеографии |
| smm_specialist | SMM специалист |
| storymaker | Сторисмейкер |
| designer | Дизайнер |
| videographer / video_editor | Видеограф / Монтажёр |
| organizer | Организатор |
| scriptwriter | Сценарист / SMM-менеджер |
| qa / publisher / targetologist | Контролёр / Публикатор / Таргетолог |
| sales_manager_smm / sales_manager_dev | Менеджеры продаж |
| pm_dev / developer | ПМ разработки / Разработчик |
| employee | Сотрудник (базовая) |

## 4. Endpoint'ы по экранам MVP

### Уведомления
- `GET /notifications` — список; `GET /notifications/unread-count`
- `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`
- У уведомления есть `link` (внутренний путь веба, например `/projects/:id`) —
  маппить на экраны приложения.

### Мои задачи + календарь
- `GET /tasks/my` — мои задачи; `GET /tasks/:id`; `GET /tasks/stats`
- `PATCH /tasks/:id` — статус `new|in_progress|done|cancelled`.
  ВАЖНО: исполнителям-«воркерам» нельзя ставить `done` без загруженного
  результата → 400 с понятным русским текстом (показать тост).
- `POST /tasks/:id/my-part-done` — «моя часть готова» (задачи с несколькими исполнителями)
- `GET /tasks/:id/assignees`, `.../checklist`, `.../comments`, `.../results` — детали
- `GET /calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD` — события: `task | project_start |
  project_end | client_meeting` (у task-событий есть `taskId`, `status`, `progress`)
- **Дедлайн обязателен** при создании задачи (`POST /tasks` без `deadline` → 400).

### Доска проектов (SMM-производство)
- `GET /workflow/all` — карточки в зоне видимости роли; `GET /workflow/my` — мои
- Этапы: `content_plan → organization → shooting → editing/design →
  internal_review → client_approval → ready_to_publish → published → ads`
- `POST /workflow/:id/transition { "action": "...", "payload": {} }` — движение вперёд.
  Действия: `confirm_plan, org_confirm, confirm_shoot, shoot_done, editing_done,
  cover_done, layout_done, qa_accept, qa_rework(payload.comment!), mark_sent_to_client,
  client_approve, client_revisions(payload.comment!), publish`
  Исполнитель карточки может сдавать свои производственные этапы независимо от роли.
- `POST /workflow/:id/item/:itemId/advance` — вынести свой элемент из групповой карточки
- `GET /workflow/upcoming-publications?days=2` — ролики к публикации (виджет публикатора)
- `GET /workflow/:id/events` — история карточки

### Истории (сторисмейкер)
- `GET /stories?from&to` (+`GET /stories/my`) — отметки
- `POST /stories { projectId, date: "YYYY-MM-DD", storiesCount }` — 0..30, будущие даты можно

### Проекты
- `GET /projects` — список с учётом роли (у менеджера продаж свои поля:
  `lastPaymentAt`, `nextPaymentDate`; дедлайн проекта ему не показывать)
- `GET /projects/:id` — деталка

### Отчёты СММ (только основатель)
- `GET /kpi/smm-daily?date=YYYY-MM-DD` — ежедневный автоотчёт команды
  (роль founder; остальным 403)

### Файлы и аватары
- `POST /files/upload?taskId=...|projectId=...` — multipart, поле `file`
  (jpg/png/gif/webp/pdf/docx/xlsx/…, до 25 МБ)
- `PATCH /users/me/avatar` — multipart, поле `avatar` (jpg/png/webp, до 2 МБ)
- Раздача: `https://<API-домен>/uploads/<path>` — аватары `/uploads/avatars/<filename>`,
  файлы задач — готовый `path` приходит в объекте файла.

## 5. Realtime (Socket.IO)

- URL: тот же домен, что API (без `/api`), стандартный path Socket.IO.
- Авторизация: `IO(url, auth: {'token': '<JWT>'})` — или заголовок `Authorization`.
  Невалидный токен → сервер рвёт соединение.
- События для инвалидации данных: `notification` (новое уведомление — сразу пуш-баннер
  в приложении), `tasks:changed`, `projects:changed`, `workflow:changed`.
- Flutter-пакет: `socket_io_client` (совместим с Socket.IO v4).

## 6. Push-уведомления (важно обсудить)

FCM на бэкенде пока НЕТ. Сейчас realtime — Socket.IO (только в открытом приложении)
и Telegram-бот. Для полноценных пушей: разработчик делает клиентскую часть FCM,
на бэкенде добавим endpoint регистрации FCM-токена и отправку — по запросу,
это небольшая доработка с нашей стороны.

## 7. Что нужно от заказчика разработчику

1. Доступ к репозиторию (`sabt_crm_system`)
2. Тестовые аккаунты на каждую роль MVP (НЕ прод-пароли реальных сотрудников)
3. Решение по скоупу MVP (рекомендация: уведомления, доска, мои задачи+календарь,
   истории, отчёты СММ для основателя; финансы — остаются в вебе)
4. Аккаунты Google Play / App Store
5. Иконка и название приложения

## 8. Ограничения и нюансы

- Rate limits: логин 10/мин, регистрация 5/мин, общий троттлинг на API — при 429
  повторить с задержкой.
- Access-токен 15 минут — без refresh-логики приложение будет «разлогиниваться».
- `GET /auth/sessions?days=7` — история сессий пользователя (для профиля).
- Пагинации в большинстве списков нет (объёмы небольшие) — но `tasks`/`notifications`
  ограничивать на клиенте.
- Цветовой код продукта: красный — только просрочка/ошибки, зелёный — только
  завершённое. Просьба соблюдать в UI приложения.
