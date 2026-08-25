import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const LOG_DIR = process.env.COA_LOG_DIR || "C:\\Ascension\\Launcher\\resources\\ascension-live\\Logs";
const PLAYER = process.env.COA_PLAYER || "Kadd";

const files = fs
  .readdirSync(LOG_DIR)
  .filter((name) => name.endsWith("WoWCombatLog.txt"))
  .map((name) => path.join(LOG_DIR, name));

const stats = {
  fightSec: 0,
  damageEvents: 0,
  chaoticProcs: 0,
  stackSeconds: { 1: 0, 2: 0, 3: 0 },
  stackSum: 0,
  procByEvent: new Map(),
};

let inFight = false;
let fightStart = 0;
let fightEnd = 0;
let previousDamageTs = null;
let chaoticStacks = 0;
let lastStackChangeAt = 0;

function parseStamp(stamp) {
  const m = stamp.match(/^(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)$/);
  if (!m) return 0;
  const ms = Number((m[6] + "000").slice(0, 3));
  return Number(m[1]) * 2_678_400 + Number(m[2]) * 86400 + Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]) + ms / 1000;
}

function parseLine(line) {
  const head = line.match(/^(\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}\.\d+)\s+(\w+),(.*)$/);
  if (!head) return null;
  return { ts: parseStamp(head[1]), event: head[2], fields: splitCsv(head[3]) };
}

function splitCsv(s) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of s) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out;
}

function unquote(value) {
  const s = String(value ?? "");
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function isPlayerSource(fields) {
  return unquote(fields[1]) === PLAYER;
}

function isPlayerDest(fields) {
  return unquote(fields[4]) === PLAYER;
}

function accStackTime(ts) {
  if (!inFight || ts <= lastStackChangeAt || chaoticStacks <= 0) {
    lastStackChangeAt = ts;
    return;
  }
  const dt = ts - lastStackChangeAt;
  stats.stackSeconds[chaoticStacks] += dt;
  stats.stackSum += chaoticStacks * dt;
  lastStackChangeAt = ts;
}

function startFight(ts) {
  inFight = true;
  fightStart = ts;
  fightEnd = ts;
  chaoticStacks = 0;
  lastStackChangeAt = ts;
}

function endFight() {
  if (!inFight) return;
  accStackTime(fightEnd);
  stats.fightSec += Math.max(0, fightEnd - fightStart);
  inFight = false;
  chaoticStacks = 0;
}

for (const file of files) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { ts, event, fields } = parsed;

    if (["SPELL_DAMAGE", "SPELL_PERIODIC_DAMAGE", "RANGE_DAMAGE", "SWING_DAMAGE"].includes(event) && isPlayerSource(fields)) {
      const amountIdx = event === "SWING_DAMAGE" ? 6 : 9;
      const amount = Number(fields[amountIdx] || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (previousDamageTs == null || ts - previousDamageTs > 12) endFight();
      if (!inFight) startFight(ts);
      previousDamageTs = ts;
      fightEnd = ts;
      stats.damageEvents += 1;
      const label =
        event === "SWING_DAMAGE"
          ? "Melee"
          : `${unquote(fields[7])} (${event === "SPELL_PERIODIC_DAMAGE" ? "DoT" : "direct"})`;
      stats.procByEvent.set(label, (stats.procByEvent.get(label) || 0) + 1);
    }

    if (!inFight || !isPlayerDest(fields) || !isPlayerSource(fields)) continue;
    const auraName = unquote(fields[7]);
    if (auraName !== "Chaotic") continue;

    if (event === "SPELL_AURA_APPLIED" || event === "SPELL_AURA_APPLIED_DOSE" || event === "SPELL_AURA_REFRESH") {
      accStackTime(ts);
      if (event === "SPELL_AURA_APPLIED_DOSE") {
        chaoticStacks = Math.min(3, Math.max(1, Number(fields[10] || chaoticStacks + 1)));
      } else if (event === "SPELL_AURA_REFRESH") {
        chaoticStacks = Math.min(3, Math.max(1, chaoticStacks || 1));
      } else {
        chaoticStacks = Math.min(3, chaoticStacks + 1 || 1);
      }
      stats.chaoticProcs += 1;
      lastStackChangeAt = ts;
    } else if (event === "SPELL_AURA_REMOVED") {
      accStackTime(ts);
      chaoticStacks = 0;
      lastStackChangeAt = ts;
    }
  }
  endFight();
}

const uptimeAny = (stats.stackSeconds[1] + stats.stackSeconds[2] + stats.stackSeconds[3]) / stats.fightSec;
console.log(
  JSON.stringify(
    {
      fightSec: stats.fightSec,
      damageEvents: stats.damageEvents,
      chaoticProcs: stats.chaoticProcs,
      procRate: stats.chaoticProcs / stats.damageEvents,
      stackSeconds: stats.stackSeconds,
      uptimePct: {
        any: uptimeAny * 100,
        one: (stats.stackSeconds[1] / stats.fightSec) * 100,
        two: (stats.stackSeconds[2] / stats.fightSec) * 100,
        three: (stats.stackSeconds[3] / stats.fightSec) * 100,
        avgStacks: stats.stackSum / stats.fightSec,
      },
      topDamageEvents: [...stats.procByEvent.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
    },
    null,
    2,
  ),
);
