// Legacy kill-switch: Bisbeard import no longer uses a service worker.
// Returning browsers may still have an old registration; unregister on activate.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration
      .unregister()
      .then(() => self.clients.matchAll())
      .then((clients) => {
        for (const client of clients) {
          if ("navigate" in client) client.navigate(client.url);
        }
      }),
  );
});
