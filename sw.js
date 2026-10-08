const CACHE = 'clinic-shell-v2.1.1';
const SHELL = ['./','./index.html','./offline-store.js','./icon.png','./icon-192.png','./clinic.webmanifest','./apple-touch-icon.png','./icon-32.png','./clinic.ico'];
const LIBRARIES = ['https://cdn.tailwindcss.com/','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',...['app','auth','database','analytics'].map(name=>'https://www.gstatic.com/firebasejs/13.0.0/firebase-'+name+'.js')];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);await cache.addAll(SHELL);
    const results=await Promise.allSettled(LIBRARIES.map(url=>cache.add(new Request(url,{mode:'cors'}))));
    if(results.some(result=>result.status==='rejected'))throw new Error('Offline libraries not available yet.');
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('clinic-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{
  if(event.data?.type!=='clinic-offline-check')return;
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE),checks=await Promise.all([...SHELL,...LIBRARIES].map(url=>cache.match(new URL(url,self.registration.scope).href)));
    event.source?.postMessage({type:'clinic-offline-ready',version:'2.1.1',ready:checks.every(Boolean)});
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const shell=url.origin===self.location.origin && SHELL.some(path=>new URL(path,self.registration.scope).pathname===url.pathname);
  const library=LIBRARIES.includes(url.href)||url.origin==='https://cdn.tailwindcss.com'||url.origin==='https://fonts.googleapis.com'||url.origin==='https://fonts.gstatic.com';
  // API data, tokens, profiles and medical records are never stored in this public cache.
  if(!shell&&!library)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(library){const existing=await cache.match(event.request);if(existing)return existing;}
    try{const response=await fetch(event.request);if(response.ok)event.waitUntil(cache.put(event.request,response.clone()));return response;}
    catch(error){const stored=await cache.match(event.request);if(stored)return stored;throw error;}
  })());
});
