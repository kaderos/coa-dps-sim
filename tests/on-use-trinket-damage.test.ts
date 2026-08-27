import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runOnce } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter, statsFromGear } from "../src/sim/stats.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";
import { defaultTalentSelection } from "../src/talents/baseline.ts";
import { equippedOnUseTrinkets } from "../src/sim/on-use-trinkets.ts";
import { rollSpellDamage } from "../src/sim/spells.ts";
import { infernalContext } from "../src/talents/infernal.ts";

const spells = JSON.parse(readFileSync("data/spells.json", "utf8")).spells;
const talentTrees = {
  felsworn: JSON.parse(readFileSync("data/talents/felsworn.json", "utf8")),
  infernal: JSON.parse(readFileSync("data/talents/infernal.json", "utf8")),
};
const talentSelection = defaultTalentSelection(talentTrees);
const ephemeral = {
  id: 218820,
  name: "Talisman of Ephemeral Power",
  slot: "trinket",
  stats: {},
  effects: ["Use: Increases spell power by 217 for 15 sec. (1 Min 30 Sec Cooldown)"],
};
const onUse = equippedOnUseTrinkets({ trinket1: ephemeral });
const stats = applyTakenTalents(
  buildCharacter({ trinket1: ephemeral }, 0.15, { ...felswornBaseStats(), spellPower: 850, spellHit: 17, spellCrit: 30 }),
  talentSelection,
  { demonfirePact: true },
);

test("equipping a trinket with empty stats does not corrupt character stats", () => {
  const gearStats = statsFromGear({ trinket1: ephemeral });
  assert.equal(Number.isNaN(gearStats.spellPower), false);
  assert.equal(Number.isNaN(gearStats.spellHit), false);
  assert.equal(Number.isNaN(stats.spellPower), false);
});
const fireball = spells["501288"];
const baseAuras = {
  innerDemon: true,
  baneOfFire: true,
  maliceCritRemain: 0,
  felshockHitRemain: 0,
  energy: 100,
  chaoticStacks: 0,
  reckoningStacks: 0,
  guaranteedCrit: false,
  potionSpellPower: 75,
  targetStartHealth: 1,
  targetHealthDecays: false,
  fightTime: 30,
  fightDuration: 180,
};
const ctxNo = infernalContext(fireball, stats, baseAuras, talentSelection);
const ctxYes = infernalContext(fireball, stats, { ...baseAuras, trinketSpellPower: 217 }, talentSelection);

test("trinket spell power increases rolled Fel Fireball damage", () => {
  const rng = new Rng(42);
  const noTrinket: number[] = [];
  const withTrinket: number[] = [];
  for (let i = 0; i < 400; i++) {
    noTrinket.push(rollSpellDamage(fireball, stats, rng, true, ctxNo).amount);
    withTrinket.push(rollSpellDamage(fireball, stats, rng, true, ctxYes).amount);
  }
  const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
  assert.ok(avg(withTrinket) > avg(noTrinket) * 1.1, `with ${avg(withTrinket)} vs without ${avg(noTrinket)}`);
});

test("on-use trinket buff increases Fel Fireball hits during sim window", () => {
  const result = runOnce(spells, stats, 180, new Rng(7), {
    onUseTrinkets: onUse,
    potionSpellPower: 75,
    potionMode: "prepot-and-second",
    talentSelection,
    pvePowerPct: 24,
  });
  const trinketName = "Talisman of Ephemeral Power";
  const withBuff: number[] = [];
  const withoutBuff: number[] = [];
  for (const ev of result.castEvents) {
    if (ev.spell !== "Fel Fireball" || (ev.result !== "hit" && ev.result !== "crit")) continue;
    if (ev.activeAuras?.some((a) => a.name === trinketName)) withBuff.push(ev.damage);
    else withoutBuff.push(ev.damage);
  }
  assert.ok(result.castEvents.some((e) => e.spell.includes("Ephemeral")), "trinket should fire with Annihilation");
  assert.ok(withBuff.length > 0, "expected Fel Fireballs during trinket window");
  assert.ok(withoutBuff.length > 0, "expected Fel Fireballs outside trinket window");
  const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
  assert.ok(avg(withBuff) > avg(withoutBuff) * 1.05, `buffed ${avg(withBuff)} vs unbuffed ${avg(withoutBuff)}`);
});
