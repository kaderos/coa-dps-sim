import type { BuffsConfig, GearSet, ItemStats } from "./types";
import {
  addStats,
  emptyStats,
  offhandAcceptsOil,
  ratingsToPercent,
  SPELL_CRIT_RATING_PER_PERCENT,
  SPELL_HIT_CAP,
  SPELL_HIT_RATING_PER_PERCENT,
} from "./sim/stats";
import { scaleIntuitionStats, scalePactStats } from "./talents/felsworn";

type BooleanBuffKey = {
  [K in keyof BuffsConfig]: BuffsConfig[K] extends boolean ? K : never;
}[keyof BuffsConfig];

type ToggleDef = {
  key: BooleanBuffKey;
  label: string;
  note?: string;
  defaultOn: boolean;
  stats: Partial<ItemStats>;
};

const UNKNOWN_BONUS = "bonus unknown";

// Buff values come from CoA spell tooltips. Effects outside ItemStats (resists,
// armor, agility, and reactive damage) remain informational and do not change DPS.
const RAID_BUFFS: ToggleDef[] = [
  {
    key: "demonfirePact",
    label: "Demonfire Pact — +3% critical strike chance (4.5% with Pact Hunter)",
    note: "Also +5% damage against Demons",
    defaultOn: true,
    stats: { spellCrit: 3 },
  },
  {
    key: "greaterManariIntuition",
    label: "Greater Man'ari Intuition — +12 all primary stats (14.4 with Dark Teachings)",
    note: "Also +285 armor",
    defaultOn: true,
    stats: { intellect: 12, stamina: 12 },
  },
  {
    key: "greaterBloodthorns",
    label: "Greater Bloodthorns — 21 Shadow damage to attackers",
    note: "Reactive damage; not included in player DPS",
    defaultOn: true,
    stats: {},
  },
  {
    key: "greaterSanguinaryOffering",
    label: "Greater Sanguinary Offering — +54 Stamina",
    defaultOn: true,
    stats: { stamina: 54 },
  },
  {
    key: "greaterSealOfAlysrazor",
    label: "Greater Seal of Alysrazor — +31 Intellect",
    defaultOn: true,
    stats: { intellect: 31 },
  },
  {
    // Greater Grim Mandate was skipped as a world-buff-style aura when the
    // raid list was built from Kadd logs. Related family aura in those logs:
    // Whispers of the Pit (805235), negligible combat uptime — default off.
    key: "greaterGrimMandate",
    label: "Greater Grim Mandate — +74 Spell Power",
    defaultOn: false,
    stats: { spellPower: 74 },
  },
  {
    key: "berserkerAura",
    label: "Berserker Aura — +60 Frost Resistance",
    note: "The Barbarian also gains +5% attack power",
    defaultOn: true,
    stats: {},
  },
  {
    key: "legionfelPact",
    label: "Legionfel Pact — +52.8 Fire Resistance",
    note: "Also +15% chance to resist curses and magic effects",
    defaultOn: true,
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

const HIT_BUFFS: ToggleDef[] = [
  {
    key: "racialSpellHit",
    label: "Racial spell hit",
    note: "+1% spell hit",
    defaultOn: true,
    stats: { spellHit: 1 },
  },
  {
    key: "spellHitDebuff",
    label: "Spell hit debuff on target",
    note: "+3% spell hit",
    defaultOn: true,
    stats: { spellHit: 3 },
  },
];

const ALL_TOGGLES = [...RAID_BUFFS, ...HIT_BUFFS];

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

const WEAPON_OILS: Array<SelectOption<BuffsConfig["weaponOil"]>> = [
  { value: "none", label: "None", stats: {} },
  {
    value: "brilliant-wizard-oil",
    label: "Brilliant Wizard Oil (+36 Spell Power, +14 crit rating)",
    stats: { spellPower: 36, spellCrit: 14 },
  },
];

const POTIONS: Array<SelectOption<BuffsConfig["potion"]>> = [
  { value: "none", label: "None", stats: {} },
  {
    value: "spell-power",
    label: "Potion of Spell Power (+75 Spell Power for 20 sec)",
    stats: { spellPower: 75 },
  },
];

export const DEFAULT_BUFFS: BuffsConfig = {
  ...(Object.fromEntries(ALL_TOGGLES.map((def) => [def.key, def.defaultOn])) as Record<BooleanBuffKey, boolean>),
  flask: "none",
  food: "none",
  weaponOil: "none",
  offhandWeaponOil: "none",
  potion: "spell-power",
  potionMode: "in-fight",
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
  return config;
}

export function percentBuffs(config: BuffsConfig): ItemStats {
  let stats = emptyStats();
  for (const def of ALL_TOGGLES) {
    if (!config[def.key]) continue;
    let bonus = { ...emptyStats(), ...def.stats };
    if (def.key === "greaterManariIntuition" || def.key === "greaterIllidariIntuition") {
      bonus = scaleIntuitionStats(bonus);
    }
    if (def.key === "demonfirePact") bonus = scalePactStats(bonus);
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

export function statsFromBuffs(config: BuffsConfig, _gearStats: ItemStats, _durationSec: number, gear: GearSet = {}): ItemStats {
  let consumes = emptyStats();
  consumes = addStats(consumes, optionStats(FLASKS, config.flask));
  consumes = addStats(consumes, optionStats(FOODS, config.food));
  const oil = consumeOilStats(config, gear);
  consumes = addStats(consumes, { ...oil, spellCrit: 0, spellHit: 0, spellHaste: 0 });
  return addStats(addStats(percentBuffs(config), consumes), ratingsToPercent(ratingConsumes(config, gear)));
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
  for (const def of ALL_TOGGLES) {
    const value = saved[def.key];
    if (typeof value === "boolean") config[def.key] = value;
  }
  if (hasOption(FLASKS, saved.flask)) config.flask = saved.flask;
  if (hasOption(FOODS, saved.food)) config.food = saved.food;
  if (hasOption(WEAPON_OILS, saved.weaponOil)) config.weaponOil = saved.weaponOil;
  if (hasOption(WEAPON_OILS, saved.offhandWeaponOil)) config.offhandWeaponOil = saved.offhandWeaponOil;
  if (hasOption(POTIONS, saved.potion)) config.potion = saved.potion;
  config.potionMode = migratePotionMode(saved.potionMode);
  return config;
}

function migratePotionMode(value: string | undefined): BuffsConfig["potionMode"] {
  if (value === "prepot-and-second" || value === "prepot") return "prepot-and-second";
  return "in-fight";
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
        select("Off-hand oil", "offhandWeaponOil", WEAPON_OILS, config.offhandWeaponOil, "offhand-oil-field"),
        select("Potion", "potion", POTIONS, config.potion),
        select(
          "Potion usage",
          "potionMode",
          [
            { value: "in-fight", label: "One potion during the fight", stats: {} },
            { value: "prepot-and-second", label: "Pre-pot and a second potion at 1:00", stats: {} },
          ] as Array<SelectOption<BuffsConfig["potionMode"]>>,
          config.potionMode,
        ),
      ].join("")}</div>`,
    ),
  ].join("");
}

function fieldset(legend: string, className: string, body: string): string {
  return `<fieldset class="${className}"><legend>${escapeHtml(legend)}</legend>${body}</fieldset>`;
}

function checkbox(def: ToggleDef, config: BuffsConfig): string {
  const title = def.note ? ` title="${escapeHtml(def.note)}"` : "";
  const checked = config[def.key] ? " checked" : "";
  return (
    `<label class="check-option"${title}><input type="checkbox" data-buff="${def.key}"${checked} /> ` +
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
