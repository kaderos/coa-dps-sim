import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = process.env.COA_LOG_DIR || "C:\\Ascension\\Launcher\\resources\\ascension-live\\Logs";
const PLAYER = process.env.COA_PLAYER || "Kadd";
const GAP_SEC = 12;
const ST_MIN_SEC = 40;

const SPELLS = {
  17524: "Potion of Spell Power",
  501288: "Fel Fireball",
  501298: "Ruin",
  501321: "Sargeron Smite",
  520693: "Felwrath",
  560284: "Infernal",
  707901: "Bane of Fire",
  800225: "Skull of Gul'dan",
  802058: "Reckoning",
  802075: "Blood of Mannoroth",
  803904: "Annihilation",
  804216: "Inner Demon",
};

const TRACK = new Set(Object.keys(SPELLS));
const HARD_CAST = new Set(["501288", "520693"]);

const files = fs
  .readdirSync(LOG_DIR)
  .filter((name) => name.endsWith("WoWCombatLog.txt"))
  .sort();

const fights = [];
let current = null;

for (const name of files) {
  const input = fs.createReadStream(path.join(LOG_DIR, name), { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes(PLAYER) || !line.includes("SPELL_CAST_")) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { ts, event, fields } = parsed;
    if (event !== "SPELL_CAST_SUCCESS" && event !== "SPELL_CAST_START") continue;
    if (!isPlayer(fields)) continue;
    const spellId = fields[6];
    if (!TRACK.has(spellId)) continue;
    const isHard = HARD_CAST.has(spellId);
    if (isHard && event !== "SPELL_CAST_START") continue;
    if (!isHard && event !== "SPELL_CAST_SUCCESS") continue;
    const spellName = unquote(fields[7]);
    if (!current || ts - current.lastTs > GAP_SEC) {
      if (current) fights.push(finishFight(current));
      current = { startTs: ts, lastTs: ts, casts: [], counts: emptyCounts() };
    }
    current.lastTs = ts;
    current.casts.push({ t: ts - current.startTs, id: spellId, name: spellName });
    current.counts[spellId] = (current.counts[spellId] || 0) + 1;
  }
}
if (current) fights.push(finishFight(current));

const all = fights.filter((f) => f.durationSec >= 15);
const st = all.filter((f) => f.durationSec >= ST_MIN_SEC && (f.counts["520693"] || 0) === 0);
const stLong = [...st].sort((a, b) => b.durationSec - a.durationSec).slice(0, 8);

const report = {
  player: PLAYER,
  files: files.length,
  fights: all.length,
  stFights: st.length,
  allCombatSec: sum(all, "durationSec"),
  stCombatSec: sum(st, "durationSec"),
  allRates: rates(all),
  stRates: rates(st),
  cdGaps: {
    annihilation: medianGaps(all, "803904"),
    reckoning: medianGaps(all, "802058"),
    skull: medianGaps(all, "800225"),
    blood: medianGaps(all, "802075"),
    inner: medianGaps(st, "804216"),
    potion: medianGaps(all, "17524"),
  },
  stOpeners: stLong.map((f) => ({
    durationSec: Number(f.durationSec.toFixed(1)),
    felwrath: f.counts["520693"] || 0,
    infernal: f.counts["560284"] || 0,
    opener: f.casts
      .filter((c) => c.t <= 25)
      .map((c) => `${c.t.toFixed(1)} ${c.name}`),
    firstMinute: summarize(f.casts.filter((c) => c.t <= 60)),
  })),
};

console.log(JSON.stringify(report, null, 2));

function emptyCounts() {
  return Object.fromEntries(Object.keys(SPELLS).map((id) => [id, 0]));
}

function finishFight(fight) {
  return {
    durationSec: Math.max(0, fight.lastTs - fight.startTs),
    casts: fight.casts,
    counts: fight.counts,
  };
}

function sum(list, key) {
  return list.reduce((n, row) => n + row[key], 0);
}

function rates(list) {
  const sec = sum(list, "durationSec");
  const counts = emptyCounts();
  for (const fight of list) {
    for (const [id, n] of Object.entries(fight.counts)) counts[id] += n;
  }
  const perMin = {};
  const secondsEach = {};
  for (const [id, n] of Object.entries(counts)) {
    perMin[SPELLS[id]] = sec > 0 ? Number(((n / sec) * 60).toFixed(2)) : 0;
    secondsEach[SPELLS[id]] = n > 0 && sec > 0 ? Number((sec / n).toFixed(1)) : null;
  }
  return { combatSec: Number(sec.toFixed(1)), casts: counts, perMinute: perMin, secondsPerCast: secondsEach };
}

function medianGaps(list, id) {
  const gaps = [];
  for (const fight of list) {
    const times = fight.casts.filter((c) => c.id === id).map((c) => c.t);
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  }
  if (!gaps.length) return { samples: 0, median: null, mean: null };
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return {
    samples: gaps.length,
    median: Number(median.toFixed(1)),
    mean: Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)),
  };
}

function summarize(casts) {
  const counts = {};
  for (const cast of casts) counts[cast.name] = (counts[cast.name] || 0) + 1;
  return counts;
}

function parseLine(line) {
  const head = line.match(/^(\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}\.\d+)\s+(\w+),(.*)$/);
  if (!head) return null;
  return { ts: parseStamp(head[1]), event: head[2], fields: splitCsv(head[3]) };
}

function parseStamp(stamp) {
  const m = stamp.match(/^(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)$/);
  if (!m) return 0;
  const ms = Number((m[6] + "000").slice(0, 3));
  return Number(m[1]) * 2_678_400 + Number(m[2]) * 86400 + Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]) + ms / 1000;
}

function splitCsv(line) {
  const out = [];
  let cur = "";
  let quote = false;
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    else if (ch === "," && !quote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

function isPlayer(fields) {
  return unquote(fields[1] || "") === PLAYER;
}
