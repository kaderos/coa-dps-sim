import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "data");
const PARSED_DIR = path.join(ROOT, "data", "parsed");

const DEFAULT_LOG_DIR = "C:\\Ascension\\Launcher\\resources\\ascension-live\\Logs";
const INFERNAL_FIREBALL_ID = "501288";
const PLAYER = process.env.COA_PLAYER || "Kadd";

const INFERNAL_SPELLS = {
  501288: "Fel Fireball",
  501298: "Ruin",
  501321: "Sargeron Smite",
  803467: "Sargeron Smite (Inner Demon)",
  802678: "Felstrike",
  707901: "Bane of Fire",
  804216: "Inner Demon",
  520693: "Felwrath",
  560284: "Infernal",
  802676: "Chaos",
};

function main() {
  const logDir = process.env.COA_LOG_DIR || DEFAULT_LOG_DIR;
  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith("WoWCombatLog.txt"))
    .map((f) => path.join(logDir, f));
  if (files.length === 0) {
    throw new Error(`No WoWCombatLog.txt files in ${logDir}`);
  }

  const aggregated = emptyPlayer();
  const perFile = [];
  for (const file of files) {
    const result = parseLogFile(file);
    perFile.push({
      file: path.basename(file),
      events: result.eventCount,
      damageEvents: result.player.damageEvents,
      totalDamage: result.player.totalDamage,
    });
    mergePlayer(aggregated, result.player);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PARSED_DIR, { recursive: true });

  const spells = summarizeSpells(aggregated);
  const alc = aggregated.alc;
  const decodedAlc = decodeAlcSnapshots(alc.chunks);
  const rotation = aggregated.castTimes;

  const payload = {
    player: PLAYER,
    fireballSpellId: Number(INFERNAL_FIREBALL_ID),
    files: perFile,
    durationSec: aggregated.combatSec || aggregated.durationSec,
    totalDamage: aggregated.totalDamage,
    dps:
      (aggregated.combatSec || aggregated.durationSec) > 0
        ? aggregated.totalDamage / (aggregated.combatSec || aggregated.durationSec)
        : 0,
    spells,
    auras: aggregated.auras,
    casts: summarizeCasts(rotation, aggregated.castSuccess),
    alc: {
      chunkCount: alc.chunks.length,
      snapshotCount: decodedAlc.snapshotCount,
      decodedOk: decodedAlc.decodedOk,
      decodeErrors: decodedAlc.errors.slice(0, 20),
      extractedItemIds: decodedAlc.itemIds,
      samplePreviews: decodedAlc.previews,
      note: "ALC payloads are LibDeflate/AceSerializer; item IDs are extracted when inflate yields text. Gear catalog still comes from the Bisbeard dump.",
    },
  };

  writeJson(path.join(OUT_DIR, "kadd-log.json"), payload);
  writeJson(path.join(PARSED_DIR, "kadd-log.json"), payload);
  writeJson(path.join(PARSED_DIR, "alc-raw.json"), { chunks: alc.chunks.slice(0, 200), decoded: decodedAlc });
  console.log(
    `Parsed ${files.length} logs for ${PLAYER}: ${payload.totalDamage} damage over ${payload.durationSec.toFixed(1)}s (${payload.dps.toFixed(0)} dps), ${Object.keys(spells).length} spells, ${decodedAlc.itemIds.length} ALC item ids`,
  );
}

function emptyPlayer() {
  return {
    totalDamage: 0,
    damageEvents: 0,
    firstTs: null,
    lastTs: null,
    durationSec: 0,
    combatSec: 0,
    damageTimes: [],
    spells: new Map(),
    auras: {},
    castTimes: [],
    castSuccess: [],
    alc: { chunks: [] },
  };
}

function mergePlayer(into, from) {
  into.totalDamage += from.totalDamage;
  into.damageEvents += from.damageEvents;
  into.durationSec += from.durationSec;
  into.combatSec += from.combatSec;
  for (const [id, stats] of from.spells.entries()) {
    const cur = into.spells.get(id) || emptySpell(id, stats.name);
    cur.count += stats.count;
    cur.total += stats.total;
    cur.hits += stats.hits;
    cur.crits += stats.crits;
    cur.hitSum += stats.hitSum;
    cur.critSum += stats.critSum;
    cur.ticks += stats.ticks;
    cur.min = Math.min(cur.min, stats.min);
    cur.max = Math.max(cur.max, stats.max);
    cur.samples.push(...stats.samples);
    into.spells.set(id, cur);
  }
  into.castTimes.push(...from.castTimes);
  into.castSuccess.push(...from.castSuccess);
  into.alc.chunks.push(...from.alc.chunks);
  for (const [name, aura] of Object.entries(from.auras)) {
    if (!into.auras[name]) into.auras[name] = { applications: 0, totalSec: 0 };
    into.auras[name].applications += aura.applications;
    into.auras[name].totalSec += aura.totalSec;
  }
}

function parseLogFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const player = emptyPlayer();
  const auraOpen = new Map();
  let eventCount = 0;

  for (const line of lines) {
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    eventCount += 1;
    const { ts, event, fields } = parsed;

    if (event === "SPELL_CAST_FAILED") {
      const reason = fields[fields.length - 1] || "";
      const alc = parseAlc(reason, ts, fields);
      if (alc) player.alc.chunks.push(alc);
    }

    if (!isPlayerEvent(fields)) continue;

    if (event === "SPELL_DAMAGE" || event === "SPELL_PERIODIC_DAMAGE" || event === "RANGE_DAMAGE" || event === "SWING_DAMAGE") {
      ingestDamage(player, ts, event, fields);
    } else if (event === "SPELL_CAST_START") {
      player.castTimes.push({ ts, spellId: fields[6], name: unquote(fields[7]) });
    } else if (event === "SPELL_CAST_SUCCESS") {
      player.castSuccess.push({ ts, spellId: fields[6], name: unquote(fields[7]) });
    } else if (event === "SPELL_AURA_APPLIED" || event === "SPELL_AURA_APPLIED_DOSE" || event === "SPELL_AURA_REFRESH") {
      const name = unquote(fields[7]);
      if (!player.auras[name]) player.auras[name] = { applications: 0, totalSec: 0 };
      player.auras[name].applications += 1;
      auraOpen.set(name, ts);
    } else if (event === "SPELL_AURA_REMOVED") {
      const name = unquote(fields[7]);
      const start = auraOpen.get(name);
      if (start != null && player.auras[name]) {
        player.auras[name].totalSec += Math.max(0, ts - start);
        auraOpen.delete(name);
      }
    }
  }

  if (player.firstTs != null && player.lastTs != null) {
    player.durationSec = Math.max(0, player.lastTs - player.firstTs);
  }
  player.combatSec = combatUptime(player.damageTimes);
  return { eventCount, player };

function combatUptime(times) {
  if (!times.length) return 0;
  times.sort((a, b) => a - b);
  let total = 0;
  let start = times[0];
  let prev = times[0];
  for (const t of times) {
    if (t - prev > 12) {
      total += Math.max(0, prev - start);
      start = t;
    }
    prev = t;
  }
  total += Math.max(0, prev - start);
  return total;
}
}

function ingestDamage(player, ts, event, fields) {
  const spellId = event === "SWING_DAMAGE" ? "0" : fields[6];
  const name = event === "SWING_DAMAGE" ? "Melee" : unquote(fields[7]);
  const amountIdx = event === "SWING_DAMAGE" ? 6 : 9;
  const amount = Number(fields[amountIdx] || 0);
  const crit = fields[amountIdx + 6] === "1";
  if (!Number.isFinite(amount)) return;

  player.totalDamage += amount;
  player.damageEvents += 1;
  if (player.firstTs == null) player.firstTs = ts;
  player.lastTs = ts;
  player.damageTimes.push(ts);

  const cur = player.spells.get(spellId) || emptySpell(spellId, name);
  cur.name = name;
  cur.count += 1;
  cur.total += amount;
  cur.min = Math.min(cur.min, amount);
  cur.max = Math.max(cur.max, amount);
  if (event === "SPELL_PERIODIC_DAMAGE") cur.ticks += 1;
  if (crit) {
    cur.crits += 1;
    cur.critSum += amount;
  } else {
    cur.hits += 1;
    cur.hitSum += amount;
  }
  if (cur.samples.length < 400) cur.samples.push({ amount, crit, periodic: event === "SPELL_PERIODIC_DAMAGE" });
  player.spells.set(spellId, cur);
}

function emptySpell(id, name) {
  return {
    id,
    name,
    count: 0,
    total: 0,
    hits: 0,
    crits: 0,
    hitSum: 0,
    critSum: 0,
    ticks: 0,
    min: Number.POSITIVE_INFINITY,
    max: 0,
    samples: [],
  };
}

function summarizeSpells(player) {
  const out = {};
  const sorted = [...player.spells.values()].sort((a, b) => b.total - a.total);
  for (const s of sorted) {
    out[s.id] = {
      id: Number(s.id),
      name: s.name,
      infernal: Boolean(INFERNAL_SPELLS[s.id]),
      count: s.count,
      total: s.total,
      hits: s.hits,
      crits: s.crits,
      ticks: s.ticks,
      critRate: s.count ? s.crits / s.count : 0,
      avgHit: s.hits ? s.hitSum / s.hits : 0,
      avgCrit: s.crits ? s.critSum / s.crits : 0,
      avg: s.count ? s.total / s.count : 0,
      min: s.min === Number.POSITIVE_INFINITY ? 0 : s.min,
      max: s.max,
      critMultiplier: s.hits && s.crits ? s.critSum / s.crits / (s.hitSum / s.hits) : 1.5,
      share: player.totalDamage ? s.total / player.totalDamage : 0,
    };
  }
  return out;
}

function summarizeCasts(castStarts, castSuccess) {
  const byId = {};
  for (const c of [...castStarts, ...castSuccess]) {
    const id = c.spellId;
    if (!byId[id]) byId[id] = { id: Number(id), name: c.name, starts: 0, success: 0, gaps: [] };
  }
  for (const c of castStarts) {
    if (byId[c.spellId]) byId[c.spellId].starts += 1;
  }
  const successTimes = new Map();
  for (const c of castSuccess) {
    if (byId[c.spellId]) byId[c.spellId].success += 1;
    if (!successTimes.has(c.spellId)) successTimes.set(c.spellId, []);
    successTimes.get(c.spellId).push(c.ts);
  }
  const startTimes = new Map();
  for (const c of castStarts) {
    if (!startTimes.has(c.spellId)) startTimes.set(c.spellId, []);
    startTimes.get(c.spellId).push(c.ts);
  }
  const out = {};
  for (const [id, rec] of Object.entries(byId)) {
    const starts = (startTimes.get(id) || []).sort((a, b) => a - b);
    let castTimeHintSec = 0;
    // Only pair starts with successes when the log records both consistently.
    // Fel Fireball usually emits CAST_START without CAST_SUCCESS, so pairing a
    // start with a much later success produced a bogus 2.277s cast estimate.
    if (rec.starts > 0 && rec.success >= rec.starts * 0.7) {
      const durations = [];
      const hits = (successTimes.get(id) || []).sort((a, b) => a - b);
      for (const start of starts) {
        const hit = hits.find((t) => t >= start && t - start < 4);
        if (hit) durations.push(hit - start);
      }
      if (durations.length) {
        castTimeHintSec = durations.reduce((a, b) => a + b, 0) / durations.length;
      } else {
        castTimeHintSec = 2;
      }
    }
    out[id] = {
      id: rec.id,
      name: rec.name,
      starts: rec.starts,
      success: rec.success,
      castTimeHintSec: Number(castTimeHintSec.toFixed(3)),
    };
  }
  return out;
}

function isPlayerEvent(fields) {
  const sourceName = unquote(fields[1] || "");
  return sourceName === PLAYER;
}

function parseLine(line) {
  const head = line.match(/^(\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}\.\d+)\s+(\w+),(.*)$/);
  if (!head) return null;
  const ts = parseStamp(head[1]);
  const event = head[2];
  const fields = splitCsv(head[3]);
  return { ts, event, fields, stamp: head[1] };
}

function parseStamp(stamp) {
  const m = stamp.match(/^(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)$/);
  if (!m) return 0;
  const ms = Number((m[6] + "000").slice(0, 3));
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month * 2_678_400 + day * 86400 + Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]) + ms / 1000;
}

function splitCsv(s) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

function unquote(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function parseAlc(reason, ts, fields) {
  const text = unquote(reason);
  const m = text.match(/^\[\[ALC_([A-Z]+)_v(\d+)_([^\]]+)\]\](.*)$/);
  if (!m) return null;
  const rest = m[3];
  const chunkMatch = rest.match(/^(.*)_(\d+)\/(\d+)$/);
  return {
    ts,
    source: unquote(fields[1] || ""),
    type: m[1],
    version: m[2],
    key: chunkMatch ? chunkMatch[1] : rest,
    index: chunkMatch ? Number(chunkMatch[2]) : 1,
    total: chunkMatch ? Number(chunkMatch[3]) : 1,
    payload: m[4],
  };
}

function decodeAlcSnapshots(chunks) {
  const groups = new Map();
  for (const chunk of chunks) {
    const id = `${chunk.type}:${chunk.key}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(chunk);
  }
  const snapshots = [];
  const errors = [];
  const itemIds = new Set();
  for (const [id, parts] of groups) {
    parts.sort((a, b) => a.index - b.index);
    const combined = parts.map((p) => p.payload).join("");
    try {
      const decoded = tryInflate(combined);
      const ids = extractItemIds(decoded);
      ids.forEach((n) => itemIds.add(n));
      snapshots.push({
        id,
        type: parts[0].type,
        chunks: parts.length,
        preview: typeof decoded === "string" ? decoded.slice(0, 400) : null,
        itemIds: ids,
        decodedType: typeof decoded,
      });
    } catch (err) {
      errors.push({ id, error: String(err) });
    }
  }
  const previews = [];
  let decodedOk = 0;
  for (const snap of snapshots) {
    if (snap.preview && previews.length < 5) previews.push(snap);
    if (snap.itemIds?.length || (snap.preview && snap.preview.startsWith("^"))) decodedOk += 1;
  }
  return {
    snapshots: snapshots.slice(0, 20),
    snapshotCount: snapshots.length + errors.length,
    decodedOk,
    errors,
    itemIds: [...itemIds].sort((a, b) => a - b),
    previews,
  };
}

function tryInflate(payload) {
  const stripped = payload.replace(/\.+$/, "");
  const buf = decodeBase64Url(stripped);
  const attempts = [
    () => zlib.inflateSync(buf),
    () => zlib.inflateRawSync(buf),
    () => zlib.gunzipSync(buf),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const out = attempt();
      const text = out.toString("utf8");
      if (text.startsWith("^1") || text.includes("item:") || text.includes("AceSerializer")) return text;
      if (isMostlyText(text)) return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("inflate did not yield AceSerializer text");
}

function isMostlyText(text) {
  if (!text || text.length < 8) return false;
  let printable = 0;
  for (let i = 0; i < Math.min(text.length, 80); i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable += 1;
  }
  return printable / Math.min(text.length, 80) > 0.85;
}

function decodeBase64Url(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function extractItemIds(decoded) {
  if (typeof decoded !== "string") return [];
  const ids = new Set();
  const re = /item:(\d{3,7})|:i(\d{3,7})|"id"\s*:\s*(\d{3,7})|Hitem:(\d{3,7})/g;
  let m;
  while ((m = re.exec(decoded))) {
    const n = Number(m[1] || m[2] || m[3] || m[4]);
    if (n >= 100 && n < 20_000_000) ids.add(n);
  }
  return [...ids];
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

main();
