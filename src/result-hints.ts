import { partyBuffHintBody } from "./buffs";
import { auraHintBody } from "./cast-log-hints";
import { trinketAuraHint } from "./sim/on-use-trinkets";
import type { SpellFit } from "./types";

const AURA_UPTIME_EXTRA_HINTS: Record<string, string> = {
  "Neptulon's Wrath":
    "Primalist party buff — 15s aura, 1 min cooldown. Each direct damage hit during the window also deals Froststorm damage (35% AP + 150% SP).",
  "Skull of Gul'dan":
    "Major cooldown. Consumes all Felfury; grants +400% energy regeneration and raises energy cap for 1s per Felfury spent (5–30s).",
  "Blood of Mannoroth":
    "Talent ability — restores 30% of your maximum health instantly and grants Blood of Mannoroth for 10s (+30% damage done).",
  "Ruin (DoT)":
    "Shadowflame DoT from Ruin while Inner Demon is active — 30% of the Ruin hit spread over 3s. Ticks do not crit or re-roll hit.",
  "Felstrike (DoT)":
    "Periodic fire damage on the target from Felstrike; stacks up to 3. Ticks do not crit.",
};

const SPELL_BREAKDOWN_EXTRA_HINTS: Record<string, string> = {
  "Neptulon's Wrath": AURA_UPTIME_EXTRA_HINTS["Neptulon's Wrath"],
  "Felstrike (DoT)": AURA_UPTIME_EXTRA_HINTS["Felstrike (DoT)"],
};

function findSpellByName(name: string, spells: Record<string, SpellFit>): SpellFit | undefined {
  if (name === "Ruin (DoT)") {
    return Object.values(spells).find((spell) => spell.name === "Ruin" && spell.id === 501298);
  }
  if (name === "Felstrike (DoT)") {
    return Object.values(spells).find((spell) => spell.name === "Felstrike");
  }
  if (name === "Sargeron Smite (Inner Demon)") {
    return Object.values(spells).find((spell) => spell.name === "Sargeron Smite (Inner Demon)");
  }
  return Object.values(spells).find((spell) => spell.name === name);
}

function spellFitNote(spell: SpellFit): string | undefined {
  const note = (spell.fit as { note?: string }).note;
  return note?.trim() || undefined;
}

/** Hover body for aura names on the results uptime list. */
export function auraUptimeHint(name: string, context?: { parent?: string; stackIndex?: number }): string | undefined {
  const direct = auraHintBody(name) ?? AURA_UPTIME_EXTRA_HINTS[name] ?? trinketAuraHint(name, 1);
  if (direct) return direct;

  if (context?.parent && context.stackIndex != null) {
    const stacks = context.stackIndex + 1;
    if (context.parent === "Chaotic") {
      return `Chaotic at ${stacks} stack${stacks === 1 ? "" : "s"} — +${stacks * 3}% damage.`;
    }
    if (context.parent === "Reckoning") {
      return `Reckoning damage buff at ${stacks} stack${stacks === 1 ? "" : "s"} — +${stacks * 4}% damage.`;
    }
  }

  if (name === "Neptulon's Wrath") return partyBuffHintBody("neptulonsWrath");
  if (name === "Tailwind") return partyBuffHintBody("tailwind");
  if (name === "Tempest's Call") return partyBuffHintBody("tempestsCall");
  if (name === "Vulnerable") return partyBuffHintBody("vulnerable");
  if (name === "Sun's Hope/Potency") return partyBuffHintBody("sunsHopePotency");

  return undefined;
}

/** Plain description hover for spell breakdown rows without a formula tooltip. */
export function spellBreakdownDescription(
  name: string,
  spells?: Record<string, SpellFit>,
): { title: string; body: string } | null {
  const extra = SPELL_BREAKDOWN_EXTRA_HINTS[name];
  if (extra) return { title: name, body: extra };

  if (spells) {
    const spell = findSpellByName(name, spells);
    const note = spell ? spellFitNote(spell) : undefined;
    if (note) return { title: name, body: note };
  }

  if (name === "Neptulon's Wrath") {
    const body = partyBuffHintBody("neptulonsWrath");
    if (body) return { title: name, body };
  }

  return null;
}
