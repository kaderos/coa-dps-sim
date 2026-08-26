import type {
  EquippedProcTrinket,
  GearSet,
  Item,
  ProcTrinketDef,
  ProcTrinketModifiers,
  ProcTrinketTrigger,
  SpellFit,
  TrinketSlot,
} from "../types";
import {
  SPELL_CRIT_RATING_PER_PERCENT,
  SPELL_HASTE_RATING_PER_PERCENT,
} from "./stats";
import type { Rng } from "./rng";

/** Assumed proc chance when a tooltip omits one. */
export const DEFAULT_PROC_CHANCE = 0.75;
/** Assumed shared-style internal cooldown when a tooltip omits one. */
export const DEFAULT_PROC_ICD_SEC = 60;
/** Assumed buff duration when a tooltip omits one. */
export const DEFAULT_PROC_BUFF_DURATION_SEC = 10;

export type ActiveProcTrinketBuff = {
  slot: TrinketSlot;
  def: ProcTrinketDef;
  remain: number;
  stacks: number;
};

export type ProcTrinketState = {
  equipped: EquippedProcTrinket[];
  icdReadyAt: Record<string, number>;
  activeBuffs: ActiveProcTrinketBuff[];
};

export type {
  EquippedProcTrinket,
  ProcTrinketBehavior,
  ProcTrinketDef,
  ProcTrinketModifiers,
  ProcTrinketTrigger,
} from "../types";

/** Manual overrides for proc lines the parser cannot model cleanly. */
export const PROC_TRINKET_OVERRIDES: Partial<Record<number, Partial<ProcTrinketDef>>> = {};

const HEALING_PROC =
  /healing an ally|healing over time|heals? an ally|while out of combat|must remain seated/i;
const MELEE_RANGED_ONLY =
  /^(?:equip:\s*)?(?:your )?(?:direct damage )?(?:melee and ranged|melee or ranged|melee.*ranged attacks)/i;
const RANDOM_STAT = /increase either your attack power, spell power/i;
const STACK_ON_DIRECT =
  /(?:increase|increases)\s+your\s+spell power by \d+(?:\.\d+)?\s+for \d+(?:\.\d+)?\s*sec(?:onds)?,?\s*stacks up to \d+ times/i;

function procKey(slot: TrinketSlot, itemId: number): string {
  return `${slot}:${itemId}`;
}

function parseProcChance(text: string): number {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*chance/i);
  if (match) return parseFloat(match[1]) / 100;
  if (/have a chance|chance on/i.test(text)) return DEFAULT_PROC_CHANCE;
  return DEFAULT_PROC_CHANCE;
}

function parseIcdSec(text: string): number {
  const oncePerMin = text.match(/(?:once per|can only occur once per)\s+(\d+(?:\.\d+)?)\s*min/i);
  if (oncePerMin) return parseFloat(oncePerMin[1]) * 60;
  const oncePerSec = text.match(/(?:once per|can only occur once per)\s+(\d+(?:\.\d+)?)\s*sec/i);
  if (oncePerSec) return parseFloat(oncePerSec[1]);

  const parenMatch = text.match(/\(([^)]+)\)\s*$/);
  const scope = parenMatch?.[1] ?? text;
  const compound = scope.match(/(\d+)\s*min\s+(\d+(?:\.\d+)?)\s*sec(?:\.|\s|$).*(?:internal cooldown|\bcd\b)/i);
  if (compound) return parseInt(compound[1], 10) * 60 + parseFloat(compound[2]);
  const match = scope.match(/(\d+(?:\.\d+)?)\s*sec(?:\.|\s|$).*(?:internal cooldown|\bcd\b)/i);
  if (match) return parseFloat(match[1]);
  const minMatch = scope.match(/(\d+(?:\.\d+)?)\s*min(?:\.|\s|$).*(?:internal cooldown|\bcd\b)/i);
  if (minMatch) return parseFloat(minMatch[1]) * 60;
  return DEFAULT_PROC_ICD_SEC;
}

function parseDurationSec(text: string): number {
  const match = text.match(/(?:for|lasts)\s+(\d+(?:\.\d+)?)\s*sec/i);
  return match ? parseFloat(match[1]) : DEFAULT_PROC_BUFF_DURATION_SEC;
}

function parseMaxStacks(text: string): number | undefined {
  const match = text.match(/stacks up to (\d+) times/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function parseModifiers(text: string): ProcTrinketModifiers | undefined {
  const modifiers: ProcTrinketModifiers = {};
  const sp =
    text.match(/spell power by (\d+(?:\.\d+)?)/i) ??
    text.match(/spell damage by (\d+(?:\.\d+)?)/i) ??
    text.match(/gain (\d+(?:\.\d+)?) spell power/i);
  if (sp) modifiers.spellPower = parseFloat(sp[1]);
  const crit = text.match(/critical strike rating by (\d+(?:\.\d+)?)/i);
  if (crit) modifiers.critRating = parseFloat(crit[1]);
  const haste = text.match(/haste rating by (\d+(?:\.\d+)?)/i);
  if (haste) modifiers.hasteRating = parseFloat(haste[1]);
  const spirit = text.match(/spirit by (\d+(?:\.\d+)?)/i);
  if (spirit) modifiers.spirit = parseFloat(spirit[1]);
  return Object.keys(modifiers).length > 0 ? modifiers : undefined;
}

function parseTrigger(text: string): { trigger: ProcTrinketTrigger; schools?: ProcTrinketDef["schools"] } | null {
  if (HEALING_PROC.test(text)) return null;
  if (RANDOM_STAT.test(text)) return null;
  if (MELEE_RANGED_ONLY.test(text) && !/spell/i.test(text)) return null;

  if (/frost or nature damage/i.test(text)) {
    return { trigger: "direct-spell", schools: ["frost", "nature"] };
  }
  if (/periodic damage/i.test(text)) return { trigger: "periodic-spell" };
  if (
    /direct spell damage|direct magic damage|direct damage.*spells|direct damage and healing spells|direct healing and damaging spells/i.test(
      text,
    )
  ) {
    return { trigger: "direct-spell" };
  }
  if (/dealing spell damage|damaging spells/i.test(text)) return { trigger: "direct-spell" };
  return null;
}

function parseStackOnDirect(line: string, item: Item, trigger: ProcTrinketTrigger, schools?: ProcTrinketDef["schools"]): ProcTrinketDef | null {
  if (!STACK_ON_DIRECT.test(line)) return null;
  const modifiers = parseModifiers(line);
  if (!modifiers?.spellPower) return null;
  const maxStacks = parseMaxStacks(line);
  if (!maxStacks) return null;

  const parsed: ProcTrinketDef = {
    itemId: item.id,
    name: item.name,
    behavior: "stack-on-direct",
    procChance: 1,
    icdSec: 0,
    durationSec: parseDurationSec(line),
    modifiers: {},
    trigger,
    schools,
    spellPowerPerStack: modifiers.spellPower,
    maxStacks,
  };

  const override = PROC_TRINKET_OVERRIDES[item.id];
  return {
    ...parsed,
    ...override,
    spellPowerPerStack: override?.spellPowerPerStack ?? parsed.spellPowerPerStack,
    maxStacks: override?.maxStacks ?? parsed.maxStacks,
    schools: override?.schools ?? parsed.schools,
  };
}

function parseProcEffectLine(line: string, item: Item): ProcTrinketDef | null {
  if (!/^equip:/i.test(line)) return null;
  const triggerInfo = parseTrigger(line);
  if (!triggerInfo) return null;

  const stacked = parseStackOnDirect(line, item, triggerInfo.trigger, triggerInfo.schools);
  if (stacked) return stacked;

  const modifiers = parseModifiers(line);
  if (!modifiers) return null;

  const parsed: ProcTrinketDef = {
    itemId: item.id,
    name: item.name,
    behavior: "proc",
    procChance: parseProcChance(line),
    icdSec: parseIcdSec(line),
    durationSec: parseDurationSec(line),
    modifiers,
    trigger: triggerInfo.trigger,
    schools: triggerInfo.schools,
  };

  const override = PROC_TRINKET_OVERRIDES[item.id];
  return {
    ...parsed,
    ...override,
    modifiers: { ...parsed.modifiers, ...override?.modifiers },
    schools: override?.schools ?? parsed.schools,
  };
}

export function parseProcTrinketFromItem(item: Item): ProcTrinketDef | null {
  if (!/^epic$/i.test(item.quality || "")) return null;
  for (const line of item.effects ?? []) {
    const def = parseProcEffectLine(line, item);
    if (def) return def;
  }
  return null;
}

export function equippedProcTrinkets(
  gear: GearSet,
  findItem: (id: number) => Item | undefined = () => undefined,
): EquippedProcTrinket[] {
  const equipped: EquippedProcTrinket[] = [];
  for (const slot of ["trinket1", "trinket2"] as const) {
    const item = gear[slot];
    if (!item) continue;
    const resolved = findItem(item.id) ?? item;
    const def = parseProcTrinketFromItem(resolved);
    if (def) equipped.push({ slot, def });
  }
  return equipped;
}

export function createProcTrinketState(equipped: EquippedProcTrinket[]): ProcTrinketState {
  return { equipped, icdReadyAt: {}, activeBuffs: [] };
}

function spellMatchesProcSchools(spell: SpellFit | undefined, schools: ProcTrinketDef["schools"]): boolean {
  if (!schools?.length) return true;
  if (!spell?.school) return false;
  return schools.includes(spell.school);
}

function isStackOnDirect(def: ProcTrinketDef): boolean {
  return def.behavior === "stack-on-direct" || (def.maxStacks != null && def.spellPowerPerStack != null);
}

function findActiveBuff(state: ProcTrinketState, slot: TrinketSlot, itemId: number): ActiveProcTrinketBuff | undefined {
  const key = procKey(slot, itemId);
  return state.activeBuffs.find((buff) => procKey(buff.slot, buff.def.itemId) === key);
}

function applyStackProc(state: ProcTrinketState, equipped: EquippedProcTrinket): void {
  const { slot, def } = equipped;
  const existing = findActiveBuff(state, slot, def.itemId);
  const cap = def.maxStacks ?? 1;
  if (existing) {
    existing.stacks = Math.min(cap, existing.stacks + 1);
    existing.remain = def.durationSec;
    return;
  }
  state.activeBuffs.push({ slot, def, remain: def.durationSec, stacks: 1 });
}

function activateProcBuff(state: ProcTrinketState, equipped: EquippedProcTrinket): void {
  const { slot, def } = equipped;
  state.activeBuffs = state.activeBuffs.filter((buff) => procKey(buff.slot, buff.def.itemId) !== procKey(slot, def.itemId));
  state.activeBuffs.push({ slot, def, remain: def.durationSec, stacks: 1 });
}

/** Roll procs or apply stack-on-direct trinkets when a trigger fires. Returns defs that proc'd this call. */
export function tryProcTrinketProcs(
  state: ProcTrinketState,
  trigger: ProcTrinketTrigger,
  time: number,
  rng: Rng,
  spell?: SpellFit,
): ProcTrinketDef[] {
  const activated: ProcTrinketDef[] = [];
  if (!state.equipped.length) return activated;
  for (const equipped of state.equipped) {
    const { slot, def } = equipped;
    if (def.trigger !== trigger) continue;
    if (!spellMatchesProcSchools(spell, def.schools)) continue;

    if (isStackOnDirect(def)) {
      applyStackProc(state, equipped);
      continue;
    }

    const key = procKey(slot, def.itemId);
    if (time < (state.icdReadyAt[key] ?? 0)) continue;
    if (!rng.chance(def.procChance)) continue;
    state.icdReadyAt[key] = time + def.icdSec;
    activateProcBuff(state, equipped);
    activated.push(def);
  }
  return activated;
}

export function tickProcTrinketBuffs(state: ProcTrinketState, dt: number): void {
  state.activeBuffs = state.activeBuffs.filter((buff) => {
    buff.remain -= dt;
    return buff.remain > 0;
  });
}

export function procTrinketContextModifiers(state: ProcTrinketState): {
  spellPower: number;
  extraCrit: number;
  hastePct: number;
  spirit: number;
} {
  let spellPower = 0;
  let extraCrit = 0;
  let hastePct = 0;
  let spirit = 0;
  for (const buff of state.activeBuffs) {
    const mods = buff.def.modifiers;
    if (isStackOnDirect(buff.def)) {
      spellPower += buff.stacks * (buff.def.spellPowerPerStack ?? 0);
    } else {
      if (mods.spellPower) spellPower += mods.spellPower;
    }
    if (mods.critRating) extraCrit += mods.critRating / SPELL_CRIT_RATING_PER_PERCENT / 100;
    if (mods.hasteRating) hastePct += mods.hasteRating / SPELL_HASTE_RATING_PER_PERCENT;
    if (mods.spirit) spirit += mods.spirit;
  }
  return { spellPower, extraCrit, hastePct, spirit };
}

export function describeProcTrinketBuff(def: ProcTrinketDef, stacks = 1): string {
  if (isStackOnDirect(def)) {
    const perStack = def.spellPowerPerStack ?? 0;
    const cap = def.maxStacks ?? stacks;
    const total = perStack * stacks;
    return `+${perStack} Spell Power per stack (max ${cap} stacks, ${def.durationSec}s). Currently ${stacks} stack${stacks === 1 ? "" : "s"} (+${total} Spell Power).`;
  }

  const parts: string[] = [];
  if (def.modifiers.spellPower) parts.push(`+${def.modifiers.spellPower} Spell Power`);
  if (def.modifiers.critRating) parts.push(`+${def.modifiers.critRating} crit rating`);
  if (def.modifiers.hasteRating) parts.push(`+${def.modifiers.hasteRating} haste rating`);
  if (def.modifiers.spirit) parts.push(`+${def.modifiers.spirit} Spirit`);
  const effect = parts.length > 0 ? parts.join(", ") : "Proc buff";
  const chancePct = Math.round(def.procChance * 1000) / 10;
  return `${effect} for ${def.durationSec}s (${chancePct}% proc, ${def.icdSec}s ICD).`;
}
