# Finance visual redesign

## Problem

The finance area is functionally complete but visually fragmented and denser than the supplied references. A finance manager should be able to scan totals, compare plan and fact, and open operational detail without the interface feeling heavy or inconsistent between tabs.

## Experience solution

Present every finance route as one calm analytical workspace: a white rounded canvas over a very soft lavender-to-ice ambient background. Keep data precise and compact inside the canvas, using thin borders, restrained pastel status colors, quiet striped tables, and thin chart lines. Preserve all current routes, data, permissions, and workflows.

## Principles

1. **Calm shell, dense facts.** Generous page-level breathing room, compact rows and controls.
2. **Color carries meaning.** Lavender is the interface accent; green, coral, and amber are reserved for financial/status semantics.
3. **One system across every tab.** The same typography, radii, controls, tables, focus states, and responsive rules apply from overview through settings.

## Audience and success signal

- Audience: founders and finance operators working in the CRM.
- Main job: understand financial state quickly and act without losing context.
- Success: every finance route feels related, important values scan in seconds, tables remain usable on small screens, and no workflow regresses.

## Aesthetic direction

- Tone: precise, calm, modern, trustworthy.
- Reference traits: near-white analytical canvas, pastel ambient field, IBM Plex-like type, low-contrast borders, pill controls, thin smooth charts, compact zebra rows, small pastel status tags, tiny identity dots.
- Anti-references: gradients on every card, oversized headings, excessive shadow, decorative glass effects, dashboard-card clutter, unrelated NavTech branding.

## Existing system and constraints

- Reuse the global IBM Plex Sans stack and existing finance route/component structure.
- Extend the scoped `finance.css` tokens instead of replacing application-wide tokens.
- Preserve dark mode, keyboard focus, sticky wide tables, inline transaction/salary expansions, modals, and current responsive behavior.
- No API, schema, permission, copy, or navigation changes.

## Components

- Modify: finance workspace shell, page headers, month/view segments, cards, KPI groups, buttons, fields, badges, tables, calendar, charts/tooltips, modal surfaces, inline detail panels, loading/empty/error states.
- Reuse: existing React pages, `MonthNav`, `TxTable`, `FinKit`, `FinIcon`, Recharts components, sidebar finance navigation.
- Create: route-scoped workspace classes and a finance-only visual token layer.

## Interaction and states

- Hover is a subtle surface/border change; active press does not jump.
- Focus is a visible lavender ring with sufficient contrast.
- Status remains identifiable by text plus color.
- Row actions stay visible on touch; expanded rows retain context.
- Reduced-motion disables nonessential entrance/shimmer animation.

## Responsive behavior

- Desktop: centered rounded canvas with multi-column analytics.
- Tablet: two-column summaries, horizontally scrollable data grids.
- Mobile: single-column content, compact canvas padding/radius, wrap-safe headers and controls, minimum 44px touch targets for primary controls.

## Accessibility and performance

- Keep semantic HTML and existing keyboard handlers.
- Do not communicate state by color alone.
- Respect `prefers-reduced-motion` and avoid expensive backdrop effects on the scrolling content.
- Prefer CSS restyling; do not add image/font/network dependencies.

## Excluded

- Non-finance screens, global sidebar redesign, new finance functionality, backend changes, and copying the references' product branding or bottom navigation dock.
