# Aisle

Aisle is a first-draft **one-person AI marketing company** for neighbourhood retailer **Lane & Co.** One Human Founder supervises four agents: Trend Analyser → Image Generation → Compliance Checker (HITL) → Media Manager.

This README is for teammates who need to clone the repo, install it, and run it locally.

## What you need

- **Node.js 20+** (22 is fine). Check with `node -v`.
- **npm** (comes with Node). Check with `npm -v`.
- A browser. Chrome or Safari is enough.
- **Git** and a GitHub account so you can clone.

Optional, only if you want a live local LLM instead of the simulated agents:

- [Ollama](https://ollama.com) running at `http://127.0.0.1:11434`

You do **not** need OpenAI, Claude, or Cursor API keys to open the app. Cloud backends stay unwired until someone adds keys; the UI still runs with stubbed / simulated agents.

## Clone and run

```bash
git clone <PASTE_REPO_URL_HERE>
cd aisle
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then **sign up** — any email and
an 8-character password is enough. Five shared team desks already exist for the class
group and all use the password **`aisle-demo-2026`** (`alex@aisle.website`,
`sam@aisle.website`, `jordan@aisle.website`, `riley@aisle.website`,
`casey@aisle.website`). Change it with `npm run user -- reset-passwords` after
setting `AISLE_SEED_PASSWORD`.

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

npm run user                      # accounts, backend, and the seeded password
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
| `OPENAI_API_KEY` | Settings → OpenAI for an agent |
| `ANTHROPIC_API_KEY` | Settings → Claude for an agent |
| Local Ollama | No key. In Settings set Local and base URL `http://127.0.0.1:11434/v1` |

Do not commit `.env.local`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local Next.js app (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run bench` | **Agent bench scenario suite** — drives the real engine through every Stage 1 use case in Node, no browser and no API keys. This is the fastest way to see whether the system still behaves |
| `npm run auth` | **Accounts and storage suite** — creates accounts, checks uniqueness, sessions and workspace persistence against a throwaway database |
| `npm run user` | Account maintenance: `list`, `add`, `password`, `reset-passwords` |

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

Agents are **simulated** by default: every decision has a deterministic fallback, so
the app is fully demonstrable with no keys at all, and the run trace states whether
a decision came from a live model or the rules. Settings can point an agent at
Local / OpenAI / Claude / Cursor. Local Ollama is the only live path that is
actually attempted (`/chat/completions`, short timeout); cloud adapters throw until
wired.

The Trend Analyser additionally calls **real public sources** with no key required:
Open-Meteo (campaign-window forecast), Wikipedia's REST API (category context) and
DuckDuckGo's instant-answer API (competitor language). When the network is
unavailable the tool records that fact and the brief carries it as a limitation
rather than inventing an answer.

See `docs/STAGE2-IMPLEMENTATION.md` for the full Stage 1 → code → test traceability,
including exactly which parts are modelled rather than live.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Zustand** (client persist)
- **SQL** accounts and workspaces — `node:sqlite` locally, Postgres in production
- Optional **Ollama** (OpenAI-compatible local LLM)

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
start over: delete `data/aisle.db` and reload — the team desks are recreated.

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

**Ollama errors in the log**  
That is fine. Agents still finish with the simulator. Check Settings → Local URL and that `ollama serve` is running.

**Someone committed `.env.local`**  
Rotate those keys. Add the file to `.gitignore` if it is missing.

## Repo hygiene

- Commit source, lockfile, and `.env.example`.
- Never commit `.env.local`, API keys, or `node_modules`.
- Prefer one feature branch per person; open a PR into `main`.
