import type { CharacterStats, SpellFit } from "../types";
import type { DamageContext } from "../sim/spells";
import { SPELL_CRIT_RATING_PER_PERCENT } from "../sim/stats";
import { isTalentEnabled } from "./baseline";
import { FELSWORN } from "./felsworn";
import type { TalentSelection } from "./types";

export { SPELL_CRIT_RATING_PER_PERCENT };

export const INFERNAL = {
  wrathMagicDamage: 0.06,
  wrathSpellHit: 4,
  hiddenPowerFromPrimary: 0.15,
  hiddenPowerInnerSpirit: 0.2,
  netherSpiritToCritRating: 0.2,
  felInfusionPersonalCrit: 6,
  manariCritMultiplier: 2.5,
  prodigyFireball: 0.15,
  darkMagicianEnergy: 20,
  blackMagicRuin: 0.2,
  blackMagicChaos: 0.2,
  adeptSmiteCrit: 0.2,
  felCannonCrit: 0.2,
  /** Execute-phase uptime assumed for Fel Cannon crit on stationary fights. */
  felCannonUptime: 0.75,
  doomsayerSmiteDamage: 0.25,
  doomsayerSmiteRefund: 1,
  illidariSmiterFelfury: 1,
  illidariMagiChance: 0.2,
  felforgedChance: 0.15,
  felforgedDuration: 8,
  felforgedCharges: 3,
  felforgedCastReduction: 0.3,
  sculptorCrits: 3,
  sculptorWindow: 8,
  felshockInnerExtend: 1,
  felshockHit: 3,
  felshockDuration: 12,
  archimondeCritPerTenEnergy: 0.01,
  maliceChance: 0.6,
  maliceEnergy: 5,
  maliceCrit: 0.1,
  maliceDuration: 5,
  ruinDotFraction: 0.3,
  ruinDotDuration: 3,
  executeHealth: 0.75,
  innerDemonSecPerFelfury: 5,
};

export function innerDemonDuration(felfury: number) {
  const consumed = Math.min(6, Math.max(0, Math.floor(felfury)));
  return consumed * INFERNAL.innerDemonSecPerFelfury;
}

const FIREBALL = 501288;
const RUIN = 501298;
const SMITE = 501321;
const CHAOS = 802676;

export function isFireball(spell: SpellFit) {
  return spell.id === FIREBALL;
}

export function isRuin(spell: SpellFit) {
  return spell.id === RUIN;
}

export function isSmite(spell: SpellFit) {
  return spell.id === SMITE;
}

export function isChaos(spell: SpellFit) {
  return spell.id === CHAOS;
}

export function isFelfurySpender(spell: SpellFit) {
  return spell.id === RUIN || spell.id === SMITE;
}

export function fireballEnergyCost(base: number) {
  return base * (1 - INFERNAL.prodigyFireball);
}

export function fireballCastTime(base: number, haste: number, felforged: boolean) {
  let time = (base || 0) * (1 - INFERNAL.prodigyFireball);
  if (felforged) time *= 1 - INFERNAL.felforgedCastReduction;
  return time / haste;
}

export function critFromSpiritRating(spirit: number, fraction: number) {
  return (fraction * Math.max(0, spirit)) / SPELL_CRIT_RATING_PER_PERCENT;
}

export function applyInfernalPassives(stats: CharacterStats, selection?: TalentSelection): CharacterStats {
  let spellHit = stats.spellHit;
  let spellCrit = stats.spellCrit;
  if (!selection || isTalentEnabled(selection, "infernal", "Wrath of Sargeras")) {
    spellHit += INFERNAL.wrathSpellHit;
  }
  if (!selection || isTalentEnabled(selection, "infernal", "Fel Infusion")) {
    spellCrit += INFERNAL.felInfusionPersonalCrit;
  }
  if (!selection || isTalentEnabled(selection, "infernal", "Nether Spirit")) {
    spellCrit += critFromSpiritRating(stats.spirit, INFERNAL.netherSpiritToCritRating);
  }
  const hiddenPower =
    !selection || isTalentEnabled(selection, "infernal", "Hidden Power")
      ? INFERNAL.hiddenPowerFromPrimary
      : 0;
  return {
    ...stats,
    spellHit,
    spellCrit,
    hiddenPower,
  };
}

export type InfernalAuras = {
  innerDemon: boolean;
  baneOfFire: boolean;
  maliceCritRemain: number;
  felshockHitRemain: number;
  energy: number;
  chaoticStacks: number;
  reckoningStacks: number;
  guaranteedCrit: boolean;
  potionSpellPower: number;
  /** Training dummy does not lose health. */
  targetHealth: number;
  setDamageAbove75?: number;
};

export function infernalContext(spell: SpellFit, stats: CharacterStats, auras: InfernalAuras): DamageContext {
  const execute = auras.targetHealth > INFERNAL.executeHealth;
  const fire = (spell.school ?? "fire") === "fire";
  let extraCrit = 0;
  let damageDone = 1 + INFERNAL.wrathMagicDamage;
  if (auras.innerDemon) damageDone *= 1.1;
  if (auras.baneOfFire) {
    if (fire) extraCrit += 0.2;
  }
  if (isSmite(spell)) extraCrit += INFERNAL.adeptSmiteCrit;
  if (isFireball(spell) || isRuin(spell)) {
    extraCrit += INFERNAL.felCannonCrit * INFERNAL.felCannonUptime;
  }
  if (isFelfurySpender(spell)) {
    extraCrit += INFERNAL.archimondeCritPerTenEnergy * Math.floor(Math.max(0, auras.energy) / 10);
  }
  if (auras.maliceCritRemain > 0) extraCrit += INFERNAL.maliceCrit;
  if (auras.innerDemon) {
    extraCrit += critFromSpiritRating(stats.spirit, INFERNAL.hiddenPowerInnerSpirit) / 100;
  }
  if (isRuin(spell)) damageDone *= 1 + INFERNAL.blackMagicRuin;
  if (isChaos(spell)) damageDone *= 1 + INFERNAL.blackMagicChaos;
  if (isSmite(spell) && execute) damageDone *= 1 + INFERNAL.doomsayerSmiteDamage;
  if (auras.chaoticStacks > 0) damageDone *= 1 + FELSWORN.chaoticDamage * auras.chaoticStacks;
  if (auras.reckoningStacks > 0) damageDone *= 1 + FELSWORN.reckoningBuffDamage * auras.reckoningStacks;
  if ((auras.setDamageAbove75 || 0) > 0 && auras.targetHealth > 0.75) {
    damageDone *= 1 + (auras.setDamageAbove75 || 0);
  }

  return {
    damageTakenFromCaster: auras.baneOfFire ? 1.2 : 1,
    extraCrit,
    damageDone,
    extraSpellPower:
      (auras.innerDemon ? INFERNAL.hiddenPowerInnerSpirit * stats.spirit : 0) + (auras.potionSpellPower || 0),
    extraHit: auras.felshockHitRemain > 0 ? INFERNAL.felshockHit : 0,
    critMultiplier: INFERNAL.manariCritMultiplier + FELSWORN.elementalBaneCritDamage,
    ignoreLogCrit: true,
    guaranteedCrit: auras.guaranteedCrit,
  };
}
