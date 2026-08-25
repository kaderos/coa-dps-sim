import type { BuffsConfig, ItemStats } from "../types";
import type { StatHintContent } from "../stat-breakdown";
import { isTalentEnabled } from "../talents/baseline";
import { FELSWORN } from "../talents/felsworn";
import { felInfusionCritPercent, INFERNAL } from "../talents/infernal";
import type { TalentSelection } from "../talents/types";
import {
  intellectCritPercent,
  spellMissChance,
  SPELL_CRIT_RATING_PER_PERCENT,
  SPELL_HASTE_RATING_PER_PERCENT,
  SPELL_HIT_CAP,
  SPELL_HIT_RATING_PER_PERCENT,
} from "./stats";

export type ChanceStat = {
  rating: number;
  fromRating: number;
  fromTalents: number;
  fromBuffs: number;
  fromInnerDemon: number;
  fromIntellect: number;
  total: number;
};

export type ChanceBreakdown = {
  hit: ChanceStat;
  crit: ChanceStat;
  haste: ChanceStat;
};

export function talentChancePercents(
  _spirit: number,
  selection?: TalentSelection,
  buffs?: Pick<BuffsConfig, "demonfirePact">,
): Pick<ItemStats, "spellHit" | "spellCrit" | "spellHaste"> {
  const has = (tree: "felsworn" | "infernal", name: string) => !selection || isTalentEnabled(selection, tree, name);
  const demonfirePactActive = buffs?.demonfirePact !== false;
  return {
    spellHit: has("infernal", "Wrath of Sargeras") ? INFERNAL.wrathSpellHit : 0,
    spellCrit:
      (has("felsworn", "Cruelty") ? FELSWORN.crueltyCrit : 0) +
      (has("infernal", "Fel Infusion") ? felInfusionCritPercent(demonfirePactActive) : 0),
    spellHaste: 0,
  };
}

export function buildChanceBreakdown(
  gearRatings: ItemStats,
  consumeRatings: ItemStats,
  spirit: number,
  intellect: number,
  buffPercents: Pick<ItemStats, "spellHit" | "spellCrit" | "spellHaste">,
  selection?: TalentSelection,
  buffs?: Pick<BuffsConfig, "demonfirePact">,
): ChanceBreakdown {
  const talents = talentChancePercents(spirit, selection, buffs);
  const spiritStat = Math.max(0, spirit);
  const intellectStat = Math.max(0, intellect);
  const has = (tree: "felsworn" | "infernal", name: string) => !selection || isTalentEnabled(selection, tree, name);
  const netherRating = has("infernal", "Nether Spirit") ? INFERNAL.netherSpiritToCritRating * spiritStat : 0;
  const innerDemonRating = has("infernal", "Hidden Power") ? INFERNAL.hiddenPowerInnerSpirit * spiritStat : 0;
  const crit = layer(
    gearRatings.spellCrit + consumeRatings.spellCrit + netherRating + innerDemonRating,
    SPELL_CRIT_RATING_PER_PERCENT,
    talents.spellCrit,
    buffPercents.spellCrit,
  );
  crit.fromInnerDemon = innerDemonRating / SPELL_CRIT_RATING_PER_PERCENT;
  crit.fromIntellect = intellectCritPercent(intellectStat);
  crit.total += crit.fromIntellect;
  return {
    hit: layer(
      gearRatings.spellHit + consumeRatings.spellHit,
      SPELL_HIT_RATING_PER_PERCENT,
      talents.spellHit,
      buffPercents.spellHit,
    ),
    crit,
    haste: layer(
      gearRatings.spellHaste + consumeRatings.spellHaste,
      SPELL_HASTE_RATING_PER_PERCENT,
      talents.spellHaste,
      buffPercents.spellHaste,
    ),
  };
}

export function hitHintContent(stat: ChanceStat): StatHintContent {
  const missChance = spellMissChance(stat.total);
  const remaining = SPELL_HIT_CAP - stat.total;
  const capReminder =
    remaining > 0
      ? `${fmt(stat.total)}% of the ${SPELL_HIT_CAP}% cap — ${fmt(remaining)}% short.`
      : `${fmt(stat.total)}% — at or over the ${SPELL_HIT_CAP}% cap.`;
  return {
    body: chanceHintBody(stat, "Hit Rating"),
    reminders: [
      capReminder,
      `Calculated miss chance vs a +3 boss: ${fmt(missChance * 100)}%.`,
      `${SPELL_HIT_RATING_PER_PERCENT} hit rating = 1%.`,
    ],
  };
}

export function hasteHintContent(stat: ChanceStat, tailwindEnabled = false): StatHintContent {
  const reminders = [
    "Felheart is +1% haste per Felfury in combat and is not in this total.",
    `${SPELL_HASTE_RATING_PER_PERCENT} haste rating = 1%.`,
  ];
  if (tailwindEnabled) {
    reminders.splice(1, 0, "Tailwind (+5% haste) is modeled in combat windows and is not in this total.");
  }
  return {
    body: chanceHintBody(stat, "Haste Rating"),
    reminders,
  };
}

function layer(
  rating: number,
  perPercent: number,
  fromTalents: number,
  fromBuffs: number,
  fromInnerDemon = 0,
): ChanceStat {
  const fromRating = rating / perPercent;
  return {
    rating,
    fromRating,
    fromTalents,
    fromBuffs,
    fromInnerDemon,
    fromIntellect: 0,
    total: fromRating + fromTalents + fromBuffs + fromInnerDemon,
  };
}

function chanceHintBody(stat: ChanceStat, ratingLabel: string): string {
  const lines: string[] = [];
  if (stat.rating > 0) lines.push(`${ratingLabel}: ${fmt(stat.rating)}`);
  lines.push(`Talents: ${fmt(stat.fromTalents)}%`);
  if (stat.fromInnerDemon) lines.push(`Inner Demon: ${fmt(stat.fromInnerDemon)}%`);
  if (stat.fromIntellect) lines.push(`Intellect: ${fmt(stat.fromIntellect)}%`);
  lines.push(`Buffs & debuffs: ${fmt(stat.fromBuffs)}%`);
  lines.push(`Total: ${fmt(stat.total)}%`);
  return lines.join("\n\n");
}

function fmt(value: number): string {
  return value.toFixed(1);
}
