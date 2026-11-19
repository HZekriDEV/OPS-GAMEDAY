import { defineConfig } from "vite";
export default defineConfig({
  plugins: [
    {
      name: "offline-shell",
      generateBundle(_, bundle) {
        const files = [
          "/",
          "/site.webmanifest",
          "/ops-mark.png",
          "/apple-touch-icon.png",
          "/icon-192.png",
          "/icon-512.png",
          ...Object.keys(bundle)
            .filter((p) => /\.(js|css)$/.test(p))
            .map((p) => "/" + p),
        ];
        const cache = "opsgameday-" + Object.keys(bundle).join("-");
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `
 const cache=${JSON.stringify(cache)};
 self.addEventListener('install',e=>e.waitUntil(caches.open(cache).then(c=>c.addAll(${JSON.stringify(files)})).then(()=>self.skipWaiting())));
 self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('opsgameday-')&&k!==cache).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
 self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
 e.respondWith(caches.open(cache).then(async c=>await c.match(e.request.mode==='navigate'?'/':e.request)||fetch(e.request)))});
 `,
        });
      },
    },
  ],
});
