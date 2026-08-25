import LZString from "lz-string";

const UPSTREAM = "https://gear-planner-api.bisbeard.workers.dev";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://kaderos.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseAllowedOrigins(raw) {
  if (!raw || !raw.trim()) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * @param {Request} request
 * @param {string[]} allowed
 * @returns {Record<string, string>}
 */
function corsHeadersFor(request, allowed) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} cors
 */
function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}

/**
 * @param {string} input
 * @returns {string | null}
 */
function parseBisbeardBuildId(input) {
  const raw = input.trim();
  if (!raw) return null;
  const looksLikeId = (value) => /^[A-Za-z0-9_-]{6,}$/.test(value);
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
 * @param {string} buildId
 */
async function fetchUpstreamBuild(buildId) {
  const upstream = `${UPSTREAM}/api/builds/${encodeURIComponent(buildId)}`;
  const response = await fetch(upstream, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  return { response, text };
}

/**
 * @param {Request} request
 * @param {{ ALLOWED_ORIGINS?: string }} env
 */
async function handleImport(request, env) {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const cors = corsHeadersFor(request, allowed);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors);
  }

  const url = new URL(request.url);

  if (url.pathname === "/api/bisbeard/import") {
    const share = url.searchParams.get("share") ?? "";
    const buildId = parseBisbeardBuildId(share);
    if (!buildId) {
      return jsonResponse(
        { error: "Invalid Bisbeard share link or build id.", share },
        400,
        cors,
      );
    }

    let upstream;
    try {
      upstream = await fetchUpstreamBuild(buildId);
    } catch (cause) {
      return jsonResponse(
        { error: "Failed to reach Bisbeard upstream.", detail: String(cause) },
        502,
        cors,
      );
    }

    if (!upstream.response.ok) {
      const status = upstream.response.status === 404 ? 404 : 502;
      return jsonResponse(
        {
          error:
            upstream.response.status === 404
              ? `Build "${buildId}" was not found on Bisbeard.`
              : `Bisbeard upstream returned ${upstream.response.status}.`,
          buildId,
          upstreamStatus: upstream.response.status,
        },
        status,
        cors,
      );
    }

    let payload;
    try {
      payload = JSON.parse(upstream.text);
    } catch {
      return jsonResponse({ error: "Bisbeard returned invalid JSON.", buildId }, 502, cors);
    }

    if (!payload?.data || typeof payload.data !== "string") {
      return jsonResponse({ error: "Build payload is missing compressed data.", buildId }, 502, cors);
    }

    const json = LZString.decompressFromEncodedURIComponent(payload.data);
    if (!json) {
      return jsonResponse({ error: "Could not decompress the Bisbeard build.", buildId }, 502, cors);
    }

    let build;
    try {
      build = JSON.parse(json);
    } catch {
      return jsonResponse({ error: "Could not parse the Bisbeard build JSON.", buildId }, 502, cors);
    }

    return jsonResponse(
      {
        buildId,
        createdAt: payload.createdAt ?? null,
        build,
      },
      200,
      cors,
    );
  }

  const match = url.pathname.match(/^\/api\/builds\/([^/]+)$/);
  if (match) {
    let upstream;
    try {
      upstream = await fetchUpstreamBuild(match[1]);
    } catch (cause) {
      return jsonResponse({ error: "Failed to reach Bisbeard upstream.", detail: String(cause) }, 502, cors);
    }
    return new Response(upstream.text, {
      status: upstream.response.status,
      headers: {
        ...cors,
        "Content-Type": upstream.response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  return jsonResponse({ error: "Not found" }, 404, cors);
}

export default {
  /**
   * @param {Request} request
   * @param {{ ALLOWED_ORIGINS?: string }} env
   */
  async fetch(request, env) {
    return handleImport(request, env ?? {});
  },
};
