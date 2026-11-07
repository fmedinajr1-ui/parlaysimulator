// Kill-switch: removes the old offline worker that caused reloads and stale pages.
function isWorkboxCacheForThisRegistration(name) {
  const hasWorkboxBucket = /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name);
  return (hasWorkboxBucket && name.endsWith(self.registration.scope)) || /^parlay-farm-v|^js-cache-v/.test(name);
}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.allSettled(names.filter(isWorkboxCacheForThisRegistration).map((n) => caches.delete(n)));
        // Never navigate open clients: leaving and returning to the app must not refresh it.
      } finally {
        await self.registration.unregister();
      }
    })(),
  ),
);
