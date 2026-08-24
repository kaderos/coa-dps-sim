const UPSTREAM = "https://gear-planner-api.bisbeard.workers.dev";
const MARKER = "/bisbeard-api";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const idx = url.pathname.indexOf(MARKER);
  if (idx === -1) return;

  const path = url.pathname.slice(idx + MARKER.length);
  const upstream = `${UPSTREAM}${path}${url.search}`;

  event.respondWith(
    fetch(upstream, {
      headers: { Accept: "application/json" },
    }).then((response) => {
      const headers = new Headers(response.headers);
      headers.set("Content-Type", headers.get("Content-Type") || "application/json");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
});
