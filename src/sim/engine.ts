import type { CharacterStats, LogBaseline, SimConfig, SimResult, SpellBreakdown, SpellFit } from "../types";
import { Rng } from "./rng";
import { runOnce } from "./infernal";

// Fixed fight length lines CDs up the same way every iteration.
const DURATION_SALT = 0.05;
const SIM_TICK = 0.05;

export type SimProgress = (completed: number, total: number) => void;

type MergeRec = {
  casts: number;
  damage: number;
  dps: number;
  hits: number;
  crits: number;
  misses: number;
  events: number;
};

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
  return finalizeSim(
    spells,
    stats,
    config,
    logDps,
    logBaseline,
    runIterations(spells, stats, config, config.iterations),
  );
}

export async function runSimAsync(
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  config: SimConfig,
  logDps: number | null,
  logBaseline: LogBaseline | null = null,
  onProgress?: SimProgress,
): Promise<SimResult> {
  const total = config.iterations;
  const batchSize = Math.max(1, Math.min(10, Math.floor(total / 60)));
  const partial = createPartialSim(config);
  let completed = 0;

  onProgress?.(0, total);
  while (completed < total) {
    const end = Math.min(completed + batchSize, total);
    runIterationBatch(spells, stats, config, partial, completed, end);
    completed = end;
    onProgress?.(completed, total);
    if (completed < total) {
      await yieldToUi();
    }
  }

  return finalizeSim(spells, stats, config, logDps, logBaseline, partial);
}

function createPartialSim(config: SimConfig) {
  return {
    dpsSamples: [] as number[],
    merge: new Map<string, MergeRec>(),
    auraUptime: new Map<string, number>(),
    castEvents: [] as SimResult["castEvents"],
    castLogFightSec: config.durationSec,
    castLogTruncated: false,
  };
}

function runIterations(
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  config: SimConfig,
  count: number,
) {
  const partial = createPartialSim(config);
  runIterationBatch(spells, stats, config, partial, 0, count);
  return partial;
}

function runIterationBatch(
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  config: SimConfig,
  partial: ReturnType<typeof createPartialSim>,
  start: number,
  end: number,
) {
  for (let i = start; i < end; i++) {
    const rng = new Rng(config.seed + i * 9973);
    const saltRng = new Rng(config.seed + 0x9e3779b9 + i * 7919);
    const fightSec = saltedFightDuration(config.durationSec, saltRng);
    const once = runOnce(spells, stats, fightSec, rng, {
      potionSpellPower: config.potionSpellPower,
      potionDuration: config.potionDuration,
      potionMode: config.potionMode,
      setDamageAbove75: config.setDamageAbove75,
      talentSelection: config.talentSelection,
      neptulonsWrath: config.neptulonsWrath,
      targetHealthDecays: config.targetHealthDecays,
      demonfirePact: config.demonfirePact,
    });
    applyProcContributions(once, fightSec, config.procContributions);
    if (i === 0) {
      partial.castEvents = once.castEvents;
      partial.castLogFightSec = fightSec;
      partial.castLogTruncated = once.castLogTruncated;
    }
    partial.dpsSamples.push(once.damage / fightSec);
    for (const [name, rec] of once.bySpell) {
      const cur = partial.merge.get(name) || {
        casts: 0,
        damage: 0,
        dps: 0,
        hits: 0,
        crits: 0,
        misses: 0,
        events: 0,
      };
      cur.casts += rec.casts;
      cur.damage += rec.damage;
      cur.dps += rec.damage / fightSec;
      cur.hits += rec.hits;
      cur.crits += rec.crits;
      cur.misses += rec.misses;
      cur.events += rec.events;
      partial.merge.set(name, cur);
    }
    for (const [name, seconds] of once.auraSeconds) {
      partial.auraUptime.set(name, (partial.auraUptime.get(name) || 0) + seconds / fightSec);
    }
  }
}

function finalizeSim(
  _spells: Record<string, SpellFit>,
  _stats: CharacterStats,
  config: SimConfig,
  logDps: number | null,
  logBaseline: LogBaseline | null,
  partial: ReturnType<typeof createPartialSim>,
): SimResult {
  const dpsSamples = partial.dpsSamples;
  dpsSamples.sort((a, b) => a - b);
  const mean = average(dpsSamples);
  const variance = average(dpsSamples.map((x) => (x - mean) ** 2));
  const n = config.iterations;
  const breakdown: SpellBreakdown[] = [...partial.merge.entries()]
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
    auraUptimes: [...partial.auraUptime.entries()]
      .map(([name, uptime]) => ({ name, uptime: uptime / n }))
      .sort((a, b) => b.uptime - a.uptime),
    castEvents: partial.castEvents,
    castLogFightSec: partial.castLogFightSec,
    castLogTruncated: partial.castLogTruncated,
    logDps,
    logDeltaPct: logDps ? ((mean - logDps) / logDps) * 100 : null,
    logBaseline,
  };
}

function applyProcContributions(
  once: ReturnType<typeof runOnce>,
  fightSec: number,
  procs: SimConfig["procContributions"],
) {
  for (const proc of procs ?? []) {
    if (proc.dps <= 0) continue;
    const damage = proc.dps * fightSec;
    once.damage += damage;
    const rec = once.bySpell.get(proc.name) ?? {
      casts: 0,
      damage: 0,
      hits: 0,
      crits: 0,
      misses: 0,
      events: 0,
    };
    rec.damage += damage;
    rec.hits += 1;
    rec.events += 1;
    once.bySpell.set(proc.name, rec);
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
