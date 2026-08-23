import type { CharacterStats } from "../types";
import { applyFelswornPassives } from "./felsworn";
import { applyInfernalPassives } from "./infernal";

export { applyFelswornPassives } from "./felsworn";
export { applyInfernalPassives } from "./infernal";

export function applyTakenTalents(stats: CharacterStats): CharacterStats {
  return applyInfernalPassives(applyFelswornPassives(stats));
}
