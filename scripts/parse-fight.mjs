import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const input = process.argv[2];
if (!input) {
  console.error(
    "Usage: node scripts/parse-fight.mjs <WoWCombatLog.txt> [player] [boss-filter] [out-name]",
  );
  process.exit(1);
}

const player = process.argv[3] || "Kadd";
const bossFilter = (process.argv[4] || "Kaldros").toLowerCase();
const outName = process.argv[5] || `${player.toLowerCase()}-${bossFilter.replace(/\s+/g, "-")}`;

const INFERNAL_SPELLS = {
  501288: "Fel Fireball",
  501298: "Ruin",
  805748: "Ruin (DoT)",
  501321: "Sargeron Smite",
  803467: "Sargeron Smite (Inner Demon)",
  802676: "Chaos",
  802678: "Felstrike",
};

const CAST_START_SPELLS = new Set(["501288"]);
const CAST_SUCCESS_SPELLS = new Set(["501298", "501321", "707901"]);
const MODELED_SPELLS = new Set([
  "Fel Fireball",
  "Ruin",
  "Ruin (DoT)",
  "Sargeron Smite",
  "Sargeron Smite (Inner Demon)",
  "Chaos",
  "Felstrike",
]);

const lines = fs.readFileSync(path.resolve(input), "utf8").split(/\r?\n/);

const damageEvents = [];
const castStarts = [];
const castSuccess = [];
const bossCasts = [];
let encounter = null;
let killStamp = null;
let killTs = null;

for (const line of lines) {
  const parsed = parseLine(line);
  if (!parsed) continue;
  const { ts, event, fields, stamp } = parsed;

  if (event === "PARTY_KILL" && unquote(fields[4] || "").toLowerCase().includes(bossFilter)) {
    killStamp = stamp;
    killTs = ts;
  }

  if (unquote(fields[1] || "") !== player) continue;

  const target = unquote(fields[4] || "");
  const onBoss = target.toLowerCase().includes(bossFilter);
  if (onBoss && !encounter) encounter = target;

  if (event === "SPELL_CAST_START" && CAST_START_SPELLS.has(fields[6])) {
    castStarts.push({ ts, spellId: fields[6], name: unquote(fields[7]) });
    continue;
  }
  if (event === "SPELL_CAST_SUCCESS" && CAST_SUCCESS_SPELLS.has(fields[6])) {
    castSuccess.push({ ts, spellId: fields[6], name: unquote(fields[7]) });
    if (onBoss) bossCasts.push({ ts, spellId: fields[6], name: unquote(fields[7]) });
    continue;
  }

  if (!onBoss) continue;

  if (!["SPELL_DAMAGE", "SPELL_PERIODIC_DAMAGE"].includes(event)) continue;

  const spellId = fields[6];
  const name = canonicalName(spellId, unquote(fields[7]), event);
  const amount = Number(fields[9] || 0);
  const crit = fields[15] === "1";
  if (!Number.isFinite(amount)) continue;

  damageEvents.push({ ts, stamp, spellId, name, amount, crit, periodic: event === "SPELL_PERIODIC_DAMAGE" });
}

if (!damageEvents.length) {
  throw new Error(`No damage from ${player} to boss matching "${bossFilter}"`);
}

damageEvents.sort((a, b) => a.ts - b.ts);
const firstDamage = damageEvents[0];
const firstCast = bossCasts.sort((a, b) => a.ts - b.ts)[0];
const windowStart = Math.min(firstDamage?.ts ?? Infinity, firstCast?.ts ?? Infinity);
const windowEnd = killTs ?? damageEvents[damageEvents.length - 1].ts;
const durationSec = windowEnd - windowStart;
const first = firstDamage;
const last = damageEvents[damageEvents.length - 1];

const castsInFight = [
  ...castStarts.filter((c) => c.ts >= windowStart && c.ts <= windowEnd),
  ...castSuccess.filter((c) => c.ts >= windowStart && c.ts <= windowEnd),
];

const bySpell = new Map();
for (const event of damageEvents) {
  const rec = bySpell.get(event.name) || { hits: 0, crits: 0, total: 0, casts: 0 };
  rec.hits += 1;
  rec.total += event.amount;
  if (event.crit) rec.crits += 1;
  bySpell.set(event.name, rec);
}

for (const cast of castsInFight) {
  const name = canonicalName(cast.spellId, cast.name, "SPELL_CAST_SUCCESS");
  if (!CAST_START_SPELLS.has(cast.spellId) && !CAST_SUCCESS_SPELLS.has(cast.spellId)) continue;
  const rec = bySpell.get(name) || { hits: 0, crits: 0, total: 0, casts: 0 };
  rec.casts += 1;
  bySpell.set(name, rec);
}

const ruinDirect = damageEvents.filter((e) => e.spellId === "501298");
const ruinDot = damageEvents.filter((e) => e.spellId === "805748" || (e.name === "Ruin (DoT)" && e.periodic));

const counts = {
  "Fel Fireball": castsInFight.filter((c) => c.spellId === "501288").length,
  "Sargeron Smite": castsInFight.filter((c) => c.spellId === "501321").length,
  Ruin: castsInFight.filter((c) => c.spellId === "501298").length,
  Chaos: (bySpell.get("Chaos") || { hits: 0 }).hits,
};

const chaosDenom = counts.Ruin + counts["Sargeron Smite"];
const totalDamage = damageEvents.reduce((sum, e) => sum + e.amount, 0);

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
  encounter: encounter || bossFilter,
  source: path.basename(input),
  logFile: path.basename(input),
  fightStart: first.stamp,
  fightEnd: last.stamp,
  killAt: killStamp,
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
    directHits: ruinDirect.length,
    directAvg: ruinDirect.length ? ruinDirect.reduce((s, e) => s + e.amount, 0) / ruinDirect.length : null,
    directCritPct: ruinDirect.length
      ? (ruinDirect.filter((e) => e.crit).length / ruinDirect.length) * 100
      : null,
    dotTicks: ruinDot.length,
    dotAvg: ruinDot.length ? ruinDot.reduce((s, e) => s + e.amount, 0) / ruinDot.length : null,
    ticksPerCast: ruinDirect.length ? ruinDot.length / ruinDirect.length : null,
    dotShareOfRuin:
      ruinDirect.length || ruinDot.length
        ? ruinDot.reduce((s, e) => s + e.amount, 0) /
          (ruinDirect.reduce((s, e) => s + e.amount, 0) + ruinDot.reduce((s, e) => s + e.amount, 0))
        : null,
  },
  spells,
  note: "Parsed from WoWCombatLog.txt — damage filtered to player vs boss. Ruin DoT uses spell id 805748.",
};

const outDir = path.join(ROOT, "data", "parsed");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${outName}.json`);
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log(
  `${player} vs ${encounter}: ${totalDamage.toLocaleString()} / ${durationSec.toFixed(1)}s = ${payload.dps.toFixed(0)} DPS`,
);
console.log(`Modeled ${modeledDps.toFixed(0)} DPS`);
console.log(`Chaos proc ${payload.chaosProcPct.toFixed(1)}% (${counts.Chaos}/${chaosDenom})`);
console.log(`Casts/120s — FB ${payload.per120s["Fel Fireball"].toFixed(1)}, Smite ${payload.per120s["Sargeron Smite"].toFixed(1)}, Ruin ${payload.per120s.Ruin.toFixed(1)}`);
console.log(`Wrote ${outPath}`);

function canonicalName(spellId, rawName, event) {
  if (INFERNAL_SPELLS[spellId]) return INFERNAL_SPELLS[spellId];
  if (spellId === "501298") return "Ruin";
  if (event === "SPELL_PERIODIC_DAMAGE" && rawName === "Ruin") return "Ruin (DoT)";
  return rawName;
}

function parseLine(line) {
  const head = line.match(/^(\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}\.\d+)\s+(\w+),(.*)$/);
  if (!head) return null;
  return { ts: parseStamp(head[1]), event: head[2], fields: splitCsv(head[3]), stamp: head[1] };
}

function parseStamp(stamp) {
  const m = stamp.match(/^(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)$/);
  if (!m) return 0;
  const ms = Number((m[6] + "000").slice(0, 3));
  return (
    Number(m[1]) * 2_678_400 +
    Number(m[2]) * 86_400 +
    Number(m[3]) * 3_600 +
    Number(m[4]) * 60 +
    Number(m[5]) +
    ms / 1_000
  );
}

function splitCsv(value) {
  const out = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function unquote(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
