import type { CharacterStats, PotionMode, SimCastEvent, SpellFit } from "../types";
import { Rng } from "./rng";
import { hasteMultiplier, rollSpellDamage } from "./spells";
import {
  applyTakenTalents,
} from "../talents/taken";
import {
  fireballCastTime,
  fireballEnergyCost,
  INFERNAL,
  infernalContext,
  innerDemonDuration,
  isFireball,
  isFelfurySpender,
  isRuin,
  isSmite,
} from "../talents/infernal";
import {
  baneDuration,
  baneEnergyCost,
  energyRegenPerSecond,
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

export type FightOptions = {
  potionSpellPower?: number;
  potionDuration?: number;
  potionMode?: PotionMode;
};

export type Aura = {
  remain: number;
  stacks: number;
  tick?: number;
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
  potionUsed: boolean;
  potionSpellPower: number;
  potionDuration: number;
  potionMode: PotionMode;
  reckoningPower: Aura | null;
  maliceCritRemain: number;
  felshockHitRemain: number;
  damage: number;
  bySpell: Map<string, { casts: number; damage: number; hits: number; crits: number; misses: number; events: number }>;
  auraSeconds: Map<string, number>;
  castEvents: SimCastEvent[];
};

const FELFURY_MAX = 6;
const EVENT_LOG_LIMIT = 500;

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
} {
  const specStats = applyTakenTalents(stats);
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
    potionUsed: false,
    potionSpellPower: options.potionSpellPower ?? 0,
    potionDuration: options.potionDuration ?? 20,
    potionMode: options.potionMode ?? "none",
    reckoningPower: null,
    maliceCritRemain: 0,
    felshockHitRemain: 0,
    damage: 0,
    bySpell: new Map(),
    auraSeconds: new Map(),
    castEvents: [],
  };

  if (state.potionMode === "prepot" && state.potionSpellPower > 0) {
    state.potion = { remain: state.potionDuration, stacks: 1 };
    state.potionUsed = true;
  }

  const tick = 0.05;
  while (state.time < duration) {
    regen(state, tick);
    tickAuras(state, tick, spells, specStats, rng);

    while (state.time >= state.castingUntil) {
      const action = chooseAction(state, fireball, ruin, smite, inner, bane, state.time >= state.gcdReady);
      if (!action) break;
      cast(state, action, specStats, rng, {
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
  };
}

function regen(state: FightState, dt: number) {
  addEnergy(state, energyRegenPerSecond(Boolean(state.bloodRegen)) * dt);
}

function tickAuras(
  state: FightState,
  dt: number,
  spells: Record<string, SpellFit>,
  stats: CharacterStats,
  rng: Rng,
) {
  if (state.ruinProc) {
    state.ruinProcRemain -= dt;
    if (state.ruinProcRemain <= 0) {
      state.ruinProc = false;
      state.ruinProcRemain = 0;
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
    const prev = state.felstrike.remain;
    state.felstrike.remain -= dt;
    if (spell && Math.floor(prev) !== Math.floor(state.felstrike.remain) && state.felstrike.remain > 0) {
      const roll = rollSpellDamage(spell, stats, rng, false, combatContext(spell, stats, state));
      deal(state, spell.name, roll.amount * state.felstrike.stacks, false, roll.isCrit, roll.isMiss, false, rng);
      onPeriodic(state, rng);
    }
    if (state.felstrike.remain <= 0) state.felstrike = null;
  }
  if (state.ruinDot) {
    addAuraTime(state, "Ruin (DoT)", dt);
    const prev = state.ruinDot.remain;
    state.ruinDot.remain -= dt;
    if (Math.floor(prev) !== Math.floor(state.ruinDot.remain) && state.ruinDot.remain > 0) {
      deal(state, "Ruin (DoT)", state.ruinDot.tick ?? 0, false, false, false, false, rng);
      onPeriodic(state, rng);
    }
    if (state.ruinDot.remain <= 0) state.ruinDot = null;
  }
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

  if (onGcdOk && innerUp && state.ruinProc && ruin && state.felfury >= ruinCost) return ruin;

  const baneCost = baneEnergyCost(bane?.energy ?? 40);
  if (onGcdOk && bane && state.energy >= baneCost && (!state.baneOfFire || state.baneOfFire.remain <= 1.5)) {
    return bane;
  }

  if (inner && state.felfury >= 1 && ((!innerUp && fullFelfury) || expiring)) return inner;

  if (
    innerUp &&
    state.potionMode === "with-cooldowns" &&
    state.potionSpellPower > 0 &&
    !state.potionUsed
  ) {
    return POTION;
  }
  if (innerUp && state.time >= state.bloodReadyAt) return BLOOD;

  const baneUp = Boolean(state.baneOfFire && state.baneOfFire.remain > 1.5);
  if (!state.ruinProc && state.felfury >= 2 && innerUp && baneUp && state.time >= state.anniReadyAt) {
    if (state.time >= state.skullReadyAt) return SKULL;
    return ANNIHILATION;
  }

  if (
    !state.felforged &&
    state.felfury < 3 &&
    !state.reckoning &&
    state.time >= state.reckoningReadyAt
  ) {
    return RECKONING;
  }

  if (onGcdOk && smite && state.felfury >= 3 && !banking) return smite;

  const fbCost = fireballEnergyCost(fireball?.energy ?? 35);
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
    targetHealth: 1,
  });
}

function applyFelstrike(state: FightState, spell: SpellFit) {
  const stacks = Math.min(spell.maxStacks ?? 3, (state.felstrike?.stacks ?? 0) + 1);
  state.felstrike = { remain: spell.duration ?? 6, stacks };
}

function onPeriodic(state: FightState, rng: Rng) {
  if (rng.chance(INFERNAL.illidariMagiChance)) addFelfury(state, 1);
  if (rng.chance(INFERNAL.felforgedChance)) {
    state.felforged = { remain: INFERNAL.felforgedDuration, stacks: INFERNAL.felforgedCharges };
  }
}

function onDirectCrit(
  state: FightState,
  spell: SpellFit,
  extras: { felstrike?: SpellFit },
  rng: Rng,
) {
  if (isFireball(spell)) addFelfury(state, INFERNAL.illidariSmiterFelfury);
  if (isSmite(spell)) addFelfury(state, INFERNAL.doomsayerSmiteRefund);
  addEnergy(state, FELSWORN.focusedHatredEnergy);
  if (isFelfurySpender(spell) && state.innerDemon) {
    state.innerDemon.remain += INFERNAL.felshockInnerExtend;
    state.felshockHitRemain = INFERNAL.felshockDuration;
  }
  if (rng.chance(INFERNAL.maliceChance)) {
    if (extras.felstrike) applyFelstrike(state, extras.felstrike);
    addEnergy(state, INFERNAL.maliceEnergy);
    state.maliceCritRemain = INFERNAL.maliceDuration;
  }
}

function currentHaste(stats: CharacterStats, state: FightState) {
  return hasteMultiplier(stats) + felheartHaste(state.felfury);
}

function noteFireball(state: FightState) {
  if (state.fireballStreak === 0 || state.time - state.fireballStreakStart > FELSWORN.felwrackedWindow) {
    state.fireballStreak = 1;
    state.fireballStreakStart = state.time;
    return;
  }
  state.fireballStreak += 1;
  if (state.fireballStreak >= FELSWORN.felwrackedFireballs) {
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
    smiteInner?: SpellFit;
    felstrike?: SpellFit;
    chaos?: SpellFit;
  },
) {
  const haste = currentHaste(stats, state);
  const isProcRuin = isRuin(spell) && state.ruinProc;
  const usingFelforged = isFireball(spell) && Boolean(state.felforged);
  const reckoningFireball = isFireball(spell) && Boolean(state.reckoning);
  const castTime = isProcRuin || reckoningFireball
    ? 0
    : isFireball(spell)
      ? fireballCastTime(spell.castTime || 0, haste, usingFelforged)
      : (spell.castTime || 0) / haste;
  const gcd = spell.gcd > 0 ? Math.max(spell.gcd / haste, 0.75) : 0;
  state.castingUntil = state.time + castTime;
  state.gcdReady = state.time + Math.max(gcd, castTime);

  const energyCost = reckoningFireball
    ? 0
    : isFireball(spell)
      ? fireballEnergyCost(spell.energy ?? 35)
      : spell.id === 707901
        ? baneEnergyCost(spell.energy ?? 40)
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
  }

  if (spell.id === 804216) {
    const consumed = Math.min(FELFURY_MAX, Math.max(0, Math.floor(state.felfury)));
    if (consumed >= FELSWORN.demonicEmbraceFelfury) addEnergy(state, FELSWORN.demonicEmbraceEnergy);
    state.felfury = Math.max(0, state.felfury - consumed);
    state.innerDemon = { remain: innerDemonDuration(consumed), stacks: Math.max(1, consumed) };
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }
  if (spell.id === POTION.id) {
    state.potion = { remain: state.potionDuration, stacks: 1 };
    state.potionUsed = true;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }
  if (spell.id === BLOOD.id) {
    addFelfury(state, FELSWORN.bloodOfMannorothFelfury);
    state.bloodRegen = { remain: FELSWORN.bloodOfMannorothRegenDuration, stacks: 1 };
    state.bloodReadyAt = state.time + FELSWORN.bloodOfMannorothCd;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }
  if (spell.id === 707901) {
    state.baneOfFire = { remain: baneDuration(spell.duration ?? 21), stacks: 1 };
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }
  if (spell.id === SKULL.id) {
    const bonus = state.baseEnergyMax * skullEnergyBonus();
    state.energyMax = state.baseEnergyMax + bonus;
    addEnergy(state, bonus);
    state.skull = { remain: FELSWORN.skullDuration, stacks: 1 };
    state.skullReadyAt = state.time + skullCooldown();
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }
  if (spell.id === ANNIHILATION.id) {
    state.annihilation = { remain: FELSWORN.annihilationDuration, stacks: FELSWORN.annihilationCrits };
    state.anniReadyAt = state.time + FELSWORN.annihilationCd;
    state.ruinProc = true;
    state.ruinProcRemain = INFERNAL.sculptorWindow;
    state.critsTowardRuin = 0;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }
  if (spell.id === RECKONING.id) {
    state.reckoning = { remain: FELSWORN.reckoningDuration, stacks: 1 };
    state.reckoningReadyAt = state.time + FELSWORN.reckoningCd;
    deal(state, spell.name, 0, true, false, false);
    logCast(state, spell.name, "applied", 0);
    return;
  }

  const ctx = combatContext(spell, stats, state);
  const roll = rollSpellDamage(spell, stats, rng, true, ctx);
  deal(state, spell.name, roll.amount, true, roll.isCrit, roll.isMiss, true, rng);
  logCast(state, spell.name, roll.isMiss ? "miss" : roll.isCrit ? "crit" : "hit", roll.amount);
  if (!roll.isMiss && state.annihilation) {
    state.annihilation.stacks -= 1;
    if (state.annihilation.stacks <= 0) state.annihilation = null;
  }
  if (isFireball(spell) && !roll.isMiss && state.reckoning) {
    const stacks = Math.min(FELSWORN.reckoningBuffStacks, (state.reckoningPower?.stacks ?? 0) + 1);
    state.reckoningPower = { remain: FELSWORN.reckoningBuffDuration, stacks };
  }

  if (isRuin(spell) && !roll.isMiss && state.innerDemon) {
    state.ruinDot = {
      remain: INFERNAL.ruinDotDuration,
      stacks: 1,
      tick: (roll.amount * INFERNAL.ruinDotFraction) / INFERNAL.ruinDotDuration,
    };
  }
  if (isRuin(spell) && state.innerDemon && !roll.isMiss) {
    addEnergy(state, INFERNAL.darkMagicianEnergy);
  }

  if (isFireball(spell) && state.innerDemon && extras.felstrike) {
    applyFelstrike(state, extras.felstrike);
  }
  if ((isRuin(spell) || isSmite(spell)) && extras.chaos && rng.chance(0.35)) {
    const chaosRoll = rollSpellDamage(extras.chaos, stats, rng, true, combatContext(extras.chaos, stats, state));
    deal(state, extras.chaos.name, chaosRoll.amount, true, chaosRoll.isCrit, chaosRoll.isMiss, true, rng);
    if (!chaosRoll.isMiss && state.annihilation) {
      state.annihilation.stacks -= 1;
      if (state.annihilation.stacks <= 0) state.annihilation = null;
    }
    if (chaosRoll.isCrit) onDirectCrit(state, extras.chaos, extras, rng);
  }
  if (isSmite(spell) && state.innerDemon && extras.smiteInner && !roll.isMiss) {
    deal(state, extras.smiteInner.name, roll.amount, true, false, false, false, rng);
  }
  if (roll.isCrit) onDirectCrit(state, spell, extras, rng);
}

function logCast(
  state: FightState,
  spell: string,
  result: SimCastEvent["result"],
  damage: number,
) {
  if (state.castEvents.length >= EVENT_LOG_LIMIT) return;
  state.castEvents.push({
    timestamp: Number(state.time.toFixed(3)),
    spell,
    result,
    damage,
    energy: Number(state.energy.toFixed(2)),
    felfury: Number(state.felfury.toFixed(2)),
  });
}

function tryChaotic(state: FightState, rng: Rng) {
  if (!rng.chance(FELSWORN.chaoticChance)) return;
  const stacks = Math.min(FELSWORN.chaoticStacks, (state.chaotic?.stacks ?? 0) + 1);
  state.chaotic = { remain: FELSWORN.chaoticDuration, stacks };
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

  if (countsTowardRuin && isCrit && !state.ruinProc) {
    state.critsTowardRuin += 1;
    if (state.critsTowardRuin >= INFERNAL.sculptorCrits) {
      state.critsTowardRuin = 0;
      state.ruinProc = true;
      state.ruinProcRemain = INFERNAL.sculptorWindow;
    }
  }
}

function addAuraTime(state: FightState, name: string, dt: number) {
  state.auraSeconds.set(name, (state.auraSeconds.get(name) || 0) + dt);
}
