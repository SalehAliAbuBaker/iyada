const CACHE = 'clinic-shell-v1.2.1';
const SHELL = ['./', './index.html', './icon.png', './icon-192.png', './clinic.webmanifest', './apple-touch-icon.png', './icon-32.png', './clinic.ico'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('clinic-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only the public app shell is cached. Clinical API requests are untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const allowed = SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname);
  if (!allowed) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
