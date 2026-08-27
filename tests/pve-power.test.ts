import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clampPvePower, PVE_POWER_MAX } from "../src/buffs.ts";
import { applyPvePowerDamage, runOnce } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter } from "../src/sim/stats.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import type { SpellDb } from "../src/types.ts";

const spells = (JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb).spells;

test("clampPvePower bounds 0–24 with default 24", () => {
  assert.equal(PVE_POWER_MAX, 24);
  assert.equal(clampPvePower(24), 24);
  assert.equal(clampPvePower(0), 0);
  assert.equal(clampPvePower(99), 24);
  assert.equal(clampPvePower(Number.NaN), 24);
});

test("applyPvePowerDamage scales positive damage only", () => {
  assert.equal(applyPvePowerDamage(1000, 24), 1240);
  assert.equal(applyPvePowerDamage(1000, 0), 1000);
  assert.equal(applyPvePowerDamage(0, 24), 0);
});

test("24% PVE Power increases total fight damage vs 0%", () => {
  const stats = applyTakenTalents(
    buildCharacter({}, 0.15, { ...felswornBaseStats(), spellPower: 850, spellHit: 17 }),
    undefined,
    { demonfirePact: true },
  );
  const base = runOnce(spells, stats, 60, new Rng(3), { pvePowerPct: 0 });
  const boosted = runOnce(spells, stats, 60, new Rng(3), { pvePowerPct: 24 });
  const pveScaledDamage = (once: typeof base) => {
    let total = once.damage;
    total -= once.bySpell.get("Ruin")?.damage ?? 0;
    total -= once.bySpell.get("Ruin (DoT)")?.damage ?? 0;
    return total;
  };
  assert.ok(pveScaledDamage(base) > 0);
  assert.ok(
    Math.abs(pveScaledDamage(boosted) / pveScaledDamage(base) - 1.24) < 0.02,
    `ratio ${pveScaledDamage(boosted) / pveScaledDamage(base)}`,
  );
});

test("Ruin and Ruin DoT ignore PVE Power", () => {
  const stats = applyTakenTalents(
    buildCharacter({}, 0.15, { ...felswornBaseStats(), spellPower: 850, spellHit: 17, spellCrit: 45 }),
    undefined,
    { demonfirePact: true },
  );
  const opts = {
    potionSpellPower: 75,
    potionMode: "prepot-and-second" as const,
    vulnerable: true,
    tailwind: true,
  };
  const without = runOnce(spells, stats, 180, new Rng(5), { ...opts, pvePowerPct: 0 });
  const withPve = runOnce(spells, stats, 180, new Rng(5), { ...opts, pvePowerPct: 24 });
  const ruinDamage = (once: typeof without) =>
    (once.bySpell.get("Ruin")?.damage ?? 0) + (once.bySpell.get("Ruin (DoT)")?.damage ?? 0);
  assert.ok(ruinDamage(without) > 0);
  assert.equal(ruinDamage(without), ruinDamage(withPve));
});
