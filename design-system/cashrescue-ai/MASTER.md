# CashRescue AI design system

The installed UI UX Pro Max generated two design systems for the fintech dashboard. The focused financial analytics query surfaced Minimalism & Swiss Style. The enterprise analytics search added the Data-Dense Dashboard pattern for KPI layout and ledger density. Use that combination for the signed-in workspace. Keep the requested CashRescue typefaces and emerald action color.

## Tokens

| Role | Value | Use |
| --- | --- | --- |
| Navy | `#101C30` | Sidebar and dashboard header |
| Canvas / surface | `#F4F7FB` / `#FFFFFF` | Workspace background and cards |
| Ink / muted | `#14233A` / `#4F6177` | Primary and supporting text |
| Emerald | `#067253` | Primary actions and positive outcomes |
| Risk | `#A8313C` | Projected shortages, field errors and destructive actions |
| Chart baseline / rescue | `#4169A8` / `#058664` | Solid baseline and dashed scenario, with a dotted zero threshold |
| Focus | `#087957` / `#6CE2B8` | Visible outline on light / navy surfaces |
| Type | Plus Jakarta Sans / Inter | Headings / body and controls. Use tabular figures for money. |
| Radius | 16 px / 9 px | Panels / controls |

## Components and layout

- Reuse the existing button, panel, badge and section icon primitives. Use the native modal for forms, confirmation and copy-only reminder drafts.
- Keep the first shortage date, closing balance and proposed early collection near the top of the overview. Show the cash and transactions behind that day in a disclosure.
- Compare both forecast series on the same axis and show all 30 daily closes in the chart table. Show the original crisis-day result separately from the maximum shortfall across the horizon.
- Use labeled ledger rows on narrow layouts and columns on wide layouts. Keep form labels explicit, money in INR, and actions keyboard-accessible.
- Label live Gemini output, demonstration templates and deterministic forecast calculations according to their source.
