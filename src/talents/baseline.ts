import type {
  FelswornTalentDoc,
  InfernalTalentDoc,
  TalentEntry,
  TalentSelection,
  TalentTreeId,
  TalentTrees,
} from "./types";

export type { FelswornTalentDoc, InfernalTalentDoc, TalentEntry, TalentSelection, TalentTreeId, TalentTrees };

/** Infernal talents granted at level 60 — always on in the sim. */
export const INFERNAL_CORE_TALENTS = [
  "Fel Apprentice",
  "Hidden Power",
  "Unphased",
  "Man'ari Teachings",
] as const;

export const INFERNAL_TALENT_POINT_CAP = 25;

const INFERNAL_DEFAULT_OFF = new Set(["Felwrath", "Infernal", "Felbreak", "Cursed Flames"]);

export function isCoreTalent(tree: TalentTreeId, name: string): boolean {
  return tree === "infernal" && (INFERNAL_CORE_TALENTS as readonly string[]).includes(name);
}

export function parseTalentMaxRank(rank: string): number | null {
  const match = /^(\d+)\/(\d+)$/.exec(rank);
  if (!match) return null;
  const max = Number(match[2]);
  return Number.isFinite(max) ? max : null;
}

export function isRankedTalentEntry(talent: TalentEntry): boolean {
  const max = parseTalentMaxRank(talent.rank);
  return max != null && max > 1;
}

export function isRankedTalent(tree: TalentTreeId, name: string): boolean {
  return tree === "infernal" && isRankedInfernalTalent(name);
}

function isRankedInfernalTalent(name: string): boolean {
  return name === "Wrath of Sargeras" || name === "Felfire Adept" || name === "Black Magic";
}

export function talentMaxRank(tree: TalentTreeId, name: string): number {
  return isRankedTalent(tree, name) ? 2 : 1;
}

function defaultTalentValue(tree: TalentTreeId, talent: TalentEntry): boolean | number {
  if (isCoreTalent(tree, talent.name)) return true;
  if (isRankedTalentEntry(talent)) return parseTalentMaxRank(talent.rank) ?? 2;
  if (tree === "infernal" && INFERNAL_DEFAULT_OFF.has(talent.name)) return false;
  return true;
}

function normalizeTalentValue(talent: TalentEntry, value: boolean | number | undefined): boolean | number {
  if (isRankedTalentEntry(talent)) {
    const max = parseTalentMaxRank(talent.rank) ?? 2;
    if (typeof value === "number") return Math.max(0, Math.min(max, Math.round(value)));
    if (value === false) return 0;
    return max;
  }
  if (typeof value === "number") return value > 0;
  return value !== false;
}

export function talentKey(tree: TalentTreeId, name: string): string {
  return `${tree}:${name}`;
}

export function defaultTalentSelection(trees: TalentTrees): TalentSelection {
  return {
    felsworn: Object.fromEntries(
      trees.felsworn.talents.map((talent) => [talent.name, defaultTalentValue("felsworn", talent)]),
    ),
    infernal: Object.fromEntries(
      trees.infernal.talents.map((talent) => [talent.name, defaultTalentValue("infernal", talent)]),
    ),
  };
}

export function mergeTalentSelection(saved: Partial<TalentSelection> | undefined, trees: TalentTrees): TalentSelection {
  const defaults = defaultTalentSelection(trees);
  const merged: TalentSelection = { felsworn: {}, infernal: {} };
  for (const tree of ["felsworn", "infernal"] as const) {
    for (const talent of trees[tree].talents) {
      merged[tree][talent.name] = normalizeTalentValue(talent, saved?.[tree]?.[talent.name] ?? defaults[tree][talent.name]);
    }
  }
  for (const name of INFERNAL_CORE_TALENTS) {
    merged.infernal[name] = true;
  }
  return merged;
}

export function talentRank(selection: TalentSelection | undefined, tree: TalentTreeId, name: string): number {
  if (!isRankedTalent(tree, name)) return 0;
  const max = talentMaxRank(tree, name);
  if (!selection) return max;
  const value = selection[tree][name];
  if (typeof value === "number") return Math.max(0, Math.min(max, Math.round(value)));
  if (value === false) return 0;
  return max;
}

/** Fraction of a ranked talent's effect (0, 0.5, or 1 for 2-point talents). */
export function talentRankFraction(selection: TalentSelection | undefined, tree: TalentTreeId, name: string): number {
  if (!isRankedTalent(tree, name)) {
    return !selection || isTalentEnabled(selection, tree, name) ? 1 : 0;
  }
  if (!selection) return 1;
  return talentRank(selection, tree, name) / talentMaxRank(tree, name);
}

export function isTalentEnabled(selection: TalentSelection, tree: TalentTreeId, name: string): boolean {
  if (isCoreTalent(tree, name)) return true;
  if (isRankedTalent(tree, name)) return talentRank(selection, tree, name) > 0;
  const bucket = selection[tree];
  return bucket[name] !== false;
}

export function talentPointCost(tree: TalentTreeId, talent: TalentEntry, selection: TalentSelection): number {
  if (isCoreTalent(tree, talent.name) || talent.rank === "passive") return 0;
  if (isRankedTalentEntry(talent)) return talentRank(selection, tree, talent.name);
  return isTalentEnabled(selection, tree, talent.name) ? 1 : 0;
}

export function countTalentPoints(selection: TalentSelection, tree: TalentTreeId, talents: TalentEntry[]): number {
  return talents.reduce((sum, talent) => sum + talentPointCost(tree, talent, selection), 0);
}

export function infernalTalentPoints(selection: TalentSelection, talents: TalentEntry[]): number {
  return countTalentPoints(selection, "infernal", talents);
}

export function wouldExceedInfernalPointCap(
  selection: TalentSelection,
  talents: TalentEntry[],
  tree: TalentTreeId,
  name: string,
  value: boolean | number,
): boolean {
  if (tree !== "infernal") return false;
  const next: TalentSelection = {
    ...selection,
    infernal: { ...selection.infernal, [name]: value },
  };
  return infernalTalentPoints(next, talents) > INFERNAL_TALENT_POINT_CAP;
}

export function talentRankLabel(rank: string): string {
  if (rank === "passive") return "Passive";
  return rank;
}

export function talentPoints(rank: string): number | null {
  const match = /^(\d+)\/(\d+)$/.exec(rank);
  return match ? Number(match[1]) : null;
}

export function countEnabledTalents(selection: TalentSelection, tree: TalentTreeId, talents: TalentEntry[]): number {
  return talents.filter((talent) => isTalentEnabled(selection, tree, talent.name)).length;
}
