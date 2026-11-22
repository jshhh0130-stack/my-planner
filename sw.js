// 서비스 워커: 오프라인에서도 열리게 + 새 버전을 올리면 다음에 열 때 바로 반영
// 앱 파일은 '인터넷 먼저(항상 최신)', 인터넷이 없을 때만 저장해 둔 사본을 씁니다.
const CACHE = 'planner-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/util.js',
  './js/cloud.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('planner-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/version.json')) return; // 업데이트 확인은 항상 인터넷에서
    e.respondWith(networkFirst(req));
    return;
  }
  // 글꼴·Firebase 도구: 버전이 고정된 주소라 한 번 받아 두면 그대로 사용
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(cacheFirst(req));
  }
  // 그 밖(구글 로그인·클라우드 저장)은 건드리지 않음
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const isNav = req.mode === 'navigate';
  const fresh = new Request(isNav ? req.url : req, isNav ? { cache: 'no-cache', credentials: 'same-origin' } : { cache: 'no-cache' });
  const net = fetch(fresh).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (isNav ? await cache.match('./') : undefined);
    if (hit) return hit;
    return net; // 사본도 없으면 인터넷 응답을 끝까지 기다림
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
