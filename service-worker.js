/* Qurablox City — Service Worker (PWA offline cache)
 * Aktif hanya bila aplikasi dibuka lewat https:// atau http://localhost (bukan file://).
 * Strategi:
 *  - Halaman HTML: network-first, jatuh ke salinan cache saat offline.
 *  - Berkas lokal (manifest, ikon): cache-first.
 *  - Library CDN (Three.js, Tailwind, FontAwesome, Google Fonts): stale-while-revalidate,
 *    disimpan saat pertama kali dimuat online sehingga game tetap bisa dibuka offline.
 *  - API Supabase (/rest/v1, /auth/v1): TIDAK pernah di-cache (selalu jaringan).
 */
const VERSION = "qurablox-v5-2026-11-12";
const CORE_CACHE = `${VERSION}-core`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "https://cdn.tailwindcss.com",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Fredoka:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Scheherazade+New:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap"
];
const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const core = await caches.open(CORE_CACHE);
    await Promise.all(CORE_ASSETS.map(u => core.add(new Request(u, { cache: "reload" })).catch(() => null)));
    const rt = await caches.open(RUNTIME_CACHE);
    await Promise.all(CDN_ASSETS.map(async (u) => {
      try {
        const res = await fetch(u, { mode: "no-cors" });
        if (res && (res.ok || res.type === "opaque")) await rt.put(u, res);
      } catch (e) { /* offline saat instal: akan dicoba lagi saat runtime */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("qurablox-") && !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isApi(url) {
  return url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/functions/v1/") || url.hostname.endsWith(".supabase.co");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (isApi(url)) return; // selalu ke jaringan
  if (url.pathname.endsWith("qurablox-backend.json")) return; // konfigurasi penerapan selalu segar

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CORE_CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true }) || await caches.match("./index.html") || await caches.match("./");
        return cached || new Response("<h1>Qurablox City</h1><p>Offline dan belum ada salinan tersimpan. Buka sekali saat online.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req, { ignoreVary: true });
      const network = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
      return cached || (await network) || new Response("", { status: 504 });
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) { const cache = await caches.open(RUNTIME_CACHE); cache.put(req, res.clone()).catch(() => {}); }
        return res;
      } catch (e) { return new Response("", { status: 504 }); }
    })());
  }
});
