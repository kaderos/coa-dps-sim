import type { CharacterStats, SpellFit } from "./types";
import {
  fireSpellPower,
  PLAYER_LEVEL,
  shadowSpellPower,
} from "./sim/stats";
import { FELSWORN } from "./talents/felsworn";
import { INFERNAL } from "./talents/infernal";

export type SpellFormulaHint = {
  title: string;
  /** Symbolic damage formula. */
  formula: string;
  /** Formula with current stats plugged in (HTML). */
  evaluatedHtml: string;
  /** What can modify this spell's damage in the sim. */
  reminders: string[];
};

type FormulaParts = {
  min: number;
  max: number;
  perLevel: number;
  levelTerm: number;
  coeff: number;
  power: number;
  powerLabel: string;
  apCoeff: number;
  ap: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function base(value: string | number): string {
  return `<span class="hint-card__formula-base">${escapeHtml(String(value))}</span>`;
}

function fmt(value: number, digits = 4): string {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.?0+$/, "");
}

function spellPowerForFormula(stats: CharacterStats): { power: number; label: string } {
  const fire = fireSpellPower(stats, stats.hiddenPower);
  const shadow = shadowSpellPower(stats, stats.hiddenPower);
  if (fire >= shadow) return { power: fire, label: "FireP" };
  return { power: shadow, label: "ShaP" };
}

function resolveSpell(
  name: string,
  spells: Record<string, SpellFit>,
): { spell: SpellFit; formulaSpell: SpellFit; kind: "direct" | "ruin-dot" | "copy" } | null {
  if (name === "Ruin (DoT)") {
    const ruin = Object.values(spells).find((s) => s.name === "Ruin" && s.id === 501298);
    return ruin ? { spell: ruin, formulaSpell: ruin, kind: "ruin-dot" } : null;
  }
  if (name === "Felstrike (DoT)") {
    const felstrike = Object.values(spells).find((s) => s.name === "Felstrike");
    return felstrike ? { spell: felstrike, formulaSpell: felstrike, kind: "direct" } : null;
  }
  if (name === "Chaos") {
    const chaos = Object.values(spells).find((s) => s.name === "Chaos");
    return chaos ? { spell: chaos, formulaSpell: chaos, kind: "direct" } : null;
  }
  if (name === "Sargeron Smite (Inner Demon)") {
    const rider = Object.values(spells).find((s) => s.name === "Sargeron Smite (Inner Demon)");
    const smite = Object.values(spells).find((s) => s.name === "Sargeron Smite" && s.id === 501321);
    if (!rider || !smite) return null;
    return { spell: rider, formulaSpell: smite, kind: "copy" };
  }

  const match = Object.values(spells).find((s) => s.name === name);
  if (!match) return null;
  if (match.role === "debuff" || match.role === "buff" || match.role === "cooldown") return null;
  if (!match.formula && match.fit.base <= 0 && match.fit.coeff <= 0) return null;
  return { spell: match, formulaSpell: match, kind: "direct" };
}

function partsFromSpell(formulaSpell: SpellFit, stats: CharacterStats): FormulaParts | null {
  const formula = formulaSpell.formula;
  const { power, label } = spellPowerForFormula(stats);
  const ap = stats.attackPower ?? 0;

  if (formula) {
    const min = formula.min ?? 0;
    const max = formula.max ?? min;
    const perLevel = formula.perLevel ?? 0;
    const levelTerm = formula.perLevelScalesWithPlayer === false ? 0 : perLevel * PLAYER_LEVEL;
    const fireCoeff = formula.fireCoeff ?? formula.coeff;
    const shadowCoeff = formula.shadowCoeff ?? formula.coeff;
    const coeff = label === "FireP" ? fireCoeff : shadowCoeff;
    return {
      min,
      max,
      // Only surface ×level in the hover when combat actually adds it (min/max already at 60 for Ruin).
      perLevel: levelTerm > 0 ? perLevel : 0,
      levelTerm,
      coeff,
      power,
      powerLabel: label,
      apCoeff: formula.apCoeff ?? 0,
      ap,
    };
  }

  if (formulaSpell.fit.coeff > 0 || formulaSpell.fit.base > 0) {
    return {
      min: formulaSpell.fit.base,
      max: formulaSpell.fit.base,
      perLevel: 0,
      levelTerm: 0,
      coeff: formulaSpell.fit.coeff,
      power,
      powerLabel: "SP",
      apCoeff: 0,
      ap,
    };
  }
  return null;
}

function symbolicDirect(p: FormulaParts): string {
  const bits: string[] = [];
  if (p.min === p.max) bits.push(fmt(p.min));
  else bits.push(`range(${fmt(p.min)}, ${fmt(p.max)})`);
  if (p.perLevel) bits.push(`${fmt(p.perLevel)} × level`);
  bits.push(`${fmt(p.coeff)} × ${p.powerLabel}`);
  if (p.apCoeff) bits.push(`${fmt(p.apCoeff)} × AP`);
  return bits.join(" + ");
}

function evaluatedDirect(p: FormulaParts): string {
  const bits: string[] = [];
  if (p.min === p.max) bits.push(base(fmt(p.min)));
  else bits.push(`range(${base(fmt(p.min))}, ${base(fmt(p.max))})`);
  if (p.perLevel) bits.push(`${base(fmt(p.perLevel))} × ${base(PLAYER_LEVEL)}`);
  bits.push(`${base(fmt(p.coeff))} × ${base(fmt(p.power, 1))}`);
  if (p.apCoeff) bits.push(`${base(fmt(p.apCoeff))} × ${base(fmt(p.ap, 1))}`);
  return bits.join(" + ");
}

function expectedAverage(p: FormulaParts): number {
  return (p.min + p.max) / 2 + p.levelTerm + p.coeff * p.power + p.apCoeff * p.ap;
}

function modifiersFor(name: string, spell: SpellFit): string[] {
  const notes: string[] = [];
  const isRuin = name === "Ruin" || spell.id === 501298;
  const isRuinDot = name === "Ruin (DoT)";
  const isFireball = name === "Fel Fireball" || spell.id === 501288;
  const isSmite = name.startsWith("Sargeron Smite");
  const isChaos = name === "Chaos";
  const isFelstrike = name.startsWith("Felstrike");

  if (isRuinDot) {
    notes.push(
      `Tick damage is ${fmt(INFERNAL.ruinDotFraction * 100, 0)}% of the triggering Ruin hit, spread over ${INFERNAL.ruinDotDuration}s (does not crit or re-roll hit).`,
    );
    notes.push("Only applies while Inner Demon is up when Ruin lands.");
    return notes;
  }

  if (name === "Sargeron Smite (Inner Demon)") {
    notes.push("Copies the triggering Sargeron Smite damage; does not roll hit or crit again.");
    notes.push("Only fires while Inner Demon is active.");
    return notes;
  }

  notes.push(`Wrath of Sargeras: +${fmt(INFERNAL.wrathMagicDamage * 100, 0)}% damage.`);
  notes.push("Inner Demon: +10% damage while active.");
  if (isRuin || isChaos) {
    notes.push(`Black Magic: +${fmt(INFERNAL.blackMagicRuin * 100, 0)}% ${isChaos ? "Chaos" : "Ruin"} damage.`);
  }
  if (isFireball || isRuin) {
    notes.push("Bane of Fire: +20% damage taken from your fire/shadowflame hits while up.");
  }
  if (isSmite || isChaos) {
    notes.push(`Doomsayer: +${fmt(INFERNAL.doomsayerSmiteDamage * 100, 0)}% Smite/Chaos damage while target is above 75% health.`);
  }
  notes.push(`Chaotic: +${fmt(FELSWORN.chaoticDamage * 100, 0)}% damage per stack (max ${FELSWORN.chaoticStacks}).`);
  notes.push(
    `Reckoning: +${fmt(FELSWORN.reckoningBuffDamage * 100, 0)}% damage per stack (max ${FELSWORN.reckoningBuffStacks}) after Reckoning Fireballs.`,
  );
  if (spell.canCrit !== false && !isFelstrike) {
    notes.push("Critical strikes deal 2× damage.");
  }
  if (isFelstrike) {
    notes.push("Felstrike ticks do not crit. Damage scales with stacks (max 3).");
  }
  notes.push("Spell Power includes Hidden Power (15% of Intellect and Spirit).");
  return notes;
}

/** Build a Spell breakdown hover for damaging spells; null if not applicable. */
export function spellFormulaHint(
  name: string,
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
): SpellFormulaHint | null {
  const resolved = resolveSpell(name, spells);
  if (!resolved) return null;

  const { spell, formulaSpell, kind } = resolved;

  if (kind === "ruin-dot") {
    const p = partsFromSpell(formulaSpell, stats);
    if (!p) return null;
    const avg = expectedAverage(p);
    const tick = (avg * INFERNAL.ruinDotFraction) / INFERNAL.ruinDotDuration;
    return {
      title: name,
      formula: `Ruin hit × ${fmt(INFERNAL.ruinDotFraction)} ÷ ${INFERNAL.ruinDotDuration}s per tick`,
      evaluatedHtml: `${base(fmt(avg, 0))} × ${base(fmt(INFERNAL.ruinDotFraction))} ÷ ${base(INFERNAL.ruinDotDuration)} ≈ ${base(fmt(tick, 0))} per tick`,
      reminders: modifiersFor(name, spell),
    };
  }

  if (kind === "copy") {
    const p = partsFromSpell(formulaSpell, stats);
    if (!p) return null;
    return {
      title: name,
      formula: "Copy of triggering Sargeron Smite hit (no second roll)",
      evaluatedHtml: `same as Smite ≈ ${base(fmt(expectedAverage(p), 0))} before combat modifiers`,
      reminders: modifiersFor(name, spell),
    };
  }

  const p = partsFromSpell(formulaSpell, stats);
  if (!p) return null;

  return {
    title: name,
    formula: symbolicDirect(p),
    evaluatedHtml: evaluatedDirect(p),
    reminders: modifiersFor(name, spell),
  };
}

