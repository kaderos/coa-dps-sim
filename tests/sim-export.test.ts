import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_BUFFS } from "../src/buffs.ts";
import { runSim } from "../src/sim/engine.ts";
import { buildCharacter } from "../src/sim/stats.ts";
import {
  buildSimExportDocument,
  SIM_EXPORT_SCHEMA,
  SIM_EXPORT_VERSION,
} from "../src/sim-export.ts";
import { defaultTalentSelection } from "../src/talents/baseline.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import type { SimConfig, SpellDb } from "../src/types.ts";

const spells = (JSON.parse(readFileSync("data/spells.json", "utf8")) as SpellDb).spells;
const felswornTalents = JSON.parse(readFileSync("data/talents/felsworn.json", "utf8"));
const infernalTalents = JSON.parse(readFileSync("data/talents/infernal.json", "utf8"));
const talentTrees = { felsworn: felswornTalents, infernal: infernalTalents };
const talentSelection = defaultTalentSelection(talentTrees);

test("buildSimExportDocument embeds verifiable configuration", () => {
  const combatStats = buildCharacter({}, 0.15, { spellPower: 850, spellHit: 17, intellect: 120, spirit: 80 });
  const displayStats = applyTakenTalents(combatStats, talentSelection, DEFAULT_BUFFS);
  const simConfig: SimConfig = {
    durationSec: 60,
    iterations: 4,
    seed: 7,
    fightStyle: "stationary",
    playerLevel: 60,
    bossLevel: 63,
    allowCleave: false,
    movement: false,
    potionSpellPower: 0,
    potionDuration: 20,
    potionMode: "none",
    talentSelection,
    pvePower: 24,
    targetHealthDecays: true,
  };
  const result = runSim(spells, combatStats, simConfig, null, null);
  const doc = buildSimExportDocument({
    result,
    simConfig,
    combatStats,
    displayStats,
    gear: {},
    enchants: {},
    buffs: DEFAULT_BUFFS,
    talentSelection,
    talentTrees,
    pullFelfury: 3,
  });

  assert.equal(doc.schema, SIM_EXPORT_SCHEMA);
  assert.equal(doc.schemaVersion, SIM_EXPORT_VERSION);
  assert.ok(doc.exportedAt);
  assert.equal(doc.simulator.version, "0.1.0");
  assert.equal(doc.encounter.seed, 7);
  assert.equal(doc.encounter.pullFelfury, 3);
  assert.equal(doc.buffs.pvePower, 24);
  assert.equal(doc.simConfig.pvePower, 24);
  assert.ok(doc.character.combatStats.spellPower > 0);
  assert.equal(typeof doc.character.breakdowns.spellPower.total, "number");
  assert.ok(doc.character.chanceBreakdown.crit.total >= 0);
  assert.ok(Array.isArray(doc.talents.felsworn) && doc.talents.felsworn.length > 0);
  assert.ok(Array.isArray(doc.talents.infernal) && doc.talents.infernal.length > 0);
  assert.ok(doc.talents.infernal.some((t) => typeof t.enabled === "boolean" && typeof t.rank === "number"));
  assert.equal(doc.results.meanDps, result.meanDps);
  assert.ok(Array.isArray(doc.castLog));
  assert.ok(doc.castLog.length > 0);
});
