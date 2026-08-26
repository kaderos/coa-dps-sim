import assert from "node:assert/strict";
import test from "node:test";
import { Rng } from "../src/sim/rng.ts";
import {
  ARCANE_ARTILLERY,
  arcaneArtilleryEquipped,
  tryArcaneArtilleryProc,
} from "../src/sim/arcane-artillery.ts";
import { runOnce } from "../src/sim/infernal.ts";

test("arcaneArtilleryEquipped matches enchant on mainhand", () => {
  const enchant = {
    id: 96869812,
    name: "Arcane Artillery",
    slots: ["mainhand", "offhand"],
    weapon: "onehand" as const,
    stats: { spellPower: 0 } as never,
  };
  const item = { id: 1, name: "Sword", slot: "mainhand" as const, stats: {} as never };
  assert.equal(
    arcaneArtilleryEquipped({ mainhand: item }, { mainhand: enchant }),
    true,
  );
  assert.equal(arcaneArtilleryEquipped({}, {}), false);
});

test("arcaneArtilleryEquipped matches enchant on staff / two-hand mainhand", () => {
  const enchant = {
    id: 96869812,
    name: "Arcane Artillery",
    slots: ["mainhand", "offhand"],
    weapon: null,
    stats: { spellPower: 0 } as never,
  };
  const staff = {
    id: 2,
    name: "Staff of Fire",
    slot: "mainhand" as const,
    armorType: "Staves",
    stats: {} as never,
  };
  const twoHand = {
    id: 3,
    name: "Greatsword",
    slot: "mainhand" as const,
    equipSlot: "Two-Hand",
    stats: {} as never,
  };
  assert.equal(
    arcaneArtilleryEquipped({ mainhand: staff }, { mainhand: enchant }),
    true,
  );
  assert.equal(
    arcaneArtilleryEquipped({ mainhand: twoHand }, { mainhand: enchant }),
    true,
  );
});

test("Arcane Artillery proc respects 19s weapon ICD", () => {
  const state = {
    time: 0,
    arcaneArtilleryEnabled: true,
    arcaneArtillery: { remain: ARCANE_ARTILLERY.duration, stacks: 1 },
    weaponProcIcdReadyAt: ARCANE_ARTILLERY.icd,
  };
  state.time = state.weaponProcIcdReadyAt - 0.1;
  tryArcaneArtilleryProc(state, new Rng(1));
  assert.equal(state.arcaneArtillery?.remain, ARCANE_ARTILLERY.duration);
  assert.equal(state.weaponProcIcdReadyAt, ARCANE_ARTILLERY.icd);
});

test("Arcane Artillery rolls once per ICD window, not every cast", () => {
  const state = {
    time: 0,
    arcaneArtilleryEnabled: true,
    arcaneArtillery: null as { remain: number; stacks: number } | null,
    weaponProcIcdReadyAt: 0,
  };
  tryArcaneArtilleryProc(state, new Rng(1));
  const nextIcd = state.weaponProcIcdReadyAt;
  state.time = 1;
  tryArcaneArtilleryProc(state, new Rng(1));
  assert.equal(state.weaponProcIcdReadyAt, nextIcd);
});

test("Arcane Artillery uptime near 63% over 3 min", () => {
  const spells = {
    "501288": {
      id: 501288,
      name: "Fel Fireball",
      role: "filler",
      energy: 35,
      gcd: 1,
      castTime: 2,
      observed: null,
      fit: { base: 800, coeff: 0.62, spellPowerUsed: 0 },
      formula: { source: "test", min: 800, max: 800, perLevel: 0, coeff: 0.62 },
    },
  };
  const stats = {
    spellPower: 0,
    firePower: 0,
    shadowPower: 0,
    spellCrit: 0,
    spellHit: 16,
    spellHaste: 0,
    energy: 100,
    energyMax: 100,
    felfury: 0,
    felfuryMax: 6,
    hiddenPower: 0,
    intellect: 0,
    spirit: 0,
    attackPower: 0,
  };
  let buffSec = 0;
  const runs = 40;
  for (let i = 0; i < runs; i++) {
    const rng = new Rng(1000 + i);
    const once = runOnce(spells, stats, 180, rng, { arcaneArtillery: true });
    buffSec += once.auraSeconds.get(ARCANE_ARTILLERY.name) ?? 0;
  }
  const uptime = buffSec / (runs * 180);
  assert.ok(uptime > 0.56, `uptime ${uptime} too low`);
  assert.ok(uptime < 0.7, `uptime ${uptime} too high`);
});
