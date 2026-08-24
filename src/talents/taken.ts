import type { BuffsConfig, CharacterStats } from "../types";
import { intellectCritPercent } from "../sim/stats";
import { applyFelswornPassives } from "./felsworn";
import { applyInfernalPassives } from "./infernal";
import type { TalentSelection } from "./types";

export { applyFelswornPassives } from "./felsworn";
export { applyInfernalPassives, felInfusionCritPercent } from "./infernal";

export function applyTakenTalents(
  stats: CharacterStats,
  selection?: TalentSelection,
  buffs?: Pick<BuffsConfig, "demonfirePact">,
): CharacterStats {
  const demonfirePactActive = buffs?.demonfirePact !== false;
  const withTalents = applyInfernalPassives(applyFelswornPassives(stats, selection), selection, demonfirePactActive);
  return {
    ...withTalents,
    spellCrit: withTalents.spellCrit + intellectCritPercent(withTalents.intellect),
  };
}
