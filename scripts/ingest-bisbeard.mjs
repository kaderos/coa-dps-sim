import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DUMP_DIR = path.join(ROOT, "data", "bisbeard");
const OUT_PUBLIC = path.join(ROOT, "public", "data", "items.json");
const OUT_DATA = path.join(ROOT, "data", "items.json");
const ALC_PARSED = path.join(ROOT, "data", "parsed", "kadd-log.json");

const SLOTS = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "shirt",
  "tabard",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger",
  "trinket",
  "mainhand",
  "offhand",
  "ranged",
];

const SLOT_ALIASES = {
  head: "head",
  helmet: "head",
  helm: "head",
  neck: "neck",
  necklace: "neck",
  shoulder: "shoulder",
  shoulders: "shoulder",
  back: "back",
  cloak: "back",
  chest: "chest",
  robe: "chest",
  shirt: "shirt",
  tabard: "tabard",
  wrist: "wrist",
  wrists: "wrist",
  bracer: "wrist",
  bracers: "wrist",
  hands: "hands",
  gloves: "hands",
  waist: "waist",
  belt: "waist",
  legs: "legs",
  pants: "legs",
  feet: "feet",
  boots: "feet",
  finger: "finger",
  ring: "finger",
  trinket: "trinket",
  mainhand: "mainhand",
  "main hand": "mainhand",
  weapon: "mainhand",
  onehand: "mainhand",
  "one-hand": "mainhand",
  twohand: "mainhand",
  "two-hand": "mainhand",
  offhand: "offhand",
  "off hand": "offhand",
  "held in off-hand": "offhand",
  heldinoffhand: "offhand",
  shield: "offhand",
  ranged: "ranged",
  wand: "ranged",
  relic: "ranged",
  unknown: "mainhand",
  invtype_head: "head",
  invtype_neck: "neck",
  invtype_shoulder: "shoulder",
  invtype_cloak: "back",
  invtype_chest: "chest",
  invtype_robe: "chest",
  invtype_body: "shirt",
  invtype_tabard: "tabard",
  invtype_wrist: "wrist",
  invtype_hand: "hands",
  invtype_waist: "waist",
  invtype_legs: "legs",
  invtype_feet: "feet",
  invtype_finger: "finger",
  invtype_trinket: "trinket",
  invtype_weapon: "mainhand",
  invtype_weaponmainhand: "mainhand",
  invtype_2hweapon: "mainhand",
  invtype_weaponoffhand: "offhand",
  invtype_holdable: "offhand",
  invtype_shield: "offhand",
  invtype_ranged: "ranged",
  invtype_rangedright: "ranged",
  invtype_wand: "ranged",
};

const STAT_ALIASES = {
  strength: "strength",
  str: "strength",
  agility: "agility",
  agi: "agility",
  intellect: "intellect",
  int: "intellect",
  spirit: "spirit",
  spi: "spirit",
  stamina: "stamina",
  sta: "stamina",
  allstat: "allStats",
  allstats: "allStats",
  spellpower: "spellPower",
  spell_power: "spellPower",
  spelldmg: "spellPower",
  spelldamage: "spellPower",
  attackpower: "attackPower",
  attack_power: "attackPower",
  firepower: "firePower",
  shadowpower: "shadowPower",
  spellcrit: "spellCrit",
  spell_crit: "spellCrit",
  crit: "spellCrit",
  critrating: "spellCrit",
  spellhit: "spellHit",
  hit: "spellHit",
  hitchance: "spellHit",
  hitrating: "spellHit",
  spellhaste: "spellHaste",
  haste: "spellHaste",
  hasterating: "spellHaste",
  spellpenetration: "spellPenetration",
  spellpen: "spellPenetration",
  mp5: "mp5",
  manaper5: "mp5",
};

const SKIP_STORES = /enchant|gem/;

const SUBTITLE_VERSIONS = new Set([
  "Worldforged",
  "Bloodforged",
  "Heroic Bloodforged",
  "Heroic",
  "Mythic",
  "Crafted",
  "Ascended",
  "Mythic 10",
  "Mythic 15",
  "Mythic 20",
  "Mythic 25",
  "Mythic 30",
  "Mythic 40",
]);

const PRIMARY_STAT_LABELS = {
  strength: "Strength",
  agility: "Agility",
  stamina: "Stamina",
  intellect: "Intellect",
  spirit: "Spirit",
};

// The browser payload is committed to the repo, so it is trimmed hard for size:
// cloth/misc/weapons with caster (or stamina/resist-only) value, Rare+.
// Phase tags and casterScore ranking are preserved for the UI filters/sort.

function main() {
  fs.mkdirSync(DUMP_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  const dumpPath = path.join(DUMP_DIR, "bisbeard-dump.json");
  const files = fs.existsSync(dumpPath)
    ? [dumpPath]
    : listDumpFiles(DUMP_DIR).filter((f) => !path.basename(f).includes("probe"));
  const items = [];
  const sources = [];
  let weights = null;
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!weights) weights = extractInfernalWeights(raw);
    const found = collectFromDump(raw);
    sources.push({ file: path.basename(file), items: found.length });
    items.push(...found);
  }

  const alcItems = loadAlcStubs();
  for (const stub of alcItems) {
    if (!items.some((i) => i.id === stub.id)) items.push(stub);
  }

  const unique = dedupeItems(items);
  const bySlot = {};
  for (const slot of SLOTS) bySlot[slot] = [];
  for (const item of unique) {
    const slot = item.slot || "mainhand";
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(item);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: files.length ? "bisbeard-dump" : alcItems.length ? "alc-stubs" : "empty",
    dumpFiles: sources,
    itemCount: unique.length,
    slots: bySlot,
    items: unique,
    weights,
    note:
      files.length === 0
        ? "No Bisbeard dump yet. Install userscripts/bisbeard-dump.user.js, run Dump on coa.bisbeard.com, and copy JSON into data/bisbeard/."
        : "Ingested Bisbeard dump. Spell math still validates against combat logs, not CoA Tavern.",
  };

  const web = buildWebPayload(payload, bySlot);
  writeJson(OUT_PUBLIC, web, { pretty: false });
  writeJson(OUT_DATA, payload);
  const setCatalog = collectSets(unique);
  writeJson(path.join(path.dirname(OUT_PUBLIC), "sets.json"), setCatalog, { pretty: false });
  writeJson(path.join(ROOT, "data", "sets.json"), setCatalog);
  const enchants = collectEnchants(files);
  writeJson(path.join(path.dirname(OUT_PUBLIC), "enchants.json"), enchants, { pretty: false });
  writeJson(path.join(ROOT, "data", "enchants.json"), enchants);
  syncTalentPayloads();

  const slotCounts = SLOTS.map((s) => `${s}:${(bySlot[s] || []).length}`).join(", ");
  console.log(`Ingested ${unique.length} items from ${files.length} dump files (${payload.source}).`);
  console.log(slotCounts);
  console.log(
    `Browser payload: ${web.itemCount} caster items, ${(fs.statSync(OUT_PUBLIC).size / 1024 / 1024).toFixed(2)} MB -> ${path.relative(ROOT, OUT_PUBLIC)}`,
  );
  console.log(`Full payload: ${(fs.statSync(OUT_DATA).size / 1024 / 1024).toFixed(2)} MB -> ${path.relative(ROOT, OUT_DATA)}`);
  if (weights) console.log("Infernal weights:", weights);
}

function buildWebPayload(payload, bySlot) {
  const slots = {};
  let itemCount = 0;
  for (const slot of Object.keys(bySlot)) {
    const ranked = bySlot[slot]
      .filter(isCasterRelevant)
      .sort((a, b) => b.casterScore - a.casterScore || (b.itemLevel || 0) - (a.itemLevel || 0));
    slots[slot] = ranked.map(slimItem);
    itemCount += ranked.length;
  }
  return {
    generatedAt: payload.generatedAt,
    source: payload.source,
    itemCount,
    totalIngested: payload.itemCount,
    weights: payload.weights,
    note:
      payload.source === "bisbeard-dump"
        ? `Bisbeard item data is bundled with the sim (${itemCount} caster items from ${payload.itemCount} ingested).`
        : payload.note,
    slots,
  };
}

const KEEP_QUALITIES = new Set(["rare", "epic", "legendary", "heirloom"]);
const DROP_ARMOR_TYPES = new Set(["plate", "mail"]);

function isBloodforged(item) {
  return /bloodforged/i.test(`${item.subtitle || ""} ${item.name || ""}`);
}

function hasResilience(item) {
  const stats = item.stats || {};
  if (stats.resilience || stats.resilienceRating) return true;
  const blob = `${(item.effects || []).join(" ")} ${(item.baseStats || []).join(" ")} ${item.description || ""}`;
  return /resilience/i.test(blob);
}

/** Physical primary strictly beats caster primary (SP / Intellect). */
function physicalDominatesCaster(item) {
  const s = item.stats || {};
  const physical = Math.max(s.strength || 0, s.agility || 0);
  const caster = Math.max(s.spellPower || 0, s.intellect || 0);
  return physical > caster;
}

function hasCasterValue(item) {
  if ((item.casterScore || 0) > 0) return true;
  const s = item.stats || {};
  if ((s.firePower || 0) > 0 || (s.shadowPower || 0) > 0 || (s.spellPenetration || 0) > 0) return true;
  return (item.effects || []).some((line) =>
    /spell (power|damage|hit|crit|haste)|increase your spell|damaging spells|spell penetration|critical strike rating|hit rating|haste rating/i.test(
      line,
    ),
  );
}

/** Stamina and/or resistance gear with no other offensive/caster stats. */
function isStaminaOrResistOnly(item) {
  const s = item.stats || {};
  const offensive =
    (s.strength || 0) +
    (s.agility || 0) +
    (s.intellect || 0) +
    (s.spirit || 0) +
    (s.spellPower || 0) +
    (s.firePower || 0) +
    (s.shadowPower || 0) +
    (s.attackPower || 0) +
    (s.spellCrit || 0) +
    (s.spellHit || 0) +
    (s.spellHaste || 0) +
    (s.spellPenetration || 0) +
    (s.mp5 || 0);
  if (offensive > 0) return false;
  const text = `${(item.effects || []).join(" ")} ${(item.baseStats || []).join(" ")}`;
  const hasResist = /resistance/i.test(text);
  return (s.stamina || 0) > 0 || hasResist;
}

function isCasterRelevant(item) {
  if (isBloodforged(item)) return false;
  if (!KEEP_QUALITIES.has(String(item.quality || "").toLowerCase())) return false;
  if (DROP_ARMOR_TYPES.has(String(item.armorType || "").toLowerCase())) return false;
  if (hasResilience(item)) return false;
  if (physicalDominatesCaster(item)) return false;
  return hasCasterValue(item) || isStaminaOrResistOnly(item);
}

function slimItem(item) {
  const stats = {};
  for (const [key, value] of Object.entries(item.stats)) {
    if (value) stats[key] = value;
  }
  const out = { id: item.id, name: item.name, slot: item.slot, stats };
  if (item.armorType) out.armorType = item.armorType;
  if (item.quality) out.quality = item.quality;
  if (item.itemLevel) out.itemLevel = item.itemLevel;
  if (item.phase) out.phase = item.phase;
  if (item.displayPhase) out.displayPhase = item.displayPhase;
  if (item.extraPhases?.length) out.extraPhases = item.extraPhases;
  if (item.casterScore) out.casterScore = item.casterScore;
  if (item.reqLevel) out.reqLevel = item.reqLevel;
  if (item.bind) out.bind = item.bind;
  if (item.unique) out.unique = item.unique;
  if (item.subtitle) out.subtitle = item.subtitle;
  if (item.equipSlot) out.equipSlot = item.equipSlot;
  if (item.damage) out.damage = item.damage;
  if (item.armor) out.armor = item.armor;
  if (item.baseStats?.length) out.baseStats = item.baseStats;
  if (item.effects?.length) out.effects = item.effects;
  if (item.setName) out.setName = item.setName;
  if (item.setBonus3) out.setBonus3 = item.setBonus3;
  if (item.setBonuses && Object.keys(item.setBonuses).length) out.setBonuses = item.setBonuses;
  return out;
}

function listDumpFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") || f.endsWith(".har"))
    .map((f) => path.join(dir, f));
}

function collectFromDump(raw) {
  const found = [];
  const idb = raw.indexedDB;
  if (idb && typeof idb === "object") {
    for (const db of Object.values(idb)) {
      const stores = db && db.stores;
      if (!stores) continue;
      for (const [storeName, store] of Object.entries(stores)) {
        if (SKIP_STORES.test(storeName)) continue;
        collectItems(store.records || store, found);
      }
    }
    if (found.length) return found;
  }
  return collectItems(raw, []);
}

function extractInfernalWeights(raw) {
  const weights = raw.localStorage && raw.localStorage.values && raw.localStorage.values.cgp_coa_weights;
  if (weights && weights["Felsworn-Infernal"]) return weights["Felsworn-Infernal"];
  return null;
}

function collectItems(node, found) {
  if (node == null) return found;
  if (Array.isArray(node)) {
    if (node.length && looksLikeItem(node[0])) {
      for (const entry of node) {
        const item = normalizeItem(entry);
        if (item && !isBloodforged(item)) found.push(item);
      }
      return found;
    }
    for (const entry of node) collectItems(entry, found);
    return found;
  }
  if (typeof node !== "object") return found;
  if (looksLikeItem(node)) {
    const item = normalizeItem(node);
    if (item && !isBloodforged(item)) found.push(item);
  }
  if (node.records) collectItems(node.records, found);
  if (node.items) collectItems(node.items, found);
  for (const [key, value] of Object.entries(node)) {
    if (key === "records" || key === "items" || key === "localStorage" || key === "windowSnapshot" || key === "network") {
      continue;
    }
    if (value && typeof value === "object") collectItems(value, found);
  }
  return found;
}

function looksLikeItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = value.id ?? value.itemId ?? value.item_id ?? value.itemID;
  const name = value.name ?? value.itemName ?? value.item_name;
  const slot = value.slot ?? value.inventoryType ?? value.equipLoc;
  const stats = value.stats ?? value.stat ?? value.bonuses;
  return id != null && name != null && (slot != null || stats != null);
}

function normalizeItem(raw) {
  const id = Number(raw.id ?? raw.itemId ?? raw.item_id ?? raw.itemID);
  if (!Number.isFinite(id)) return null;
  const rawSlot = raw.slot ?? raw.inventoryType ?? raw.inventory_type ?? raw.slotName ?? raw.equipLoc;
  const slot = normalizeSlot(rawSlot);
  const stats = normalizeStats(raw);
  const tooltip = parseTooltip(raw);
  applyEffectSpellPenetration(stats, tooltip.effects);
  const phase = Number(raw.phase ?? 0) || null;
  const source = raw.source ?? raw.sourceCategory ?? null;
  const sourceCategory = raw.sourceCategory ?? null;
  const subtitle = itemSubtitle(raw);
  const { displayPhase, extraPhases } = coaPhaseGrouping(raw, phase, subtitle, source, sourceCategory);
  return {
    id,
    name: String(raw.name ?? raw.itemName ?? `Item ${id}`),
    slot,
    armorType: raw.type ?? null,
    quality: raw.quality ?? raw.rarity ?? null,
    itemLevel: Number(raw.itemLevel ?? raw.ilvl ?? 0) || null,
    phase,
    reqLevel: Number(raw.reqLevel ?? raw.requiredLevel ?? 0) || tooltip.reqLevel || null,
    bind: tooltip.bind,
    unique: tooltip.unique,
    subtitle,
    equipSlot: typeof rawSlot === "string" ? rawSlot : tooltip.equipSlot,
    damage: normalizeDamage(raw.damage) || tooltip.damage,
    armor: tooltip.armor || Number(raw.stats?.armor ?? 0) || null,
    baseStats: tooltip.baseStats,
    effects: tooltip.effects,
    setName: raw.setName || null,
    setBonuses: normalizeSetBonuses(raw.setBonuses),
    setBonus3: raw.setBonuses && raw.setBonuses["3"] ? String(raw.setBonuses["3"]) : null,
    stats,
    source,
    displayPhase,
    extraPhases,
    casterScore:
      stats.spellPower +
      stats.intellect +
      stats.spirit +
      stats.spellCrit +
      stats.spellHaste +
      stats.spellHit,
  };
}

// CoA P2 mythic is capped at 10: Bisbeard tags Mythic 15 as phase 2, but those belong in P3.
// P2 (MC/Onyxia) also includes P1 Zul'Gurub and P1 world-boss gear; those stay in the P1 filter too.
function coaPhaseGrouping(raw, phase, subtitle, source, sourceCategory) {
  const mythicLevel = parseMythicLevel(subtitle || raw.version);
  let displayPhase = phase;
  if (mythicLevel != null && mythicLevel >= 15 && (phase == null || phase < 3)) {
    displayPhase = 3;
  }

  const extraPhases = [];
  const src = String(source || "");
  const isZulGurub = /zul'?gurub/i.test(src);
  const isWorldBoss =
    sourceCategory === "worldboss" ||
    String(raw.version || "") === "World Boss" ||
    WORLD_BOSS_SOURCES.test(src);
  if (phase === 1 && (isZulGurub || isWorldBoss) && displayPhase !== 2) extraPhases.push(2);
  const slot = String(raw.slot || raw.equipLoc || "").toLowerCase();
  if (
    slot.includes("trinket") &&
    (sourceCategory === "vendor" || String(source || "") === "Unknown")
  ) {
    for (const later of [2, 3, 4, 5]) {
      if (later !== displayPhase && !extraPhases.includes(later)) extraPhases.push(later);
    }
  }

  return { displayPhase, extraPhases };
}

function parseMythicLevel(value) {
  const match = /Mythic\s+(\d+)/i.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}

const WORLD_BOSS_SOURCES =
  /^(Azuregos|Lord Kazzak|Taerar|Ysondre|Emeriss|Lethon|The Will of Soggoth|Atal'zul, the Soulreaver|Kaldros|Setis|Snowgrave)$/i;

function itemSubtitle(raw) {
  if (String(raw.source || "") === "Worldforged") return "Worldforged";
  const version = String(raw.version || "");
  if (SUBTITLE_VERSIONS.has(version)) return version;
  if (raw.bloodforgedType === "heroic") return "Heroic";
  if (raw.bloodforgedType === "normal") return "Bloodforged";
  return null;
}

function normalizeDamage(damage) {
  if (!damage || typeof damage !== "object") return null;
  const min = Number(damage.min);
  const max = Number(damage.max);
  const speed = Number(damage.speed);
  if (![min, max, speed].every(Number.isFinite) || speed <= 0) return null;
  return { min, max, speed };
}

function parseTooltip(raw) {
  const desc = String(raw.description || raw.tooltip || "");
  const lines = desc.split("|").map((line) => line.trim()).filter(Boolean);
  let bind = null;
  let unique = null;
  let armor = null;
  let reqLevel = null;
  let equipSlot = null;
  let damage = null;
  const baseStats = [];
  const effects = [];

  for (const line of lines) {
    if (/^Binds when /i.test(line)) {
      bind = line;
      continue;
    }
    if (/^Unique/i.test(line)) {
      unique = line;
      continue;
    }
    const armorMatch = line.match(/^(\d+) Armor$/i);
    if (armorMatch) {
      armor = Number(armorMatch[1]);
      continue;
    }
    const reqMatch = line.match(/^Requires Level (\d+)$/i);
    if (reqMatch) {
      reqLevel = Number(reqMatch[1]);
      continue;
    }
    const dmgMatch = line.match(/^([\d.]+) - ([\d.]+) Damage(?:\s+Speed ([\d.]+))?$/i);
    if (dmgMatch) {
      damage = {
        min: Number(dmgMatch[1]),
        max: Number(dmgMatch[2]),
        speed: dmgMatch[3] ? Number(dmgMatch[3]) : 0,
      };
      if (!damage.speed) damage = null;
      continue;
    }
    if (/^(Equip|Use|Chance on hit):/i.test(line)) {
      effects.push(line);
      continue;
    }
    if (/^\+\d+ /.test(line)) {
      baseStats.push(line);
      continue;
    }
    if (!equipSlot && /^(Two-Hand|One-Hand|Main Hand|Off Hand|Held In Off-hand|Ranged|Head|Neck|Shoulder|Back|Chest|Wrist|Hands|Waist|Legs|Feet|Finger|Trinket|Shield)\b/i.test(line)) {
      const slotWord = line.split(/\s{2,}/)[0];
      if (slotWord) equipSlot = slotWord;
    }
  }

  if (!unique) {
    if (raw.unique === true) unique = "Unique";
    else if (raw.uniqueEquip === true) unique = "Unique-Equipped";
  }

  if (!baseStats.length && raw.stats && typeof raw.stats === "object") {
    for (const [key, label] of Object.entries(PRIMARY_STAT_LABELS)) {
      const amount = Number(raw.stats[key]);
      if (amount) baseStats.push(`+${amount} ${label}`);
    }
  }

  return { bind, unique, armor, reqLevel, equipSlot, damage, baseStats, effects };
}

function normalizeSlot(value) {
  if (value == null) return "mainhand";
  if (typeof value === "number") return SLOTS[value] || "mainhand";
  const lower = String(value).toLowerCase();
  const key = lower.replace(/[\s-]+/g, "");
  return SLOT_ALIASES[lower] || SLOT_ALIASES[key] || "mainhand";
}

function parseSpellPenetrationFromText(text) {
  if (!text || /armor penetration/i.test(text)) return 0;
  const equip = /(?:spell penetration|spelldamage penetration).*?by (\d+)/i.exec(String(text));
  if (equip) return Number(equip[1]) || 0;
  const plus = /\+(\d+)\s+spell penetration\b/i.exec(String(text));
  return plus ? Number(plus[1]) || 0 : 0;
}

function applyEffectSpellPenetration(stats, lines) {
  for (const line of lines || []) {
    stats.spellPenetration += parseSpellPenetrationFromText(line);
  }
}

function normalizeStats(raw) {
  const stats = {
    strength: 0,
    agility: 0,
    intellect: 0,
    spirit: 0,
    stamina: 0,
    spellPower: 0,
    firePower: 0,
    shadowPower: 0,
    attackPower: 0,
    spellCrit: 0,
    spellHit: 0,
    spellHaste: 0,
    spellPenetration: 0,
    mp5: 0,
  };
  const bag = raw.stats || raw.stat || raw.bonuses || raw;
  if (Array.isArray(bag)) {
    for (const entry of bag) {
      const name = STAT_ALIASES[String(entry.stat || entry.name || entry.type || "").toLowerCase().replace(/[\s_]+/g, "")];
      const amount = Number(entry.amount ?? entry.value ?? entry.count ?? 0);
      applyNormalizedStat(stats, name, amount);
    }
    return stats;
  }
  if (bag && typeof bag === "object") {
    for (const [key, value] of Object.entries(bag)) {
      const name = STAT_ALIASES[key.toLowerCase().replace(/[\s_]+/g, "")];
      const amount = Number(value);
      applyNormalizedStat(stats, name, amount);
    }
  }
  return stats;
}

function applyNormalizedStat(stats, name, amount) {
  if (!name || !Number.isFinite(amount) || !amount) return;
  if (name === "allStats") {
    stats.strength += amount;
    stats.agility += amount;
    stats.stamina += amount;
    stats.intellect += amount;
    stats.spirit += amount;
    return;
  }
  if (Object.prototype.hasOwnProperty.call(stats, name)) stats[name] += amount;
}

function loadAlcStubs() {
  if (!fs.existsSync(ALC_PARSED)) return [];
  const parsed = JSON.parse(fs.readFileSync(ALC_PARSED, "utf8"));
  const ids = (parsed.alc && parsed.alc.extractedItemIds) || [];
  return ids.map((id) => ({
    id,
    name: `ALC item ${id}`,
    slot: "mainhand",
    armorType: null,
    quality: null,
    itemLevel: null,
    phase: null,
    displayPhase: null,
    extraPhases: [],
    stats: normalizeStats({}),
    source: "alc",
    casterScore: 0,
  }));
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    const prevPhase = prev.phase || 0;
    const nextPhase = item.phase || 0;
    if (nextPhase > prevPhase || (nextPhase === prevPhase && item.casterScore > prev.casterScore)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

const ENCHANT_SLOT_ALIASES = {
  ...SLOT_ALIASES,
  "one-hand": "onehand",
  onehand: "onehand",
  "two-hand": "twohand",
  twohand: "twohand",
  invtype_weapon: "onehand",
  invtype_2hweapon: "twohand",
  invtype_weaponmainhand: "mainhand",
  invtype_weaponoffhand: "offhand",
  invtype_holdable: "offhand",
  invtype_shield: "offhand",
};

function enchantAppliesTo(normalized) {
  if (normalized === "onehand") return { slots: ["mainhand", "offhand"], weapon: "onehand" };
  if (normalized === "twohand") return { slots: ["mainhand"], weapon: "twohand" };
  return { slots: [normalized], weapon: null };
}

function collectEnchants(files) {
  const extra = listDumpFiles(DUMP_DIR).filter((file) => /enchant/i.test(path.basename(file)));
  const found = [];
  for (const file of [...new Set([...files, ...extra])]) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const records = [];
    const idb = raw.indexedDB;
    if (idb && typeof idb === "object") {
      for (const db of Object.values(idb)) {
        const stores = db && db.stores;
        if (!stores) continue;
        for (const [storeName, store] of Object.entries(stores)) {
          if (!/enchant/i.test(storeName)) continue;
          records.push(...(store.records || []));
        }
      }
    }
    if (/enchant/i.test(path.basename(file))) {
      records.push(...(raw.records || []));
    }
    for (const entry of records) {
      const enchant = normalizeEnchant(entry);
      if (enchant) found.push(enchant);
    }
  }

  const unique = new Map();
  for (const enchant of found) unique.set(enchant.id, enchant);
  const list = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  const slots = {};
  for (const enchant of list) {
    for (const slot of enchant.slots) {
      if (!slots[slot]) slots[slot] = [];
      slots[slot].push(enchant);
    }
  }
  return { count: list.length, slots, enchants: list };
}

function normalizeEnchant(raw) {
  const id = Number(raw.id ?? raw.itemId ?? raw.enchantId);
  if (!Number.isFinite(id)) return null;
  const rawSlot = raw.slot ?? raw.equipLoc ?? raw.inventoryType;
  const lower = String(rawSlot || "").toLowerCase();
  const key = lower.replace(/[\s-]+/g, "");
  const normalized = ENCHANT_SLOT_ALIASES[lower] || ENCHANT_SLOT_ALIASES[key] || normalizeSlot(rawSlot);
  const stats = normalizeStats(raw);
  if (raw.description) stats.spellPenetration += parseSpellPenetrationFromText(raw.description);
  const applies = enchantAppliesTo(normalized);
  return {
    id,
    name: String(raw.name || raw.description || `Enchant ${id}`),
    slots: applies.slots,
    weapon: applies.weapon,
    stats,
    description: raw.description || null,
    quality: raw.quality || null,
  };
}

function normalizeSetBonuses(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value) out[String(key)] = String(value);
  }
  return Object.keys(out).length ? out : null;
}

function collectSets(items) {
  const sets = {};
  for (const item of items) {
    if (!item.setName || !item.setBonuses) continue;
    if (!sets[item.setName]) sets[item.setName] = {};
    Object.assign(sets[item.setName], item.setBonuses);
  }
  return {
    generatedAt: new Date().toISOString(),
    count: Object.keys(sets).length,
    sets,
  };
}

function syncTalentPayloads() {
  const sourceDir = path.join(ROOT, "data", "talents");
  const targetDir = path.join(ROOT, "public", "data", "talents");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of ["felsworn.json", "infernal.json"]) {
    const source = path.join(sourceDir, file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(targetDir, file));
  }
}

function writeJson(file, data, { pretty = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

main();
