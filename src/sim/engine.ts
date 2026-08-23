import type { CharacterStats, LogBaseline, SimConfig, SimResult, SpellBreakdown, SpellFit } from "../types";
import { Rng } from "./rng";
import { runOnce } from "./infernal";

// Fixed fight length lines CDs up the same way every iteration.
const DURATION_SALT = 0.05;
const SIM_TICK = 0.05;

export function saltedFightDuration(nominalSec: number, rng: Rng, salt = DURATION_SALT): number {
  const raw = rng.range(nominalSec * (1 - salt), nominalSec * (1 + salt));
  return Math.max(SIM_TICK, Math.round(raw / SIM_TICK) * SIM_TICK);
}

export function runSim(
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  config: SimConfig,
  logDps: number | null,
  logBaseline: LogBaseline | null = null,
): SimResult {
  const dpsSamples: number[] = [];
  const merge = new Map<string, { casts: number; damage: number; dps: number; hits: number; crits: number; misses: number; events: number }>();
  const auraUptime = new Map<string, number>();
  let castEvents: SimResult["castEvents"] = [];

  for (let i = 0; i < config.iterations; i++) {
    const rng = new Rng(config.seed + i * 9973);
    const saltRng = new Rng(config.seed + 0x9e3779b9 + i * 7919);
    const fightSec = saltedFightDuration(config.durationSec, saltRng);
    const once = runOnce(spells, stats, fightSec, rng, {
      potionSpellPower: config.potionSpellPower,
      potionDuration: config.potionDuration,
      potionMode: config.potionMode,
      setDamageAbove75: config.setDamageAbove75,
    });
    if (i === 0) castEvents = once.castEvents;
    dpsSamples.push(once.damage / fightSec);
    for (const [name, rec] of once.bySpell) {
      const cur = merge.get(name) || { casts: 0, damage: 0, dps: 0, hits: 0, crits: 0, misses: 0, events: 0 };
      cur.casts += rec.casts;
      cur.damage += rec.damage;
      cur.dps += rec.damage / fightSec;
      cur.hits += rec.hits;
      cur.crits += rec.crits;
      cur.misses += rec.misses;
      cur.events += rec.events;
      merge.set(name, cur);
    }
    for (const [name, seconds] of once.auraSeconds) {
      auraUptime.set(name, (auraUptime.get(name) || 0) + seconds / fightSec);
    }
  }

  dpsSamples.sort((a, b) => a - b);
  const mean = average(dpsSamples);
  const variance = average(dpsSamples.map((x) => (x - mean) ** 2));
  const n = config.iterations;
  const breakdown: SpellBreakdown[] = [...merge.entries()]
    .map(([name, rec]) => ({
      name,
      casts: rec.casts / n,
      damage: rec.damage / n,
      dps: rec.dps / n,
      share: mean > 0 ? rec.dps / n / mean : 0,
      hits: rec.hits / n,
      crits: rec.crits / n,
      misses: rec.misses / n,
      hitRate: rec.events + rec.misses > 0 ? rec.events / (rec.events + rec.misses) : null,
      critRate: rec.events > 0 ? rec.crits / rec.events : null,
      missRate: rec.events + rec.misses > 0 ? rec.misses / (rec.events + rec.misses) : null,
    }))
    .sort((a, b) => b.dps - a.dps);

  return {
    meanDps: mean,
    minDps: dpsSamples[0] ?? 0,
    maxDps: dpsSamples[dpsSamples.length - 1] ?? 0,
    stdev: Math.sqrt(variance),
    iterations: n,
    durationSec: config.durationSec,
    playerLevel: config.playerLevel,
    bossLevel: config.bossLevel,
    fightStyle: config.fightStyle,
    breakdown,
    dpsSamples,
    p50Dps: percentile(dpsSamples, 0.5),
    p95Dps: percentile(dpsSamples, 0.95),
    auraUptimes: [...auraUptime.entries()]
      .map(([name, uptime]) => ({ name, uptime: uptime / n }))
      .sort((a, b) => b.uptime - a.uptime),
    castEvents,
    logDps,
    logDeltaPct: logDps ? ((mean - logDps) / logDps) * 100 : null,
    logBaseline,
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[lower + 1] - sorted[lower] || 0) * fraction;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
