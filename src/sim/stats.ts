import type { CharacterStats, EnchantSet, GearSet, Item, ItemStats, Slot } from "../types";
import { setBonusRatings } from "../sets";

const EMPTY_STATS: ItemStats = {
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
  mp5: 0,
};

export const PLAYER_LEVEL = 60;
export const BOSS_LEVEL = 63;
/** Spell miss vs a boss `BOSS_LEVEL - PLAYER_LEVEL` levels above the player. */
export const SPELL_HIT_CAP = 17;
/** CoA rating conversions. Gear hit/crit/haste from Bisbeard are ratings. */
export const SPELL_CRIT_RATING_PER_PERCENT = 14;
export const SPELL_HIT_RATING_PER_PERCENT = 8;
export const SPELL_HASTE_RATING_PER_PERCENT = 10;

export function emptyStats(): ItemStats {
  return { ...EMPTY_STATS };
}

/** `spellHit` is percentage points after rating conversion. Base miss is 17% vs a +3 raid boss. */
export function spellMissChance(spellHitPercent: number, canMiss = true): number {
  if (!canMiss) return 0;
  return Math.max(0, SPELL_HIT_CAP / 100 - Math.max(0, spellHitPercent) / 100);
}

export function addStats(a: ItemStats, b: ItemStats): ItemStats {
  return {
    strength: (a.strength || 0) + (b.strength || 0),
    agility: (a.agility || 0) + (b.agility || 0),
    intellect: a.intellect + b.intellect,
    spirit: a.spirit + b.spirit,
    stamina: a.stamina + b.stamina,
    spellPower: a.spellPower + b.spellPower,
    firePower: a.firePower + b.firePower,
    shadowPower: a.shadowPower + b.shadowPower,
    attackPower: (a.attackPower || 0) + (b.attackPower || 0),
    spellCrit: a.spellCrit + b.spellCrit,
    spellHit: a.spellHit + b.spellHit,
    spellHaste: a.spellHaste + b.spellHaste,
    mp5: a.mp5 + b.mp5,
  };
}

export function ratingsToPercent(stats: ItemStats): ItemStats {
  return {
    ...stats,
    spellCrit: stats.spellCrit / SPELL_CRIT_RATING_PER_PERCENT,
    spellHit: stats.spellHit / SPELL_HIT_RATING_PER_PERCENT,
    spellHaste: stats.spellHaste / SPELL_HASTE_RATING_PER_PERCENT,
  };
}

export function ratingsFromGear(gear: GearSet, enchants: EnchantSet = {}): ItemStats {
  let stats = emptyStats();
  for (const [slot, item] of Object.entries(gear) as Array<[Slot, Item | null | undefined]>) {
    if (!item?.stats) continue;
    if (slot === "offhand" && isTwoHand(gear.mainhand)) continue;
    stats = addStats(stats, item.stats);
  }
  for (const [slot, enchant] of Object.entries(enchants) as Array<[Slot, EnchantSet[Slot]]>) {
    if (!enchant?.stats) continue;
    if (!enchantFitsSlot(enchant, slot, gear[slot] ?? null, gear.mainhand ?? null)) continue;
    stats = addStats(stats, enchant.stats);
  }
  return addStats(stats, setBonusRatings(gear, stats));
}

export function statsFromGear(gear: GearSet, enchants: EnchantSet = {}): ItemStats {
  return ratingsToPercent(ratingsFromGear(gear, enchants));
}

export function effectiveSpellPower(stats: ItemStats, hiddenPower = 0): number {
  const school = Math.max(stats.firePower, stats.shadowPower);
  return stats.spellPower + school + hiddenPower * (stats.intellect + stats.spirit);
}

/** Total Fire spell power (base + fire school + Hidden Power primary stat bonus). */
export function fireSpellPower(stats: ItemStats, hiddenPower = 0, extra = 0): number {
  return stats.spellPower + stats.firePower + hiddenPower * (stats.intellect + stats.spirit) + extra;
}

/** Total Shadow spell power (base + shadow school + Hidden Power primary stat bonus). */
export function shadowSpellPower(stats: ItemStats, hiddenPower = 0, extra = 0): number {
  return stats.spellPower + stats.shadowPower + hiddenPower * (stats.intellect + stats.spirit) + extra;
}

/** Pick FireP or ShaP branch and its coefficient for db.ascension.gg COND formulas. */
export function condSchoolPower(
  stats: ItemStats,
  hiddenPower: number,
  extra: number,
  fireCoeff: number,
  shadowCoeff: number,
): { power: number; coeff: number } {
  const fireP = fireSpellPower(stats, hiddenPower, extra);
  const shaP = shadowSpellPower(stats, hiddenPower, extra);
  if (fireP > shaP) return { power: fireP, coeff: fireCoeff };
  return { power: shaP, coeff: shadowCoeff };
}

export function buildCharacter(
  gear: GearSet,
  hiddenPower = 0,
  bonusStats: ItemStats = emptyStats(),
  pullFelfury = 0,
  enchants: EnchantSet = {},
): CharacterStats {
  const gearStats = addStats(statsFromGear(gear, enchants), bonusStats);
  return {
    ...gearStats,
    energy: 100,
    energyMax: 100,
    felfury: Math.max(0, Math.min(6, Math.floor(pullFelfury))),
    felfuryMax: 6,
    hiddenPower,
  };
}

export function slotCategory(slot: Slot): string {
  if (slot === "finger1" || slot === "finger2") return "finger";
  if (slot === "trinket1" || slot === "trinket2") return "trinket";
  return slot;
}

export function isTwoHand(item: Item | null | undefined): boolean {
  if (!item) return false;
  const equip = String(item.equipSlot || "").toLowerCase();
  const type = String(item.armorType || "").toLowerCase();
  return (
    equip.includes("two-hand") ||
    equip.includes("two hand") ||
    type.includes("two-handed") ||
    type === "staves" ||
    type === "staff"
  );
}

export function offhandAcceptsOil(gear: GearSet): boolean {
  return isOneHandWeapon(gear.offhand) && !isTwoHand(gear.mainhand);
}

export function isOneHandWeapon(item: Item | null | undefined): boolean {
  if (!item || item.slot !== "mainhand") return false;
  if (isTwoHand(item)) return false;
  const equip = String(item.equipSlot || "").toLowerCase();
  if (equip === "main hand" || equip === "mainhand") return false;
  return (
    equip.includes("one-hand") ||
    equip.includes("one hand") ||
    /dagger|one-handed|fist|warglaive/.test(String(item.armorType || "").toLowerCase())
  );
}

export function itemForSlot(item: Item, slot: Slot): boolean {
  const cat = slotCategory(slot);
  if (item.slot === cat || item.slot === slot) return true;
  return slot === "offhand" && isOneHandWeapon(item);
}

export function enchantFitsSlot(
  enchant: { slots: string[]; weapon?: "onehand" | "twohand" | null },
  slot: Slot,
  item: Item | null,
  mainhand: Item | null,
): boolean {
  if (!enchant.slots.includes(slot)) return false;
  if (slot === "offhand" && isTwoHand(mainhand)) return false;
  if (enchant.weapon === "twohand" && !isTwoHand(item)) return false;
  if (enchant.weapon === "onehand" && isTwoHand(item)) return false;
  return true;
}
