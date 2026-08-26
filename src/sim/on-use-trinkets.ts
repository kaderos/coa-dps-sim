import type {
  GearSet,
  Item,
  EquippedOnUseTrinket,
  OnUseTrinketDef,
  TrinketModifiers,
  TrinketSlot,
  TrinketStackConfig,
} from "../types";

/** Prevents stacking two on-use trinkets in the same burst window. */
export const TRINKET_SHARED_BLOCK_SEC = 30;

/** Default buff duration when a Use: line omits one. */
export const DEFAULT_TRINKET_BUFF_DURATION_SEC = 10;

export type ActiveTrinketBuff = {
  slot: TrinketSlot;
  def: OnUseTrinketDef;
  remain: number;
  stacks: number;
};

export type OnUseTrinketState = {
  equipped: EquippedOnUseTrinket[];
  trinketReadyAt: Record<TrinketSlot, number>;
  trinketBlockedUntil: Record<TrinketSlot, number>;
  activeBuffs: ActiveTrinketBuff[];
};

export type { EquippedOnUseTrinket, OnUseTrinketDef, TrinketModifiers, TrinketSlot, TrinketStackConfig } from "../types";

/** Manual overrides for trinkets that need explicit modeling beyond tooltip parsing. */
export const ON_USE_TRINKET_OVERRIDES: Partial<Record<number, Partial<OnUseTrinketDef>>> = {
  223046: {
    name: "The Restrained Essence of Sapphiron",
    cooldownSec: 120,
    durationSec: 20,
    modifiers: { spellPower: 161 },
  },
  317543: {
    name: "Hibernation Crystal",
    cooldownSec: 90,
    durationSec: 15,
    modifiers: { spellPower: 186 },
  },
};

const NON_COMBAT_USE =
  /only usable|summon|gaze|eat your provisions|restores\s+\d|restore\s+\d|while out of combat|must remain seated/i;

function parseCooldownSec(text: string): number {
  const compound = text.match(/\((\d+)\s*Min\s+(\d+(?:\.\d+)?)\s*Sec\s*Cooldown\)/i);
  if (compound) return parseInt(compound[1], 10) * 60 + parseFloat(compound[2]);
  const match = text.match(/\((\d+(?:\.\d+)?)\s*(Min|Sec)\s*Cooldown\)/i);
  if (!match) return 120;
  const value = parseFloat(match[1]);
  return match[2].toLowerCase().startsWith("min") ? value * 60 : value;
}

function parseDurationSec(text: string): number {
  const match = text.match(/(?:for|lasts)\s+(\d+(?:\.\d+)?)\s*sec/i);
  return match ? parseFloat(match[1]) : DEFAULT_TRINKET_BUFF_DURATION_SEC;
}

function parseModifiers(text: string): TrinketModifiers | undefined {
  const modifiers: TrinketModifiers = {};
  const sp = text.match(/spell power by (\d+(?:\.\d+)?)/i);
  if (sp) modifiers.spellPower = parseFloat(sp[1]);
  const dmg =
    text.match(/(?:damage done|spell damage|all damage).*?by (\d+(?:\.\d+)?)%/i) ??
    text.match(/increases.*?damage.*?by (\d+(?:\.\d+)?)%/i);
  if (dmg) modifiers.damageDone = parseFloat(dmg[1]) / 100;
  const crit = text.match(/critical strike(?: chance|rating)? by (\d+(?:\.\d+)?)%/i);
  if (crit) modifiers.extraCrit = parseFloat(crit[1]) / 100;
  return Object.keys(modifiers).length > 0 ? modifiers : undefined;
}

function parseStackConfig(text: string): TrinketStackConfig | undefined {
  const nextDirect = text.match(/next\s+(\d+)\s+direct\s+spells?/i);
  if (nextDirect) {
    return { initial: parseInt(nextDirect[1], 10), consumeOnDirectHit: true };
  }
  const stacks = text.match(/(?:grants?|gain)\s+(\d+)\s+stacks?/i);
  if (stacks) {
    return { initial: parseInt(stacks[1], 10), consumeOnDirectHit: false };
  }
  return undefined;
}

export function parseOnUseTrinketFromItem(item: Item): OnUseTrinketDef | null {
  const useLine = item.effects?.find((line) => /^Use:/i.test(line));
  if (!useLine || NON_COMBAT_USE.test(useLine)) return null;

  const override = ON_USE_TRINKET_OVERRIDES[item.id];
  const parsed: OnUseTrinketDef = {
    itemId: item.id,
    name: item.name,
    cooldownSec: parseCooldownSec(useLine),
    durationSec: parseDurationSec(useLine),
    modifiers: parseModifiers(useLine),
    stacks: parseStackConfig(useLine),
  };

  const merged: OnUseTrinketDef = {
    ...parsed,
    ...override,
    modifiers: { ...parsed.modifiers, ...override?.modifiers },
    stacks: override?.stacks ?? parsed.stacks,
  };

  if (!merged.modifiers && !merged.stacks) return null;
  return merged;
}

export function equippedOnUseTrinkets(
  gear: GearSet,
  findItem: (id: number) => Item | undefined = () => undefined,
): EquippedOnUseTrinket[] {
  const equipped: EquippedOnUseTrinket[] = [];
  for (const slot of ["trinket1", "trinket2"] as const) {
    const item = gear[slot];
    if (!item) continue;
    const resolved = findItem(item.id) ?? item;
    const def = parseOnUseTrinketFromItem(resolved);
    if (def) equipped.push({ slot, def });
  }
  return equipped;
}

export function createOnUseTrinketState(equipped: EquippedOnUseTrinket[]): OnUseTrinketState {
  return {
    equipped,
    trinketReadyAt: { trinket1: 0, trinket2: 0 },
    trinketBlockedUntil: { trinket1: 0, trinket2: 0 },
    activeBuffs: [],
  };
}

function otherTrinketSlot(slot: TrinketSlot): TrinketSlot {
  return slot === "trinket1" ? "trinket2" : "trinket1";
}

function isTrinketReady(state: OnUseTrinketState, slot: TrinketSlot, time: number): boolean {
  return time >= state.trinketReadyAt[slot] && time >= state.trinketBlockedUntil[slot];
}

function activateTrinket(state: OnUseTrinketState, equipped: EquippedOnUseTrinket, time: number): void {
  const { slot, def } = equipped;
  state.trinketReadyAt[slot] = time + def.cooldownSec;
  state.trinketBlockedUntil[otherTrinketSlot(slot)] = time + TRINKET_SHARED_BLOCK_SEC;
  state.activeBuffs = state.activeBuffs.filter((buff) => buff.slot !== slot);
  state.activeBuffs.push({
    slot,
    def,
    remain: def.durationSec,
    stacks: def.stacks?.initial ?? 1,
  });
}

/** Use one ready on-use trinket when Annihilation fires (trinket1 preferred if both ready). */
export function tryUseOnUseTrinketsWithAnnihilation(
  trinkets: OnUseTrinketState,
  time: number,
): OnUseTrinketDef | null {
  if (!trinkets.equipped?.length) return null;
  for (const slot of ["trinket1", "trinket2"] as const) {
    const equipped = trinkets.equipped.find((entry) => entry.slot === slot);
    if (!equipped || !isTrinketReady(trinkets, slot, time)) continue;
    activateTrinket(trinkets, equipped, time);
    return equipped.def;
  }
  return null;
}

export function tickOnUseTrinketBuffs(state: OnUseTrinketState, dt: number): void {
  state.activeBuffs = state.activeBuffs.filter((buff) => {
    buff.remain -= dt;
    return buff.remain > 0 && buff.stacks > 0;
  });
}

export function consumeTrinketStacksOnDirectHit(state: OnUseTrinketState): void {
  for (const buff of state.activeBuffs) {
    if (!buff.def.stacks?.consumeOnDirectHit) continue;
    buff.stacks -= 1;
  }
  state.activeBuffs = state.activeBuffs.filter((buff) => buff.stacks > 0 && buff.remain > 0);
}

export function trinketContextModifiers(state: OnUseTrinketState): {
  spellPower: number;
  damageDone: number;
  extraCrit: number;
} {
  let spellPower = 0;
  let damageDone = 0;
  let extraCrit = 0;
  for (const buff of state.activeBuffs) {
    const stacks = buff.stacks;
    const flat = buff.def.modifiers;
    const perStack = buff.def.stacks;
    if (flat?.spellPower) spellPower += flat.spellPower;
    if (flat?.damageDone) damageDone += flat.damageDone;
    if (flat?.extraCrit) extraCrit += flat.extraCrit;
    if (perStack?.spellPowerPerStack) spellPower += perStack.spellPowerPerStack * stacks;
    if (perStack?.damageDonePerStack) damageDone += perStack.damageDonePerStack * stacks;
    if (perStack?.extraCritPerStack) extraCrit += perStack.extraCritPerStack * stacks;
  }
  return { spellPower, damageDone, extraCrit };
}

export function describeTrinketBuff(def: OnUseTrinketDef, stacks: number): string {
  const parts: string[] = [];
  if (def.modifiers?.spellPower) parts.push(`+${def.modifiers.spellPower} Spell Power`);
  if (def.modifiers?.damageDone) parts.push(`+${Math.round(def.modifiers.damageDone * 100)}% damage done`);
  if (def.modifiers?.extraCrit) parts.push(`+${Math.round(def.modifiers.extraCrit * 100)}% crit`);
  if (def.stacks?.spellPowerPerStack) {
    parts.push(`+${def.stacks.spellPowerPerStack * stacks} Spell Power (${stacks} stacks)`);
  }
  if (def.stacks?.damageDonePerStack) {
    parts.push(`+${Math.round(def.stacks.damageDonePerStack * stacks * 100)}% damage done (${stacks} stacks)`);
  }
  if (def.stacks?.extraCritPerStack) {
    parts.push(`+${Math.round(def.stacks.extraCritPerStack * stacks * 100)}% crit (${stacks} stacks)`);
  }
  const effect = parts.length > 0 ? parts.join(", ") : "On-use trinket buff";
  let hint = `${effect} for ${def.durationSec}s (on-use trinket).`;
  if (def.stacks?.consumeOnDirectHit && stacks > 0) {
    hint += ` ${stacks} charge${stacks === 1 ? "" : "s"} remaining.`;
  } else if (stacks > 1) {
    hint += ` ${stacks} stacks active.`;
  }
  return hint;
}

export function trinketAuraHint(name: string, stacks: number): string | undefined {
  for (const partial of Object.values(ON_USE_TRINKET_OVERRIDES)) {
    if (!partial?.name || partial.name !== name) continue;
    const def: OnUseTrinketDef = {
      itemId: 0,
      name: partial.name,
      cooldownSec: partial.cooldownSec ?? 120,
      durationSec: partial.durationSec ?? DEFAULT_TRINKET_BUFF_DURATION_SEC,
      modifiers: partial.modifiers,
      stacks: partial.stacks,
    };
    return describeTrinketBuff(def, stacks);
  }
  return undefined;
}
