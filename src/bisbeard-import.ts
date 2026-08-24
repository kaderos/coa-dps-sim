import { decompressFromEncodedURIComponent } from "lz-string";
import type { Slot } from "./types";

const BISBEARD_API = "https://gear-planner-api.bisbeard.workers.dev";

/** Bisbeard gear[] / enchants[] slot order (17 equipment slots). */
export const BISBEARD_GEAR_SLOTS: Slot[] = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
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
];

export type BisbeardBuildPayload = {
  gear?: string[];
  enchants?: string[];
  phase?: number;
  specName?: string;
  className?: string;
};

export type BisbeardBuildResponse = {
  v: number;
  data: string;
  createdAt?: string;
};

export type BisbeardMappedBuild = {
  gear: Partial<Record<Slot, number | null>>;
  enchants: Partial<Record<Slot, number | null>>;
  phase: string | null;
  specName: string | null;
  className: string | null;
};

export class BisbeardImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BisbeardImportError";
  }
}

/** Accepts coa.bisbeard.com/b/{id} share links or a bare build id. */
export function parseBisbeardBuildId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://coa.bisbeard.com/b/${raw}`);
    const match = url.pathname.match(/\/b\/([^/?#]+)/i);
    if (match?.[1]) return match[1];
  } catch {
    /* fall through */
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(raw)) return raw;
  return null;
}

function buildApiUrl(buildId: string): string {
  return `${BISBEARD_API}/api/builds/${encodeURIComponent(buildId)}`;
}

function proxyBase(): string | null {
  const configured = import.meta.env.VITE_BISBEARD_PROXY?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/bisbeard-api";
  return null;
}

async function fetchBuildJson(buildId: string): Promise<BisbeardBuildResponse> {
  const target = buildApiUrl(buildId);
  const proxy = proxyBase();
  const url = proxy ? `${proxy}/api/builds/${encodeURIComponent(buildId)}` : target;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new BisbeardImportError(
      proxy
        ? "Could not reach the Bisbeard import proxy. Check your connection and try again."
        : "Bisbeard import is not configured for this host (missing CORS proxy).",
    );
  }

  if (!response.ok) {
    if (response.status === 404) throw new BisbeardImportError("Build not found — check the share link.");
    throw new BisbeardImportError(`Bisbeard API returned ${response.status}.`);
  }

  let payload: BisbeardBuildResponse;
  try {
    payload = (await response.json()) as BisbeardBuildResponse;
  } catch {
    throw new BisbeardImportError("Bisbeard returned an invalid response.");
  }

  if (!payload?.data || typeof payload.data !== "string") {
    throw new BisbeardImportError("Build payload is missing compressed data.");
  }
  return payload;
}

export function decodeBisbeardBuild(data: string): BisbeardBuildPayload {
  const json = decompressFromEncodedURIComponent(data);
  if (!json) throw new BisbeardImportError("Could not decompress the Bisbeard build.");
  try {
    return JSON.parse(json) as BisbeardBuildPayload;
  } catch {
    throw new BisbeardImportError("Could not parse the Bisbeard build JSON.");
  }
}

export function mapBisbeardBuild(build: BisbeardBuildPayload): BisbeardMappedBuild {
  const gear: Partial<Record<Slot, number | null>> = {};
  const enchants: Partial<Record<Slot, number | null>> = {};
  const gearIds = build.gear ?? [];
  const enchantIds = build.enchants ?? [];

  for (let index = 0; index < BISBEARD_GEAR_SLOTS.length; index++) {
    const slot = BISBEARD_GEAR_SLOTS[index];
    const rawItem = gearIds[index];
    if (rawItem && rawItem !== "-") {
      const id = Number(rawItem);
      if (Number.isFinite(id)) gear[slot] = id;
    } else {
      gear[slot] = null;
    }

    const rawEnchant = enchantIds[index];
    if (rawEnchant && rawEnchant !== "-") {
      const id = Number(rawEnchant);
      if (Number.isFinite(id)) enchants[slot] = id;
    } else {
      enchants[slot] = null;
    }
  }

  return {
    gear,
    enchants,
    phase: Number.isFinite(build.phase) ? String(build.phase) : null,
    specName: build.specName ?? null,
    className: build.className ?? null,
  };
}

export async function loadBisbeardBuild(input: string): Promise<BisbeardMappedBuild> {
  const buildId = parseBisbeardBuildId(input);
  if (!buildId) {
    throw new BisbeardImportError("Paste a Bisbeard share URL (coa.bisbeard.com/b/…) or build id.");
  }
  const response = await fetchBuildJson(buildId);
  const build = decodeBisbeardBuild(response.data);
  return mapBisbeardBuild(build);
}
