import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runOnce } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter } from "../src/sim/stats.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import type { SimCastEvent, SpellDb } from "../src/types.ts";

const spells = (JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb).spells;

function runSeed(seed: number) {
  const stats = applyTakenTalents(
    buildCharacter({}, 0.15, {
      ...felswornBaseStats(),
      spellPower: 850,
      spellHit: 17,
      spellCrit: 45,
    }),
    undefined,
    { demonfirePact: true },
  );
  return runOnce(spells, stats, 180, new Rng(seed), {
    potionSpellPower: 75,
    potionMode: "prepot-and-second",
    vulnerable: true,
    tailwind: true,
    arcaneArtillery: true,
  });
}

function felforgedEvents(events: SimCastEvent[]) {
  return events.filter((event) => event.spell === "Felforged" && event.kind === "aura");
}

test("cast log records Felforged applied/refresh/removed lifecycle", () => {
  const once = runSeed(1);
  const events = felforgedEvents(once.castEvents);
  assert.ok(events.length > 0, "expected Felforged aura rows in cast log");
  assert.ok(events.some((event) => event.auraAction === "applied" || event.auraAction === "refresh"));
  for (const event of events) {
    assert.equal(event.kind, "aura");
    assert.ok(event.auraAction);
    assert.equal(event.result, event.auraAction);
    assert.ok(event.triggerSpell, `missing trigger on ${event.auraAction}`);
    assert.ok(event.auraStacks != null, `missing stacks on ${event.auraAction}`);
    assert.ok(event.auraRemainSec != null, `missing remain on ${event.auraAction}`);
  }
});

test("Fel Fireball logs Felforged charges and effective cast time when buff is active", () => {
  const once = runSeed(1);
  const fireballs = once.castEvents.filter(
    (event) =>
      event.spell === "Fel Fireball" &&
      event.felforgedStacksAtCast != null &&
      (event.castTimeSec ?? 0) > 0,
  );
  assert.ok(fireballs.length > 0, "expected at least one Felforged-accelerated Fel Fireball with cast time");
  const sample = fireballs[0];
  assert.ok((sample.baseCastTimeSec ?? 0) > (sample.castTimeSec ?? 0));
  assert.ok(
    sample.activeAuras?.some(
      (aura) => aura.name === "Felforged" && aura.stacks === sample.felforgedStacksAtCast,
    ),
  );
});

test("Felforged proc rows follow periodic ticks", () => {
  const once = runSeed(1);
  const applied = felforgedEvents(once.castEvents).filter((event) => event.auraAction === "applied");
  assert.ok(applied.length > 0);
  for (const event of applied) {
    assert.match(event.triggerSpell ?? "", /Felstrike \(DoT\)|Ruin \(DoT\)/);
  }
});
