import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = process.env.COA_LOG_DIR || "C:\\Ascension\\Launcher\\resources\\ascension-live\\Logs";
const ADDON_ROOT =
  process.env.ALC_ADDON_DIR ||
  "C:\\Ascension\\Launcher\\resources\\ascension-live\\Interface\\AddOns\\AscensionLogsCompanion";
const TARGET_IDS = new Set(["501288", "501298", "501321", "707901", "802676", "802678", "803467", "805748"]);
const SPELL_NAMES = {
  501288: "Fel Fireball",
  501298: "Ruin (direct)",
  501321: "Sargeron Smite",
  707901: "Bane of Fire",
  802676: "Chaos",
  802678: "Felstrike",
  803467: "Sargeron Smite (Inner Demon)",
  805748: "Ruin (DoT)",
};

const dictionary = loadDictionary(path.join(ADDON_ROOT, "Core", "DictD1.lua"));
const itemDb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "items.json"), "utf8"));
const itemsById = new Map();
for (const list of Object.values(itemDb.slots || {})) {
  for (const item of list) itemsById.set(item.id, item);
}

const files = fs
  .readdirSync(LOG_DIR)
  .filter((name) => name.endsWith("WoWCombatLog.txt"))
  .sort();

const sessions = [];
for (const name of files) {
  const result = await analyzeFile(path.join(LOG_DIR, name));
  if (result.spellEvents > 0 || result.kaddSnapshots.length > 0) sessions.push(result);
  console.log(
    `${name}: ${result.spellEvents} target events, ${result.fights.length} fights, ${result.kaddSnapshots.length} Kadd snapshots`,
  );
}

const payload = {
  generatedAt: new Date().toISOString(),
  logDir: LOG_DIR,
  sessions,
};
const out = path.join(ROOT, "data", "parsed", "infernal-analysis.json");
fs.writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`Wrote ${out}`);

async function analyzeFile(file) {
  const spells = new Map();
  const fights = [];
  const alcGroups = new Map();
  const smitePairEvents = new Map();
  let currentFight = null;
  let previousDamageTs = null;
  let spellEvents = 0;
  let totalDamage = 0;

  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { ts, event, fields } = parsed;

    if (event === "SPELL_CAST_FAILED") {
      const reason = unquote(fields[fields.length - 1] || "");
      const chunk = parseAlc(reason);
      if (chunk) {
        const key = `${chunk.session}:${chunk.frame}`;
        const group = alcGroups.get(key) || { ...chunk, parts: [] };
        group.parts[chunk.index - 1] = chunk.payload;
        alcGroups.set(key, group);
      }
    }

    if (!["SPELL_DAMAGE", "SPELL_PERIODIC_DAMAGE", "RANGE_DAMAGE", "SWING_DAMAGE"].includes(event)) continue;
    if (unquote(fields[1] || "") !== "Kadd") continue;
    const amountIdx = event === "SWING_DAMAGE" ? 6 : 9;
    const amount = Number(fields[amountIdx] || 0);
    if (!Number.isFinite(amount)) continue;
    totalDamage += amount;

    if (previousDamageTs == null || ts - previousDamageTs > 12) {
      currentFight = { startTs: ts, endTs: ts, totalDamage: 0, spells: new Map() };
      fights.push(currentFight);
    }
    previousDamageTs = ts;
    currentFight.endTs = ts;
    currentFight.totalDamage += amount;

    if (event === "SWING_DAMAGE") continue;
    const spellId = fields[6];
    if (!TARGET_IDS.has(spellId)) continue;
    spellEvents += 1;
    const crit = fields[amountIdx + 6] === "1";
    if (spellId === "501321" || spellId === "803467") {
      const key = `${ts}|${fields[3]}`;
      const pair = smitePairEvents.get(key) || { direct: [], rider: [] };
      pair[spellId === "501321" ? "direct" : "rider"].push({ amount, crit });
      smitePairEvents.set(key, pair);
    }
    addEvent(spells, spellId, amount, crit, event === "SPELL_PERIODIC_DAMAGE");
    addEvent(currentFight.spells, spellId, amount, crit, event === "SPELL_PERIODIC_DAMAGE");
  }

  const snapshots = [];
  for (const group of alcGroups.values()) {
    if (group.parts.filter(Boolean).length !== group.total) continue;
    try {
      const compressed = Buffer.from(group.parts.join("").replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const frame = zlib.inflateRawSync(compressed, { dictionary });
      for (const record of decodeFrame(frame)) {
        if (record.type !== 1) continue;
        const body = record.body.toString("utf8");
        if (!body.includes("^Sname^SKadd") && !body.includes("^Sname^S\"Kadd\"")) continue;
        const itemIds = [...body.matchAll(/\^Sitem_id\^N(\d+)/g)].map((match) => Number(match[1]));
        snapshots.push({
          session: group.session,
          frame: group.frame,
          itemIds,
          itemSpellPower: summarizeGear(itemIds).spellPower,
          items: summarizeGear(itemIds).items,
          preview: body.slice(0, 300),
        });
      }
    } catch {
      // Incomplete/corrupt frames are expected when a log starts mid-relay.
    }
  }

  const uniqueSnapshots = [];
  const snapshotKeys = new Set();
  for (const snapshot of snapshots) {
    const key = snapshot.itemIds.join(",");
    if (snapshotKeys.has(key)) continue;
    snapshotKeys.add(key);
    uniqueSnapshots.push(snapshot);
  }

  return {
    file: path.basename(file),
    spellEvents,
    totalDamage,
    kaddSnapshots: uniqueSnapshots,
    smitePairing: summarizeSmitePairs(smitePairEvents),
    spells: summarizeMap(spells, totalDamage),
    fights: fights
      .filter((fight) => [...fight.spells.values()].reduce((sum, spell) => sum + spell.count, 0) > 0)
      .map((fight) => ({
        startTs: fight.startTs,
        durationSec: fight.endTs - fight.startTs,
        totalDamage: fight.totalDamage,
        spells: summarizeMap(fight.spells, fight.totalDamage),
      })),
  };
}

function summarizeSmitePairs(events) {
  let paired = 0;
  let exactAmount = 0;
  let directCrits = 0;
  let riderCrits = 0;
  for (const pair of events.values()) {
    const count = Math.min(pair.direct.length, pair.rider.length);
    for (let index = 0; index < count; index++) {
      paired += 1;
      if (pair.direct[index].amount === pair.rider[index].amount) exactAmount += 1;
      if (pair.direct[index].crit) directCrits += 1;
      if (pair.rider[index].crit) riderCrits += 1;
    }
  }
  return { paired, exactAmount, directCrits, riderCrits };
}

function addEvent(map, id, amount, crit, periodic) {
  const rec = map.get(id) || {
    id: Number(id),
    name: SPELL_NAMES[id] || id,
    count: 0,
    hits: 0,
    crits: 0,
    total: 0,
    hitSum: 0,
    critSum: 0,
    periodic: 0,
    amounts: [],
  };
  rec.count += 1;
  rec.total += amount;
  rec.periodic += periodic ? 1 : 0;
  rec.amounts.push(amount);
  if (crit) {
    rec.crits += 1;
    rec.critSum += amount;
  } else {
    rec.hits += 1;
    rec.hitSum += amount;
  }
  map.set(id, rec);
}

function summarizeMap(map, fightTotal = 0) {
  return Object.fromEntries(
    [...map.entries()].map(([id, rec]) => {
      const hits = rec.amounts.filter((_, index) => index >= 0);
      hits.sort((a, b) => a - b);
      return [
        id,
        {
          id: rec.id,
          name: rec.name,
          count: rec.count,
          hits: rec.hits,
          crits: rec.crits,
          periodic: rec.periodic,
          total: rec.total,
          share: fightTotal ? rec.total / fightTotal : null,
          avgHit: rec.hits ? rec.hitSum / rec.hits : 0,
          avgCrit: rec.crits ? rec.critSum / rec.crits : 0,
          critMultiplier: rec.hits && rec.crits ? rec.critSum / rec.crits / (rec.hitSum / rec.hits) : null,
          min: hits[0] || 0,
          p10: percentile(hits, 0.1),
          median: percentile(hits, 0.5),
          p90: percentile(hits, 0.9),
          max: hits[hits.length - 1] || 0,
        },
      ];
    }),
  );
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

function summarizeGear(ids) {
  let spellPower = 0;
  const items = [];
  for (const id of ids) {
    const item = itemsById.get(id);
    if (!item) {
      items.push({ id, missing: true });
      continue;
    }
    const stats = item.stats || {};
    const effective = (stats.spellPower || 0) + Math.max(stats.firePower || 0, stats.shadowPower || 0);
    spellPower += effective;
    items.push({ id, name: item.name, slot: item.slot, spellPower: effective });
  }
  return { spellPower, items };
}

function loadDictionary(file) {
  const source = fs.readFileSync(file, "utf8");
  const line = source.match(/local BYTES = "([^"]+)"/)?.[1];
  if (!line) throw new Error(`Could not read D1 dictionary from ${file}`);
  return Buffer.from([...line.matchAll(/\\(\d{3})/g)].map((match) => Number(match[1])));
}

function decodeFrame(frame) {
  if (frame[0] !== 0xa1 || frame[1] !== 1) throw new Error("Invalid ALC frame");
  const records = [];
  let offset = 2;
  while (offset < frame.length) {
    const type = frame[offset++];
    let length = 0;
    let shift = 0;
    while (offset < frame.length) {
      const byte = frame[offset++];
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    records.push({ type, body: frame.subarray(offset, offset + length) });
    offset += length;
  }
  return records;
}

function parseAlc(reason) {
  const match = reason.match(/^\[\[ALC_F_v1_c2_(.+)_([^_]+)_(\d+)\/(\d+)\]\](.*)$/);
  if (!match) return null;
  return {
    session: match[1],
    frame: match[2],
    index: Number(match[3]),
    total: Number(match[4]),
    payload: match[5],
  };
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
