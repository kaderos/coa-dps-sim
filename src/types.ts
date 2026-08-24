import type { TalentSelection } from "./talents/types";

export const SLOTS = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "shirt",
  "tabard",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "mainhand",
  "offhand",
  "ranged",
] as const;

export const PAPER_DOLL_LEFT = ["head", "neck", "shoulder", "back", "chest", "shirt", "tabard", "wrist"] as const;
export const PAPER_DOLL_RIGHT = ["hands", "waist", "legs", "feet", "finger1", "finger2", "trinket1", "trinket2"] as const;
export const PAPER_DOLL_WEAPONS = ["mainhand", "offhand", "ranged"] as const;

export type Slot = (typeof SLOTS)[number];

export type ItemStats = {
  strength: number;
  agility: number;
  intellect: number;
  spirit: number;
  stamina: number;
  spellPower: number;
  firePower: number;
  shadowPower: number;
  attackPower: number;
  spellCrit: number;
  spellHit: number;
  spellHaste: number;
  spellPenetration: number;
  mp5: number;
};

export type ItemDamage = {
  min: number;
  max: number;
  speed: number;
};

export type Item = {
  id: number;
  name: string;
  slot: string;
  armorType?: string | null;
  quality?: string | null;
  itemLevel?: number | null;
  phase?: number | null;
  displayPhase?: number | null;
  extraPhases?: number[];
  reqLevel?: number | null;
  bind?: string | null;
  unique?: string | null;
  subtitle?: string | null;
  equipSlot?: string | null;
  damage?: ItemDamage | null;
  armor?: number | null;
  baseStats?: string[];
  effects?: string[];
  setName?: string | null;
  setBonus3?: string | null;
  setBonuses?: Record<string, string> | null;
  stats: ItemStats;
  source?: string | null;
  casterScore?: number;
};

export type Enchant = {
  id: number;
  name: string;
  slots: string[];
  weapon?: "onehand" | "twohand" | null;
  stats: ItemStats;
  description?: string | null;
  quality?: string | null;
};

export type GearSet = Partial<Record<Slot, Item | null>>;
export type EnchantSet = Partial<Record<Slot, Enchant | null>>;

export type CharacterStats = ItemStats & {
  energy: number;
  energyMax: number;
  felfury: number;
  felfuryMax: number;
  hiddenPower: number;
};

export type SpellFit = {
  id: number;
  name: string;
  role: string;
  energy?: number;
  felfuryGain?: number;
  felfuryCost?: number;
  energyGain?: number;
  gcd: number;
  castTime: number;
  duration?: number;
  maxStacks?: number;
  canCrit?: boolean;
  school?: "fire" | "shadow" | "shadowflame" | "holy" | "nature" | "frost" | "arcane" | "physical";
  debuff?: {
    damageTakenFromCasterPct: number;
    fireCritFromCasterPct: number;
  };
  buff?: {
    damageDonePct: number;
  };
  observed: {
    count: number;
    total: number;
    avgHit: number;
    avgCrit: number;
    critRate: number;
    critMultiplier: number;
    share: number;
  } | null;
  fit: {
    base: number;
    coeff: number;
    spellPowerUsed: number;
  };
  /** Official school-damage formula from db.ascension.gg, when known. */
  formula?: {
    source: string;
    min: number;
    max: number;
    perLevel: number;
    /** Fallback when fireCoeff/shadowCoeff omitted. */
    coeff: number;
    /** COND(GT(FireP, ShaP), … + FireP * fireCoeff, … + ShaP * shadowCoeff). */
    fireCoeff?: number;
    shadowCoeff?: number;
    /** When false, skip perLevel×playerLevel (rank tooltip min/max already include level scaling). */
    perLevelScalesWithPlayer?: boolean;
    apCoeff?: number;
    energy?: number;
    castTime?: number;
    gcd?: number;
    interval?: number;
  };
};

export type PotionMode = "none" | "in-fight" | "prepot-and-second";

export type SimConfig = {
  durationSec: number;
  iterations: number;
  seed: number;
  fightStyle: "stationary";
  playerLevel: number;
  bossLevel: number;
  allowCleave: false;
  movement: false;
  potionSpellPower: number;
  potionDuration: number;
  potionMode: PotionMode;
  setDamageAbove75?: number;
  talentSelection?: TalentSelection;
  /** Flat DPS from party/raid procs (Bloodthistle, etc.) — added each iteration. */
  procContributions?: Array<{ name: string; dps: number }>;
  /** Shaman party aura: AP×0.35 Froststorm on each direct damage hit while active. */
  neptulonsWrath?: boolean;
  /** Linear 100%→0% boss health — Fel Cannon / Doomsayer taper after ~75% fight time. */
  targetHealthDecays?: boolean;
  /** Demonfire Pact buff — Fel Infusion personal crit is 3% while active, 6% when off. */
  demonfirePact?: boolean;
};

export type SetCatalog = {
  generatedAt?: string;
  count?: number;
  sets: Record<string, Record<string, string>>;
};

export type EquippedSetBonus = {
  pieces: number;
  text: string;
  active: boolean;
};

export type EquippedSet = {
  name: string;
  equipped: number;
  threshold: number;
  bonuses: EquippedSetBonus[];
};

export type BuffsConfig = {
  demonfirePact: boolean;
  greaterManariIntuition: boolean;
  greaterBloodthorns: boolean;
  greaterSanguinaryOffering: boolean;
  greaterSealOfAlysrazor: boolean;
  berserkerAura: boolean;
  legionfelPact: boolean;
  greaterChromiesWisdom: boolean;
  greaterIllidariIntuition: boolean;
  greaterGrimMandate: boolean;
  greaterWhispersOfNzoth: boolean;
  greaterPrimalInstinct: boolean;
  bloodthistle: boolean;
  neptulonsWrath: boolean;
  frogBones: boolean;
  racialSpellHit: boolean;
  spellHitDebuff: boolean;
  flask: "none" | "manifesting-power" | "kirin-tor";
  food: "none" | "well-fed" | "fused-wizard-wontons";
  scroll: "none" | "spirit-iv";
  weaponOil: "none" | "brilliant-wizard-oil";
  offhandWeaponOil: "none" | "brilliant-wizard-oil";
  potion: "none" | "in-fight" | "prepot-and-second";
  /** Boss fight: health falls linearly so Fel Cannon / Doomsayer taper. Off = training dummy at 100%. */
  targetHealthDecays: boolean;
};

export type SpellBreakdown = {
  name: string;
  casts: number;
  damage: number;
  dps: number;
  share: number;
  hits: number;
  crits: number;
  misses: number;
  hitRate: number | null;
  critRate: number | null;
  missRate: number | null;
};

export type SimActiveAura = {
  name: string;
  stacks: number;
};

export type SimCastEvent = {
  timestamp: number;
  spell: string;
  /** Casted ability vs periodic DoT tick (no GCD, no cast count). */
  kind?: "cast" | "tick";
  result: "hit" | "crit" | "miss" | "applied" | "tick";
  damage: number;
  energy: number;
  felfury: number;
  /** Temporary buffs/procs active when this damage was calculated. */
  activeAuras?: SimActiveAura[];
};

export type SimResult = {
  meanDps: number;
  minDps: number;
  maxDps: number;
  stdev: number;
  iterations: number;
  durationSec: number;
  playerLevel: number;
  bossLevel: number;
  fightStyle: "stationary";
  breakdown: SpellBreakdown[];
  dpsSamples: number[];
  p50Dps: number;
  p95Dps: number;
  auraUptimes: Array<{ name: string; uptime: number }>;
  castEvents: SimCastEvent[];
  /** Salted fight length for iteration 0 (the cast log seed). */
  castLogFightSec: number;
  castLogTruncated: boolean;
  logDps: number | null;
  logDeltaPct: number | null;
  logBaseline: LogBaseline | null;
};

export type LogAbility = {
  name: string;
  share: number;
  damage: number;
  casts: number;
  hits: number;
  avgHit: number;
  critPct: number;
  missPct: number;
  dps: number;
  modeled: boolean;
};

export type LogCastEvent = {
  t: number;
  id: number;
  spell: string;
  target?: string | null;
};

export type LogCastLog = {
  player: string;
  encounter: string;
  url: string;
  durationSec: number;
  counts: Record<string, number>;
  events: LogCastEvent[];
};

export type LogBaseline = {
  player: string;
  encounter: string;
  report?: string;
  date?: string;
  durationSec: number;
  durationLabel: string;
  totalDamage: number;
  dps: number;
  modeledDps?: number;
  url: string;
  eventsUrl?: string;
  note?: string;
  abilities?: LogAbility[];
  casts?: LogCastLog;
};
