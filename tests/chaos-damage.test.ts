import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runOnce } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter } from "../src/sim/stats.ts";
import { rollSpellDamage } from "../src/sim/spells.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import { infernalContext } from "../src/talents/infernal.ts";
import type { CharacterStats, SpellFit, SpellDb } from "../src/types.ts";

const spells = (JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb).spells;

function loadChaos(): SpellFit {
  const db = JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb;
  return db.spells["802676"];
}

/** Phase 2 infernal — effective fire spell power is typically 800–900, not multi‑k sheet totals. */
const baseStats: CharacterStats = {
  spellPower: 850,
  firePower: 0,
  shadowPower: 0,
  spellCrit: 0,
  spellHit: 17,
  spellHaste: 0,
  hiddenPower: 0,
  intellect: 0,
  spirit: 0,
  attackPower: 0,
  energy: 100,
  energyMax: 100,
  felfury: 0,
  felfuryMax: 6,
};

test("Chaos spell data uses 0.67 SP coefficient (Scaling #1)", () => {
  const chaos = loadChaos();
  assert.equal(chaos.formula?.coeff, 0.67);
  assert.equal(chaos.fit.coeff, 0.67);
  assert.equal(chaos.school, "shadowflame");
});

test("Chaos base hit roll is uniform(220,221) + 0.67 * FireP", () => {
  const chaos = loadChaos();
  const rng = new Rng(1);
  const roll = rollSpellDamage(chaos, baseStats, rng, false, {
    ignoreLogCrit: true,
    extraCrit: -1,
  });
  assert.equal(roll.isMiss, false);
  assert.equal(roll.isCrit, false);
  // 220 + 0.67 * 850 = 789.5 at min roll; max = 221 + 569.5 = 790.5
  assert.ok(roll.amount >= 789 && roll.amount <= 791, `got ${roll.amount}`);
});

test("0.67 vs 0.30 SP coeff at phase 2 SP (~850)", () => {
  const sp = 850;
  const oldBase = 220.5 + 0.3 * sp;
  const newBase = 220.5 + 0.67 * sp;
  const ratio = newBase / oldBase;
  assert.ok(ratio > 1.55 && ratio < 1.68, `ratio ${ratio}`);
});

test("infernalContext applies Black Magic and Doomsayer to Chaos", () => {
  const chaos = loadChaos();
  const ctx = infernalContext(chaos, baseStats, {
    innerDemon: true,
    baneOfFire: true,
    maliceCritRemain: 0,
    felshockHitRemain: 0,
    energy: 100,
    chaoticStacks: 0,
    reckoningStacks: 0,
    guaranteedCrit: false,
    potionSpellPower: 0,
    targetStartHealth: 1,
    targetHealthDecays: false,
    fightTime: 0,
    fightDuration: 180,
    vulnerable: false,
  });
  assert.ok((ctx.damageDone ?? 1) > 1.4, "Inner Demon + Black Magic + Doomsayer stack");
  assert.equal(ctx.damageTakenFromCaster, 1.2, "Bane of Fire +20% damage taken");
});

test("Chaos at phase 2 SP lands near log-derived crit averages at 0.67 coeff", () => {
  const stats = applyTakenTalents(
    buildCharacter({}, 0.15, { ...felswornBaseStats(), spellPower: 850, spellHit: 17, spellCrit: 45 }),
    undefined,
    { demonfirePact: true },
  );
  const once = runOnce(spells, stats, 180, new Rng(1), {
    potionSpellPower: 75,
    potionMode: "prepot-and-second",
    vulnerable: true,
    tailwind: true,
    arcaneArtillery: true,
    neptulonsWrath: true,
  });
  const chaos = once.castEvents.filter((e) => e.spell === "Chaos" && e.damage > 0);
  const crits = chaos.filter((e) => e.result === "crit");
  const avgCrit = crits.reduce((sum, e) => sum + e.damage, 0) / crits.length;
  assert.ok(avgCrit > 4000 && avgCrit < 5000, `avg crit ${avgCrit.toFixed(0)}`);
});
