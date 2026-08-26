import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/types.ts";
import {
  DEFAULT_TRINKET_BUFF_DURATION_SEC,
  TRINKET_SHARED_BLOCK_SEC,
  createOnUseTrinketState,
  equippedOnUseTrinkets,
  parseOnUseTrinketFromItem,
  tickOnUseTrinketBuffs,
  tryUseOnUseTrinketsWithAnnihilation,
} from "../src/sim/on-use-trinkets.ts";

const sapphironItem: Item = {
  id: 223046,
  name: "The Restrained Essence of Sapphiron",
  slot: "trinket",
  stats: { spellPower: 40 },
  effects: ["Use: Increases spell power by 161 for 20 sec. (2 Min Cooldown)"],
};

test("parseOnUseTrinketFromItem reads spell power, duration, and cooldown", () => {
  const def = parseOnUseTrinketFromItem(sapphironItem);
  assert.ok(def);
  assert.equal(def?.modifiers?.spellPower, 161);
  assert.equal(def?.durationSec, 20);
  assert.equal(def?.cooldownSec, 120);
});

test("parseOnUseTrinketFromItem defaults duration to 10s when omitted", () => {
  const item: Item = {
    id: 1,
    name: "Test Trinket",
    slot: "trinket",
    stats: {},
    effects: ["Use: Increases spell power by 50. (2 Min Cooldown)"],
  };
  const def = parseOnUseTrinketFromItem(item);
  assert.ok(def);
  assert.equal(def?.durationSec, DEFAULT_TRINKET_BUFF_DURATION_SEC);
});

test("equippedOnUseTrinkets detects modeled trinkets in both slots", () => {
  const equipped = equippedOnUseTrinkets({
    trinket1: sapphironItem,
    trinket2: {
      id: 2,
      name: "Crit Trinket",
      slot: "trinket",
      stats: {},
      effects: ["Use: Increases critical strike chance by 10% for 15 sec. (90 Sec Cooldown)"],
    },
  });
  assert.equal(equipped.length, 2);
});

test("using one on-use trinket blocks the other for 30 seconds", () => {
  const equipped = equippedOnUseTrinkets({ trinket1: sapphironItem, trinket2: sapphironItem });
  const state = createOnUseTrinketState(equipped);
  const used = tryUseOnUseTrinketsWithAnnihilation(state, 0);
  assert.ok(used);
  assert.equal(state.activeBuffs.length, 1);
  const blocked = tryUseOnUseTrinketsWithAnnihilation(state, 1);
  assert.equal(blocked, null);
  const second = tryUseOnUseTrinketsWithAnnihilation(state, TRINKET_SHARED_BLOCK_SEC);
  assert.ok(second);
});

test("parseOnUseTrinketFromItem parses compound cooldowns", () => {
  const item: Item = {
    id: 317543,
    name: "Hibernation Crystal",
    slot: "trinket",
    stats: {},
    effects: ["Use: Increases spell power by 186 for 15 sec. (1 Min 30 Sec Cooldown)"],
  };
  const def = parseOnUseTrinketFromItem(item);
  assert.ok(def);
  assert.equal(def?.cooldownSec, 90);
  assert.equal(def?.modifiers?.spellPower, 186);
});

test("trinket buff expires after duration", () => {
  const equipped = equippedOnUseTrinkets({ trinket1: sapphironItem });
  const state = createOnUseTrinketState(equipped);
  tryUseOnUseTrinketsWithAnnihilation(state, 0);
  tickOnUseTrinketBuffs(state, 20);
  assert.equal(state.activeBuffs.length, 0);
});

test("trinket activation persists on the passed state object", () => {
  const equipped = equippedOnUseTrinkets({ trinket1: sapphironItem });
  const state = createOnUseTrinketState(equipped);
  tryUseOnUseTrinketsWithAnnihilation(state, 0);
  assert.equal(state.activeBuffs.length, 1);
  assert.equal(state.activeBuffs[0]?.def.name, "The Restrained Essence of Sapphiron");
});
