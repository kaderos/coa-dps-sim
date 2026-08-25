# CoA Infernal DPS Sim

Browser DPS simulator for **Felsworn Infernal** on Project Ascension Conquest of Azeroth. Architecture is inspired by [wowsims/classic](https://github.com/wowsims/classic) (MIT — link back required). It is a new TypeScript project, not a fork: wowsims does not have Felsworn, Felfury, or CoA items.

## What this repo contains

- `userscripts/bisbeard-dump.user.js` — script that probes/dumps [coa.bisbeard.com](https://coa.bisbeard.com/)
- `scripts/parse-logs.mjs` — parses local `WoWCombatLog.txt` for Kadd and ALC combatant packets.
- `scripts/ingest-bisbeard.mjs` — turns a Bisbeard dump into a slot-indexed item DB.
- `scripts/fit-spells.mjs` — fits Infernal spell averages from combat logs (not CoA Tavern).
- `src/` — stationary single-target event sim + gear picker UI.
- `vendor/wowsims-classic/` — local shallow clone of wowsims for reference (gitignored).

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

**Local dev:** Vite serves `GET /api/bisbeard/import?share=…` and fetches Bisbeard server-side (no CORS issues).

**GitHub Pages:** the production build calls the absolute Cloudflare Worker URL baked in at build time via `VITE_BISBEARD_PROXY` (Worker origin, no trailing slash). The frontend requests:

```text
{VITE_BISBEARD_PROXY}/api/bisbeard/import?share={ENCODED_SHARE_LINK}
```

Deploy / refresh the Worker:

```bash
npm run deploy:bisbeard-proxy
```

Then set repository variable **`BISBEARD_PROXY_URL`** to the Worker origin printed by Wrangler (example shape: `https://coa-dps-sim-bisbeard-proxy.<account>.workers.dev` — **not** a GitHub Pages path). Pages builds fail closed if this value is missing.

Worker `ALLOWED_ORIGINS` (see `workers/bisbeard-build-proxy/wrangler.toml`) must include the exact browser origin `https://kaderos.github.io` (no `/coa-dps-sim` path, no trailing slash), plus localhost for local testing against a deployed Worker.

## GitHub Pages

Pushes to `main` deploy via GitHub Actions to **https://kaderos.github.io/coa-dps-sim/**

```bash
npm run build   # uses base path /coa-dps-sim/
npm run preview # smoke-test dist/ locally
```

## Data policy

- Combat logs are source of truth for damage.
- Bisbeard dumps are source of truth for item stats.
