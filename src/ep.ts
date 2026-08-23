import type { Item, ItemStats } from "./types";

export type StatWeights = Record<keyof ItemStats, number>;

// Extracted from the Bisbeard dump (cgp_coa_weights → Felsworn-Infernal).
// Stats the export does not weight (stamina, hit, mp5) start at 0; hit is left
// to the user because the 17% cap makes its value all-or-nothing.
export const DEFAULT_STAT_WEIGHTS: Readonly<StatWeights> = {
  intellect: 0.414,
  spirit: 0.517,
  stamina: 0,
  spellPower: 1,
  firePower: 1,
  shadowPower: 1,
  attackPower: 0,
  spellCrit: 1.242,
  spellHit: 0,
  spellHaste: 0.6,
  mp5: 0,
};

export const STAT_WEIGHT_ORDER: Array<[keyof StatWeights, string]> = [
  ["spellPower", "Spell Power"],
  ["firePower", "Fire Spell Power"],
  ["shadowPower", "Shadow Spell Power"],
  ["attackPower", "Attack Power"],
  ["spellCrit", "Spell Crit Rating"],
  ["spellHaste", "Spell Haste Rating"],
  ["spellHit", "Spell Hit Rating"],
  ["intellect", "Intellect"],
  ["spirit", "Spirit"],
  ["stamina", "Stamina"],
  ["mp5", "Mana per 5 sec"],
];

const STORAGE_KEY = "coa-sim.statWeights.v1";

export function defaultStatWeights(): StatWeights {
  return { ...DEFAULT_STAT_WEIGHTS };
}

export function loadStatWeights(): StatWeights {
  const weights = defaultStatWeights();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<StatWeights> | null;
    if (!saved) return weights;
    for (const key of Object.keys(weights) as Array<keyof StatWeights>) {
      const value = Number(saved[key]);
      if (Number.isFinite(value)) weights[key] = value;
    }
  } catch {
    // Corrupt or unavailable storage just falls back to the defaults.
  }
  return weights;
}

export function saveStatWeights(weights: StatWeights) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
  } catch {
    // Editing still works in memory when storage is blocked.
  }
}

export function statsEp(stats: Partial<ItemStats> | null | undefined, weights: StatWeights): number {
  if (!stats) return 0;
  let total = 0;
  for (const key of Object.keys(weights) as Array<keyof StatWeights>) {
    total += (Number(stats[key]) || 0) * (Number(weights[key]) || 0);
  }
  return total;
}

export function itemEp(item: Item, weights: StatWeights): number {
  return statsEp(item.stats, weights);
}

export function formatEp(value: number): string {
  return `${value.toFixed(1)} EP`;
}
