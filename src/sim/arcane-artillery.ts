import type { EnchantSet, GearSet } from "../types";
import { enchantFitsSlot } from "./stats";
import type { Rng } from "./rng";

/** Bisbeard / ingested weapon enchant id (Arcane Artillery II — +80 SP proc). */
export const ARCANE_ARTILLERY_ENCHANT_ID = 96869812;

export const ARCANE_ARTILLERY = {
  name: "Arcane Artillery",
  spellPower: 80,
  duration: 15,
  /** High Risk Weapons Enchant shared internal cooldown (spell 985813). */
  icd: 19,
  /**
   * Success chance for the single roll allowed each ICD window (~19s).
   * Uptime ≈ procChance × (15s buff / 19s ICD) ≈ 63% at 0.80.
   */
  procChance: 0.8,
} as const;

const WEAPON_SLOTS = ["mainhand", "offhand"] as const;

export function arcaneArtilleryEquipped(gear: GearSet, enchants: EnchantSet): boolean {
  for (const slot of WEAPON_SLOTS) {
    const enchant = enchants[slot];
    if (!enchant) continue;
    const item = gear[slot] ?? null;
    if (!enchantFitsSlot(enchant, slot, item, gear.mainhand ?? null)) continue;
    if (enchant.id === ARCANE_ARTILLERY_ENCHANT_ID || /arcane artillery/i.test(enchant.name)) {
      return true;
    }
  }
  return false;
}

export type ArcaneArtilleryState = {
  arcaneArtilleryEnabled: boolean;
  arcaneArtillery: { remain: number; stacks: number } | null;
  /** Shared weapon-proc ICD pool (High Risk Weapons Enchant). */
  weaponProcIcdReadyAt: number;
};

export function arcaneArtillerySpellPower(state: ArcaneArtilleryState): number {
  return state.arcaneArtillery ? ARCANE_ARTILLERY.spellPower : 0;
}

/** Called once per player spell cast (matches tooltip: spell casts / attacks). */
export function tryArcaneArtilleryProc(state: ArcaneArtilleryState & { time: number }, rng: Rng): void {
  if (!state.arcaneArtilleryEnabled) return;
  if (state.time < state.weaponProcIcdReadyAt) return;

  // One roll per ICD window on the first eligible cast; extra casts while waiting do not re-roll.
  state.weaponProcIcdReadyAt = state.time + ARCANE_ARTILLERY.icd;
  if (!rng.chance(ARCANE_ARTILLERY.procChance)) return;
  state.arcaneArtillery = { remain: ARCANE_ARTILLERY.duration, stacks: 1 };
}
