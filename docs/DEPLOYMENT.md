# CashRescue AI deployment

Finovators · Arthaton 2026 · Submission deadline supplied by the team owner is 22 November 2026 at 11:59 PM IST.

## Hosting recommendation

Use one **Render Node Web Service** in public demo mode. Express serves the Vite build and the API from the same origin. The service needs no database, persistent disk, Gemini key, worker, or separate frontend deployment.

| Provider | Setup and availability | Cost considerations |
| --- | --- | --- |
| Render | One Node Web Service from the repository root, managed HTTPS and an HTTP health check. Free compute sleeps after 15 minutes idle and takes about a minute to wake. Paid compute removes that idle sleep. | Render currently documents Free compute with 750 instance hours per workspace per month, plus workspace build and bandwidth allowances. Starter compute is listed at $7/month. Confirm account eligibility, plan and current allowances before creating a service. [Web Services](https://render.com/docs/web-services) · [Free limits](https://render.com/docs/free) · [Pricing](https://render.com/pricing) |
| Railway | One Railpack Node service with a public HTTPS domain and health check. Use the commands below and bind to the injected port. Optional Serverless can sleep after inactivity, which adds first-request latency. | The current Free plan includes $1/month in resources. Trial credits are temporary and access can depend on verification. Hobby starts at $5/month with resource usage applied to the subscription allowance. Actual use varies with CPU, memory and egress. [Plans](https://docs.railway.com/pricing/plans) · [Trial](https://docs.railway.com/pricing/free-trial) · [Public networking](https://docs.railway.com/networking/public-networking) · [Serverless](https://docs.railway.com/deployments/serverless) |

Render is the simpler handoff because the service has explicit build, start and health settings and the free tier's idle behavior is documented. For an unattended judge link, the idle delay is a material tradeoff. Check the free URL from a clean browser after it has gone idle and disclose the wait in the submission if needed. A paid instance is an owner decision and requires separate approval.

## Render service settings

Use the repository root, the Node runtime and one instance. Supply the following once deployment is approved.

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| `NODE_VERSION` | `24.16.0`, the version used for local verification |
| `NODE_ENV` | `production` |
| `PUBLIC_DEMO` | `true` |
| `HOST` | `0.0.0.0` |
| `PORT` | Let Render supply this. Its documented default is `10000`. |
| `PUBLIC_ORIGIN` | The exact canonical HTTPS origin, for example `https://your-service.onrender.com`, without a trailing slash |

Leave `MONGODB_URI`, `GEMINI_API_KEY`, `GEMINI_MODEL` and `API_PROXY_TARGET` unset on the hosted service. Local AI remains available in a separate loopback process configured through `server/.env`. The Vite dev server and its proxy are for local development. [Render Node version](https://render.com/docs/node-version) · [Render health checks](https://render.com/docs/health-checks)

The browser and API use the same origin. `PUBLIC_ORIGIN` keeps browser checks correct if a managed proxy rewrites the upstream Host header. Configure it once the platform assigns a domain and use that origin for judging. Forwarding headers are not trusted for identity. Hosted calculations share a process-wide budget of 160 requests per minute and eight in-flight requests. An ingress can group multiple visitors into one rate-limit bucket. A single instance is sufficient for the initial judge demo, subject to the hosted smoke test.

## Production rehearsal on loopback

~~~powershell
Set-Location E:\cashrescue-ai
npm.cmd ci --include=dev
npm.cmd test
npm.cmd run build
$env:NODE_ENV = 'production'
$env:PUBLIC_DEMO = 'true'
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:3001'
npm.cmd start
~~~

Open the dashboard in two separate browser contexts. Check `GET /api/health` for HTTP 200 with `database: disabled`. Check `GET /api/v1/ai/status` for `configured: false`. After stopping the process, close the PowerShell window or remove the temporary environment variables before starting local editable mode.

## Phase 8 handoff

1. Review the [submission checklist](SUBMISSION_CHECKLIST.md). Initialize or select the intended Git repository and inspect the exact staged files and any existing history before publishing. Keep environment files and private credentials out of the repository.
2. After publication and deployment approval, create the Render Web Service from the approved branch and enter the settings above. Select only an approved plan. Set `PUBLIC_ORIGIN` after the assigned domain is known and apply the updated settings.
3. Open the hosted URL over HTTPS in clean desktop and mobile browsers. Confirm health, **Try Demo**, an invoice edit, scenario comparison, a later residual deficit, reset, and refresh. Check that private ledger routes and public upload return 403, public AI uses a labeled template, and a different tab has independent data.
4. Recheck access after idle time before sharing the judge URL. Record the separately run local Gemini demonstration with the synthetic PDF if that is required by the submission portal.

The production build was verified on loopback. A provider account, chosen plan, hosted HTTPS URL, and provider-specific ingress behavior remain to be verified in the approved deployment phase.
