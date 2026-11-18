/* Service Worker — אפליקציה למחשב, עבודה בלי רשת, ותזכורת יומית ברקע */
const CACHE = 'pt-cache-202611180940';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
// קודם רשת (תמיד הגרסה העדכנית), ואם אין רשת — מהמטמון
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // דף ה-HTML וה-SW נבדקים מול השרת בכל פעם (cache: no-cache) — כך גרסה חדשה מגיעה מיד גם לאפליקציה המותקנת
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('.webmanifest');
  e.respondWith(
    fetch(req, isPage ? { cache: 'no-cache' } : undefined).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./')))
  );
});

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './#delayed';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.postMessage('open-delayed'); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

/* ---------- בדיקה יומית ברקע (Chrome/Edge, באפליקציה מותקנת) ---------- */
self.addEventListener('periodicsync', (e) => { if (e.tag === 'delayed-check') e.waitUntil(checkDelayed()); });

function idb(mode, fn) {
  return new Promise((ok) => {
    const r = indexedDB.open('procurement-tracker', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { try { const t = r.result.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => ok(q && q.result); t.onerror = () => ok(null); } catch { ok(null); } };
    r.onerror = () => ok(null);
  });
}
const idbGet = (k) => idb('readonly', (s) => s.get(k));
const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
function autoCat(v) {
  const s = norm(v);
  if (!s) return 'open';
  if (/בוטל|מבוטל|cancel/.test(s)) return 'cancelled';
  if (/חלק|partial/.test(s)) return 'open';
  if (/סגור|closed|complete|הושלם/.test(s)) return 'closed';
  if (/סופק|התקבל|נקלט|הגיע|deliver|receiv|supplied/.test(s)) return 'supplied';
  if (/עיכוב|מעוכב|באיחור|איחור|delay|late|חריג|תקוע|בעי|hold|חסום|דחוף/.test(s)) return 'delayed';
  return 'open';
}
async function checkDelayed() {
  const pref = await idbGet('notify');
  const n = pref && pref.notify;
  if (!n || !n.on) return;
  const now = new Date();
  if (!(n.days || []).includes(now.getDay())) return;
  const hm = now.toTimeString().slice(0, 5);
  if (hm < (n.from || '00:00') || hm > (n.to || '23:59')) return;
  const today = now.toISOString().slice(0, 10);
  if ((await idbGet('notifiedOn')) === today) return;
  const db = await idbGet('db');
  if (!db || !db.datasets) return;
  const m = (db.settings && db.settings.mapping) || {};
  const map = (db.settings && db.settings.statusMap) || {};
  let count = 0; const by = {};
  for (const r of db.datasets.orders.rows || []) {
    if (r.deleted) continue;
    let c = m.status ? (map[norm(r.c[m.status])] || autoCat(r.c[m.status])) : 'open';
    const due = m.due ? String(r.c[m.due] || '') : '';
    if (c === 'open' && /^\d{4}-\d{2}-\d{2}/.test(due) && due < today) c = 'delayed';
    if (c !== 'delayed') continue;
    count++;
    const k = String((m.project && r.c[m.project]) || 'ללא פרויקט');
    by[k] = (by[k] || 0) + 1;
  }
  if (!count) return;
  await idbSet('notifiedOn', today);
  const body = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ') + '\nלחיצה פותחת את הרשימה';
  await self.registration.showNotification(`${count} הזמנות בעיכוב`, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'delayed-daily', dir: 'rtl', lang: 'he', data: { url: './#delayed' } });
}
