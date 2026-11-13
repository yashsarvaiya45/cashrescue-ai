# CashRescue AI · judge questions

## What makes this different?

A typical forecast stops at the date cash goes negative. CashRescue AI takes the projected deficits and finds outstanding invoices whose timing could change them. It replays each candidate scenario and shows the remaining risk across the full 30 days.

## How does the Reverse Rescue Solver work?

It identifies negative daily closes and finds open invoices that were already issued and originally scheduled late enough for acceleration to help. It assumes collection two calendar days after forecast start. It searches nonempty subsets of up to 10 ranked candidates, tests full and trimmed partial amounts, and reruns the same forecast for each distinct action set. A partial payment moves an amount from the original date. The rest remains on that date. Ranking favors smaller remaining deficits and considers the number of collection actions and the amount requested. The bounded search can miss feasible plans.

## Why keep AI out of balance calculations?

The forecast and solver use validated dates and integer INR paise. The same ledger produces the same balances, and the result can be reconciled to its receipts and payments. Gemini extracts an editable invoice draft. For advisor and reminder output it selects approved options, while the server inserts verified amounts, dates and transaction labels.

## What assumptions should a business owner know?

The forecast uses supplied opening cash, expected invoice receipts and scheduled expenses. It closes each day after netting that day's cash flows. It does not model intraday liquidity or predict a customer's willingness to pay. The recommendation is conditional on collection timing and can leave a later shortage. Users reconcile already settled amounts separately in opening cash.

## What keeps the public demo isolated?

Each tab holds its own fictional ledger in memory. A bounded, rate-limited endpoint validates the snapshot and runs the financial engine with a request-scoped repository. Public mode blocks private ledger routes and uploads, ignores MongoDB and Gemini credentials, and returns labeled templates. Local editable modes bind to loopback. Use fictional inputs because the app cannot verify that a typed name belongs to a fictional person or business.

## How was accuracy checked?

The automated suite checks hand-calculated balances, exact paise, date boundaries, partial receipts, no double-counting, residual shortages and revision changes. One regression verifies that moving part of an invoice raises the curve only between the early and original receipt dates. The seed starts at ₹25,000, reaches −₹20,000 after wages, and closes at ₹10,000 when the ₹30,000 receipt is due. Moving ₹20,000 earlier yields a ₹0 minimum and still closes at ₹10,000 on the original receipt date.

## What would a business actually do with the result?

The owner can identify which customer to contact first, how much earlier collection would help and whether other obligations still leave a gap. They can compare smaller collection amounts and copy an editable reminder. The demo does not connect to bank accounts, initiate collections or send reminders.
