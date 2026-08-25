import fs from "node:fs";
import { runOnce } from "../src/sim/infernal.ts";
import { Rng } from "../src/sim/rng.ts";
import { buildCharacter } from "../src/sim/stats.ts";
import { applyTakenTalents } from "../src/talents/taken.ts";
import { felswornBaseStats } from "../src/talents/felsworn.ts";

const db = JSON.parse(fs.readFileSync("data/spells.json", "utf8"));
const spells = db.spells;
const stats = applyTakenTalents(
  buildCharacter({}, 0.15, { ...felswornBaseStats(), spellPower: 644 }),
  undefined,
  { demonfirePact: true },
);
const sum = { any: 0, one: 0, two: 0, three: 0 };
const n = 100;

for (let i = 0; i < n; i++) {
  const once = runOnce(spells, stats, 180, new Rng(9000 + i), { demonfirePact: true });
  const f = once.fightSec;
  sum.any += (once.auraSeconds.get("Chaotic") || 0) / f;
  sum.one += (once.auraSeconds.get("Chaotic (1 stack)") || 0) / f;
  sum.two += (once.auraSeconds.get("Chaotic (2 stacks)") || 0) / f;
  sum.three += (once.auraSeconds.get("Chaotic (3 stacks)") || 0) / f;
}

console.log(
  JSON.stringify(
    {
      n,
      logTarget: { any: "80-85%" },
      sim: {
        uptimePct: {
          any: (sum.any / n) * 100,
          one: (sum.one / n) * 100,
          two: (sum.two / n) * 100,
          three: (sum.three / n) * 100,
        },
      },
    },
    null,
    2,
  ),
);
