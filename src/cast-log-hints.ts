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
  Felshock: "Felshock — +3% spell hit on the target for 12s; Felfury spenders extend Inner Demon. Enabled via Buffs → Felshock when the talent is taken.",
  Tailwind: "Shaman party buff — +5% haste for 15s windows (~80% uptime in sim).",
  Chaotic: "Chaotic talent — 8% on player spell damage: +3% damage per stack (max 3, 8s, refresh on proc).",
  Reckoning: "Reckoning window — free instant Fireballs for 10s. Fireballs during this add +4% damage stacks (max 4, 15s each).",
  Annihilation: "Annihilation — next direct hits are guaranteed crits (ability deals no damage).",
  "Potion of Spell Power": "+75 Spell Power while the potion is active.",
  "Felheart Raiment (6pc)": "Set bonus — +10% damage vs targets above 75% health.",
  "Fel Cannon": "+20% Fel Fireball and Ruin crit while the target is above 75% health.",
  "Sculptor of Doom": "Sculptor proc — next Ruin within 8s is instant (still costs 2 Felfury).",
  "Archimonde's Wrath": "Felfury spenders — +1% crit per 10 Energy at cast.",
  Felstrike: "Periodic Fire damage on the target; stacks from Fel Fireball during Inner Demon.",
};

const STACK_NOTES: Partial<Record<string, (aura: SimActiveAura) => string>> = {
  "Inner Demon": (aura) => {
    const remain = aura.remainSec ?? aura.stacks * 5;
    const extension = aura.felshockExtensionSec ?? 0;
    const extensionNote = extension > 0 ? ` (+${extension}s)` : "";
    return `Inner Demon remaining: ${remain.toFixed(1)}s${extensionNote}`;
  },
  Chaotic: (aura) => `${aura.stacks} stack${aura.stacks === 1 ? "" : "s"} → +${aura.stacks * 3}% damage.`,
  Reckoning: (aura) => `${aura.stacks} stack${aura.stacks === 1 ? "" : "s"} → +${aura.stacks * 4}% damage.`,
  Annihilation: (aura) => `${aura.stacks} guaranteed crit${aura.stacks === 1 ? "" : "s"} remaining.`,
  Felstrike: (aura) => `${aura.stacks} stack${aura.stacks === 1 ? "" : "s"} ticking.`,
  "Archimonde's Wrath": (aura) => `+${aura.stacks}% crit (${aura.stacks * 10}+ Energy at cast).`,
};

export function formatCastLogAuraLabel(aura: SimActiveAura): string {
  if (STACKED_AURAS.has(aura.name) && aura.stacks > 1) return `${aura.name} x${aura.stacks}`;
  return aura.name;
}

function castLogAuraHintBody(aura: SimActiveAura): string {
  const base = CAST_LOG_AURA_HINTS[aura.name] ?? "Active proc or buff affecting this hit.";
  const stackNote =
    aura.name === "Inner Demon" ||
    aura.stacks > 1 ||
    aura.name === "Archimonde's Wrath"
      ? STACK_NOTES[aura.name]?.(aura)
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
