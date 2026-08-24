const UPSTREAM = "https://gear-planner-api.bisbeard.workers.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/builds\/([^/]+)$/);
    if (!match) {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    const upstream = `${UPSTREAM}/api/builds/${encodeURIComponent(match[1])}`;
    const response = await fetch(upstream, {
      headers: { Accept: "application/json" },
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  },
};
