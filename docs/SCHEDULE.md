# Implementation schedule

CashRescue AI · Finovators (solo) · Arthaton 2026

Dates are in IST. Implementation targets assume Phase 1 approval by 14 November and prompt approval at later phase gates. The team owner supplied a cutoff of 22 November 2026 at 11:59 PM IST. Confirm the portal's required assets before submission.

| Target | Phase | Work and exit check |
| --- | --- | --- |
| Fri 13 Nov | 0 | Review the technical plan, solver assumptions and scope. Submit the planning files for approval. |
| Sat 14 Nov | 1 | Scaffold client and server with optional MongoDB configuration. Define the synthetic fixture and money and date conventions. Verify local startup and API health without credentials. |
| Sun 15 Nov | 1 | Implement and test the forecast against the hand-calculated baseline and edge cases. Review the phase exit before building the solver and wiring the UI. |
| Mon 16 Nov | 2 | Implement and test the rescue solver against the synthetic shortfall. Add the analysis and custom simulation endpoints. |
| Tue 17 Nov | 2 | Finish the synthetic ledger dashboard, baseline and rescue curves, and amount controls. Run the seeded browser flow and core tests. |
| Wed 18 Nov | 3 | Add settings, invoices and expenses with revisioned local storage. Verify payment status and forecast refresh after edits. |
| Thu 19 Nov | 3 | Complete the ledger UI and verify the manual input-to-rescue workflow. Check public demo isolation and MongoDB failure handling. |
| Fri 20 Nov | 4 | Integrate Gemini invoice review, explanations and copy-only reminders. Verify synthetic requests, fallbacks and the production build. |
| Sat 21 Nov | 5 | Verify public sandbox isolation, edit-to-rescue and reset in two independent sessions. Check mobile and desktop layouts and local-mode regression. |
| By Sun 22 Nov | 7 | Complete the production rehearsal and hosting handoff before publication or deployment. |
| Sun 22 Nov | Next approval | Verify the hosted demo and submission assets. Reserve time for portal issues and submit before 11:59 PM IST. |

## Delivery priorities

- **Core target by 17 November.** Show a synthetic cash crisis, its contributing cash events and the impact of early collection on the same chart. This is the first complete demo and the fallback if external services fail.
- **Editable ledger target by 19 November.** Demonstrate manual invoice and expense entry through rescue, with the synthetic demo available without credentials.
- **If approval or integration slips.** Preserve the core verification and submission buffer. Reduce chart refinements and supported invoice layouts first. Keep manual entry and template text available if the live Gemini path remains unverified.

## Open inputs

- Confirm the event portal's required assets and whether judges need a public URL.
- Confirm access to MongoDB and a Gemini API key with quota for the synthetic demo. A local MongoDB instance is sufficient for the local demonstration.
