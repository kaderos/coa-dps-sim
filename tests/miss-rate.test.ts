import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { runOnce } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter, spellMissChance } from "../src/sim/stats.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";

const db = JSON.parse(fs.readFileSync("data/spells.json", "utf8"));
const spells = db.spells as Record<string, import("../src/types.ts").SpellFit>;

const hitTestSelection = {
  felsworn: {},
  infernal: { "Wrath of Sargeras": false, Felshock: false },
} as const;

function statsWithSpellHit(spellHit: number) {
  return applyTakenTalents(
    buildCharacter({}, 0.15, { ...felswornBaseStats(), spellPower: 644, spellHit }),
    hitTestSelection,
    { demonfirePact: true },
  );
}

function observedMissRate(spellHit: number, iterations: number, seed: number): number {
  const stats = statsWithSpellHit(spellHit);
  let attempted = 0;
  let missed = 0;
  for (let i = 0; i < iterations; i++) {
    const once = runOnce(spells, stats, 180, new Rng(seed + i * 7919), {
      demonfirePact: true,
      talentSelection: hitTestSelection,
    });
    attempted += once.offensiveCastsAttempted;
    missed += once.offensiveCastsMissed;
  }
  return attempted > 0 ? missed / attempted : 0;
}

describe("independent hit rolls", () => {
  it("converges toward the calculated miss chance over many rolls", () => {
    const seed = 9001;
    const iterations = 50_000;
    for (const hit of [0, 13, 16, 17]) {
      const expected = spellMissChance(hit);
      let misses = 0;
      for (let i = 0; i < iterations; i++) {
        const rng = new Rng(seed + hit * 1000 + i);
        if (rng.chance(expected)) misses += 1;
      }
      const observed = misses / iterations;
      assert.ok(
        Math.abs(observed - expected) < 0.005,
        `${hit}% hit expected ${(expected * 100).toFixed(1)}% miss, observed ${(observed * 100).toFixed(2)}%`,
      );
    }
  });
});

describe("simulated offensive miss rates", () => {
  const seed = 4242;
  const iterations = 400;

  it("converges toward 0% misses at or above the 17% hit cap", () => {
    const rate = observedMissRate(17, iterations, seed);
    assert.ok(rate < 0.005, `expected ~0% misses at 17% hit, got ${(rate * 100).toFixed(2)}%`);
  });

  it("converges toward 1% misses at 16% hit", () => {
    const expected = spellMissChance(16);
    const rate = observedMissRate(16, iterations, seed + 1000);
    assert.ok(
      Math.abs(rate - expected) < 0.008,
      `expected ~${(expected * 100).toFixed(1)}% misses at 16% hit, got ${(rate * 100).toFixed(2)}%`,
    );
  });

  it("converges toward 4% misses at 13% hit", () => {
    const expected = spellMissChance(13);
    const rate = observedMissRate(13, iterations, seed + 2000);
    assert.ok(
      Math.abs(rate - expected) < 0.012,
      `expected ~${(expected * 100).toFixed(1)}% misses at 13% hit, got ${(rate * 100).toFixed(2)}%`,
    );
  });

  it("converges toward 17% misses at 0% hit", () => {
    const expected = spellMissChance(0);
    const rate = observedMissRate(0, iterations, seed + 3000);
    assert.ok(
      Math.abs(rate - expected) < 0.02,
      `expected ~${(expected * 100).toFixed(1)}% misses at 0% hit, got ${(rate * 100).toFixed(2)}%`,
    );
  });
});
