import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG = path.join(ROOT, "data", "parsed", "kadd-log.json");
const OUT_PUBLIC = path.join(ROOT, "public", "data", "spells.json");
const OUT_DATA = path.join(ROOT, "data", "spells.json");

const OFFICIAL_FORMULAS = {
  501288: {
    source: "db.ascension.gg",
    min: 499,
    max: 532,
    perLevel: 3.51667,
    coeff: 0.6203,
    fireCoeff: 0.62,
    shadowCoeff: 0.62,
    energy: 35,
    castTime: 2,
    gcd: 1,
  },
  501298: {
    source: "db.ascension.gg",
    min: 2163,
    max: 2317,
    perLevel: 12.45,
    coeff: 1.32,
    fireCoeff: 1,
    shadowCoeff: 1.32,
    energy: 30,
    castTime: 2.5,
    gcd: 1,
  },
  805748: {
    source: "db.ascension.gg",
    min: 0,
    max: 0,
    perLevel: 0,
    coeff: 0.3,
    energy: 0,
    castTime: 0,
    gcd: 0,
    interval: 1,
  },
  501321: {
    source: "db.ascension.gg",
    min: 419,
    max: 455,
    perLevel: 11.25,
    perLevelScalesWithPlayer: false,
    coeff: 0.6,
    fireCoeff: 0.6,
    shadowCoeff: 0.6,
    apCoeff: 0.19,
    energy: 0,
    castTime: 0,
    gcd: 1,
  },
  803467: {
    source: "db.ascension.gg",
    min: 419,
    max: 455,
    perLevel: 11.25,
    perLevelScalesWithPlayer: false,
    coeff: 0.6,
    fireCoeff: 0.6,
    shadowCoeff: 0.6,
    apCoeff: 0.19,
    energy: 0,
    castTime: 0,
    gcd: 0,
  },
  802678: {
    source: "db.ascension.gg",
    min: 9,
    max: 9,
    perLevel: 0.5,
    coeff: 0.05,
    energy: 0,
    castTime: 0,
    gcd: 0,
    interval: 1,
  },
  802676: {
    source: "db.ascension.gg",
    min: 220,
    max: 221,
    perLevel: 0,
    coeff: 0.67,
    energy: 0,
    castTime: 0,
    gcd: 1,
  },
};

const OFFICIAL_BUFFS = {
  804216: {
    source: "db.ascension.gg",
    energy: 0,
    castTime: 0,
    gcd: 0,
    duration: 30,
    damageDonePct: 10,
  },
};

const OFFICIAL_DEBUFFS = {
  707901: {
    source: "db.ascension.gg",
    energy: 40,
    castTime: 0,
    gcd: 1,
    duration: 21,
    damageTakenFromCasterPct: 20,
    fireCritFromCasterPct: 20,
  },
};

const CORE_SPELLS = [
  { id: 501288, name: "Fel Fireball", role: "builder", resource: "energy", energy: 35, felfuryGain: 1, gcd: 1.0, defaultCast: 2.0 },
  { id: 501298, name: "Ruin", role: "spender", resource: "felfury", felfuryCost: 2, energy: 30, gcd: 1.0, defaultCast: 2.5 },
  { id: 805748, name: "Ruin", role: "dot", gcd: 0, defaultCast: 0, duration: 3, canCrit: false },
  { id: 501321, name: "Sargeron Smite", role: "spender", resource: "felfury", felfuryCost: 2, gcd: 1.0, defaultCast: 0 },
  { id: 803467, name: "Sargeron Smite (Inner Demon)", role: "rider", gcd: 0, defaultCast: 0, canCrit: false },
  { id: 802678, name: "Felstrike", role: "dot", gcd: 0, defaultCast: 0, duration: 6, maxStacks: 3, canCrit: false },
  { id: 707901, name: "Bane of Fire", role: "debuff", resource: "energy", energy: 40, gcd: 1.0, defaultCast: 0, duration: 21, canCrit: false },
  { id: 804216, name: "Inner Demon", role: "buff", gcd: 0, defaultCast: 0, duration: 30 },
  { id: 520693, name: "Felwrath", role: "aoe", resource: "felfury", felfuryCost: 3, gcd: 1.0, defaultCast: 0 },
  { id: 560284, name: "Infernal", role: "cooldown", gcd: 1.0, defaultCast: 0 },
  { id: 802676, name: "Chaos", role: "proc", gcd: 0, defaultCast: 0 },
];

function main() {
  if (!fs.existsSync(LOG)) {
    throw new Error("Run npm run parse-logs first.");
  }
  const log = JSON.parse(fs.readFileSync(LOG, "utf8"));
  // The item database is a catalog, not the logged character's equipped set.
  // Keep observed log averages unscaled until equipped stats are available.
  const equippedSpellPower = 0;

  const spells = {};
  for (const spec of CORE_SPELLS) {
    const observed = log.spells[String(spec.id)] || log.spells[spec.id] || null;
    const casts = (log.casts && (log.casts[String(spec.id)] || log.casts[spec.id])) || null;
    const avgHit = observed ? observed.avgHit || observed.avg : 0;
    const avgCrit = observed ? observed.avgCrit || avgHit * (observed.critMultiplier || 1.5) : 0;
    const critRate = observed ? observed.critRate : 0;
    const critMult = observed && observed.critMultiplier > 1.05 ? observed.critMultiplier : 1.5;
    const castTime = casts && casts.castTimeHintSec ? Number(casts.castTimeHintSec.toFixed(3)) : spec.defaultCast;

    const official = OFFICIAL_FORMULAS[spec.id];
    const debuff = OFFICIAL_DEBUFFS[spec.id];
    const buff = OFFICIAL_BUFFS[spec.id];
    const fit = official
      ? {
          method: "min-max + perLevel * 60 + coeff * SP",
          spellPowerUsed: 0,
          base: (official.min + official.max) / 2,
          coeff: official.coeff,
          note: "School damage from db.ascension.gg. Crit rate still from combat logs.",
        }
      : debuff
        ? {
            method: "debuff: +20% magic taken from caster, +20% fire crit from caster",
            spellPowerUsed: 0,
            base: 0,
            coeff: 0,
            note: "No periodic damage. Duration from logs (21s).",
          }
      : buff
        ? {
            method: "buff: +10% damage done (all schools)",
            spellPowerUsed: 0,
            base: 0,
            coeff: 0,
            note: "Shapeshift. Enables Felstrike and Inner Demon Smite. Duration from logs (30s).",
          }
      : {
          method: equippedSpellPower > 0 ? "avgHit = base + coeff * spellPower" : "observed-average (no item SP yet)",
          spellPowerUsed: equippedSpellPower,
          base: fitCoefficient(avgHit, equippedSpellPower).base,
          coeff: fitCoefficient(avgHit, equippedSpellPower).coeff,
          note: "Fitted from Kadd combat logs. Not CoA Tavern.",
        };
    spells[spec.id] = {
      ...spec,
      source: official || debuff || buff ? "db.ascension.gg" : "combat-log",
      formula: official || undefined,
      debuff: debuff
        ? {
            damageTakenFromCasterPct: debuff.damageTakenFromCasterPct,
            fireCritFromCasterPct: debuff.fireCritFromCasterPct,
          }
        : undefined,
      buff: buff ? { damageDonePct: buff.damageDonePct } : undefined,
      observed: observed
        ? {
            count: observed.count,
            total: observed.total,
            avgHit,
            avgCrit,
            critRate,
            critMultiplier: critMult,
            share: observed.share,
          }
        : null,
      castTime: official ? spec.defaultCast : castTime,
      fit,
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    player: log.player,
    logDps: log.dps,
    logDurationSec: log.durationSec,
    logTotalDamage: log.totalDamage,
    spellPowerFromItems: equippedSpellPower,
    spells,
    rotationNotes: {
      builder: "Fel Fireball generates Felfury and can proc Felstrike while Inner Demon is up.",
      spenders: "Every third direct Infernal critical strike enables an instant Ruin. Felfury aura transitions show both Ruin and Sargeron Smite consume 2 Felfury.",
      resources: "Felfury regenerates during combat and caps at 6 in Kadd's logs.",
      maintain: ["Inner Demon", "Bane of Fire"],
    },
  };

  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  fs.writeFileSync(OUT_PUBLIC, JSON.stringify(payload, null, 2));
  fs.writeFileSync(OUT_DATA, JSON.stringify(payload, null, 2));
  console.log(`Fitted ${Object.keys(spells).length} Infernal spells from logs (SP from items: ${equippedSpellPower}).`);
}

function fitCoefficient(avgHit, spellPower) {
  if (!avgHit) return { base: 0, coeff: 0 };
  if (spellPower <= 0) {
    return { base: avgHit, coeff: 0 };
  }
  const coeff = 0.5;
  return { base: Math.max(0, avgHit - coeff * spellPower), coeff };
}

main();
