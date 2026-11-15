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

200 → { "token": "<JWT без срока жизни — отзывается сервером: блокировка,
                  смена пароля, деактивация>",
        "refreshToken": "<до 10 лет, ротируется при каждом обновлении>",
        "user": { id, name, email, role, secondaryRole, avatar, ... } }
```
- Если у пользователя включена 2FA — добавить поле `"twoFactorCode": "123456"`
  (TOTP из Google Authenticator). Без кода при включённой 2FA придёт 401.
- Rate limit: 10 попыток/мин.
- `user.mustChangePassword: true` — пароль временный (выдал администратор) или
  старый общий: веб не пускает дальше окна смены пароля
  (`PATCH /auth/change-password`); приложению стоит делать так же.

### Обновление токена
```
POST /auth/refresh
{ "refreshToken": "<сохранённый>" }

200 → { "accessToken", "refreshToken", "user" }   // refresh РОТИРУЕТСЯ — сохранить новый!
```
Рекомендуемая схема во Flutter: interceptor (dio) — при 401 дёрнуть refresh,
повторить запрос; refreshToken хранить в `flutter_secure_storage`.
Лимит: 30 обновлений/мин. Неверный текущий пароль при смене пароля — 400 (не 401).

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
| founder | Основатель |
| admin | Администратор |
| smm_director | Руководитель SMM |
| smm_specialist | SMM специалист |
| designer | Дизайнер |
| videographer / video_editor | Видеограф / Монтажёр |
| targetologist | Таргетолог |
| stories_checker | Проверяющий сторис |
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

### СММ-производство («Умный календарь»)
Доска проектов (`/workflow/*`) удалена в сентябре 2026. Производство контента —
в «Умном календаре»:
- `GET /content-plan/smm-calendar?from&to` — публикации и задачи подготовки
  (у каждого проекта флаг `mine` — свой ли он пользователю)
- `PATCH /content-plan/smart-item/:id` — перенос даты / статус / отметка TikTok
  (SMM-специалист — только по своим проектам)
- `GET /content-plan/my-work`, `PATCH /content-plan/my-work/:id` — карточки
  подготовки (съёмка/монтаж/дизайн) исполнителя

### Истории (сторисмейкер)
- `GET /stories?from&to` (+`GET /stories/my`) — отметки
- `POST /stories { projectId, date: "YYYY-MM-DD", storiesCount }` — 0..30, будущие даты можно

### Проекты
- `GET /projects` — список с учётом роли (у менеджера продаж свои поля:
  `lastPaymentAt`, `nextPaymentDate`; дедлайн проекта ему не показывать)
- `GET /projects/:id` — деталка

### Файлы и аватары
- `POST /files/upload?taskId=...|projectId=...` — multipart, поле `file`
  (jpg/png/gif/webp/pdf/docx/xlsx/…, до 25 МБ)
- `PATCH /users/me/avatar` — multipart, поле `avatar` (jpg/png/webp, до 8 МБ)
- Раздача: аватары — `https://<API-домен>/api/avatars/<key>` (ссылка приходит в
  `user.avatar`); файлы задач — `https://<API-домен>/uploads/<path>`, готовый `path`
  приходит в объекте файла.

## 5. Realtime (Socket.IO)

- URL: тот же домен, что API (без `/api`), namespace `/ws` (`https://<API-домен>/ws`),
  стандартный path Socket.IO.
- Авторизация: `IO(url, auth: {'token': '<JWT>'})` — или заголовок `Authorization`.
  Невалидный токен, заблокированный/деактивированный пользователь или токен,
  выданный до смены пароля → сервер рвёт соединение. Заголовок `Origin`, если
  есть, должен быть доверенным (браузеры); без `Origin` (мобильные) — можно.
- События для инвалидации данных: `notification` (новое уведомление — сразу пуш-баннер
  в приложении), `tasks:changed`, `projects:changed`, `stories:changed`,
  `employees:changed`, `leads:changed`, `me:changed`, `access:changed`,
  `auth:blocked` (разлогинить).
- Flutter-пакет: `socket_io_client` (совместим с Socket.IO v4).

## 6. Push-уведомления (важно обсудить)

FCM на бэкенде есть (firebase-admin): каждое in-app уведомление дублируется пушем.
- `POST /users/register-fcm { "token": "<FCM token>" }` — зарегистрировать
  устройство (до 5 токенов на пользователя; мёртвые токены сервер удаляет сам)
- `POST /users/unregister-fcm { "token": "..." }` — при выходе из аккаунта
Во время отпуска сотрудника пуши не отправляются.

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
- Access-токен бессрочный, но сервер отзывает его (блокировка, смена пароля):
  на 401 — один раз refresh, при неудаче — на экран входа.
- `GET /auth/sessions?days=7` — история сессий пользователя (для профиля).
- Пагинации в большинстве списков нет (объёмы небольшие) — но `tasks`/`notifications`
  ограничивать на клиенте.
- Цветовой код продукта: красный — только просрочка/ошибки, зелёный — только
  завершённое. Просьба соблюдать в UI приложения.
