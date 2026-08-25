import type { BuffsConfig, CharacterStats, GearSet, ItemStats } from "./types";
import {
  addStats,
  emptyStats,
  offhandAcceptsOil,
  ratingsToPercent,
  scalePrimaryStats,
  SPELL_CRIT_RATING_PER_PERCENT,
  SPELL_HIT_CAP,
  SPELL_HIT_RATING_PER_PERCENT,
} from "./sim/stats";
import { scaleIntuitionStats, scalePactStats } from "./talents/felsworn";
import type { TalentSelection } from "./talents/types";
import { bindHintTooltips } from "./hint-tooltip";

type BooleanBuffKey = {
  [K in keyof BuffsConfig]: BuffsConfig[K] extends boolean ? K : never;
}[keyof BuffsConfig];

type ToggleDef = {
  key: BooleanBuffKey;
  label: string;
  /** Single-line hint (native-style); shown in styled tooltip when hintBody is omitted. */
  note?: string;
  /** Tooltip heading; defaults to the label before " — ". */
  hintTitle?: string;
  /** Multi-paragraph hint body; separate paragraphs with blank lines. */
  hintBody?: string;
  defaultOn: boolean;
  stats: Partial<ItemStats>;
  /** Flat DPS when enabled (log-fitted party procs). */
  procDps?: number;
  procName?: string;
  /** Multiplies selected item stats when enabled. Applied after flat buffs. */
  statScalePct?: number;
  statScaleKeys?: (keyof ItemStats)[];
};

const UNKNOWN_BONUS = "bonus unknown";

// Buff values come from CoA spell tooltips. Effects outside ItemStats (resists,
// armor, agility, and reactive damage) remain informational and do not change DPS.
const RAID_BUFFS: ToggleDef[] = [
  {
    key: "demonfirePact",
    label: "Demonfire Pact — +3% critical strike chance (+4% with Pact Hunter)",
    note: "Also +5% damage against Demons",
    defaultOn: true,
    stats: { spellCrit: 3 },
  },
  {
    key: "greaterManariIntuition",
    label: "Greater Man'ari Intuition — +12 all primary stats (14 with Dark Teachings)",
    note: "Also +285 armor",
    defaultOn: true,
    stats: { intellect: 12, spirit: 12, stamina: 12, strength: 12, agility: 12 },
  },
  {
    key: "greaterBloodthorns",
    label: "Greater Bloodthorns — 21 Shadow damage to attackers",
    note: "Reactive damage; not included in player DPS",
    defaultOn: false,
    stats: {},
  },
  {
    key: "greaterSanguinaryOffering",
    label: "Greater Sanguinary Offering — +54 Stamina",
    defaultOn: false,
    stats: { stamina: 54 },
  },
  {
    key: "greaterSealOfAlysrazor",
    label: "Greater Seal of Alysrazor — +31 Intellect",
    defaultOn: false,
    stats: { intellect: 31 },
  },
  {
    // Spell 572790. Not on Kadd before Kaldros kill in the Aug 23 log.
    key: "greaterGrimMandate",
    label: "Greater Grim Mandate — +74 Spell Power",
    defaultOn: false,
    stats: { spellPower: 74 },
  },
  {
    // Spell 561387. Active on Kadd at Kaldros pull.
    key: "greaterWhispersOfNzoth",
    label: "Greater Whispers of N'zoth — +10% primary stats",
    note: "Int, Spirit, Str, Agi, Stamina · 30 min party/raid buff",
    defaultOn: false,
    stats: {},
    statScalePct: 10,
    statScaleKeys: ["strength", "agility", "intellect", "spirit", "stamina"],
  },
  {
    // Spell 680310. Refreshed on Kadd ~12:40 during the Kaldros pull.
    key: "greaterPrimalInstinct",
    label: "Greater Primal Instinct — +232 Attack Power",
    note: "30 min; no Infernal spell scaling",
    defaultOn: false,
    stats: { attackPower: 232 },
  },
  {
    key: "berserkerAura",
    label: "Berserker Aura — +60 Frost Resistance",
    note: "The Barbarian also gains +5% attack power",
    defaultOn: false,
    stats: {},
  },
  {
    key: "legionfelPact",
    label: "Legionfel Pact — +52.8 Fire Resistance",
    note: "Also +15% chance to resist curses and magic effects",
    defaultOn: false,
    stats: {},
  },
  {
    key: "greaterChromiesWisdom",
    label: "Greater Chromie's Wisdom — +40 Spirit",
    defaultOn: false,
    stats: { spirit: 40 },
  },
  {
    key: "greaterIllidariIntuition",
    label: "Greater Illidari Intuition — +77 Agility",
    note: "No caster DPS stat effect",
    defaultOn: false,
    stats: {},
  },
];

const PARTY_BUFFS: ToggleDef[] = [
  {
    // Spell 802771 / proc 803287. Kaldros log: 15,738 dmg → ~141 DPS over 112s.
    key: "bloodthistle",
    label: "Bloodthistle — ~141 DPS (Kaldros log)",
    note: "Alchemist party proc; also heals the caster",
    defaultOn: false,
    stats: {},
    procDps: 141,
    procName: "Bloodthistle",
  },
  {
    // Shaman party CD. 15s aura, 1 min CD — AP×0.35 Froststorm on each direct damage hit.
    key: "neptulonsWrath",
    label: "Neptulon's Wrath — AP×0.35 on direct damage",
    note: "15s aura · 1 min CD · Kaldros log ~780 DPS (39 hits / 112s)",
    defaultOn: false,
    stats: {},
  },
  {
    key: "tailwind",
    label: "Tailwind — +5% haste while active",
    hintTitle: "Tailwind",
    hintBody:
      "Grants 5% haste for 15 seconds on a repeating proc cycle modeled at ~80% uptime.\n\nWhile active, haste speeds up cast times and the global cooldown (including Fel Fireball). Combines additively with gear haste and Felheart in combat.",
    defaultOn: false,
    stats: {},
  },
  {
    // Spell 803697. 2s raid area aura; −3% damage taken (defensive).
    key: "frogBones",
    label: "Frog Bones — −3% damage taken (raid)",
    note: "2s alchemist splash; defensive, not included in DPS",
    defaultOn: false,
    stats: {},
  },
];

const HIT_BUFFS: ToggleDef[] = [
  {
    key: "racialSpellHit",
    label: "Racial spell hit",
    note: "+1% spell hit",
    defaultOn: false,
    stats: { spellHit: 1 },
  },
  {
    key: "spellHitDebuff",
    label: "Spell hit debuff on target",
    note: "+3% spell hit",
    defaultOn: false,
    stats: { spellHit: 3 },
  },
];

const ALL_TOGGLES = [...RAID_BUFFS, ...PARTY_BUFFS, ...HIT_BUFFS];

type SelectOption<T extends string> = {
  value: T;
  label: string;
  stats: Partial<ItemStats>;
};

const FLASKS: Array<SelectOption<BuffsConfig["flask"]>> = [
  { value: "none", label: "None", stats: {} },
  {
    value: "manifesting-power",
    label: "Distilled Flask of Manifesting Power (+53 Spell Power, +17 Spirit)",
    stats: { spellPower: 53, spirit: 17 },
  },
  {
    value: "kirin-tor",
    label: `Dilluted Flask of the Kirin Tor (${UNKNOWN_BONUS})`,
    stats: {},
  },
];

const FOODS: Array<SelectOption<BuffsConfig["food"]>> = [
  { value: "none", label: "None", stats: {} },
  { value: "well-fed", label: "Well Fed (+20 Spell Power)", stats: { spellPower: 20 } },
  {
    value: "fused-wizard-wontons",
    label: `Well Fed - Fused Wizard Wontons (${UNKNOWN_BONUS})`,
    stats: {},
  },
];

const SCROLLS: Array<SelectOption<BuffsConfig["scroll"]>> = [
  { value: "none", label: "None", stats: {} },
  { value: "spirit-iv", label: "Scroll of Spirit IV (+18 Spirit)", stats: { spirit: 18 } },
];

const WEAPON_OILS: Array<SelectOption<BuffsConfig["weaponOil"]>> = [
  { value: "none", label: "None", stats: {} },
  {
    value: "brilliant-wizard-oil",
    label: "Brilliant Wizard Oil (+36 Spell Power, +14 crit rating)",
    stats: { spellPower: 36, spellCrit: 14 },
  },
];

const CONSUME_TOGGLES: ToggleDef[] = [
  {
    key: "targetHealthDecays",
    label: "Boss health decay — Fel Cannon / Doomsayer taper",
    hintTitle: "Boss health decay",
    hintBody:
      "Simulates the boss losing health over the fight. Target HP falls linearly from 100% to 0% based on elapsed time and fight length.\n\nExample: at half the duration, the target is at 50% health.\n\nFel Cannon and Doomsayer only apply while health is above 75% (~first 25% of the fight).\n\nUncheck to keep the target at 100% like a training dummy.",
    defaultOn: false,
    stats: {},
  },
];

const POTIONS: Array<SelectOption<BuffsConfig["potion"]>> = [
  { value: "none", label: "None", stats: {} },
  {
    value: "in-fight",
    label: "Potion of Spell Power (+75 SP, one during the fight)",
    stats: { spellPower: 75 },
  },
  {
    value: "prepot-and-second",
    label: "Potion of Spell Power (+75 SP, pre-pot + second at 1:00)",
    stats: { spellPower: 75 },
  },
];

export const DEFAULT_BUFFS: BuffsConfig = {
  ...(Object.fromEntries(ALL_TOGGLES.map((def) => [def.key, def.defaultOn])) as Record<BooleanBuffKey, boolean>),
  ...(Object.fromEntries(CONSUME_TOGGLES.map((def) => [def.key, def.defaultOn])) as Record<
    BooleanBuffKey,
    boolean
  >),
  flask: "none",
  food: "none",
  scroll: "none",
  weaponOil: "none",
  offhandWeaponOil: "none",
  potion: "none",
};

export function setupBuffs(onChange: () => void, saved?: Partial<BuffsConfig>): BuffsConfig {
  const config = mergeBuffs(DEFAULT_BUFFS, saved);
  const root = document.getElementById("buffs-controls");
  if (!root) return config;

  root.innerHTML = renderControls(config);

  root.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-buff]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.buff as BooleanBuffKey;
      (config as unknown as Record<string, boolean>)[key] = input.checked;
      onChange();
    });
  });
  root.querySelectorAll<HTMLSelectElement>("select[data-buff]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.buff as keyof BuffsConfig;
      (config as unknown as Record<string, string>)[key] = select.value;
      onChange();
    });
  });
  bindHintTooltips(root);
  return config;
}

export function percentBuffs(config: BuffsConfig, selection?: TalentSelection): ItemStats {
  let stats = emptyStats();
  for (const def of ALL_TOGGLES) {
    if (!config[def.key]) continue;
    let bonus = { ...emptyStats(), ...def.stats };
    if (def.key === "greaterManariIntuition" || def.key === "greaterIllidariIntuition") {
      bonus = scaleIntuitionStats(bonus, selection);
    }
    if (def.key === "demonfirePact") bonus = scalePactStats(bonus, selection);
    stats = addStats(stats, bonus);
  }
  return stats;
}

export function ratingConsumes(config: BuffsConfig, gear: GearSet = {}): ItemStats {
  const oil = consumeOilStats(config, gear);
  return {
    ...emptyStats(),
    spellCrit: oil.spellCrit,
    spellHit: oil.spellHit,
    spellHaste: oil.spellHaste,
  };
}

export function statsFromBuffs(
  config: BuffsConfig,
  _gearStats: ItemStats,
  _durationSec: number,
  gear: GearSet = {},
  selection?: TalentSelection,
): ItemStats {
  let consumes = emptyStats();
  consumes = addStats(consumes, optionStats(FLASKS, config.flask));
  consumes = addStats(consumes, optionStats(FOODS, config.food));
  consumes = addStats(consumes, optionStats(SCROLLS, config.scroll));
  const oil = consumeOilStats(config, gear);
  consumes = addStats(consumes, { ...oil, spellCrit: 0, spellHit: 0, spellHaste: 0 });
  return addStats(addStats(percentBuffs(config, selection), consumes), ratingsToPercent(ratingConsumes(config, gear)));
}

export function procContributionsFromBuffs(config: BuffsConfig): Array<{ name: string; dps: number }> {
  const out: Array<{ name: string; dps: number }> = [];
  for (const def of ALL_TOGGLES) {
    if (!config[def.key] || !def.procDps) continue;
    out.push({ name: def.procName ?? def.label.split(" — ")[0] ?? def.key, dps: def.procDps });
  }
  return out;
}

/** Combat-modeled party buffs shown in sim result details. */
export function activeCombatBuffLabels(config: BuffsConfig): string[] {
  const labels: string[] = [];
  if (config.tailwind) labels.push("Tailwind (+5% haste, ~80% uptime)");
  if (config.neptulonsWrath) labels.push("Neptulon's Wrath");
  if (config.bloodthistle) labels.push("Bloodthistle (~141 DPS proc)");
  return labels;
}

/** Primary-stat percent buffs (Whispers of N'zoth) apply after flat gear and consume bonuses. */
export function applyStatScaleBuffs(stats: CharacterStats, config: BuffsConfig): CharacterStats {
  let scaled: CharacterStats = stats;
  for (const def of ALL_TOGGLES) {
    if (!config[def.key] || !def.statScalePct || !def.statScaleKeys?.length) continue;
    scaled = { ...scaled, ...scalePrimaryStats(scaled, 1 + def.statScalePct / 100) };
  }
  return scaled;
}

export function syncOffhandOilField(gear: GearSet) {
  const field = document.getElementById("offhand-oil-field");
  const select = field?.querySelector("select");
  if (!field || !select) return;
  const available = offhandAcceptsOil(gear);
  select.toggleAttribute("disabled", !available);
  field.classList.toggle("is-disabled", !available);
  field.title = available ? "" : "Equip a one-handed weapon in Off Hand to apply a second oil.";
}

function mergeBuffs(base: BuffsConfig, saved?: Partial<BuffsConfig>): BuffsConfig {
  const config = { ...base };
  if (!saved) return config;
  for (const def of [...ALL_TOGGLES, ...CONSUME_TOGGLES]) {
    const value = saved[def.key];
    if (typeof value === "boolean") config[def.key] = value;
  }
  if (hasOption(FLASKS, saved.flask)) config.flask = saved.flask;
  if (hasOption(FOODS, saved.food)) config.food = saved.food;
  if (hasOption(SCROLLS, saved.scroll)) config.scroll = saved.scroll;
  if (hasOption(WEAPON_OILS, saved.weaponOil)) config.weaponOil = saved.weaponOil;
  if (hasOption(WEAPON_OILS, saved.offhandWeaponOil)) config.offhandWeaponOil = saved.offhandWeaponOil;
  if (hasOption(POTIONS, saved.potion)) config.potion = saved.potion;
  else config.potion = migratePotion(saved);
  return config;
}

type LegacyBuffs = Partial<BuffsConfig> & {
  potion?: string;
  potionMode?: string;
};

function migratePotion(saved?: LegacyBuffs): BuffsConfig["potion"] {
  if (saved?.potion === "none") return "none";
  if (saved?.potion === "in-fight" || saved?.potion === "prepot-and-second") return saved.potion;
  if (saved?.potion === "spell-power") {
    if (saved.potionMode === "prepot-and-second" || saved.potionMode === "prepot") return "prepot-and-second";
    return "in-fight";
  }
  return DEFAULT_BUFFS.potion;
}

function consumeOilStats(config: BuffsConfig, gear: GearSet): ItemStats {
  let oil = optionStats(WEAPON_OILS, config.weaponOil);
  if (offhandAcceptsOil(gear)) oil = addStats(oil, optionStats(WEAPON_OILS, config.offhandWeaponOil));
  return oil;
}

function hasOption<T extends string>(options: Array<SelectOption<T>>, value: string | undefined): value is T {
  return !!value && options.some((option) => option.value === value);
}

function optionStats<T extends string>(options: Array<SelectOption<T>>, value: T): ItemStats {
  const option = options.find((o) => o.value === value);
  return { ...emptyStats(), ...(option?.stats ?? {}) };
}

function renderControls(config: BuffsConfig): string {
  return [
    fieldset("Raid buffs", "buff-raid", RAID_BUFFS.map((def) => checkbox(def, config)).join("")),
    fieldset("Other Buffs", "buff-party", PARTY_BUFFS.map((def) => checkbox(def, config)).join("")),
    fieldset(
      "Spell hit",
      "buff-hit",
      `${HIT_BUFFS.map((def) => checkbox(def, config)).join("")}<p class="hint">${SPELL_HIT_CAP}% cap vs +3. ${SPELL_HIT_RATING_PER_PERCENT} hit / ${SPELL_CRIT_RATING_PER_PERCENT} crit rating = 1%.</p>`,
    ),
    fieldset(
      "Consumes",
      "buff-consumes",
      `<div class="consume-grid">${[
        `<label class="consume-field" title="6 if you walked in with Felfury from trash. 0 if the pull starts empty.">Felfury at pull<input id="pull-felfury" type="number" value="0" min="0" max="6" /></label>`,
        select("Flask", "flask", FLASKS, config.flask),
        select("Food", "food", FOODS, config.food),
        select("Main-hand oil", "weaponOil", WEAPON_OILS, config.weaponOil),
        select("Scroll", "scroll", SCROLLS, config.scroll),
        select("Off-hand oil", "offhandWeaponOil", WEAPON_OILS, config.offhandWeaponOil, "offhand-oil-field"),
        select("Potion", "potion", POTIONS, config.potion),
      ].join("")}</div>${CONSUME_TOGGLES.map((def) => checkbox(def, config)).join("")}`,
    ),
  ].join("");
}

function fieldset(legend: string, className: string, body: string): string {
  return `<fieldset class="${className}"><legend>${escapeHtml(legend)}</legend>${body}</fieldset>`;
}

function checkbox(def: ToggleDef, config: BuffsConfig): string {
  const checked = config[def.key] ? " checked" : "";
  const body = def.hintBody ?? def.note;
  const hasHint = Boolean(body || def.hintTitle);
  const hintClass = hasHint ? " check-option--hint" : "";
  const hintAttrs = hasHint
    ? ` data-hint-title="${escapeAttr(def.hintTitle ?? def.label.split(" — ")[0] ?? def.key)}" data-hint-body="${escapeAttr(body ?? "")}"`
    : "";
  return (
    `<label class="check-option${hintClass}"${hintAttrs}><input type="checkbox" data-buff="${def.key}"${checked} /> ` +
    `<span>${escapeHtml(def.label)}</span></label>`
  );
}

function select<T extends string>(
  label: string,
  key: keyof BuffsConfig,
  options: Array<SelectOption<T>>,
  value: T,
  fieldId?: string,
): string {
  const body = options
    .map((o) => `<option value="${o.value}"${o.value === value ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
  const id = fieldId ? ` id="${fieldId}"` : "";
  return `<label class="consume-field"${id}>${escapeHtml(label)}<select data-buff="${String(key)}">${body}</select></label>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "&#10;");
}
