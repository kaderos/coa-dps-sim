import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { effectiveGcdSec, GCD_MIN_SEC, runOnce, spellLockoutSec } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter } from "../src/sim/stats.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import type { SimCastEvent, SpellDb } from "../src/types.ts";

const spells = (JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb).spells;

const GCD_SPELLS = new Set(["Fel Fireball", "Ruin", "Sargeron Smite", "Bane of Fire"]);

test("effectiveGcdSec never drops below 1 second", () => {
  assert.equal(GCD_MIN_SEC, 1);
  assert.equal(effectiveGcdSec(1, 1), 1);
  assert.equal(effectiveGcdSec(1, 2), 1);
  assert.equal(effectiveGcdSec(1, 4), 1);
  assert.equal(effectiveGcdSec(0, 2), 0);
});

test("spellLockoutSec uses GCD when cast time is shorter", () => {
  assert.equal(spellLockoutSec(1, 0.6, 0), 1);
  assert.equal(spellLockoutSec(1, 1.4, 0), 1.4);
  assert.ok(Math.abs(spellLockoutSec(0, 0.1, 0.05) - 0.15) < 1e-9);
});

test("sim spaces GCD spells at least 1 second apart when cast time is hasted below 1s", () => {
  const stats = applyTakenTalents(
    buildCharacter({}, 0.15, {
      ...felswornBaseStats(),
      spellPower: 850,
      spellHit: 17,
      spellHaste: 150,
      spellCrit: 45,
    }),
    undefined,
    { demonfirePact: true },
  );
  const once = runOnce(spells, stats, 120, new Rng(7), {
    tailwind: true,
    tempestsCall: true,
    vulnerable: true,
    arcaneArtillery: true,
  });
  const gcdCasts = once.castEvents.filter(
    (event): event is SimCastEvent =>
      event.kind !== "tick" &&
      event.kind !== "aura" &&
      GCD_SPELLS.has(event.spell) &&
      event.result !== "applied",
  );
  assert.ok(gcdCasts.length > 5, "expected several GCD spell casts");
  for (let i = 1; i < gcdCasts.length; i++) {
    const gap = gcdCasts[i].timestamp - gcdCasts[i - 1].timestamp;
    assert.ok(
      gap + 0.051 >= GCD_MIN_SEC,
      `${gcdCasts[i - 1].spell} → ${gcdCasts[i].spell} at ${gcdCasts[i - 1].timestamp}s only ${gap.toFixed(3)}s later`,
    );
  }
});

test("Fel Fireball with sub-1s cast time still respects 1s GCD spacing", () => {
  const stats = applyTakenTalents(
    buildCharacter({}, 0.15, {
      ...felswornBaseStats(),
      spellPower: 850,
      spellHit: 17,
      spellHaste: 200,
      spellCrit: 45,
    }),
    undefined,
    { demonfirePact: true },
  );
  const once = runOnce(spells, stats, 90, new Rng(11), {
    tailwind: true,
    tempestsCall: true,
  });
  const fireballs = once.castEvents.filter(
    (event) => event.spell === "Fel Fireball" && (event.castTimeSec ?? 0) > 0 && (event.castTimeSec ?? 99) < 1,
  );
  assert.ok(fireballs.length > 0, "expected hasted Fel Fireballs under 1s cast time");
  const times = once.castEvents
    .filter((event) => event.spell === "Fel Fireball" && event.kind === "cast" && event.result !== "applied")
    .map((event) => event.timestamp);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] + 0.051 >= GCD_MIN_SEC, `Fireballs only ${(times[i] - times[i - 1]).toFixed(3)}s apart`);
  }
});
