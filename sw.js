// Service worker mínimo: guarda os arquivos do app para abrir rápido.
// A chamada de envio (/.netlify/functions/...) nunca é guardada em cache.
var CACHE = 'contagem-v5';
var ARQUIVOS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest', '/itens.json', '/config.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQUIVOS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.url.indexOf('/.netlify/') !== -1) return;
  // rede primeiro (pega atualizações), cache como reserva
  e.respondWith(
    fetch(req).then(function (res) {
      var copia = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copia); });
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
