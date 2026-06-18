const CACHE_NAME="biocalculo-bpl-v3";
const APP_ASSETS=[
  "./",
  "./index.html",
  "./calda.html",
  "./campo.html",
  "./campo.css",
  "./campo.js",
  "./campo-core.js",
  "./manifest.webmanifest",
  "./fonts/inter.woff2",
  "./fonts/sora.woff2",
  "./lib/jspdf.umd.min.js"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const requestUrl=new URL(event.request.url);
  if(requestUrl.origin===self.location.origin){
    event.respondWith(
      fetch(event.request)
        .then(response=>{
          if(response&&response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
          }
          return response;
        })
        .catch(()=>caches.match(event.request).then(hit=>{
          if(hit)return hit;
          if(event.request.mode==="navigate")return caches.match("./index.html");
          return Response.error();
        }))
    );
    return;
  }
  event.respondWith(
    fetch(event.request).catch(()=>caches.match(event.request))
  );
});
