import type { CharacterStats, PotionMode, SimActiveAura, SimCastEvent, SpellFit } from "../types";
import { Rng } from "./rng";
import { hasteMultiplier, rollSpellDamage } from "./spells";
import { isTalentEnabled } from "../talents/baseline";
import type { TalentSelection } from "../talents/types";
import {
  applyTakenTalents,
} from "../talents/taken";
import {
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

/** Shaman party buff — tooltip: AP×0.35 Froststorm on direct damage, 15s aura, 1 min CD. */
const NEPTULONS_WRATH = {
  name: "Neptulon's Wrath",
  duration: 15,
  cooldown: 60,
  apCoeff: 0.35,
} as const;

export type FightOptions = {
  potionSpellPower?: number;
  potionDuration?: number;
  potionMode?: PotionMode;
  setDamageAbove75?: number;
  talentSelection?: TalentSelection;
  /** Linear 100%→0% health over the fight (Fel Cannon / Doomsayer taper). Default off for dummy. */
  targetHealthDecays?: boolean;
  targetStartHealth?: number;
  /** Allied Shaman aura — AP×0.35 on each direct damage hit while active. */
  neptulonsWrath?: boolean;
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
  playerStats: CharacterStats;
  damage: number;
  bySpell: Map<string, { casts: number; damage: number; hits: number; crits: number; misses: number; events: number }>;
  auraSeconds: Map<string, number>;
  castEvents: SimCastEvent[];
};

const FELFURY_MAX = 6;

function talentTaken(state: FightState, tree: "felsworn" | "infernal", name: string): boolean {
  return !state.talentSelection || isTalentEnabled(state.talentSelection, tree, name);
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

export function runOnce(
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  duration: number,
  rng: Rng,
  options: FightOptions = {},
): {
  damage: number;
  bySpell: Map<string, { casts: number; damage: number; hits: number; crits: number; misses: number; events: number }>;
  auraSeconds: Map<string, number>;
  castEvents: SimCastEvent[];
  fightSec: number;
  castLogTruncated: boolean;
} {
  const specStats = applyTakenTalents(stats, options.talentSelection);
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
    playerStats: specStats,
    damage: 0,
    bySpell: new Map(),
    auraSeconds: new Map(),
    castEvents: [],
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
    addAuraTime(state, "Chaotic", dt);
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
    addAuraTime(state, "Reckoning (damage)", dt);
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
  if (state.innerDemon) {
    addAuraTime(state, "Inner Demon", dt);
    state.innerDemon.remain -= dt;
    if (state.innerDemon.remain <= 0) state.innerDemon = null;
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
      const roll = rollSpellDamage(spell, stats, rng, false, combatContext(spell, stats, state));
      const amount = roll.amount * state.felstrike!.stacks;
      const auras = snapshotTickAuras(state, spell, state.felstrike!.stacks);
      deal(state, spell.name, amount, false, roll.isCrit, roll.isMiss, false, rng);
      logTick(state, spell.name, amount, auras);
      onPeriodic(state, rng);
    });
  }
  if (state.ruinDot) {
    addAuraTime(state, "Ruin (DoT)", dt);
    const ruin = spells["501298"];
    state.ruinDot = tickDotAura(state, state.ruinDot, dt, () => {
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
  const innerRemain = state.innerDemon?.remain ?? 0;
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

function combatContext(spell: SpellFit, stats: CharacterStats, state: FightState) {
  return infernalContext(spell, stats, {
    innerDemon: Boolean(state.innerDemon),
    baneOfFire: Boolean(state.baneOfFire),
    maliceCritRemain: state.maliceCritRemain,
    felshockHitRemain: state.felshockHitRemain,
    energy: state.energy,
    chaoticStacks: state.chaotic?.stacks ?? 0,
    reckoningStacks: state.reckoningPower?.stacks ?? 0,
    guaranteedCrit: Boolean(state.annihilation && state.annihilation.stacks > 0),
    potionSpellPower: state.potion ? state.potionSpellPower : 0,
    targetStartHealth: state.targetStartHealth,
    targetHealthDecays: state.targetHealthDecays,
    fightTime: state.time,
    fightDuration: state.fightDuration,
    setDamageAbove75: state.setDamageAbove75,
  }, state.talentSelection);
}

/** Buffs/procs that were active when infernalContext calculated this spell's damage. */
function snapshotDamageAuras(state: FightState, spell: SpellFit, sculptorProc = false): SimActiveAura[] {
  const auras: SimActiveAura[] = [];
  const push = (name: string, stacks = 1) => {
    if (stacks > 0) auras.push({ name, stacks });
  };

  if (state.innerDemon) push("Inner Demon", state.innerDemon.stacks);
  if (state.baneOfFire && spellAffectsFire(spell)) push("Bane of Fire");
  if (state.maliceCritRemain > 0) push("Fragment of Malice");
  if (state.felshockHitRemain > 0) push("Felshock");
  if (state.chaotic?.stacks) push("Chaotic", state.chaotic.stacks);
  if (state.reckoningPower?.stacks) push("Reckoning", state.reckoningPower.stacks);
  if (state.annihilation?.stacks) push("Annihilation", state.annihilation.stacks);
  if (state.potion) push("Potion of Spell Power");
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
  if (isFelfurySpender(spell) && state.innerDemon) {
    state.innerDemon.remain += INFERNAL.felshockInnerExtend;
    state.felshockHitRemain = INFERNAL.felshockDuration;
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
  return hasteMultiplier(stats) + felheart;
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

  if (spell.id === 804216) {
    const consumed = Math.min(FELFURY_MAX, Math.max(0, Math.floor(state.felfury)));
    if (
      talentTaken(state, "felsworn", "Demonic Embrace") &&
      consumed >= FELSWORN.demonicEmbraceFelfury
    ) {
      addEnergy(state, FELSWORN.demonicEmbraceEnergy);
    }
    state.felfury = Math.max(0, state.felfury - consumed);
    state.innerDemon = { remain: innerDemonDuration(consumed), stacks: Math.max(1, consumed) };
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
    const duration = talentTaken(state, "felsworn", "Embracing Evil")
      ? baneDuration(spell.duration ?? 21)
      : (spell.duration ?? 21);
    state.baneOfFire = { remain: duration, stacks: 1 };
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
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
    state.annihilation = { remain: FELSWORN.annihilationDuration, stacks: FELSWORN.annihilationCrits };
    state.anniReadyAt = state.time + FELSWORN.annihilationCd;
    if (talentTaken(state, "infernal", "The True Blessing")) {
      grantRuinProc(state);
      state.critsTowardRuin = 0;
    }
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }
  if (spell.id === RECKONING.id) {
    state.reckoning = { remain: FELSWORN.reckoningDuration, stacks: 1 };
    state.reckoningReadyAt = state.time + FELSWORN.reckoningCd;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0, undefined, logResources);
    return;
  }

  const ctx = combatContext(spell, stats, state);
  const activeAuras = snapshotDamageAuras(state, spell, isProcRuin);
  const roll = rollSpellDamage(spell, stats, rng, true, ctx);
  deal(state, spell.name, roll.amount, true, roll.isCrit, roll.isMiss, true, rng, true);
  logCast(state, spell.name, roll.isMiss ? "miss" : roll.isCrit ? "crit" : "hit", roll.amount, activeAuras, logResources);
  if (!roll.isMiss && spell.energyGain) addEnergy(state, spell.energyGain);
  if (!roll.isMiss && state.annihilation) {
    state.annihilation.stacks -= 1;
    if (state.annihilation.stacks <= 0) state.annihilation = null;
  }
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
    isFireball(spell) &&
    state.innerDemon &&
    extras.felstrike &&
    talentTaken(state, "infernal", "Fel Apprentice")
  ) {
    applyFelstrike(state, extras.felstrike);
  }
  if ((isRuin(spell) || isSmite(spell)) && extras.chaos && extras.smite && rng.chance(INFERNAL.chaosProcChance)) {
    const chaosSpell = extras.chaos;
    const smiteSpell = extras.smite;
    const chaosCtx = combatContext(chaosSpell, stats, state);
    const chaosAuras = snapshotDamageAuras(state, chaosSpell);
    const chaosRoll = rollSpellDamage(chaosSpell, stats, rng, true, chaosCtx, {
      formulaSpell: smiteSpell,
      critSpell: smiteSpell,
    });
    deal(state, chaosSpell.name, chaosRoll.amount, true, chaosRoll.isCrit, chaosRoll.isMiss, true, rng, true);
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
    if (chaosRoll.isCrit) onDirectCrit(state, extras.chaos, extras, rng);
  }
  if (isSmite(spell) && state.innerDemon && extras.smiteInner && !roll.isMiss) {
    const riderAuras = snapshotDamageAuras(state, extras.smiteInner);
    // Inner Demon: Smite casts an additional time free of cost (no Felfury, Energy, GCD, or crit roll).
    deal(state, extras.smiteInner.name, roll.amount, true, false, false, false, rng, true);
    logCast(state, extras.smiteInner.name, "hit", roll.amount, riderAuras);
  }
  if (roll.isCrit) onDirectCrit(state, spell, extras, rng);
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

function applyNeptulonsWrath(state: FightState, rng: Rng) {
  if (!state.neptulonsWrath || state.neptulonRemain <= 0) return;
  const ap = state.playerStats.attackPower ?? 0;
  const base = ap * NEPTULONS_WRATH.apCoeff;
  if (base <= 0) return;
  const critRate = Math.min(1, Math.max(0, state.playerStats.spellCrit / 100));
  const isCrit = rng.chance(critRate);
  const amount = isCrit ? base * 2 : base;
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
) {
  state.damage += amount;
  const rec = state.bySpell.get(name) || { casts: 0, damage: 0, hits: 0, crits: 0, misses: 0, events: 0 };
  if (isCast) rec.casts += 1;
  if (isMiss) {
    rec.misses += 1;
  } else if (amount > 0) {
    rec.events += 1;
    if (isCrit) rec.crits += 1;
    else rec.hits += 1;
    if (rng) tryChaotic(state, rng);
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
