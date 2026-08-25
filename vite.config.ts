import { defineConfig, type Plugin } from "vite";
import LZString from "lz-string";

const UPSTREAM = "https://gear-planner-api.bisbeard.workers.dev";

function parseBisbeardBuildId(input: string): string | null {
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

/** Local stand-in for the Cloudflare Worker import endpoint during `vite` / `vite preview`. */
function bisbeardImportDevPlugin(): Plugin {
  return {
    name: "bisbeard-import-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/bisbeard/import")) return next();
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const url = new URL(req.url, "http://localhost");
          const share = url.searchParams.get("share") ?? "";
          const buildId = parseBisbeardBuildId(share);
          if (!buildId) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid Bisbeard share link or build id.", share }));
            return;
          }

          const upstream = await fetch(`${UPSTREAM}/api/builds/${encodeURIComponent(buildId)}`, {
            headers: { Accept: "application/json" },
          });
          const text = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status === 404 ? 404 : 502;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  upstream.status === 404
                    ? `Build "${buildId}" was not found on Bisbeard.`
                    : `Bisbeard upstream returned ${upstream.status}.`,
                buildId,
                upstreamStatus: upstream.status,
              }),
            );
            return;
          }

          const payload = JSON.parse(text) as { data?: string; createdAt?: string };
          if (!payload?.data || typeof payload.data !== "string") {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Build payload is missing compressed data.", buildId }));
            return;
          }

          const json = LZString.decompressFromEncodedURIComponent(payload.data);
          if (!json) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Could not decompress the Bisbeard build.", buildId }));
            return;
          }

          const build = JSON.parse(json);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ buildId, createdAt: payload.createdAt ?? null, build }));
        } catch (cause) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Failed to reach Bisbeard upstream.", detail: String(cause) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: ".",
  publicDir: "public",
  base: mode === "production" ? "/coa-dps-sim/" : "/",
  plugins: [bisbeardImportDevPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    // "::" binds dual-stack so both 127.0.0.1 and ::1 answer. Chrome resolves
    // localhost to ::1 first, and an IPv4-only bind gets refused there.
    host: "::",
    fs: {
      deny: ["vendor/**"],
    },
    watch: {
      ignored: ["**/vendor/**", "**/data/bisbeard/bisbeard-*.json"],
    },
  },
  // vendor/ holds a read-only clone of wowsims/classic for reference; its imports
  // are not installed here, so keep the dep scanner out of it.
  optimizeDeps: {
    entries: ["index.html", "src/**/*.ts"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
