import type { SpellFit } from "../types";
import type { Rng } from "./rng";
import { effectiveSpellPower, spellMissChance, PLAYER_LEVEL } from "./stats";
import type { CharacterStats } from "../types";

export type DamageContext = {
  damageTakenFromCaster?: number;
  extraCrit?: number;
  extraFireCrit?: number;
  damageDone?: number;
  extraSpellPower?: number;
  extraHit?: number;
  critMultiplier?: number;
  ignoreLogCrit?: boolean;
  guaranteedCrit?: boolean;
};

export function spellDamage(spell: SpellFit, stats: CharacterStats, rng: Rng, ctx: DamageContext = {}): number {
  return rollSpellDamage(spell, stats, rng, true, ctx).amount;
}

function rollHit(spell: SpellFit, sp: number, ap: number, rng: Rng): number {
  const formula = spell.formula;
  if (formula) {
    const min = formula.min ?? 0;
    const max = formula.max ?? min;
    const perLevel = formula.perLevel ?? 0;
    return (
      rng.range(min, max) +
      perLevel * PLAYER_LEVEL +
      formula.coeff * sp +
      (formula.apCoeff ?? 0) * ap
    );
  }
  const observed = spell.observed;
  if (observed && observed.avgHit > 0) {
    if (spell.fit.spellPowerUsed > 0 && sp > 0) {
      return observed.avgHit * (sp / spell.fit.spellPowerUsed);
    }
    if (spell.fit.coeff > 0) {
      return spell.fit.base + spell.fit.coeff * sp;
    }
    return observed.avgHit;
  }
  return spell.fit.base + spell.fit.coeff * sp;
}

export function rollSpellDamage(
  spell: SpellFit,
  stats: CharacterStats,
  rng: Rng,
  canMiss = true,
  ctx: DamageContext = {},
): { amount: number; isCrit: boolean; isMiss: boolean } {
  const sp = effectiveSpellPower(stats, stats.hiddenPower) + (ctx.extraSpellPower ?? 0);
  const observed = spell.observed;
  const hit = rollHit(spell, sp, stats.attackPower ?? 0, rng);
  if (hit <= 0) return { amount: 0, isCrit: false, isMiss: false };
  const missChance = spellMissChance(stats.spellHit + (ctx.extraHit ?? 0), canMiss);
  if (rng.chance(missChance)) return { amount: 0, isCrit: false, isMiss: true };
  const fireCrit = (spell.school ?? "fire") === "fire" ? ctx.extraFireCrit ?? 0 : 0;
  const logCrit = ctx.ignoreLogCrit ? 0 : (observed?.critRate ?? 0);
  const critRate =
    spell.canCrit === false
      ? 0
      : Math.min(
          0.95,
          Math.max(0, logCrit + stats.spellCrit / 100 + fireCrit + (ctx.extraCrit ?? 0)),
        );
  const talentMult = ctx.critMultiplier;
  const critMult =
    talentMult && talentMult > 1.05
      ? talentMult
      : observed?.critMultiplier && observed.critMultiplier > 1.05
        ? observed.critMultiplier
        : 1.5;
  const isCrit =
    spell.canCrit === false
      ? false
      : ctx.guaranteedCrit
        ? true
        : rng.chance(critRate);
  const raw = isCrit ? hit * critMult : hit;
  const amount = raw * (ctx.damageTakenFromCaster ?? 1) * (ctx.damageDone ?? 1);
  return { amount, isCrit, isMiss: false };
}

export function hasteMultiplier(stats: CharacterStats): number {
  return 1 + Math.max(0, stats.spellHaste) / 100;
}
