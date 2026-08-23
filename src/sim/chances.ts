import type { ItemStats } from "../types";
import { critFromSpiritRating, INFERNAL } from "../talents/infernal";
import { FELSWORN } from "../talents/felsworn";
import {
  SPELL_CRIT_RATING_PER_PERCENT,
  SPELL_HIT_CAP,
  SPELL_HIT_RATING_PER_PERCENT,
} from "./stats";

export type ChanceStat = {
  rating: number;
  fromRating: number;
  fromTalents: number;
  fromBuffs: number;
  total: number;
};

export type ChanceBreakdown = {
  hit: ChanceStat;
  crit: ChanceStat;
};

export function talentChancePercents(spirit: number): Pick<ItemStats, "spellHit" | "spellCrit"> {
  return {
    spellHit: INFERNAL.wrathSpellHit,
    spellCrit:
      FELSWORN.crueltyCrit +
      INFERNAL.felInfusionPersonalCrit +
      critFromSpiritRating(spirit, INFERNAL.netherSpiritToCritRating),
  };
}

export function buildChanceBreakdown(
  gearRatings: ItemStats,
  consumeRatings: ItemStats,
  spirit: number,
  buffPercents: Pick<ItemStats, "spellHit" | "spellCrit">,
): ChanceBreakdown {
  const talents = talentChancePercents(spirit);
  return {
    hit: layer(
      gearRatings.spellHit + consumeRatings.spellHit,
      SPELL_HIT_RATING_PER_PERCENT,
      talents.spellHit,
      buffPercents.spellHit,
    ),
    crit: layer(
      gearRatings.spellCrit + consumeRatings.spellCrit,
      SPELL_CRIT_RATING_PER_PERCENT,
      talents.spellCrit,
      buffPercents.spellCrit,
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
  });
}

function layer(rating: number, perPercent: number, fromTalents: number, fromBuffs: number): ChanceStat {
  const fromRating = rating / perPercent;
  return {
    rating,
    fromRating,
    fromTalents,
    fromBuffs,
    total: fromRating + fromTalents + fromBuffs,
  };
}

function chanceCard(
  title: string,
  stat: ChanceStat,
  extra: { ratingPerPercent: number; cap?: number },
): string {
  const remaining = extra.cap != null ? extra.cap - stat.total : null;
  const capLine =
    remaining == null
      ? ""
      : remaining > 0
        ? `${fmt(stat.total)}% of the ${extra.cap}% cap — ${fmt(remaining)}% short.`
        : `${fmt(stat.total)}% — at or over the ${extra.cap}% cap.`;
  return `<section class="chance-card">
    <h4>${title}</h4>
    <p class="hint">${extra.ratingPerPercent} rating = 1%</p>
    <dl class="stats chance-card__rows">
      <div><dt>${fmt(stat.rating)} rating</dt><dd>${fmt(stat.fromRating)}%</dd></div>
      <div><dt>Talents</dt><dd>+${fmt(stat.fromTalents)}%</dd></div>
      <div><dt>Buffs &amp; debuffs</dt><dd>+${fmt(stat.fromBuffs)}%</dd></div>
      <div class="chance-card__total"><dt>Total</dt><dd>${fmt(stat.total)}%</dd></div>
    </dl>
    ${capLine ? `<p class="hint">${capLine}</p>` : ""}
  </section>`;
}

function fmt(value: number): string {
  return value.toFixed(1);
}
