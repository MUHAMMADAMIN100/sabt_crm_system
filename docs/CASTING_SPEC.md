# Кастинг WeBrand в CRM

Решение владельца 17.11.2026: перенести базу кастинга (артефакт «WeBrand Casting»: 25 человек — актёры,
блогеры, модели, дети; 86 фото) в CRM со всеми данными.
- Видят: основатель, админ, руководитель SMM, продюсер, SMM-специалисты, видеографы (роль основная или вторая).
  Добавляют и правят: основатель, админ, руководитель SMM, продюсер.
- Публичный каталог для клиентов из данных CRM; «Забронировать» создаёт лид в «Продажах».
- Актёров можно ставить в съёмку; у актёра видна история съёмок.

**Персональные данные (ФИО, фото, возраст, дети) НЕ кладём в репозиторий — он публичный.** Данные загружаются
через «Импорт» в CRM (файлы `data.json` + фото). В репозитории — только логотип `frontend/public/webrand-casting-logo.png`.

## 1. Таблицы (миграция `1837000000000-Casting.ts`, IF NOT EXISTS; DDL продублировать в onModuleInit)

```sql
casting_talents (
  id uuid PK DEFAULT uuid_generate_v4(),
  name varchar(200) NOT NULL,
  categories text[] NOT NULL DEFAULT '{}',      -- 'actor' | 'blogger' | 'model'
  city varchar(200) NULL,
  height varchar(20) NULL,                      -- свободный текст: '175', '180+', '154-155'
  "birthDate" date NULL,
  "ageBase" int NULL,                           -- возраст на дату ageBaseAt (из импорта)
  "ageBaseAt" date NULL,
  tags text[] NOT NULL DEFAULT '{}',            -- 'ads' | 'film' | 'theatre' | 'clips' | 'social' | 'model'
  experience text NULL,
  links text[] NOT NULL DEFAULT '{}',           -- только http(s)
  phone varchar(40) NULL,                       -- внутреннее
  telegram varchar(64) NULL,                    -- внутреннее
  rate varchar(120) NULL,                       -- гонорар, текстом; внутреннее
  notes text NULL,                              -- внутреннее
  "isPublic" boolean NOT NULL DEFAULT true,     -- показывать в каталоге для клиентов
  "isArchived" boolean NOT NULL DEFAULT false,
  "sortOrder" int NOT NULL DEFAULT 0,
  "sourceKey" varchar(80) NULL UNIQUE,          -- 'webrand-casting:<id>' — повторный импорт не дублирует
  "createdById" uuid NULL, "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now()
)
casting_photos (
  id uuid PK, "talentId" uuid NOT NULL REFERENCES casting_talents(id) ON DELETE CASCADE,
  path varchar(300) NOT NULL,                   -- '/uploads/casting/<random>.jpg'
  "sortOrder" int NOT NULL DEFAULT 0, "createdAt" timestamptz DEFAULT now()
)
casting_bookings (                              -- актёр в съёмке
  id uuid PK, "talentId" uuid NOT NULL REFERENCES casting_talents(id) ON DELETE CASCADE,
  "contentItemId" uuid NOT NULL REFERENCES content_plan_items(id) ON DELETE CASCADE,  -- карточка съёмки (как ShootRow.id в producer)
  status varchar(16) NOT NULL DEFAULT 'invited', -- 'invited' | 'confirmed' | 'declined'
  note varchar(500) NULL, "createdById" uuid NULL, "createdAt" timestamptz DEFAULT now(),
  UNIQUE ("talentId", "contentItemId")
)
casting_requests (                              -- заявки клиентов с публичного каталога
  id uuid PK, "talentId" uuid NOT NULL REFERENCES casting_talents(id) ON DELETE CASCADE,
  "leadId" uuid NULL REFERENCES client_leads(id) ON DELETE SET NULL,
  "createdAt" timestamptz DEFAULT now()
)
```
Возраст для показа: `birthDate` → полных лет; иначе `ageBase + полных лет с ageBaseAt`; иначе null. «Дети» — возраст < 16.

Метки (ключ → подпись): actor «Актёр», blogger «Блогер», model «Модель»; ads «Реклама», film «Кино и сериалы»,
theatre «Театр», clips «Клипы», social «Ролики для соцсетей», model «Модельный опыт».

## 2. Импорт
`POST /casting/import` (multipart: поле `data` — data.json; поле `files` — фото, до 150 шт., jpg/png/webp ≤ 8 МБ) —
только основатель/админ/руководитель SMM. Формат data.json (из артефакта):
`[{ id, name, cats: ['Актёр'|'Блогер'|'Модель'], city, height, age: number|null, tags: [русские подписи], exp, links: [], photos: ['photos/t00_0.jpg', …] }]`.
- Подписи → ключи (таблица выше; неизвестные игнорируем). `ageBase = age`, `ageBaseAt = сегодня`. sourceKey = `webrand-casting:<id>`.
- Фото сопоставляются по имени файла (basename `t00_0.jpg`), сохраняются в `./uploads/casting/<uuid>.<ext>`, порядок — как в data.json.
- Уже импортированный sourceKey — пропускаем (skipped), но недостающие фото к нему добавляем.
- Ответ: `{ created, skipped, photos, missingPhotos: string[] }`.

## 3. API (`CastingController`, JwtAuthGuard; доступ — в сервисе)
```
GET    /casting/talents?search=&category=&tags=ads,film&kids=1&archived=1
       → { items: TalentListItem[], counts: { all, actor, blogger, model, kids } }
GET    /casting/talents/:id → TalentDetail
POST   /casting/talents  TalentInput → TalentDetail
PATCH  /casting/talents/:id  Partial<TalentInput> & { isArchived? } → TalentDetail
POST   /casting/talents/:id/photos  (multipart files, ≤10) → TalentDetail
PATCH  /casting/talents/:id/photos/order { ids: string[] } → TalentDetail
DELETE /casting/photos/:photoId → TalentDetail
POST   /casting/import → см. §2
GET    /casting/shoots/:contentItemId → { items: ShootTalent[] }
POST   /casting/shoots/:contentItemId { talentId, note? } → { items: ShootTalent[] }
PATCH  /casting/bookings/:id { status?, note? } → { items: ShootTalent[] }
DELETE /casting/bookings/:id → { items: ShootTalent[] }
```
- TalentListItem: `{ id, name, categories, city, height, age, kid, tags, photo: string|null, photosCount, isPublic, isArchived }`.
- TalentDetail: всё из TalentListItem + `{ birthDate, experience, links, phone, telegram, rate, notes, photos: [{ id, path }],
  shoots: [{ bookingId, contentItemId, date, projectName, title, status }] (новые сверху), requests: [{ leadId, leadName, createdAt }],
  canEdit }`.
- ShootTalent: `{ bookingId, status, note, talent: { id, name, photo, categories, age } }`.
- Ставить в съёмку / менять статус / убирать: кто правит кастинг + SMM-специалист проекта этой съёмки + продюсер.
- Сообщения продюсеру о съёмках (producer.service: notifyTomorrow, notifyNextWeek, sendShootChange) — добавить строку
  «Актёры: Имя, Имя» (не declined), если есть.

## 4. Публичный каталог
```
GET  /public/casting → { items: PublicTalent[] }   (isPublic && !isArchived, без авторизации)
POST /public/casting/book { talentIds: string[] (1..10), name, phone, comment?, website? } → { ok: true }
```
- PublicTalent: `{ id, name, categories, city, height, age, kid, tags, experience, links, photos: string[] }` — БЕЗ phone/telegram/rate/notes.
- book: `@Throttle` 5 в минуту; `website` — ловушка для ботов (не пусто → тихо ok); name 2–100, phone ≥ 7 цифр.
  Создаёт лид (client_leads): name = имя клиента, contactPhone, status 'new', leadSource 'casting', direction 'smm',
  ownerId null, в заметке/описании — «Кастинг: Имя (ссылка /casting/<id>), …» и комментарий; пишет casting_requests;
  уведомление (колокольчик + Telegram) основателю и МП по SMM «Заявка с кастинга: …». Использовать существующие
  пути создания лида и уведомлений, если они подходят.
- Фото отдаются статикой `/uploads/casting/…` (как остальные uploads).

## 5. Фронтенд
- Пункт меню «Кастинг» (роли из шапки) и маршрут `/casting`; `/casting/:id` открывает карточку.
- **CastingPage** — минимально, в стиле CRM (светлая/тёмная тема): вкладки категорий с числами (Все, Актёры, Блогеры, Модели, Дети),
  чипы опыта, поиск по имени; сетка карточек (фото 3:4, второе фото при наведении на компьютере, имя, «возраст · рост»);
  на телефоне — 2 колонки. Кнопки: «+ Добавить» (кто правит), «Импорт» (основатель/админ/руководитель SMM),
  «Ссылка для клиентов» (копирует `/public/casting`). Переключатель «Архив».
- **Карточка** (модалка на компьютере, полный экран на телефоне): галерея, факты (рост, возраст, город), метки, опыт, ссылки,
  контакты/гонорар/заметки (внутренние), «Съёмки» (история), «Заявки клиентов»; «Изменить» → форма (все поля, фото: добавить,
  удалить, порядок, «показывать клиентам», в архив).
- **Импорт**: выбор файлов (data.json + фото одной кнопкой, можно выделить всю папку), прогресс, итог «Создано N, пропущено M, фото K».
- **Съёмка**: в карточке съёмки (найти, где её правят: контент-план/продюсер) — блок «Актёры»: список с фото и статусом
  («Приглашён / Подтвердил / Отказался»), «+ Актёр» (поиск по базе), убрать.
- **Публичная страница** `/public/casting` — фирменный вид артефакта (тёмный фон, лаймовый акцент, шрифты Unbounded/Manrope
  через Google Fonts, логотип `/webrand-casting-logo.png`): категории, чипы опыта, поиск, сетка, карточка с галереей;
  «Забронировать» → форма (имя, телефон, комментарий) → «Заявка отправлена, мы свяжемся». Телефон и 390 px — обязательно.

## 6. Бэкенд — как сделано (уточнения к §1–4)
- **TalentInput** (POST/PATCH `/casting/talents`, лишние поля → 400): `name` (обязательно при создании), `categories[]`,
  `tags[]` (ключи или русские подписи), `city`, `height` (строка или число), `birthDate` ('YYYY-MM-DD' | null | ''),
  `age` или `ageBase` (int | null — одно и то же; только если нет даты рождения: сохраняется как «возраст на сегодня», тот же возраст повторно не сдвигает
  отсчёт), `experience`, `links[]` (только http(s); «site.com» → https://site.com; прочее молча отбрасывается), `phone`,
  `telegram`, `rate`, `notes`, `isPublic`, `isArchived`, `sortOrder`. Пустая строка в текстовом поле = очистить.
- **Дополнительно к §3**: `TalentListItem.photo2` — второе фото (для наведения); `TalentDetail.shoots[]` ещё содержит
  `projectId`, `note`; ответы `/casting/shoots/*` и `/casting/bookings/*` — `{ items, canEdit }` (canEdit — можно ли
  ставить/убирать людей в этой съёмке).
- **Список**: `archived=1` — только архив, без него — только активные; поиск — по имени (ё = е); `tags` — «любой из
  выбранных»; `category=kids` = `kids=1`; `counts` считаются после поиска и чипов, но до вкладки. Порядок — `sortOrder`, имя.
- **Импорт**: `data.json` полем `data` (файл) или среди `files` (если выбрали всю папку); не-картинки молча пропускаются;
  всего файлов в запросе ≤ 151. В `casting_photos` добавлена колонка `"sourceName"` (имя файла из импорта) — по ней
  повторный импорт понимает, каких фото не хватает. Файл, нужный двум людям, копируется.
- **Заявка** `POST /public/casting/book` → 200 `{ ok: true }`; ошибка — 400 с русским `message`; чаще 5/мин — 429.
  Лид: `name` = имя клиента, `contactPhone`, `status` new, `leadSource` 'casting', `direction` smm, без владельца;
  «Кастинг: Имя (APP_URL/casting/<id>), …» и комментарий — в поле лида `problem` («Проблема / услуга»). Дубли не проверяются.
  Уведомление — тип `status_change` (новый enum не заводили), ссылка `/clients?id=<leadId>`; Telegram — с той же ссылкой.
- Права на загрузку фото и импорт проверяются ролью ещё до приёма файлов (RolesGuard), остальное — в сервисе.
