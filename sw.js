/* Локус — service worker: оболочка сайта из памяти браузера + офлайн-фолбэк. */
const VERSION = "locus-2026-10-29-nav-1";
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./assets/css/base.css",
  "./assets/css/landing.css",
  "./assets/css/app.css",
  "./assets/css/auth.css",
  "./assets/js/session.js",
  "./assets/js/consent.js",
  "./assets/js/sw-register.js",
  "./assets/js/landing.js",
  "./assets/js/app.js",
  "./assets/vendor/leaflet/leaflet.js",
  "./assets/vendor/leaflet/leaflet.css",
  "./assets/fonts/onest-cyrillic.woff2",
  "./assets/fonts/onest-latin.woff2",
  "./assets/fonts/lora-cyrillic.woff2",
  "./assets/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isCode(url) {
  return /\.(css|js)$/i.test(url.pathname);
}

function isStaticAsset(url) {
  return /\.(woff2|woff|svg|png|jpe?g|webp|ico|json)$/i.test(url.pathname);
}

/* Навигация: сначала сеть, кэш только без сети. Иначе после правки клиент видит старые кнопки. */
async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
      return fresh;
    }
  } catch { /* офлайн */ }
  return (await cache.match(request)) || (await cache.match("./index.html")) || (await cache.match("./"));
}

/* Код (CSS/JS) — сначала сеть: после правок пользователь сразу видит новую версию. */
async function networkFirstCode(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return (await caches.match(request)) || (await caches.match("./index.html"));
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) {
    // фоном обновляем кэш, но отдаём из памяти мгновенно
    fetch(request).then((fresh) => {
      if (fresh && fresh.ok) caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, fresh.clone()));
    }).catch(() => {});
    return cached;
  }
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }
  if (isCode(url)) {
    event.respondWith(networkFirstCode(request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstAsset(request));
  }
});
