import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = process.env.COA_LOG_DIR || "C:\\Ascension\\Launcher\\resources\\ascension-live\\Logs";
const PLAYER = process.env.COA_PLAYER || "Kadd";

/** spellId -> display name */
const DOTS = {
  802678: { name: "Felstrike", applyEvents: new Set(["SPELL_AURA_APPLIED", "SPELL_AURA_APPLIED_DOSE", "SPELL_AURA_REFRESH"]) },
  805748: {
    name: "Ruin (DoT)",
    applyEvents: new Set(["SPELL_AURA_APPLIED", "SPELL_AURA_APPLIED_DOSE", "SPELL_AURA_REFRESH"]),
  },
};

const DIRECT = {
  501288: "Fel Fireball",
  501298: "Ruin (direct)",
};

async function main() {
  const files = (process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(LOG_DIR).filter((f) => f.endsWith("WoWCombatLog.txt")).map((f) => path.join(LOG_DIR, f))
  ).filter((f) => fs.existsSync(f));

  if (!files.length) throw new Error(`No log files found in ${LOG_DIR}`);

  const all = {
    felstrike: await collectDotSeries(files, "802678"),
    ruinDot: await collectDotSeries(files, "805748"),
    ruinDirectToDot: await collectRuinDirectToDot(files),
  };

  const out = path.join(ROOT, "data", "parsed", "dot-timing.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(all, null, 2));

  printSummary("Felstrike", all.felstrike);
  printSummary("Ruin (DoT)", all.ruinDot);
  printRuinPairSummary(all.ruinDirectToDot);
  console.log(`\nWrote ${out}`);
}

async function collectDotSeries(files, spellId) {
  const firstTickDelays = [];
  const retickIntervals = [];
  const tickCounts = [];
  const auraDurations = [];
  let applications = 0;

  for (const file of files) {
    const series = [];
    let current = null;

    for await (const line of readLines(file)) {
      const parsed = parseLine(line);
      if (!parsed || !isPlayer(parsed.fields)) continue;
      const { ts, event, fields } = parsed;
      const id = fields[6];

      if (id === spellId && DOTS[spellId].applyEvents.has(event)) {
        if (current?.ticks.length) finalizeSeries(current, firstTickDelays, retickIntervals, tickCounts, auraDurations);
        current = { applyTs: ts, ticks: [], removeTs: null };
        applications += 1;
        continue;
      }

      if (current && id === spellId && event === "SPELL_PERIODIC_DAMAGE") {
        current.ticks.push(ts);
        continue;
      }

      if (current && id === spellId && event === "SPELL_AURA_REMOVED") {
        current.removeTs = ts;
        finalizeSeries(current, firstTickDelays, retickIntervals, tickCounts, auraDurations);
        current = null;
      }
    }

    if (current?.ticks.length) finalizeSeries(current, firstTickDelays, retickIntervals, tickCounts, auraDurations);
  }

  return {
    spellId: Number(spellId),
    name: DOTS[spellId].name,
    applications,
    samples: {
      firstTickDelaySec: summarize(firstTickDelays),
      retickIntervalSec: summarize(retickIntervals),
      ticksPerApplication: summarize(tickCounts),
      auraDurationSec: summarize(auraDurations),
    },
    histogram: {
      firstTickDelaySec: bucket(firstTickDelays, 0.05),
      retickIntervalSec: bucket(retickIntervals, 0.05),
    },
  };
}

function finalizeSeries(series, firstTickDelays, retickIntervals, tickCounts, auraDurations) {
  if (!series.ticks.length) return;
  firstTickDelays.push(series.ticks[0] - series.applyTs);
  for (let i = 1; i < series.ticks.length; i++) {
    retickIntervals.push(series.ticks[i] - series.ticks[i - 1]);
  }
  tickCounts.push(series.ticks.length);
  if (series.removeTs != null) auraDurations.push(series.removeTs - series.applyTs);
}

/** Time from Ruin direct hit to first Ruin DoT tick (and aura apply if present). */
async function collectRuinDirectToDot(files) {
  const directToFirstTick = [];
  const directToAura = [];
  const auraToFirstTick = [];

  for (const file of files) {
    let lastDirect = null;
    let pendingAura = null;

    for await (const line of readLines(file)) {
      const parsed = parseLine(line);
      if (!parsed || !isPlayer(parsed.fields)) continue;
      const { ts, event, fields } = parsed;
      const id = fields[6];

      if (id === "501298" && event === "SPELL_DAMAGE") {
        lastDirect = ts;
        pendingAura = null;
        continue;
      }

      if (lastDirect != null && id === "805748") {
        if (DOTS["805748"].applyEvents.has(event)) {
          pendingAura = ts;
          directToAura.push(ts - lastDirect);
        }
        if (event === "SPELL_PERIODIC_DAMAGE") {
          directToFirstTick.push(ts - lastDirect);
          if (pendingAura != null) auraToFirstTick.push(ts - pendingAura);
          lastDirect = null;
          pendingAura = null;
        }
      }
    }
  }

  return {
    directHitToFirstTickSec: summarize(directToFirstTick),
    directHitToAuraApplySec: summarize(directToAura),
    auraApplyToFirstTickSec: summarize(auraToFirstTick),
    histogram: {
      directHitToFirstTickSec: bucket(directToFirstTick, 0.05),
      retickIntervalSec: null,
    },
  };
}

function summarize(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p10: round(percentile(sorted, 0.1)),
    median: round(percentile(sorted, 0.5)),
    p90: round(percentile(sorted, 0.9)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

function bucket(values, step) {
  const map = new Map();
  for (const value of values) {
    const key = round(Math.round(value / step) * step);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([sec, count]) => ({ sec, count }));
}

function percentile(sorted, q) {
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function printSummary(label, data) {
  console.log(`\n=== ${label} ===`);
  console.log(`Applications with ≥1 tick: ${data.samples.firstTickDelaySec.count}`);
  console.log(`First tick delay (apply → tick): ${fmtStats(data.samples.firstTickDelaySec)}`);
  console.log(`Re-tick interval: ${fmtStats(data.samples.retickIntervalSec)}`);
  console.log(`Ticks per application: ${fmtStats(data.samples.ticksPerApplication)}`);
  console.log(`Aura duration (apply → remove): ${fmtStats(data.samples.auraDurationSec)}`);
  if (data.histogram.firstTickDelaySec.length) {
    console.log("First tick delay histogram:", data.histogram.firstTickDelaySec.slice(0, 12).map((b) => `${b.sec}s×${b.count}`).join(", "));
  }
  if (data.histogram.retickIntervalSec.length) {
    console.log("Re-tick histogram:", data.histogram.retickIntervalSec.slice(0, 12).map((b) => `${b.sec}s×${b.count}`).join(", "));
  }
}

function printRuinPairSummary(data) {
  console.log("\n=== Ruin direct → DoT ===");
  console.log(`Direct hit → first DoT tick: ${fmtStats(data.directHitToFirstTickSec)}`);
  console.log(`Direct hit → aura apply: ${fmtStats(data.directHitToAuraApplySec)}`);
  console.log(`Aura apply → first tick: ${fmtStats(data.auraApplyToFirstTickSec)}`);
}

function fmtStats(stats) {
  if (!stats.count) return "no samples";
  return `n=${stats.count} median=${stats.median}s p10=${stats.p10}s p90=${stats.p90}s mean=${stats.mean}s`;
}

async function* readLines(file) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) yield line;
}

function isPlayer(fields) {
  return unquote(fields[1] || "") === PLAYER;
}

function parseLine(line) {
  const head = line.match(/^(\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}\.\d+)\s+(\w+),(.*)$/);
  if (!head) return null;
  return { ts: parseStamp(head[1]), event: head[2], fields: splitCsv(head[3]) };
}

function parseStamp(stamp) {
  const match = stamp.match(/^(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)$/);
  if (!match) return 0;
  return (
    Number(match[1]) * 2_678_400 +
    Number(match[2]) * 86_400 +
    Number(match[3]) * 3_600 +
    Number(match[4]) * 60 +
    Number(match[5]) +
    Number((match[6] + "000").slice(0, 3)) / 1_000
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
    } else current += char;
  }
  out.push(current);
  return out;
}

function unquote(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
