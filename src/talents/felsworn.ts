import type { CharacterStats, ItemStats } from "../types";

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
  pactHunter: 1.5,
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

export function applyFelswornPassives(stats: CharacterStats): CharacterStats {
  const energyMax = stats.energyMax + FELSWORN.felCommunionEnergy;
  return {
    ...stats,
    spellCrit: stats.spellCrit + FELSWORN.crueltyCrit,
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

export function scaleIntuitionStats(stats: ItemStats): ItemStats {
  return scalePartial(stats, FELSWORN.darkTeachings);
}

export function scalePactStats(stats: ItemStats): ItemStats {
  return scalePartial(stats, FELSWORN.pactHunter);
}

function scalePartial(stats: ItemStats, factor: number): ItemStats {
  const out = { ...stats };
  (Object.keys(out) as Array<keyof ItemStats>).forEach((key) => {
    out[key] = stats[key] * factor;
  });
  return out;
}
