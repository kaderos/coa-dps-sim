import assert from "node:assert/strict";
import test from "node:test";
import { effectiveSpellPower, emptyStats } from "../src/sim/stats.ts";

const AP_COEFF = 0.35;
const SP_COEFF = 1.5;
const CRIT_MULT = 2.454364267263334;

function neptulonsWrathBase(stats: ReturnType<typeof emptyStats> & { hiddenPower?: number }): number {
  const ap = stats.attackPower ?? 0;
  const sp = effectiveSpellPower(stats, stats.hiddenPower ?? 0);
  return ap * AP_COEFF + sp * SP_COEFF;
}

test("Neptulon's Wrath base includes spell power, not just attack power", () => {
  const apOnly = neptulonsWrathBase({ ...emptyStats(), attackPower: 232 });
  const withSp = neptulonsWrathBase({
    ...emptyStats(),
    attackPower: 232,
    spellPower: 900,
    firePower: 400,
    intellect: 120,
    spirit: 80,
    hiddenPower: 0.15,
  });
  assert.ok(withSp > apOnly * 5, `expected SP to dominate; apOnly=${apOnly} withSp=${withSp}`);
});

test("Neptulon's Wrath avg hit at ~1600 effective SP", () => {
  const base = neptulonsWrathBase({
    ...emptyStats(),
    attackPower: 232,
    spellPower: 800,
    firePower: 800,
    intellect: 180,
    spirit: 120,
    hiddenPower: 0.15,
  });
  const critRate = 0.49;
  const avg = base * (1 - critRate + critRate * CRIT_MULT);
  assert.ok(avg > 3800, `avg ${avg.toFixed(0)} too low at 150% SP`);
  assert.ok(avg < 5400, `avg ${avg.toFixed(0)} too high at 150% SP`);
});
