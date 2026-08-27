import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { infernalContext, INFERNAL } from "../src/talents/infernal.ts";
import type { SpellDb } from "../src/types.ts";

const spells = (JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb).spells;
const fireball = spells["501288"];

test("Sun's Hope/Potency adds +3% crit when enabled", () => {
  const off = infernalContext(fireball, { spellCrit: 40 } as never, {
    innerDemon: false,
    baneOfFire: false,
    maliceCritRemain: 0,
    felshockHitRemain: 0,
    energy: 100,
    chaoticStacks: 0,
    reckoningStacks: 0,
    guaranteedCrit: false,
    potionSpellPower: 0,
    targetStartHealth: 1,
    targetHealthDecays: false,
    fightTime: 0,
    fightDuration: 180,
    vulnerable: false,
    sunsHopePotency: false,
  });
  const on = infernalContext(fireball, { spellCrit: 40 } as never, {
    innerDemon: false,
    baneOfFire: false,
    maliceCritRemain: 0,
    felshockHitRemain: 0,
    energy: 100,
    chaoticStacks: 0,
    reckoningStacks: 0,
    guaranteedCrit: false,
    potionSpellPower: 0,
    targetStartHealth: 1,
    targetHealthDecays: false,
    fightTime: 0,
    fightDuration: 180,
    vulnerable: false,
    sunsHopePotency: true,
  });
  assert.equal((on.extraCrit ?? 0) - (off.extraCrit ?? 0), INFERNAL.sunsHopePotencyCrit);
});
