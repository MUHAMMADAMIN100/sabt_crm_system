# Директ: просмотр админом не снимает «непрочитанное». План работ

> **Для исполнителя:** выполняется одним проходом в этой сессии (superpowers:executing-plans), шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** когда чат открывает админ, «непрочитанное» остаётся. «Пометить прочитанным» действительно делает чат прочитанным.

**Устройство:** правило «снимает ли открытие чата непрочитанное» живёт одной чистой функцией в `direct-access.ts`. Её вызывает `DirectService.markRead`. `setMarkedUnread(off)` обнуляет и `unreadCount`.

**Технологии:** NestJS, TypeORM, jest. Фронт (React) по логике не меняется.

**Спека:** docs/superpowers/specs/2026-11-16-direct-admin-read-design.md

## Общие ограничения
- Правило касается только роли `admin`: `req.user.role === 'admin'`, это включает и помощника администратора (effectiveRoleOf). Сюда же относится «Войти как» от админа: `req.user.impersonatorRole === 'admin'`.
- Основатель и остальные роли работают как раньше. Закреплённый чат снимает только тот, кто его ведёт (canLead).
- Свои уведомления о чате (`markReadByLink`) у админа гаснут, пульс «сейчас в чате» работает.

## На что смотреть при проверке
1. Админ «Войти как» менеджер продаж открывает свободный чат: непрочитанное должно остаться (читает админ, а не менеджер).
2. Помощник администратора (isSubAdmin, роль admin в запросе): ведёт себя как админ.
3. Админ открыл чат, пока клиент пишет: каждое новое сообщение повторно вызывает read, и отметка всё равно остаётся.
4. «Пометить прочитанным» из списка у чата с `unreadCount > 0`: прочитан у всех, счётчик в меню уменьшается.
5. Ручная отметка «Пометить непрочитанным» не пропадает, когда чат открывает админ.

---

### Задача 1: правило открытия и «Пометить прочитанным»

**Файлы:**
- Изменить: `backend/src/modules/direct/direct-access.ts` (новая функция)
- Изменить: `backend/src/modules/direct/direct.service.ts` (`markRead`, `setMarkedUnread`)
- Изменить: `backend/src/modules/direct/direct.entity.ts` (комментарий к `markedUnread`)
- Тест: `backend/src/modules/direct/direct.spec.ts`

**Интерфейсы:**
- Создаёт: `clearsUnreadOnOpen(viewer: Who & { impersonatorRole?: string | null }, owner: Staff | null | undefined): boolean`

- [ ] Тест `clearsUnreadOnOpen`: admin → false (свободный и закреплённый), «Войти как» от admin в МП → false, founder в свободном → true, МП в свободном → true, МП в своём → true, чужой МП → false, founder в закреплённом за работающим МП → false, закреплённый за уволенным → true (кроме admin).
- [ ] Тест сервиса через `Object.create(DirectService.prototype)` с заглушками: markRead от admin не вызывает `conversations.update`, но вызывает `markReadByLink`; от МП обнуляет; `setMarkedUnread(off)` пишет `{ markedUnread: false, unreadCount: 0 }`, `on` пишет `{ markedUnread: true }`.
- [ ] Прогнать тесты: падают.
- [ ] Реализовать функцию и правки сервиса.
- [ ] `npx jest src/modules/direct`: проходят. `npx tsc --noEmit -p tsconfig.json`: без ошибок.

### Задача 2: проверка вживую и выкладка
- [ ] Локальный стенд (Postgres, бэкенд с поддельным Graph API, фронт). Сценарии из спеки в браузере под admin, founder и МП.
- [ ] Коммит, push, проверка на проде (сайт отвечает, CI зелёный).
