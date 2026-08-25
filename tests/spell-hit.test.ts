import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SPELL_HIT_CAP,
  spellHitSummary,
  spellMissChance,
  totalSpellHitPercent,
} from "../src/sim/stats.ts";

describe("spellMissChance", () => {
  it("matches clamp(17% - totalSpellHit, 0%, 17%)", () => {
    const cases = [
      { hit: 17, miss: 0 },
      { hit: 18, miss: 0 },
      { hit: 16, miss: 0.01 },
      { hit: 13, miss: 0.04 },
      { hit: 10, miss: 0.07 },
      { hit: 0, miss: 0.17 },
    ];
    for (const { hit, miss } of cases) {
      assert.equal(spellMissChance(hit), miss, `${hit}% hit → ${miss * 100}% miss`);
    }
  });

  it("includes temporary extra hit such as Felshock", () => {
    assert.equal(spellMissChance(13, true, 3), 0.01);
    assert.equal(totalSpellHitPercent(13, 3), 16);
  });

  it("never returns a miss chance above the base 17% cap", () => {
    assert.equal(spellMissChance(-10), SPELL_HIT_CAP / 100);
  });

  it("returns zero miss chance for non-missable rolls", () => {
    assert.equal(spellMissChance(0, false), 0);
  });
});

describe("spellHitSummary", () => {
  it("reports total hit and calculated miss chance together", () => {
    assert.deepEqual(spellHitSummary(16), {
      totalSpellHitPercent: 16,
      calculatedMissChance: 0.01,
    });
  });
});

describe("buff and debuff hit changes", () => {
  it("removing 1% hit increases miss chance by one percentage point below the cap", () => {
    const withRacial = spellMissChance(16);
    const withoutRacial = spellMissChance(15);
    assert.equal(withRacial - withoutRacial, -0.01);
  });

  it("removing 1% racial and 3% debuff increases miss chance by four percentage points", () => {
    const before = spellMissChance(16);
    const after = spellMissChance(12);
    assert.equal(before - after, -0.04);
  });

  it("does not increase miss chance when already at the hit cap", () => {
    assert.equal(spellMissChance(17), 0);
    assert.equal(spellMissChance(18), 0);
    assert.equal(spellMissChance(20), 0);
  });
});
