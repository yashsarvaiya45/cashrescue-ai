# CashRescue AI · five-minute judge demo

Finovators · Arthaton 2026 · Target runtime 4 minutes 30 seconds

## Prepare two tabs

- Start the public sandbox on port 3001 and the local Gemini workspace on port 3002. Use separate PowerShell windows and the commands below. Both bind to loopback. Build once from the repository root.
- Keep the [synthetic invoice](../output/pdf/synthetic-invoice.pdf) ready in the file picker. Start with a fresh local demo ledger or reset it to clear a previously saved `CK-DEMO-104`.

~~~powershell
# Public sandbox
Set-Location E:\cashrescue-ai
npm.cmd run build
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
$env:PUBLIC_DEMO = 'true'
npm.cmd start
~~~

~~~powershell
# Local Gemini workspace. The server loads the existing server/.env.
Set-Location E:\cashrescue-ai
$env:HOST = '127.0.0.1'
$env:PORT = '3002'
$env:PUBLIC_DEMO = 'false'
$env:MONGODB_URI = ''
npm.cmd start
~~~

## Walkthrough

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:30 | Public tab, **Try Demo** | “A small business can have invoices coming in and still miss payroll. Copper Kite Stationery starts with ₹25,000. The question is which cash arrives before its bills are due.” |
| 0:30–1:15 | Crisis alert and baseline chart | “The first projected shortfall is 17 November 2026. Workshop wages of ₹45,000 fall on a day with no scheduled receipts. That leaves the business ₹20,000 below zero.” |
| 1:15–2:10 | **Explore rescue** and comparison | “The solver works backward from the deficit and recommends requesting ₹20,000 early from Blue Banyan Learning. The modeled receipt moves to 15 November. The other ₹10,000 remains on the original expected date, 21 November.” Point to **Baseline peak shortfall** and **Max remaining shortfall**. |
| 2:10–2:45 | Editable simulation and ledger | Change the Blue Banyan early amount to ₹10,000 and run the simulation. Show that the remaining shortfall is ₹10,000. Point out that visitors can edit their own fictional invoices and expenses or reset their tab. |
| 2:45–3:55 | Local tab, **Invoices → AI invoice scanner** | Upload the synthetic PDF. Compare the extracted invoice number, customer, ₹12,500.25 total and dates with the PDF. Enter 26 November 2026 as the expected payment date, confirm the details and save. The ledger and forecast now include the confirmed receipt. |
| 3:55–4:30 | Return to the public tab and select **Recommended** | “Gemini extracts a draft and can help with explanations or reminders. JavaScript calculates every balance using integer paise. For this synthetic ledger, the recommended scenario moves the maximum projected shortfall from ₹20,000 to ₹0, conditional on the customer agreeing to pay early.” |

## If the provider is slow or unavailable

- At 3:15, select **Enter manually** if no scan result is ready. Use invoice `CK-DEMO-104`, customer Paper Lantern Studio, issue date 13 November 2026, due date and expected payment date 26 November 2026, total ₹12,500.25 and ₹0 received.
- If demonstrating the advisor or a reminder, show its source label. Public mode uses **Demonstration template**. Local mode displays **Live Gemini AI** after a successful provider response.
- Keep the public baseline and rescue result as the closing shot. It needs neither Gemini nor MongoDB. Use **Reset demo** to start the walkthrough again.
