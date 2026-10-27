// Simple offline cache for the app shell.
const CACHE = "day-v86";
const ASSETS = [
  "./", "./index.html", "./styles.css?v=83", "./app.js?v=agent1-83", "./config.js?v=41", "./slot-transfer.js?v=2",

  "./speech-transcriber.js?v=83", "./speech-worker.js?v=83", "./diary-agent.js?v=83", "./voice-context.js?v=83", "./voice.js?v=83", "./voice-actions.js?v=83", "./voice-store.js?v=83", "./voice-app.js?v=83", "./voice-draft.js?v=83", "./patterns.js?v=70", "./event-range.js?v=71", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
];


self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always try fresh, fall back to cache when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // speech runtime/model manage their own cache
  if (url.hostname.endsWith("supabase.co")) return; // never touch API calls
  if (url.pathname.startsWith("/api/voice/")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
