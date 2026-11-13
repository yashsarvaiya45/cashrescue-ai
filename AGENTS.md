# CashRescue AI

CashRescue AI is Finovators' solo entry for Arthaton 2026 in the AI for Finance track. The submission deadline is 22 November 2026. The MVP helps Indian small businesses forecast near-term cash shortages and compare early invoice collection scenarios. The Reverse Cash-Flow Rescue Solver is the central feature.

Read [the technical plan](docs/PLAN.md) and [implementation schedule](docs/SCHEDULE.md) before starting a phase. Demo and test data must be synthetic.

## Engineering standards

- Use React, Vite, Tailwind CSS and Recharts for the client. Use Node.js, Express, MongoDB, Mongoose, Zod and Vitest for the API, data and tests.
- Keep routes, persistence, financial calculations and Gemini calls in separate modules. Keep the forecast and solver as pure JavaScript functions with explicit inputs. The client displays server-calculated balances and scenario metrics.
- Store and calculate INR values as integer paise. Parse decimal strings explicitly, check safe integer bounds on inputs and arithmetic, and format amounts for display with the Indian numbering convention.
- Use validated calendar dates in `YYYY-MM-DD` format for cash events, with `Asia/Kolkata` as the business time zone. Inject the forecast start date into the financial functions so fixtures and tests are reproducible.
- Validate requests, configuration and provider responses with Zod at the appropriate boundaries. Use Mongoose schema constraints and indexes to protect stored data. Return actionable field errors and consistent API errors.
- Keep Gemini behind a server-side adapter. Extracted financial fields require human review and explicit confirmation before saving. Forecasts, scenario ranks and reported numbers come from deterministic JavaScript.
- Write Vitest coverage for money and date boundaries, forecast roll-forward, shortage detection and invoice movement. Keep the core test suite runnable without live Gemini credentials. Report separately what was exercised against live services.

## Security and demo data

- Keep MongoDB credentials, Gemini keys and server configuration secrets in server environment variables. Ignore local secret files and commit only placeholder examples. Keep secrets out of client bundles, URLs, logs and screenshots.
- Accept only supported invoice uploads with a strict size limit and basic file-type checks. Limit provider request rates and timeouts. Keep invoice bytes transient on the server and avoid logging invoice contents or provider prompts and responses.
- Treat document content and AI output as untrusted. Keep the AI adapter limited to extraction and text generation. Render generated text as text and make payment reminders copy-only.
- Use synthetic invoices, counterparties and expenses in every test and demo. Keep persistent ledger writes, live Gemini and uploads private. Public demo mode may accept bounded fictional snapshots for stateless analysis. Keep visitor edits in browser memory and discard request snapshots after responding.

## Development workflow

1. Start the next phase only after the project owner approves it. At each gate, report the deliverables, tests run, and remaining gaps. Phase 0 consists of planning files.
2. Deliver small changes that work through normal app entry points. Verify the financial engine with fixtures before connecting it to the API and dashboard.
3. Keep the seeded demo reproducible and usable during a Gemini outage. Include manual invoice entry and clear feedback when extraction or text generation is unavailable.
4. Run the tests and build relevant to each phase. Verify the end-to-end demo before calling it ready. Describe untested behavior explicitly.
5. Prioritize the forecast, rescue solver and scenario comparison when scope or time is tight. Defer additions that do not serve the hackathon demo.
