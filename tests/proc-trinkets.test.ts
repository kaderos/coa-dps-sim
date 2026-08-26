import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/types.ts";
import {
  DEFAULT_PROC_CHANCE,
  DEFAULT_PROC_ICD_SEC,
  createProcTrinketState,
  describeProcTrinketBuff,
  equippedProcTrinkets,
  parseProcTrinketFromItem,
  procTrinketContextModifiers,
  tickProcTrinketBuffs,
  tryProcTrinketProcs,
} from "../src/sim/proc-trinkets.ts";
import { Rng } from "../src/sim/rng.ts";

const lightOfHighborne: Item = {
  id: 1386106,
  name: "Light of the Highborne",
  slot: "trinket",
  quality: "Epic",
  stats: { spellHaste: 22 },
  effects: [
    "Equip: Improves haste rating by 22.",
    "Equip: Direct magic damage has a 3% chance to increase your Spell Power by 65 for 10 sec. (15sec. internal cooldown)",
  ],
};

test("parseProcTrinketFromItem reads proc chance, ICD, duration, and modifiers", () => {
  const def = parseProcTrinketFromItem(lightOfHighborne);
  assert.ok(def);
  assert.equal(def?.procChance, 0.03);
  assert.equal(def?.icdSec, 15);
  assert.equal(def?.durationSec, 10);
  assert.equal(def?.modifiers.spellPower, 65);
  assert.equal(def?.trigger, "direct-spell");
});

test("parseProcTrinketFromItem uses defaults when chance and ICD are omitted", () => {
  const item: Item = {
    id: 1,
    name: "Eye of Moam",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: ["Equip: Chance on dealing direct spell damage to increase your spell power by 174 for 10 sec."],
  };
  const def = parseProcTrinketFromItem(item);
  assert.ok(def);
  assert.equal(def?.procChance, DEFAULT_PROC_CHANCE);
  assert.equal(def?.icdSec, DEFAULT_PROC_ICD_SEC);
});

test("parseProcTrinketFromItem skips non-epic and healing procs", () => {
  assert.equal(parseProcTrinketFromItem({ ...lightOfHighborne, quality: "Rare" }), null);
  const heal: Item = {
    id: 2,
    name: "Ancient Sea-dweller Charm",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: ["Equip: Your healing over time effects have a 6% chance to increase your spirit by 65 for 12 sec."],
  };
  assert.equal(parseProcTrinketFromItem(heal), null);
});

test("equippedProcTrinkets detects modeled trinkets in both slots", () => {
  const equipped = equippedProcTrinkets({
    trinket1: lightOfHighborne,
    trinket2: {
      id: 241875,
      name: "Witching Hourglass",
      slot: "trinket",
      quality: "Epic",
      stats: {},
      effects: [
        "Equip: Your direct damage and healing spells have a chance to increase your haste rating by 150 for 10 sec. (45 sec cd)",
      ],
    },
  });
  assert.equal(equipped.length, 2);
});

test("proc trinket does not start ICD on failed proc", () => {
  const item: Item = {
    id: 10,
    name: "Never Procs",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: ["Equip: 0% chance on dealing direct spell damage to increase your spell power by 50 for 10 sec."],
  };
  const equipped = equippedProcTrinkets({ trinket1: item });
  const state = createProcTrinketState(equipped);
  const spell = { id: 1, name: "Test", role: "filler", gcd: 1, castTime: 2, observed: null, fit: { base: 0, coeff: 0, spellPowerUsed: 0 } };
  tryProcTrinketProcs(state, "direct-spell", 0, new Rng(1), spell);
  tryProcTrinketProcs(state, "direct-spell", 1, new Rng(1), spell);
  assert.equal(state.icdReadyAt["trinket1:10"], undefined);
  assert.equal(state.activeBuffs.length, 0);
});

test("proc trinket starts ICD only after a successful proc", () => {
  const item: Item = {
    id: 99,
    name: "Always Procs",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: [
      "Equip: 100% chance on dealing direct spell damage to increase your spell power by 50 for 10 sec. (60 sec. internal cooldown)",
    ],
  };
  const equipped = equippedProcTrinkets({ trinket1: item });
  const state = createProcTrinketState(equipped);
  const spell = { id: 1, name: "Test", role: "filler", gcd: 1, castTime: 2, observed: null, fit: { base: 0, coeff: 0, spellPowerUsed: 0 } };
  const first = tryProcTrinketProcs(state, "direct-spell", 0, new Rng(1), spell);
  assert.equal(first.length, 1);
  assert.equal(state.icdReadyAt["trinket1:99"], 60);
  const blocked = tryProcTrinketProcs(state, "direct-spell", 30, new Rng(1), spell);
  assert.equal(blocked.length, 0);
  const second = tryProcTrinketProcs(state, "direct-spell", 60, new Rng(1), spell);
  assert.equal(second.length, 1);
});

test("tryProcTrinketProcs returns activated proc defs", () => {
  const item: Item = {
    id: 99,
    name: "Always Procs",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: ["Equip: 100% chance on dealing direct spell damage to increase your spell power by 50 for 10 sec."],
  };
  const equipped = equippedProcTrinkets({ trinket1: item });
  const state = createProcTrinketState(equipped);
  const spell = { id: 1, name: "Test", role: "filler", gcd: 1, castTime: 2, observed: null, fit: { base: 0, coeff: 0, spellPowerUsed: 0 } };
  const activated = tryProcTrinketProcs(state, "direct-spell", 0, new Rng(1), spell);
  assert.equal(activated.length, 1);
  assert.equal(activated[0]?.name, "Always Procs");
});

test("proc trinket buff applies spell power to combat context", () => {
  const equipped = equippedProcTrinkets({ trinket1: lightOfHighborne });
  const state = createProcTrinketState(equipped);
  state.activeBuffs.push({
    slot: "trinket1",
    def: equipped[0]!.def,
    remain: 10,
    stacks: 1,
  });
  assert.equal(procTrinketContextModifiers(state).spellPower, 65);
});

test("describeProcTrinketBuff includes proc stats and timing", () => {
  const def = parseProcTrinketFromItem(lightOfHighborne);
  assert.ok(def);
  const hint = describeProcTrinketBuff(def!);
  assert.match(hint, /\+65 Spell Power/);
  assert.match(hint, /3% proc/);
  assert.match(hint, /15s ICD/);
});

const insigniaOfTheDragon: Item = {
  id: 218215,
  name: "Insignia of the Dragon",
  slot: "trinket",
  quality: "Epic",
  stats: {},
  effects: [
    "Equip: Your direct healing and damaging spells increase your Spell Power by 4 for 10 seconds, stacks up to 15 times",
  ],
};

test("Insignia of the Dragon parses as stack-on-direct", () => {
  const def = parseProcTrinketFromItem(insigniaOfTheDragon);
  assert.ok(def);
  assert.equal(def?.behavior, "stack-on-direct");
  assert.equal(def?.spellPowerPerStack, 4);
  assert.equal(def?.maxStacks, 15);
  assert.equal(def?.durationSec, 10);
  assert.equal(def?.trigger, "direct-spell");
});

test("Insignia of the Dragon stacks on each direct spell without proc roll", () => {
  const equipped = equippedProcTrinkets({ trinket1: insigniaOfTheDragon });
  const state = createProcTrinketState(equipped);
  const spell = { id: 1, name: "Test", role: "filler", gcd: 1, castTime: 2, observed: null, fit: { base: 0, coeff: 0, spellPowerUsed: 0 } };
  for (let i = 0; i < 5; i++) {
    tryProcTrinketProcs(state, "direct-spell", i, new Rng(1), spell);
  }
  assert.equal(state.activeBuffs.length, 1);
  assert.equal(state.activeBuffs[0]?.stacks, 5);
  assert.equal(procTrinketContextModifiers(state).spellPower, 20);
});

test("Insignia of the Dragon respects max stacks", () => {
  const equipped = equippedProcTrinkets({ trinket1: insigniaOfTheDragon });
  const state = createProcTrinketState(equipped);
  const spell = { id: 1, name: "Test", role: "filler", gcd: 1, castTime: 2, observed: null, fit: { base: 0, coeff: 0, spellPowerUsed: 0 } };
  for (let i = 0; i < 20; i++) {
    tryProcTrinketProcs(state, "direct-spell", i, new Rng(1), spell);
  }
  assert.equal(state.activeBuffs[0]?.stacks, 15);
  assert.equal(procTrinketContextModifiers(state).spellPower, 60);
});

test("Insignia of the Dragon describe shows stack total", () => {
  const def = parseProcTrinketFromItem(insigniaOfTheDragon);
  assert.ok(def);
  const hint = describeProcTrinketBuff(def!, 8);
  assert.match(hint, /8 stacks/);
  assert.match(hint, /\+32 Spell Power/);
  assert.doesNotMatch(hint, /75% proc/);
});

test("proc trinket buff expires after duration", () => {
  const equipped = equippedProcTrinkets({ trinket1: lightOfHighborne });
  const state = createProcTrinketState(equipped);
  state.activeBuffs.push({
    slot: "trinket1",
    def: equipped[0]!.def,
    remain: 10,
    stacks: 1,
  });
  tickProcTrinketBuffs(state, 10);
  assert.equal(state.activeBuffs.length, 0);
});

test("Spellbound Demonic Rune parses spell damage proc and once-per-min ICD", () => {
  const item: Item = {
    id: 999,
    name: "Spellbound Demonic Rune",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: [
      "Equip: Improves hit rating by 24.",
      "Equip: Your damaging spells have a chance to increase your spell damage by 80 for 10 sec. Can only occur once per min.",
    ],
  };
  const def = parseProcTrinketFromItem(item);
  assert.ok(def);
  assert.equal(def?.modifiers.spellPower, 80);
  assert.equal(def?.icdSec, 60);
  assert.equal(def?.durationSec, 10);
  assert.equal(def?.trigger, "direct-spell");
});

test("equippedProcTrinkets resolves items through findItem", () => {
  const dbItem: Item = {
    id: 218215,
    name: "Insignia of the Dragon",
    slot: "trinket",
    quality: "Epic",
    stats: {},
    effects: insigniaOfTheDragon.effects,
  };
  const equipped = equippedProcTrinkets(
    { trinket1: { id: 218215, name: "Insignia of the Dragon", slot: "trinket", stats: {} } },
    (id) => (id === 218215 ? dbItem : undefined),
  );
  assert.equal(equipped.length, 1);
  assert.equal(equipped[0]?.def.behavior, "stack-on-direct");
});
