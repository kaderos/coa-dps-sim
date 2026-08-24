import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/parse-timeline.mjs <Combat Events Timeline.txt> [player] [out-name]");
  process.exit(1);
}

const player = process.argv[3] || "Jinn";
const outName = process.argv[4] || "jinn-snowgrave";
const raw = fs.readFileSync(path.resolve(input), "utf8");
const lines = raw.split(/\r?\n/).filter((line) => /^\d{2}:\d{2}\.\d{3}\t/.test(line));

function parseTime(ts) {
  const m = ts.match(/^(\d{2}):(\d{2})\.(\d{3})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
}

function normalizeSpell(raw) {
  let name = raw.replace(/\s+Snowgrave$/i, "").trim();
  if (name.startsWith("Self Damage")) return "Self Damage";
  return name;
}

function ruinDirect(event) {
  return event.spell === "Ruin" && event.damage > 5000;
}

function ruinDot(event) {
  return event.spell === "Ruin" && event.damage <= 5000;
}

const MODELED_SPELLS = new Set([
  "Fel Fireball",
  "Ruin",
  "Ruin (DoT)",
  "Sargeron Smite",
  "Sargeron Smite (Inner Demon)",
  "Chaos",
  "Felstrike",
]);

const CAST_SPELLS = new Set(["Fel Fireball", "Ruin", "Sargeron Smite"]);

const events = [];
for (const line of lines) {
  const [ts, rest] = line.split("\t");
  const m = rest.match(/^(.+?) (.+?) (\d+)(?: \((crit)\))?$/);
  if (!m || m[1] !== player) continue;
  events.push({
    t: parseTime(ts),
    spell: normalizeSpell(m[2]),
    damage: Number(m[3]),
    crit: Boolean(m[4]),
  });
}

if (!events.length) {
  throw new Error(`No events found for player ${player}`);
}

const first = events[0].t;
const last = events[events.length - 1].t;
const durationSec = last - first;
const totalDamage = events.reduce((sum, e) => sum + e.damage, 0);

const ruinDirectHits = events.filter(ruinDirect);
const ruinDotHits = events.filter(ruinDot);

const counts = {
  "Fel Fireball": events.filter((e) => e.spell === "Fel Fireball").length,
  "Sargeron Smite": events.filter((e) => e.spell === "Sargeron Smite").length,
  Ruin: ruinDirectHits.length,
  Chaos: events.filter((e) => e.spell === "Chaos").length,
};

const chaosDenom = counts.Ruin + counts["Sargeron Smite"];

const bySpell = new Map();
for (const event of events) {
  const key = ruinDot(event) ? "Ruin (DoT)" : event.spell;
  const rec = bySpell.get(key) || { hits: 0, crits: 0, total: 0, casts: 0 };
  rec.hits += 1;
  rec.total += event.damage;
  if (event.crit) rec.crits += 1;
  if (CAST_SPELLS.has(event.spell) && !ruinDot(event)) rec.casts += 1;
  bySpell.set(key, rec);
}

const spells = Object.fromEntries(
  [...bySpell.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, rec]) => [
      name,
      {
        name,
        hits: rec.hits,
        casts: rec.casts,
        total: rec.total,
        avgHit: rec.total / rec.hits,
        critPct: rec.hits ? (rec.crits / rec.hits) * 100 : 0,
        share: rec.total / totalDamage,
        dps: rec.total / durationSec,
        modeled: MODELED_SPELLS.has(name),
      },
    ]),
);

const modeledDps = Object.values(spells)
  .filter((row) => row.modeled)
  .reduce((sum, row) => sum + row.dps, 0);

const payload = {
  player,
  source: path.basename(input),
  durationSec,
  durationLabel: `${Math.floor(durationSec / 60)}:${String(Math.round(durationSec % 60)).padStart(2, "0")}`,
  totalDamage,
  dps: totalDamage / durationSec,
  modeledDps,
  counts,
  per120s: Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, (value / durationSec) * 120]),
  ),
  chaosProcPct: chaosDenom ? (counts.Chaos / chaosDenom) * 100 : 0,
  ruin: {
    directHits: ruinDirectHits.length,
    directAvg: ruinDirectHits.length
      ? ruinDirectHits.reduce((s, e) => s + e.damage, 0) / ruinDirectHits.length
      : null,
    directCritPct: ruinDirectHits.length
      ? (ruinDirectHits.filter((e) => e.crit).length / ruinDirectHits.length) * 100
      : null,
    dotTicks: ruinDotHits.length,
    dotAvg: ruinDotHits.length ? ruinDotHits.reduce((s, e) => s + e.damage, 0) / ruinDotHits.length : null,
    ticksPerCast: ruinDirectHits.length ? ruinDotHits.length / ruinDirectHits.length : null,
    dotShareOfRuin:
      ruinDirectHits.length || ruinDotHits.length
        ? ruinDotHits.reduce((s, e) => s + e.damage, 0) /
          (ruinDirectHits.reduce((s, e) => s + e.damage, 0) + ruinDotHits.reduce((s, e) => s + e.damage, 0))
        : null,
  },
  spells,
  note: "Parsed from AscensionLogs combat events timeline export. Ruin direct hits use damage > 5000 heuristic.",
};

const outDir = path.join(ROOT, "data", "parsed");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${outName}.json`);
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log(
  `${player}: ${payload.totalDamage.toLocaleString()} damage / ${durationSec.toFixed(1)}s = ${payload.dps.toFixed(0)} DPS`,
);
console.log(`Modeled ${modeledDps.toFixed(0)} DPS (excludes Neptulon, Envenomed, etc.)`);
console.log(`Chaos proc ${payload.chaosProcPct.toFixed(1)}% (${counts.Chaos}/${chaosDenom})`);
console.log(
  `Ruin direct ${payload.ruin.directHits} @ ${payload.ruin.directAvg?.toFixed(0)} (${payload.ruin.directCritPct?.toFixed(0)}% crit)`,
);
console.log(`Wrote ${outPath}`);
