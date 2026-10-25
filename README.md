# Aisle

TA-02 Trend connection setup and acceptance evidence are documented in
[docs/TA-02-TREND-CONNECTION.md](docs/TA-02-TREND-CONNECTION.md).

Aisle is a first-draft **one-person AI marketing company** for a retailer (the seeded brand is **Woolworths**). One human founder supervises four agents: Trend Analyser → Image Generation → Compliance Checker (human-in-the-loop) → Media Manager.

This README is for teammates who need to clone the repo, run it, and find their way around.

## What you need

- **Node.js 22.18+**. The local database uses Node's built-in `node:sqlite`. Check with `node -v`.
- **npm** (comes with Node).
- **Git** and a GitHub account.
- A browser.

Optional: [Ollama](https://ollama.com) at `http://127.0.0.1:11434` if you want a live local LLM.

You do **not** need any API key to open the app. Without keys the agents run on deterministic rules and image/video generation returns placeholders.

## Clone and run

```bash
git clone <REPO_URL>
cd aisle
npm install
cp .env.example .env.local   # then set AUTH_SECRET
npm run dev
```

Set `AUTH_SECRET` in `.env.local` (any long random string, e.g. `openssl rand -base64 32`). Login and signup fail without it.

Open [http://localhost:3000](http://localhost:3000) and **sign up**, or use one of the five seeded team desks:

| Email | Password |
|---|---|
| `alex@aisle.website`, `sam@aisle.website`, `jordan@aisle.website`, `riley@aisle.website`, `casey@aisle.website` | `aisle-demo-2026` |

The password is a published demo credential. Set `AISLE_SEED_PASSWORD` before the first run to change it, or change one account later with `npm run user -- password <email>`.

If port 3000 is busy Next.js picks the next one; use the URL it prints. Run only one `npm run dev` at a time.

## Environment

`.env.example` lists the common variables. A few optional ones are read only from the environment, for example `AUTH_URL`, `OPENAI_API_BASE`, `FREE_CREDITS`, `FREE_GRANTS_PER_DAY` and `AISLE_MEDIA_DIR`. Only `AUTH_SECRET` is required.

| Variable | When you need it |
|---|---|
| `AUTH_SECRET` | Always. Signs session cookies. |
| `DATABASE_URL` | Production. Otherwise a local SQLite file is used. Also accepted: `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `AISLE_DATABASE_URL`, `NEON_DATABASE_URL`, `STORAGE_URL`. |
| `AISLE_DB` | Force a backend: `sqlite` or `postgres`. |
| `AISLE_DB_FILE` | Move the SQLite file (default `./data/aisle.db`). |
| `AISLE_SEED_PASSWORD` | Password for the seeded team desks. A hosted install seeds no desks without it. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Server-wide keys for the agents. Each user can instead paste their own under Settings → Connections. |
| `LOCAL_LLM_BASE_URL` | Ollama or any OpenAI-compatible endpoint (default `http://127.0.0.1:11434/v1`). A URL saved under Settings must be loopback, or the one set here; a hosted install only uses the one set here or in `LOCAL_LLM_PROBE_URLS`. |
| `GOOGLE_AI_API_KEY` (or `GEMINI_API_KEY`), `ARK_API_KEY`, `TOKENHUB_API_KEY`, `DASHSCOPE_API_KEY` | Image providers for campaign posters, see [Models](#models). `BFL_API_KEY` is not wired yet. |
| `RUNWAYML_API_SECRET`, `KLING_*`, `MINIMAX_API_KEY`, `PIKA_API_KEY` | Video providers. Not wired yet. |

Never commit `.env.local`.

## Database

Accounts and workspaces live in a SQL database. Nothing to install locally:

```bash
npm run dev     # first request creates ./data/aisle.db and migrates it
curl localhost:3000/api/health
# {"ok":true,"database":{"kind":"sqlite",...},"accounts":5,...}
```

In production the filesystem is ephemeral, so point Aisle at a hosted Postgres by setting `DATABASE_URL` (Vercel Postgres, Neon and Supabase all work). `pg` is already a dependency. Tables are created on the first request; there is no migration step. The five team desks are seeded when the database is first reachable.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local Next.js app |
| `npm run build` / `npm run start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run bench` | **Agent bench**: drives the real engine through every Stage 1 use case in Node. No browser, no keys. The fastest way to see whether the system still behaves |
| `npm run auth` | **Accounts and storage suite**: accounts, uniqueness, sessions and workspace persistence against a throwaway database |
| `npm run user` | Account maintenance: `list`, `add`, `password`, `reset-passwords` |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, `auth`, `bench` and `build` on every PR and push. A push to `main` also builds and publishes a Docker image to GitHub Container Registry.

## App layout

The sidebar groups the pages:

| Group | Route | What it is |
|---|---|---|
| | `/` | Overview |
| Create | `/campaigns` | Campaign list |
| | `/campaigns/new` | New brief (AHR-01 starting point) |
| | `/campaigns/[id]` | Workspace: brief, research, studio, compliance, channels, feedback, runtime, log |
| | `/trends` | Trend sources: websites, feeds and uploaded documents |
| | `/studio` | **Content Generation**: workbench for ads and videos |
| Publish & Track | `/approvals` | Founder approval queue (human-in-the-loop) |
| | `/schedule` | Channel posting times |
| | `/performance` | Results and next-campaign recommendation (AHR-06) |
| Setup | `/brand` | Tone, approved/banned terms, country law |
| | `/settings` | Tabs: **Models**, **Connections**, **Profile** |
| | `/login`, `/signup` | Accounts |

Each campaign has a **Runtime** tab: the run trace, every policy decision (including refusals), every tool call, and a *boundary check* that makes an agent attempt something it isn't allowed to do so you can watch the guard block it.

### Brand guidelines

Guideline text already stored with the brand profile is added to the Creative and Compliance prompts, so breaches are flagged as brand-guideline issues. The app has no upload for new guideline documents.

### Trends

`/trends` stores sources (URLs, feeds, uploaded files) in the workspace settings. The Trend Analyser's tools currently use the public sources below; the saved sources are not yet read by the engine.

### Settings

- **Models**: pick the image/video model, and an LLM per agent, either one at a time or with a **Cheapest / Balanced / Best quality** preset.
- **Connections**: per provider, see whether a key comes from the workspace (server env) or this device, paste your own key, and **test** it. Device keys stay in this browser's `localStorage` (`aisle-byo-key:<provider>`), travel to the server per request in a header and are never stored there.
- **Profile**: change your display name.

### State

Each signed-in user's workspace is a JSON document in the database, synced from the browser's Zustand store (`aisle-ws-<userId>` in `localStorage` as a cache). **Reset demo** on Overview restores the seed campaigns.

## How the agent bench works

A **policy-guarded agent bench** runs on the server. Four agents hand work to each other; the human founder is the only actor who can approve or publish.

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

1. **A policy guard.** Every agent action is evaluated first. An agent that tries to publish, overspend, change scope or alter a cleared claim is refused, and the refusal is written to the campaign log (AHR-01 ext 13.a).
2. **An evidence ledger.** Market findings cite real sources with a date, confidence and status. A finding with no citable source is stored as a labelled assumption, and anything the analysis couldn't establish is recorded as a limitation (AHR-02).
3. **A closed feedback loop.** Only an accepted or edited recommendation travels to the next brief, and it is attached without being rewritten (AHR-06).

### Models

Agents are **simulated** by default: every decision has a deterministic fallback, and the run trace says whether a decision came from a live model or the rules. Settings can point an agent at **Local, OpenAI or Claude**. Local (Ollama / OpenAI-compatible) calls go out live. OpenAI calls go out live through the metered completion funnel (`src/lib/llm/metered-complete.ts`) when the request is marked direct (trend, copy and compliance) or carries tools, history, images or web search. Any other OpenAI request, and every Claude request, is not wired yet (`src/lib/llm/adapters.ts`). No call is made and the run uses its fallback.

**Image generation is partly wired; video is not.** Campaign posters (`src/lib/media/campaign-poster.ts`, used by the campaign run, Studio context and poster revision) call the OpenAI, Google, ByteDance, Tencent and Alibaba adapters in `src/lib/media/providers/` directly when that provider's key is set or a key is pasted in Connections, using the product photo as the reference when one is supplied. Studio's own generate path goes through `callProvider` in `src/lib/media/adapters.ts`. That function renders OpenAI and Google image-to-image when a product photo is supplied and throws "not wired" for everything else, and Studio then falls back to a placeholder with a note. Wiring another provider means writing its adapter and adding its key. Connections can test OpenAI, Anthropic and Local keys.

The Trend Analyser calls **real public sources** with no key: Open-Meteo (campaign-window forecast), Wikipedia's REST API (category context) and DuckDuckGo's instant-answer API (competitor language). If the network is unavailable the tool records that and the brief carries it as a limitation.

See `docs/STAGE2-IMPLEMENTATION.md` for the Stage 1 → code → test traceability, including which parts are modelled rather than live.

## Tech stack

- **Next.js 16** (App Router, `output: "standalone"`) + **React 19** + **TypeScript**
- **Tailwind CSS v4**, `lucide-react` and `react-icons`
- **Zustand** for client state
- **SQL** via `node:sqlite` locally and `pg` in production
- `bcryptjs` and `jose` for passwords and sessions
- `unpdf` for the compliance law index
- Optional **Ollama** as a local LLM

## Demo walkthrough

1. Open Overview. Seed campaigns are there.
2. **Campaigns → New campaign.** Fill product, audience, objective, budget, channels, dates and country. A brief that can't be run is refused with the clause it breaks.
3. Open the campaign and **Launch**. Watch Trend → Creative → Compliance on the pipeline strip, then read the **Runtime** tab.
4. The first draft deliberately carries claims the brand list forbids. Compliance returns it, Creative revises, v2 passes. The **Compliance** tab shows both attempts.
5. It stops on **Awaiting founder**. Approve, request changes or reject from **Approvals** or the campaign page.
6. **Channels** shows a version per channel with the cleared wording frozen. A channel whose format would drop a cleared claim is blocked and flagged.
7. **Publish**, then **Collect results** on **Performance**. Silent channels are marked as gaps; the recommendation is one you accept, edit or discard.
8. The accepted note is attached to the next brief you create.
9. **Content Generation** builds ads and videos from templates using the model you picked in Settings.

### Proving the guardrails

- **Campaign → Runtime → Boundary check** → *Publish the campaign*: the guard refuses and logs it.
- **New campaign** with a zero budget, no channel, or an end date before the start: launch is refused with the reason.
- **Research tab** on a campaign whose analysis couldn't reach a source: the limitation is listed.
- `npm run bench` prints all of this as assertions in about a second.

## Docker

```bash
docker compose up --build    # http://localhost:3000, data in the aisle-data volume
```

The image needs `AUTH_SECRET` (the entrypoint exits without it); `docker-compose.yml` reads `.env.local` if present. SQLite lives in `/app/data`.

## Sharing on the LAN or ngrok

`next.config.ts` allow-lists LAN and ngrok hosts for dev. If a teammate hits a cross-origin or HMR error, add their host to `allowedDevOrigins`.

```bash
npx ngrok http 3000
```

## Requirements map

| ID | Topic | In the app |
|---|---|---|
| AHR-01 | Starting point | New campaign → shared context → Trend Analyser. Founder can pause. Agents can't publish. |
| AHR-02 | Trend analysis | Research tab / Trend Analyser step |
| AHR-03 | Content generation | Content Generation + Image Generation agent |
| AHR-04 | Compliance | Compliance tab + Approvals |
| AHR-05 | Distribution | Media Manager + Schedule |
| AHR-06 | Feedback | Performance → collect → accept/edit/discard → next brief |

## Common problems

**"That email already has an account"**: that address has an account. Sign in, or use another. To start over locally, delete `data/aisle.db` and reload; the team desks are recreated.

**Signup says it could not reach its database**: run `curl localhost:3000/api/health`. Locally it means `./data/aisle.db` couldn't be created (check the folder is writable). In production it means no Postgres URL is set.

**Login or signup errors with "AUTH_SECRET is not set"**: add it to `.env.local` and restart `npm run dev`.

**`node:sqlite` not found**: upgrade Node to 22.18+.

**`npm install` fails**: check your Node version, then retry. Delete `node_modules` and the lockfile only if you need a clean install.

**Blank page or stuck on loading**: hard-refresh. If it persists, clear the `aisle-ws-*` entries in DevTools → Application → Local Storage.

**Port 3000 in use**: stop the other Next process; don't start a second `npm run dev`.

**Ollama errors in the log**: harmless. Agents finish with the rules-based simulator. Check the Local endpoint in Settings and that `ollama serve` is running.

**Someone committed `.env.local`**: rotate those keys and make sure it's in `.gitignore`.

## Repo hygiene

- Commit source, the lockfile and `.env.example`.
- Never commit `.env.local`, API keys or `node_modules`.
- One feature branch per person; open a PR into `main`. Merging to `main` publishes the image.

## PR #2 additions (intake, LangChain seats, billing, workflow)

These features landed in PR #2 and are kept alongside Cindy's workspace. They do not replace her Settings, Studio, landing page, or agent copy.

| Area | Where |
|---|---|
| CampaignContext contract | `docs/contracts/campaign-context.md` |
| Conversational intake | `/campaigns/new` → **Describe with AI assistant** (`IntakeChatbot`, `/api/intake/chat`) |
| LangChain seats | `src/lib/agents/` (wired through the metered completion funnel) |
| Credits and billing | `/billing`, Stripe env vars, `src/lib/billing/` |
| Durable workflow services | `npm run dev:services`, `services/workflow/` |
| Extra media adapters | `src/lib/media/providers/` (Cindy's Studio still uses `src/lib/media/adapters.ts` + BYO keys) |
| OAuth | `/api/auth/google`, `/api/auth/apple` |

```bash
npm run test:intake
npm run test:agents
npm run test:billing
npm run test:workflow
npm run test:trust-boundary
npm run test:media-credits
npm run test:url-guard
```
