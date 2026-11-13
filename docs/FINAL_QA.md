# CashRescue AI · Phase 6 verification

Finovators · Arthaton 2026 · Verified locally on 13 November 2026

## UI and workflow

| Check | Result |
| --- | --- |
| Public demo load, invoice and expense edits, changed shortfall and rescue comparison | Passed in Chromium. The desktop invoice changed the projected shortfall from ₹20,000 to ₹8,000. The recommended simulation reduced it to ₹0. The other session's expense independently increased its shortfall to ₹32,000. |
| Responsive layout | Checked at 375, 768 and 1440 CSS pixels. Mobile and tablet kept the dashboard within the viewport. All six workspace navigation links were available at tablet width. |
| Keyboard and chart access | Enter on **Rescue My Cash Flow** applied the recommendation and focused the simulator. The Cash flow link focused the chart section. The daily table contained all 30 forecast days. Escape closed the manual invoice dialog. |
| Reset | Reset restored the original ledger in one context and preserved the other context's edits. |

## Financial checks

- The crisis alert renders opening cash, scheduled receipts, scheduled payments and the exact dated close from the engine. Scenario results distinguish maximum shortfall across the horizon from closing cash on the original crisis date.
- The regression suite verifies the original-date remainder after a partial early collection and checks that the simulated curve rejoins the baseline on that date. Existing tests cover later residual shortfalls and stale simulations after a ledger edit.
- Date and money tests cover the year boundary, a date independent of the browser time zone, exact paise, and Indian digit grouping.

## Gemini and fallback

- The one-page [fictional invoice](../output/pdf/synthetic-invoice.pdf) was visually rendered and checked against its text. Expected draft values are `CK-DEMO-104`, Paper Lantern Studio, INR 12,500.25, issue date 2026-11-13 and due date 2026-11-26.
- Live local Gemini using the existing `gemini-3.1-flash-lite` setting initially returned HTTP 503 `AI_BUSY`. A retry extracted all six fields. The explicit save returned HTTP 201 and the forecast showed 1,250,025 paise on the confirmed collection date. The Hindi advisor returned a live result. The English reminder request timed out and returned a labeled template with the correct outstanding amount.
- Chromium used a controlled provider response to verify that saving a scanned draft requires confirmation. Switching to manual entry during a pending scan prevented the delayed response from opening a review dialog.

## Security and build

- On the built public app, private settings, invoices, expenses and invoice extraction returned HTTP 403. Public AI status reported no configured provider. Two isolated browser contexts and the sandbox API suite verified visitor separation. Automated tests covered request and rate limits, invalid input, and no calls to injected MongoDB or Gemini providers in public mode.
- **110 automated tests passed, 0 failed**, including the 108 pre-existing tests. The production build passed. The final test rerun used workspace temporary storage after the Windows system temporary drive ran out of space.
- The UI UX Pro Max repository documents an MIT license and project-local Codex support using `uipro init --ai codex`. Its target `.agents/skills` is protected in this workspace. Phase 6 used the published accessibility and responsive design guidance as a reference. The installer and skill were not run. [Official repository](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · [MIT license](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/LICENSE)

## Submission readiness

- [x] The timed [demo script](DEMO_SCRIPT.md), [judge Q&A](JUDGE_QA.md), synthetic invoice, and local fallback instructions are ready.
- [x] The public demo and local extraction flow were verified on loopback. Public deployment, repository publication and video recording remain pending approval.
- [ ] Confirm the submission cutoff, required assets and hosting target. Verify the built public app on that target before sharing a judge URL.

## Phase 7 production rehearsal

- **Build and startup.** Node.js 24.16.0. The Vite production build passed. The exact `npm start` command served the health route with `NODE_ENV=production` and `PUBLIC_DEMO=true`. With the generated index temporarily absent, startup exited with status 1 and a build instruction. The index was restored.
- **Browser.** Chromium at 1440 and 375 CSS pixels used the built app in two separate contexts. The public flow covered Try Demo, editing an expected invoice date and an expense, automatic recalculation, custom early collection, comparison, reset and refresh. In the edited scenario, 17 November went from −₹20,000 to ₹0 and the 1 December deficit of ₹5,749.75 remained visible in both series and the daily table. The mobile context retained its own scenario after the desktop reset.
- **Security and health.** Both health paths returned HTTP 200 with the database disabled. Private ledger routes and invoice upload returned 403. The public AI status reported no configured provider and the advisor used a labeled template. Browser checks passed with the final Content Security Policy and same-origin font assets. Automated tests covered configured proxy origin, origin rejection, bounded concurrent requests and sanitized errors.
- **Local AI.** One controlled live sequence with the existing `gemini-3.1-flash-lite` model extracted the six fictional PDF fields without mutating the ledger. An explicit save created the 1,250,025 paise receipt for 26 November. The Hindi advisor and English reminder each returned a Gemini-assisted result. A mocked timeout test verified scanner error handling and labeled advisor and reminder fallback.
- **Tests and secrets.** 117 tests passed, 0 failed, including the 110 pre-existing tests. A local scan of source, submission files and built assets found no configured secret values or common credential patterns outside excluded local configuration. The folder had no Git metadata, so staged files and history could not be verified. Review them before publishing.
- **Handoff.** The team owner supplied the cutoff of 22 November 2026 at 11:59 PM IST. Provider account eligibility, hosted ingress behavior, a public URL, repository publication and video submission remain pending. See [Deployment](DEPLOYMENT.md) and the [Submission checklist](SUBMISSION_CHECKLIST.md).

## Phase 8A repository preparation

- The full Vitest suite passed again with **117 passing tests and 0 failures**. The Vite production build passed. This pass used synthetic fixtures and test doubles for provider responses.
- The README gallery uses four actual Phase 7.5 screenshots of Copper Kite Stationery. The local QA captures and installed UI UX Pro Max v2.15.0 skills are excluded from the public file set. The project-specific design notes remain in the repository.
