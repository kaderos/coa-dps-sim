import type { EquippedSet, GearSet, Item, ItemStats, SetCatalog, Slot } from "./types";

/** Same conversions as `src/sim/stats.ts`. */
const SPELL_CRIT_RATING_PER_PERCENT = 14;
const SPELL_HASTE_RATING_PER_PERCENT = 10;

function emptyStats(): ItemStats {
  return {
    strength: 0,
    agility: 0,
    intellect: 0,
    spirit: 0,
    stamina: 0,
    spellPower: 0,
    firePower: 0,
    shadowPower: 0,
    attackPower: 0,
    spellCrit: 0,
    spellHit: 0,
    spellHaste: 0,
    spellPenetration: 0,
    mp5: 0,
  };
}

function addStats(a: ItemStats, b: ItemStats): ItemStats {
  return {
    strength: (a.strength || 0) + (b.strength || 0),
    agility: (a.agility || 0) + (b.agility || 0),
    intellect: a.intellect + b.intellect,
    spirit: a.spirit + b.spirit,
    stamina: a.stamina + b.stamina,
    spellPower: a.spellPower + b.spellPower,
    firePower: a.firePower + b.firePower,
    shadowPower: a.shadowPower + b.shadowPower,
    attackPower: (a.attackPower || 0) + (b.attackPower || 0),
    spellCrit: a.spellCrit + b.spellCrit,
    spellHit: a.spellHit + b.spellHit,
    spellHaste: a.spellHaste + b.spellHaste,
    spellPenetration: (a.spellPenetration || 0) + (b.spellPenetration || 0),
    mp5: a.mp5 + b.mp5,
  };
}

function isTwoHand(item: Item | null | undefined): boolean {
  if (!item) return false;
  const equip = String(item.equipSlot || "").toLowerCase();
  const type = String(item.armorType || "").toLowerCase();
  return (
    equip.includes("two-hand") ||
    equip.includes("two hand") ||
    type.includes("two-handed") ||
    type === "staves" ||
    type === "staff"
  );
}

type ScalingStat = "intellect" | "spirit" | "stamina" | "strength" | "agility";
type ScalingDest = ScalingStat | "spellPower" | "spellCrit" | "spellHit" | "spellHaste";

type ScalingBonus = {
  source: ScalingStat;
  dest: ScalingDest;
  percent: number;
};

type ParsedSetBonus = {
  stats: ItemStats;
  scaling: ScalingBonus[];
  damageAbove75: number;
  parsed: boolean;
};

const PRIMARY: Record<string, ScalingStat> = {
  intellect: "intellect",
  spirit: "spirit",
  stamina: "stamina",
  strength: "strength",
  agility: "agility",
};

const RATING_DEST: Record<string, "spellCrit" | "spellHit" | "spellHaste" | "spellPower"> = {
  "critical strike rating": "spellCrit",
  "crit rating": "spellCrit",
  "spell crit rating": "spellCrit",
  "spell critical strike rating": "spellCrit",
  "hit rating": "spellHit",
  "spell hit rating": "spellHit",
  "haste rating": "spellHaste",
  "spell haste rating": "spellHaste",
  damage: "spellPower",
  "spell damage": "spellPower",
  power: "spellPower",
  "spell power": "spellPower",
};

const PROC_TEXT =
  /\b(chance to|have a chance|whenever|stacks? up to|lasting|lasts? \d|for \d+ sec|on (?:a )?(?:successful )?(?:melee |ranged )?(?:critical )?hit|casting |dealing |after |when you|unleash mythical|once every|cannot occur|this effect|mythical)\b/i;

let catalog: Record<string, Record<string, string>> = {};

export function loadSetCatalog(data: SetCatalog | null | undefined) {
  catalog = data?.sets && typeof data.sets === "object" ? { ...data.sets } : {};
}

export function absorbItemSetBonuses(items: Iterable<Item>) {
  for (const item of items) {
    if (!item.setName || catalog[item.setName]) continue;
    const bonuses = item.setBonuses && Object.keys(item.setBonuses).length
      ? item.setBonuses
      : item.setBonus3
        ? { "3": cleanBonusText(item.setBonus3) }
        : null;
    if (bonuses) catalog[item.setName] = { ...bonuses };
  }
}

export function bonusesForSet(name: string, item?: Item | null): Record<string, string> {
  if (catalog[name]) return catalog[name];
  if (item?.setBonuses && Object.keys(item.setBonuses).length) return item.setBonuses;
  if (item?.setBonus3) return { "3": cleanBonusText(item.setBonus3) };
  return {};
}

export function equippedSets(gear: GearSet): EquippedSet[] {
  const counts = new Map<string, { equipped: number; sample: Item | null }>();
  for (const [slot, item] of Object.entries(gear) as Array<[Slot, Item | null | undefined]>) {
    if (!item?.setName) continue;
    if (slot === "offhand" && isTwoHand(gear.mainhand)) continue;
    const cur = counts.get(item.setName) || { equipped: 0, sample: item };
    cur.equipped += 1;
    if (!cur.sample) cur.sample = item;
    counts.set(item.setName, cur);
  }
  return [...counts.entries()]
    .map(([name, { equipped, sample }]) => setProgress(name, equipped, sample))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setProgressForItem(item: Item, gear: GearSet): EquippedSet | null {
  if (!item.setName) return null;
  const found = equippedSets(gear).find((set) => set.name === item.setName);
  return found ?? setProgress(item.setName, 0, item);
}

/** Flat set crit rating and intellect→crit scaling for stat panel breakdowns. */
export function setSpellCritParts(gear: GearSet, stats: ItemStats): { flatRating: number; fromIntellectRating: number } {
  let flatRating = 0;
  let fromIntellectRating = 0;
  for (const set of equippedSets(gear)) {
    for (const bonus of set.bonuses) {
      if (!bonus.active) continue;
      const parsed = parseSetBonus(bonus.text);
      flatRating += parsed.stats.spellCrit;
      for (const row of parsed.scaling) {
        if (row.dest !== "spellCrit" || row.source !== "intellect") continue;
        fromIntellectRating += stats.intellect * row.percent;
      }
    }
  }
  return { flatRating, fromIntellectRating };
}

export function setBonusRatings(gear: GearSet, base: ItemStats): ItemStats {
  let flats = emptyStats();
  const scaling: ScalingBonus[] = [];
  for (const set of equippedSets(gear)) {
    for (const bonus of set.bonuses) {
      if (!bonus.active) continue;
      const parsed = parseSetBonus(bonus.text);
      flats = addStats(flats, parsed.stats);
      scaling.push(...parsed.scaling);
    }
  }
  if (!scaling.length) return flats;

  const afterFlat = addStats(base, flats);
  let intellect = afterFlat.intellect;
  let spirit = afterFlat.spirit;
  let stamina = afterFlat.stamina;
  let strength = afterFlat.strength;
  let agility = afterFlat.agility;
  const extra = emptyStats();

  for (const bonus of scaling.filter((row) => row.dest === row.source)) {
    const amount = sourceAmount(afterFlat, bonus.source) * bonus.percent;
    if (bonus.dest === "intellect") intellect += amount;
    else if (bonus.dest === "spirit") spirit += amount;
    else if (bonus.dest === "stamina") stamina += amount;
    else if (bonus.dest === "strength") strength += amount;
    else if (bonus.dest === "agility") agility += amount;
  }
  extra.intellect += intellect - afterFlat.intellect;
  extra.spirit += spirit - afterFlat.spirit;
  extra.stamina += stamina - afterFlat.stamina;
  extra.strength += strength - afterFlat.strength;
  extra.agility += agility - afterFlat.agility;

  const sources: Record<ScalingStat, number> = { intellect, spirit, stamina, strength, agility };
  for (const bonus of scaling.filter((row) => row.dest !== row.source)) {
    extra[bonus.dest] += sources[bonus.source] * bonus.percent;
  }
  return addStats(flats, extra);
}

const FELHEART_RAIMENT = "Felheart Raiment";
const FELHEART_EXECUTE_BONUS_PIECES = 6;

export function setBonusCombat(gear: GearSet): { damageAbove75: number } {
  let damageAbove75 = 0;
  for (const set of equippedSets(gear)) {
    if (set.name !== FELHEART_RAIMENT || set.equipped < FELHEART_EXECUTE_BONUS_PIECES) continue;
    for (const bonus of set.bonuses) {
      if (!bonus.active || bonus.pieces !== FELHEART_EXECUTE_BONUS_PIECES) continue;
      damageAbove75 += parseSetBonus(bonus.text).damageAbove75;
    }
  }
  return { damageAbove75 };
}

export function parseSetBonus(text: string): ParsedSetBonus {
  const result: ParsedSetBonus = {
    stats: emptyStats(),
    scaling: [],
    damageAbove75: 0,
    parsed: false,
  };
  const raw = cleanBonusText(text);
  const execute = raw.match(/damage against targets above 75% health is increased by (\d+(?:\.\d+)?)%/i);
  if (execute) {
    result.damageAbove75 = Number(execute[1]) / 100;
    result.parsed = true;
    return result;
  }
  if (PROC_TEXT.test(raw)) return result;

  const add = (key: keyof ItemStats, amount: number) => {
    if (!amount) return;
    result.stats[key] += amount;
    result.parsed = true;
  };
  const scale = (source: ScalingStat, dest: ScalingDest, percent: number) => {
    if (!percent) return;
    result.scaling.push({ source, dest, percent: percent / 100 });
    result.parsed = true;
  };

  for (const match of raw.matchAll(
    /you gain (\d+(?:\.\d+)?)% of your (intellect|spirit|stamina|strength|agility) as (spell )?(damage|power|critical strike rating|crit rating|hit rating|haste rating|spell crit rating|spell critical strike rating|spell hit rating|spell haste rating)/gi,
  )) {
    const dest =
      RATING_DEST[[match[3], match[4]].filter(Boolean).join(" ").toLowerCase()] ||
      RATING_DEST[match[4].toLowerCase()];
    if (dest) scale(PRIMARY[match[2].toLowerCase()], dest, Number(match[1]));
  }

  for (const match of raw.matchAll(
    /increases(?: your)? (?:spell )?(power|damage|critical strike rating|hit rating|haste rating) by (\d+(?:\.\d+)?)% of your (intellect|spirit|stamina|strength|agility)/gi,
  )) {
    const dest = RATING_DEST[match[1].toLowerCase()] || RATING_DEST[`spell ${match[1].toLowerCase()}`];
    if (dest) scale(PRIMARY[match[3].toLowerCase()], dest, Number(match[2]));
  }

  for (const match of raw.matchAll(
    /your spell damage is increased by (\d+(?:\.\d+)?)% of your (intellect|spirit|stamina|strength|agility)/gi,
  )) {
    scale(PRIMARY[match[2].toLowerCase()], "spellPower", Number(match[1]));
  }

  for (const match of raw.matchAll(
    /increases(?: your)? (intellect|spirit|stamina) by (\d+(?:\.\d+)?)%(?!\s+of)/gi,
  )) {
    scale(PRIMARY[match[1].toLowerCase()], PRIMARY[match[1].toLowerCase()], Number(match[2]));
  }

  for (const match of raw.matchAll(
    /increases(?: your)? (?:spell )?crit(?:ical)?(?: strike)? chance by (\d+(?:\.\d+)?)%/gi,
  )) {
    add("spellCrit", Number(match[1]) * SPELL_CRIT_RATING_PER_PERCENT);
  }

  for (const match of raw.matchAll(/increases(?: your)? haste by (\d+(?:\.\d+)?)%(?!\s+of)/gi)) {
    add("spellHaste", Number(match[1]) * SPELL_HASTE_RATING_PER_PERCENT);
  }

  for (const match of raw.matchAll(
    /increases(?: your)? (?:spell )?critical strike rating by (\d+(?:\.\d+)?)(?!\s*%|\s+of)/gi,
  )) {
    add("spellCrit", Number(match[1]));
  }
  for (const match of raw.matchAll(/increase critical strike rating by (\d+(?:\.\d+)?)(?!\s*%|\s+of)/gi)) {
    add("spellCrit", Number(match[1]));
  }
  for (const match of raw.matchAll(/critical strike rating increased by (\d+(?:\.\d+)?)(?!\s*%|\s+of)/gi)) {
    add("spellCrit", Number(match[1]));
  }
  for (const match of raw.matchAll(/increases(?: your)? hit rating by (\d+(?:\.\d+)?)(?!\s*%|\s+of)/gi)) {
    add("spellHit", Number(match[1]));
  }
  for (const match of raw.matchAll(/increases(?: your)? haste rating by (\d+(?:\.\d+)?)(?!\s*%|\s+of)/gi)) {
    add("spellHaste", Number(match[1]));
  }
  for (const match of raw.matchAll(/increases(?: your)? spell power by (\d+(?:\.\d+)?)(?!\s*%|\s+of)/gi)) {
    add("spellPower", Number(match[1]));
  }
  for (const match of raw.matchAll(/increases (fire|shadow) spell power by (\d+(?:\.\d+)?)/gi)) {
    add(match[1].toLowerCase() === "fire" ? "firePower" : "shadowPower", Number(match[2]));
  }
  for (const match of raw.matchAll(
    /increases(?: your)? (intellect|spirit|stamina|strength|agility) by (\d+(?:\.\d+)?)(?!\s*%)/gi,
  )) {
    add(PRIMARY[match[1].toLowerCase()], Number(match[2]));
  }
  for (const match of raw.matchAll(/increases(?: your)? spell penetration by (\d+(?:\.\d+)?)/gi)) {
    add("spellPenetration", Number(match[1]));
  }
  for (const match of raw.matchAll(/\+(\d+(?:\.\d+)?)\s+spell penetration/gi)) {
    add("spellPenetration", Number(match[1]));
  }
  for (const match of raw.matchAll(/restores (\d+(?:\.\d+)?) mana per 5 sec/gi)) {
    add("mp5", Number(match[1]));
  }
  for (const match of raw.matchAll(/\+(\d+(?:\.\d+)?)\s+(intellect|spirit|stamina|strength|agility|spell power)/gi)) {
    const key = match[2].toLowerCase() === "spell power" ? "spellPower" : PRIMARY[match[2].toLowerCase()];
    add(key, Number(match[1]));
  }

  return result;
}

function setProgress(name: string, equipped: number, sample: Item | null): EquippedSet {
  const bonuses = bonusesForSet(name, sample);
  const keys = Object.keys(bonuses)
    .map(Number)
    .filter((pieces) => Number.isFinite(pieces) && pieces > 0)
    .sort((a, b) => a - b);
  return {
    name,
    equipped,
    threshold: keys.length ? keys[keys.length - 1] : equipped,
    bonuses: keys.map((pieces) => ({
      pieces,
      text: cleanBonusText(bonuses[String(pieces)]),
      active: equipped >= pieces,
    })),
  };
}

function sourceAmount(stats: ItemStats, source: ScalingStat): number {
  return stats[source] || 0;
}

function cleanBonusText(text: string): string {
  return String(text || "").replace(/^\(\d+\) Set:\s*/i, "").trim();
}
