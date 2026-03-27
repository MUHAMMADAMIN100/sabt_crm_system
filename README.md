# 🏢 ERP System — Корпоративная система управления

Полнофункциональная ERP-система для управления сотрудниками, проектами и задачами компании.

## 🚀 Технологии

### Backend
- **NestJS** — фреймворк для Node.js
- **TypeORM** — ORM для работы с БД
- **PostgreSQL** — база данных
- **JWT** — аутентификация
- **WebSockets** (Socket.IO) — реал-тайм уведомления
- **Swagger** — документация API

### Frontend
- **React 18** + **TypeScript**
- **Vite** — сборщик
- **TailwindCSS** — стилизация
- **Zustand** — управление состоянием
- **React Query** — кэш и запросы
- **Recharts** — графики
- **React Hook Form** — формы

## 📁 Структура проекта

```
erp-system/
├── backend/                  # NestJS backend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/         # Авторизация (JWT)
│   │   │   ├── users/        # Пользователи
│   │   │   ├── employees/    # Сотрудники
│   │   │   ├── projects/     # Проекты
│   │   │   ├── tasks/        # Задачи
│   │   │   ├── comments/     # Комментарии
│   │   │   ├── time-tracker/ # Тайм-трекер
│   │   │   ├── notifications/# Уведомления
│   │   │   ├── reports/      # Отчёты
│   │   │   ├── analytics/    # Аналитика
│   │   │   ├── calendar/     # Календарь
│   │   │   ├── files/        # Файлы
│   │   │   └── gateway/      # WebSocket
│   │   └── database/seeds/   # Seed данные
│   └── Dockerfile
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── pages/            # Страницы
│   │   ├── components/       # Компоненты
│   │   ├── services/         # API сервисы
│   │   ├── store/            # Zustand stores
│   │   └── lib/              # Утилиты
│   └── Dockerfile
└── docker-compose.yml
```

## 🔧 Быстрый старт

### С Docker (рекомендуется)

```bash
# Клонировать / распаковать проект
cd erp-system

# Запустить всё одной командой
docker-compose up -d

# Подождать ~30 сек, затем запустить seed
docker exec erp_backend npm run seed
```

Открыть: **http://localhost:5173**

### Локально (без Docker)

#### Требования
- Node.js 18+
- PostgreSQL 15+

#### 1. База данных
```bash
createdb erp_db
createuser erp_user -P   # пароль: erp_password
psql -c "GRANT ALL ON DATABASE erp_db TO erp_user;"
```

#### 2. Backend
```bash
cd backend
cp .env.example .env
# Отредактируйте .env: DATABASE_URL, JWT_SECRET

npm install
npm run start:dev
```

#### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

#### 4. Seed данные
```bash
cd backend
npm run seed
```

## 👤 Тестовые аккаунты

| Роль | Email | Пароль |
|------|-------|--------|
| Администратор | admin@erp.com | admin123 |
| Менеджер | manager@erp.com | pass123 |
| Сотрудник | ivan@erp.com | pass123 |

## 📌 Функционал

### ✅ Реализовано
- 🔐 Авторизация (JWT, роли: admin/manager/employee)
- 👥 Управление сотрудниками (CRUD, отделы, профили)
- 📁 Проекты (статусы, прогресс, участники, архив)
- ✅ Задачи (приоритеты, дедлайны, Kanban-вид)
- 💬 Комментарии к задачам
- ⏱️ Тайм-трекер (таймер + ручной ввод)
- 📅 Календарь (задачи и проекты)
- 🔔 Уведомления (in-app)
- 📝 Ежедневные отчёты сотрудников
- 📊 Аналитика (графики, KPI, активность)
- 🗂️ Файловое хранилище
- 📦 Архив проектов
- 👤 Управление пользователями (admin)
- 🔄 WebSocket (реал-тайм соединения)
- 📚 Swagger API документация

### 🔜 Будущие этапы
- 📧 Email уведомления
- 🤖 AI-ассистент
- 📱 Мобильное приложение
- 📤 Экспорт PDF/Excel

## 📡 API Документация

После запуска backend откройте:
```
http://localhost:3000/api/docs
```

## 🔌 WebSocket Events

```javascript
// Подключение
const socket = io('http://localhost:3000/ws', {
  auth: { token: 'JWT_TOKEN' }
})

// Присоединиться к проекту
socket.emit('join:project', projectId)

// Получать обновления
socket.on('notification', (data) => { ... })
socket.on('task:updated', (data) => { ... })
```

## 🌐 Порты

| Сервис | Порт |
|--------|------|
| Frontend | 5173 (dev) / 80 (docker) |
| Backend API | 3000 |
| PostgreSQL | 5432 |
| Redis | 6379 |

## 📝 Переменные окружения

### Backend (.env)
```env
DATABASE_URL=postgresql://erp_user:erp_password@localhost:5432/erp_db
JWT_SECRET=change-this-in-production
JWT_EXPIRES_IN=7d
PORT=3000
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your@email.com
MAIL_PASS=app-password
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3000
```
