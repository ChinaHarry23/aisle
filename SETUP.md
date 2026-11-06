# SETUP.md — Week 13 on-site deployment

You are deploying **Aisle** for the ELEC5620 Week 13 demonstration. The marker downloaded this folder as a zip from Canvas. Build and run it from this source on this computer. Do not demonstrate a server that was already running on another machine, and do not deploy it to Vercel for the demo.

There is no mobile app in this repository. The website and the backend are one Next.js server.

Stop when all of these are true:

1. `http://127.0.0.1:<port>/api/health` returns `"ok": true` and `"accounts": 5`.
2. `http://localhost:<port>/login` loads in a browser on this VM.
3. Sign-in works with `alex@aisle.website` / `aisle-demo-2026`.

The default port is **3000**.

## Facts

| Item | Value |
|---|---|
| Project root | The folder that contains this file, `package.json`, `Dockerfile` and `docker-compose.yml` |
| Sign-in | `alex@aisle.website` / `aisle-demo-2026` |
| Same password | `sam@aisle.website`, `jordan@aisle.website`, `riley@aisle.website`, `casey@aisle.website` |
| Demo `AUTH_SECRET` | `aisle-onsite-demo-auth-secret-2026` (classroom only, already wired in for Docker) |
| Database | SQLite file inside the `aisle-data` Docker volume, or `./data/aisle.db` on Path B |
| API keys | Not required. With no keys the agents use built-in rules and image generation returns placeholders |
| What “running” means | One production Next.js process. Campaign agents run inside it |

Do not set `AISLE_HOSTED=1`. Do not set `DATABASE_URL`. Either one can turn off the published demo password or send the app at a database this VM cannot reach.

## Before you build

1. Unzip onto the VM’s own disk, for example `~/aisle`. Do not build from a Parallels shared folder (`/Volumes/...` or `Parallels Shared Folders`). `scripts/onsite-up.sh` refuses those paths.
2. Open a terminal and `cd` to the project root. `ls` must show `SETUP.md` and `package.json`.
3. Use **Path A** if Docker is running. Use **Path B** only when Docker Desktop cannot start inside this VM.
4. Give the VM at least 8 GB RAM, 4 CPUs and 10 GB free disk if you can. `df -h ~` shows free disk. A Next.js production build will fail when the disk or the Docker memory limit is too small.

Docker Desktop inside a Parallels macOS VM needs the VM’s nested virtualization switched on. Change that only while the VM is shut down, in the VM’s CPU settings. If Docker Desktop then still says virtualization is unavailable, do not keep retrying it. Use Path B.

Installing Docker or Node before demonstration day is allowed. The image or the `npm` build still has to be produced from this unzipped source on the day. You may pre-pull the base image so the day-of build is shorter:

```bash
docker pull node:22-bookworm-slim
```

## Path A — Docker

This is the deployment to use when `docker info` succeeds.

```bash
cd /path/to/aisle
sh scripts/onsite-up.sh
```

The script builds `aisle:onsite` from this folder and publishes port 3000. The first build downloads the Node image and the npm packages. On a Parallels VM that is often **8–20 minutes**. Later starts are about a minute when the image is already built.

When it finishes it prints the health JSON. You want `"ok": true`, `"database": { "kind": "sqlite" ...}` and `"accounts": 5`.

Then open **http://localhost:3000/login** in a browser on this VM. Use `localhost`, not the VM’s LAN address. This build sets a Secure session cookie, which browsers keep on `http://localhost` and drop on a plain `http://` IP address. If sign-in appears to succeed and then sends you back to the form, you opened the IP address.

### If port 3000 is busy

```bash
AISLE_PORT=3001 sh scripts/onsite-up.sh
```

Open **http://localhost:3001**. The process inside the container still listens on 3000. Only the host port changes.

### Confirm the image, not only the homepage

Run these from the project root. Each command should succeed.

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/login | grep -F "Aisle"
docker compose exec aisle ls services/knowledge/law/AU/text
docker compose exec aisle ffmpeg -version
docker compose exec aisle node -e "require('node:sqlite'); require('sharp'); console.log(process.version)"
```

Change `3000` if you set `AISLE_PORT`. The law directory must list seven `.txt` files. `ffmpeg -version` must print a version line. The node one-liner must print a `v22` (or newer) version.

### Day-of commands

| Intent | Command |
|---|---|
| Start or rebuild from this source | `sh scripts/onsite-up.sh` |
| Follow the log | `docker compose logs -f aisle` |
| Stop, keep accounts and generated media | `docker compose down` |
| Stop and delete the demo database | `docker compose down -v` |
| Rebuild after you changed source | `docker compose up --build -d` |

`docker compose down` does not delete the volume. `docker compose down -v` does. Do not use `-v` during the demonstration unless you mean to wipe the sign-in database.

## Path B — Node, when Docker will not start

Use this only if Path A cannot run. It builds the same source with Node and keeps the terminal in the foreground. Leave that terminal open for the whole demonstration. Ctrl-C stops the server.

Node.js **22.18 or newer** is required (`node:sqlite`). Node 24 is fine. Check with `node -v`. If `node` is missing, install the macOS installer from https://nodejs.org/ (Node 22 LTS or Node 24 LTS), open a new terminal, and run the script again. Do not use Node 18 or Node 20.

```bash
cd /path/to/aisle
sh scripts/onsite-node.sh
```

The script runs `npm ci`, writes a gitignored `.env.local` when that file is missing, runs `npm run build`, then `npm start`. The first run needs a network. Wait until the terminal says the server is ready, then open **http://localhost:3000/login**.

Story-ad video editing calls `ffmpeg`. Path A already contains it. On Path B, install it once if `ffmpeg -version` fails:

```bash
brew install ffmpeg
```

The campaign, compliance and approval demo does not need ffmpeg. Install it only if you will show a 30-second story edit.

Health check:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

Expect `"ok": true` and `"accounts": 5`. The database file is `data/aisle.db` in the project root.

## Sign in and show the product

1. Open `/login` and sign in as `alex@aisle.website` / `aisle-demo-2026`.
2. The overview has the seeded Woolworths campaigns. **Reset demo** on Overview restores them.
3. Open a campaign and use **Launch** if you need a live run. The run is Trend, then Creative, then Compliance, then it waits for the founder.
4. Approve it from **Approvals** or from the campaign page.
5. No provider key is required for that path. A missing key is not a failed deployment.

Optional keys (OpenAI, Anthropic, image providers, Firecrawl, and the others listed in `.env.example`) make live model calls. They are not part of bringing the server up. If you have keys, put them in `.env.local` in the project root and restart:

```bash
docker compose up -d
```

Never commit `.env.local`, and do not put keys inside the Canvas zip. A `LOCAL_LLM_BASE_URL` of `http://127.0.0.1:11434` points at the container itself, not at Ollama on the Mac. Leave it unset for the demo. The rules-based agents are the reliable path.

## When something fails

Read the log before changing files:

```bash
docker compose logs --tail=150 aisle
```

| What you see | What to do |
|---|---|
| `docker: command not found` or Docker Desktop never becomes ready | Path B: `sh scripts/onsite-node.sh` |
| `Cannot connect to the Docker daemon` | Open Docker Desktop and wait until it is running. Run `docker info`. Then `sh scripts/onsite-up.sh` |
| `Port 3000 is already in use` | `AISLE_PORT=3001 sh scripts/onsite-up.sh` and use port 3001 in the browser |
| `no space left on device` during the build | Free disk on the VM. Docker Desktop → Settings → Resources is the other place images fill up |
| The build is killed, or `JavaScript heap out of memory` | Give Docker Desktop at least 4 GB RAM and the VM at least 8 GB. Then `sh scripts/onsite-up.sh` |
| `AUTH_SECRET is required` | You are not running this folder’s `docker-entrypoint.sh`. Rebuild with `sh scripts/onsite-up.sh`. Do not export an empty `AUTH_SECRET` |
| Health returns `storage_unavailable` | Do not set `DATABASE_URL`. Path A forces SQLite. On Path B, `unset DATABASE_URL` and start again with `sh scripts/onsite-node.sh` |
| Health is `ok` but `accounts` is not 5 | `docker compose down -v` and `sh scripts/onsite-up.sh` on Path A. On Path B, stop the server, delete `data/aisle.db`, and start `sh scripts/onsite-node.sh` again. This wipes local demo accounts |
| Login says the demo password is refused | `AISLE_HOSTED` must be `0`. It is set in `docker-compose.yml`. Do not override it |
| Browser on the host Mac cannot connect | Open the browser inside the VM at `http://localhost:3000` |
| `Missing advertising-law text` | The image was not built from this project root. `cd` to the folder that contains `services/knowledge` and run `sh scripts/onsite-up.sh` |
| Australian law citations are empty in the product | `docker compose exec aisle ls services/knowledge/law/AU/text` must show seven files. If not, rebuild from this root |
| `ffmpeg: not found` inside the container | Rebuild. The Dockerfile installs ffmpeg. Do not use an older `aisle` image |
| `sharp` cannot be loaded | Rebuild with `docker compose build --no-cache`. Do this only for this error. It is a long build |
| `npm ci` fails on Path B | `node -v` must be v22.18 or newer. Then delete `node_modules` and run `sh scripts/onsite-node.sh` again |
| Page loads forever | Hard-refresh. The demo still has no dependency on an external database |
| Log says `ExperimentalWarning: SQLite is an experimental feature` | Expected on Node 22. Ignore it when `/api/health` returns `"ok": true` |
| `/login` shows the marketing page and will not show the form | This browser already has a `localhost` session cookie from another Aisle process. Use a private window, or clear cookies for `localhost`, then open `/login` again |

Do not “fix” a failed demo by pointing the browser at a previously deployed Vercel URL. The demonstration has to be this source, built here.

## What the Docker container includes

- Next.js production server (`node server.js` from the standalone build), port 3000 inside the container.
- SQLite at `/app/data/aisle.db` on the named volume `aisle-data`. Generated images and video go to `/app/data/generated-media`.
- The Australian advertising-law texts from `services/knowledge/law/AU/text`. The server reads those files from disk. They are copied into the image because the standalone build does not trace that path.
- `ffmpeg` and `ffprobe`, for the 30-second story-ad edit.
- `sharp`, for image overlays.
- Demo auth and the five team desks. `AISLE_HOSTED=0` keeps this a private install, so `aisle-demo-2026` works.

The separate workflow API and media worker (`npm run dev:services`) are not in this container. With `AISLE_WORKFLOW_URL` unset, launches run in the Next.js process. That is the demonstration configuration. Do not add those processes unless a feature you are showing refuses to run without them.

## Only when creating the Canvas zip

Do this on the machine that has the finished source, before upload. Do not do it on the demo VM unless someone asked you to rebuild the zip.

```bash
sh scripts/package-for-canvas.sh
```

The default output is `aisle-canvas-submission.zip` in the **parent** of this project. Upload that file. It contains source, `SETUP.md`, the Dockerfile and `package-lock.json`. It omits `node_modules`, `.next`, `.git`, `data/`, `.env.local` and local video experiments.

If you zip the folder from Finder instead, the upload can be several gigabytes and can contain secrets. Do not upload that. After unzipping on the VM, the next agent should be told: read `SETUP.md` and run `sh scripts/onsite-up.sh`.
