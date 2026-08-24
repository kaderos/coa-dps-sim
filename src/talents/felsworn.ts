import type { CharacterStats, ItemStats } from "../types";
import { isTalentEnabled } from "./baseline";
import type { TalentSelection } from "./types";

export const FELSWORN = {
  crueltyCrit: 4,
  demonbornEnergyRegen: 0.3,
  focusedHatredEnergy: 5,
  felwrackedFireballs: 3,
  felwrackedWindow: 15,
  embracingEvilBane: 0.2,
  felheartHastePerFelfury: 0.01,
  demonicEmbraceEnergy: 50,
  demonicEmbraceFelfury: 6,
  darkTeachings: 1.2,
  /** +1% crit on top of Demonfire Pact's 3% (observed in-game, not +1.5%). */
  pactHunterCritBonus: 1,
  elementalBaneCritDamage: 0.1,
  felCommunionEnergy: 30,
  chaoticChance: 0.08,
  chaoticDamage: 0.03,
  chaoticDuration: 8,
  chaoticStacks: 3,
  baseEnergyRegen: 10,
  /** Player-stated cooldown. Shadow Magi is already included in this 45s. */
  annihilationCd: 45,
  annihilationDuration: 12,
  annihilationCrits: 5,
  reckoningCd: 120,
  reckoningDuration: 10,
  reckoningBuffDuration: 15,
  reckoningBuffDamage: 0.04,
  reckoningBuffStacks: 4,
  /** Base Skull CD. Gul'dan's Gift makes this 1.5 minutes. */
  skullCd: 60,
  skullDuration: 10,
  skullEnergy: 0.25,
  guldansGift: 0.5,
  bloodOfMannorothCd: 180,
  bloodOfMannorothFelfury: 6,
  bloodOfMannorothRegen: 1,
  bloodOfMannorothRegenDuration: 20,
};

/** Naked level 60 Felsworn primary stats (before gear). */
export const FELSWORN_BASE_STATS: Readonly<ItemStats> = {
  strength: 70,
  agility: 100,
  intellect: 72,
  spirit: 72,
  stamina: 115,
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

export function felswornBaseStats(): ItemStats {
  return { ...FELSWORN_BASE_STATS };
}

export function applyFelswornPassives(stats: CharacterStats, selection?: TalentSelection): CharacterStats {
  let spellCrit = stats.spellCrit;
  let energyMax = stats.energyMax;
  if (!selection || isTalentEnabled(selection, "felsworn", "Cruelty")) {
    spellCrit += FELSWORN.crueltyCrit;
  }
  if (!selection || isTalentEnabled(selection, "felsworn", "Fel Communion")) {
    energyMax += FELSWORN.felCommunionEnergy;
  }
  return {
    ...stats,
    spellCrit,
    energyMax,
    energy: energyMax,
  };
}

export function skullEnergyBonus() {
  return FELSWORN.skullEnergy * (1 + FELSWORN.guldansGift);
}

export function skullCooldown() {
  return FELSWORN.skullCd * (1 + FELSWORN.guldansGift);
}

export function energyRegenPerSecond(bloodRegen = false) {
  const base = FELSWORN.baseEnergyRegen * (1 + FELSWORN.demonbornEnergyRegen);
  return bloodRegen ? base * (1 + FELSWORN.bloodOfMannorothRegen) : base;
}

export function baneEnergyCost(base: number) {
  return base * (1 - FELSWORN.embracingEvilBane);
}

export function baneDuration(base: number) {
  return base * (1 + FELSWORN.embracingEvilBane);
}

export function felheartHaste(felfury: number) {
  return Math.floor(Math.max(0, felfury)) * FELSWORN.felheartHastePerFelfury;
}

export function scaleIntuitionStats(stats: ItemStats, selection?: TalentSelection): ItemStats {
  if (selection && !isTalentEnabled(selection, "felsworn", "Dark Teachings")) return stats;
  return scalePartial(stats, FELSWORN.darkTeachings);
}

/** Demonfire Pact is 3% crit; Pact Hunter adds +1% (→ 4%), matching in-game. */
export function demonfirePactCrit(base = 3, selection?: TalentSelection): number {
  if (selection && isTalentEnabled(selection, "felsworn", "Pact Hunter")) {
    return base + FELSWORN.pactHunterCritBonus;
  }
  return base;
}

export function scalePactStats(stats: ItemStats, selection?: TalentSelection): ItemStats {
  if (!stats.spellCrit) return stats;
  return { ...stats, spellCrit: demonfirePactCrit(stats.spellCrit, selection) };
}

function scalePartial(stats: ItemStats, factor: number): ItemStats {
  const out = { ...stats };
  for (const key of ["strength", "agility", "intellect", "spirit", "stamina"] as const) {
    const value = out[key];
    if (value) out[key] = Math.floor(value * factor);
  }
  return out;
}
