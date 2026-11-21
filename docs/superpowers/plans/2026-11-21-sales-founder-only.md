# «Продажи» — только основателю: план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** админ (и помощник админа) не видит раздел «Продажи» ни в меню, ни по ссылке, ни через API; основатель — всё; руководители направлений — только «Заявки» своего направления.

**Architecture:** отдельное правило «владелец продаж = основатель» (основная или вторая роль) рядом с существующим «руководство продаж = основатель + админ». Старое правило остаётся для работы с лидами (база клиентов), новое — для раздела: аналитика, заявки, привязка заявки, нормы, полный вид настроек, уведомления о заявке.

**Tech Stack:** NestJS + TypeORM (backend/src/modules/sales), React (frontend/src/lib/permissions.ts, navItems.ts), Jest / Vitest.

**Spec:** docs/superpowers/specs/2026-11-21-sales-founder-only-design.md

## Global Constraints
- Работа админа с лидами не меняется: `isSalesTop` (основатель + админ) в `canActOnLead` / `canViewLead` не трогаем.
- `clients.kpi.all` не трогаем: на нём KPI менеджеров в «Базе клиентов», он у админа остаётся.
- Роль — основная ИЛИ вторая.

## Review Focus
- Админ открывает /sales по прямой ссылке — редирект, не пустая страница и не ошибка.
- Админ дергает API: GET /sales/analytics, GET /sales/handoffs, POST /sales/handoffs/:id/link, PUT /sales/settings (нормы) — 403.
- GET /sales/settings от админа — вид менеджера: без комиссии и списка менеджеров.
- Руководитель направления (в т.ч. второй ролью) — «Заявки» своего направления остаются.
- Менеджер передаёт клиента в работу — уведомление основателю и руководителю, админу нет.

---

### Task 1: сервер

**Files:**
- Modify: `backend/src/modules/sales/sales-access.ts` — `export const isSalesOwner = (u?: SalesUser | null): boolean` (роль founder основная или вторая); `handoffDirectionsFor`: `isSalesOwner` → null; `canEditNorms` → `isSalesOwner`.
- Modify: `backend/src/modules/sales/sales-analytics.service.ts` — `getSettings`: полный вид только `isSalesOwner`.
- Modify: `backend/src/modules/sales/sales.service.ts` — `notifyHandoff`: роль FOUNDER (без ADMIN); `linkProject`: `isSalesOwner`.
- Modify: `backend/src/modules/sales/sales.controller.ts` — `analytics(..., @Request() req)`: не владелец → 403.
- Test: `backend/src/modules/sales/sales-owner.spec.ts` (новый), правка ожиданий админа в `sales.service.spec.ts`, `sales-analytics.service.spec.ts`.

- [ ] Тесты: админ — handoffDirectionsFor `[]`, нормы 403, getSettings без комиссии, linkProject 403, analytics 403; основатель — всё; админ с второй ролью руководителя SMM — `['smm']`; уведомление о заявке ищет только founder + директора.
- [ ] Прогнать — падают.
- [ ] Реализовать.
- [ ] Прогнать весь backend jest + tsc — зелёные.

### Task 2: фронт

**Files:**
- Modify: `frontend/src/lib/permissions.ts` — `SALES_TOP_ROLES` → `SALES_OWNER_ROLES = ['founder']` во всех функциях раздела (`canSeeSalesHub`, `canSeeSalesAnalytics`, `canEditSalesNorms`, `canLinkHandoff`, `canCreateHandoffProject`).
- Modify: `frontend/src/components/layout/navItems.ts` — `SALES_ANALYTICS_ROLES` без admin.
- Test: `frontend/src/lib/permissions.test.ts` — admin: `/sales` закрыт, аналитика/нормы/привязка — нет.

- [ ] Тесты → падают → реализовать → vitest + tsc + build зелёные.

### Task 3: стенд и выкладка
- [ ] Браузер: админ (нет пункта, /sales → редирект), основатель (все вкладки), руководитель SMM (только «Заявки»), МП передаёт клиента — уведомления.
- [ ] Коммит, push после подтверждения, проверка прода.
