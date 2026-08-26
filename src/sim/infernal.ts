import type { CharacterStats, PotionMode, SimActiveAura, SimCastEvent, SpellFit } from "../types";
import { Rng } from "./rng";
import { hasteMultiplier, rollOffensiveHit, rollSpellDamage } from "./spells";
import { effectiveSpellPower } from "./stats";
import { isTalentEnabled } from "../talents/baseline";
import type { TalentSelection } from "../talents/types";
import {
  applyTakenTalents,
} from "../talents/taken";
import {
  archimondesWrathApplies,
  fireballCastTime,
  fireballEnergyCost,
  INFERNAL,
  infernalContext,
  innerDemonDuration,
  felCannonCritActive,
  isFireball,
  isFelfurySpender,
  isRuin,
  spellAffectsFire,
  isSmite,
} from "../talents/infernal";
import {
  baneDuration,
  baneEnergyCost,
  felheartHaste,
  FELSWORN,
  skullCooldown,
  skullEnergyBonus,
} from "../talents/felsworn";
import {
  ARCANE_ARTILLERY,
  arcaneArtillerySpellPower,
  tryArcaneArtilleryProc,
} from "./arcane-artillery";
import {
  consumeTrinketStacksOnDirectHit,
  createOnUseTrinketState,
  describeTrinketBuff,
  tickOnUseTrinketBuffs,
  trinketContextModifiers,
  tryUseOnUseTrinketsWithAnnihilation,
  type EquippedOnUseTrinket,
  type OnUseTrinketState,
} from "./on-use-trinkets";
import {
  createProcTrinketState,
  describeProcTrinketBuff,
  procTrinketContextModifiers,
  tickProcTrinketBuffs,
  tryProcTrinketProcs,
  type EquippedProcTrinket,
  type ProcTrinketDef,
  type ProcTrinketState,
} from "./proc-trinkets";

const ANNIHILATION: SpellFit = {
  id: 803904,
  name: "Annihilation",
  role: "cooldown",
  gcd: 0,
  castTime: 0,
  observed: null,
  fit: { base: 0, coeff: 0, spellPowerUsed: 0 },
};

const RECKONING: SpellFit = {
  id: 802058,
  name: "Reckoning",
  role: "cooldown",
  gcd: 0,
  castTime: 0,
  duration: FELSWORN.reckoningDuration,
  observed: null,
  fit: { base: 0, coeff: 0, spellPowerUsed: 0 },
};

const BLOOD: SpellFit = {
  id: 802075,
  name: "Blood of Mannoroth",
  role: "cooldown",
  gcd: 0,
  castTime: 0,
  observed: null,
  fit: { base: 0, coeff: 0, spellPowerUsed: 0 },
};

const SKULL: SpellFit = {
  id: 800225,
  name: "Skull of Gul'dan",
  role: "cooldown",
  gcd: 0,
  castTime: 0,
  duration: FELSWORN.skullDuration,
  observed: null,
  fit: { base: 0, coeff: 0, spellPowerUsed: 0 },
};

const POTION: SpellFit = {
  id: 17524,
  name: "Potion of Spell Power",
  role: "cooldown",
  gcd: 0,
  castTime: 0,
  observed: null,
  fit: { base: 0, coeff: 0, spellPowerUsed: 0 },
};

// Instant casts are not truly zero-time: client/server batching and latency
// leave a short gap before the next command is accepted.
const INSTANT_LATENCY_MIN = 0.01;
const INSTANT_LATENCY_MAX = 0.02;
/** Reaction time after Sculptor / True Blessing Ruin proc before the cast fires. */
const RUIN_PROC_REACTION = 0.02;

/** Shaman party buff — 35% AP + 35% SP Froststorm on direct damage, 15s aura, 1 min CD. */
const NEPTULONS_WRATH = {
  name: "Neptulon's Wrath",
  duration: 15,
  cooldown: 60,
  apCoeff: 0.35,
  /** Proc spell 537252 — Froststorm damage scales with spell power. */
  spCoeff: 0.35,
  /** Kadd log observed crit multiplier for spell 537252. */
  critMultiplier: 2.454364267263334,
} as const;

/** Shaman party buff — +5% haste for 15s; modeled at 80% uptime (15s on / 3.75s off). */
const TAILWIND = {
  name: "Tailwind",
  duration: 15,
  targetUptime: 0.8,
  hastePct: 5,
} as const;
const TAILWIND_DOWNTIME = (TAILWIND.duration * (1 - TAILWIND.targetUptime)) / TAILWIND.targetUptime;
const TAILWIND_CYCLE = TAILWIND.duration + TAILWIND_DOWNTIME;

/** Shaman party CD — +30% haste for 20s; cast at pull and every 5 min. */
const TEMPESTS_CALL = {
  name: "Tempest's Call",
  duration: 20,
  cooldown: 300,
  hastePct: 30,
} as const;

/** Venomancer debuff — +10% spell damage taken for 15s; modeled at ~95% uptime. */
const VULNERABLE = {
  name: "Vulnerable",
  duration: 15,
  targetUptime: 0.95,
  damageTakenPct: 10,
} as const;
const VULNERABLE_DOWNTIME = (VULNERABLE.duration * (1 - VULNERABLE.targetUptime)) / VULNERABLE.targetUptime;
const VULNERABLE_CYCLE = VULNERABLE.duration + VULNERABLE_DOWNTIME;

export type FightOptions = {
  potionSpellPower?: number;
  potionDuration?: number;
  potionMode?: PotionMode;
  setDamageAbove75?: number;
  talentSelection?: TalentSelection;
  /** Linear 100%→0% health over the fight (Fel Cannon / Doomsayer taper). Default off for dummy. */
  targetHealthDecays?: boolean;
  targetStartHealth?: number;
  /** Allied Shaman aura — 35% AP + 35% SP Froststorm on each direct damage hit while active. */
  neptulonsWrath?: boolean;
  /** Shaman Tailwind — +5% haste for 15s windows (~80% uptime). */
  tailwind?: boolean;
  /** Shaman Tempest's Call — +30% haste for 20s at pull and every 5 min. */
  tempestsCall?: boolean;
  /** Venomancer Vulnerable — +10% spell damage taken for 15s windows (~95% uptime). */
  vulnerable?: boolean;
  /** Demonfire Pact buff — Fel Infusion personal crit is 3% while active, 6% when off. */
  demonfirePact?: boolean;
  /** Arcane Artillery weapon enchant (+80 SP proc). */
  arcaneArtillery?: boolean;
  /** Equipped on-use trinkets with modeled combat effects. */
  onUseTrinkets?: EquippedOnUseTrinket[];
  /** Equipped epic proc trinkets (on-hit / on-cast). */
  procTrinkets?: EquippedProcTrinket[];
  /** Primalist hit debuff — flat +3% hit; overrides Felshock hit debuff. */
  primalistHitDebuff?: boolean;
};

export type Aura = {
  remain: number;
  stacks: number;
  tick?: number;
  nextTickAt?: number;
  tickPeriod?: number;
};

export type FightState = {
  time: number;
  gcdReady: number;
  castingUntil: number;
  energy: number;
  felfury: number;
  critsTowardRuin: number;
  ruinProc: boolean;
  ruinProcRemain: number;
  /** Earliest time the player reacts and casts proc Ruin. */
  ruinReactUntil: number;
  innerDemon: Aura | null;
  /** Absolute fight time when the current Inner Demon window ends. */
  innerDemonExpiresAt: number;
  /** Cumulative +1s Felshock extensions during the current Inner Demon window. */
  innerDemonFelshockExtension: number;
  baneOfFire: Aura | null;
  felstrike: Aura | null;
  ruinDot: Aura | null;
  felforged: Aura | null;
  chaotic: Aura | null;
  fireballStreak: number;
  fireballStreakStart: number;
  energyMax: number;
  baseEnergyMax: number;
  anniReadyAt: number;
  reckoningReadyAt: number;
  skullReadyAt: number;
  bloodReadyAt: number;
  annihilation: Aura | null;
  reckoning: Aura | null;
  skull: Aura | null;
  bloodRegen: Aura | null;
  potion: Aura | null;
  potionDrinks: number;
  potionReadyAt: number;
  potionSpellPower: number;
  potionDuration: number;
  potionMode: PotionMode;
  setDamageAbove75: number;
  fightDuration: number;
  targetStartHealth: number;
  targetHealthDecays: boolean;
  talentSelection?: TalentSelection;
  reckoningPower: Aura | null;
  maliceCritRemain: number;
  felshockHitRemain: number;
  neptulonsWrath: boolean;
  neptulonRemain: number;
  neptulonNextCastAt: number;
  tailwind: boolean;
  /** Random phase offset so uptime converges to ~80% across iterations. */
  tailwindPhaseOffset: number;
  tempestsCall: boolean;
  tempestsCallRemain: number;
  tempestsCallNextCastAt: number;
  vulnerable: boolean;
  /** Random phase offset so uptime converges to ~95% across iterations. */
  vulnerablePhaseOffset: number;
  /** Primalist hit debuff active — Felshock hit debuff does not apply. */
  primalistHitDebuff: boolean;
  /** Shared weapon-proc ICD pool (High Risk Weapons Enchant). */
  weaponProcIcdReadyAt: number;
  arcaneArtilleryEnabled: boolean;
  arcaneArtillery: Aura | null;
  onUseTrinkets: OnUseTrinketState;
  procTrinkets: ProcTrinketState;
  cursedFlamesReady: boolean;
  cursedFlamesExpireAt: number;
  playerStats: CharacterStats;
  damage: number;
  bySpell: Map<string, { casts: number; damage: number; hits: number; crits: number; hitDamage: number; critDamage: number; misses: number; events: number }>;
  auraSeconds: Map<string, number>;
  castEvents: SimCastEvent[];
  /** Offensive casts that rolled spell hit (excludes DoT ticks and zero-hit utility casts). */
  offensiveCastsAttempted: number;
  offensiveCastsLanded: number;
  offensiveCastsMissed: number;
};

const FELFURY_MAX = 6;

function talentTaken(state: FightState, tree: "felsworn" | "infernal", name: string): boolean {
  return !state.talentSelection || isTalentEnabled(state.talentSelection, tree, name);
}

function isCursedFlamesActive(state: FightState): boolean {
  return (
    state.cursedFlamesReady &&
    state.time <= state.cursedFlamesExpireAt &&
    talentTaken(state, "infernal", "Cursed Flames")
  );
}

function grantCursedFlames(state: FightState): void {
  if (!talentTaken(state, "infernal", "Cursed Flames")) return;
  if (isCursedFlamesActive(state)) return;
  state.cursedFlamesReady = true;
  state.cursedFlamesExpireAt = state.time + INFERNAL.cursedFlamesWindow;
}

function consumeCursedFlames(state: FightState): void {
  state.cursedFlamesReady = false;
}

/** Felshock combat effects follow the Infernal talent toggle. */
function felshockEnabled(state: FightState): boolean {
  return talentTaken(state, "infernal", "Felshock");
}
const EVENT_LOG_LIMIT = 3000;
export const CAST_EVENT_LOG_LIMIT = EVENT_LOG_LIMIT;

/** Median timing from Kadd `WoWCombatLog.txt` — see `scripts/analyze-dot-timing.mjs`. */
const DOT_TIMING = {
  felstrike: { firstTickDelay: 0.5, tickPeriod: 1.0 },
  ruinDot: { firstTickDelay: 0.9, tickPeriod: 1.0 },
} as const;

function addEnergy(state: FightState, amount: number) {
  state.energy = Math.min(state.energyMax, state.energy + amount);
}

function addFelfury(state: FightState, amount: number) {
  state.felfury = Math.min(FELFURY_MAX, state.felfury + amount);
}

function innerDemonRemaining(state: FightState): number {
  if (!state.innerDemon) return 0;
  return Math.max(0, state.innerDemonExpiresAt - state.time);
}

function clearInnerDemon(state: FightState) {
  state.innerDemon = null;
  state.innerDemonExpiresAt = 0;
  state.innerDemonFelshockExtension = 0;
}

export function runOnce(
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  duration: number,
  rng: Rng,
  options: FightOptions = {},
): {
  damage: number;
  bySpell: Map<string, { casts: number; damage: number; hits: number; crits: number; hitDamage: number; critDamage: number; misses: number; events: number }>;
  auraSeconds: Map<string, number>;
  castEvents: SimCastEvent[];
  fightSec: number;
  castLogTruncated: boolean;
  offensiveCastsAttempted: number;
  offensiveCastsLanded: number;
  offensiveCastsMissed: number;
} {
  const specStats = applyTakenTalents(stats, options.talentSelection, {
    demonfirePact: options.demonfirePact !== false,
  });
  const fireball = spells["501288"];
  const ruin = spells["501298"];
  const smite = spells["501321"];
  const smiteInner = spells["803467"];
  const felstrike = spells["802678"];
  const bane = spells["707901"];
  const inner = spells["804216"];
  const chaos = spells["802676"];

  const state: FightState = {
    time: 0,
    gcdReady: 0,
    castingUntil: 0,
    energy: specStats.energyMax,
    felfury: specStats.felfury,
    critsTowardRuin: 0,
    ruinProc: false,
    ruinProcRemain: 0,
    ruinReactUntil: 0,
    innerDemon: null,
    innerDemonExpiresAt: 0,
    innerDemonFelshockExtension: 0,
    baneOfFire: null,
    felstrike: null,
    ruinDot: null,
    felforged: null,
    chaotic: null,
    fireballStreak: 0,
    fireballStreakStart: 0,
    energyMax: specStats.energyMax,
    baseEnergyMax: specStats.energyMax,
    anniReadyAt: 0,
    reckoningReadyAt: 0,
    skullReadyAt: 0,
    bloodReadyAt: 0,
    annihilation: null,
    reckoning: null,
    skull: null,
    bloodRegen: null,
    potion: null,
    potionDrinks: 0,
    potionReadyAt: 0,
    potionSpellPower: options.potionSpellPower ?? 0,
    potionDuration: options.potionDuration ?? 20,
    potionMode: options.potionMode ?? "none",
    setDamageAbove75: options.setDamageAbove75 ?? 0,
    fightDuration: duration,
    targetStartHealth: options.targetStartHealth ?? 1,
    targetHealthDecays: options.targetHealthDecays ?? false,
    talentSelection: options.talentSelection,
    reckoningPower: null,
    maliceCritRemain: 0,
    felshockHitRemain: 0,
    neptulonsWrath: options.neptulonsWrath ?? false,
    neptulonRemain: options.neptulonsWrath ? NEPTULONS_WRATH.duration : 0,
    neptulonNextCastAt: options.neptulonsWrath ? NEPTULONS_WRATH.cooldown : 0,
    tailwind: options.tailwind ?? false,
    tailwindPhaseOffset: options.tailwind ? rng.range(0, TAILWIND_CYCLE) : 0,
    tempestsCall: options.tempestsCall ?? false,
    tempestsCallRemain: options.tempestsCall ? TEMPESTS_CALL.duration : 0,
    tempestsCallNextCastAt: options.tempestsCall ? TEMPESTS_CALL.cooldown : 0,
    vulnerable: options.vulnerable ?? false,
    vulnerablePhaseOffset: options.vulnerable ? rng.range(0, VULNERABLE_CYCLE) : 0,
    primalistHitDebuff: options.primalistHitDebuff ?? false,
    weaponProcIcdReadyAt: 0,
    arcaneArtilleryEnabled: options.arcaneArtillery ?? false,
    arcaneArtillery: null,
    onUseTrinkets: createOnUseTrinketState(options.onUseTrinkets ?? []),
    procTrinkets: createProcTrinketState(options.procTrinkets ?? []),
    cursedFlamesReady: false,
    cursedFlamesExpireAt: 0,
    playerStats: specStats,
    damage: 0,
    bySpell: new Map(),
    auraSeconds: new Map(),
    castEvents: [],
    offensiveCastsAttempted: 0,
    offensiveCastsLanded: 0,
    offensiveCastsMissed: 0,
  };

  if (state.potionMode === "prepot-and-second" && state.potionSpellPower > 0) {
    state.potion = { remain: state.potionDuration, stacks: 1 };
    state.potionDrinks = 1;
    state.potionReadyAt = 60;
    deal(state, POTION.name, 0, true, false, false);
    logCast(state, POTION.name, "applied", 0);
  }

  const tick = 0.05;
  while (state.time < duration) {
    regen(state, tick);
    tickAuras(state, tick, spells, specStats, rng);

    while (state.time >= state.castingUntil) {
      const action = chooseAction(state, fireball, ruin, smite, inner, bane, state.time >= state.gcdReady);
      if (!action) break;
      cast(state, action, specStats, rng, {
        smite,
        smiteInner,
        felstrike,
        chaos,
      });
    }
    state.time += tick;
  }

  return {
    damage: state.damage,
    bySpell: state.bySpell,
    auraSeconds: state.auraSeconds,
    castEvents: state.castEvents,
    fightSec: duration,
    castLogTruncated: state.castEvents.length >= EVENT_LOG_LIMIT,
    offensiveCastsAttempted: state.offensiveCastsAttempted,
    offensiveCastsLanded: state.offensiveCastsLanded,
    offensiveCastsMissed: state.offensiveCastsMissed,
  };
}

function regen(state: FightState, dt: number) {
  const demonborn = talentTaken(state, "felsworn", "Demonborn");
  const blood = Boolean(state.bloodRegen) && talentTaken(state, "felsworn", "Blood of Mannoroth");
  const base = FELSWORN.baseEnergyRegen * (1 + (demonborn ? FELSWORN.demonbornEnergyRegen : 0));
  const rate = blood ? base * (1 + FELSWORN.bloodOfMannorothRegen) : base;
  addEnergy(state, rate * dt);
}

function tickAuras(
  state: FightState,
  dt: number,
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  rng: Rng,
) {
  tickNeptulonsWrath(state, dt);
  tickTailwind(state, dt);
  tickTempestsCall(state, dt);
  tickVulnerable(state, dt);
  tickCursedFlames(state, dt);
  if (state.ruinProc) {
    state.ruinProcRemain -= dt;
    if (state.ruinProcRemain <= 0) {
      state.ruinProc = false;
      state.ruinProcRemain = 0;
      state.ruinReactUntil = 0;
    }
  }
  if (state.maliceCritRemain > 0) {
    addAuraTime(state, "Fragment of Malice", dt);
    state.maliceCritRemain = Math.max(0, state.maliceCritRemain - dt);
  }
  if (state.felshockHitRemain > 0) {
    addAuraTime(state, "Felshock", dt);
    state.felshockHitRemain = Math.max(0, state.felshockHitRemain - dt);
  }
  if (state.felforged) {
    addAuraTime(state, "Felforged", dt);
    state.felforged.remain -= dt;
    if (state.felforged.remain <= 0 || state.felforged.stacks <= 0) state.felforged = null;
  }
  if (state.chaotic) {
    const stacks = state.chaotic.stacks;
    addAuraTime(state, "Chaotic", dt);
    addAuraTime(state, `Chaotic (${stacks} stack${stacks === 1 ? "" : "s"})`, dt);
    state.chaotic.remain -= dt;
    if (state.chaotic.remain <= 0) state.chaotic = null;
  }
  if (state.annihilation) {
    addAuraTime(state, "Annihilation", dt);
    state.annihilation.remain -= dt;
    if (state.annihilation.remain <= 0 || state.annihilation.stacks <= 0) state.annihilation = null;
  }
  if (state.reckoning) {
    addAuraTime(state, "Reckoning", dt);
    state.reckoning.remain -= dt;
    if (state.reckoning.remain <= 0) state.reckoning = null;
  }
  if (state.reckoningPower) {
    const stacks = state.reckoningPower.stacks;
    addAuraTime(state, `Reckoning (${stacks} stack${stacks === 1 ? "" : "s"})`, dt);
    state.reckoningPower.remain -= dt;
    if (state.reckoningPower.remain <= 0) state.reckoningPower = null;
  }
  if (state.skull) {
    addAuraTime(state, "Skull of Gul'dan", dt);
    state.skull.remain -= dt;
    if (state.skull.remain <= 0) {
      state.skull = null;
      state.energyMax = state.baseEnergyMax;
      state.energy = Math.min(state.energy, state.energyMax);
    }
  }
  if (state.bloodRegen) {
    addAuraTime(state, "Blood of Mannoroth", dt);
    state.bloodRegen.remain -= dt;
    if (state.bloodRegen.remain <= 0) state.bloodRegen = null;
  }
  if (state.potion) {
    addAuraTime(state, "Potion of Spell Power", dt);
    state.potion.remain -= dt;
    if (state.potion.remain <= 0) state.potion = null;
  }
  if (state.arcaneArtillery) {
    addAuraTime(state, ARCANE_ARTILLERY.name, dt);
    state.arcaneArtillery.remain -= dt;
    if (state.arcaneArtillery.remain <= 0) state.arcaneArtillery = null;
  }
  for (const buff of state.onUseTrinkets.activeBuffs) {
    addAuraTime(state, buff.def.name, dt);
  }
  tickOnUseTrinketBuffs(state.onUseTrinkets, dt);
  for (const buff of state.procTrinkets.activeBuffs) {
    addAuraTime(state, buff.def.name, dt);
  }
  tickProcTrinketBuffs(state.procTrinkets, dt);
  if (state.innerDemon) {
    addAuraTime(state, "Inner Demon", dt);
    const remain = innerDemonRemaining(state);
    if (remain <= 0) clearInnerDemon(state);
    else state.innerDemon.remain = remain;
  }
  if (state.baneOfFire) {
    addAuraTime(state, "Bane of Fire", dt);
    state.baneOfFire.remain -= dt;
    if (state.baneOfFire.remain <= 0) state.baneOfFire = null;
  }
  if (state.felstrike) {
    addAuraTime(state, "Felstrike", dt);
    const spell = spells["802678"];
    state.felstrike = tickDotAura(state, state.felstrike, dt, () => {
      if (!spell) return;
      const procActivations = tryProcTrinketProcs(state.procTrinkets, "periodic-spell", state.time, rng, spell);
      logProcTrinketActivations(state, procActivations);
      const roll = rollSpellDamage(spell, stats, rng, false, combatContext(spell, stats, state));
      const amount = roll.amount * state.felstrike!.stacks;
      const auras = snapshotTickAuras(state, spell, state.felstrike!.stacks);
      deal(state, "Felstrike (DoT)", amount, false, roll.isCrit, roll.isMiss, false, rng);
      logTick(state, "Felstrike (DoT)", amount, auras);
      onPeriodic(state, rng);
    });
  }
  if (state.ruinDot) {
    addAuraTime(state, "Ruin (DoT)", dt);
    const ruin = spells["501298"];
    state.ruinDot = tickDotAura(state, state.ruinDot, dt, () => {
      const procActivations = tryProcTrinketProcs(state.procTrinkets, "periodic-spell", state.time, rng, ruin);
      logProcTrinketActivations(state, procActivations);
      const tickDamage = state.ruinDot!.tick ?? 0;
      const auras = ruin ? snapshotDamageAuras(state, ruin) : [];
      deal(state, "Ruin (DoT)", tickDamage, false, false, false, false, rng);
      logTick(state, "Ruin (DoT)", tickDamage, auras);
      onPeriodic(state, rng);
    });
  }
}

function shouldDrinkPotion(state: FightState, innerUp: boolean): boolean {
  if (state.potionSpellPower <= 0) return false;
  if (state.time < state.potionReadyAt) return false;
  if (state.potionMode === "in-fight") return innerUp && state.potionDrinks < 1;
  if (state.potionMode === "prepot-and-second") return state.potionDrinks < 2;
  return false;
}

function chooseAction(
  state: FightState,
  fireball: SpellFit | undefined,
  ruin: SpellFit | undefined,
  smite: SpellFit | undefined,
  inner: SpellFit | undefined,
  bane: SpellFit | undefined,
  onGcdOk: boolean,
): SpellFit | null {
  const ruinCost = ruin?.felfuryCost ?? 2;
  const innerRemain = innerDemonRemaining(state);
  const innerUp = innerRemain > 0.25;
  const expiring = Boolean(state.innerDemon) && innerRemain <= 0.25;
  const fullFelfury = state.felfury >= FELFURY_MAX;
  const banking = !innerUp || (innerRemain <= 8 && state.felfury < FELFURY_MAX);

  const ruinEnergy = ruin?.energy ?? 30;
  if (
    onGcdOk &&
    state.time >= state.ruinReactUntil &&
    innerUp &&
    state.ruinProc &&
    ruin &&
    talentTaken(state, "infernal", "Ruin") &&
    state.felfury >= ruinCost &&
    state.energy >= ruinEnergy
  ) {
    return ruin;
  }

  const baneCost = talentTaken(state, "felsworn", "Embracing Evil")
    ? baneEnergyCost(bane?.energy ?? 40)
    : (bane?.energy ?? 40);
  if (onGcdOk && bane && state.energy >= baneCost && (!state.baneOfFire || state.baneOfFire.remain <= 1.5)) {
    return bane;
  }

  if (inner && state.felfury >= 1 && ((!innerUp && fullFelfury) || expiring)) return inner;

  if (shouldDrinkPotion(state, innerUp)) return POTION;
  if (innerUp && talentTaken(state, "felsworn", "Blood of Mannoroth") && state.time >= state.bloodReadyAt) {
    return BLOOD;
  }

  const baneUp = Boolean(state.baneOfFire && state.baneOfFire.remain > 1.5);
  if (!state.ruinProc && state.felfury >= 2 && innerUp && baneUp) {
    if (talentTaken(state, "felsworn", "Skull of Gul'dan") && state.time >= state.skullReadyAt) return SKULL;
    if (talentTaken(state, "felsworn", "Annihilation") && state.time >= state.anniReadyAt) return ANNIHILATION;
  }

  if (
    talentTaken(state, "felsworn", "Reckoning") &&
    !state.felforged &&
    state.felfury < 3 &&
    !state.reckoning &&
    state.time >= state.reckoningReadyAt
  ) {
    return RECKONING;
  }

  // Hold 3 Felfury so a Doomsayer Smite crit (refund 1) leaves 2 for an instant Ruin proc.
  if (onGcdOk && smite && state.felfury >= 3 && !banking) return smite;

  const fbCost = talentTaken(state, "infernal", "Gul'dan's Prodigy")
    ? fireballEnergyCost(fireball?.energy ?? 35)
    : (fireball?.energy ?? 35);
  if (onGcdOk && fireball && state.energy >= fbCost) return fireball;
  return null;
}

function combatContext(spell: SpellFit, stats: CharacterStats, state: FightState, energyAtCast?: number) {
  const trinketMods = trinketContextModifiers(state.onUseTrinkets);
  const procMods = procTrinketContextModifiers(state.procTrinkets);
  return infernalContext(spell, stats, {
    innerDemon: Boolean(state.innerDemon),
    baneOfFire: Boolean(state.baneOfFire),
    maliceCritRemain: state.maliceCritRemain,
    felshockHitRemain: state.felshockHitRemain,
    energy: energyAtCast ?? state.energy,
    chaoticStacks: state.chaotic?.stacks ?? 0,
    reckoningStacks: state.reckoningPower?.stacks ?? 0,
    guaranteedCrit: Boolean(state.annihilation && state.annihilation.stacks > 0),
    potionSpellPower: state.potion ? state.potionSpellPower : 0,
    arcaneArtillerySpellPower: arcaneArtillerySpellPower(state),
    trinketSpellPower: trinketMods.spellPower,
    trinketDamageDone: trinketMods.damageDone,
    trinketExtraCrit: trinketMods.extraCrit,
    procTrinketSpellPower: procMods.spellPower,
    procTrinketExtraCrit: procMods.extraCrit,
    targetStartHealth: state.targetStartHealth,
    targetHealthDecays: state.targetHealthDecays,
    fightTime: state.time,
    fightDuration: state.fightDuration,
    setDamageAbove75: state.setDamageAbove75,
    primalistHitDebuff: state.primalistHitDebuff,
    cursedFlamesReady: isCursedFlamesActive(state),
    vulnerable: isVulnerableActive(state),
  }, state.talentSelection);
}

/** Buffs/procs that were active when infernalContext calculated this spell's damage. */
function snapshotDamageAuras(
  state: FightState,
  spell: SpellFit,
  options: { sculptorProc?: boolean; energyAtCast?: number } = {},
): SimActiveAura[] {
  const { sculptorProc = false, energyAtCast } = options;
  const auras: SimActiveAura[] = [];
  const push = (name: string, stacks = 1, hint?: string) => {
    if (stacks > 0) auras.push({ name, stacks, hint });
  };

  if (state.innerDemon) {
    auras.push({
      name: "Inner Demon",
      stacks: state.innerDemon.stacks,
      remainSec: innerDemonRemaining(state),
      felshockExtensionSec: state.innerDemonFelshockExtension,
    });
  }
  if (state.baneOfFire && spellAffectsFire(spell)) push("Bane of Fire");
  if (state.maliceCritRemain > 0) push("Fragment of Malice");
  if (state.felshockHitRemain > 0) push("Felshock");
  if (isTailwindActive(state)) push(TAILWIND.name);
  if (isTempestsCallActive(state)) push(TEMPESTS_CALL.name);
  if (isVulnerableActive(state)) push(VULNERABLE.name);
  if (state.chaotic?.stacks) push("Chaotic", state.chaotic.stacks);
  if (state.reckoningPower?.stacks) push("Reckoning", state.reckoningPower.stacks);
  if (state.annihilation?.stacks) push("Annihilation", state.annihilation.stacks);
  if (state.potion) push("Potion of Spell Power");
  if (state.arcaneArtillery) push(ARCANE_ARTILLERY.name);
  for (const buff of state.onUseTrinkets.activeBuffs) {
    push(buff.def.name, buff.stacks, describeTrinketBuff(buff.def, buff.stacks));
  }
  for (const buff of state.procTrinkets.activeBuffs) {
    push(buff.def.name, buff.stacks, describeProcTrinketBuff(buff.def, buff.stacks));
  }
  if (
    state.setDamageAbove75 > 0 &&
    felCannonCritActive(state.time, state.fightDuration, state.targetStartHealth, state.targetHealthDecays)
  ) {
    push("Felheart Raiment (6pc)");
  }
  if (
    talentTaken(state, "infernal", "Fel Cannon") &&
    (isFireball(spell) || isRuin(spell)) &&
    felCannonCritActive(state.time, state.fightDuration, state.targetStartHealth, state.targetHealthDecays)
  ) {
    push("Fel Cannon");
  }
  if (isRuin(spell) && (state.ruinProc || sculptorProc)) push("Sculptor of Doom");
  if (isFireball(spell) && isCursedFlamesActive(state)) push("Cursed Flames");
  if (energyAtCast != null && archimondesWrathApplies(spell, state.talentSelection)) {
    const stacks = Math.floor(Math.max(0, energyAtCast) / 10);
    if (stacks > 0) push("Archimonde's Wrath", stacks);
  }

  return auras;
}

function snapshotTickAuras(state: FightState, spell: SpellFit, felstrikeStacks: number): SimActiveAura[] {
  const auras = snapshotDamageAuras(state, spell).filter((aura) => aura.name !== "Felstrike");
  if (felstrikeStacks > 0) auras.push({ name: "Felstrike", stacks: felstrikeStacks });
  return auras;
}

function applyFelstrike(state: FightState, spell: SpellFit) {
  const stacks = Math.min(spell.maxStacks ?? 3, (state.felstrike?.stacks ?? 0) + 1);
  state.felstrike = {
    remain: spell.duration ?? 6,
    stacks,
    nextTickAt: state.time + DOT_TIMING.felstrike.firstTickDelay,
    tickPeriod: DOT_TIMING.felstrike.tickPeriod,
  };
}

function tickDotAura(state: FightState, aura: Aura, dt: number, onTick: () => void): Aura | null {
  aura.remain -= dt;
  if (aura.nextTickAt != null) {
    while (aura.remain > 0 && state.time >= aura.nextTickAt) {
      onTick();
      aura.nextTickAt += aura.tickPeriod ?? 1;
    }
  }
  return aura.remain > 0 ? aura : null;
}

function onPeriodic(state: FightState, rng: Rng) {
  if (talentTaken(state, "infernal", "Illidari Magi") && rng.chance(INFERNAL.illidariMagiChance)) {
    addFelfury(state, 1);
  }
  if (talentTaken(state, "infernal", "Felforged") && rng.chance(INFERNAL.felforgedChance)) {
    state.felforged = { remain: INFERNAL.felforgedDuration, stacks: INFERNAL.felforgedCharges };
  }
}

function onDirectCrit(
  state: FightState,
  spell: SpellFit,
  extras: { felstrike?: SpellFit },
  rng: Rng,
) {
  if (isFireball(spell) && talentTaken(state, "infernal", "Illidari Smiter")) {
    addFelfury(state, INFERNAL.illidariSmiterFelfury);
  }
  if (isSmite(spell) && talentTaken(state, "infernal", "Doomsayer")) {
    addFelfury(state, INFERNAL.doomsayerSmiteRefund);
  }
  if (talentTaken(state, "felsworn", "Focused Hatred")) addEnergy(state, FELSWORN.focusedHatredEnergy);
  if (
    felshockEnabled(state) &&
    isFelfurySpender(spell) &&
    state.innerDemon
  ) {
    state.innerDemonExpiresAt += INFERNAL.felshockInnerExtend;
    state.innerDemonFelshockExtension += INFERNAL.felshockInnerExtend;
    state.innerDemon.remain = innerDemonRemaining(state);
    if (!state.primalistHitDebuff) {
      state.felshockHitRemain = INFERNAL.felshockDuration;
    }
  }
  if (talentTaken(state, "infernal", "Malice of Gul'dan") && rng.chance(INFERNAL.maliceChance)) {
    if (extras.felstrike) applyFelstrike(state, extras.felstrike);
    addEnergy(state, INFERNAL.maliceEnergy);
    state.maliceCritRemain = INFERNAL.maliceDuration;
  }
}

function spellGcd(spell: SpellFit): number {
  if (spell.id === 707901) return spell.gcd || 1;
  return spell.gcd || 0;
}

function currentHaste(stats: CharacterStats, state: FightState) {
  const felheart = talentTaken(state, "felsworn", "Felheart") ? felheartHaste(state.felfury) : 0;
  const procHaste = procTrinketContextModifiers(state.procTrinkets).hastePct;
  return hasteMultiplier(stats) + felheart + tailwindHasteBonus(state) + tempestsCallHasteBonus(state) + procHaste;
}

function noteFireball(state: FightState) {
  if (state.fireballStreak === 0 || state.time - state.fireballStreakStart > FELSWORN.felwrackedWindow) {
    state.fireballStreak = 1;
    state.fireballStreakStart = state.time;
    return;
  }
  state.fireballStreak += 1;
  if (state.fireballStreak >= FELSWORN.felwrackedFireballs && talentTaken(state, "felsworn", "Felwracked")) {
    addFelfury(state, 1);
    state.fireballStreak = 0;
    state.fireballStreakStart = 0;
  }
}

function trackOffensiveCast(state: FightState, landed: boolean) {
  state.offensiveCastsAttempted += 1;
  if (landed) state.offensiveCastsLanded += 1;
  else state.offensiveCastsMissed += 1;
}

function cast(
  state: FightState,
  spell: SpellFit,
  stats: CharacterStats,
  rng: Rng,
  extras: {
    smite?: SpellFit;
    smiteInner?: SpellFit;
    felstrike?: SpellFit;
    chaos?: SpellFit;
  },
) {
  const haste = currentHaste(stats, state);
  const isProcRuin = isRuin(spell) && state.ruinProc;
  const logEnergy = state.energy;
  const logFelfury = state.felfury;
  const logResources = { energy: logEnergy, felfury: logFelfury };
  const usingFelforged = isFireball(spell) && Boolean(state.felforged);
  const reckoningFireball = isFireball(spell) && Boolean(state.reckoning);
  const prodigy = talentTaken(state, "infernal", "Gul'dan's Prodigy");
  const castTime = isProcRuin || reckoningFireball
    ? 0
    : isFireball(spell)
      ? fireballCastTime(spell.castTime || 0, haste, usingFelforged, prodigy)
      : (spell.castTime || 0) / haste;
  const baseGcd = spellGcd(spell);
  const gcd = baseGcd > 0 ? Math.max(baseGcd / haste, 0.75) : 0;
  const latency = castTime > 0 ? 0 : rng.range(INSTANT_LATENCY_MIN, INSTANT_LATENCY_MAX);
  state.castingUntil = state.time + castTime + latency;
  // Off-GCD weaves must not clear a GCD already started (Bane, Fireball, etc.).
  state.gcdReady = Math.max(state.gcdReady, state.time + Math.max(gcd, castTime + latency));

  const energyCost = reckoningFireball
    ? 0
    : isFireball(spell)
      ? (prodigy ? fireballEnergyCost(spell.energy ?? 35) : (spell.energy ?? 35))
      : spell.id === 707901
        ? (talentTaken(state, "felsworn", "Embracing Evil")
          ? baneEnergyCost(spell.energy ?? 40)
          : (spell.energy ?? 40))
        : spell.energy ?? 0;
  if (energyCost) state.energy = Math.max(0, state.energy - energyCost);
  if (spell.felfuryCost) state.felfury = Math.max(0, state.felfury - spell.felfuryCost);
  if (spell.felfuryGain) addFelfury(state, spell.felfuryGain);
  if (isFireball(spell)) noteFireball(state);
  if (usingFelforged && state.felforged) {
    state.felforged.stacks -= 1;
    if (state.felforged.stacks <= 0) state.felforged = null;
  }
  if (isProcRuin) {
    state.ruinProc = false;
    state.ruinProcRemain = 0;
    state.ruinReactUntil = 0;
  }
  tryArcaneArtilleryProc(state, rng);

  if (spell.id === 804216) {
    const consumed = Math.min(FELFURY_MAX, Math.max(0, Math.floor(state.felfury)));
    if (
      talentTaken(state, "felsworn", "Demonic Embrace") &&
      consumed >= FELSWORN.demonicEmbraceFelfury
    ) {
      addEnergy(state, FELSWORN.demonicEmbraceEnergy);
    }
    state.felfury = Math.max(0, state.felfury - consumed);
    const duration = innerDemonDuration(consumed);
    state.innerDemon = { remain: duration, stacks: Math.max(1, consumed) };
    state.innerDemonExpiresAt = state.time + duration;
    state.innerDemonFelshockExtension = 0;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }
  if (spell.id === POTION.id) {
    state.potion = { remain: state.potionDuration, stacks: 1 };
    state.potionDrinks += 1;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }
  if (spell.id === BLOOD.id) {
    addFelfury(state, FELSWORN.bloodOfMannorothFelfury);
    state.bloodRegen = { remain: FELSWORN.bloodOfMannorothRegenDuration, stacks: 1 };
    state.bloodReadyAt = state.time + FELSWORN.bloodOfMannorothCd;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }
  if (spell.id === 707901) {
    const ctx = combatContext(spell, stats, state, logEnergy);
    const hitRoll = rollOffensiveHit(stats, rng, true, ctx);
    trackOffensiveCast(state, !hitRoll.isMiss);
    deal(state, spell.name, 0, true, false, hitRoll.isMiss);
    logCast(state, spell.name, hitRoll.isMiss ? "miss" : "applied", 0, undefined, logResources);
    if (!hitRoll.isMiss) {
      const duration = talentTaken(state, "felsworn", "Embracing Evil")
        ? baneDuration(spell.duration ?? 21)
        : (spell.duration ?? 21);
      state.baneOfFire = { remain: duration, stacks: 1 };
    }
    return;
  }
  if (spell.id === SKULL.id) {
    const gifted = talentTaken(state, "felsworn", "Gul'dan's Gift");
    const bonus = state.baseEnergyMax * (gifted ? skullEnergyBonus() : FELSWORN.skullEnergy);
    state.energyMax = state.baseEnergyMax + bonus;
    addEnergy(state, bonus);
    state.skull = { remain: FELSWORN.skullDuration, stacks: 1 };
    state.skullReadyAt = state.time + (gifted ? skullCooldown() : FELSWORN.skullCd);
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }
  if (spell.id === ANNIHILATION.id) {
    const usedTrinket = tryUseOnUseTrinketsWithAnnihilation(state.onUseTrinkets, state.time);
    state.annihilation = { remain: FELSWORN.annihilationDuration, stacks: FELSWORN.annihilationCrits };
    state.anniReadyAt = state.time + FELSWORN.annihilationCd;
    if (talentTaken(state, "infernal", "The True Blessing")) {
      grantRuinProc(state);
      state.critsTowardRuin = 0;
    }
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    if (usedTrinket) {
      deal(state, usedTrinket.name, 0, true, false, false);
      logCast(state, `${usedTrinket.name} (Use)`, "applied", 0, undefined, logResources);
    }
    return;
  }
  if (spell.id === RECKONING.id) {
    state.reckoning = { remain: FELSWORN.reckoningDuration, stacks: 1 };
    state.reckoningReadyAt = state.time + FELSWORN.reckoningCd;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }

  const procActivations = tryProcTrinketProcs(state.procTrinkets, "direct-spell", state.time, rng, spell);
  logProcTrinketActivations(state, procActivations, logResources);

  const usingCursedFlames = isFireball(spell) && isCursedFlamesActive(state);
  const ctx = combatContext(spell, stats, state, logEnergy);
  const activeAuras = snapshotDamageAuras(state, spell, { sculptorProc: isProcRuin, energyAtCast: logEnergy });
  const roll = rollSpellDamage(spell, stats, rng, true, ctx);
  if (usingCursedFlames) consumeCursedFlames(state);
  trackOffensiveCast(state, !roll.isMiss);
  deal(state, spell.name, roll.amount, true, roll.isCrit, roll.isMiss, true, rng, true);
  logCast(state, spell.name, roll.isMiss ? "miss" : roll.isCrit ? "crit" : "hit", roll.amount, activeAuras, logResources);
  if (!roll.isMiss && spell.energyGain) addEnergy(state, spell.energyGain);
  if (!roll.isMiss && state.annihilation) {
    state.annihilation.stacks -= 1;
    if (state.annihilation.stacks <= 0) state.annihilation = null;
  }
  if (!roll.isMiss) consumeTrinketStacksOnDirectHit(state.onUseTrinkets);
  if (isFireball(spell) && !roll.isMiss && state.reckoning) {
    const stacks = Math.min(FELSWORN.reckoningBuffStacks, (state.reckoningPower?.stacks ?? 0) + 1);
    state.reckoningPower = { remain: FELSWORN.reckoningBuffDuration, stacks };
  }

  if (isRuin(spell) && !roll.isMiss && state.innerDemon && talentTaken(state, "infernal", "Ruin")) {
    state.ruinDot = {
      remain: INFERNAL.ruinDotDuration,
      stacks: 1,
      tick: (roll.amount * INFERNAL.ruinDotFraction) / INFERNAL.ruinDotDuration,
      nextTickAt: state.time + DOT_TIMING.ruinDot.firstTickDelay,
      tickPeriod: DOT_TIMING.ruinDot.tickPeriod,
    };
  }
  if (isRuin(spell) && state.innerDemon && !roll.isMiss && talentTaken(state, "infernal", "Dark Magician")) {
    addEnergy(state, INFERNAL.darkMagicianEnergy);
  }

  if (
    !roll.isMiss &&
    isFireball(spell) &&
    state.innerDemon &&
    extras.felstrike &&
    talentTaken(state, "infernal", "Fel Apprentice")
  ) {
    applyFelstrike(state, extras.felstrike);
  }
  if (
    !roll.isMiss &&
    (isRuin(spell) || isSmite(spell)) &&
    extras.chaos &&
    rng.chance(INFERNAL.chaosProcChance)
  ) {
    const chaosSpell = extras.chaos;
    const procActivations = tryProcTrinketProcs(state.procTrinkets, "direct-spell", state.time, rng, chaosSpell);
    logProcTrinketActivations(state, procActivations);
    const chaosCtx = combatContext(chaosSpell, stats, state);
    const chaosAuras = snapshotDamageAuras(state, chaosSpell);
    const chaosRoll = rollSpellDamage(chaosSpell, stats, rng, true, chaosCtx);
    trackOffensiveCast(state, !chaosRoll.isMiss);
    deal(state, chaosSpell.name, chaosRoll.amount, true, chaosRoll.isCrit, chaosRoll.isMiss, false, rng, true);
    logCast(
      state,
      chaosSpell.name,
      chaosRoll.isMiss ? "miss" : chaosRoll.isCrit ? "crit" : "hit",
      chaosRoll.amount,
      chaosAuras,
    );
    if (!chaosRoll.isMiss && state.annihilation) {
      state.annihilation.stacks -= 1;
      if (state.annihilation.stacks <= 0) state.annihilation = null;
    }
    if (!chaosRoll.isMiss) consumeTrinketStacksOnDirectHit(state.onUseTrinkets);
    if (chaosRoll.isCrit) onDirectCrit(state, extras.chaos, extras, rng);
  }
  if (isSmite(spell) && state.innerDemon && extras.smiteInner && !roll.isMiss) {
    const riderAuras = snapshotDamageAuras(state, extras.smiteInner);
    // Inner Demon: Smite casts an additional time free of cost (no Felfury, Energy, GCD, or crit roll).
    deal(state, extras.smiteInner.name, roll.amount, true, false, false, false, rng, true);
    logCast(state, extras.smiteInner.name, "hit", roll.amount, riderAuras);
  }
  if (roll.isCrit) onDirectCrit(state, spell, extras, rng);
  if (isFireball(spell) && roll.isCrit && !usingCursedFlames) grantCursedFlames(state);
}

function logProcTrinketActivations(
  state: FightState,
  activated: ProcTrinketDef[],
  resources?: { energy: number; felfury: number },
) {
  for (const def of activated) {
    logCast(state, `${def.name} (Proc)`, "applied", 0, undefined, resources);
  }
}

function logCast(
  state: FightState,
  spell: string,
  result: SimCastEvent["result"],
  damage: number,
  activeAuras?: SimActiveAura[],
  resources?: { energy: number; felfury: number },
) {
  if (state.castEvents.length >= EVENT_LOG_LIMIT) return;
  const event: SimCastEvent = {
    timestamp: Number(state.time.toFixed(3)),
    spell,
    kind: "cast",
    result,
    damage,
    energy: Number((resources?.energy ?? state.energy).toFixed(2)),
    felfury: Number((resources?.felfury ?? state.felfury).toFixed(2)),
  };
  if (activeAuras?.length) event.activeAuras = activeAuras;
  state.castEvents.push(event);
}

function logTick(
  state: FightState,
  spell: string,
  damage: number,
  activeAuras?: SimActiveAura[],
) {
  if (state.castEvents.length >= EVENT_LOG_LIMIT) return;
  const event: SimCastEvent = {
    timestamp: Number(state.time.toFixed(3)),
    spell,
    kind: "tick",
    result: "tick",
    damage,
    energy: Number(state.energy.toFixed(2)),
    felfury: Number(state.felfury.toFixed(2)),
  };
  if (activeAuras?.length) event.activeAuras = activeAuras;
  state.castEvents.push(event);
}

/** Secondary/proc hits that do not roll Chaotic in Kadd logs (e.g. Neptulon's Wrath). */
const CHAOTIC_INELIGIBLE = new Set<string>([NEPTULONS_WRATH.name]);

function tryChaotic(state: FightState, rng: Rng) {
  if (!talentTaken(state, "felsworn", "Chaotic") || !rng.chance(FELSWORN.chaoticChance)) return;
  const stacks = Math.min(FELSWORN.chaoticStacks, (state.chaotic?.stacks ?? 0) + 1);
  state.chaotic = { remain: FELSWORN.chaoticDuration, stacks };
}

function tickNeptulonsWrath(state: FightState, dt: number) {
  if (!state.neptulonsWrath) return;
  if (state.neptulonRemain > 0) {
    state.neptulonRemain = Math.max(0, state.neptulonRemain - dt);
    addAuraTime(state, NEPTULONS_WRATH.name, dt);
  }
  if (state.neptulonNextCastAt > 0 && state.time >= state.neptulonNextCastAt) {
    state.neptulonRemain = NEPTULONS_WRATH.duration;
    state.neptulonNextCastAt = state.time + NEPTULONS_WRATH.cooldown;
  }
}

function tailwindCycleTime(state: FightState): number {
  return (state.time + state.tailwindPhaseOffset) % TAILWIND_CYCLE;
}

function isTailwindActive(state: FightState): boolean {
  return state.tailwind && tailwindCycleTime(state) < TAILWIND.duration;
}

function tailwindHasteBonus(state: FightState): number {
  return isTailwindActive(state) ? TAILWIND.hastePct / 100 : 0;
}

function tickTailwind(state: FightState, dt: number) {
  if (!state.tailwind) return;
  if (isTailwindActive(state)) addAuraTime(state, TAILWIND.name, dt);
}

function isTempestsCallActive(state: FightState): boolean {
  return state.tempestsCall && state.tempestsCallRemain > 0;
}

function tempestsCallHasteBonus(state: FightState): number {
  return isTempestsCallActive(state) ? TEMPESTS_CALL.hastePct / 100 : 0;
}

function tickTempestsCall(state: FightState, dt: number) {
  if (!state.tempestsCall) return;
  if (state.tempestsCallRemain > 0) {
    state.tempestsCallRemain = Math.max(0, state.tempestsCallRemain - dt);
    addAuraTime(state, TEMPESTS_CALL.name, dt);
  }
  if (state.tempestsCallNextCastAt > 0 && state.time >= state.tempestsCallNextCastAt) {
    state.tempestsCallRemain = TEMPESTS_CALL.duration;
    state.tempestsCallNextCastAt = state.time + TEMPESTS_CALL.cooldown;
  }
}

function vulnerableCycleTime(state: FightState): number {
  return (state.time + state.vulnerablePhaseOffset) % VULNERABLE_CYCLE;
}

function isVulnerableActive(state: FightState): boolean {
  return state.vulnerable && vulnerableCycleTime(state) < VULNERABLE.duration;
}

function tickVulnerable(state: FightState, dt: number) {
  if (!state.vulnerable) return;
  if (isVulnerableActive(state)) addAuraTime(state, VULNERABLE.name, dt);
}

function tickCursedFlames(state: FightState, dt: number) {
  if (!isCursedFlamesActive(state)) {
    if (state.cursedFlamesReady && state.time > state.cursedFlamesExpireAt) {
      state.cursedFlamesReady = false;
    }
    return;
  }
  addAuraTime(state, "Cursed Flames", dt);
}

function applyNeptulonsWrath(state: FightState, rng: Rng) {
  if (!state.neptulonsWrath || state.neptulonRemain <= 0) return;
  const { playerStats } = state;
  const ap = playerStats.attackPower ?? 0;
  const sp = effectiveSpellPower(playerStats, playerStats.hiddenPower);
  const base = ap * NEPTULONS_WRATH.apCoeff + sp * NEPTULONS_WRATH.spCoeff;
  if (base <= 0) return;
  const critRate = Math.min(1, Math.max(0, playerStats.spellCrit / 100));
  const isCrit = rng.chance(critRate);
  const amount = isCrit ? base * NEPTULONS_WRATH.critMultiplier : base;
  deal(state, NEPTULONS_WRATH.name, amount, false, isCrit, false, false, rng, false);
}

function deal(
  state: FightState,
  name: string,
  amount: number,
  isCast: boolean,
  isCrit: boolean,
  isMiss: boolean,
  countsTowardRuin = false,
  rng?: Rng,
  direct = false,
  chaoticEligible = true,
) {
  state.damage += amount;
  const rec = state.bySpell.get(name) || { casts: 0, damage: 0, hits: 0, crits: 0, hitDamage: 0, critDamage: 0, misses: 0, events: 0 };
  if (isCast) rec.casts += 1;
  if (isMiss) {
    rec.misses += 1;
  } else if (amount > 0) {
    rec.events += 1;
    if (isCrit) {
      rec.crits += 1;
      rec.critDamage += amount;
    } else {
      rec.hits += 1;
      rec.hitDamage += amount;
    }
    if (rng && chaoticEligible && !CHAOTIC_INELIGIBLE.has(name)) tryChaotic(state, rng);
  }
  rec.damage += amount;
  state.bySpell.set(name, rec);

  if (direct && !isMiss && amount > 0 && rng) {
    applyNeptulonsWrath(state, rng);
  }

  if (countsTowardRuin && isCrit && !state.ruinProc && talentTaken(state, "infernal", "Sculptor of Doom")) {
    state.critsTowardRuin += 1;
    if (state.critsTowardRuin >= INFERNAL.sculptorCrits) {
      state.critsTowardRuin = 0;
      grantRuinProc(state);
    }
  }
}

function grantRuinProc(state: FightState, window = INFERNAL.sculptorWindow) {
  state.ruinProc = true;
  state.ruinProcRemain = window;
  state.ruinReactUntil = state.time + RUIN_PROC_REACTION;
}

function addAuraTime(state: FightState, name: string, dt: number) {
  state.auraSeconds.set(name, (state.auraSeconds.get(name) || 0) + dt);
}
