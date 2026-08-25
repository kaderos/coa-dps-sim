import type { BuffsConfig, CharacterStats, Enchant, EnchantSet, GearSet, Item, SetCatalog, Slot, SpellFit } from "./types";
import { absorbItemSetBonuses, equippedSets, loadSetCatalog, setBonusCombat, setProgressForItem } from "./sets";
import { PAPER_DOLL_LEFT, PAPER_DOLL_RIGHT, PAPER_DOLL_WEAPONS, SLOTS } from "./types";
import {
  BOSS_LEVEL,
  buildCharacter,
  displaySpellPower,
  enchantFitsSlot,
  isTwoHand,
  itemForSlot,
  PLAYER_LEVEL,
  ratingsFromGear,
  statsFromGear,
} from "./sim/stats";
import { buildChanceBreakdown, hasteHintContent, hitHintContent } from "./sim/chances";
import type { ChanceBreakdown } from "./sim/chances";
import { runSimAsync } from "./sim/engine";
import {
  applyStatScaleBuffs,
  activeCombatBuffLabels,
  DEFAULT_BUFFS,
  percentBuffs,
  procContributionsFromBuffs,
  ratingConsumes,
  setupBuffs,
  statsFromBuffs,
  syncOffhandOilField,
} from "./buffs";
import { renderGearSimCard, renderResults, renderResultsEmpty, toSnapshot, type SimSnapshot } from "./results";
import {
  defaultStatWeights,
  formatEp,
  loadStatWeights,
  saveStatWeights,
  STAT_WEIGHT_ORDER,
  statsEp,
  type StatWeights,
} from "./ep";
import { mergeTalentSelection, type TalentSelection, type TalentTrees } from "./talents/baseline";
import { setupTalents } from "./talents/ui";
import type { FelswornTalentDoc, InfernalTalentDoc } from "./talents/types";
import { applyTakenTalents } from "./talents/taken";
import { loadSession, restoreEnchantSet, restoreGearSet, saveEnchantSet, saveGearSet, saveSession } from "./persist";
import { BisbeardImportError, ensureBisbeardProxyReady, loadBisbeardBuild, type BisbeardMappedBuild } from "./bisbeard-import";
import { bindHintTooltips } from "./hint-tooltip";
import { primaryStatBreakdown, primaryStatHintBody, spellCritBreakdown, spellCritHintBody, spellCritRatingNote, spellPowerBreakdown, spellPowerHintBody, statLayerBreakdown, statLayerHintBody } from "./stat-breakdown";
import { hydrateEnchantEffectStats, hydrateItemEffectStats } from "./effect-stats";

(window as Window & { __coaModuleStarted?: boolean }).__coaModuleStarted = true;

type ItemDb = {
  source: string;
  note: string;
  itemCount?: number;
  totalIngested?: number;
  items?: Item[];
  slots: Record<string, Item[]>;
};

const EMPTY_ITEM_STATS = {
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

type SpellDb = {
  logDurationSec: number;
  spells: Record<string, SpellFit>;
};

type EnchantDb = {
  count?: number;
  slots: Record<string, Enchant[]>;
  enchants?: Enchant[];
};

const gear: GearSet = {};
const enchants: EnchantSet = {};
let items: ItemDb = { source: "empty", note: "", items: [], slots: {} };
let enchantDb: EnchantDb = { slots: {} };
let spells: SpellDb = { logDurationSec: 0, spells: {} };
let activeSlot: Slot | null = null;
let selectedPhase = "all";
let buffsConfig: BuffsConfig = { ...DEFAULT_BUFFS };
let talentTrees: TalentTrees | null = null;
let talentSelection: TalentSelection = { felsworn: {}, infernal: {} };
let statWeights: StatWeights = defaultStatWeights();
const PICKER_RENDER_LIMIT = 300;
/** Badge trinket: hit + proc, 0 EP with default hit weight, tagged phase 1. */
const PINNED_TRINKETS = new Set([1414516]);
const itemCache = new Map<Slot, Item[]>();
const itemsById = new Map<number, Item>();
const enchantsById = new Map<number, Enchant>();
let lastSim: SimSnapshot | null = null;
let pinnedSim: SimSnapshot | null = null;

const SLOT_LABELS: Record<Slot, string> = {
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulders",
  back: "Back",
  chest: "Chest",
  shirt: "Shirt",
  tabard: "Tabard",
  wrist: "Wrists",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger1: "Finger 1",
  finger2: "Finger 2",
  trinket1: "Trinket 1",
  trinket2: "Trinket 2",
  mainhand: "Main Hand",
  offhand: "Off Hand",
  ranged: "Ranged",
};

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}

async function load() {
  const hint = document.getElementById("gear-hint");
  const setHint = (text: string) => {
    if (hint) hint.textContent = text;
    console.info(`[coa-sim] ${text}`);
  };
  setHint("Fetching item database…");

  const [itemDb, spellDb, nextEnchantDb, setDb, felswornTalents, infernalTalents] = await Promise.all([
    fetchJson<ItemDb>(dataUrl("data/items.json")),
    fetchJson<SpellDb>(dataUrl("data/spells.json")),
    fetchJson<EnchantDb>(dataUrl("data/enchants.json")).catch(() => ({ slots: {} })),
    fetchJson<SetCatalog>(dataUrl("data/sets.json")).catch(() => ({ sets: {} })),
    fetchJson<FelswornTalentDoc>(dataUrl("data/talents/felsworn.json")),
    fetchJson<InfernalTalentDoc>(dataUrl("data/talents/infernal.json")),
  ]);
  loadSetCatalog(setDb);
  talentTrees = { felsworn: felswornTalents, infernal: infernalTalents };
  items = itemDb;
  spells = spellDb;
  enchantDb = nextEnchantDb;
  setHint(`Parsed item database (${items.itemCount ?? 0} items). Building UI…`);
  pruneBloodforged(items);
  hydrateItems(items);
  hydrateEnchants(enchantDb);
  const session = loadSession();
  talentSelection = mergeTalentSelection(session.talents, talentTrees);
  restoreGearSet(gear, session.gear, (id) => itemsById.get(id));
  restoreEnchantSet(enchants, session.enchants, (id) => enchantsById.get(id));
  if (session.selectedPhase) selectedPhase = session.selectedPhase;

  setupItemPicker();
  void ensureBisbeardProxyReady().catch((err) => console.warn("[coa-sim] Bisbeard proxy SW:", err));
  setupBisbeardImport();
  setupTabs();
  statWeights = loadStatWeights();
  setupStatWeights();
  buffsConfig = setupBuffs(() => {
    saveSession({ buffs: buffsConfig });
    renderStats();
  }, session.buffs);
  const pullInput = document.getElementById("pull-felfury") as HTMLInputElement | null;
  if (pullInput && session.pullFelfury != null) pullInput.value = String(session.pullFelfury);
  pullInput?.addEventListener("change", () => {
    saveSession({ pullFelfury: readPullFelfury() });
    renderStats();
  });
  setupTalents(talentTrees, talentSelection, (next) => {
    talentSelection = next;
    saveSession({ talents: talentSelection });
    renderStats();
  });
  renderGear();
  renderStats();
  refreshGearSim();
  renderResultsEmpty();
  document.getElementById("duration")?.addEventListener("change", renderStats);
  if (hint) {
    if (items.itemCount) {
      hint.hidden = false;
      hint.textContent = "Trinket and weapon proc effects are not included in simulations yet.";
    } else {
      hint.hidden = false;
      hint.textContent = "No items found in /data/items.json. Run `npm run ingest` to rebuild it from the Bisbeard dump.";
    }
  }
}

// The bundled payload omits zeroed stats to keep the download small, so fill the
// gaps back in before anything does arithmetic on them.
function hydrateEnchants(db: EnchantDb) {
  enchantsById.clear();
  for (const list of Object.values(db.slots || {})) {
    for (const enchant of list) {
      enchant.stats = { ...EMPTY_ITEM_STATS, ...(enchant.stats || {}) };
      hydrateEnchantEffectStats(enchant);
      enchantsById.set(enchant.id, enchant);
    }
  }
  for (const enchant of db.enchants || []) {
    if (enchantsById.has(enchant.id)) continue;
    enchant.stats = { ...EMPTY_ITEM_STATS, ...(enchant.stats || {}) };
    hydrateEnchantEffectStats(enchant);
    enchantsById.set(enchant.id, enchant);
  }
}

function isBloodforgedItem(item: Item): boolean {
  return /bloodforged/i.test(`${item.subtitle ?? ""} ${item.name ?? ""}`);
}

function pruneBloodforged(db: ItemDb) {
  let kept = 0;
  if (db.slots) {
    for (const slot of Object.keys(db.slots)) {
      db.slots[slot] = db.slots[slot].filter((item) => !isBloodforgedItem(item));
      kept += db.slots[slot].length;
    }
  }
  if (db.items) db.items = db.items.filter((item) => !isBloodforgedItem(item));
  db.itemCount = kept || db.items?.length || 0;
  if (db.totalIngested) {
    db.note = `Bisbeard item data is bundled with the sim (${db.itemCount} caster items from ${db.totalIngested} ingested).`;
  }
}

function hydrateItems(db: ItemDb) {
  itemCache.clear();
  itemsById.clear();
  for (const list of Object.values(db.slots || {})) {
    for (const item of list) {
      item.stats = { ...EMPTY_ITEM_STATS, ...(item.stats || {}) };
      hydrateItemEffectStats(item);
      itemsById.set(item.id, item);
    }
  }
  for (const item of db.items || []) {
    if (itemsById.has(item.id)) continue;
    item.stats = { ...EMPTY_ITEM_STATS, ...(item.stats || {}) };
    hydrateItemEffectStats(item);
    itemsById.set(item.id, item);
  }
  absorbItemSetBonuses(itemsById.values());
}

async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: abort.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (abort.signal.aborted) throw new Error(`${url} timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function itemsFor(slot: Slot): Item[] {
  const cached = itemCache.get(slot);
  if (cached) return cached;
  const cat = slot.startsWith("finger") ? "finger" : slot.startsWith("trinket") ? "trinket" : slot;
  let list = (items.slots[cat] || (items.items || []).filter((item) => itemForSlot(item, slot))).slice();
  if (slot === "offhand") {
    const seen = new Set(list.map((item) => item.id));
    for (const item of items.slots.mainhand || []) {
      if (seen.has(item.id) || !itemForSlot(item, "offhand")) continue;
      seen.add(item.id);
      list.push(item);
    }
  }
  const caster = list.filter(isCasterItem);
  const pool = caster.length ? caster : list;
  const weights = liveStatWeights();
  const ep = new Map(pool.map((item) => [item, pieceEp(item, slot, weights)]));
  const ranked = pool.sort((a, b) => (ep.get(b) || 0) - (ep.get(a) || 0));
  itemCache.set(slot, ranked);
  return ranked;
}

function isCasterItem(item: Item): boolean {
  const armor = (item.armorType || "").toLowerCase();
  if (["leather", "cloth", "miscellaneous", "wands", "staves", "daggers", "swords"].includes(armor)) return true;
  const s = item.stats;
  return s.spellPower > 0 || s.intellect > 0 || s.spirit > 0 || s.spellCrit > 0 || s.spellHit > 0;
}

function isPinnedItem(item: Item, slot: Slot): boolean {
  return slot.startsWith("trinket") && PINNED_TRINKETS.has(item.id);
}

function isHitOrProcItem(item: Item): boolean {
  if ((item.stats?.spellHit || 0) > 0) return true;
  return (item.effects || []).some((line) => /spell (power|damage)|damaging spells/i.test(line));
}

function renderGear() {
  const root = document.getElementById("gear");
  if (!root) return;
  root.innerHTML = "";
  root.className = "paperdoll";

  const left = document.createElement("div");
  left.className = "paperdoll__col paperdoll__col--left";
  for (const slot of PAPER_DOLL_LEFT) left.appendChild(renderGearSlot(slot));

  const center = document.createElement("div");
  center.className = "paperdoll__center";
  center.innerHTML = `<div class="paperdoll__bust"><span>Felsworn</span><small>Infernal</small></div>`;

  const right = document.createElement("div");
  right.className = "paperdoll__col paperdoll__col--right";
  for (const slot of PAPER_DOLL_RIGHT) right.appendChild(renderGearSlot(slot));

  const weapons = document.createElement("div");
  weapons.className = "paperdoll__weapons";
  for (const slot of PAPER_DOLL_WEAPONS) weapons.appendChild(renderGearSlot(slot));

  root.append(left, center, right, weapons);
  syncOffhandOilField(gear);
}

function renderGearSlot(slot: Slot) {
  const row = document.createElement("div");
  row.className = "gear-slot";
  if (slot === "offhand" && isTwoHand(gear.mainhand)) row.classList.add("is-disabled");

  const slotName = document.createElement("span");
  slotName.className = "gear-slot__name";
  slotName.textContent = SLOT_LABELS[slot];

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gear-slot__item";
  button.dataset.slot = slot;
  button.addEventListener("click", () => openItemPicker(slot));

  const selected = gear[slot];
  const enchant = enchants[slot];
  if (slot === "offhand" && isTwoHand(gear.mainhand)) {
    button.disabled = true;
    button.classList.add("is-empty");
    const name = document.createElement("strong");
    name.textContent = "Two-hand equipped";
    const details = document.createElement("small");
    details.textContent = "Off-hand is empty while a two-hander is in Main Hand";
    button.append(name, details);
  } else if (selected) {
    button.classList.add(`quality-${qualityClass(selected.quality)}`);
    const name = document.createElement("strong");
    name.textContent = selected.name;
    const details = document.createElement("small");
    details.textContent = enchant
      ? `${enchant.name} · ${formatEp(pieceEp(selected, slot))}`
      : `${itemMeta(selected)} · ${formatEp(pieceEp(selected, slot))}`;
    button.append(name, details);
    bindTooltip(button, selected);
  } else {
    button.classList.add("is-empty");
    const name = document.createElement("strong");
    name.textContent = "Select an item";
    const details = document.createElement("small");
    details.textContent = `${itemsFor(slot).length} available`;
    button.append(name, details);
  }

  const chevron = document.createElement("span");
  chevron.className = "gear-slot__chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  button.appendChild(chevron);

  row.append(slotName, button);
  return row;
}

function setupBisbeardImport() {
  const input = document.getElementById("bisbeard-import-url") as HTMLInputElement | null;
  const button = document.getElementById("bisbeard-import-run") as HTMLButtonElement | null;
  const status = document.getElementById("bisbeard-import-status");
  if (!input || !button || !status) return;

  const setStatus = (text: string, isError = false) => {
    status.hidden = !text;
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  const run = async () => {
    button.disabled = true;
    setStatus("Fetching build…");
    try {
      const mapped = await loadBisbeardBuild(input.value);
      applyBisbeardBuild(mapped, setStatus);
    } catch (err) {
      const message = err instanceof BisbeardImportError ? err.message : "Import failed.";
      setStatus(message, true);
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener("click", () => void run());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void run();
  });
}

function applyBisbeardBuild(mapped: BisbeardMappedBuild, setStatus: (text: string, isError?: boolean) => void) {
  const missingItems: string[] = [];
  const missingEnchants: string[] = [];
  let equipped = 0;

  for (const slot of SLOTS) {
    const id = mapped.gear[slot];
    if (id == null) {
      gear[slot] = null;
      continue;
    }
    const item = itemsById.get(id);
    if (item) {
      gear[slot] = item;
      equipped += 1;
    } else {
      gear[slot] = null;
      missingItems.push(`${SLOT_LABELS[slot]} (${id})`);
    }
  }

  if (isTwoHand(gear.mainhand)) {
    gear.offhand = null;
    enchants.offhand = null;
  }

  for (const slot of SLOTS) {
    const id = mapped.enchants[slot];
    if (id == null) {
      enchants[slot] = null;
      continue;
    }
    const enchant = enchantsById.get(id);
    const item = gear[slot] ?? null;
    if (enchant && item && enchantFitsSlot(enchant, slot, item, gear.mainhand ?? null)) {
      enchants[slot] = enchant;
    } else {
      enchants[slot] = null;
      if (id != null) missingEnchants.push(`${SLOT_LABELS[slot]} (${id})`);
    }
  }

  if (mapped.phase) {
    selectedPhase = mapped.phase;
    saveSession({ selectedPhase });
    const phaseSelect = document.getElementById("phase-filter") as HTMLSelectElement | null;
    if (phaseSelect && [...phaseSelect.options].some((option) => option.value === mapped.phase)) {
      phaseSelect.value = mapped.phase;
    }
  }

  itemCache.clear();
  saveGearSet(gear);
  saveEnchantSet(enchants);
  syncOffhandOilField(gear);
  renderGear();
  renderStats();

  const parts = [`Imported ${equipped} item${equipped === 1 ? "" : "s"}.`];
  if (mapped.specName) parts.push(mapped.specName);
  if (mapped.phase) parts.push(`Phase ${mapped.phase}`);
  if (missingItems.length) parts.push(`${missingItems.length} item${missingItems.length === 1 ? "" : "s"} not in catalog.`);
  if (missingEnchants.length) {
    parts.push(`${missingEnchants.length} enchant${missingEnchants.length === 1 ? "" : "s"} skipped.`);
  }
  setStatus(parts.join(" · "));
}

function setupItemPicker() {
  document.getElementById("item-picker-close")?.addEventListener("click", closeItemPicker);
  document.querySelector<HTMLButtonElement>(".item-picker__backdrop")?.addEventListener("click", closeItemPicker);
  document.getElementById("item-search")?.addEventListener("input", renderPickerResults);
  document.getElementById("phase-filter")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    selectedPhase = select.value || "all";
    saveSession({ selectedPhase });
    renderPickerResults();
  });
  document.getElementById("item-clear")?.addEventListener("click", () => {
    if (!activeSlot) return;
    gear[activeSlot] = null;
    enchants[activeSlot] = null;
    saveGearSet(gear);
    saveEnchantSet(enchants);
    renderGear();
    renderStats();
    closeItemPicker();
  });
  document.getElementById("slot-enchant")?.addEventListener("change", (event) => {
    if (!activeSlot) return;
    const id = Number((event.currentTarget as HTMLSelectElement).value);
    enchants[activeSlot] = Number.isFinite(id) && id > 0 ? enchantsById.get(id) ?? null : null;
    saveEnchantSet(enchants);
    itemCache.clear();
    renderGear();
    renderStats();
    renderPickerResults();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSlot) closeItemPicker();
  });
}

function setupTabs() {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab || "gear"));
  });
}

function setupStatWeights() {
  const root = document.getElementById("weights-controls");
  if (!root) return;
  root.innerHTML = "";
  for (const [stat, label] of STAT_WEIGHT_ORDER) {
    const field = document.createElement("label");
    field.className = "weight-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.001";
    input.dataset.weight = stat;
    input.value = String(statWeights[stat]);
    const commitWeight = () => {
      const value = Number(input.value);
      statWeights[stat] = Number.isFinite(value) ? value : 0;
      applyStatWeights();
    };
    input.addEventListener("input", commitWeight);
    input.addEventListener("change", commitWeight);
    field.append(caption, input);
    root.appendChild(field);
  }
  document.getElementById("weights-reset")?.addEventListener("click", () => {
    statWeights = defaultStatWeights();
    syncStatWeightInputs();
    applyStatWeights();
  });
}

function syncStatWeightInputs() {
  document.querySelectorAll<HTMLInputElement>("[data-weight]").forEach((input) => {
    const stat = input.dataset.weight as keyof StatWeights;
    input.value = String(statWeights[stat]);
  });
}

// Ranking is cached per slot, so a weight change has to drop the cache before
// anything re-reads the sorted lists.
function liveStatWeights(): StatWeights {
  document.querySelectorAll<HTMLInputElement>("[data-weight]").forEach((input) => {
    const stat = input.dataset.weight as keyof StatWeights | undefined;
    if (!stat) return;
    const value = Number(input.value);
    statWeights[stat] = Number.isFinite(value) ? value : 0;
  });
  return statWeights;
}

function pieceEp(item: Item, slot: Slot, weights = liveStatWeights()): number {
  let total = statsEp(item.stats, weights);
  const enchant = enchants[slot];
  if (enchant && enchantFitsSlot(enchant, slot, item, gear.mainhand ?? null)) {
    total += statsEp(enchant.stats, weights);
  }
  return total;
}

function enchantEp(enchant: Enchant, weights = liveStatWeights()): number {
  return statsEp(enchant.stats, weights);
}

function applyStatWeights() {
  liveStatWeights();
  saveStatWeights(statWeights);
  itemCache.clear();
  renderGear();
  if (activeSlot) {
    populateEnchantSelect(activeSlot);
    renderPickerResults();
  }
}

function activateTab(tab: string) {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll<HTMLElement>("[data-tab-panel]").forEach((panel) => {
    const active = panel.dataset.tabPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

function openItemPicker(slot: Slot) {
  activeSlot = slot;
  const picker = document.getElementById("item-picker");
  const title = document.getElementById("item-picker-title");
  const search = document.getElementById("item-search") as HTMLInputElement | null;
  const phase = document.getElementById("phase-filter") as HTMLSelectElement | null;
  if (!picker || !search || !phase) return;

  if (title) title.textContent = SLOT_LABELS[slot];
  search.value = "";
  populatePhaseFilter(phase);
  populateEnchantSelect(slot);
  picker.hidden = false;
  document.body.classList.add("modal-open");
  renderPickerResults();
  requestAnimationFrame(() => search.focus());
}

function closeItemPicker() {
  const picker = document.getElementById("item-picker");
  if (picker) picker.hidden = true;
  document.body.classList.remove("modal-open");
  hideTooltip();
  activeSlot = null;
}

function itemPhaseTags(item: Item): number[] {
  const display = item.displayPhase ?? item.phase;
  const tags = item.extraPhases ? [...item.extraPhases] : [];
  if (display != null && !tags.includes(display)) tags.unshift(display);
  return tags;
}

function itemMatchesPhase(item: Item, phase: string): boolean {
  if (phase === "all") return true;
  const tags = itemPhaseTags(item);
  if (phase === "unknown") return tags.length === 0;
  const want = Number(phase);
  if (!Number.isFinite(want)) return true;
  if (!tags.length) return true;
  return Math.min(...tags) <= want;
}

function enchantsFor(slot: Slot): Enchant[] {
  const weights = liveStatWeights();
  const list = (enchantDb.slots[slot] || []).filter((enchant) =>
    enchantFitsSlot(enchant, slot, gear[slot] ?? null, gear.mainhand ?? null),
  );
  return list.slice().sort((a, b) => {
    const epDelta = enchantEp(b, weights) - enchantEp(a, weights);
    return epDelta || a.name.localeCompare(b.name);
  });
}

function populateEnchantSelect(slot: Slot) {
  const wrap = document.getElementById("slot-enchant-wrap");
  const select = document.getElementById("slot-enchant") as HTMLSelectElement | null;
  if (!wrap || !select) return;
  const weights = liveStatWeights();
  const options = enchantsFor(slot);
  wrap.hidden = options.length === 0;
  select.innerHTML = "";
  select.add(new Option("No enchant", ""));
  for (const enchant of options) {
    const ep = formatEp(enchantEp(enchant, weights));
    const detail = enchant.description ? `${enchant.name} — ${enchant.description}` : enchant.name;
    select.add(new Option(`${ep} · ${detail}`, String(enchant.id)));
  }
  select.value = enchants[slot] ? String(enchants[slot]!.id) : "";
}

function populatePhaseFilter(select: HTMLSelectElement) {
  const phases = new Set<number>();
  let hasUnknown = false;
  for (const list of Object.values(items.slots || {})) {
    for (const item of list) {
      const tags = itemPhaseTags(item);
      if (!tags.length) hasUnknown = true;
      else for (const phase of tags) phases.add(phase);
    }
  }
  const sorted = [...phases].sort((a, b) => a - b);
  select.innerHTML = "";
  select.add(new Option("All phases", "all"));
  for (const phase of sorted) select.add(new Option(`Phase ${phase}`, String(phase)));
  if (hasUnknown) select.add(new Option("Phase unknown", "unknown"));
  select.value = [...select.options].some((option) => option.value === selectedPhase) ? selectedPhase : "all";
  selectedPhase = select.value;
}

function renderPickerResults() {
  if (!activeSlot) return;
  const root = document.getElementById("item-results");
  const count = document.getElementById("item-result-count");
  const search = (document.getElementById("item-search") as HTMLInputElement | null)?.value.trim().toLowerCase() || "";
  const phase = selectedPhase || (document.getElementById("phase-filter") as HTMLSelectElement | null)?.value || "all";
  if (!root) return;

  const slot = activeSlot;
  const weights = liveStatWeights();
  const byEp = (a: Item, b: Item) => {
    const delta = pieceEp(b, slot, weights) - pieceEp(a, slot, weights);
    return delta || a.name.localeCompare(b.name);
  };
  const matches = itemsFor(slot).filter((item) => {
    const matchesName = !search || item.name.toLowerCase().includes(search) || String(item.id).includes(search);
    const matchesPhase = itemMatchesPhase(item, phase);
    return matchesName && matchesPhase;
  });
  const pinned = matches.filter((item) => isPinnedItem(item, slot)).sort(byEp);
  const unpinned = matches.filter((item) => !isPinnedItem(item, slot)).sort(byEp);

  const ranked = unpinned.slice(0, PICKER_RENDER_LIMIT);
  const shown = new Set(ranked);
  const buriedHit = unpinned.filter((item) => !shown.has(item) && isHitOrProcItem(item)).sort(byEp);

  if (count) {
    const visible = ranked.length + buriedHit.length + pinned.length;
    count.textContent =
      matches.length > visible
        ? `${matches.length} items · showing ${visible} (search to narrow)`
        : `${matches.length} item${matches.length === 1 ? "" : "s"}`;
  }
  root.innerHTML = "";

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "item-results__empty";
    empty.textContent = "No items match those filters.";
    root.appendChild(empty);
    return;
  }

  if (ranked.length) {
    if (pinned.length || buriedHit.length) appendPickerHeading(root, "Highest EP");
    for (const item of ranked) appendPickerItem(root, item);
  }
  if (pinned.length) {
    appendPickerHeading(root, "Badge / always available");
    for (const item of pinned) appendPickerItem(root, item);
  }
  if (buriedHit.length) {
    appendPickerHeading(root, "Hit and proc items");
    for (const item of buriedHit) appendPickerItem(root, item);
  }
}

function appendPickerHeading(root: HTMLElement, label: string) {
  const heading = document.createElement("div");
  heading.className = "item-results__heading";
  heading.textContent = label;
  root.appendChild(heading);
}

function appendPickerItem(root: HTMLElement, item: Item) {
  if (!activeSlot) return;
  const slot = activeSlot;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `item-result quality-${qualityClass(item.quality)}`;
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(gear[slot]?.id === item.id));

  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = item.name;
  const details = document.createElement("small");
  details.textContent = itemMeta(item);
  copy.append(name, details);

  const score = document.createElement("span");
  score.className = "item-result__score";
  const ep = pieceEp(item, slot);
  const hit = item.stats.spellHit || 0;
  score.textContent = hit && ep === 0 ? `${formatEp(ep)} · ${hit} hit` : formatEp(ep);

  button.append(copy, score);
  button.addEventListener("click", () => {
    if (!activeSlot) return;
    gear[activeSlot] = item;
    if (activeSlot === "mainhand" && isTwoHand(item)) {
      gear.offhand = null;
      enchants.offhand = null;
    }
    if (enchants[activeSlot] && !enchantFitsSlot(enchants[activeSlot]!, activeSlot, item, gear.mainhand ?? null)) {
      enchants[activeSlot] = null;
    }
    saveGearSet(gear);
    saveEnchantSet(enchants);
    renderGear();
    renderStats();
    closeItemPicker();
  });
  bindTooltip(button, item);
  root.appendChild(button);
}

function itemMeta(item: Item): string {
  const parts = [];
  if (item.itemLevel) parts.push(`ilvl ${item.itemLevel}`);
  const shownPhase = item.displayPhase ?? item.phase;
  if (shownPhase) parts.push(`Phase ${shownPhase}`);
  if (item.armorType) parts.push(item.armorType);
  return parts.join(" · ") || `Item ${item.id}`;
}

function itemSlotLabel(item: Item): string {
  if (item.slot === "finger") return "Finger";
  if (item.slot === "trinket") return "Trinket";
  const matchingSlot = SLOTS.find((slot) => slot === item.slot);
  return matchingSlot ? SLOT_LABELS[matchingSlot] : item.slot.replace(/(^|[-_ ])\w/g, (part) => part.toUpperCase());
}

function qualityClass(quality: Item["quality"]): string {
  return String(quality || "common").toLowerCase().replace(/[^a-z]/g, "");
}

function formatStat(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function floorStat(value: number): string {
  return String(Math.floor(value));
}

const WHITE_STAT_NAMES = new Set(["strength", "agility", "stamina", "intellect", "spirit"]);

const GREEN_STAT_EQUIP: Array<{
  key: keyof Item["stats"];
  match: RegExp;
  line: (amount: number) => string;
}> = [
  { key: "firePower", match: /fire spell power/i, line: (n) => `Equip: Increases fire spell power by ${n}.` },
  { key: "shadowPower", match: /shadow spell power/i, line: (n) => `Equip: Increases shadow spell power by ${n}.` },
  { key: "spellPower", match: /spell power|spell damage|magical spells/i, line: (n) => `Equip: Increases spell power by ${n}.` },
  { key: "spellCrit", match: /critical strike rating|crit rating/i, line: (n) => `Equip: Improves critical strike rating by ${n}.` },
  { key: "spellHit", match: /hit rating/i, line: (n) => `Equip: Improves hit rating by ${n}.` },
  { key: "spellHaste", match: /haste rating/i, line: (n) => `Equip: Improves haste rating by ${n}.` },
];

function isWhiteStatLine(line: string): boolean {
  const match = line.match(/^\+(-?\d+(?:\.\d+)?)\s+(.+)$/);
  if (!match) return true;
  const name = match[2].toLowerCase();
  return WHITE_STAT_NAMES.has(name) || /resistance$/.test(name);
}

function tooltipBaseStatLines(item: Item): string[] {
  const fromTooltip = (item.baseStats || []).filter(isWhiteStatLine);
  if (fromTooltip.length) return fromTooltip;
  return (["stamina", "intellect", "spirit"] as const)
    .filter((key) => item.stats[key] !== 0)
    .map((key) => `+${formatStat(item.stats[key])} ${key[0].toUpperCase()}${key.slice(1)}`);
}

function isTimedOrChanceEffect(line: string): boolean {
  return /^(Use|Chance on hit):/i.test(line)
    || /\bchance to\b/i.test(line)
    || /\bfor \d+ sec/i.test(line)
    || /\bon (?:hit|crit|spell|cast|kill)\b/i.test(line);
}

function isGreenStatEffect(line: string): boolean {
  if (!/^Equip:/i.test(line) || isTimedOrChanceEffect(line)) return false;
  return GREEN_STAT_EQUIP.some((def) => def.match.test(line));
}

function matchingGreenEffect(effects: string[], def: (typeof GREEN_STAT_EQUIP)[number], amount: number): string | null {
  return effects.find((line) => {
    if (!isGreenStatEffect(line) || !def.match.test(line)) return false;
    const parsed = Number(line.match(/by (?:up to )?(\d+)/i)?.[1]);
    return parsed === amount;
  }) ?? null;
}

function tooltipEffectLines(item: Item): string[] {
  const effects = item.effects || [];
  const greens: string[] = [];
  for (const def of GREEN_STAT_EQUIP) {
    const amount = item.stats[def.key];
    if (!amount) continue;
    greens.push(matchingGreenEffect(effects, def, amount) || def.line(amount));
  }
  const extras = effects.filter((line) => !isGreenStatEffect(line));
  return [...greens, ...extras];
}

function bindTooltip(element: HTMLElement, item: Item) {
  element.addEventListener("mouseenter", () => showTooltip(element, item));
  element.addEventListener("mouseleave", hideTooltip);
  element.addEventListener("focus", () => showTooltip(element, item));
  element.addEventListener("blur", hideTooltip);
}

function showTooltip(anchor: HTMLElement, item: Item) {
  const tooltip = document.getElementById("item-tooltip");
  if (!tooltip) return;
  tooltip.innerHTML = "";
  tooltip.className = `item-tooltip quality-${qualityClass(item.quality)}`;

  const name = document.createElement("strong");
  name.className = "item-tooltip__name";
  name.textContent = item.name;
  tooltip.appendChild(name);

  if (item.subtitle) appendTooltipLine(tooltip, item.subtitle, "item-tooltip__subtitle");
  if (item.bind) appendTooltipLine(tooltip, item.bind);
  if (item.unique) appendTooltipLine(tooltip, item.unique);

  const slotLabel = item.equipSlot || itemSlotLabel(item);
  const subtype = weaponSubtype(item);
  if (slotLabel || item.armorType) {
    const row = document.createElement("div");
    row.className = "item-tooltip__row";
    const left = document.createElement("span");
    left.textContent = slotLabel;
    row.appendChild(left);
    if (item.armorType) {
      const right = document.createElement("span");
      if (subtype) right.className = "item-tooltip__subtype";
      right.textContent = subtype || item.armorType;
      row.appendChild(right);
    }
    tooltip.appendChild(row);
  }

  if (item.damage) {
    const speed = item.damage.speed;
    const row = document.createElement("div");
    row.className = "item-tooltip__row";
    const dmg = document.createElement("span");
    dmg.textContent = `${formatDamage(item.damage.min)} - ${formatDamage(item.damage.max)} Damage`;
    const spd = document.createElement("span");
    spd.textContent = `Speed ${speed.toFixed(2)}`;
    row.append(dmg, spd);
    tooltip.appendChild(row);
    const dps = (item.damage.min + item.damage.max) / 2 / speed;
    appendTooltipLine(tooltip, `(${dps.toFixed(1)} damage per second)`);
  }

  if (item.armor) appendTooltipLine(tooltip, `${item.armor} Armor`);

  const baseStats = tooltipBaseStatLines(item);
  for (const line of baseStats) appendTooltipLine(tooltip, line);

  if (item.reqLevel) appendTooltipLine(tooltip, `Requires Level ${item.reqLevel}`);
  if (item.itemLevel) appendTooltipLine(tooltip, `Item Level ${item.itemLevel}`);

  for (const line of tooltipEffectLines(item)) {
    appendTooltipLine(tooltip, line, "item-tooltip__effect");
  }

  const setInfo = setProgressForItem(item, gear);
  if (setInfo) {
    appendTooltipLine(tooltip, `${setInfo.name} (${setInfo.equipped}/${setInfo.threshold})`, "item-tooltip__set");
    for (const bonus of setInfo.bonuses) {
      appendTooltipLine(
        tooltip,
        `(${bonus.pieces}) Set: ${bonus.text}`,
        bonus.active ? "item-tooltip__set-bonus is-active" : "item-tooltip__set-bonus is-inactive",
      );
    }
  }

  appendTooltipLine(
    tooltip,
    [item.displayPhase ?? item.phase ? `Phase ${item.displayPhase ?? item.phase}` : null, `ID ${item.id}`]
      .filter(Boolean)
      .join(" · "),
    "item-tooltip__footer",
  );
  tooltip.hidden = false;
  positionTooltip(tooltip, anchor);
}

function weaponSubtype(item: Item): string | null {
  const type = item.armorType || "";
  const map: Record<string, string> = {
    Axes: "Axe",
    "One-Handed Axes": "Axe",
    "Two-Handed Axes": "Axe",
    Swords: "Sword",
    "One-Handed Swords": "Sword",
    "Two-Handed Swords": "Sword",
    Maces: "Mace",
    "One-Handed Maces": "Mace",
    "Two-Handed Maces": "Mace",
    Daggers: "Dagger",
    Staves: "Staff",
    Polearms: "Polearm",
    "Fist Weapons": "Fist Weapon",
    Bows: "Bow",
    Guns: "Gun",
    Crossbows: "Crossbow",
    Wands: "Wand",
    Wand: "Wand",
    Thrown: "Thrown",
  };
  return map[type] || null;
}

function formatDamage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function appendTooltipLine(root: HTMLElement, text: string, className?: string) {
  const line = document.createElement("div");
  if (className) line.className = className;
  line.textContent = text;
  root.appendChild(line);
}

function positionTooltip(tooltip: HTMLElement, anchor: HTMLElement) {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const gap = 12;
  let left = anchorRect.right + gap;
  if (left + tooltipRect.width > window.innerWidth - gap) left = anchorRect.left - tooltipRect.width - gap;
  let top = anchorRect.top;
  top = Math.max(gap, Math.min(top, window.innerHeight - tooltipRect.height - gap));
  tooltip.style.left = `${Math.max(gap, left)}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  const tooltip = document.getElementById("item-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function renderStats() {
  const gearRatings = ratingsFromGear(gear, enchants);
  const gearStats = statsFromGear(gear, enchants);
  const duration = Number((document.getElementById("duration") as HTMLInputElement | null)?.value) || 180;
  const bonusStats = statsFromBuffs(buffsConfig, gearStats, duration, gear, talentSelection);
  const stats = applyTakenTalents(
    applyStatScaleBuffs(buildCharacter(gear, 0, bonusStats, readPullFelfury(), enchants), buffsConfig),
    talentSelection,
    buffsConfig,
  );
  const chances = buildChanceBreakdown(
    gearRatings,
    ratingConsumes(buffsConfig, gear),
    stats.spirit,
    stats.intellect,
    percentBuffs(buffsConfig, talentSelection),
    talentSelection,
    buffsConfig,
  );
  const sp = displaySpellPower(stats, stats.hiddenPower);
  const spellPen = stats.spellPenetration || 0;
  const root = document.getElementById("stats");
  if (!root) return;
  const rows: Array<[string, string]> = [
    ["Spell Power", floorStat(sp)],
    ["Spell Penetration", floorStat(spellPen)],
    ["Intellect", floorStat(stats.intellect)],
    ["Spirit", floorStat(stats.spirit)],
    ["Spell Crit", `${chances.crit.total.toFixed(2)}%`],
    ["Spell Hit", `${chances.hit.total.toFixed(1)}%`],
    ["Spell Haste", `${chances.haste.total.toFixed(1)}%`],
  ];
  root.innerHTML = rows
    .map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`)
    .join("");
  bindStatBreakdownHovers(root, stats, duration, chances);
  renderSetSummary();
}

function applyStatHint(row: HTMLElement, title: string, content: { body: string; reminders: string[] }) {
  row.classList.add("stats__hover");
  row.dataset.hintTitle = title;
  row.dataset.hintBody = content.body;
  if (content.reminders.length) row.dataset.hintReminders = content.reminders.join("\n\n");
  else delete row.dataset.hintReminders;
  row.tabIndex = 0;
}

function bindStatBreakdownHovers(
  root: HTMLElement,
  stats: CharacterStats,
  durationSec: number,
  chances: ChanceBreakdown,
) {
  const spellPowerRow = [...root.querySelectorAll("div")].find((el) => el.querySelector("dt")?.textContent === "Spell Power");
  if (spellPowerRow) {
    const breakdown = spellPowerBreakdown(gear, enchants, buffsConfig, durationSec, talentSelection);
    applyStatHint(spellPowerRow, "Spell Power", spellPowerHintBody(breakdown));
  }

  const spellPenRow = [...root.querySelectorAll("div")].find((el) => el.querySelector("dt")?.textContent === "Spell Penetration");
  if (spellPenRow) {
    const breakdown = statLayerBreakdown("spellPenetration", gear, enchants, buffsConfig, durationSec, talentSelection);
    spellPenRow.classList.add("stats__hover");
    spellPenRow.dataset.hintTitle = "Spell Penetration";
    spellPenRow.dataset.hintBody = statLayerHintBody("Spell Penetration", breakdown);
    spellPenRow.tabIndex = 0;
  }

  const spellCritRow = [...root.querySelectorAll("div")].find((el) => el.querySelector("dt")?.textContent === "Spell Crit");
  if (spellCritRow) {
    const breakdown = spellCritBreakdown(gear, enchants, buffsConfig, stats, talentSelection, chances.crit.total);
    spellCritRow.classList.add("stats__hover");
    spellCritRow.dataset.hintTitle = "Spell Crit";
    spellCritRow.dataset.hintBody = spellCritHintBody(breakdown, chances.crit.rating);
    spellCritRow.dataset.hintReminders = spellCritRatingNote();
    spellCritRow.tabIndex = 0;
  }

  const spellHitRow = [...root.querySelectorAll("div")].find((el) => el.querySelector("dt")?.textContent === "Spell Hit");
  if (spellHitRow) {
    applyStatHint(spellHitRow, "Spell Hit", hitHintContent(chances.hit));
  }

  const spellHasteRow = [...root.querySelectorAll("div")].find((el) => el.querySelector("dt")?.textContent === "Spell Haste");
  if (spellHasteRow) {
    applyStatHint(spellHasteRow, "Spell Haste", hasteHintContent(chances.haste, buffsConfig.tailwind));
  }

  for (const key of ["Intellect", "Spirit"] as const) {
    const row = [...root.querySelectorAll("div")].find((el) => el.querySelector("dt")?.textContent === key);
    if (!row) continue;
    const statKey = key.toLowerCase() as "intellect" | "spirit";
    const breakdown = primaryStatBreakdown(statKey, gear, enchants, buffsConfig, durationSec, talentSelection);
    applyStatHint(row, key, primaryStatHintBody(statKey, breakdown, stats, talentSelection));
  }
  bindHintTooltips(root, ".stats__hover[data-hint-body]");
}

function renderSetSummary() {
  const root = document.getElementById("set-bonuses");
  if (!root) return;
  root.replaceChildren();
  const sets = equippedSets(gear);
  if (!sets.length) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "No set pieces equipped.";
    root.appendChild(hint);
    return;
  }
  for (const set of sets) {
    const block = document.createElement("div");
    block.className = "set-summary__set";
    const head = document.createElement("div");
    head.className = "set-summary__head";
    const name = document.createElement("span");
    name.className = "set-summary__name";
    name.textContent = set.name;
    const count = document.createElement("span");
    count.className = "set-summary__count";
    count.textContent = `${set.equipped}/${set.threshold}`;
    head.append(name, count);
    block.appendChild(head);
    for (const bonus of set.bonuses) {
      const line = document.createElement("div");
      line.className = `set-summary__bonus ${bonus.active ? "is-active" : "is-inactive"}`;
      line.textContent = `(${bonus.pieces}) ${bonus.text}`;
      block.appendChild(line);
    }
    root.appendChild(block);
  }
}

function readPullFelfury() {
  const raw = Number((document.getElementById("pull-felfury") as HTMLInputElement | null)?.value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(6, Math.floor(raw)));
}

function simulate() {
  void runSimulation();
}

async function runSimulation() {
  if (document.body.classList.contains("sim-running")) return;

  const duration = Number((document.getElementById("duration") as HTMLInputElement).value) || 180;
  const iterations = Number((document.getElementById("iterations") as HTMLInputElement).value) || 600;
  const gearStats = statsFromGear(gear, enchants);
  const stats = applyStatScaleBuffs(
    buildCharacter(
      gear,
      0,
      statsFromBuffs(buffsConfig, gearStats, duration, gear, talentSelection),
      readPullFelfury(),
      enchants,
    ),
    buffsConfig,
  );

  setSimRunning(true, 0, iterations);
  try {
    const result = await runSimAsync(
      spells.spells,
      stats,
      {
        durationSec: duration,
        iterations,
        seed: 1,
        fightStyle: "stationary",
        playerLevel: PLAYER_LEVEL,
        bossLevel: BOSS_LEVEL,
        allowCleave: false,
        movement: false,
        potionSpellPower: buffsConfig.potion === "none" ? 0 : 75,
        potionDuration: 20,
        potionMode: buffsConfig.potion === "none" ? "none" : buffsConfig.potion,
        setDamageAbove75: setBonusCombat(gear).damageAbove75,
        talentSelection,
        procContributions: procContributionsFromBuffs(buffsConfig),
        neptulonsWrath: buffsConfig.neptulonsWrath,
        tailwind: buffsConfig.tailwind,
        targetHealthDecays: buffsConfig.targetHealthDecays,
        demonfirePact: buffsConfig.demonfirePact,
      },
      null,
      null,
      (completed, total) => setSimProgress(completed, total),
    );
    lastSim = toSnapshot(result);
    renderResults({ ...result, activeCombatBuffs: activeCombatBuffLabels(buffsConfig) });
    refreshGearSim();
  } finally {
    setSimRunning(false);
  }
}

function setSimRunning(running: boolean, completed = 0, total = 0) {
  document.body.classList.toggle("sim-running", running);
  const root = document.getElementById("sim-progress");
  if (!root) return;
  if (!running) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  setSimProgress(completed, total);
}

function setSimProgress(completed: number, total: number) {
  const bar = document.getElementById("sim-progress-bar");
  const label = document.getElementById("sim-progress-label");
  const pct = total > 0 ? (completed / total) * 100 : 0;
  if (bar) bar.style.width = `${pct.toFixed(1)}%`;
  if (label) {
    label.textContent =
      completed >= total ? "Done" : `Simulating ${completed.toLocaleString()} / ${total.toLocaleString()}`;
  }
}

function refreshGearSim() {
  renderGearSimCard(lastSim, pinnedSim, {
    onSimulate: simulate,
    onPin: () => {
      pinnedSim = lastSim;
      refreshGearSim();
    },
    onUnpin: () => {
      pinnedSim = null;
      refreshGearSim();
    },
  });
}

load().catch((err) => {
  console.error("[coa-sim] load failed", err);
  const hint = document.getElementById("gear-hint");
  if (hint) hint.textContent = `Could not load item data: ${err instanceof Error ? err.message : err}`;
  const el = document.getElementById("results");
  if (el) el.textContent = String(err);
});
