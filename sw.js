/* Public application resources only. Patient records, credentials and API responses
   must never be stored in a CacheStorage cache. */
const CACHE = 'clinic-shell-v2.1.2';
const SHELL = [
  './', './index.html', './offline-store.js', './icon.png', './icon-192.png',
  './clinic.webmanifest', './apple-touch-icon.png', './icon-32.png', './clinic.ico'
];
const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/13.0.0/';
const FIREBASE_ENTRY = ['app', 'auth', 'database', 'analytics'].map(name => FIREBASE_BASE + 'firebase-' + name + '.js');
const LIBRARIES = [
  'https://cdn.tailwindcss.com/',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

function firebaseModule(url) {
  return url.startsWith(FIREBASE_BASE) && new URL(url).pathname.endsWith('.js');
}
function isLibrary(url) {
  return LIBRARIES.includes(url) || firebaseModule(url) ||
    url.startsWith('https://fonts.googleapis.com/') ||
    url.startsWith('https://fonts.gstatic.com/');
}
function referencedModules(source, parent) {
  const dependencies = [];
  const matcher = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])([^'"]+)\1/g;
  let match;
  while ((match = matcher.exec(source))) {
    try {
      const dependency = new URL(match[2], parent).href;
      if (firebaseModule(dependency)) dependencies.push(dependency);
    } catch (_) {}
  }
  return dependencies;
}
async function storeExternal(cache, url, cors) {
  const request = new Request(url, {mode: cors ? 'cors' : 'no-cors'});
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (!response.ok && response.type !== 'opaque') throw Error('Offline asset unavailable: ' + url);
  await cache.put(request, response.clone());
  return response;
}
async function primeFirebaseGraph(cache) {
  const checked = new Set(), queue = [...FIREBASE_ENTRY];
  let success = true;
  while (queue.length) {
    const batch = [...new Set(queue.splice(0, 8))].filter(url => !checked.has(url));
    for (const url of batch) checked.add(url);
    await Promise.all(batch.map(async url => {
      try {
        const response = await storeExternal(cache, url, true);
        const contents = await response.clone().text();
        for (const dependency of referencedModules(contents, url)) {
          if (!checked.has(dependency)) queue.push(dependency);
        }
      } catch (_) { success = false; }
    }));
  }
  return success;
}
async function primeAssets(cache) {
  const [modules, ...libraries] = await Promise.all([
    primeFirebaseGraph(cache),
    ...LIBRARIES.map(url => storeExternal(cache, url, false).then(() => true).catch(() => false))
  ]);
  return modules && libraries.every(Boolean);
}
async function readyForOffline(cache, graphReady) {
  const files = await Promise.all([...SHELL, ...LIBRARIES, ...FIREBASE_ENTRY]
    .map(path => cache.match(new URL(path, self.registration.scope).href)));
  return graphReady && files.every(Boolean);
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A temporarily blocked CDN must not prevent installation of the local shell.
    await cache.addAll(SHELL);
    await primeAssets(cache);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  // Retain the previous cache as fallback until the new version has been verified
  // on devices with unreliable connections.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'clinic-offline-check') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const graphReady = await primeAssets(cache);
    const ready = await readyForOffline(cache, graphReady);
    event.source?.postMessage({type: 'clinic-offline-ready', version: '2.1.2', ready});
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const shell = url.origin === self.location.origin &&
    SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname);
  const library = isLibrary(url.href);
  if (!shell && !library) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = await caches.match(event.request);
    if (library && stored) return stored;
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') {
        event.waitUntil(cache.put(event.request, response.clone()));
      }
      return response;
    } catch (error) {
      if (stored) return stored;
      throw error;
    }
  })());
});
