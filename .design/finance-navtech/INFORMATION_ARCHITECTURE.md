# Finance information architecture

## Route map

- `/finance` — overview, balances, income/expense summaries, annual trend, plan/fact directions, latest transactions.
- `/finance/income` — income directions.
- `/finance/income/:direction` — direction plan, projects, payments, analytics.
- `/finance/expense` — expense groups.
- `/finance/expense/:kind` — group-specific operations, including salary history.
- `/finance/planning` — forecast controls, cash-flow chart, monthly plan table and source drill-down.
- `/finance/transactions` — list/calendar, filters, inline operation detail.
- `/finance/inventory` — asset KPIs, filters, inventory table and editor.
- `/finance/activity` — audit log.
- `/finance/settings` — accounts, categories, recurring records and balances.

## Navigation

- Primary: existing CRM sidebar.
- Secondary: existing expanded finance sub-navigation.
- Utility: page-level month/scenario/view controls and create/edit actions.
- Mobile: existing sidebar drawer plus horizontally scrollable local controls where necessary.

## Content priority

1. Page identity, period, and primary action.
2. Current financial facts/KPIs.
3. Trend or plan/fact comparison.
4. Operational records and drill-down.
5. Audit/configuration detail.

## Vocabulary

- Use existing Russian finance terms without renaming entities.
- `Доход`, `Расход`, `Перевод`, `Накопление` remain transaction types.
- `План`, `Факт`, `Остаток`, `Прогноз` remain comparison terms.
- `Проведено`, `Запланировано`, `Отменено` remain statuses.

## Reusable structure

- Ambient finance workspace → white finance canvas → page header → KPI/summary region → detail/table region.
- Cards, segmented controls, badges, tables, charts, and inline expansions share one scoped token system.
- Long tables keep sticky headers/identity columns and horizontal scrolling.
