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

Open [http://localhost:3000](http://localhost:3000).

If port 3000 is already taken, Next.js may try 3001. Use the URL printed in the terminal. Only run **one** `npm run dev` at a time.

## Environment file

Copy `.env.example` to `.env.local` in the project root. Aisle reads keys from `.env.local` on the server; it never commits secrets.

```bash
cp .env.example .env.local
```

Leave the file empty of real keys if you just want to click around the demo. Add keys only if you are wiring a backend.

Typical variables (see `.env.example` for the exact list):

| Variable | When you need it |
|---|---|
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

State lives in the browser (**Zustand**, persist key `aisle-draft-v2`). Refresh keeps demo data. **Reset demo** on Overview restores the seed campaigns.

Agents are **simulated** by default. Settings can point an agent at Local / OpenAI / Claude / Cursor. Local Ollama is the only live path that is actually attempted (`/chat/completions`, short timeout). Cloud adapters throw until wired.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Zustand** (client persist)
- Optional **Ollama** (OpenAI-compatible local LLM)

## Demo walkthrough

1. Open Overview. You should see seed campaigns (Trail Parka, Week 34 stone fruit).
2. **Campaigns → New campaign**. Fill product, audience, objective, budget, channels, dates, country. Create.
3. Open the campaign and **Launch**. Watch Trend → Creative → Compliance.
4. If it stops on **Awaiting founder**, go to **Approvals** and approve, reject, or request changes.
5. After scheduling, **Publish** from the campaign page.
6. **Performance** shows the summary used as feedback for the next brief.
7. **Settings** is where you pick models. **Studio** generates extra posters/videos using those picks.

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
| AHR-06 | Feedback | Performance → recommendation attached to the next brief |

Fictional client: **Lane & Co.** Channels: Instagram, web, email, print, in-store signage.

## Common problems

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
