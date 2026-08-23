import type { BuffsConfig, Enchant, EnchantSet, GearSet, Item, Slot } from "./types";
import type { TalentSelection } from "./talents/types";
import { SLOTS } from "./types";

const STORAGE_KEY = "coa-sim.session.v1";

export type SessionPersist = {
  gear: Partial<Record<Slot, number | null>>;
  selectedPhase?: string;
  buffs?: Partial<BuffsConfig>;
  pullFelfury?: number;
  enchants?: Partial<Record<Slot, number | null>>;
  talents?: Partial<TalentSelection>;
};

export function loadSession(): SessionPersist {
  const empty: SessionPersist = { gear: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as SessionPersist | null;
    if (!saved || typeof saved !== "object") return empty;
    return {
      gear: sanitizeGear(saved.gear),
      selectedPhase: typeof saved.selectedPhase === "string" ? saved.selectedPhase : undefined,
      buffs: saved.buffs && typeof saved.buffs === "object" ? saved.buffs : undefined,
      pullFelfury: sanitizePullFelfury(saved.pullFelfury),
      enchants: sanitizeGear(saved.enchants),
      talents: saved.talents && typeof saved.talents === "object" ? saved.talents : undefined,
    };
  } catch {
    // Corrupt or unavailable storage just falls back to empty gear.
  }
  return empty;
}

export function saveSession(patch: Partial<SessionPersist>) {
  try {
    const current = loadSession();
    const next: SessionPersist = {
      gear: patch.gear !== undefined ? patch.gear : current.gear,
      selectedPhase: patch.selectedPhase !== undefined ? patch.selectedPhase : current.selectedPhase,
      buffs: patch.buffs !== undefined ? patch.buffs : current.buffs,
      pullFelfury: patch.pullFelfury !== undefined ? patch.pullFelfury : current.pullFelfury,
      enchants: patch.enchants !== undefined ? patch.enchants : current.enchants,
      talents: patch.talents !== undefined ? patch.talents : current.talents,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Editing still works in memory when storage is blocked.
  }
}

export function saveGearSet(gear: GearSet) {
  const ids: Partial<Record<Slot, number | null>> = {};
  for (const slot of SLOTS) {
    ids[slot] = gear[slot]?.id ?? null;
  }
  saveSession({ gear: ids });
}

export function saveEnchantSet(enchants: EnchantSet) {
  const ids: Partial<Record<Slot, number | null>> = {};
  for (const slot of SLOTS) {
    ids[slot] = enchants[slot]?.id ?? null;
  }
  saveSession({ enchants: ids });
}

export function restoreEnchantSet(
  enchants: EnchantSet,
  saved: Partial<Record<Slot, number | null>> | undefined,
  findEnchant: (id: number) => Enchant | undefined,
) {
  if (!saved) return;
  for (const slot of SLOTS) {
    const id = saved[slot];
    if (id == null) {
      if (id === null) enchants[slot] = null;
      continue;
    }
    enchants[slot] = findEnchant(id) ?? null;
  }
}

export function restoreGearSet(
  gear: GearSet,
  saved: Partial<Record<Slot, number | null>>,
  findItem: (id: number) => Item | undefined,
) {
  for (const slot of SLOTS) {
    const id = saved[slot];
    if (id == null) {
      if (id === null) gear[slot] = null;
      continue;
    }
    gear[slot] = findItem(id) ?? null;
  }
}

function sanitizePullFelfury(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(6, Math.floor(value)));
}

function sanitizeGear(raw: unknown): Partial<Record<Slot, number | null>> {
  const gear: Partial<Record<Slot, number | null>> = {};
  if (!raw || typeof raw !== "object") return gear;
  const record = raw as Record<string, unknown>;
  for (const slot of SLOTS) {
    if (!(slot in record)) continue;
    const value = record[slot];
    if (value == null) {
      gear[slot] = null;
      continue;
    }
    const id = Number(value);
    if (Number.isFinite(id)) gear[slot] = id;
  }
  return gear;
}
