# Aisle

Aisle is a first-draft **one-person AI marketing company** for neighbourhood retailer **Lane & Co.** One Human Founder supervises four agents: Trend Analyser → Image Generation → Compliance Checker (HITL) → Media Manager.

This README is for teammates who need to clone the repo, install it, and run it locally.

## Durable service workflow

Run `npm run dev:services` for the four-process local architecture: the Next.js web app, workflow API, independent agent worker and media-production worker. Open `http://127.0.0.1:4003/operations`, then create a new campaign. Jobs persist after the browser closes and stop at founder approval gates. Existing legacy campaigns are preserved. See [the service workflow and rubric evidence](docs/SERVICE-WORKFLOW-AND-RUBRIC.md) for tests, architecture, setup and remaining limitations.

Local campaign videos default to **30s complete story ad**, with shorter test clips available. Studio shows the narrative timeline before rendering. Three generated scenes (10s + 10s + 6s) and a 4s authored brand/CTA card are joined into one video, with background scene progress, editing and saving tracked separately. LTX-2.5 uses the creative brief without a poster input; MiniMax retains its generated-poster requirement. FFmpeg and FFprobe must be available locally. Cloud clip limits and billing are unchanged. See [story-ad setup, review limits and recovery](codex/ltx-2.5/STORY-AD-WORKFLOW.md).

Publishing and channel analytics remain **simulated**, not real platform delivery or measured results. Real text-model decisions were separately verified with a local model; that does not prove media generation or production deployment.

## What you need

- **Node.js 22.18+**, with `node:sqlite` and TypeScript stripping for the service commands. Check with `node -v`.
- **npm** (comes with Node). Check with `npm -v`.
- A browser. Chrome or Safari is enough.
- **Git** and a GitHub account so you can clone.

Optional, only if you want a live local LLM instead of the simulated agents:

- [MTPLX](https://mtplx.com) serving Qwen3.8 Flash-Next at `http://127.0.0.1:8000` (`mtplx quickstart --port 8000`). This is the Local default; Ollama or LM Studio work through a seat's **Custom tag**.
- [ComfyUI](https://www.comfy.org) at `http://127.0.0.1:8188` for local posters (Z-Image Turbo) and ad videos (MiniMax H3).

**Settings → Apply one backend to all** switches everything at once. **Local** puts all four agents on Qwen3.8 (MTPLX) and Studio on ComfyUI. A cloud backend (OpenAI or Claude) puts the agents on that provider and Studio on GPT Image 2 posters and Gemini Omni Flash videos.

Users never enter API keys. Cloud agents, posters and videos run on the **owner's** keys from the server environment and are paid for in credits (see [Credits and billing](#credits-and-billing)). You do not need any key to open the app: local models are free, and every decision has an explicit deterministic fallback. Cursor is shown in Settings but disabled, because Cursor has no public completions API.

## Clone and run

```bash
git clone <PASTE_REPO_URL_HERE>
cd aisle
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then **sign up** — any email and
an 8-character password is enough. On a **local** install, five shared team desks
also exist for the class group (`alex@aisle.website`, `sam@aisle.website`,
`jordan@aisle.website`, `riley@aisle.website`, `casey@aisle.website`); `npm run user`
prints their local demo password. That default exists only in local development:

- On a **hosted** install (Vercel, any host with `AISLE_HOSTED=1`, or a production
  build on Postgres) the desks are created only when `AISLE_SEED_PASSWORD` is set, a
  desk that still has the local demo password is locked on first use, and login
  refuses the demo password for a desk. `npm run start` on your own machine (SQLite)
  is not hosted: the desks keep their demo password. `AISLE_HOSTED=0` forces a
  private install.
- Team desks never link to Google or Apple sign-in; they always use their password.
- A verified Google or Apple sign-in joins an existing password account for the same
  address and keeps its password. Changing a password ends every older session.
- `npm run user -- reset-passwords` sets every desk to `AISLE_SEED_PASSWORD`.
- On a hosted install a desk is **not** unlimited unless its id or email is listed in
  `AISLE_UNLIMITED_USERS`; otherwise it pays in credits like any account.

If port 3000 is already taken, Next.js may try 3001. Use the URL printed in the terminal. Only run **one** `npm run dev` at a time.

## Database

Accounts and workspaces live in a real SQL database. **You do not need to install
or sign up for anything to run Aisle locally.**

```bash
npm run dev     # first request creates ./data/aisle.db and migrates it
```

That file is a SQLite database written through Node's built-in `node:sqlite` — no
native module to compile, no service to start, no credential to lose. Node 22.5 or
newer is required for it (the app targets Node 20+ for everything else, but the
database needs 22.5+).

Check it is working:

```bash
curl localhost:3000/api/health
# {"ok":true,"database":{"kind":"sqlite","label":"sqlite file …/data/aisle.db"},"accounts":5,…}

npm run user                      # accounts, backend, and the desks' local password
npm run user -- list
npm run user -- password you@example.com
```

### Deploying to Vercel

A serverless filesystem is wiped between requests, so a SQLite file cannot hold
accounts there. Point Aisle at a hosted Postgres and it switches over on its own:

```bash
npm install pg
# then set one of these in the Vercel project's environment variables:
#   DATABASE_URL=postgres://user:pass@host/db
#   AISLE_DB=postgres
```

Vercel Postgres, Neon and Supabase all provide that URL. Tables are created on the
first request, so there is no migration step to run.

A hosted install is open to the internet, so also set:

- `AISLE_HOSTED=1`, only when the host is not Vercel (Vercel sets `VERCEL=1` itself).
  A production build on Postgres is treated as hosted even without it.
- `AISLE_CLIENT_IP_HEADER`, only off Vercel: the header your reverse proxy sets to the
  client address (e.g. `x-real-ip`). Without it every signup shares one rate-limit bucket.
- `AISLE_SEED_PASSWORD`, if you want the team desks at all. Without it none are created.
- `AISLE_UNLIMITED_USERS`, to list the desks (ids or emails) that may spend without credits.
- `AISLE_DEFAULT_BACKEND=openai` or `anthropic`. There is no local model on Vercel.
- `LOCAL_LLM_PROBE_URLS=` (empty).

> **Note:** `.env.local` may still contain a `BLOB_READ_WRITE_TOKEN` from the
> earlier Vercel Blob build. Nothing reads it any more — storage no longer depends
> on a network credential, which is what broke signup before.

## Environment file

Copy `.env.example` to `.env.local` if you are wiring optional services. Aisle reads
keys from `.env.local` on the server; it never commits secrets.

```bash
cp .env.example .env.local
```

Leave it empty of real keys if you just want to click around the demo. Add keys only if you are wiring a backend.

Typical variables (see `.env.example` for the exact list):

| Variable | When you need it |
|---|---|
| `AUTH_SECRET` | Login and signup (required) |
| `DATABASE_URL` | Production only — otherwise the local SQLite file is used |
| `OPENAI_API_KEY` | Owner key for OpenAI agents (default GPT-6.1 Sol) and GPT Image 2 posters |
| `ANTHROPIC_API_KEY` | Owner key for Claude agents |
| `GOOGLE_AI_API_KEY` (or `GEMINI_API_KEY`) | Owner key for Gemini Omni Flash videos and Nano Banana 2 posters |
| `ARK_API_KEY` | Owner key for ByteDance (BytePlus ModelArk): Seedream posters, Seedance video |
| `TOKENHUB_API_KEY` | Owner key for Tencent (TokenHub): Hunyuan Image, Hunyuan Video, Kling 3.0 |
| `DASHSCOPE_API_KEY` | Owner key for Alibaba (Model Studio): Qwen Image, Wan video |
| `STRIPE_*` | Selling credits — see [Credits and billing](#credits-and-billing) |
| `FREE_CREDITS` | One-time free credits per person (default `50`; `0` turns them off) |
| `FREE_GRANTS_PER_DAY` | At most this many free grants per UTC day across the install (default `200`) |
| `AISLE_HOSTED` | `1` marks a public host that is not Vercel as hosted (Vercel is detected by `VERCEL=1`; a production build on Postgres also counts). `0` forces a private install |
| `AISLE_CLIENT_IP_HEADER` | Off Vercel: the header your proxy sets to the client address (e.g. `x-real-ip`), for the per-address signup limit. Unset means one shared bucket |
| `AISLE_SEED_PASSWORD` | Password for the team desks. Required on a hosted install, or no desks are created |
| `AISLE_UNLIMITED_USERS` | Hosted only: comma list of user ids or emails that spend without credits. Unset means none |
| `AISLE_DEFAULT_BACKEND` | `local` (default), `openai` or `anthropic`: the backend new accounts start on. Use a cloud backend on a hosted deployment |
| `AISLE_MEDIA_PROVIDERS` | Optional allowlist of cloud media providers, e.g. `openai,google`. Empty allows every provider whose key is set |
| `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_PROBE_URLS` | Where Local seats find a model. On a hosted install only these are called and the Settings Base URL is ignored; locally the Settings URL must be loopback (`127.0.0.1`, `localhost` or `[::1]`) |
| Local MTPLX | No key. Settings → Apply one backend to all → Local. Base URL `http://127.0.0.1:8000/v1`. For Ollama use `:11434/v1` and pick **Custom tag** on each seat |

Do not commit `.env.local`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local Next.js app (Turbopack) |
| `npm run dev:services` | Web app, workflow API, agent worker and background story-ad worker |
| `npm run media:worker` | Standalone local story-ad worker; use the same workflow credentials and database configuration as the web app |
| `npm run test:story-ad` | Isolated story production and real 30s editing checks; no live model calls |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run bench` | **Agent bench scenario suite** — drives the real engine through every Stage 1 use case in Node, no browser and no API keys. This is the fastest way to see whether the system still behaves |
| `npm run test:backend` | **Backend switch suite** — checks that Local and each cloud backend move all four agents and both media models, offline |
| `npm run auth` | **Accounts and storage suite** — creates accounts, checks uniqueness, sessions and workspace persistence against a throwaway database |
| `npm run test:billing` | **Billing suite** — Stripe checkout, signed webhooks and their ordering, monthly resets, holds, free-grant limits and the proxy, against a fake Stripe and a throwaway database |
| `npm run test:metering` | **Metering suite** — agent LLM calls hold, settle and release credits correctly, and local-URL rules, against fake providers |
| `npm run test:cloud-media` | **Cloud media suite** — posters and videos through OpenAI and Google adapters, charged at real cost, against fake providers |
| `npm run test:provider-adapters` | **Provider adapter suite** — ByteDance, Tencent and Alibaba adapters, polling retries and which failures are billable, offline |
| `npm run test:providers:live` | Owner-only: a live smoke test against each provider whose key is set (spends a little real money) |
| `npm run stripe:setup` | Owner-only: creates the Stripe product, price, portal configuration and (with `--webhook-url`) the webhook endpoint (`-- --create`). Re-runs reuse what exists |
| `npm run user` | Account maintenance: `list`, `add`, `password`, `reset-passwords`, `credits <email> [delta]` |

## How the app is laid out

| Route | What it is |
|---|---|
| `/` | Overview bench |
| `/campaigns` | Campaign list |
| `/campaigns/new` | Create brief (AHR-01 starting point) |
| `/campaigns/[id]` | Workspace: brief, research, studio, compliance, channels, log |
| `/studio` | Posters and ad videos |
| `/approvals` | Founder HITL queue |
| `/schedule` | Channel posting times |
| `/performance` | Results and next-campaign recommendation (AHR-06) |
| `/brand` | Tone, approved/banned terms, country law |
| `/settings` | Per-agent LLM, image/video models, theme |
| `/billing` | Plan, credit balance, subscription, usage history |

Each campaign workspace also has a **Runtime** tab: the run trace, every policy
decision (including refusals), every tool call, and a *boundary check* that makes an
agent attempt something it is not allowed to do so you can watch the guard block
and record it.

State lives in the browser (**Zustand**, persist key `aisle-draft-v2`). Refresh keeps demo data. **Reset demo** on Overview restores the seed campaigns.

## How the agent bench works

Aisle runs a **policy-guarded agent bench** on the server. Four agents hand work to
each other; a fifth actor, the human founder, is the only one who can approve or
publish.

```
Human Founder (AHR-01)
   │  brief validated, shared context stored, spend threshold set
   ▼
Trend Analyser (AHR-02) ── real tools, evidence ledger, recorded limitations
   ▼
Image Generation (AHR-03) ── two variants, every version logged with its inputs
   ▼
Compliance Checker (AHR-04) ── confirmed breaches vs human judgement, up to 3 attempts
   ▼                                   │
Founder gate ◄──────────────────────────┘  (approve / request changes / reject)
   ▼
Media Manager (AHR-05) ── channel versions with claims frozen, conflicts flagged
   ▼
Human Founder publishes ──► Feedback (AHR-06) ── results, gaps, recommendation
   ▼
accepted note attaches to the next brief
```

Three things make it a company rather than four chatbots:

1. **A policy guard.** Every agent action is evaluated before it happens. An agent
   that tries to publish, overspend, change the scope or alter a cleared claim is
   refused, and the refusal is written to the campaign log (AHR-01 ext 13.a).
   Watch it on any campaign → **Runtime** → *Boundary check*.
2. **An evidence ledger.** Market findings cite real sources with a date, a
   confidence figure and a status. A finding with no citable source is stored as a
   labelled assumption, and anything the analysis could not establish is recorded
   as a limitation instead of being invented (AHR-02).
3. **A closed feedback loop.** Only an accepted or edited recommendation travels to
   the next brief, and it is attached without being rewritten (AHR-06, UC-06 step 12).

### Models

Each decision has an explicit deterministic fallback when the selected model is
unavailable, its structured response cannot be used, or the user is out of
credits. Settings can point agents at a local OpenAI-compatible server or at
OpenAI and Anthropic on the owner's keys. The trace records whether the model or
the fallback rules made the decision. Local ComfyUI and the cloud media
providers that pass their tests generate posters and videos. Availability is
not assumed just because a provider is listed.

Cursor is not a provider: it has no public API for chat completions, so agents
cannot call it. Seats saved on Cursor are moved to another provider.

The Trend Analyser additionally calls **real public sources** with no key required:
Open-Meteo (campaign-window forecast), Wikipedia's REST API (category context) and
DuckDuckGo's instant-answer API (competitor language). When the network is
unavailable the tool records that fact and the brief carries it as a limitation
rather than inventing an answer.

See `docs/STAGE2-IMPLEMENTATION.md` for the full Stage 1 → code → test traceability,
including exactly which parts are modelled rather than live.

## Credits and billing

### How pricing works

- **$10/month buys 1,000 credits.** One credit is worth US$0.01 and is charged at
  **2× what the provider bills**, which covers the API bill, Stripe's fees and a margin.
- The balance **resets to 1,000** each time the monthly invoice is paid. Unused
  credits do not roll over, and they expire when the subscription ends.
- Each person gets **50 free credits** once, to try cloud models (`FREE_CREDITS`
  changes the amount). "Person" means one canonical email: case, `+tags` and
  Gmail dots are ignored, so `a+1@gmail.com` and `a.1@gmail.com` do not get a
  second grant. At most `FREE_GRANTS_PER_DAY` (default 200) grants are made per
  day (a signup the cap blocked gets its grant on a later visit within 7 days),
  and one address can open at most 5 accounts an hour.
- **Local models are free** and never metered: Qwen3.8 on MTPLX, and ComfyUI
  posters and videos.
- The seeded team desks (role `dev`) are **unlimited** on a local install. On a
  hosted install only the desks listed in `AISLE_UNLIMITED_USERS` are, and desks
  get no free credits. Unlimited usage is recorded at zero, so the owner can
  still see real costs.
- Before a cloud call, the worst-case cost is held from the balance. After the
  call, the real cost is charged and the rest is returned. A user who cannot
  pay falls back to a local model, or to the deterministic rules for agent
  decisions. Studio says so and links to `/billing`.
- Holds are stored. A hold left open by a call whose server process died is
  returned after 20 minutes. A call still running when the month renews (or the
  subscription ends) is paid from the old month: the unused part of its hold is
  not added to the new 1,000. A negative balance (a call that cost more than its
  hold) carries into the next month.
- A Studio render that finished but could not be attached (the draft was approved
  or its poster changed meanwhile) is still charged, and the take stays
  downloadable from Studio.

`/billing` shows the plan, balance, subscription state and usage history, plus
a "What credits buy" table computed from the model catalogs. The balance also
appears in the top bar.

### Owner keys

Only the owner holds provider keys, in `.env.local` or the deployment's
environment:

- `OPENAI_API_KEY`: agents (default **GPT-6.1 Sol**; GPT-6 Astra and GPT-6 Luna
  are also offered) and GPT Image 2 posters.
- `ANTHROPIC_API_KEY`: Claude agents.
- `GOOGLE_AI_API_KEY` (or `GEMINI_API_KEY`): Nano Banana 2, Gemini Omni Flash, Veo 3.1 Fast.
- `ARK_API_KEY`: ByteDance Seedream and Seedance.
- `TOKENHUB_API_KEY`: Tencent Hunyuan and Kling.
- `DASHSCOPE_API_KEY`: Alibaba Qwen Image and Wan.

Users never see or enter keys. Top up or correct a balance by hand with:

```bash
npm run user -- credits someone@example.com        # balance and recent ledger
npm run user -- credits someone@example.com 250    # add 250 credits (negative removes)
```

### Stripe setup (test mode first)

Aisle talks to Stripe's REST API directly, with no SDK. Every request pins
`Stripe-Version: 2026-08-26.dahlia`, which you can override with `STRIPE_API_VERSION`.

1. In the Stripe Dashboard, switch to a **sandbox** and copy its secret key
   (`sk_test_…`) into `.env.local` as `STRIPE_SECRET_KEY`.
2. Create the product, the USD $10/month price (lookup key `aisle_monthly_1000`)
   and a Customer Portal configuration:

   ```bash
   npm run stripe:setup                 # dry run: says what it would do
   npm run stripe:setup -- --create     # creates them, or reuses ones from an earlier run
   ```

   The portal configuration allows cancelling at the end of the period, updating
   the card and viewing invoice history. Plan switching is off, because there is
   only one plan. The script prints `STRIPE_PRICE_ID` and
   `STRIPE_PORTAL_CONFIGURATION` for `.env.local`, and it never prints your
   secret key.
3. Forward webhooks to your dev server with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

   `stripe listen` prints `Your webhook signing secret is whsec_…`. Put that in
   `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. Use your real port if it
   isn't 3000; `npm run dev:services` serves on 4003. The CLI secret and a
   Dashboard endpoint's secret are different. To accept both, list them
   comma-separated.
4. Open `/billing` as a normal (non-desk) account and press **Subscribe**. Pay
   with a [test card](https://docs.stripe.com/testing#cards):
   - `4242 4242 4242 4242`, any future expiry and any CVC: succeeds.
   - `4000 0027 6000 3184`: requires 3-D Secure.
   - `4000 0000 0000 0341`: attaches but fails when charged. Use it to test a failed renewal.

   Credits appear once Stripe sends `invoice.paid`, usually within seconds. The
   success page does not grant them.
5. **Renewals:** use a [test clock](https://docs.stripe.com/billing/testing/test-clocks).
   In the Dashboard (Billing → Test clocks), create a clock and a customer on
   it. Then create a subscription to the Aisle price with the metadata
   `aisle_user_id=<account id>`; `npm run user -- credits <email>` prints the
   id. Advance the clock one month. You should see `invoice.paid` with
   `billing_reason=subscription_cycle` and the balance reset to 1,000.

**Webhook endpoint** (for a deployed site, or add `--webhook-url https://…/api/stripe/webhook`
to the setup script):

- URL: `https://<your-domain>/api/stripe/webhook`. The proxy lets it through
  without a session, and the signature is checked instead.
- Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.deleted`, `charge.refunded`, `charge.dispute.created`.
  (`customer.subscription.created` is not needed and is ignored.)
- API version: pin the endpoint to `2026-08-26.dahlia`. Webhook payloads follow
  the endpoint's version, not the request header.

What each event does:

| Event | Effect |
|---|---|
| `invoice.paid` | Resets the balance to 1,000, only for `subscription_create` and `subscription_cycle`, and once per invoice |
| `checkout.session.completed` | Links the Stripe customer and subscription to the account. No credits |
| `invoice.payment_failed` | Marks the account `past_due`; Billing asks the user to update their card |
| `customer.subscription.updated` | Syncs status, pending cancellation and period end |
| `customer.subscription.deleted` | Marks the account cancelled and expires the remaining credits |
| `customer.deleted` | Forgets the link, so the next Subscribe creates a new customer |
| `charge.refunded` (full refund) / `charge.dispute.created` | Takes the remaining credits back, once per charge. A partial refund changes nothing |

Events for customers Aisle did not create, such as `stripe trigger` fixtures,
are acknowledged and ignored. Duplicate deliveries are ignored by event id.
Stripe does not promise delivery order, so:

- A cancelled subscription stays cancelled. A late `invoice.paid` or
  `invoice.payment_failed` for it changes nothing and grants nothing.
- A late "incomplete" snapshot never overwrites an active status.
- An invoice for an earlier period, or one replayed under a new event id, never
  grants again.

### Going live

1. Configure the Customer Portal in live mode, or run
   `npm run stripe:setup -- --create --live` with a live key.
2. Create the live webhook endpoint (HTTPS, pinned API version) and store its
   `whsec_…`.
3. Set the live `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
   and `STRIPE_PORTAL_CONFIGURATION` in the production environment.
4. Sandbox customers do not exist in live mode. Aisle records which mode each
   customer belongs to and ignores rows from the other mode. If Stripe answers
   "No such customer" (a customer deleted in the Dashboard, or an old row),
   Subscribe creates a new customer and Manage billing asks the user to subscribe.
5. Pricing is in USD. An Australian account may pay a currency-conversion fee,
   and may need to charge GST. Check both with your accountant.

## Media providers

Cloud posters and videos use these adapters in `src/lib/media/providers`:

| Provider | Key | Models |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | GPT Image 2 |
| Google | `GOOGLE_AI_API_KEY` | Nano Banana 2, Gemini Omni Flash, Veo 3.1 Fast (until its preview shuts down on 2026-10-22) |
| ByteDance (BytePlus ModelArk) | `ARK_API_KEY` | Seedream, Seedance |
| Tencent (TokenHub) | `TOKENHUB_API_KEY` | Hunyuan Image, Hunyuan Video, Kling 3.0 |
| Alibaba (Model Studio) | `DASHSCOPE_API_KEY` | Qwen Image, Wan |

A provider is only enabled when all of these hold:

- it has an adapter with offline fake-server tests (all five above do);
- the owner has set its key; and
- it is listed in `AISLE_MEDIA_PROVIDERS`, if that variable is set. An empty
  `AISLE_MEDIA_PROVIDERS` allows every provider whose key is set.

Run `npm run test:providers:live` with your key before switching a provider on.
Until a provider is enabled, its models are shown greyed out as "not available".

The offline suites shorten video polling with two test-only variables. Leave
them unset in real use:

- `AISLE_MEDIA_POLL_MS` sets the poll interval.
- `AISLE_MEDIA_JOB_MS` sets the video job deadline (default 8 minutes).

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Zustand** (client persist)
- **SQL** accounts and workspaces — `node:sqlite` locally, Postgres in production
- Optional **MTPLX** (Qwen3.8, OpenAI-compatible local LLM) and **ComfyUI** (local media)

## Demo walkthrough

1. Open Overview. You should see seed campaigns (Trail Parka, Week 34 stone fruit).
2. **Campaigns → New campaign**. Fill product, audience, objective, budget, channels, dates, country. The form refuses an unusable brief before it can launch, and says which clause it is enforcing.
3. Open the campaign and **Launch**. Watch Trend → Creative → Compliance on the pipeline strip, then read the **Runtime** tab: tool calls, evidence, run steps, policy decisions.
4. The first draft deliberately carries claims the brand list forbids. Compliance returns it, the creative agent revises, and v2 passes — the **Compliance** tab shows both attempts with their input digests.
5. It stops on **Awaiting founder**. Go to **Approvals** (or the campaign page) and approve, request changes, or reject.
6. **Channels** then shows a channel version per channel with the cleared wording frozen. A channel whose format would drop a cleared claim is blocked and flagged for you rather than quietly rewritten.
7. **Publish** from the campaign page, then **Collect results** on **Performance**: reporting channels are totalled, silent ones are marked as gaps, and the recommendation is one you accept, edit or discard.
8. The accepted note is attached to the next brief you create (visible on the campaign's **Brief** tab).
9. **Settings** is where you pick models. **Studio** generates extra posters/videos using those picks.

Studio includes a live **Render progress** panel. Local ComfyUI jobs show preparing,
queued, model loading, measured sampling steps, encoding, and saving stages. The
sampling percentage is not an overall time estimate. **Ready to review / 100% saved**
appears only after the generated asset is attached to the campaign; failures and
connection interruptions are shown explicitly. Progress survives browser reloads,
and another Studio render for the same campaign is blocked while one is active.
Tracking is stored locally in `data/media-progress.db` (override with
`AISLE_MEDIA_PROGRESS_DB`) and served through an authenticated, owner-scoped route.
This local SQLite tracker is not a distributed production render queue.
Run `npm run test:media-progress` for isolated progress, privacy, state-transition,
duplicate-request and accessible-panel checks; it does not run a model.

### Proving the guardrails in the demo

- **Campaign → Runtime → Boundary check**: press *Publish the campaign* — the guard refuses and the refusal lands in the log. AHR-01 ext 13.a, live.
- **New campaign** with a zero budget, no channel, or an end date before the start: launch is refused and the reason is written down.
- **Research tab** on a campaign whose analysis could not reach a source: the limitation is listed under *What the analysis could not establish*.
- `npm run bench` prints all of the above as assertions, in about a second.

Themes (top right): **Simple / Desk / Dev**. Stored in `localStorage` (`aisle-theme`).

## Sharing on the LAN or ngrok

The app listens on **port 3000** by default (`localhost:3000`), not 3001.

`next.config.ts` allow-lists LAN and ngrok hosts so `/_next/static` is not blocked. If a teammate hits a cross-origin / HMR error, add their host to `allowedDevOrigins`.

```bash
# on the machine running the app
npx ngrok http 3000
```

Free ngrok still shows a “Visit Site” interstitial.

## Team notes (COMP / lab)

Ad-hoc requirements mapped onto this build:

| ID | Topic | In the app |
|---|---|---|
| AHR-01 | Starting point | New campaign → shared context → Trend Analyser. Founder can pause. Agents cannot publish. |
| AHR-02 | Trend analysis | Research tab / Trend Analyser step |
| AHR-03 | Content generation | Studio + Image Generation agent |
| AHR-04 | Compliance | Compliance tab + Approvals HITL |
| AHR-05 | Distribution | Media Manager + Schedule |
| AHR-06 | Feedback | Performance → collect → accept/edit/discard → attached to the next brief |

Fictional client: **Lane & Co.** Channels: Instagram, web, email, print, in-store signage.

Implementation notes for the Stage 2 submission live in
`docs/STAGE2-IMPLEMENTATION.md`, and the runnable proof is `npm run bench`.

## Common problems

**"That email already has a desk" on signup**
That address already has an account. Sign in instead, or use another address. To
start over: delete `data/aisle.db` and reload — the team desks are recreated (locally).

**Signup says the desk could not reach its database**
Run `curl localhost:3000/api/health`. In development this means `./data/aisle.db`
could not be created (check the folder is writable). In production it means no
`DATABASE_URL` is set. The health output names the backend it is trying to use.

**`npm install` fails**  
Use Node 20+. Delete `node_modules` and `package-lock.json` only if you know you need a clean install, then `npm install` again.

**Blank page / “Opening the studio…” forever**  
Hard-refresh. If it persists, DevTools → Application → Local Storage → remove `aisle-draft-v2` and reload.

**Port 3000 in use**  
Stop the other Next process. Do not start a second `npm run dev`.

**Local model errors in the log**  
That is fine. Agents still finish with the simulator. Check Settings → Local URL and that `mtplx quickstart --port 8000` (or `ollama serve`) is running. The Local card under Connection says whether the LLM and ComfyUI are answering. The Settings URL must point at this machine (`127.0.0.1`, `localhost` or `[::1]`); any other host is ignored. A hosted Aisle ignores it entirely and only uses `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_PROBE_URLS`.

**Someone committed `.env.local`**  
Rotate those keys. Add the file to `.gitignore` if it is missing.

## Repo hygiene

- Commit source, lockfile, and `.env.example`.
- Never commit `.env.local`, API keys, or `node_modules`.
- Prefer one feature branch per person; open a PR into `main`.
