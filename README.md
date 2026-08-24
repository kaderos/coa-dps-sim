# CoA Infernal DPS Sim

Browser DPS simulator for **Felsworn Infernal** on Project Ascension Conquest of Azeroth. Architecture is inspired by [wowsims/classic](https://github.com/wowsims/classic) (MIT — link back required). It is a new TypeScript project, not a fork: wowsims does not have Felsworn, Felfury, or CoA items.

## What this repo contains

- `userscripts/bisbeard-dump.user.js` — Violentmonkey script that probes/dumps [coa.bisbeard.com](https://coa.bisbeard.com/) IndexedDB, in-memory stores, and captured JSON traffic.
- `scripts/parse-logs.mjs` — parses local `WoWCombatLog.txt` for Kadd and ALC combatant packets.
- `scripts/ingest-bisbeard.mjs` — turns a Bisbeard dump into a slot-indexed item DB.
- `scripts/fit-spells.mjs` — fits Infernal spell averages from combat logs (not CoA Tavern).
- `src/` — stationary single-target event sim + gear picker UI.
- `vendor/wowsims-classic/` — local shallow clone of wowsims for reference (gitignored).

## Violentmonkey dump

1. Install [Violentmonkey](https://violentmonkey.github.io/).
2. Create a new script and paste `userscripts/bisbeard-dump.user.js` (or open that file from disk).
3. Open https://coa.bisbeard.com/ with **CoA** selected and wait until the Database finishes loading.
4. Use the panel (or Violentmonkey menu): **Probe**, then **Dump**.
5. Copy the downloaded JSON files into `data/bisbeard/`.
6. Run `npm run ingest`.

## Local commands

```bash
npm install
npm run parse-logs
npm run ingest
npm run fit-spells
npm run dev
```

`parse-logs` reads `C:\Ascension\Launcher\resources\ascension-live\Logs` by default. Override with `COA_LOG_DIR` / `COA_PLAYER`.

Open http://localhost:5173 and click **Simulate**. Mean DPS is compared to the parsed log baseline.

## Bisbeard gear import

On the **Gear** tab, paste a Bisbeard share link (`https://coa.bisbeard.com/b/…`) and click **Import gear**. The sim loads item IDs and enchants from Bisbeard’s build API and applies them to the paper doll (phase filter updates when the build includes a phase).

Local dev proxies Bisbeard through Vite (`/bisbeard-api`). GitHub Pages needs a small CORS proxy because Bisbeard’s API only allows their own origin.

**Option A — CI auto-deploy (recommended)**

1. Create a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with **Workers Scripts: Edit**.
2. In GitHub → **Settings → Secrets and variables → Actions**, add secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID` (Cloudflare dashboard → Workers → right sidebar)
3. Push to `main` (or re-run the **Deploy GitHub Pages** workflow). CI deploys `coa-dps-sim-bisbeard-proxy` and bakes the worker URL into the build.

**Option B — manual deploy**

```bash
npm install
npx wrangler login
npm run deploy:bisbeard-proxy
```

Copy the `https://…workers.dev` URL (no trailing slash) into repository variable **`BISBEARD_PROXY_URL`**, then redeploy Pages.

## GitHub Pages

Pushes to `main` deploy via GitHub Actions to **https://kaderos.github.io/coa-dps-sim/**

```bash
npm run build   # uses base path /coa-dps-sim/
npm run preview # smoke-test dist/ locally
```

## Data policy

- Combat logs are source of truth for damage.
- Bisbeard dumps are source of truth for item stats.
- CoA Tavern is not used.
