import { percentBuffs, ratingConsumes } from "./buffs";
import { buildChanceBreakdown, displayHitStat } from "./sim/chances";
import type { ChanceBreakdown } from "./sim/chances";
import { displaySpellPower, ratingsFromGear } from "./sim/stats";
import { equippedSets } from "./sets";
import {
  isTalentEnabled,
  talentMaxRank,
  talentRank,
  type TalentSelection,
  type TalentTrees,
} from "./talents/baseline";
import { primaryStatBreakdown, spellCritBreakdown, spellPowerBreakdown, statLayerBreakdown } from "./stat-breakdown";
import type {
  BuffsConfig,
  CharacterStats,
  Enchant,
  EnchantSet,
  EquippedSet,
  GearSet,
  Item,
  SimCastEvent,
  SimConfig,
  SimResult,
  Slot,
  SpellBreakdown,
} from "./types";
import { SLOTS } from "./types";

export const SIM_EXPORT_SCHEMA = "coa-dps-sim-export";
export const SIM_EXPORT_VERSION = 1;

export type SimExportSimulatorMeta = {
  version: string;
  commit: string | null;
};

export type SimExportGearEntry = {
  id: number;
  name: string;
  itemLevel: number | null;
  phase: number | null;
  setName: string | null;
  stats: Item["stats"];
};

export type SimExportEnchantEntry = {
  id: number;
  name: string;
  stats: Enchant["stats"];
  description: string | null;
};

export type SimExportTalentEntry = {
  name: string;
  rankLabel: string;
  combat: boolean;
  enabled: boolean;
  rank: number;
  maxRank: number;
  selectionValue: boolean | number | undefined;
};

export type SimExportDocument = {
  schema: typeof SIM_EXPORT_SCHEMA;
  schemaVersion: typeof SIM_EXPORT_VERSION;
  exportedAt: string;
  simulator: SimExportSimulatorMeta;
  encounter: {
    durationSec: number;
    iterations: number;
    seed: number;
    playerLevel: number;
    bossLevel: number;
    fightStyle: SimResult["fightStyle"];
    pullFelfury: number;
    castLogFightSec: number;
    castLogTruncated: boolean;
  };
  character: {
    combatStats: CharacterStats;
    displayStats: CharacterStats;
    totals: {
      spellPower: number;
      spellPenetration: number;
      intellect: number;
      spirit: number;
      spellCritPct: number;
      spellHitPct: number;
      spellHastePct: number;
      hiddenPower: number;
    };
    gearRatings: ReturnType<typeof ratingsFromGear>;
    consumeRatings: ReturnType<typeof ratingConsumes>;
    chanceBreakdown: ChanceBreakdown;
    displayHit: ReturnType<typeof displayHitStat>;
    breakdowns: {
      spellPower: ReturnType<typeof spellPowerBreakdown>;
      spellCrit: ReturnType<typeof spellCritBreakdown>;
      spellPenetration: ReturnType<typeof statLayerBreakdown>;
      intellect: ReturnType<typeof primaryStatBreakdown>;
      spirit: ReturnType<typeof primaryStatBreakdown>;
    };
    setBonuses: EquippedSet[];
  };
  gear: Partial<Record<Slot, SimExportGearEntry | null>>;
  enchants: Partial<Record<Slot, SimExportEnchantEntry | null>>;
  talents: {
    selection: TalentSelection;
    felsworn: SimExportTalentEntry[];
    infernal: SimExportTalentEntry[];
  };
  buffs: BuffsConfig;
  simConfig: SimConfig;
  results: {
    meanDps: number;
    minDps: number;
    maxDps: number;
    p50Dps: number;
    p95Dps: number;
    stdev: number;
    logDps: number | null;
    logDeltaPct: number | null;
    breakdown: SpellBreakdown[];
    auraUptimes: SimResult["auraUptimes"];
    offensiveHit: SimResult["offensiveHit"];
  };
  castLog: SimCastEvent[];
};

export type SimExportInput = {
  result: SimResult;
  simConfig: SimConfig;
  combatStats: CharacterStats;
  displayStats: CharacterStats;
  gear: GearSet;
  enchants: EnchantSet;
  buffs: BuffsConfig;
  talentSelection: TalentSelection;
  talentTrees: TalentTrees;
  pullFelfury: number;
};

declare const __SIM_BUILD__: SimExportSimulatorMeta | undefined;

export function getSimulatorMeta(): SimExportSimulatorMeta {
  if (typeof __SIM_BUILD__ !== "undefined") return __SIM_BUILD__;
  return { version: "0.1.0", commit: null };
}

function serializeGearItem(item: Item | null | undefined): SimExportGearEntry | null {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    itemLevel: item.itemLevel ?? null,
    phase: item.phase ?? item.displayPhase ?? null,
    setName: item.setName ?? null,
    stats: item.stats,
  };
}

function serializeEnchant(enchant: Enchant | null | undefined): SimExportEnchantEntry | null {
  if (!enchant) return null;
  return {
    id: enchant.id,
    name: enchant.name,
    stats: enchant.stats,
    description: enchant.description ?? null,
  };
}

function serializeTalentTree(
  tree: "felsworn" | "infernal",
  trees: TalentTrees,
  selection: TalentSelection,
): SimExportTalentEntry[] {
  return trees[tree].talents.map((talent) => {
    const maxRank = talentMaxRank(tree, talent.name);
    const rank = talentRank(selection, tree, talent.name);
    return {
      name: talent.name,
      rankLabel: talent.rank,
      combat: talent.combat,
      enabled: isTalentEnabled(selection, tree, talent.name),
      rank,
      maxRank,
      selectionValue: selection[tree][talent.name],
    };
  });
}

export function buildSimExportDocument(input: SimExportInput): SimExportDocument {
  const { result, simConfig, combatStats, displayStats, gear, enchants, buffs, talentSelection, talentTrees, pullFelfury } =
    input;
  const durationSec = result.durationSec;
  const gearRatings = ratingsFromGear(gear, enchants);
  const consumeRatings = ratingConsumes(buffs, gear);
  const chances = buildChanceBreakdown(
    gearRatings,
    consumeRatings,
    displayStats.spirit,
    displayStats.intellect,
    percentBuffs(buffs, talentSelection),
    talentSelection,
    buffs,
  );
  const displayHit = displayHitStat(
    chances.hit,
    isTalentEnabled(talentSelection, "infernal", "Felshock"),
    buffs.primalistHitDebuff,
  );

  return {
    schema: SIM_EXPORT_SCHEMA,
    schemaVersion: SIM_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    simulator: getSimulatorMeta(),
    encounter: {
      durationSec: result.durationSec,
      iterations: result.iterations,
      seed: simConfig.seed,
      playerLevel: result.playerLevel,
      bossLevel: result.bossLevel,
      fightStyle: result.fightStyle,
      pullFelfury,
      castLogFightSec: result.castLogFightSec,
      castLogTruncated: result.castLogTruncated,
    },
    character: {
      combatStats,
      displayStats,
      totals: {
        spellPower: displaySpellPower(displayStats, displayStats.hiddenPower),
        spellPenetration: displayStats.spellPenetration || 0,
        intellect: displayStats.intellect,
        spirit: displayStats.spirit,
        spellCritPct: chances.crit.total,
        spellHitPct: displayHit.total,
        spellHastePct: chances.haste.total,
        hiddenPower: displayStats.hiddenPower,
      },
      gearRatings,
      consumeRatings,
      chanceBreakdown: chances,
      displayHit,
      breakdowns: {
        spellPower: spellPowerBreakdown(gear, enchants, buffs, durationSec, talentSelection),
        spellCrit: spellCritBreakdown(gear, enchants, buffs, displayStats, talentSelection, chances.crit.total),
        spellPenetration: statLayerBreakdown("spellPenetration", gear, enchants, buffs, durationSec, talentSelection),
        intellect: primaryStatBreakdown("intellect", gear, enchants, buffs, durationSec, talentSelection),
        spirit: primaryStatBreakdown("spirit", gear, enchants, buffs, durationSec, talentSelection),
      },
      setBonuses: equippedSets(gear),
    },
    gear: Object.fromEntries(SLOTS.map((slot) => [slot, serializeGearItem(gear[slot] ?? null)])),
    enchants: Object.fromEntries(SLOTS.map((slot) => [slot, serializeEnchant(enchants[slot] ?? null)])),
    talents: {
      selection: talentSelection,
      felsworn: serializeTalentTree("felsworn", talentTrees, talentSelection),
      infernal: serializeTalentTree("infernal", talentTrees, talentSelection),
    },
    buffs,
    simConfig,
    results: {
      meanDps: result.meanDps,
      minDps: result.minDps,
      maxDps: result.maxDps,
      p50Dps: result.p50Dps,
      p95Dps: result.p95Dps,
      stdev: result.stdev,
      logDps: result.logDps,
      logDeltaPct: result.logDeltaPct,
      breakdown: result.breakdown,
      auraUptimes: result.auraUptimes,
      offensiveHit: result.offensiveHit,
    },
    castLog: result.castEvents,
  };
}

export function simExportFilename(result: SimResult, seed: number): string {
  return `coa-sim-export-seed-${seed}-${result.durationSec}s.json`;
}
