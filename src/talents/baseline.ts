import type {
  FelswornTalentDoc,
  InfernalTalentDoc,
  TalentEntry,
  TalentSelection,
  TalentTreeId,
  TalentTrees,
} from "./types";

export type { FelswornTalentDoc, InfernalTalentDoc, TalentEntry, TalentSelection, TalentTreeId, TalentTrees };

export function talentKey(tree: TalentTreeId, name: string): string {
  return `${tree}:${name}`;
}

export function defaultTalentSelection(trees: TalentTrees): TalentSelection {
  return {
    felsworn: Object.fromEntries(trees.felsworn.talents.map((talent) => [talent.name, true])),
    infernal: Object.fromEntries(trees.infernal.talents.map((talent) => [talent.name, true])),
  };
}

export function mergeTalentSelection(saved: Partial<TalentSelection> | undefined, trees: TalentTrees): TalentSelection {
  const defaults = defaultTalentSelection(trees);
  return {
    felsworn: { ...defaults.felsworn, ...(saved?.felsworn || {}) },
    infernal: { ...defaults.infernal, ...(saved?.infernal || {}) },
  };
}

export function isTalentEnabled(selection: TalentSelection, tree: TalentTreeId, name: string): boolean {
  const bucket = selection[tree];
  return bucket[name] !== false;
}

export function talentRankLabel(rank: string): string {
  if (rank === "passive") return "Passive";
  return rank;
}

export function talentPoints(rank: string): number | null {
  const match = /^(\d+)\/\d+$/.exec(rank);
  return match ? Number(match[1]) : null;
}

export function countEnabledTalents(selection: TalentSelection, tree: TalentTreeId, talents: TalentEntry[]): number {
  return talents.filter((talent) => isTalentEnabled(selection, tree, talent.name)).length;
}
