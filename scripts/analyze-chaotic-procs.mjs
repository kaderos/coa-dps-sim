import fs from "node:fs";
import readline from "node:readline";

const LOG =
  process.env.COA_LOG_FILE ||
  "C:\\Ascension\\Launcher\\resources\\ascension-live\\Logs\\2026-08-20-18.26.27 WoWCombatLog.txt";
const PLAYER = process.env.COA_PLAYER || "Kadd";

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

const damages = [];
const procSources = new Map();
let procs = 0;
let unmatched = 0;

const rl = readline.createInterface({ input: fs.createReadStream(LOG, { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of rl) {
  const parsed = parseLine(line);
  if (!parsed) continue;
  const { ts, event, fields } = parsed;

  if (["SPELL_DAMAGE", "SPELL_PERIODIC_DAMAGE", "SWING_DAMAGE"].includes(event) && unquote(fields[1]) === PLAYER) {
    const amountIdx = event === "SWING_DAMAGE" ? 6 : 9;
    const amount = Number(fields[amountIdx] || 0);
    if (amount > 0) {
      damages.push({
        ts,
        name: event === "SWING_DAMAGE" ? "Melee" : unquote(fields[7]),
        periodic: event === "SPELL_PERIODIC_DAMAGE",
      });
    }
    continue;
  }

  if (
    ["SPELL_AURA_APPLIED", "SPELL_AURA_APPLIED_DOSE", "SPELL_AURA_REFRESH"].includes(event) &&
    unquote(fields[1]) === PLAYER &&
    unquote(fields[4]) === PLAYER &&
    unquote(fields[7]) === "Chaotic"
  ) {
    procs += 1;
    let best = null;
    for (let i = damages.length - 1; i >= 0; i--) {
      const lag = ts - damages[i].ts;
      if (lag > 0.25) break;
      if (lag >= 0) {
        best = damages[i];
        break;
      }
    }
    if (!best) {
      unmatched += 1;
      continue;
    }
    const key = `${best.name}${best.periodic ? " (DoT)" : ""}`;
    procSources.set(key, (procSources.get(key) || 0) + 1);
  }
}

console.log(
  JSON.stringify(
    {
      log: LOG,
      procs,
      unmatched,
      sources: [...procSources.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count, share: count / procs })),
    },
    null,
    2,
  ),
);
