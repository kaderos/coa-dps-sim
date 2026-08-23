import type { ItemStats } from "../types";
import { isTalentEnabled } from "../talents/baseline";
import { INFERNAL } from "../talents/infernal";
import { FELSWORN } from "../talents/felsworn";
import type { TalentSelection } from "../talents/types";
import {
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
): Pick<ItemStats, "spellHit" | "spellCrit" | "spellHaste"> {
  const has = (tree: "felsworn" | "infernal", name: string) => !selection || isTalentEnabled(selection, tree, name);
  return {
    spellHit: has("infernal", "Wrath of Sargeras") ? INFERNAL.wrathSpellHit : 0,
    spellCrit:
      (has("felsworn", "Cruelty") ? FELSWORN.crueltyCrit : 0) +
      (has("infernal", "Fel Infusion") ? INFERNAL.felInfusionPersonalCrit : 0),
    spellHaste: 0,
  };
}

export function buildChanceBreakdown(
  gearRatings: ItemStats,
  consumeRatings: ItemStats,
  spirit: number,
  buffPercents: Pick<ItemStats, "spellHit" | "spellCrit" | "spellHaste">,
  selection?: TalentSelection,
): ChanceBreakdown {
  const talents = talentChancePercents(spirit, selection);
  const spiritStat = Math.max(0, spirit);
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

export function hitCardHtml(stat: ChanceStat): string {
  return chanceCard("Spell Hit", stat, {
    ratingPerPercent: SPELL_HIT_RATING_PER_PERCENT,
    cap: SPELL_HIT_CAP,
  });
}

export function critCardHtml(stat: ChanceStat): string {
  return chanceCard("Spell Crit", stat, {
    ratingPerPercent: SPELL_CRIT_RATING_PER_PERCENT,
    note:
      stat.fromInnerDemon > 0
        ? "Inner Demon (Hidden Power) is 20% of Spirit as crit rating and is included in this total."
        : undefined,
  });
}

export function hasteCardHtml(stat: ChanceStat): string {
  return chanceCard("Spell Haste", stat, {
    ratingPerPercent: SPELL_HASTE_RATING_PER_PERCENT,
    note: "Felheart is +1% haste per Felfury in combat and is not in this total.",
  });
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
    total: fromRating + fromTalents + fromBuffs + fromInnerDemon,
  };
}

function chanceCard(
  title: string,
  stat: ChanceStat,
  extra: { ratingPerPercent: number; cap?: number; note?: string },
): string {
  const remaining = extra.cap != null ? extra.cap - stat.total : null;
  const capLine =
    remaining == null
      ? ""
      : remaining > 0
        ? `${fmt(stat.total)}% of the ${extra.cap}% cap — ${fmt(remaining)}% short.`
        : `${fmt(stat.total)}% — at or over the ${extra.cap}% cap.`;
  const extraHint = [capLine, extra.note].filter(Boolean).join(" ");
  return `<section class="chance-card">
    <h4>${title}</h4>
    <p class="hint">${extra.ratingPerPercent} rating = 1%</p>
    <dl class="stats chance-card__rows">
      <div><dt>${fmt(stat.rating)} rating</dt><dd>${fmt(stat.fromRating)}%</dd></div>
      <div><dt>Talents</dt><dd>+${fmt(stat.fromTalents)}%</dd></div>
      ${stat.fromInnerDemon
        ? `<div><dt>Inner Demon</dt><dd>+${fmt(stat.fromInnerDemon)}%</dd></div>`
        : ""}
      <div><dt>Buffs &amp; debuffs</dt><dd>+${fmt(stat.fromBuffs)}%</dd></div>
      <div class="chance-card__total"><dt>Total</dt><dd>${fmt(stat.total)}%</dd></div>
    </dl>
    ${extraHint ? `<p class="hint">${extraHint}</p>` : ""}
  </section>`;
}

function fmt(value: number): string {
  return value.toFixed(1);
}
