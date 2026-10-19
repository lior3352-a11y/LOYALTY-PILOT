const CACHE='loyalty-pilot-v13';
const ASSETS=['./','./index.html','./join.html','./customer.html','./accessibility.html','./terms.html','./accessibility.css','./site-common.js','./manifest.webmanifest','./icon.svg','./icon-192.svg','./icon-512.svg'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith('loyalty-pilot-')&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Leave API, authenticated and cross-origin requests entirely to the network.
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||event.request.headers.has('Authorization'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(response=>{
          const copy=response.clone();
          if(response.ok)event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
          return response;
        })
        .catch(()=>caches.match(event.request).then(r=>r||caches.match('./customer.html')))
    );
    return;
  }

  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response=>{
        const copy=response.clone();
        if(response.ok)event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
