// Offline shell: every built file is cached at install; GitHub API calls
// (another origin) always go to the network. A new build = a new cache.
const VERSION = __VERSION__;
const FILES = __FILES__;
self.addEventListener("install", event => {
	event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
	event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
	if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
	event.respondWith(caches.open(VERSION).then(async cache => {
		const hit = await cache.match(event.request, { ignoreSearch: true });
		return hit ?? fetch(event.request);
	}));
});
