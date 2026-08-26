import type { BuffsConfig, CharacterStats, EnchantSet, GearSet, ItemStats, Slot } from "./types";
import { applyStatScaleBuffs, percentBuffs, ratingConsumes, statsFromBuffs } from "./buffs";
import { setSpellCritParts } from "./sets";
import { isTalentEnabled } from "./talents/baseline";
import { applyTakenTalents } from "./talents/taken";
import type { TalentSelection } from "./talents/types";
import {
  buildCharacter,
  displaySpellPower,
  enchantFitsSlot,
  hiddenPowerSpellBonus,
  intellectCritPercent,
  isTwoHand,
  schoolSpellPower,
  SPELL_CRIT_INTELLECT_PER_PERCENT,
  SPELL_CRIT_RATING_PER_PERCENT,
  statsFromGear,
  statsFromGearWithoutSets,
} from "./sim/stats";
import { FELSWORN, FELSWORN_BASE_STATS } from "./talents/felsworn";
import { felInfusionCritPercent, INFERNAL } from "./talents/infernal";

export type StatLayerBreakdown = {
  base: number;
  gear: number;
  enchants: number;
  setBonuses: number;
  buffs: number;
  percentBuffs: number;
  total: number;
};

export type SpellPowerBreakdown = {
  gear: number;
  enchants: number;
  setBonuses: number;
  buffs: number;
  hiddenPowerIntellect: number;
  hiddenPowerSpirit: number;
  total: number;
};

export type SpellCritBreakdown = {
  gear: number;
  enchants: number;
  felInfusion: number;
  cruelty: number;
  intellect: number;
  netherSpirit: number;
  hiddenPowerSpirit: number;
  buffs: number;
  total: number;
};

type PrimaryKey = "intellect" | "spirit";

function pick(stats: ItemStats, key: keyof ItemStats): number {
  return stats[key] || 0;
}

function sumGearItems(gear: GearSet, key: keyof ItemStats): number {
  let total = 0;
  for (const [slot, item] of Object.entries(gear) as Array<[Slot, GearSet[Slot]]>) {
    if (!item?.stats) continue;
    if (slot === "offhand" && isTwoHand(gear.mainhand)) continue;
    total += item.stats[key] || 0;
  }
  return total;
}

function sumGearSchoolSp(gear: GearSet): number {
  let spellPower = 0;
  let firePower = 0;
  let shadowPower = 0;
  for (const [slot, item] of Object.entries(gear) as Array<[Slot, GearSet[Slot]]>) {
    if (!item?.stats) continue;
    if (slot === "offhand" && isTwoHand(gear.mainhand)) continue;
    spellPower += item.stats.spellPower || 0;
    firePower += item.stats.firePower || 0;
    shadowPower += item.stats.shadowPower || 0;
  }
  return spellPower + Math.max(firePower, shadowPower);
}

function sumEnchantSchoolSp(gear: GearSet, enchants: EnchantSet): number {
  let spellPower = 0;
  let firePower = 0;
  let shadowPower = 0;
  for (const [slot, enchant] of Object.entries(enchants) as Array<[Slot, EnchantSet[Slot]]>) {
    if (!enchant?.stats) continue;
    if (!enchantFitsSlot(enchant, slot, gear[slot] ?? null, gear.mainhand ?? null)) continue;
    spellPower += enchant.stats.spellPower || 0;
    firePower += enchant.stats.firePower || 0;
    shadowPower += enchant.stats.shadowPower || 0;
  }
  return spellPower + Math.max(firePower, shadowPower);
}

function sumEnchantCritRating(gear: GearSet, enchants: EnchantSet): number {
  let total = 0;
  for (const [slot, enchant] of Object.entries(enchants) as Array<[Slot, EnchantSet[Slot]]>) {
    if (!enchant?.stats) continue;
    if (!enchantFitsSlot(enchant, slot, gear[slot] ?? null, gear.mainhand ?? null)) continue;
    total += enchant.stats.spellCrit || 0;
  }
  return total;
}

function critPercentFromRating(rating: number): number {
  return rating / SPELL_CRIT_RATING_PER_PERCENT;
}

function spiritCritPercent(spirit: number, fraction: number): number {
  return (fraction * Math.max(0, spirit)) / SPELL_CRIT_RATING_PER_PERCENT;
}

function hasTalent(selection: TalentSelection | undefined, tree: "felsworn" | "infernal", name: string): boolean {
  return !selection || isTalentEnabled(selection, tree, name);
}

export function statLayerBreakdown(
  key: keyof ItemStats,
  gear: GearSet,
  enchants: EnchantSet,
  buffs: BuffsConfig,
  durationSec: number,
  selection?: TalentSelection,
  basePart = 0,
): StatLayerBreakdown {
  const bare = statsFromGearWithoutSets(gear, enchants);
  const withSets = statsFromGear(gear, enchants);
  const buffStats = statsFromBuffs(buffs, withSets, durationSec, gear, selection);
  const beforeScale = buildCharacter(gear, 0, buffStats, 0, enchants);
  const afterScale = applyStatScaleBuffs(beforeScale, buffs);
  const final = applyTakenTalents(afterScale, selection, buffs);

  const gearItems = sumGearItems(gear, key);
  const gearAndEnchants = pick(bare, key) - basePart;
  const unphased =
    key === "spellPenetration" && hasTalent(selection, "infernal", "Unphased")
      ? INFERNAL.unphasedSpellPenetration
      : 0;
  return {
    base: basePart + unphased,
    gear: gearItems,
    enchants: gearAndEnchants - gearItems,
    setBonuses: pick(withSets, key) - pick(bare, key),
    buffs: pick(buffStats, key),
    percentBuffs: pick(afterScale, key) - pick(beforeScale, key),
    total: pick(final, key),
  };
}

export type PrimaryStatBreakdown = StatLayerBreakdown;

export function primaryStatBreakdown(
  key: PrimaryKey,
  gear: GearSet,
  enchants: EnchantSet,
  buffs: BuffsConfig,
  durationSec: number,
  selection?: TalentSelection,
): PrimaryStatBreakdown {
  return statLayerBreakdown(key, gear, enchants, buffs, durationSec, selection, FELSWORN_BASE_STATS[key] || 0);
}

export function spellPowerBreakdown(
  gear: GearSet,
  enchants: EnchantSet,
  buffs: BuffsConfig,
  durationSec: number,
  selection?: TalentSelection,
): SpellPowerBreakdown {
  const bare = statsFromGearWithoutSets(gear, enchants);
  const withSets = statsFromGear(gear, enchants);
  const buffStats = statsFromBuffs(buffs, withSets, durationSec, gear, selection);
  const beforeScale = buildCharacter(gear, 0, buffStats, 0, enchants);
  const final = applyTakenTalents(applyStatScaleBuffs(beforeScale, buffs), selection, buffs);
  const hidden = hiddenPowerSpellBonus(final, final.hiddenPower);
  const setBonuses = schoolSpellPower(withSets) - schoolSpellPower(bare);

  return {
    gear: sumGearSchoolSp(gear) + setBonuses,
    enchants: sumEnchantSchoolSp(gear, enchants),
    setBonuses,
    buffs: schoolSpellPower(buffStats),
    hiddenPowerIntellect: hidden.intellect,
    hiddenPowerSpirit: hidden.spirit,
    total: displaySpellPower(final, final.hiddenPower),
  };
}

export function spellCritBreakdown(
  gear: GearSet,
  enchants: EnchantSet,
  buffs: BuffsConfig,
  stats: Pick<CharacterStats, "intellect" | "spirit">,
  selection?: TalentSelection,
  totalOverride?: number,
): SpellCritBreakdown {
  const consumeRatings = ratingConsumes(buffs, gear);
  const buffPercents = percentBuffs(buffs, selection);
  const setParts = setSpellCritParts(gear, stats as ItemStats);

  const gearPct = critPercentFromRating(sumGearItems(gear, "spellCrit") + setParts.flatRating);
  const enchantsPct = critPercentFromRating(sumEnchantCritRating(gear, enchants) + consumeRatings.spellCrit);
  let intellectPct = intellectCritPercent(stats.intellect) + critPercentFromRating(setParts.fromIntellectRating);
  const felInfusion = hasTalent(selection, "infernal", "Fel Infusion")
    ? felInfusionCritPercent(buffs.demonfirePact !== false)
    : 0;
  const cruelty = hasTalent(selection, "felsworn", "Cruelty") ? FELSWORN.crueltyCrit : 0;
  const netherSpirit = hasTalent(selection, "infernal", "Nether Spirit")
    ? spiritCritPercent(stats.spirit, INFERNAL.netherSpiritToCritRating)
    : 0;
  const hiddenPowerSpirit = hasTalent(selection, "infernal", "Hidden Power")
    ? spiritCritPercent(stats.spirit, INFERNAL.hiddenPowerInnerSpirit)
    : 0;
  const buffsPct = buffPercents.spellCrit;

  const partialWithoutIntellect = gearPct + enchantsPct + felInfusion + cruelty + netherSpirit + hiddenPowerSpirit + buffsPct;
  const total = totalOverride ?? partialWithoutIntellect + intellectPct;

  if (totalOverride != null && Math.abs(partialWithoutIntellect + intellectPct - totalOverride) > 0.02) {
    intellectPct = Math.max(0, totalOverride - partialWithoutIntellect);
  }

  return {
    gear: gearPct,
    enchants: enchantsPct,
    felInfusion,
    cruelty,
    intellect: intellectPct,
    netherSpirit,
    hiddenPowerSpirit,
    buffs: buffsPct,
    total,
  };
}

export type StatHintContent = {
  body: string;
  reminders: string[];
};

function hintRem(text: string): string {
  return text;
}

function hintVal(text: string): string {
  return `<span class="hint-card__value">${escapeHintHtml(text)}</span>`;
}

function escapeHintHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function statLayerHintBody(_title: string, breakdown: StatLayerBreakdown, extras: string[] = []): string {
  const lines = [
    `Base: ${formatLayer(breakdown.base)}`,
    `Gear: ${formatLayer(breakdown.gear)}`,
    `Enchants: ${formatLayer(breakdown.enchants)}`,
    `Set bonuses: ${formatLayer(breakdown.setBonuses)}`,
    `Buffs & consumes: ${formatLayer(breakdown.buffs)}`,
  ];
  if (breakdown.percentBuffs !== 0) {
    lines.push(`Primary stat % buffs: ${formatLayer(breakdown.percentBuffs)}`);
  }
  lines.push(`Total: ${formatLayer(breakdown.total)}`);
  if (extras.length) lines.push(...extras);
  return lines.join("\n\n");
}

export function primaryStatHintBody(
  key: PrimaryKey,
  breakdown: PrimaryStatBreakdown,
  stats: CharacterStats,
  selection?: TalentSelection,
): StatHintContent {
  const reminders: string[] = [];
  if (key === "intellect" && stats.hiddenPower > 0) {
    const hidden = hiddenPowerSpellBonus(stats, stats.hiddenPower);
    reminders.push(
      `${hintRem("Hidden Power adds ")}${hintVal(`${(stats.hiddenPower * 100).toFixed(0)}%`)}${hintRem(" of Intellect to Spell Power ")}${hintVal(`(${formatLayer(hidden.intellect)} SP)`)}${hintRem(", not to this line.")}`,
    );
  }
  if (key === "intellect") {
    const critFromIntellect = intellectCritPercent(stats.intellect);
    reminders.push(
      `${hintVal(`${SPELL_CRIT_INTELLECT_PER_PERCENT} Intellect = 1% spell crit (${formatCrit(critFromIntellect)})`)}${hintRem(", not to this line.")}`,
    );
  }
  if (key === "spirit" && stats.hiddenPower > 0) {
    const hidden = hiddenPowerSpellBonus(stats, stats.hiddenPower);
    reminders.push(
      `${hintRem("Hidden Power adds ")}${hintVal(`${(stats.hiddenPower * 100).toFixed(0)}%`)}${hintRem(" of Spirit to Spell Power ")}${hintVal(`(${formatLayer(hidden.spirit)} SP)`)}${hintRem(", not to this line.")}`,
    );
    const critFromSpirit = spiritCritPercent(stats.spirit, INFERNAL.hiddenPowerInnerSpirit);
    reminders.push(
      `${hintRem("Hidden Power adds ")}${hintVal(`${(INFERNAL.hiddenPowerInnerSpirit * 100).toFixed(0)}%`)}${hintRem(" of Spirit as crit rating ")}${hintVal(`(${formatCrit(critFromSpirit)})`)}${hintRem(", not to this line.")}`,
    );
  }
  if (key === "spirit" && hasTalent(selection, "infernal", "Nether Spirit")) {
    const critFromNether = spiritCritPercent(stats.spirit, INFERNAL.netherSpiritToCritRating);
    reminders.push(
      `${hintRem("Nether Spirit adds ")}${hintVal(`${(INFERNAL.netherSpiritToCritRating * 100).toFixed(0)}%`)}${hintRem(" of Spirit as crit rating ")}${hintVal(`(${formatCrit(critFromNether)})`)}${hintRem(", not to this line.")}`,
    );
  }
  return { body: statLayerHintBody(key, breakdown), reminders };
}

export function spellPowerHintBody(breakdown: SpellPowerBreakdown): StatHintContent {
  const lines = [
    `Gear: ${formatLayer(breakdown.gear)}`,
    `Enchants: ${formatLayer(breakdown.enchants)}`,
    `Hidden Power (Intellect): ${formatLayer(breakdown.hiddenPowerIntellect)}`,
    `Hidden Power (Spirit): ${formatLayer(breakdown.hiddenPowerSpirit)}`,
  ];
  if (breakdown.buffs !== 0) {
    lines.push(`Buffs & consumes: ${formatLayer(breakdown.buffs)}`);
  }
  lines.push(`Total: ${formatLayer(breakdown.total)}`);
  return {
    body: lines.join("\n\n"),
    reminders: ["Gear includes set bonuses."],
  };
}

export function spellCritRatingNote(): string {
  return `${SPELL_CRIT_RATING_PER_PERCENT} crit rating = 1% spell crit. ${SPELL_CRIT_INTELLECT_PER_PERCENT} intellect = 1% spell crit.`;
}

export function spellCritHintBody(breakdown: SpellCritBreakdown, critRating = 0): string {
  const lines: string[] = [];
  if (critRating > 0) {
    lines.push(`Crit Rating: ${formatRating(critRating)}`);
  }
  lines.push(
    `Gear: ${formatCrit(breakdown.gear)}`,
    `Enchants: ${formatCrit(breakdown.enchants)}`,
  );
  if (breakdown.felInfusion) lines.push(`Fel Infusion: ${formatCrit(breakdown.felInfusion)}`);
  if (breakdown.cruelty) lines.push(`Cruelty: ${formatCrit(breakdown.cruelty)}`);
  if (breakdown.intellect) lines.push(`Intellect: ${formatCrit(breakdown.intellect)}`);
  if (breakdown.netherSpirit) lines.push(`Nether Spirit (Spirit): ${formatCrit(breakdown.netherSpirit)}`);
  if (breakdown.hiddenPowerSpirit) lines.push(`Hidden Power (Spirit): ${formatCrit(breakdown.hiddenPowerSpirit)}`);
  if (breakdown.buffs) lines.push(`Buffs & consumes: ${formatCrit(breakdown.buffs)}`);
  lines.push(`Total: ${formatCrit(breakdown.total)}`);
  return lines.join("\n\n");
}

function formatCrit(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatRating(value: number): string {
  return value.toFixed(1);
}

function formatLayer(value: number, signed = false): string {
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : value;
  if (!signed) return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${value >= 0 ? "+" : ""}${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}`;
}
