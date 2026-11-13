# CashRescue AI technical plan

Finovators (solo) · Arthaton 2026 · AI for Finance · Due 22 November 2026

## Problem statement

Small businesses can have enough money tied up in invoices to cover their bills and still run short of cash before customers pay. Owners need to know when the shortfall starts, which obligations and collection dates drive it, and which invoices they could ask customers to settle earlier.

## Proposed solution

An owner enters a starting cash balance, reviews uploaded invoice details, and manages expected receipts and expenses. CashRescue AI calculates daily closing balances for the next 30 calendar days. When the forecast shows a shortage, the Reverse Cash-Flow Rescue Solver works backward from the deficit dates to find early collection actions and replay the forecast. Owners compare the baseline with proposed scenarios and can copy an editable payment reminder.

## Core MVP features

- Set the opening cash balance and forecast start date. Start with a reproducible synthetic business that demonstrates a genuine shortfall and a possible rescue.
- Add invoices manually or upload a PDF, PNG, or JPEG for Gemini extraction. Review, edit and confirm extracted fields before an invoice can affect the forecast. List and edit invoices and record when they are paid.
- Add and edit planned expenses, then mark them paid or cancel them. Capture amounts and dates for rent, payroll, suppliers and other one-off obligations.
- Display the 30-day balance curve, first negative date, worst deficit and cash events driving the first shortfall. Identify overdue receivables without an expected date in the dashboard.
- Present up to three ranked rescue scenarios. Show each invoice, proposed collection date, amount, remaining shortfall and resulting balance curve on the same scale as the baseline.
- Generate an optional plain-language explanation and a copyable, editable reminder. Show the same computed figures in the dashboard with or without Gemini.

The app models one business in INR, invoice balances after any amount already received, and one-off expenses. Bank feeds, payment processing, automatic messaging, recurring expense rules, fees and multi-tenant accounts are future work.

## Architecture

| Layer | Planned responsibility |
| --- | --- |
| `client/` | React and Vite with Tailwind CSS. Business settings, invoice review, expenses and an analysis dashboard with Recharts, an accessible metrics table and empty and error states. |
| `server/` HTTP and application modules | Express routes under `/api/v1`. Zod request validation, consistent errors, settings and record management, analysis orchestration and a Gemini adapter. |
| `server/` financial domain | Pure JavaScript money and date helpers, 30-day forecast, shortage evidence and rescue solver. No database, HTTP or provider dependency. |
| Persistence | Use an editable in-memory synthetic ledger locally, or MongoDB via Mongoose for a local persisted workspace. The public sandbox keeps one temporary ledger per tab and recalculates validated snapshots on demand. Public mode blocks persistent ledger routes. |
| Verification | Vitest financial and route tests, synthetic seed records, and a repeatable browser smoke test. |

Use the Vite proxy during development. For a hosted demo, prefer a single origin with Express serving the built client and API. Keep the local synthetic demo as the delivery fallback while hosting and judging requirements are confirmed.

## Database model plan

Invoice and expense records have timestamps. All amounts are integer paise. Business dates are validated date-only strings. The workspace is selected server-side in the MVP. Phase 3 stores settings, invoices and expenses together in one revisioned MongoDB document so a compare-and-set can validate and save the full ledger atomically.

| Collection | Main fields and constraints |
| --- | --- |
| Business settings | Singleton business ID, name, `openingBalancePaise` (signed), and `forecastStartDate`. The balance is cash at the start of that date, before any modeled events for the day. |
| Invoices | `businessId`, invoice number, customer name, issue, due and optional expected collection dates, positive `amountPaise`, `receivedPaise`, and `status`. The service derives the outstanding amount and enforces unique normalized invoice numbers across the workspace. A paid invoice requires full receipt. A cancelled invoice contributes no expected cash. |
| Expenses | `businessId`, label, category, `dueDate`, `amountPaise` (positive), and `status` (`scheduled`, `paid`, or `cancelled`). |

The ledger document uses the built-in MongoDB ID index and a revision condition on writes. Extraction will return an unsaved draft to the review form. Scenarios are read-only calculations. The opening balance represents cash already on hand and should be refreshed when the forecast date advances or a modeled event is marked settled on or after the current start date.

## Backend API plan

| Method and path | Behavior |
| --- | --- |
| `GET /api/v1/health` | Report API and database readiness. Track Gemini availability separately from core readiness. |
| `GET /api/v1/settings`, `PUT /api/v1/settings` | Read or replace the opening balance and forecast start date together. |
| `GET /api/v1/invoices`, `POST /api/v1/invoices`, `PATCH /api/v1/invoices/:id`, `DELETE /api/v1/invoices/:id` | List, add, edit, or delete invoices. Map duplicate invoice numbers to a conflict response. |
| `POST /api/v1/invoices/extract` | Accept one PDF, PNG, or JPEG as multipart data and return unsaved draft fields and review warnings. |
| `GET /api/v1/expenses`, `POST /api/v1/expenses`, `PATCH /api/v1/expenses/:id`, `DELETE /api/v1/expenses/:id` | List, add, edit, or delete scheduled obligations. |
| `GET /api/v1/analysis` | Return forecast dates and balances, cash events, data warnings, shortage metrics and ranked scenarios together. |
| `POST /api/v1/analysis/simulate` | Replay the current ledger using the requested early collection amounts. Reject stale revisions and return the scenario without saving changes. |
| `POST /api/v1/demo/reset` | Restore the seed in local demo mode. |
| `GET /api/v1/sandbox`, `POST /api/v1/sandbox` | Load a fresh synthetic snapshot or apply one validated operation. Reuse the ledger service and financial engines with a request-scoped repository. Public sandbox edits never reach the local ledger or MongoDB. |
| `POST /api/v1/ai/explanation` | Render a grounded explanation from the current ledger revision and optional validated scenario actions. Gemini selects the emphasis and suggested next step. |
| `POST /api/v1/invoices/:id/reminder-draft` | Render a copy-only draft from a verified outstanding invoice. Gemini selects the tone and call to action. |

Reject malformed IDs and invalid money or dates before calculating. Use a shared error format with a stable code, user-facing message and field errors where applicable. Return a distinct provider failure for extraction so the user can enter the invoice manually. Mark template explanations and reminders as templates when used during an outage. Re-fetch analysis after confirmed changes and disregard superseded client requests.

## Cash-flow calculation design

1. Define day one as `forecastStartDate`, with day 30 exactly 29 calendar days later. Use `Asia/Kolkata` for the default business date and calendar-day arithmetic for projections. The selected opening balance precedes day-one cash movements.
2. For each open invoice, schedule its outstanding balance on `expectedCollectionDate` when entered and otherwise on `dueDate`. If that date precedes day one, leave the invoice unscheduled and flag it for review. Include receipts on either horizon boundary. Retain later receipts in the input for possible acceleration. Bring overdue scheduled expenses into day one and flag them as overdue. Include other scheduled expenses on their due dates. Exclude paid and cancelled records from future cash movements.
3. Bucket receipts and expenses by date. For each day, compute closing balance as previous closing balance plus receipts minus expenses. Use opening cash as the previous balance for day one. Check safe integer bounds during aggregation and return an input error if totals exceed supported precision.
4. Flag closing balances below zero. Return the first negative date, number of negative days, minimum closing balance and maximum shortfall magnitude. Provide the first shortage day's opening balance, expense and receipt breakdown, and the next scheduled receipt where available. Daily netting assumes same-day receipts can cover same-day obligations.

## Reverse Cash-Flow Rescue Solver

**Inputs.** Use the baseline and the same ledger inputs. Model collection of some or all of the outstanding amount two calendar days after the forecast start. Label this assumption in the UI. An invoice must already be issued at the start of the forecast and have a usable later collection date.

1. Identify every negative closing day. An invoice can help a day only when that day falls on or after the proposed collection date and before the baseline collection date. Filter out invoices whose acceleration affects none of those days. Include qualifying invoices due beyond day 30.
2. Prioritize candidates by the number of baseline shortage days affected, then larger outstanding balance, then stable invoice ID. Consider every nonempty subset of the first 10 candidates. Test the full amounts and a partial variant that trims coverage above the useful amount on baseline shortage days. The search is bounded and can miss other feasible plans. Report the cap when it applies.
3. Replay each distinct action set through the same forecast engine. Subtract each early payment from its later scheduled receipt. Remove the later receipt if the remaining amount is zero. Preserve the original ledger and evaluate all 30 closing balances, including shortages after the original receipt date.
4. Rank scenarios that keep all daily closes nonnegative first. Prefer fewer collection actions, then less total cash requested early, then a higher minimum balance. For partial improvements, prefer a smaller worst shortfall, then fewer negative days, then a lower sum of daily deficits, then fewer actions and less cash requested. Use sorted invoice IDs as a stable final tie-breaker.
5. Return up to three distinct scenarios with improvements over baseline and show residual shortfall for partial rescues. Skip the search when there is no shortage. When no evaluated scenario clears all negative days, report the result under the tested collection assumptions. Surface when a shortage occurs before the earliest collection day.

### Synthetic acceptance example

Assume opening cash of ₹25,000 on 13 November, payroll of ₹45,000 on 17 November, and an open ₹30,000 invoice due on 21 November. The first deficit is ₹20,000 on 17 November. Collecting the invoice on 15 November would lift the 17 November closing balance to ₹10,000. The baseline and scenario both close at ₹10,000 on 21 November, when the original receipt would have arrived. A second fixture should require multiple invoices or leave a residual shortage.

## Gemini integration plan

- Configure the model and key server-side through the official Google GenAI SDK. Send small synthetic PDFs or images inline with a 5 MiB upload limit, timeouts and rate limits. [Gemini document processing](https://aistudio.google.com/docs/document-processing)
- Extract customer name, invoice number, issue date, due date, total as a decimal string and currency. Ask for nulls when fields are missing or ambiguous. Validate the response with Zod, parse valid INR amounts to integer paise and show an editable draft. Confirm only after required fields pass server-side validation. [Gemini structured output](https://aistudio.google.com/docs/structured-output)
- Send the explanation adapter calculated summaries. Render all amounts, dates, and transaction labels in the application. Validate Gemini's choices against a fixed set of emphasis, next step, tone, and call-to-action options. Use English or Hindi templates when Gemini is unavailable.
- Keep document text and model output untrusted. Use synthetic input, limit payloads, keep invoice bytes transient, and give the provider adapter no tools or authority to save records or send messages. Provide deterministic explanations and reminder templates when Gemini is unavailable. Test PDF extraction and text generation with a live key before describing them as verified.

## Development phases

| Phase | Scope and exit criteria |
| --- | --- |
| 0 · Planning | Technical plan, operating rules and delivery schedule ready for owner approval. |
| 1 · Foundation and domain | Scaffold the client and server with optional MongoDB configuration. Add the synthetic fixture and test the money/date validation and forecast against its hand-calculated baseline and edge cases. |
| 2 · Core MVP | Build and test the rescue solver. Show the synthetic ledger, baseline forecast, shortage, ranked scenarios and editable simulation in the dashboard. Exit when the browser demo and financial and route checks pass without database credentials. |
| 3 · Editable ledger | Manage settings, invoices and expenses. Recompute analysis after writes, invalidate prior simulations, and support a local memory or MongoDB ledger plus a public synthetic demo. |
| 4 · Gemini workflows | Add invoice extraction with review, grounded English and Hindi explanations, and copy-only reminder drafts. Verify synthetic requests and failure behavior. |
| 5 · Public sandbox | Verify the independent synthetic edit-to-rescue and reset flow on desktop and mobile. Keep public calculations bounded and public AI template-only. |
| 6 · Judge demo and QA | Refine the crisis alert and scenario comparison. Verify the public workflow across screen sizes and prepare the synthetic invoice, demo script and judge Q&A. |
| 7 · Production rehearsal | Harden production startup, verify the built sandbox and prepare the hosting and submission handoff. |
| Next approval · Deployment and submission | Publish the approved repository, verify the hosted public demo and submit the approved assets. |

The [implementation schedule](SCHEDULE.md) gives target dates and reserves time for fixes and submission.

## Testing strategy

- **Financial unit tests.** Cover paise parsing, invalid amounts, safe integer limits, date validation and month boundaries. Cover both horizon boundaries, same-day netting, zero versus negative cash, overdue rules, settled records and no-data or no-shortage forecasts.
- **Solver unit tests.** Check single and multiple invoice rescues, partial and impossible cases, receipts due after the horizon, and shortages before the earliest collection day. Assert stable ordering, the candidate cap, one receipt per invoice, and preservation of the original ledger. Reconcile every scenario with an independently specified expected curve for the acceptance fixture.
- **API and data checks.** Exercise invalid payloads and duplicate invoice handling, read-after-write and analysis refresh, and uploads rejected by size or type. Use a dedicated test database for database checks. Mock Gemini for malformed output, ambiguous fields and timeout and confirm that extraction never saves an invoice by itself.
- **Browser acceptance.** Start from a clean synthetic seed, edit a cash input, reproduce a shortage, compare curves and draft a reminder. Check a fresh launch, mobile and desktop layouts, and the demo with Gemini disabled. Test live Gemini separately with synthetic documents and record which calls worked.

## Major technical risks

| Risk | Mitigation |
| --- | --- |
| Wrong money or date handling can create a false shortfall. | Exact paise arithmetic, explicit date boundaries and hand-calculated fixtures checked against the API and chart. |
| Opening cash can become stale after payment updates. | Pair the balance with its start date, explain the reconciliation workflow, and verify edits and refreshes during the browser demo. |
| Customers may decline to pay early, and capped search can miss combinations. | Display the collection date assumption, candidate cap and residual shortfall. Present each curve as a conditional simulation. |
| Gemini output can misread dates, totals or due terms. | Require confirmation, flag ambiguous fields, offer manual entry and keep numbers sourced from confirmed records. |
| Gemini credentials, quota or network can fail at judging. | Verify live access early in the integration phase and rehearse the seeded local demo with template text and manual entry. |
| Solo schedule, hosting and submission requirements can compete with testing. | Lock the core first, keep the last two days for verification and submission, and confirm portal cutoff, required assets and hosted-demo requirements. |
