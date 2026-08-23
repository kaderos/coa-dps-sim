import type { CharacterStats } from "../types";
import { applyFelswornPassives } from "./felsworn";
import { applyInfernalPassives } from "./infernal";
import type { TalentSelection } from "./types";

export { applyFelswornPassives } from "./felsworn";
export { applyInfernalPassives } from "./infernal";

export function applyTakenTalents(stats: CharacterStats, selection?: TalentSelection): CharacterStats {
  return applyInfernalPassives(applyFelswornPassives(stats, selection), selection);
}
