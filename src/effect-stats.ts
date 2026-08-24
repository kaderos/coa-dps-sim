import type { Enchant, Item, ItemStats } from "./types";

/** Parse spell penetration from equip/use/enchant tooltip lines (not armor penetration). */
export function parseSpellPenetrationFromText(text: string): number {
  if (!text || /armor penetration/i.test(text)) return 0;
  const equip = /(?:spell penetration|spelldamage penetration).*?by (\d+)/i.exec(text);
  if (equip) return Number(equip[1]) || 0;
  const plus = /\+(\d+)\s+spell penetration\b/i.exec(text);
  return plus ? Number(plus[1]) || 0 : 0;
}

function spellPenFromLines(lines: string[] | undefined): number {
  let total = 0;
  for (const line of lines || []) total += parseSpellPenetrationFromText(line);
  return total;
}

/** Fill spellPenetration from green equip lines when the bundled JSON omitted it. */
export function hydrateSpellPenetration(stats: ItemStats, sources: { effects?: string[]; description?: string | null }) {
  if (stats.spellPenetration) return;
  const fromEffects = spellPenFromLines(sources.effects);
  const fromDescription = sources.description ? parseSpellPenetrationFromText(sources.description) : 0;
  const total = fromEffects + fromDescription;
  if (total) stats.spellPenetration = total;
}

export function hydrateItemEffectStats(item: Item) {
  hydrateSpellPenetration(item.stats, item);
}

export function hydrateEnchantEffectStats(enchant: Enchant) {
  hydrateSpellPenetration(enchant.stats, enchant);
}
