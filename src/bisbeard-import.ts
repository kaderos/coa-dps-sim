import LZString from "lz-string";
import type { Slot } from "./types";

const { decompressFromEncodedURIComponent } = LZString;

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

export type BisbeardImportApiResponse = {
  buildId?: string;
  createdAt?: string | null;
  build?: BisbeardBuildPayload;
  error?: string;
  upstreamStatus?: number;
};

export type BisbeardMappedBuild = {
  gear: Partial<Record<Slot, number | null>>;
  enchants: Partial<Record<Slot, number | null>>;
  phase: string | null;
  specName: string | null;
  className: string | null;
};

export class BisbeardImportError extends Error {
  readonly status: number | null;
  readonly url: string | null;

  constructor(message: string, options: { status?: number | null; url?: string | null } = {}) {
    super(message);
    this.name = "BisbeardImportError";
    this.status = options.status ?? null;
    this.url = options.url ?? null;
  }
}

/** Accepts coa.bisbeard.com/b/{id} share links or a bare build id. */
export function parseBisbeardBuildId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const looksLikeId = (value: string) => /^[A-Za-z0-9_-]{6,}$/.test(value);
  try {
    const url = new URL(raw.includes("://") ? raw : `https://coa.bisbeard.com/b/${raw}`);
    const match = url.pathname.match(/\/b\/([^/?#]+)/i);
    if (match?.[1]) {
      const id = decodeURIComponent(match[1]);
      if (looksLikeId(id)) return id;
    }
  } catch {
    /* fall through */
  }
  if (looksLikeId(raw)) return raw;
  return null;
}

/**
 * Resolve the Bisbeard import API endpoint.
 * - Production: absolute Cloudflare Worker URL from `VITE_BISBEARD_PROXY`
 *   (Worker origin or full `…/api/bisbeard/import` path).
 * - Development: same-origin Vite middleware at `/api/bisbeard/import`.
 */
export function bisbeardImportEndpoint(env: ImportMetaEnv = import.meta.env): string {
  const configured = (env.VITE_BISBEARD_PROXY ?? "").trim().replace(/\/$/, "");
  if (configured) {
    if (configured.endsWith("/api/bisbeard/import")) return configured;
    return `${configured}/api/bisbeard/import`;
  }
  if (env.DEV) return "/api/bisbeard/import";
  throw new BisbeardImportError(
    "Bisbeard import is not configured for this build. Set repository variable BISBEARD_PROXY_URL to the Cloudflare Worker origin and redeploy Pages.",
  );
}

export function bisbeardImportRequestUrl(shareInput: string, env: ImportMetaEnv = import.meta.env): string {
  const endpoint = bisbeardImportEndpoint(env);
  const url = new URL(endpoint, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  url.searchParams.set("share", shareInput.trim());
  return url.toString();
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

function diagnoseHttpFailure(status: number, contentType: string, url: string): BisbeardImportError {
  if (status === 404 && contentType.includes("text/html")) {
    return new BisbeardImportError(
      "Import request hit static hosting (GitHub Pages) instead of the Cloudflare Worker. Confirm BISBEARD_PROXY_URL is set and Pages was rebuilt.",
      { status, url },
    );
  }
  if (status === 403) {
    return new BisbeardImportError(
      "Bisbeard import proxy rejected this origin (CORS / ALLOWED_ORIGINS). Allowed origin must be exactly https://kaderos.github.io (no repo path).",
      { status, url },
    );
  }
  if (status === 404) {
    return new BisbeardImportError("Build was not found on Bisbeard. Check the share link.", { status, url });
  }
  if (status === 400) {
    return new BisbeardImportError("Invalid Bisbeard share link or build id.", { status, url });
  }
  if (status >= 500) {
    return new BisbeardImportError(`Bisbeard import proxy failed (${status}). Try again in a moment.`, {
      status,
      url,
    });
  }
  return new BisbeardImportError(`Bisbeard import returned HTTP ${status}.`, { status, url });
}

async function fetchImportPayload(shareInput: string): Promise<BisbeardBuildPayload> {
  const buildId = parseBisbeardBuildId(shareInput);
  if (!buildId) {
    throw new BisbeardImportError("Paste a Bisbeard share URL (coa.bisbeard.com/b/…) or build id.");
  }

  const importUrl = bisbeardImportRequestUrl(shareInput);
  const importResult = await fetchJson(importUrl);
  if (importResult.ok) {
    return parseSuccessfulImportBody(importResult, importUrl);
  }

  // Currently deployed Workers may only expose /api/builds/{id}. Fall back until
  // `npm run deploy:bisbeard-proxy` publishes /api/bisbeard/import.
  if (importResult.status === 404) {
    const buildsUrl = bisbeardBuildsUrl(buildId);
    const buildsResult = await fetchJson(buildsUrl);
    if (buildsResult.ok) {
      return parseSuccessfulImportBody(buildsResult, buildsUrl);
    }
    throw diagnoseFetchFailure(buildsResult, buildsUrl);
  }

  throw diagnoseFetchFailure(importResult, importUrl);
}

function bisbeardBuildsUrl(buildId: string, env: ImportMetaEnv = import.meta.env): string {
  const configured = (env.VITE_BISBEARD_PROXY ?? "").trim().replace(/\/$/, "");
  if (configured) {
    const origin = configured.endsWith("/api/bisbeard/import")
      ? configured.slice(0, -"/api/bisbeard/import".length)
      : configured;
    return `${origin}/api/builds/${encodeURIComponent(buildId)}`;
  }
  if (env.DEV) return `/api/builds/${encodeURIComponent(buildId)}`;
  throw new BisbeardImportError(
    "Bisbeard import is not configured for this build. Set repository variable BISBEARD_PROXY_URL to the Cloudflare Worker origin and redeploy Pages.",
  );
}

type FetchJsonResult = {
  ok: boolean;
  status: number;
  contentType: string;
  payload: BisbeardImportApiResponse | { data?: string } | null;
  rawText: string;
};

async function fetchJson(url: string): Promise<FetchJsonResult> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    console.error("[bisbeard-import] network failure", { url, cause });
    throw new BisbeardImportError(
      "Could not reach the Bisbeard import proxy. Hard-refresh the page (Ctrl+F5) and try again.",
      { url },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const rawText = await response.text();
  console.info("[bisbeard-import] response", { url, status: response.status, contentType });

  let payload: FetchJsonResult["payload"] = null;
  if (contentType.includes("application/json") || rawText.trim().startsWith("{")) {
    try {
      payload = JSON.parse(rawText) as FetchJsonResult["payload"];
    } catch {
      payload = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType,
    payload,
    rawText,
  };
}

function parseSuccessfulImportBody(result: FetchJsonResult, url: string): BisbeardBuildPayload {
  const payload = result.payload;
  if (payload && "build" in payload && payload.build && typeof payload.build === "object") {
    return payload.build;
  }
  if (payload && "data" in payload && typeof payload.data === "string") {
    return decodeBisbeardBuild(payload.data);
  }
  if (result.contentType.includes("text/html")) {
    throw diagnoseHttpFailure(result.status || 404, result.contentType, url);
  }
  throw new BisbeardImportError("Bisbeard import returned an unexpected response.", {
    status: result.status,
    url,
  });
}

function diagnoseFetchFailure(result: FetchJsonResult, url: string): never {
  const payload = result.payload as BisbeardImportApiResponse | null;
  if (payload?.error) {
    throw new BisbeardImportError(payload.error, { status: result.status, url });
  }
  throw diagnoseHttpFailure(result.status, result.contentType, url);
}

/** @deprecated Service worker proxy is no longer required; kept as a no-op for callers. */
export async function ensureBisbeardProxyReady(): Promise<void> {
  /* Production now calls the absolute Cloudflare Worker URL directly. */
}

export async function loadBisbeardBuild(input: string): Promise<BisbeardMappedBuild> {
  const buildId = parseBisbeardBuildId(input);
  if (!buildId) {
    throw new BisbeardImportError("Paste a Bisbeard share URL (coa.bisbeard.com/b/…) or build id.");
  }
  const build = await fetchImportPayload(input.trim());
  return mapBisbeardBuild(build);
}
