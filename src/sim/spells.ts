import type { SpellFit } from "../types";
import type { Rng } from "./rng";
import {
  condSchoolPower,
  effectiveSpellPower,
  spellMissChance,
  PLAYER_LEVEL,
} from "./stats";
import type { CharacterStats } from "../types";
import { spellAffectsFire } from "../talents/infernal";

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

function formulaPowerCoeff(
  formula: NonNullable<SpellFit["formula"]>,
  stats: CharacterStats,
  extraSp: number,
): { power: number; coeff: number } {
  const fireCoeff = formula.fireCoeff ?? formula.coeff;
  const shadowCoeff = formula.shadowCoeff ?? formula.coeff;
  return condSchoolPower(stats, stats.hiddenPower, extraSp, fireCoeff, shadowCoeff);
}

function rollHit(spell: SpellFit, stats: CharacterStats, extraSp: number, ap: number, rng: Rng): number {
  const formula = spell.formula;
  if (formula) {
    const min = formula.min ?? 0;
    const max = formula.max ?? min;
    const perLevel = formula.perLevel ?? 0;
    const levelTerm =
      formula.perLevelScalesWithPlayer === false ? 0 : perLevel * PLAYER_LEVEL;
    const { power, coeff } = formulaPowerCoeff(formula, stats, extraSp);
    return (
      rng.range(min, max) +
      levelTerm +
      coeff * power +
      (formula.apCoeff ?? 0) * ap
    );
  }
  const sp = effectiveSpellPower(stats, stats.hiddenPower) + extraSp;
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

export type RollSpellDamageOptions = {
  /** Use another spell's db formula for the hit roll (Chaos uses Smite scaling). */
  formulaSpell?: SpellFit;
  /** Use another spell's crit rules / multiplier (Chaos matches Smite). */
  critSpell?: SpellFit;
};

export function rollOffensiveHit(
  stats: CharacterStats,
  rng: Rng,
  canMiss = true,
  ctx: DamageContext = {},
): { isMiss: boolean } {
  const missChance = spellMissChance(stats.spellHit, canMiss, ctx.extraHit ?? 0);
  return { isMiss: rng.chance(missChance) };
}

export function rollSpellDamage(
  spell: SpellFit,
  stats: CharacterStats,
  rng: Rng,
  canMiss = true,
  ctx: DamageContext = {},
  options: RollSpellDamageOptions = {},
): { amount: number; isCrit: boolean; isMiss: boolean } {
  const formulaSpell = options.formulaSpell ?? spell;
  const critSpell = options.critSpell ?? spell;
  const extraSp = ctx.extraSpellPower ?? 0;
  const observed = critSpell.observed;
  const missChance = spellMissChance(stats.spellHit, canMiss, ctx.extraHit ?? 0);
  if (rng.chance(missChance)) return { amount: 0, isCrit: false, isMiss: true };
  const hit = rollHit(formulaSpell, stats, extraSp, stats.attackPower ?? 0, rng);
  if (hit <= 0) return { amount: 0, isCrit: false, isMiss: false };
  const fireCrit = spellAffectsFire(critSpell) ? ctx.extraFireCrit ?? 0 : 0;
  const logCrit = ctx.ignoreLogCrit ? 0 : (observed?.critRate ?? 0);
  const critRate =
    critSpell.canCrit === false
      ? 0
      : Math.min(
          1,
          Math.max(0, logCrit + stats.spellCrit / 100 + fireCrit + (ctx.extraCrit ?? 0)),
        );
  const talentMult = ctx.critMultiplier;
  const critMult =
    talentMult && talentMult > 1.05
      ? talentMult
      : !ctx.ignoreLogCrit && observed?.critMultiplier && observed.critMultiplier > 1.05
        ? observed.critMultiplier
        : 2;
  const isCrit =
    critSpell.canCrit === false
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
