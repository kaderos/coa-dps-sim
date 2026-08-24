import type { SimActiveAura } from "./types";

const STACKED_AURAS = new Set([
  "Chaotic",
  "Reckoning",
  "Annihilation",
  "Inner Demon",
  "Felstrike",
  "Archimonde's Wrath",
]);

/** Short hover text for procs/buffs listed in expanded cast-log rows. */
const CAST_LOG_AURA_HINTS: Record<string, string> = {
  "Inner Demon":
    "Spend Felfury to activate. +10% damage, Ruin leaves its DoT, and Felfury spenders extend the window.",
  "Bane of Fire": "Target takes 20% more damage from you; Fire spells gain +20% crit.",
  "Fragment of Malice": "Malice of Gul'dan proc — +10% crit for 5s.",
  Felshock: "Felshock talent — +3% spell hit on the target for 12s; Felfury spenders extend Inner Demon.",
  Chaotic: "Chaotic talent — +3% damage per stack (max 3).",
  Reckoning: "Reckoning Fireball buff — +4% damage per stack during Reckoning (max 4).",
  Annihilation: "Annihilation — next direct hits are guaranteed crits (ability deals no damage).",
  "Potion of Spell Power": "+75 Spell Power while the potion is active.",
  "Felheart Raiment (6pc)": "Set bonus — +10% damage vs targets above 75% health.",
  "Fel Cannon": "+20% Fel Fireball and Ruin crit while the target is above 75% health.",
  "Sculptor of Doom": "Sculptor proc — next Ruin within 8s is instant (still costs 2 Felfury).",
  "Archimonde's Wrath": "Felfury spenders — +1% crit per 10 Energy at cast.",
  Felstrike: "Periodic Fire damage on the target; stacks from Fel Fireball during Inner Demon.",
};

const STACK_NOTES: Partial<Record<string, (stacks: number) => string>> = {
  "Inner Demon": (stacks) => `${stacks} Felfury consumed → ${stacks * 5}s duration.`,
  Chaotic: (stacks) => `${stacks} stack${stacks === 1 ? "" : "s"} → +${stacks * 3}% damage.`,
  Reckoning: (stacks) => `${stacks} stack${stacks === 1 ? "" : "s"} → +${stacks * 4}% damage.`,
  Annihilation: (stacks) => `${stacks} guaranteed crit${stacks === 1 ? "" : "s"} remaining.`,
  Felstrike: (stacks) => `${stacks} stack${stacks === 1 ? "" : "s"} ticking.`,
  "Archimonde's Wrath": (stacks) => `+${stacks}% crit (${stacks * 10}+ Energy at cast).`,
};

export function formatCastLogAuraLabel(aura: SimActiveAura): string {
  if (STACKED_AURAS.has(aura.name) && aura.stacks > 1) return `${aura.name} x${aura.stacks}`;
  return aura.name;
}

function castLogAuraHintBody(aura: SimActiveAura): string {
  const base = CAST_LOG_AURA_HINTS[aura.name] ?? "Active proc or buff affecting this hit.";
  const stackNote =
    aura.stacks > 1 || aura.name === "Archimonde's Wrath"
      ? STACK_NOTES[aura.name]?.(aura.stacks)
      : undefined;
  return stackNote ? `${base} ${stackNote}` : base;
}

export function renderCastLogAuraItem(aura: SimActiveAura): string {
  const label = formatCastLogAuraLabel(aura);
  const title = aura.name;
  const body = castLogAuraHintBody(aura);
  return `<li><span class="hint-anchor" data-hint-title="${escapeAttr(title)}" data-hint-body="${escapeAttr(body)}">${escapeHtml(label)}</span></li>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "&#10;");
}
