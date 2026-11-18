/* =========================================================
   app.js — המעטפת: חיבור, כניסה, לשוניות, תצוגות, ייבוא וייצוא
   ========================================================= */
(function () {
  'use strict';
  const D = Domain;
  const { esc, icon } = UI;
  const $ = (s, el = document) => el.querySelector(s);
  const app = document.getElementById('app');
  const DENSITY = { compact: 30, normal: 36, comfy: 46 };
  const NUMF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const fmtN = (n) => NUMF.format(Number(n || 0));
  const pct = (x) => Math.round(x * 100) + '%';

  const S = {
    route: { tab: 'home', sub: 'home' },
    grid: null,
    catFilter: null,
    newDays: 7,
    density: localStorage.getItem('pt.density') || 'normal',
    expanded: null,
    newTabs: new Set(),
    wrap: localStorage.getItem('pt.wrap') !== '0',
    zoom: +(localStorage.getItem('pt.zoom') || 1),
    moreOpen: !!sessionStorage.getItem('pt.more'),
    view: Object.assign({ font: 'Rubik', size: 14, align: 'center' }, (() => { try { return JSON.parse(localStorage.getItem('pt.view')) || {}; } catch { return {}; } })()),
    pw: null, // סיסמת המשתמש בזיכרון בלבד (לא נשמרת) — להפעלת כניסה מכל מכשיר
  };
  const rowHeight = () => DENSITY[S.density] || 36;

  /* ================= מצב כהה ================= */
  const Theme = {
    current() { return document.documentElement.dataset.theme || 'light'; },
    apply(t) {
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1A2945' : '#EEF3FA');
      document.querySelectorAll('.theme-btn').forEach((b) => (b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 18)));
    },
    toggle(btn) {
      const next = this.current() === 'dark' ? 'light' : 'dark';
      localStorage.setItem('pt.theme', next);
      const r = btn ? btn.getBoundingClientRect() : { left: innerWidth / 2, top: 0, width: 0, height: 0 };
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // מעבר בגל עגול מהכפתור (בדפדפנים שתומכים)
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.documentElement.style.setProperty('--vt-x', x + 'px');
        document.documentElement.style.setProperty('--vt-y', y + 'px');
        document.startViewTransition(() => this.apply(next));
      } else this.apply(next);
      if (!isGridView()) setTimeout(() => renderMain(false), 10);
    },
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!localStorage.getItem('pt.theme')) Theme.apply(e.matches ? 'dark' : 'light'); });

  /* ================= התראה יומית על הזמנות בעיכוב ================= */
  const Notifier = {
    timer: null,
    async permit() {
      if (!('Notification' in window)) { UI.toast('הדפדפן הזה לא תומך בהתראות.', 'error'); return false; }
      if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { } }
      return Notification.permission === 'granted';
    },
    inWindow(n, d = new Date()) {
      if (!n || !(n.days || []).includes(d.getDay())) return false;
      const hm = d.toTimeString().slice(0, 5);
      return hm >= (n.from || '00:00') && hm <= (n.to || '23:59');
    },
    async start() {
      clearInterval(this.timer);
      const u = Store.currentUser();
      await Store.kvSet('notify', u ? { userId: u.id, notify: u.notify || null } : null); // גם ל-Service Worker
      PWA.periodic();
      if (!u || !u.notify || !u.notify.on) return;
      this.timer = setInterval(() => this.check(), 60000);
      setTimeout(() => this.check(), 5000);
    },
    async check(force) {
      const u = Store.currentUser(); if (!u) return;
      const n = u.notify;
      if (!force && (!n || !n.on)) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') { if (force) UI.toast('ההתראות לא מאושרות בדפדפן הזה.', 'error', 6000); return; }
      if (!force && !this.inWindow(n)) return;
      const today = D.today();
      if (!force && (await Store.kvGet('notifiedOn')) === today) return;
      const rows = Store.rows('orders').filter((r) => D.cat(r) === 'delayed');
      if (!rows.length && !force) return;
      if (!force) await Store.kvSet('notifiedOn', today);
      const m = D.mapping(); const by = new Map();
      for (const r of rows) { const k = String((m.project && r.c[m.project]) || 'ללא פרויקט'); by.set(k, (by.get(k) || 0) + 1); }
      const title = rows.length ? `${fmtN(rows.length)} הזמנות בעיכוב` : 'אין כרגע הזמנות בעיכוב';
      const body = rows.length ? [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ') + '\nלחיצה פותחת את הרשימה' : 'זו התראת בדיקה — ההתראות פועלות.';
      const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'delayed-daily', dir: 'rtl', lang: 'he', data: { url: location.pathname + '#delayed' } };
      try {
        const reg = PWA.reg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
        if (reg) await reg.showNotification(title, opts);
        else { const nt = new Notification(title, opts); nt.onclick = () => { window.focus(); openDelayed(); nt.close(); }; }
      } catch (e) { console.warn(e); const nt = new Notification(title, opts); nt.onclick = () => { window.focus(); openDelayed(); }; }
    },
  };
  function openDelayed() {
    if (!Store.currentUser() || !$('#main')) return;
    S.route = { tab: 'main', sub: 'orders' }; renderTabs(); renderMain();
    S.catFilter = 'delayed'; S.grid && (S.grid.refresh(), renderChips(), renderQuick());
  }

  /* ================= אפליקציה למחשב (PWA) ================= */
  const PWA = {
    deferred: null, reg: null,
    init() {
      if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js?v=' + (window.APP_VERSION || '1')).then((r) => { this.reg = r; this.periodic(); }).catch((e) => console.warn('sw', e));
        navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'open-delayed') openDelayed(); });
      }
      window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.deferred = e; this.sync(); });
      setInterval(() => this.checkUpdate(), 15 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.checkUpdate(); });
      setTimeout(() => this.checkUpdate(), 8000);
      window.addEventListener('appinstalled', () => { this.deferred = null; this.sync(); UI.toast('האפליקציה הותקנה במחשב.', 'ok'); });
    },
    installed() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
    /** בדיקה אם עלתה גרסה חדשה לאתר — חשוב במיוחד לאפליקציה מותקנת שנשארת פתוחה כל היום */
    async checkUpdate() {
      try {
        const html = await fetch('index.html?_=' + Date.now(), { cache: 'no-store' }).then((r) => r.text());
        const m = /APP_VERSION="(\d+)"/.exec(html);
        if (!m || !window.APP_VERSION || m[1] === window.APP_VERSION || this.shown === m[1]) return;
        if (+m[1] < +window.APP_VERSION) return;
        this.shown = m[1];
        if (this.reg) this.reg.update().catch(() => {});
        const bar = document.createElement('div');
        bar.className = 'update-bar'; bar.setAttribute('role', 'status');
        bar.innerHTML = `${icon('refresh', 16)}<span>יש גרסה חדשה של המערכת</span><button class="btn btn-primary sm" type="button">עדכון עכשיו</button><button class="icon-btn sm" type="button" aria-label="אחר כך">${icon('x', 14)}</button>`;
        bar.querySelector('.btn').onclick = () => { Store.flush && Store.flush(); location.reload(); };
        bar.querySelector('.icon-btn').onclick = () => bar.remove();
        document.body.appendChild(bar);
        requestAnimationFrame(() => bar.classList.add('in'));
      } catch { }
    },
    canInstall() { return !!this.deferred && !this.installed(); },
    sync() { const b = $('#installBtn'); if (b) b.hidden = !this.canInstall(); },
    async install() {
      if (this.installed()) return UI.toast('האפליקציה כבר מותקנת במחשב הזה.', 'info');
      if (this.deferred) { this.deferred.prompt(); await this.deferred.userChoice.catch(() => null); this.deferred = null; this.sync(); return; }
      const ua = navigator.userAgent;
      const how = /iPhone|iPad/.test(ua) ? 'בספארי: כפתור השיתוף ← "הוספה למסך הבית".'
        : /Safari/.test(ua) && !/Chrome|Edg/.test(ua) ? 'בספארי במק: תפריט "קובץ" ← "הוספה ל-Dock".'
        : /Edg/.test(ua) ? 'ב-Edge: תפריט ⋯ ← "אפליקציות" ← "התקנת האתר הזה כאפליקציה".'
        : 'ב-Chrome: סמל ההתקנה בצד שורת הכתובת, או תפריט ⋮ ← "שמירה ושיתוף" ← "התקנת הדף כאפליקציה".';
      UI.modal({ title: 'התקנה כאפליקציה במחשב', body: `<p>${how}</p><p class="muted">אחרי ההתקנה המערכת נפתחת בחלון משלה, עם סמל בשולחן העבודה ובשורת המשימות — כמו וואטסאפ ווב. כדי לקבל את התזכורת היומית גם בלי לפתוח אותה, אפשר להגדיר שהיא תיפתח עם הפעלת המחשב.</p>`, actions: [{ label: 'הבנתי', primary: true }] });
    },
    async periodic() {
      try {
        const reg = this.reg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
        if (!reg || !('periodicSync' in reg)) return;
        const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (st.state !== 'granted') return;
        const u = Store.currentUser();
        if (u && u.notify && u.notify.on) await reg.periodicSync.register('delayed-check', { minInterval: 60 * 60 * 1000 });
        else await reg.periodicSync.unregister('delayed-check');
      } catch { }
    },
  };
  PWA.init();

  /* ================= הפעלה ================= */
  async function start() {
    readConnectLink();
    app.innerHTML = `<div class="boot"><div class="boot-mark">${fanSvg(64)}</div><p>טוען את מערכת המעקב…</p></div>`;
    const r = await Store.init();
    if (r.needsSetup) await Store.connect({ mode: 'local' }); // עובדים מקומית; גיטהאב אפשר לחבר אחר כך
    if (!Store.currentUser()) return renderAuth();
    renderShell();
  }
  function readConnectLink() {
    const m = /#connect=([^&]+)/.exec(location.hash);
    if (!m) return;
    try {
      const cfg = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
      if (cfg.owner && cfg.repo && cfg.token) localStorage.setItem('pt.cfg.v1', JSON.stringify(Object.assign({ mode: 'github', branch: 'main', path: 'data/procurement-db.json.gz' }, cfg)));
    } catch (e) { console.warn(e); }
    history.replaceState(null, '', location.pathname + location.search);
  }

  /* ================= מסך חיבור ================= */
  function renderSetup(prefill) {
    const c = Object.assign({ owner: '', repo: '', branch: 'main', path: 'data/procurement-db.json.gz', token: '' }, prefill || (Store.cfg && Store.cfg.mode === 'github' ? Store.cfg : {}));
    app.innerHTML = `
    <div class="gate">
      <section class="gate-art" aria-hidden="true">${fanSvg(340, true)}
        <div class="gate-caption"><b>מעקב הזמנות רכש</b><span>טבלת הזמנות, פרויקטים, דשבורד ו-BOM במקום אחד</span></div>
      </section>
      <section class="gate-form">
        <form class="card form-card" id="setupForm" autocomplete="off">
          <h1>חיבור למאגר הנתונים</h1>
          <p class="muted">חיבור למאגר גיטהאב מסנכרן את הנתונים בין כל המכשירים והעורכים. הנתונים שכבר הזנת במכשיר הזה יעברו למאגר אוטומטית.</p>
          <div class="grid2">
            <label class="field"><span>שם משתמש בגיטהאב</span><input name="owner" required value="${esc(c.owner)}" dir="ltr" placeholder="my-user"></label>
            <label class="field"><span>שם המאגר לנתונים</span><input name="repo" required value="${esc(c.repo)}" dir="ltr" placeholder="procurement-data"></label>
            <label class="field"><span>ענף</span><input name="branch" value="${esc(c.branch)}" dir="ltr"></label>
            <label class="field"><span>נתיב קובץ הנתונים</span><input name="path" value="${esc(c.path)}" dir="ltr"></label>
          </div>
          <label class="field"><span>טוקן גישה (Fine-grained token)</span><input name="token" type="password" required value="${esc(c.token)}" dir="ltr" placeholder="github_pat_…"></label>
          <details class="help"><summary>איך יוצרים טוקן?</summary>
            <ol><li>בגיטהאב: Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens ← Generate new token.</li>
            <li>תחת Repository access בחר <b>רק</b> שני מאגרים: את מאגר הנתונים ואת מאגר האתר (${esc((Store.siteRepo() || { repo: 'PREMASTER' }).repo)}) — כך אפשר להיכנס מכל מכשיר עם שם וסיסמה.</li>
            <li>תחת Permissions ← Repository permissions ← Contents בחר <b>Read and write</b>.</li>
            <li>מומלץ שמאגר הנתונים יהיה <b>פרטי (Private)</b>.</li></ol></details>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${icon('link', 16)}<span>בדיקה וחיבור</span></button>
            <button class="btn btn-ghost" type="button" id="localMode">${icon('box', 16)}<span>${Store.cfg && Store.cfg.mode === 'github' ? 'חזרה' : 'המשך בלי גיטהאב'}</span></button>
          </div>
          <p class="form-msg" role="alert"></p>
        </form>
      </section>
    </div>`;
    const f = $('#setupForm');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      const cfg = { mode: 'github', owner: fd.owner.trim(), repo: fd.repo.trim(), branch: fd.branch.trim() || 'main', path: fd.path.trim() || 'data/procurement-db.json.gz', token: fd.token.trim() };
      const msg = $('.form-msg', f); const btn = $('button[type=submit]', f);
      btn.disabled = true; msg.className = 'form-msg'; msg.textContent = 'בודק חיבור…';
      try {
        const t = await Store.testConnection(cfg);
        await Store.connect(cfg);
        if (!t.private) UI.toast('שים לב: המאגר ציבורי — כל אחד יכול לקרוא את הנתונים. מומלץ להפוך אותו לפרטי.', 'error', 7000);
        Store.currentUser() ? renderShell() : renderAuth();
        afterConnect().catch(remoteErr);
      } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
    $('#localMode').addEventListener('click', async () => {
      if (!Store.cfg) await Store.connect({ mode: 'local' });
      Store.currentUser() ? renderShell() : renderAuth();
    });
  }

  /* ================= הרשמה וכניסה ================= */
  function renderAuth(mode) {
    const hasUsers = Store.db.users.some((u) => !u.deleted);
    const explicit = !!mode;
    mode = mode || (hasUsers ? 'login' : 'register');
    app.innerHTML = `
    <div class="gate">
      <section class="gate-art" aria-hidden="true">${fanSvg(340, true)}
        <div class="gate-caption"><b>מעקב הזמנות רכש</b><span>טבלת הזמנות, פרויקטים, דשבורד ו-BOM במקום אחד</span></div>
      </section>
      <section class="gate-form">
        <button class="icon-btn theme-btn gate-theme" type="button" data-theme-toggle aria-label="מצב כהה / בהיר">${icon(Theme.current() === 'dark' ? 'sun' : 'moon', 18)}</button>
        <form class="card form-card" id="authForm" autocomplete="on">
          <div class="seg" role="tablist">
            <button type="button" role="tab" data-m="login" class="${mode === 'login' ? 'on' : ''}">כניסה</button>
            <button type="button" role="tab" data-m="register" class="${mode === 'register' ? 'on' : ''}">הרשמה ראשונית</button>
          </div>
          <h1>${mode === 'login' ? 'כניסת עורכים' : 'יצירת משתמש עורך'}</h1>
          <p class="muted">${mode === 'login' ? 'היכנס עם השם והסיסמה שקבעת בהרשמה — מכל מכשיר.' : 'פעם אחת בלבד: שם, שם משפחה וסיסמה. אחרי זה נכנסים עם אותם פרטים מכל מכשיר.'}</p>
          <div class="grid2">
            <label class="field"><span>שם פרטי</span><input name="first" required autocomplete="given-name"></label>
            <label class="field"><span>שם משפחה</span><input name="last" required autocomplete="family-name"></label>
          </div>
          <label class="field"><span>סיסמה${mode === 'register' ? ' (לפחות 8 תווים)' : ''}</span><input name="pw" type="password" required ${mode === 'register' ? 'minlength="8"' : ''} autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
          ${mode === 'register' ? `<label class="field"><span>אימות סיסמה</span><input name="pw2" type="password" required minlength="8" autocomplete="new-password"></label>
            <label class="field" data-teamwrap hidden><span>קוד צוות (מקבלים ממנהל המערכת)</span><input name="team" type="password" autocomplete="off"></label>
            ${roleField(null)}
            ${notifyFields({ on: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' })}` : '<label class="chk"><input type="checkbox" name="remember" checked><span>להישאר מחובר במכשיר הזה</span></label>'}
          <div class="cloud-note" data-cloud hidden>${icon('cloud', 16)}<span></span></div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">${icon(mode === 'login' ? 'user' : 'plus', 16)}<span>${mode === 'login' ? 'כניסה' : 'הרשמה וכניסה'}</span></button></div>
          <p class="form-msg err" role="alert"></p>
          <button type="button" class="link-btn" id="toSetup">${icon('settings', 14)} הגדרות חיבור</button>
        </form>
      </section>
    </div>`;
    app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.m)));
    $('[data-theme-toggle]').addEventListener('click', (e) => Theme.toggle(e.currentTarget));
    $('#toSetup').addEventListener('click', () => renderSetup());
    const f = $('#authForm');
    // האם קיימת מערכת משותפת בענן? (ואז במכשיר הזה נכנסים איתה)
    let remote = null;
    const showCloud = (acc) => {
      remote = Store.cfg.mode === 'github' ? null : acc;
      const note = $('[data-cloud]', f);
      if (Store.cfg.mode === 'github') { note.hidden = false; $('span', note).textContent = 'מחובר לנתונים המשותפים. משתמשים ונתונים זהים בכל המכשירים.'; return; }
      if (!acc) return;
      // מכשיר חדש במערכת שכבר קיימת בענן: ברירת המחדל היא כניסה, לא הרשמה
      if (!explicit && mode === 'register' && !f.first.value) return renderAuth('login');
      note.hidden = false;
      $('span', note).textContent = mode === 'login' ? 'המערכת משותפת בענן: אחרי הכניסה המכשיר הזה יתחבר לנתונים של כולם.' : 'המערכת משותפת בענן: כדי להירשם ממכשיר חדש צריך קוד צוות.';
      const tw = $('[data-teamwrap]', f); if (tw) { tw.hidden = false; tw.querySelector('input').required = true; }
    };
    Store.fetchAccess().then(showCloud).catch(() => {});
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      const msg = $('.form-msg', f); const btn = $('button[type=submit]', f);
      btn.disabled = true; msg.className = 'form-msg'; msg.textContent = remote ? 'מתחבר לנתונים המשותפים…' : '';
      try {
        if (mode === 'register') {
          if (fd.pw !== fd.pw2) throw new Error('הסיסמאות אינן תואמות.');
          if (fd.pw.length < 8) throw new Error('הסיסמה צריכה להכיל לפחות 8 תווים.');
          if (remote) await Store.remoteJoin(fd.team || '');
          await Store.syncNow();
          const role = fd.role;
          if (!role) throw new Error('בחר תפקיד.');
          if (role === 'manager' && D.hasManager()) throw new Error('כבר קיים מנהל רכש במערכת. בחר תפקיד אחר — מנהל הרכש יוכל לשנות אותו.');
          const u = Store.register(fd.first, fd.last, fd.pw, { role, notify: readNotify(f) });
          await Store.syncNow();
          Store.login(fd.first, fd.last, fd.pw, true);
          S.pw = fd.pw;
          if (Store.remoteReady) Store.enableRemoteLogin(u, fd.pw).then(() => UI.toast('נרשמת. מעכשיו אפשר להיכנס עם השם והסיסמה מכל מכשיר.', 'ok', 5000)).catch(remoteErr);
        } else {
          if (remote) await Store.remoteLogin(fd.first, fd.last, fd.pw);
          else { await Store.syncNow(); Store.login(fd.first, fd.last, fd.pw, !!fd.remember); }
          S.pw = fd.pw;
          ensureRemoteLogin();
        }
        renderShell();
      } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }
  function remoteErr(e) {
    console.warn(e);
    UI.toast('הכניסה ממכשירים אחרים עדיין לא פעילה: ' + e.message, 'error', 9000);
  }
  /** משתמש שנכנס במכשיר מחובר ועוד אין לו כניסה מרחוק — מוסיפים לו */
  function ensureRemoteLogin() {
    const u = Store.currentUser();
    if (!Store.remoteReady || !u || !S.pw) return;
    Store.hasRemoteLogin(u).then((has) => { if (!has) return Store.enableRemoteLogin(u, S.pw); }).catch(remoteErr);
  }
  async function afterConnect() {
    const u = Store.currentUser();
    const canWrite = await Store.checkSiteWrite().catch(() => null);
    const sr = Store.siteRepo();
    if (canWrite === false) {
      UI.toast(`הנתונים מחוברים, אבל כדי שאפשר יהיה להיכנס מכל מכשיר עם שם וסיסמה, צריך להוסיף לטוקן גם את המאגר ${sr ? sr.repo : 'של האתר'} עם הרשאת Contents: Read and write.`, 'error', 12000);
      return;
    }
    if (u) {
      let pw = S.pw;
      if (!pw) {
        pw = await UI.prompt('כניסה מכל מכשיר', 'הזן את הסיסמה שלך כדי לאפשר כניסה עם שם וסיסמה ממכשירים אחרים', '', 'אישור');
        if (!pw) return;
        try { Store.login(u.first, u.last, pw, true); } catch (e) { return UI.toast(e.message, 'error'); }
      }
      await Store.enableRemoteLogin(u, pw).catch(remoteErr);
    }
    const acc = await Store.fetchAccess(true).catch(() => null);
    if (acc && !acc.team) await Store.setTeamCode(D.TEAM_CODE).catch(remoteErr);
  }
  /* ---------- שדות תפקיד והתראות ---------- */
  const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  function roleField(cur, allowManager) {
    const canMgr = allowManager != null ? allowManager : !D.hasManager();
    return `<fieldset class="role-pick"><legend>תפקיד</legend>${D.USER_ROLES.filter((r) => r.key !== 'manager' || canMgr || cur === 'manager').map((r) => `
      <label class="role-opt"><input type="radio" name="role" value="${r.key}" ${cur === r.key ? 'checked' : ''} required><span><b>${r.label}</b><em>${r.desc}</em></span></label>`).join('')}</fieldset>`;
  }
  function notifyFields(n) {
    n = Object.assign({ on: false, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' }, n || {});
    return `<fieldset class="notify-pick"><legend>תזכורת יומית על הזמנות בעיכוב</legend>
      <label class="chk"><input type="checkbox" name="nOn" ${n.on ? 'checked' : ''}><span>לשלוח לי התראה למחשב פעם ביום, בשעות הפעילות שלי</span></label>
      <div class="days">${DAYS.map((d, i) => `<label class="day"><input type="checkbox" name="nDay" value="${i}" ${n.days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
      <div class="hours"><label>משעה <input type="time" name="nFrom" value="${n.from}"></label><label>עד <input type="time" name="nTo" value="${n.to}"></label></div>
    </fieldset>`;
  }
  function readNotify(root) {
    return {
      on: !!root.querySelector('[name=nOn]')?.checked,
      days: [...root.querySelectorAll('[name=nDay]:checked')].map((x) => +x.value),
      from: root.querySelector('[name=nFrom]')?.value || '08:00',
      to: root.querySelector('[name=nTo]')?.value || '17:00',
    };
  }
  /** משתמש ותיק בלי תפקיד — בוחר פעם אחת */
  function ensureRole() {
    const u = Store.currentUser(); if (!u) return;
    // עוד אין מנהל רכש במערכת — מי שנכנס (המשתמש הראשון בפועל) מקבל את התפקיד אוטומטית
    if (!D.hasManager()) {
      Store.updateUser(u.id, { role: 'manager' });
      UI.toast('הוגדרת כמנהל רכש — אפשר לשנות תפקידים בתפריט "משתמשים ותפקידים".', 'ok', 6000);
      return renderShell();
    }
    if (u.role) return;
    const users = Store.db.users.filter((x) => !x.deleted).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const first = users[0] && users[0].id === u.id;
    const body = document.createElement('div');
    body.innerHTML = `<p class="muted">כל משתמש מקבל תפקיד, והתפקיד קובע אילו עמודות הוא יכול לערוך.</p>${roleField(first && !D.hasManager() ? 'manager' : null, !D.hasManager())}`;
    const m = UI.modal({
      title: 'מה התפקיד שלך?', body,
      actions: [{ label: 'שמירה', primary: true, icon: 'check', action: (el) => {
        const r = el.querySelector('[name=role]:checked'); if (!r) throw new Error('בחר תפקיד.');
        if (r.value === 'manager' && D.hasManager()) throw new Error('כבר קיים מנהל רכש.');
        Store.updateUser(u.id, { role: r.value }); renderShell();
      } }],
    });
    m.el.querySelector('[data-x]').remove();
    m.el.classList.add('locked'); // אי אפשר לסגור בלי לבחור תפקיד
  }

  /** מכשיר מחובר שבו למשתמש עוד אין כניסה מכל מכשיר (למשל אחרי חיבור בקישור) — משלימים פעם אחת */
  let remoteChecked = false;
  async function checkRemoteSetup() {
    if (remoteChecked) return; remoteChecked = true;
    const u = Store.currentUser(); if (!u) return;
    if (S.pw) return ensureRemoteLogin();
    const has = await Store.hasRemoteLogin(u).catch(() => true);
    if (!has) await afterConnect().catch(remoteErr);
    else { const acc = await Store.fetchAccess().catch(() => null); if (acc && !acc.team && u.role === 'manager') await Store.setTeamCode(D.TEAM_CODE).catch(remoteErr); }
  }
  async function teamCodeDialog(first) {
    const code = await UI.prompt('קוד צוות', `קוד הצוות הנוכחי הוא ${D.TEAM_CODE} כברירת מחדל. עורכים חדשים מזינים אותו פעם אחת בהרשמה ממכשיר חדש. לפחות 4 תווים.`, '', 'שמירת קוד');
    if (!code) return;
    try { await Store.setTeamCode(code); UI.toast('קוד הצוות נשמר. שתף אותו רק עם עורכים מורשים.', 'ok', 5000); }
    catch (e) { UI.toast(e.message, 'error', 7000); }
  }

  /* ================= מעטפת ================= */
  function renderShell() {
    const u = Store.currentUser();
    try { const saved = JSON.parse(sessionStorage.getItem('pt.route')); if (saved) S.route = saved; } catch { }
    app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">${fanSvg(26)}<div><b>מעקב הזמנות</b><span>רכש · ${esc(D.roleLabel(u.role))}</span></div></div>
        <nav class="tabs" id="tabs" role="tablist" aria-label="לשוניות"></nav>
        <div class="top-actions">
          <button class="icon-btn theme-btn" id="themeBtn" type="button" aria-label="מצב כהה / בהיר" title="מצב כהה / בהיר">${icon(Theme.current() === 'dark' ? 'sun' : 'moon', 18)}</button>
          <button class="icon-btn theme-btn" id="installBtn" type="button" hidden aria-label="התקנה כאפליקציה" title="התקנה כאפליקציה במחשב">${icon('download', 18)}</button>
          <button class="sync-pill" id="syncPill" type="button" title="סנכרון"></button>
          <button class="user-btn" id="userBtn" type="button"><span class="avatar">${esc((u.first[0] || '') + (u.last[0] || ''))}</span><span class="uname">${esc(u.first + ' ' + u.last)}</span>${icon('chevron', 14)}</button>
        </div>
      </header>
      <main class="main" id="main"></main>
      <footer class="statusbar" id="statusbar"></footer>
    </div>
    <div class="drop-zone" id="dropZone" hidden><div class="dz-card">${fanSvg(72)}<b>שחרר כדי לייבא</b><span>קובץ אקסל או CSV</span></div></div>`;
    $('#userBtn').addEventListener('click', (e) => userMenu(e.currentTarget));
    $('#syncPill').addEventListener('click', () => Store.syncNow());
    $('#themeBtn').addEventListener('click', (e) => Theme.toggle(e.currentTarget));
    D.ensureBomSchema();
    D.syncProjects();
    renderTabs();
    renderMain();
    updateSync();
    bindDrop();
    if (Store.remoteReady) setTimeout(checkRemoteSetup, 900);
    $('#installBtn').addEventListener('click', () => PWA.install()); PWA.sync();
    D.ensureMapping();
    ensureRole();
    Notifier.start();
    if (location.hash === '#delayed') { history.replaceState(null, '', location.pathname + location.search); setTimeout(openDelayed, 300); }
  }
  const FIXED = ['home', 'main', 'bom'];
  const DEFAULT_SUB = { home: 'home', main: 'orders', bom: 'bomtable' };
  function go(tab, sub) {
    S.route = { tab, sub: sub || DEFAULT_SUB[tab] || (S.route.tab === tab ? S.route.sub : 'dashboard') };
    S.catFilter = null;
    sessionStorage.setItem('pt.route', JSON.stringify(S.route));
    renderTabs(); renderMain();
  }
  function currentProject() { return FIXED.includes(S.route.tab) ? null : Store.projects().find((p) => p.id === S.route.tab); }

  function renderTabs() {
    const el = $('#tabs'); if (!el) return;
    const projects = Store.projects();
    const t = S.route.tab;
    let h = `<button class="tab ${t === 'home' ? 'on' : ''}" data-tab="home" role="tab">${icon('chart', 15)}<span>דשבורד משולב</span></button>
      <button class="tab ${t === 'main' ? 'on' : ''}" data-tab="main" role="tab">${icon('table', 15)}<span>הזמנות</span><em>${fmtN(Store.rows('orders').length)}</em></button>
      <button class="tab ${t === 'bom' ? 'on' : ''}" data-tab="bom" role="tab">${icon('layers', 15)}<span>BOM</span><em>${fmtN(Store.rows('bom').length)}</em></button>
      <span class="tab-sep" aria-hidden="true"></span>`;
    for (const p of projects) {
      const n = D.projectRows(p).length;
      const locked = !Store.isUnlocked(p.id);
      h += `<button class="tab ${t === p.id ? 'on' : ''}${S.newTabs.has(p.id) ? ' pop' : ''}" data-tab="${p.id}" role="tab" style="--pc:${p.color}"><i class="pdot"></i><span>${esc(p.name)}</span>${locked ? `<span class="lock" title="נעול">${icon('lock', 12)}</span>` : `<em>${fmtN(n)}</em>`}</button>`;
    }
    h += `<button class="tab tab-add" id="addProject" title="פרויקט חדש" aria-label="פרויקט חדש">${icon('plus', 16)}</button>`;
    el.innerHTML = h;
    el.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => go(b.dataset.tab));
      if (!FIXED.includes(b.dataset.tab)) b.addEventListener('contextmenu', (e) => { e.preventDefault(); projectMenu(b.dataset.tab, e.clientX, e.clientY); });
    });
    $('#addProject').addEventListener('click', addProjectFlow);
    if (!D.canTabs()) $('#addProject').hidden = true;
    setTimeout(() => S.newTabs.clear(), 1200);
    const on = el.querySelector('.tab.on'); on && on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  async function addProjectFlow() {
    const name = await UI.prompt('פרויקט חדש', 'שם הפרויקט (כפי שהוא מופיע בעמודת הפרויקט בטבלה)', '', 'יצירה');
    if (!name) return;
    try {
      const p = D.addProject(name);
      Store.unlock(p.id);
      S.newTabs.add(p.id);
      if (!D.mapping().project) UI.toast('כדי לשייך שורות לפרויקט, הגדר איזו עמודה היא "פרויקט" בהגדרות העמודות.', 'info', 6000);
      else UI.toast('הלשונית תתמלא אוטומטית בהזמנות שבעמודת הפרויקט כתוב בהן השם שלה.', 'info', 5000);
      go(p.id, 'dashboard');
    } catch (e) { UI.toast(e.message, 'error'); }
  }
  function projectMenu(pid, x, y) {
    if (!D.canTabs()) return;
    const p = Store.projects().find((q) => q.id === pid); if (!p) return;
    if (D.isCore(p)) return UI.menu(x, y, [
      { title: p.name + ' · לשונית מרכזית' },
      { label: 'החלפת צבע', icon: 'layers', action: () => { const i = D.PROJECT_COLORS.indexOf(p.color); p.color = D.PROJECT_COLORS[(i + 1) % D.PROJECT_COLORS.length]; Store.touch(p); Store.commit(); renderTabs(); } },
    ]);
    UI.menu(x, y, [
      { title: p.name },
      { label: 'שינוי שם…', icon: 'edit', action: () => renameProject(p) },
      { label: 'החלפת צבע', icon: 'layers', action: () => { const i = D.PROJECT_COLORS.indexOf(p.color); p.color = D.PROJECT_COLORS[(i + 1) % D.PROJECT_COLORS.length]; Store.touch(p); Store.commit(); renderTabs(); } },
      { label: 'הזזה ימינה', icon: 'chevron', action: () => moveProject(p, -1) },
      { label: 'הזזה שמאלה', icon: 'chevron', action: () => moveProject(p, 1) },
      { sep: true },
      { label: 'הסרת הלשונית', icon: 'trash', danger: true, action: async () => { if (!(await UI.confirm('הסרת הלשונית', `הלשונית "${p.name}" תוסר. ההזמנות עצמן נשארות בטבלה הראשית.`, 'הסרה', true))) return; p.deleted = true; Store.touch(p); Store.commit(); go('home'); } },
    ]);
  }
  function moveProject(p, d) {
    const list = Store.projects(); const i = list.indexOf(p); const j = i + d;
    if (j < 0 || j >= list.length) return;
    list.splice(i, 1); list.splice(j, 0, p);
    list.forEach((q, k) => { if (q.order !== k) { q.order = k; Store.touch(q); } });
    Store.commit(); renderTabs();
  }
  async function renameProject(p) {
    const name = await UI.prompt('שינוי שם פרויקט', 'שם חדש ללשונית. השם יתעדכן גם בכל ההזמנות של הפרויקט.', p.name);
    if (!name || name === p.name) return;
    if (Store.projects().some((q) => q !== p && D.norm(q.name) === D.norm(name))) return UI.toast('כבר קיים פרויקט בשם הזה.', 'error');
    const n = D.renameProject(p, name);
    renderTabs(); renderMain();
    UI.toast(`שם הפרויקט עודכן${n ? ` ב-${n} הזמנות` : ''}.`, 'ok', 4500);
  }
  /** אחרי כל שינוי בהזמנות: יישור הלשוניות לעמודת הפרויקט */
  function afterOrdersChange() {
    const before = currentProject();
    const r = D.syncProjects();
    r.created.forEach((x) => S.newTabs.add(x.id));
    if (r.created.length) UI.toast(`נפתחה לשונית חדשה: ${r.created.map((x) => x.name).join(', ')}`, 'ok');
    renderTabs();
    if (!r.changed) return;
    if (!FIXED.includes(S.route.tab) && !currentProject()) { UI.toast('הפרויקט כבר לא מופיע בטבלה, לכן הלשונית שלו הוסרה.', 'info', 5000); return go('main'); }
    if (before) { const h = $('.vh-title h1'); if (h) h.textContent = before.name; }
    S.grid && S.grid.refresh(true);
  }

  function userMenu(btn) {
    const r = btn.getBoundingClientRect();
    const u = Store.currentUser();
    const mgr = u.role === 'manager';
    const gh = Store.cfg.mode === 'github';
    UI.menu(r.right, r.bottom + 6, [
      { title: `${u.first} ${u.last} · ${D.roleLabel(u.role)}` },
      { label: 'הגדרות אישיות והתראות…', icon: 'settings', action: personalDialog },
      PWA.canInstall() ? { label: 'התקנה כאפליקציה במחשב', icon: 'download', action: () => PWA.install() } : { label: 'התקנה כאפליקציה במחשב…', icon: 'download', action: () => PWA.install() },
      mgr ? { sep: true } : null,
      mgr ? { title: 'ניהול' } : null,
      mgr ? { label: 'משתמשים ותפקידים…', icon: 'user', action: usersDialog } : { label: 'עורכים רשומים', icon: 'user', action: usersDialog },
      mgr ? { label: 'הרשאות עריכה לפי תפקיד…', icon: 'lock', action: permsDialog } : null,
      mgr && gh ? { label: 'שינוי קוד צוות…', icon: 'lock', action: () => teamCodeDialog(false) } : null,
      mgr && gh ? { label: 'קישור חיבור למכשיר נוסף', icon: 'link', action: shareLink } : null,
      mgr ? { label: 'הגדרות סנכרון', icon: 'cloud', action: () => renderSetup() } : null,
      mgr ? { label: 'גיבוי נתונים (JSON)', icon: 'download', action: () => download(new Blob([Store.exportJson()], { type: 'application/json' }), `procurement-backup-${D.today()}.json`) } : null,
      mgr ? { label: 'שחזור מגיבוי…', icon: 'upload', action: () => pickFile('.json', async (f) => { Store.importJson(await f.text()); renderTabs(); renderMain(); UI.toast('הגיבוי מוזג לנתונים', 'ok'); }) } : null,
      { sep: true },
      { label: `גרסה ${window.APP_VERSION || ''} · רענון`, icon: 'refresh', action: () => location.reload() },
      { label: 'יציאה', icon: 'logout', action: () => { Store.logout(); renderAuth('login'); } },
    ]);
  }
  function usersDialog() {
    const me = Store.currentUser();
    const mgr = me.role === 'manager';
    const users = Store.db.users.filter((u) => !u.deleted).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const body = document.createElement('div');
    body.innerHTML = `${mgr ? '<p class="muted">שינוי תפקיד נכנס לתוקף מיד בכל המכשירים.</p>' : ''}
      <table class="mini-table users-t"><thead><tr><th>שם</th><th>תפקיד</th><th>נרשם</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.first + ' ' + u.last)}${u.id === me.id ? ' <em class="muted">(אני)</em>' : ''}</td>
        <td>${mgr && u.id !== me.id ? `<select data-u="${u.id}">${D.USER_ROLES.map((r) => `<option value="${r.key}" ${u.role === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}${u.role ? '' : '<option value="" selected>ללא תפקיד</option>'}</select>` : esc(D.roleLabel(u.role))}</td>
        <td>${new Date(u.createdAt).toLocaleDateString('he-IL')}</td></tr>`).join('')}</tbody></table>`;
    UI.modal({
      title: mgr ? 'משתמשים ותפקידים' : 'עורכים רשומים', body, wide: mgr,
      actions: mgr ? [{ label: 'ביטול' }, { label: 'שמירה', primary: true, icon: 'check', action: () => {
        body.querySelectorAll('select[data-u]').forEach((sel) => { const u = users.find((x) => x.id === sel.dataset.u); if (u && sel.value && u.role !== sel.value) Store.updateUser(u.id, { role: sel.value }); });
        renderMain(false); UI.toast('התפקידים עודכנו', 'ok');
      } }] : [{ label: 'סגירה' }],
    });
  }
  /** מנהל רכש קובע לכל תפקיד: אילו עמודות מותר לערוך ואילו פעולות */
  function permsDialog() {
    const cols = Store.columns('orders');
    const roles = D.USER_ROLES.filter((r) => r.key !== 'manager');
    const body = document.createElement('div');
    body.className = 'perms-dlg';
    const cell = (r, c) => { const set = D.editableCols(r.key); return `<td><input type="checkbox" data-r="${r.key}" data-c="${c.id}" ${!set || set.has(c.id) ? 'checked' : ''} aria-label="${esc(r.label)} · ${esc(c.name)}"></td>`; };
    body.innerHTML = `<p class="muted">סמן אילו עמודות כל תפקיד יכול לערוך. מנהל רכש תמיד עורך הכול. ${D.perms('buyer').own ? 'קניין יכול לערוך את כל העמודות בהזמנות שהוא עצמו הוסיף.' : ''}</p>
      <div class="table-wrap"><table class="mini-table perms-t"><thead><tr><th>עמודה</th>${roles.map((r) => `<th>${r.label}</th>`).join('')}</tr></thead><tbody>
      ${cols.map((c) => `<tr><td>${esc(c.name)}${D.roleOf(c.id) ? ` <em class="muted">· ${esc(D.roleOf(c.id))}</em>` : ''}</td>${roles.map((r) => cell(r, c)).join('')}</tr>`).join('')}
      <tr class="sep"><td colspan="${roles.length + 1}">פעולות</td></tr>
      ${D.CAPS.map(([k, l]) => `<tr><td>${l}</td>${roles.map((r) => `<td><input type="checkbox" data-r="${r.key}" data-cap="${k}" ${D.perms(r.key)[k] ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
      <tr><td>קניין: עריכה מלאה של הזמנות שהוסיף</td>${roles.map((r) => `<td>${r.key === 'buyer' ? `<input type="checkbox" data-r="buyer" data-cap="own" ${D.perms('buyer').own ? 'checked' : ''}>` : ''}</td>`).join('')}</tr>
      </tbody></table></div>`;
    UI.modal({
      title: 'הרשאות עריכה לפי תפקיד', body, wide: true,
      actions: [
        { label: 'החזרה לברירת מחדל', action: () => { Store.db.settings.perms = {}; Store.db.settings.updatedAt = Store.now(); Store.commit(); renderMain(false); UI.toast('ההרשאות הוחזרו לברירת המחדל', 'ok'); } },
        { label: 'שמירה', primary: true, icon: 'check', action: () => {
          const perms = {};
          for (const r of roles) {
            const colsOn = [...body.querySelectorAll(`[data-r="${r.key}"][data-c]`)];
            const p = { cols: colsOn.every((x) => x.checked) ? 'all' : colsOn.filter((x) => x.checked).map((x) => x.dataset.c) };
            body.querySelectorAll(`[data-r="${r.key}"][data-cap]`).forEach((x) => (p[x.dataset.cap] = x.checked));
            perms[r.key] = p;
          }
          Store.db.settings.perms = perms; Store.db.settings.updatedAt = Store.now(); Store.commit();
          renderMain(false); UI.toast('ההרשאות נשמרו ונכנסות לתוקף בכל המכשירים', 'ok');
        } },
      ],
    });
  }
  function personalDialog() {
    const u = Store.currentUser();
    const body = document.createElement('div');
    body.innerHTML = `<p class="muted">התפקיד שלך: <b>${esc(D.roleLabel(u.role))}</b></p>${notifyFields(u.notify)}
      <p class="muted sm-note" data-perm></p>`;
    const permEl = body.querySelector('[data-perm]');
    const showPerm = () => { permEl.textContent = !('Notification' in window) ? 'הדפדפן הזה לא תומך בהתראות.' : Notification.permission === 'granted' ? 'התראות מאושרות במכשיר הזה.' : Notification.permission === 'denied' ? 'ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות האתר (סמל המנעול ליד הכתובת).' : 'בשמירה הדפדפן יבקש אישור להציג התראות.'; };
    showPerm();
    UI.modal({
      title: 'הגדרות אישיות', body, wide: false,
      actions: [
        { label: 'שליחת התראת בדיקה', icon: 'alert', action: async () => { await Notifier.permit(); await Notifier.check(true); showPerm(); return false; } },
        { label: 'שמירה', primary: true, icon: 'check', action: async () => {
          const n = readNotify(body);
          Store.updateUser(u.id, { notify: n });
          if (n.on) await Notifier.permit();
          Notifier.start();
          UI.toast(n.on ? `התזכורת נקבעה: ${n.days.map((d) => DAYS[d]).join(', ')} בין ${n.from} ל-${n.to}` : 'התזכורת היומית כבויה', 'ok', 5000);
        } },
      ],
    });
  }
  function shareLink() {
    const c = Store.cfg;
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ owner: c.owner, repo: c.repo, branch: c.branch, path: c.path, token: c.token }))));
    const link = location.origin + location.pathname + '#connect=' + encodeURIComponent(payload);
    UI.modal({
      title: 'חיבור מכשיר נוסף',
      body: `<p class="muted">פתיחת הקישור במכשיר אחר מחברת אותו לאותו מאגר נתונים. הקישור כולל את טוקן הגישה — שלח אותו רק לעורכים מורשים ובערוץ פרטי.</p>
        <label class="field"><span>קישור</span><input type="text" readonly value="${esc(link)}" dir="ltr"></label>`,
      actions: [{ label: 'סגירה' }, { label: 'העתקת הקישור', primary: true, icon: 'copy', action: async () => { await navigator.clipboard.writeText(link); UI.toast('הקישור הועתק', 'ok'); } }],
    });
  }


  /* ================= סנכרון ================= */
  function updateSync() {
    const el = $('#syncPill'); if (!el) return;
    const s = Store.status;
    const map = { synced: ['cloud', 'מסונכרן'], saving: ['refresh', 'שומר…'], offline: ['cloudOff', 'לא מקוון'], error: ['alert', 'שגיאת סנכרון'], local: ['check', 'נשמר'], idle: ['cloud', ''] };
    const [ic, txt] = map[s.status] || map.idle;
    el.className = 'sync-pill s-' + s.status;
    document.body.classList.toggle('syncing', s.status === 'saving');
    el.innerHTML = icon(ic, 15) + `<span>${txt}</span>`;
    el.title = s.message + (s.lastSync ? ` · עדכון אחרון ${new Date(s.lastSync).toLocaleTimeString('he-IL')}` : '');
  }
  let lastErr = '';
  Store.on((type, d) => {
    if (type === 'status') { updateSync(); if (d.status === 'error' && d.message !== lastErr) { lastErr = d.message; UI.toast(d.message, 'error', 6000); } if (d.status === 'synced') lastErr = ''; }
    if (type === 'remote') onRemote();
  });
  function onRemote() {
    if (!$('#main')) return;
    if (!Store.currentUser()) return;
    D.syncProjects();
    renderTabs();
    if (!FIXED.includes(S.route.tab) && !currentProject()) return go('home');
    if (S.grid && isGridView()) { S.grid.refresh(true, true); renderQuick(); if (S.route.sub === 'bom' || S.route.sub === 'bomtable') renderBomSummary(); }
    else renderMain(false);
  }

  /* ================= אזור ראשי ================= */
  function renderMain(anim = true) {
    const main = $('#main'); if (!main) return;
    if (S.grid) { S.grid.destroy(); S.grid = null; }
    const p = currentProject();
    if (!FIXED.includes(S.route.tab) && !p) { S.route = { tab: 'home', sub: 'home' }; return renderMain(anim); }
    if (p && !Store.isUnlocked(p.id)) return renderLock(main, p);
    const SUBS = {
      home: [],
      main: [['orders', 'table', 'טבלת הזמנות'], ['odash', 'chart', 'דשבורד הזמנות']],
      bom: [['bomtable', 'table', 'טבלת BOM'], ['bdash', 'chart', 'דשבורד BOM']],
    };
    const subs = p ? [['dashboard', 'chart', 'דשבורד משולב'], ['orders', 'table', 'הזמנות'], ['bom', 'layers', 'BOM']] : SUBS[S.route.tab];
    if (subs.length && !subs.some((x) => x[0] === S.route.sub)) S.route.sub = subs[0][0];
    if (!subs.length) S.route.sub = 'home';
    const TITLES = { home: 'דשבורד משולב', main: 'הזמנות', bom: 'BOM' };
    main.innerHTML = `
      <div class="view-head">
        <div class="vh-title">${p ? `<i class="pdot lg" style="--pc:${p.color}"></i><h1>${esc(p.name)}</h1>` : `<h1>${TITLES[S.route.tab]}</h1>`}</div>
        ${subs.length ? `<div class="seg sub" role="tablist">${subs.map(([k, ic, l]) => `<button type="button" role="tab" data-sub="${k}" class="${S.route.sub === k ? 'on' : ''}">${icon(ic, 15)}<span>${l}</span></button>`).join('')}</div>` : ''}
      </div>
      <div class="view${anim ? ' enter' : ' static'}" id="view"></div>`;
    main.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => go(S.route.tab, b.dataset.sub)));
    const v = $('#view');
    const sub = S.route.sub;
    if (sub === 'orders') renderOrders(v, p);
    else if (sub === 'odash') renderOrdersDash(v);
    else if (sub === 'bomtable') renderBom(v, null);
    else if (sub === 'bom') renderBom(v, p);
    else if (sub === 'bdash') renderBomDash(v);
    else if (sub === 'dashboard') renderDashboard(v, p);
    else renderHome(v);
    if (!isGridView()) setStatus('');
    countUp(v, anim);
  }
  const isGridView = () => ['orders', 'bom', 'bomtable'].includes(S.route.sub);

  function renderLock(main, p) {
    main.innerHTML = `<div class="lock-screen"><form class="card form-card narrow" id="lockForm">
      <div class="lock-ic" style="--pc:${p.color}">${icon('lock', 26)}</div>
      <h1>${esc(p.name)}</h1><p class="muted">הלשונית מוגנת בסיסמה.</p>
      <label class="field"><span>סיסמת הלשונית</span><input type="password" name="pw" required autocomplete="off"></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('lock', 16)}<span>פתיחת הלשונית</span></button></div>
      <p class="form-msg err" role="alert"></p></form></div>`;
    const f = $('#lockForm');
    setTimeout(() => f.pw.focus(), 50);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (D.norm(f.pw.value) === D.norm(D.TAB_PASSWORD)) { Store.unlock(p.id); renderTabs(); renderMain(); }
      else { $('.form-msg', f).textContent = 'הסיסמה שגויה.'; f.pw.select(); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
    });
    setStatus('');
  }

  /* ================= טבלת הזמנות ================= */
  function renderOrders(v, p) {
    const m = D.mapping();
    const hasCols = Store.columns('orders').length > 0;
    v.innerHTML = `
      <div class="toolbar">
        <label class="search">${icon('search', 15)}<input type="search" id="q" placeholder="חיפוש בכל העמודות…" aria-label="חיפוש"></label>
        <div class="tb-group">
          <button class="btn btn-soft" id="addRow">${icon('plus', 16)}<span>שורה</span></button>
          <button class="btn btn-soft" id="imp">${icon('upload', 16)}<span>ייבוא אקסל</span></button>
          <button class="btn btn-soft" id="exp">${icon('download', 16)}<span>ייצוא</span></button>
        </div>
        <div class="tb-group">
          <button class="icon-btn" id="undo" title="ביטול (Ctrl+Z)" aria-label="ביטול">${icon('undo', 17)}</button>
          <button class="icon-btn" id="redo" title="חזרה (Ctrl+Y)" aria-label="חזרה">${icon('redo', 17)}</button>
        </div>
        ${moreButton()}
        <div class="more-tools" id="moreTools" ${S.moreOpen ? '' : 'hidden'}>
          <div class="tb-group mt-i" style="--i:0">
            <button class="icon-btn" id="bulk" title="הזנת ערך לכל המסומנים (Ctrl+Enter)" aria-label="הזנה מרובה">${icon('wand', 17)}</button>
            <button class="icon-btn" id="del" title="מחיקת שורות מסומנות" aria-label="מחיקת שורות">${icon('trash', 17)}</button>
            <button class="btn btn-ghost danger-ghost" id="clearTbl" title="מחיקת כל השורות בטבלה">${icon('trash', 16)}<span>מחיקת הטבלה</span></button>
          </div>
          ${viewControls(1)}
          <div class="tb-group mt-i" style="--i:3">
            <button class="btn btn-ghost" id="colsBtn">${icon('columns', 16)}<span>עמודות</span></button>
            <button class="btn btn-ghost" id="statusBtn">${icon('check', 16)}<span>סטטוסים</span></button>
            <button class="icon-btn" id="density" title="צפיפות שורות" aria-label="צפיפות">${icon('height', 17)}</button>
          </div>
        </div>
        <div class="chips" id="chips"></div>
      </div>
      <div class="quick" id="quick" role="toolbar" aria-label="סינון מהיר לפי מצב"></div>
      <div class="grid-area" id="gridArea"></div>`;
    const area = $('#gridArea');
    if (!hasCols) {
      area.innerHTML = `<div class="empty-state">${fanSvg(90)}<h2>מתחילים מקובץ האקסל</h2><p>ייבא את קובץ מעקב ההזמנות — בכפתור או בגרירת הקובץ לכאן. כותרות העמודות ייקלטו כמו שהן, המערכת תזהה לבד את עמודות הפרויקט, הסטטוס, המק"ט ותאריך האספקה, ותפתח לשונית לכל פרויקט.</p>
        <div class="form-actions center"><button class="btn btn-primary" id="imp2">${icon('upload', 16)}<span>ייבוא קובץ אקסל</span></button><button class="btn btn-ghost" id="blank">${icon('table', 16)}<span>טבלה ריקה</span></button></div></div>`;
      $('#imp2').onclick = () => importFlow('orders', p);
      $('#blank').onclick = () => { createDefaultColumns(); renderMain(); };
      $('#imp').onclick = () => importFlow('orders', p);
      ['addRow', 'exp', 'undo', 'redo', 'bulk', 'del', 'colsBtn', 'statusBtn', 'density'].forEach((id) => ($('#' + id).disabled = true));
      return;
    }
    const g = new Grid(area, {
      dataset: 'orders',
      label: p ? 'הזמנות ' + p.name : 'כל ההזמנות',
      rowHeight, wrap: () => S.wrap, onZoom: zoomChanged, cellFont: () => S.view, noFreeze: (c) => D.noFreeze(c), onSearch: () => renderChips(),
      filter: (row) => (!p || D.inProject(row, p)) && (!S.catFilter || catMatch(row, S.catFilter)),
      defaults: () => (p && m.project ? { [m.project]: p.name } : {}),
      colRole: (id) => D.roleOf(id),
      readOnly: (col, row) => !D.canEditCell(col, row),
      colLocked: (col) => !D.canEditCell(col, null),
      canAdd: () => D.can('add'), canDel: () => D.can('del'), canAdmin: () => D.can('admin'),
      decorate: decorateOrder(p),
      onStats: (s) => setStatus(statsText(s)),
      onChange: () => { afterOrdersChange(); renderQuick(); },
      onFilter: () => renderChips(),
      columnMenuExtra: (col) => [{ label: 'תפקיד העמודה…', icon: 'link', action: () => columnsDialog(col.id) }],
      emptyHtml: p
        ? `<div><b>אין עדיין הזמנות בפרויקט ${esc(p.name)}</b><p>${m.project ? `שורות שבעמודת "${esc(colName(m.project))}" כתוב בהן "${esc(p.name)}" יופיעו כאן אוטומטית. אפשר גם להוסיף שורה חדשה.` : 'עוד לא הוגדרה עמודת פרויקט. פתח "עמודות" וסמן איזו עמודה מציינת את הפרויקט.'}</p></div>`
        : '<div><b>אין הזמנות</b><p>הוסף שורה או ייבא קובץ אקסל.</p></div>',
    });
    applyCaps({ addRow: 'add', imp: 'import', del: 'del', clearTbl: 'admin', colsBtn: 'admin', statusBtn: 'admin' });
    $('#clearTbl').onclick = () => clearTableDialog('orders', p);
    S.quickProject = p;
    renderQuick();
    S.grid = g;
    bindViewControls(g);
    $('#q').addEventListener('input', debounce((e) => g.setSearch(e.target.value), 180));
    $('#addRow').onclick = () => { g.appendRows(1); g.focus(); };
    $('#imp').onclick = () => importFlow('orders', p);
    $('#exp').onclick = () => exportGrid(g, p ? p.name : 'כל ההזמנות');
    $('#undo').onclick = () => g.undo();
    $('#redo').onclick = () => g.redo();
    $('#bulk').onclick = () => g.bulkValueDialog();
    $('#del').onclick = () => g.deleteSelectedRows();
    $('#colsBtn').onclick = () => columnsDialog();
    $('#statusBtn').onclick = () => statusDialog();
    $('#density').onclick = (e) => densityMenu(e.currentTarget);
    renderChips();
    g.focus();
  }
  function decorateOrder(p) {
    return (row, col, v, txt) => {
      const m = D.mapping();
      if (col.id === m.status) { const c = D.cat(row); return { cls: 'has-chip', html: txt ? `<span class="chip c-${c}">${esc(txt)}</span>` : (c === 'delayed' ? `<span class="chip c-delayed">באיחור</span>` : '') }; }
      if ((col.id === m.due || /delivery\s*date/i.test(col.name)) && D.isSpecialDate(v)) return { cls: 'd-special' };
      if (col.id === m.due && D.isOverdue(row)) return { cls: 'overdue' };
      if (col.id === m.qtySupplied) { const st = D.supplyState(row); return { cls: st ? 'qs qs-' + st : '', html: txt === '' ? '0' : null }; }
      if (!p && col.id === m.project && txt) { const pc = D.projectColor(txt); if (pc) return { html: `<span class="ptag" style="--pc:${pc}"><i class="pdot"></i>${esc(txt)}</span>` }; }
      return null;
    };
  }
  const colName = (id) => (Store.columns('orders').find((c) => c.id === id) || {}).name || '';
  function catMatch(row, f) {
    const c = D.cat(row);
    if (f === 'notDone') return c === 'open' || c === 'delayed';
    if (f === 'new') { const m = D.mapping(); const since = Store.now() - S.newDays * 864e5; return m.orderDate && row.c[m.orderDate] ? String(row.c[m.orderDate]) >= new Date(since).toISOString().slice(0, 10) : !row.imp && (row.createdAt || 0) >= since; }
    if (f === 'all') return true;
    return c === f;
  }
  const CF_LABEL = { notDone: 'פתוחות', supplied: 'סופקו', closed: 'סגורות', delayed: 'בעיכוב / דורש טיפול', new: 'חדשות', open: 'פתוחות בזמן', all: 'הכול' };
  /** סרגל סינון מהיר לפי מצב ההזמנה, עם ספירה חיה */
  function renderQuick() {
    const el = $('#quick'); if (!el) return;
    const p = S.quickProject;
    const rows = p ? D.projectRows(p) : Store.rows('orders');
    const s = D.stats(rows, S.newDays);
    const items = [[null, 'הכול', s.total, ''], ['notDone', 'פתוחות', s.notDone, 'open'], ['delayed', 'בעיכוב', s.delayed, 'delayed'], ['supplied', 'סופקו', s.supplied, 'supplied'], ['closed', 'סגורות', s.closed, 'closed'], ['new', `חדשות (${S.newDays} ימים)`, s.newer, '']];
    el.innerHTML = items.map(([k, l, n, c]) => `<button type="button" class="qf${(S.catFilter || null) === k ? ' on' : ''}" data-q="${k || ''}">${c ? `<i class="sw c-${c}"></i>` : ''}<span>${l}</span><b>${fmtN(n)}</b></button>`).join('');
    el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { S.catFilter = b.dataset.q || null; S.grid && S.grid.refresh(); renderChips(); renderQuick(); }));
  }
  function renderChips() {
    const el = $('#chips'); if (!el || !S.grid) return;
    const g = S.grid; let h = '';
    if (S.catFilter) h += `<button class="fchip" data-cf>${esc(CF_LABEL[S.catFilter])} ${icon('x', 12)}</button>`;
    for (const [cid, q] of Object.entries(g.colSearch || {})) { const c = g.allCols.find((x) => x.id === cid); if (c) h += `<button class="fchip" data-cs="${cid}">${icon('search', 12)} ${esc(c.name)}: ${esc(q)} ${icon('x', 12)}</button>`; }
    for (const cid of Object.keys(g.filters)) { const c = g.allCols.find((x) => x.id === cid); if (c) h += `<button class="fchip" data-f="${cid}">${icon('filter', 12)} ${esc(c.name)} ${icon('x', 12)}</button>`; }
    if (g.sort) { const c = g.allCols.find((x) => x.id === g.sort.colId); if (c) h += `<button class="fchip" data-s>${icon(g.sort.dir > 0 ? 'sortAsc' : 'sortDesc', 12)} ${esc(c.name)} ${icon('x', 12)}</button>`; }
    el.innerHTML = h;
    el.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => { S.catFilter = null; g.refresh(); renderChips(); renderQuick(); }));
    el.querySelectorAll('[data-cs]').forEach((b) => (b.onclick = () => { delete g.colSearch[b.dataset.cs]; g.refresh(); renderChips(); }));
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { delete g.filters[b.dataset.f]; g.refresh(); renderChips(); }));
    el.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { g.setSort(null, 0); renderChips(); }));
  }
  function densityMenu(btn) {
    const r = btn.getBoundingClientRect();
    const set = (k) => { S.density = k; localStorage.setItem('pt.density', k); S.grid && S.grid.refresh(true); };
    UI.menu(r.right, r.bottom + 6, [
      { title: 'גובה שורות ברירת מחדל' },
      { label: 'צפוף', icon: S.density === 'compact' ? 'check' : null, action: () => set('compact') },
      { label: 'רגיל', icon: S.density === 'normal' ? 'check' : null, action: () => set('normal') },
      { label: 'מרווח', icon: S.density === 'comfy' ? 'check' : null, action: () => set('comfy') },
      { sep: true },
      { label: 'גובה לשורות המסומנות…', icon: 'height', action: () => S.grid && S.grid.rowHeightDialog() },
      { label: 'איפוס גובה לשורות המסומנות', icon: 'refresh', action: () => S.grid && S.grid.setRowHeight(0) },
    ]);
  }
  function statsText(s) {
    let t = `<span>${fmtN(s.total)} שורות</span>`;
    if (s.cells > 1) {
      t += `<span>נבחרו ${fmtN(s.cells)} תאים · ${fmtN(s.rows)} שורות</span><span>ספירה ${fmtN(s.count)}</span>`;
      if (s.nums) t += `<span>סכום ${fmtN(s.sum)}</span><span>ממוצע ${fmtN(s.avg)}</span>`;
    }
    return t;
  }
  function setStatus(html) {
    const el = $('#statusbar'); if (!el) return;
    el.innerHTML = `<div class="sb-l">${html}</div><div class="sb-r"><span class="kbd-hint">Ctrl+Enter מחיל ערך על כל המסומנים · Ctrl+D מילוי למטה · גרירת ידית המילוי מעתיקה</span></div>`;
  }
  function createDefaultColumns() {
    const t = Store.now();
    const defs = [['מס׳ הזמנה', 'text', 120], ['פרויקט', 'text', 130], ['מק"ט', 'text', 140], ['תיאור', 'text', 220], ['ספק', 'text', 150], ['כמות', 'number', 80], ['כמות שסופקה', 'number', 110], ['תאריך הזמנה', 'date', 110], ['תאריך אספקה', 'date', 110], ['סטטוס', 'text', 130], ['הערות', 'text', 220]];
    const cols = defs.map(([name, type, width], i) => ({ id: 'c' + Store.uid(), name, type, width, order: i, updatedAt: t }));
    Store.db.datasets.orders.columns.push(...cols);
    Store.db.settings.mapping = D.autoMap(cols);
    Store.db.settings.updatedAt = t;
    Store.commit();
  }

  /* ================= הגדרות עמודות ================= */
  function columnsDialog(focusId, ds = 'orders') {
    const cols = Store.columns(ds);
    const m = ds === 'bom' ? D.bomMapping() : D.mapping();
    const ROLES = ds === 'bom' ? D.BOM_ROLES : D.ROLES;
    const roleSel = (cid) => `<select data-role="${cid}"><option value="">—</option>${ROLES.map((r) => `<option value="${r.key}" ${m[r.key] === cid ? 'selected' : ''}>${r.label}</option>`).join('')}</select>`;
    const body = document.createElement('div');
    body.innerHTML = `<p class="muted">שם, סוג ותפקיד לכל עמודה. התפקיד אומר למערכת איפה למצוא את הפרויקט, הסטטוס, המק"ט ותאריך האספקה — עליהם נשענים השיוך ללשוניות, הדשבורד וה-BOM.</p>
      <div class="col-row col-hdr"><span>מוצגת</span><span>שם</span><span>סוג</span><span>תפקיד</span><span>סדר</span></div>
      <div class="cols-list">${cols.map((c) => `
        <div class="col-row ${c.id === focusId ? 'focus' : ''}" data-id="${c.id}">
          <label class="vis" title="הצגה/הסתרה"><input type="checkbox" ${c.hidden ? '' : 'checked'} data-vis></label>
          <input type="text" value="${esc(c.name)}" data-name aria-label="שם עמודה">
          <select data-type><option value="text" ${c.type === 'text' ? 'selected' : ''}>טקסט</option><option value="number" ${c.type === 'number' ? 'selected' : ''}>מספר</option><option value="date" ${c.type === 'date' ? 'selected' : ''}>תאריך</option></select>
          ${roleSel(c.id)}
          <span class="mv"><button type="button" class="icon-btn sm" data-up aria-label="למעלה">${icon('sortAsc', 14)}</button><button type="button" class="icon-btn sm" data-down aria-label="למטה">${icon('sortDesc', 14)}</button></span>
        </div>`).join('')}</div>
      <button type="button" class="btn btn-soft" data-addcol>${icon('plus', 15)}<span>עמודה חדשה</span></button>`;
    const list = $('.cols-list', body);
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.col-row'); if (!row) return;
      if (e.target.closest('[data-up]') && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      if (e.target.closest('[data-down]') && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    });
    list.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-role]'); if (!sel || !sel.value) return;
      list.querySelectorAll('[data-role]').forEach((o) => { if (o !== sel && o.value === sel.value) o.value = ''; });
    });
    $('[data-addcol]', body).onclick = () => {
      const id = 'c' + Store.uid();
      list.insertAdjacentHTML('beforeend', `<div class="col-row new" data-id="${id}"><label class="vis"><input type="checkbox" checked data-vis></label><input type="text" value="עמודה חדשה" data-name><select data-type><option value="text">טקסט</option><option value="number">מספר</option><option value="date">תאריך</option></select>${roleSel(id)}<span class="mv"></span></div>`);
      list.lastElementChild.querySelector('[data-name]').select();
    };
    UI.modal({
      title: ds === 'bom' ? 'עמודות טבלת ה-BOM' : 'עמודות טבלת ההזמנות', body, wide: true,
      actions: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, icon: 'check', action: () => {
        const rows = [...list.querySelectorAll('.col-row')];
        const mapping = {};
        rows.forEach((el, i) => {
          const id = el.dataset.id;
          let c = Store.db.datasets[ds].columns.find((x) => x.id === id);
          if (!c) { c = { id, width: 140 }; Store.db.datasets[ds].columns.push(c); }
          const name = $('[data-name]', el).value.trim() || 'עמודה';
          const type = $('[data-type]', el).value;
          const hidden = !$('[data-vis]', el).checked;
          if (c.name !== name || c.type !== type || !!c.hidden !== hidden || c.order !== i) { Object.assign(c, { name, type, hidden, order: i }); Store.touch(c); }
          const role = $('[data-role]', el).value; if (role) mapping[role] = id;
        });
        if (ds === 'bom') Store.db.settings.bomMapping = mapping; else Store.db.settings.mapping = mapping;
        Store.db.settings.updatedAt = Store.now();
        Store.commit(); D.syncProjects(); renderTabs(); renderMain();
      } }],
    });
    if (focusId) setTimeout(() => { const f = body.querySelector('.col-row.focus [data-role]'); f && f.focus(); }, 80);
  }

  function statusDialog() {
    const m = D.mapping();
    if (!m.status) return UI.toast('קודם צריך לסמן איזו עמודה היא "סטטוס" בהגדרות העמודות.', 'info', 5000);
    const counts = new Map();
    for (const r of Store.rows('orders')) { const v = String(r.c[m.status] ?? '').trim(); counts.set(v, (counts.get(v) || 0) + 1); }
    const map = Store.db.settings.statusMap || {};
    const body = document.createElement('div');
    body.innerHTML = `<p class="muted">לכל ערך בעמודת הסטטוס — לאיזו קבוצה הוא שייך בדשבורד. הזמנה פתוחה שתאריך האספקה שלה עבר נספרת אוטומטית כ"בעיכוב".</p>
      <div class="status-list">${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => {
        const cur = map[D.norm(v)] || D.autoCat(v);
        return `<div class="st-row"><span class="st-val">${v ? esc(v) : '<i class="muted">(ריק)</i>'}</span><em>${n}</em>
          <select data-v="${esc(D.norm(v))}">${Object.entries(D.CATS).map(([k, c]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
          <span class="chip c-${cur}" data-prev>${D.CATS[cur].label}</span></div>`;
      }).join('')}</div>`;
    body.addEventListener('change', (e) => { const s = e.target.closest('select'); if (!s) return; const pv = s.parentElement.querySelector('[data-prev]'); pv.className = 'chip c-' + s.value; pv.textContent = D.CATS[s.value].label; });
    UI.modal({
      title: 'מיפוי סטטוסים', body, wide: true,
      actions: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, icon: 'check', action: () => {
        const out = {};
        body.querySelectorAll('select[data-v]').forEach((s) => { if (s.value !== D.autoCat(s.dataset.v)) out[s.dataset.v] = s.value; });
        Store.db.settings.statusMap = out; Store.db.settings.updatedAt = Store.now(); Store.commit();
        S.grid && S.grid.refresh(true);
      } }],
    });
  }

  /* ================= ייבוא ================= */
  const EXCEL_ACCEPT = '.xlsx,.xlsm,.xls,.xlsb,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12,text/csv';
  function pickFile(accept, cb) {
    // השדה חייב להיות בתוך הדף — בחלק מהדפדפנים (במיוחד באייפון) אחרת הבחירה לא נקלטת
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(i);
    i.addEventListener('change', () => { const f = i.files && i.files[0]; i.remove(); if (f) cb(f); });
    i.click();
  }
  function importFlow(ds, p) { pickFile(EXCEL_ACCEPT, (file) => importFile(ds, p, file)); }
  async function importFile(ds, p, file) {
    if (/\.json$/i.test(file.name)) return UI.toast('זה קובץ גיבוי. לשחזור גיבוי השתמש בתפריט המשתמש.', 'info', 5000);
    const prog = UI.progress('קורא את ' + file.name);
    let sheets;
    try { sheets = await XlsxLite.readFile(file, (f, st, d) => prog.set(f * 0.98, st, d)); }
    catch (e) { prog.fail(); console.error(e); return UI.toast((e.message || 'לא הצלחתי לקרוא את הקובץ.') + ` (${file.name}, ${(file.size / 1048576).toFixed(1)}MB)`, 'error', 12000); }
    sheets = sheets.filter((s) => s.rows.some((r) => r && r.some((v) => v !== '' && v != null)));
    if (!sheets.length) { prog.fail(); return UI.toast('לא נמצאו נתונים בקובץ.', 'error'); }
    const total = sheets.reduce((a, s) => a + s.rows.length, 0);
    await prog.done(`הקובץ נקרא · ${fmtN(total)} שורות`);
    importDialog(ds, p, file.name, sheets);
  }
  /**
   * כותרות הגיליון: תא כותרת ריק מקבל שם "עמודה N", והאורך מכסה גם עמודות שיש בהן נתונים בלי כותרת.
   * (Array.from ולא map — כדי שתאים ריקים לא ייצרו "חורים" במערך)
   */
  function headersOf(sh, hr) {
    const head = sh.rows[hr] || [];
    let width = head.length;
    for (let r = hr + 1; r < Math.min(sh.rows.length, hr + 200); r++) width = Math.max(width, (sh.rows[r] || []).length);
    return Array.from({ length: width }, (_, i) => String(head[i] ?? '').trim() || `עמודה ${i + 1}`);
  }
  /**
   * שורת הכותרות: השורה הראשונה (מתוך 20) שכל התאים בה טקסט, בלי כפילויות,
   * ומכסה לפחות 60% מרוחב הטבלה. כך שורת כותרת עליונה (כמו שם הדוח) לא נבחרת בטעות,
   * וגם שורת נתונים עם הרבה טקסט לא "גונבת" את מקום הכותרות.
   */
  function detectHeader(rows) {
    const N = Math.min(rows.length, 20);
    let width = 0;
    for (let i = 0; i < Math.min(rows.length, 60); i++) width = Math.max(width, (rows[i] || []).filter((v) => v !== '' && v != null).length);
    for (let i = 0; i < N; i++) {
      const vals = (rows[i] || []).filter((v) => v !== '' && v != null);
      if (vals.length < Math.max(2, Math.ceil(width * 0.6))) continue;
      const allText = vals.every((v) => typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v) && isNaN(+v));
      const unique = new Set(vals.map((v) => D.norm(v))).size === vals.length;
      if (allText && unique) return i;
    }
    let best = 0, bestN = -1;
    for (let i = 0; i < N; i++) { const n = (rows[i] || []).filter((v) => typeof v === 'string' && v.trim()).length; if (n > bestN) { bestN = n; best = i; } }
    return best;
  }

  function importDialog(ds, p, fname, sheets) {
    const isBom = ds === 'bom';
    // ברירת מחדל: הגיליון עם הכי הרבה נתונים
    let si = sheets.reduce((bi, sh, i) => (sh.rows.length > sheets[bi].rows.length ? i : bi), 0);
    const body = document.createElement('div');
    body.className = 'import-dlg';
    const existing = Store.rows('orders').length;
    const draw = () => {
      const sh = sheets[si];
      const hr = +($('[data-hr]', body)?.value ?? detectHeader(sh.rows));
      const headers = headersOf(sh, hr);
      const data = sh.rows.slice(hr + 1).filter((r) => r && r.some((v) => v !== '' && v != null));
      const prev = data.slice(0, 5);
      const cols = Store.columns('orders');
      const known = new Set(cols.map((c) => D.norm(c.name)));
      const newHeaders = headers.filter((h) => !known.has(D.norm(h)));
      const bomGuess = D.autoMap(headers.map((h, i) => ({ id: String(i), name: h })), D.BOM_ROLES);
      body.innerHTML = `
        <div class="imp-file">${icon('table', 18)}<b>${esc(fname)}</b><span class="muted">${fmtN(data.length)} שורות נתונים</span></div>
        <div class="grid3">
          <label class="field"><span>גיליון</span><select data-sheet>${sheets.map((s, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <label class="field"><span>שורת הכותרות</span><select data-hr>${sh.rows.slice(0, 20).map((r, i) => `<option value="${i}" ${i === hr ? 'selected' : ''}>שורה ${i + 1}: ${esc((r || []).filter((v) => v !== '' && v != null).slice(0, 3).join(' | ').slice(0, 50))}</option>`).join('')}</select></label>
          ${isBom ? '' : `<label class="field"><span>אופן הייבוא</span><select data-mode>
            <option value="${existing ? 'upsert' : 'replace'}">${existing ? 'עדכון לפי מפתח + הוספת חדשות' : 'ייבוא ראשוני'}</option>
            ${existing ? '<option value="append">הוספת כל השורות כחדשות</option><option value="replace">החלפת כל הנתונים</option>' : ''}</select></label>`}
        </div>
        ${!isBom && existing ? `<label class="field" data-keywrap><span>עמודת מפתח לזיהוי שורה קיימת (למשל מס׳ הזמנה + שורה)</span><select data-key multiple size="3">${headers.map((h, i) => `<option value="${i}" ${D.ROLES.find((r) => r.key === 'order').re.test(h) || (D.ROLES.find((r) => r.key === 'part').re.test(h)) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select><small class="muted">אפשר לבחור כמה עמודות עם Ctrl. שורה שהמפתח שלה קיים תתעדכן, אחרת תתווסף.</small></label>` : ''}
        ${isBom ? `<p class="muted sm-note">התאם את עמודות הקובץ לשדות ה-BOM. שאר העמודות בקובץ ייכנסו כעמודות נוספות בטבלה.</p>
          <div class="grid5">${D.BOM_ROLES.map((r) => `<label class="field"><span>${r.label}</span><select data-bom="${r.key}"><option value="">—</option>${headers.map((h, i) => `<option value="${i}" ${bomGuess[r.key] === String(i) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>
          <div class="grid2">
            <label class="field"><span>פרויקט לשורות שאין להן פרויקט בקובץ</span><input data-fallback list="projList" value="${esc(p ? p.name : '')}" placeholder="למשל PW1100"><datalist id="projList">${Store.projects().map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></label>
            <label class="field"><span>אופן הייבוא</span><select data-bommode>
              <option value="replaceProjects">החלפת ה-BOM של הפרויקטים שבקובץ</option>
              <option value="append">הוספה ל-BOM הקיים</option>
              <option value="replaceAll">החלפת כל ה-BOM</option></select></label>
          </div>` : ''}
        ${!isBom && newHeaders.length && cols.length ? `<p class="note">${icon('plus', 14)} עמודות חדשות שיתווספו לטבלה: ${newHeaders.map(esc).join(', ')}</p>` : ''}
        <div class="preview"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${prev.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $('[data-sheet]', body).onchange = (e) => { si = +e.target.value; body.innerHTML = ''; draw(); };
      $('[data-hr]', body).onchange = () => draw();
      const ms = $('[data-mode]', body); const kw = $('[data-keywrap]', body);
      if (ms && kw) { const t = () => (kw.hidden = ms.value !== 'upsert'); ms.onchange = t; t(); }
    };
    draw();
    UI.modal({
      title: isBom ? `ייבוא BOM${p ? ' · ' + p.name : ''}` : 'ייבוא טבלת הזמנות', body, wide: true,
      actions: [{ label: 'ביטול' }, { label: 'ייבוא', primary: true, icon: 'upload', action: async () => {
        const sh = sheets[si]; const hr = +$('[data-hr]', body).value;
        const headers = headersOf(sh, hr);
        const data = sh.rows.slice(hr + 1).filter((r) => r && r.some((v) => v !== '' && v != null));
        if (isBom) {
          const map = {}; body.querySelectorAll('[data-bom]').forEach((s) => (map[s.dataset.bom] = s.value));
          if (map.assembly === '' || map.part === '') throw new Error('צריך לבחור לפחות את עמודות המכלול והמק"ט.');
          const mode = $('[data-bommode]', body).value; const fb = $('[data-fallback]', body).value.trim();
          if (map.project === '' && !fb) throw new Error('אין בקובץ עמודת פרויקט — כתוב לאיזה פרויקט שייך ה-BOM.');
          setTimeout(() => importBom(headers, data, map, mode, fb).catch((e) => UI.toast(e.message, 'error', 6000)), 0);
        } else {
          const mode = $('[data-mode]', body).value;
          const keys = [...($('[data-key]', body)?.selectedOptions || [])].map((o) => +o.value);
          if (mode === 'upsert' && !keys.length) throw new Error('בחר לפחות עמודת מפתח אחת.');
          const rawCount = Math.max(0, sh.rows.length - hr - 1);
          setTimeout(() => importOrders(headers, data, mode, keys, p, rawCount).catch((e) => UI.toast(e.message, 'error', 6000)), 0);
        }
      } }],
    });
  }
  const NUM_HDR = /כמות|מחיר|סכום|עלות|qty|quantity|price|amount|total|cost|\$|usd|ערך|value/i;
  function guessType(name, values) {
    const vals = values.filter((v) => v !== '' && v != null).slice(0, 200);
    if (!vals.length) return 'text';
    const dates = vals.filter((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)).length;
    if (dates / vals.length >= 0.7) return 'date';
    if (NUM_HDR.test(name) && vals.filter((v) => typeof v === 'number').length / vals.length >= 0.7) return 'number';
    return 'text';
  }
  function guessWidth(name, values) {
    let w = String(name).length * 8 + 46;
    values.slice(0, 200).forEach((v) => { w = Math.max(w, String(v ?? '').length * 7.4 + 24); });
    return Math.round(Math.max(80, Math.min(300, w)));
  }
  async function importOrders(headers, data, mode, keyIdx, p, rawCount = data.length) {
    const prog = UI.progress(`מייבא ${fmtN(data.length)} שורות`);
    try { await importOrdersRun(headers, data, mode, keyIdx, p, prog, rawCount); }
    catch (e) { prog.fail(); throw e; }
  }
  async function importOrdersRun(headers, data, mode, keyIdx, p, prog, rawCount) {
    prog.set(0.02, 'מתאים עמודות');
    await UI.yieldUI();
    const dsObj = Store.db.datasets.orders;
    const cols = Store.columns('orders');
    const byName = new Map(cols.map((c) => [D.norm(c.name), c]));
    const firstImport = !Store.rows('orders').length;
    let order = cols.length;
    const colFor = headers.map((h, i) => {
      if (/^עמודה \d+$/.test(h) && !data.some((r) => r[i] !== '' && r[i] != null)) return null; // עמודה ריקה בלי כותרת
      let c = byName.get(D.norm(h));
      if (!c) {
        const values = data.map((r) => r[i]);
        c = { id: 'c' + Store.uid(), name: h, type: guessType(h, values), width: guessWidth(h, values), order: order++ };
        Store.touch(c); dsObj.columns.push(c); byName.set(D.norm(h), c);
      }
      return c;
    });
    // מיפוי אוטומטי של תפקידים שעדיין לא הוגדרו
    const s = Store.db.settings;
    const mapped = D.autoMap(Store.columns('orders'), D.ROLES, s.mapping);
    if (JSON.stringify(mapped) !== JSON.stringify(s.mapping)) { s.mapping = mapped; s.updatedAt = Store.now(); }
    const m = s.mapping;
    const convert = (c, v) => (v === '' || v == null ? '' : c.type === 'date' ? Grid.util.parseDate(v) : c.type === 'number' && typeof v !== 'number' ? Grid.util.parseValue(c, v) : v);
    let maxO = Store.rows('orders').reduce((a, r) => Math.max(a, r.o || 0), 0);
    let created = 0, updated = 0;
    if (mode === 'replace') for (const r of Store.rows('orders')) { r.deleted = true; Store.touch(r); }
    keyIdx = keyIdx.filter((i) => colFor[i]);
    const keyOf = (vals) => keyIdx.map((i) => D.norm(vals(i))).join('¦');
    // לכל מפתח — תור של שורות קיימות, כך ששורות עם אותו מפתח (למשל כמה מק"טים באותה הזמנה) לא מתמזגות
    const index = new Map();
    if (mode === 'upsert') for (const r of Store.rows('orders').sort((a, b) => (a.o || 0) - (b.o || 0))) { const k = keyOf((i) => r.c[colFor[i].id]); if (!k.replace(/¦/g, '')) continue; if (!index.has(k)) index.set(k, []); index.get(k).push(r); }
    prog.set(0.06, 'קולט שורות');
    let n = 0;
    for (const line of data) {
      if (++n % 1000 === 0) { prog.set(0.06 + 0.74 * (n / data.length), 'קולט שורות', `${fmtN(n)} מתוך ${fmtN(data.length)}`); await UI.yieldUI(); }
      let row = null;
      if (mode === 'upsert') { const q = index.get(keyOf((i) => line[i])); if (q && q.length) row = q.shift(); }
      if (row) {
        let changed = false;
        colFor.forEach((c, i) => { if (!c) return; const v = convert(c, line[i]); if ((row.c[c.id] ?? '') !== v) { row.c[c.id] = v; changed = true; } });
        if (changed) { Store.touch(row); updated++; }
      } else {
        row = { id: Store.uid(), c: {}, o: ++maxO, createdAt: Store.now() };
        if (firstImport || mode === 'replace') row.imp = 1;
        colFor.forEach((c, i) => { if (c) row.c[c.id] = convert(c, line[i]); });
        if (p && m.project && !row.c[m.project]) row.c[m.project] = p.name;
        row.createdBy = Store.currentUser() && Store.currentUser().id;
        Store.touch(row); dsObj.rows.push(row); created++;
      }
    }
    const skipped = rawCount - data.length;
    prog.set(0.82, 'בונה לשוניות פרויקט', `${fmtN(data.length)} שורות`);
    await UI.yieldUI();
    Store.commit();
    // לשוניות הפרויקט נבנות אוטומטית מעמודת הפרויקט
    const r = D.syncProjects();
    r.created.forEach((x) => S.newTabs.add(x.id));
    if (r.created.length) setTimeout(() => UI.toast(`נפתחו ${r.created.length} לשוניות פרויקט: ${r.created.map((x) => x.name).join(', ')}`, 'ok', 5000), 400);
    else if (!m.project) setTimeout(() => UI.toast('כדי לפתוח לשוניות פרויקט, סמן ב"עמודות" איזו עמודה מציינת את הפרויקט.', 'info', 6000), 400);
    prog.set(0.9, 'שומר במכשיר');
    await Store.flush();
    prog.set(0.97, 'מציג את הטבלה');
    await UI.yieldUI();
    renderTabs(); renderMain();
    await prog.done(`נקלטו ${fmtN(data.length)} שורות מתוך הקובץ`);
    UI.modal({
      title: 'הייבוא הושלם',
      body: `<div class="imp-sum"><div><b>${fmtN(data.length)}</b><span>שורות נתונים בקובץ</span></div><div><b>${fmtN(created)}</b><span>הזמנות חדשות</span></div><div><b>${fmtN(updated)}</b><span>עודכנו</span></div><div><b>${fmtN(data.length - created - updated)}</b><span>ללא שינוי</span></div></div>
        ${skipped ? `<p class="muted">${fmtN(skipped)} שורות ריקות לגמרי בקובץ דולגו.</p>` : ''}<p class="muted">סה"כ בטבלה עכשיו: ${fmtN(Store.rows('orders').length)} הזמנות.</p>`,
      actions: [{ label: 'סגירה', primary: true }],
    });
  }
  /**
   * ייבוא טבלת BOM: עמודות התפקיד (פרויקט, מכלול, מק"ט, תיאור, כמות) נכנסות לעמודות הקבועות,
   * ושאר כותרות הקובץ נוספות כעמודות נוספות בטבלת ה-BOM.
   */
  async function importBom(headers, data, map, mode, fallback) {
    const prog = UI.progress(`מייבא BOM · ${fmtN(data.length)} שורות`);
    try {
      prog.set(0.04, 'מתאים עמודות');
      await UI.yieldUI();
      const ds = Store.db.datasets.bom;
      const bm = D.bomMapping();
      const used = new Set(Object.values(map).filter((x) => x !== '').map(Number));
      const cols = Store.columns('bom');
      const byName = new Map(cols.map((c) => [D.norm(c.name), c]));
      let order = cols.length;
      const extra = [];
      headers.forEach((h, i) => {
        if (used.has(i)) return;
        if (/^עמודה \d+$/.test(h) && !data.some((r) => r[i] !== '' && r[i] != null)) return;
        let c = byName.get(D.norm(h));
        if (!c) { const vals = data.map((r) => r[i]); c = { id: 'bx' + Store.uid(), name: h, type: guessType(h, vals), width: guessWidth(h, vals), order: order++ }; Store.touch(c); ds.columns.push(c); byName.set(D.norm(h), c); }
        if (!Object.values(bm).includes(c.id)) extra.push([i, c]);
      });
      const get = (line, k) => (map[k] === '' || map[k] == null ? '' : line[+map[k]] ?? '');
      const projOf = (line) => String(get(line, 'project') || fallback || '').trim();
      if (mode === 'replaceAll') for (const r of Store.rows('bom')) { r.deleted = true; Store.touch(r); }
      else if (mode === 'replaceProjects') {
        const keys = new Set(data.map((l) => D.pk(projOf(l))));
        for (const r of Store.rows('bom')) if (keys.has(D.bomProjOf(r))) { r.deleted = true; Store.touch(r); }
      }
      let o = Store.rows('bom').reduce((a, r) => Math.max(a, r.o || 0), 0);
      let n = 0, k = 0;
      prog.set(0.08, 'קולט שורות');
      for (const line of data) {
        if (++k % 1000 === 0) { prog.set(0.08 + 0.72 * (k / data.length), 'קולט שורות', `${fmtN(k)} מתוך ${fmtN(data.length)}`); await UI.yieldUI(); }
        if (!String(get(line, 'part')).trim() && !String(get(line, 'assembly')).trim()) continue;
        const row = { id: Store.uid(), o: ++o, createdAt: Store.now(), c: {} };
        row.c[bm.project] = projOf(line);
        row.c[bm.assembly] = get(line, 'assembly'); row.c[bm.part] = get(line, 'part'); row.c[bm.desc] = get(line, 'desc');
        const q = get(line, 'qty'); row.c[bm.qty] = q === '' ? '' : (+q || q);
        for (const [i, c] of extra) { const v = line[i]; row.c[c.id] = v == null ? '' : c.type === 'date' ? Grid.util.parseDate(v) : v; }
        Store.touch(row); ds.rows.push(row); n++;
      }
      prog.set(0.82, 'מקשר לפרויקטים ולהזמנות');
      await UI.yieldUI();
      Store.commit();
      const r = D.syncProjects();
      r.created.forEach((x) => S.newTabs.add(x.id));
      prog.set(0.9, 'שומר במכשיר');
      await Store.flush();
      renderTabs(); renderMain();
      await prog.done(`נקלטו ${fmtN(n)} שורות BOM`);
      if (r.created.length) UI.toast(`נפתחו לשוניות לפרויקטים מה-BOM: ${r.created.map((x) => x.name).join(', ')}`, 'ok', 5000);
    } catch (e) { prog.fail(); throw e; }
  }

  /* ================= ייצוא ================= */
  function exportGrid(g, name) {
    const { cols, rows } = g.exportData();
    const header = cols.map((c) => c.name);
    const data = rows.map((r) => cols.map((c) => { const v = g.val(r, c); return c.type === 'date' ? Grid.util.fmtDate(String(v ?? '')) : v ?? ''; }));
    const blob = XlsxLite.writeXlsx([{ name, header, rows: data, widths: cols.map((c) => c.width) }]);
    download(blob, `${name}-${D.today()}.xlsx`);
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ================= דשבורד ================= */
  const KPI_IC = { all: 'box', notDone: 'cloud', supplied: 'check', closed: 'lock', delayed: 'alert', new: 'plus', lines: 'table', asm: 'layers', done: 'check', ordered: 'cloud', late: 'alert', missing: 'x' };
  function kpiCards(tiles, total, clickable = true) {
    return `<section class="kpis" aria-label="מדדי הזמנות">${tiles.map(([k, l, n, sub], i) => {
      const share = total ? Math.min(1, n / total) : 0;
      const tag = clickable ? 'button' : 'div';
      return `<${tag} class="kpi k-${k}" ${clickable ? `data-cf="${k}" type="button"` : ''} style="--d:${i}">
        <span class="kpi-top"><span class="kpi-ic">${icon(KPI_IC[k], 17)}</span><span class="kpi-l">${l}</span></span>
        <b class="kpi-n" data-count="${n}">${fmtN(n)}</b>
        <span class="kpi-bar" aria-hidden="true"><i style="--w:${(k === 'all' ? 1 : share) * 100}%"></i></span>
        <span class="kpi-s">${esc(sub || '')}</span></${tag}>`;
    }).join('')}</section>`;
  }
  function ring(pctVal, size, color, label, light) {
    const r = size / 2 - 9;
    return `<svg class="ring${light ? ' light' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-val${Math.round(pctVal * 100) ? '' : ' zero'}" pathLength="100" style="--v:${Math.round(pctVal * 100)};stroke:${color}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg><span class="ring-c${light ? ' light' : ''}"><b data-count="${Math.round(pctVal * 100)}" data-suffix="%">${Math.round(pctVal * 100)}%</b><em>${label}</em></span>`;
  }
  function renderDashboard(v, p) {
    const m = D.mapping();
    const rows = D.projectRows(p);
    const s = D.stats(rows, S.newDays);
    const bp = D.bomProgress(p);
    const done = s.supplied + s.closed;
    const active = s.total - s.cancelled;
    const delivery = active ? done / active : 0;
    const tiles = [
      ['all', 'הזמנות קיימות', s.total, 'בפרויקט'],
      ['notDone', 'נשארו פתוחות', s.notDone, s.total ? pct(s.notDone / s.total) + ' מההזמנות' : ''],
      ['supplied', 'סופקו', s.supplied, s.total ? pct(s.supplied / s.total) + ' מההזמנות' : ''],
      ['closed', 'סגורות', s.closed, s.total ? pct(s.closed / s.total) + ' מההזמנות' : ''],
      ['delayed', 'בעיכוב / דורש טיפול', s.delayed, m.due ? 'כולל באיחור לפי תאריך' : ''],
      ['new', 'חדשות', s.newer, `ב-${S.newDays} הימים האחרונים`],
    ];
    const headline = !s.total ? 'עוד אין הזמנות בפרויקט' : s.delayed ? `${s.delayed} הזמנות דורשות טיפול` : 'כל ההזמנות בזמן';
    v.innerHTML = `
      ${!m.project || !m.status ? `<div class="banner">${icon('alert', 16)}<span>${!m.project ? 'לא הוגדרה עמודת פרויקט' : 'לא הוגדרה עמודת סטטוס'} — הדשבורד צריך אותה כדי לספור נכון.</span><button class="btn btn-soft sm" id="fixCols">הגדרת עמודות</button></div>` : ''}
      <section class="hero" style="--pc:${p.color}">
        <div class="hero-fan" aria-hidden="true">${fanSvg(420, true)}</div>
        <div class="hero-txt">
          <h2>${esc(headline)}</h2>
          <p>${fmtN(s.total)} הזמנות · ${fmtN(done)} הושלמו · ${fmtN(s.notDone)} פתוחות${bp.count ? ` · ${fmtN(bp.count)} מק"טים ב-BOM` : ''}</p>
          <div class="hero-meter"><span>התקדמות אספקה</span><div class="hm-bar"><i style="--w:${delivery * 100}%"></i></div><b data-count="${Math.round(delivery * 100)}" data-suffix="%">${pct(delivery)}</b></div>
        </div>
        <div class="hero-rings">
          <div class="ring-box">${ring(delivery, 132, 'var(--st-supplied)', 'אספקות הושלמו')}</div>
          <div class="ring-box">${ring(bp.overall, 132, '#8FB3FF', bp.count ? 'השלמת BOM' : 'אין BOM עדיין')}</div>
        </div>
      </section>
      ${kpiCards(tiles, s.total)}
      <div class="dash-grid">
        <section class="card panel span2">
          <header class="ph"><h2>מצב ההזמנות</h2><div class="seg mini">${[7, 14, 30].map((d) => `<button type="button" data-nd="${d}" class="${S.newDays === d ? 'on' : ''}">${d} ימים</button>`).join('')}</div></header>
          ${statusBar(s)}
        </section>
        <section class="card panel span2 bom-panel">
          <header class="ph"><h2>השלמת מכלולים לפי BOM</h2><button class="btn btn-ghost sm" data-go="bom">${icon('layers', 15)}<span>ניהול BOM</span></button></header>
          ${bp.count ? bomOverview(bp) : `<div class="empty-mini">${icon('layers', 22)}<p>עוד אין BOM לפרויקט. ייבא את טבלת ה-BOM כדי לראות את אחוז ההשלמה של כל מכלול.</p><button class="btn btn-soft" data-go="bom">ייבוא BOM</button></div>`}
        </section>
        <section class="card panel">
          <header class="ph"><h2>באיחור</h2><span class="muted">${m.due ? 'לפי תאריך אספקה' : ''}</span></header>
          ${orderList(rows.filter((r) => D.cat(r) === 'delayed').sort((a, b) => String(a.c[m.due] || '9').localeCompare(String(b.c[m.due] || '9'))).slice(0, 8), 'late')}
        </section>
        <section class="card panel">
          <header class="ph"><h2>אספקות קרובות</h2><span class="muted">14 הימים הבאים</span></header>
          ${m.due ? orderList(rows.filter((r) => { const d = String(r.c[m.due] || ''); const c = D.cat(r); return c === 'open' && d >= D.today() && d <= new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10); }).sort((a, b) => String(a.c[m.due]).localeCompare(String(b.c[m.due]))).slice(0, 8), 'soon') : '<p class="muted pad">הגדר עמודת "תאריך אספקה" כדי לראות אספקות קרובות.</p>'}
        </section>
        <section class="card panel span2">
          <header class="ph"><h2>הזמנות פתוחות לפי ספק</h2></header>
          ${supplierBars(rows)}
        </section>
      </div>`;
    v.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => { S.route.sub = 'orders'; sessionStorage.setItem('pt.route', JSON.stringify(S.route)); renderMain(); S.catFilter = b.dataset.cf === 'all' ? null : b.dataset.cf; S.grid && (S.grid.refresh(), renderChips(), renderQuick()); }));
    v.querySelectorAll('[data-nd]').forEach((b) => (b.onclick = () => { S.newDays = +b.dataset.nd; renderMain(false); }));
    v.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(p.id, b.dataset.go)));
    v.querySelectorAll('[data-asm]').forEach((b) => (b.onclick = () => asmDialog(bp, b.dataset.asm)));
    const fx = $('#fixCols'); fx && (fx.onclick = () => columnsDialog());
    bindTips(v);
  }
  function statusBar(s) {
    const parts = D.CAT_ORDER.map((k) => [k, s[k]]).filter(([, n]) => n > 0);
    const tot = parts.reduce((a, [, n]) => a + n, 0);
    if (!tot) return '<p class="muted pad">אין עדיין הזמנות בפרויקט.</p>';
    return `<div class="stack" role="img" aria-label="${parts.map(([k, n]) => `${D.CATS[k].label} ${n}`).join(', ')}">${parts.map(([k, n]) => `<span class="seg-b c-${k}" style="flex:${n}" data-tip="${D.CATS[k].label}: ${n} (${pct(n / tot)})"></span>`).join('')}</div>
      <ul class="legend">${D.CAT_ORDER.map((k) => `<li><i class="sw c-${k}"></i><span>${D.CATS[k].label}</span><b>${fmtN(s[k])}</b><em>${tot ? pct(s[k] / tot) : ''}</em></li>`).join('')}${s.cancelled ? `<li><i class="sw c-cancelled"></i><span>בוטלו</span><b>${s.cancelled}</b><em></em></li>` : ''}</ul>`;
  }
  function orderList(rows, kind) {
    const m = D.mapping();
    if (!rows.length) return `<p class="muted pad">${kind === 'late' ? 'אין הזמנות באיחור. ' : 'אין אספקות מתוכננות בטווח הזה.'}</p>`;
    const days = (d) => Math.round((new Date(d) - new Date(D.today())) / 864e5);
    return `<ul class="olist">${rows.map((r) => {
      const d = String(r.c[m.due] || '');
      const dd = /^\d{4}-/.test(d) ? days(d) : null;
      return `<li><div><b>${esc(r.c[m.order] ?? '—')}</b><span>${esc([r.c[m.part], r.c[m.supplier]].filter(Boolean).join(' · '))}</span></div>
        <div class="ol-d ${kind}">${d ? Grid.util.fmtDate(d) : '—'}${dd != null ? `<em>${dd < 0 ? `${-dd} ימי איחור` : dd === 0 ? 'היום' : `בעוד ${dd} ימים`}</em>` : ''}</div></li>`;
    }).join('')}</ul>`;
  }
  function supplierBars(rows) {
    const m = D.mapping();
    if (!m.supplier) return '<p class="muted pad">הגדר עמודת "שם ספק" (בכפתור עמודות) כדי לראות פילוח לפי ספק.</p>';
    const by = new Map();
    for (const r of rows) {
      const c = D.cat(r); if (c !== 'open' && c !== 'delayed') continue;
      const k = String(r.c[m.supplier] || 'ללא ספק').trim();
      const o = by.get(k) || { open: 0, delayed: 0 }; o[c]++; by.set(k, o);
    }
    const list = [...by.entries()].sort((a, b) => (b[1].open + b[1].delayed) - (a[1].open + a[1].delayed)).slice(0, 10);
    if (!list.length) return '<p class="muted pad">אין הזמנות פתוחות.</p>';
    const max = Math.max(...list.map(([, o]) => o.open + o.delayed));
    return `<div class="bars">${list.map(([k, o]) => `<div class="bar-row"><span class="bar-l" title="${esc(k)}">${esc(k)}</span>
      <div class="bar-t"><div class="bar-f" style="width:${((o.open + o.delayed) / max) * 100}%">${o.open ? `<span class="c-open" style="flex:${o.open}" data-tip="${esc(k)} · פתוחות בזמן: ${o.open}"></span>` : ''}${o.delayed ? `<span class="c-delayed" style="flex:${o.delayed}" data-tip="${esc(k)} · בעיכוב: ${o.delayed}"></span>` : ''}</div></div>
      <b class="bar-v">${o.open + o.delayed}</b></div>`).join('')}</div>
      <ul class="legend inline"><li><i class="sw c-open"></i><span>פתוחות בזמן</span></li><li><i class="sw c-delayed"></i><span>בעיכוב</span></li></ul>`;
  }

  /* ---------- מכלולים: מד "מאוורר" ---------- */
  function fanGauge(a, size = 112) {
    const items = a.items; const n = items.length;
    const r = size / 2 - 8, cx = size / 2, cy = size / 2;
    const gap = n > 1 ? Math.min(6, 160 / n) : 0;
    const seg = 360 / n;
    const col = { done: 'var(--st-supplied)', ordered: 'var(--st-open)', late: 'var(--st-delayed)', missing: 'var(--track)' };
    const arc = (a0, a1) => {
      const p = (deg) => { const t = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    let paths = '';
    const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="fan-track" stroke-width="9"/>`;
    if (n === 1) paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col[items[0].state]}" stroke-width="9" pathLength="1" class="seg-arc" style="--i:0" transform="rotate(-90 ${cx} ${cy})"/>`;
    else items.forEach((it, i) => { const a0 = i * seg + gap / 2, a1 = (i + 1) * seg - gap / 2; paths += `<path d="${arc(a0, a1)}" fill="none" stroke="${col[it.state]}" stroke-width="9" stroke-linecap="butt" pathLength="1" class="seg-arc" style="--i:${i}"><title>${esc(String(it.part ?? ''))} · ${D.LINE_STATE[it.state].label}</title></path>`; });
    paths = track + paths;
    return `<svg class="fan" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${paths}<circle cx="${cx}" cy="${cy}" r="${r - 13}" class="fan-hub"/></svg>`;
  }
  function bomOverview(bp, gkey = '') {
    const asms = [...bp.assemblies].sort((a, b) => a.pct - b.pct);
    const tot = { done: 0, ordered: 0, late: 0, missing: 0 };
    asms.forEach((a) => Object.keys(tot).forEach((k) => (tot[k] += a.cnt[k])));
    return `<div class="bom-head"><div class="bom-overall"><b data-count="${Math.round(bp.overall * 100)}" data-suffix="%">${pct(bp.overall)}</b><span>השלמה כוללת · ${fmtN(bp.count)} מק"טים ב-${asms.length} מכלולים</span></div>
      <ul class="legend inline">${Object.entries(D.LINE_STATE).map(([k, s]) => `<li><i class="sw ${k === 'missing' ? 'c-missing' : 'c-' + s.cls}"></i><span>${s.label}</span><b>${tot[k]}</b></li>`).join('')}</ul></div>
      <div class="asm-grid">${asms.map((a, i) => `
        <button class="asm" type="button" data-asm="${esc(a.name)}" data-g="${esc(gkey)}" style="--d:${i}">
          <div class="asm-g">${fanGauge(a)}<b class="asm-p" data-count="${Math.round(a.pct * 100)}" data-suffix="%">${pct(a.pct)}</b></div>
          <div class="asm-t"><b>${esc(a.name)}</b><span>${a.cnt.done}/${a.items.length} מק"טים סופקו${a.cnt.late ? ` · <em class="t-late">${a.cnt.late} בעיכוב</em>` : ''}${a.cnt.missing ? ` · ${a.cnt.missing} לא הוזמנו` : ''}</span></div>
        </button>`).join('')}</div>`;
  }
  function asmDialog(bp, name, gkey) {
    const src = gkey != null && bp.groups ? bp.groups.find((g) => g.key === gkey) : bp;
    const a = src && src.assemblies.find((x) => x.name === name); if (!a) return;
    const m = D.mapping(); const bm = D.bomMapping();
    UI.modal({
      title: `מכלול ${a.name} · ${pct(a.pct)}`, wide: true,
      body: `<table class="mini-table"><thead><tr><th>מק"ט</th><th>תיאור</th><th>נדרש</th><th>סופק</th><th>מצב</th><th>הזמנות</th></tr></thead><tbody>${a.items.map((i) => `
        <tr><td dir="ltr" class="mono">${esc(i.part ?? '')}</td><td>${esc(i.line.c[bm.desc] ?? '')}</td><td>${fmtN(i.req)}</td><td>${isFinite(i.got) ? fmtN(i.got) : '✓'}</td>
        <td><span class="chip ${i.state === 'missing' ? 'c-missing' : 'c-' + D.LINE_STATE[i.state].cls}">${D.LINE_STATE[i.state].label}</span></td>
        <td>${i.orders.map((o) => esc(o.c[m.order] ?? '')).filter(Boolean).join(', ') || '—'}</td></tr>`).join('')}</tbody></table>`,
      actions: [{ label: 'סגירה' }],
    });
  }
  const inBomP = (r, p) => { const v = D.bomProjOf(r); return v ? v === D.pk(p.name) : r.p === p.id; };
  const bomRoleOf = (id) => { const bm = D.bomMapping(); const r = D.BOM_ROLES.find((x) => bm[x.key] === id); return r ? r.label : ''; };

  /* ================= טבלת BOM (כללית או של פרויקט) ================= */
  function renderBom(v, p) {
    const bm = D.bomMapping();
    v.innerHTML = `
      <div id="bomSummary" class="bom-summary"></div>
      <div class="toolbar">
        <label class="search">${icon('search', 15)}<input type="search" id="q" placeholder="חיפוש ב-BOM…"></label>
        <div class="tb-group">
          <button class="btn btn-soft" id="addRow">${icon('plus', 16)}<span>שורה</span></button>
          <button class="btn btn-soft" id="imp">${icon('upload', 16)}<span>ייבוא BOM</span></button>
          <button class="btn btn-soft" id="exp">${icon('download', 16)}<span>ייצוא</span></button>
        </div>
        <div class="tb-group">
          <button class="icon-btn" id="undo" title="ביטול (Ctrl+Z)" aria-label="ביטול">${icon('undo', 17)}</button>
          <button class="icon-btn" id="redo" title="חזרה (Ctrl+Y)" aria-label="חזרה">${icon('redo', 17)}</button>
        </div>
        ${moreButton()}
        <div class="more-tools" id="moreTools" ${S.moreOpen ? '' : 'hidden'}>
          <div class="tb-group mt-i" style="--i:0">
            <button class="icon-btn" id="bulk" title="הזנת ערך לכל המסומנים (Ctrl+Enter)" aria-label="הזנה מרובה">${icon('wand', 17)}</button>
            <button class="icon-btn" id="del" title="מחיקת שורות מסומנות" aria-label="מחיקת שורות">${icon('trash', 17)}</button>
            <button class="btn btn-ghost danger-ghost" id="clearTbl" title="מחיקת כל השורות בטבלה">${icon('trash', 16)}<span>מחיקת הטבלה</span></button>
          </div>
          ${viewControls(1)}
          <div class="tb-group mt-i" style="--i:3"><button class="btn btn-ghost" id="colsBtn">${icon('columns', 16)}<span>עמודות</span></button></div>
        </div>
        <div class="chips" id="chips"><span class="muted sm-note">המצב של כל מק"ט מחושב מהזמנות הפרויקט שלו</span></div>
      </div>
      <div class="grid-area" id="gridArea"></div>`;
    let cache = null;
    const prog = () => (cache ||= p ? D.bomProgress(p) : D.bomProgressAll());
    const virt = [
      { id: '_st', name: 'מצב אספקה', width: 120, type: 'text', virtual: true, get: (r) => { const i = prog().lines.get(r.id); return i ? D.LINE_STATE[i.state].label : ''; } },
      { id: '_got', name: 'סופק', width: 80, type: 'number', virtual: true, get: (r) => { const i = prog().lines.get(r.id); return i && isFinite(i.got) ? i.got : i ? i.req : ''; } },
      { id: '_ord', name: 'הזמנות מקושרות', width: 180, type: 'text', virtual: true, get: (r) => { const i = prog().lines.get(r.id); const m = D.mapping(); return i ? i.orders.map((o) => o.c[m.order]).filter(Boolean).join(', ') : ''; } },
    ];
    const g = new Grid($('#gridArea'), {
      dataset: 'bom', label: p ? 'BOM ' + p.name : 'BOM', rowHeight, wrap: () => S.wrap, onZoom: zoomChanged, cellFont: () => S.view, noFreeze: (c) => D.noFreeze(c), onSearch: () => renderChips(),
      filter: p ? (r) => inBomP(r, p) : null,
      defaults: () => (p ? { [bm.project]: p.name } : {}),
      readOnly: () => !D.can('bom'), colLocked: () => !D.can('bom'),
      canAdd: () => D.can('bom'), canDel: () => D.can('bom'), canAdmin: () => D.can('admin'),
      virtualCols: () => { cache = null; return virt; },
      colRole: bomRoleOf,
      decorate: (row, col, val, txt) => {
        if (col.id === '_st' && txt) { const i = prog().lines.get(row.id); return { cls: 'has-chip', html: `<span class="chip ${i.state === 'missing' ? 'c-missing' : 'c-' + D.LINE_STATE[i.state].cls}">${esc(txt)}</span>` }; }
        if (col.virtual) return { cls: 'virtual' };
        if (!p && col.id === bm.project && txt) { const pc = D.projectColor(txt); if (pc) return { html: `<span class="ptag" style="--pc:${pc}"><i class="pdot"></i>${esc(txt)}</span>` }; }
        return null;
      },
      onStats: (s) => setStatus(statsText(s)),
      onChange: () => { cache = null; const r = D.syncProjects(); r.created.forEach((x) => S.newTabs.add(x.id)); renderTabs(); renderBomSummary(); },
      onFilter: () => renderChips(),
      columnMenuExtra: (col) => [{ label: 'תפקיד העמודה…', icon: 'link', action: () => columnsDialog(col.id, 'bom') }],
      emptyHtml: `<div><b>אין עדיין BOM${p ? ' ל-' + esc(p.name) : ''}</b><p>ייבא את קובץ ה-BOM בכפתור "ייבוא BOM" או בגרירה לחלון. כל שורה צריכה מכלול, מק"ט וכמות${p ? '' : ', ועמודת פרויקט (או שתבחר פרויקט בייבוא)'}.</p></div>`,
    });
    applyCaps({ addRow: 'bom', imp: 'import', del: 'bom', bulk: 'bom', clearTbl: 'admin', colsBtn: 'admin' });
    $('#clearTbl').onclick = () => clearTableDialog('bom', p);
    S.grid = g;
    bindViewControls(g);
    $('#q').addEventListener('input', debounce((e) => g.setSearch(e.target.value), 180));
    $('#addRow').onclick = () => { g.appendRows(1); g.focus(); };
    $('#imp').onclick = () => importFlow('bom', p);
    $('#exp').onclick = () => exportGrid(g, p ? 'BOM ' + p.name : 'BOM');
    $('#undo').onclick = () => g.undo(); $('#redo').onclick = () => g.redo();
    $('#bulk').onclick = () => g.bulkValueDialog(); $('#del').onclick = () => g.deleteSelectedRows();
    $('#colsBtn').onclick = () => columnsDialog(null, 'bom');
    renderBomSummary();
    if (S.bomFilter) { g.filters._st = new Set([S.bomFilter]); S.bomFilter = null; g.refresh(); renderChips(); }
    g.focus();
  }
  function renderBomSummary() {
    const el = $('#bomSummary'); if (!el) return;
    const p = currentProject();
    const bp = p ? D.bomProgress(p) : D.bomProgressAll();
    if (!bp.count) { el.innerHTML = ''; return; }
    if (p) el.innerHTML = `<section class="card panel">${bomOverview(bp)}</section>`;
    else {
      const t = bp.cnt;
      el.innerHTML = `<section class="card panel bom-strip"><div class="bom-overall"><b data-count="${Math.round(bp.overall * 100)}" data-suffix="%">${pct(bp.overall)}</b><span>השלמה כוללת · ${fmtN(bp.count)} מק"טים ב-${bp.groups.length} פרויקטים</span></div>
        <ul class="legend inline">${Object.entries(D.LINE_STATE).map(([k, s]) => `<li><i class="sw ${k === 'missing' ? 'c-missing' : 'c-' + s.cls}"></i><span>${s.label}</span><b>${fmtN(t[k])}</b></li>`).join('')}</ul>
        <button class="btn btn-ghost sm" data-go-bdash>${icon('chart', 15)}<span>לדשבורד BOM</span></button></section>`;
      const b = el.querySelector('[data-go-bdash]'); b && (b.onclick = () => go('bom', 'bdash'));
    }
    el.querySelectorAll('[data-asm]').forEach((b) => (b.onclick = () => asmDialog(bp, b.dataset.asm)));
    countUp(el, true);
  }

  /* ================= השוואת פרויקטים ================= */
  function compareTable() {
    const ps = Store.projects();
    if (!ps.length) return `<div class="empty-mini">${icon('layers', 22)}<p>עוד אין פרויקטים. הם נפתחים לבד מעמודת הפרויקט בטבלת ההזמנות או ב-BOM.</p></div>`;
    return `<div class="table-wrap"><table class="ov-table"><thead><tr><th>פרויקט</th><th>הזמנות</th><th>פתוחות</th><th>סופקו</th><th>סגורות</th><th>בעיכוב</th><th>חדשות</th><th class="w-bar">התפלגות</th><th>השלמת BOM</th></tr></thead><tbody>
      ${ps.map((p, i) => {
        const s = D.stats(D.projectRows(p), S.newDays); const bp = D.bomProgress(p);
        const parts = D.CAT_ORDER.filter((k) => s[k]);
        return `<tr data-p="${p.id}" style="--d:${i}"><td><span class="ptag" style="--pc:${p.color}"><i class="pdot"></i>${esc(p.name)}</span>${Store.isUnlocked(p.id) ? '' : ` <span class="lock">${icon('lock', 12)}</span>`}</td>
        <td>${fmtN(s.total)}</td><td>${fmtN(s.notDone)}</td><td>${fmtN(s.supplied)}</td><td>${fmtN(s.closed)}</td><td class="${s.delayed ? 't-late' : ''}">${fmtN(s.delayed)}</td><td>${fmtN(s.newer)}</td>
        <td class="w-bar"><div class="stack thin">${parts.map((k) => `<span class="seg-b c-${k}" style="flex:${s[k]}" data-tip="${D.CATS[k].label}: ${s[k]}"></span>`).join('') || '<span class="seg-b c-missing" style="flex:1"></span>'}</div></td>
        <td>${bp.count ? `<div class="pbar"><div style="width:${pct(bp.overall)}"></div></div><b class="pnum">${pct(bp.overall)}</b>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function bindCommon(v) {
    v.querySelectorAll('[data-p]').forEach((el) => (el.onclick = () => go(el.dataset.p, 'dashboard')));
    v.querySelectorAll('[data-nd]').forEach((b) => (b.onclick = () => { S.newDays = +b.dataset.nd; renderMain(false); }));
    bindTips(v);
  }
  /** לחיצה על מדד פותחת את טבלת ההזמנות מסוננת */
  function bindKpiToOrders(v, tab) {
    v.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => {
      S.route = { tab, sub: 'orders' }; sessionStorage.setItem('pt.route', JSON.stringify(S.route));
      renderTabs(); renderMain(); S.catFilter = b.dataset.cf === 'all' ? null : b.dataset.cf; S.grid && (S.grid.refresh(), renderChips(), renderQuick());
    }));
  }
  const ordersKpis = (s) => [
    ['all', 'הזמנות קיימות', s.total, ''],
    ['notDone', 'נשארו פתוחות', s.notDone, s.total ? pct(s.notDone / s.total) + ' מההזמנות' : ''],
    ['supplied', 'סופקו', s.supplied, s.total ? pct(s.supplied / s.total) + ' מההזמנות' : ''],
    ['closed', 'סגורות', s.closed, s.total ? pct(s.closed / s.total) + ' מההזמנות' : ''],
    ['delayed', 'בעיכוב / דורש טיפול', s.delayed, D.mapping().due ? 'כולל באיחור לפי תאריך' : ''],
    ['new', 'חדשות', s.newer, `ב-${S.newDays} הימים האחרונים`],
  ];
  const newDaysSeg = () => `<div class="seg mini">${[7, 14, 30].map((d) => `<button type="button" data-nd="${d}" class="${S.newDays === d ? 'on' : ''}">${d} ימים</button>`).join('')}</div>`;
  function lateAndSoon(rows) {
    const m = D.mapping();
    const soonEnd = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    return `<section class="card panel">
        <header class="ph"><h2>באיחור</h2><span class="muted">${m.due ? 'לפי תאריך אספקה' : ''}</span></header>
        ${orderList(rows.filter((r) => D.cat(r) === 'delayed').sort((a, b) => String(a.c[m.due] || '9').localeCompare(String(b.c[m.due] || '9'))).slice(0, 8), 'late')}
      </section>
      <section class="card panel">
        <header class="ph"><h2>אספקות קרובות</h2><span class="muted">14 הימים הבאים</span></header>
        ${m.due ? orderList(rows.filter((r) => { const d = String(r.c[m.due] || ''); return D.cat(r) === 'open' && d >= D.today() && d <= soonEnd; }).sort((a, b) => String(a.c[m.due]).localeCompare(String(b.c[m.due]))).slice(0, 8), 'soon') : '<p class="muted pad">הגדר עמודת "תאריך אספקה" כדי לראות אספקות קרובות.</p>'}
      </section>`;
  }
  function hero({ color, headline, meta, meter, rings }) {
    return `<section class="hero" style="--pc:${color}">
      <div class="hero-fan" aria-hidden="true">${fanSvg(420, true)}</div>
      <div class="hero-txt"><h2>${esc(headline)}</h2><p>${meta}</p>
        ${meter ? `<div class="hero-meter"><span>${meter[0]}</span><div class="hm-bar"><i style="--w:${meter[1] * 100}%"></i></div><b data-count="${Math.round(meter[1] * 100)}" data-suffix="%">${pct(meter[1])}</b></div>` : ''}</div>
      <div class="hero-rings">${rings.map(([v, c, l]) => `<div class="ring-box">${ring(v, 132, c, l)}</div>`).join('')}</div>
    </section>`;
  }
  const onboard = (what) => `<div class="onboard">
      <div class="ob-card ${Store.rows('orders').length ? 'ok' : ''}"><span class="ob-n">${Store.rows('orders').length ? icon('check', 18) : '1'}</span><b>טבלת ההזמנות</b><p>כל ההזמנות, המק"טים והסטטוס שלהן. ממנה נפתחות לשוניות הפרויקטים.</p><button class="btn btn-primary" data-imp="orders">${icon('upload', 16)}<span>${Store.rows('orders').length ? 'עדכון מקובץ' : 'ייבוא הזמנות'}</span></button></div>
      <div class="ob-card ${Store.rows('bom').length ? 'ok' : ''}"><span class="ob-n">${Store.rows('bom').length ? icon('check', 18) : '2'}</span><b>טבלת ה-BOM</b><p>מכלולים והמק"טים שמרכיבים אותם. ממנה מחושב אחוז ההשלמה של כל מכלול.</p><button class="btn ${Store.rows('bom').length ? 'btn-soft' : 'btn-primary'}" data-imp="bom">${icon('upload', 16)}<span>${Store.rows('bom').length ? 'עדכון מקובץ' : 'ייבוא BOM'}</span></button></div>
    </div>`;
  function bindOnboard(v) {
    v.querySelectorAll('[data-imp]').forEach((b) => { if (!D.can('import')) { b.disabled = true; b.title = 'רק מנהל רכש יכול לייבא קבצים'; } b.onclick = () => importFlow(b.dataset.imp, null); });
  }

  /* ================= דשבורד הזמנות (כללי) ================= */
  function renderOrdersDash(v) {
    const rows = Store.rows('orders');
    if (!rows.length) { v.innerHTML = onboard(); return bindOnboard(v); }
    const s = D.stats(rows, S.newDays);
    const done = s.supplied + s.closed; const active = s.total - s.cancelled;
    const delivery = active ? done / active : 0;
    v.innerHTML = `
      ${hero({ color: '#2F5BD3', headline: s.delayed ? `${fmtN(s.delayed)} הזמנות דורשות טיפול` : 'כל ההזמנות בזמן', meta: `${fmtN(s.total)} הזמנות ב-${Store.projects().length} פרויקטים · ${fmtN(done)} הושלמו · ${fmtN(s.notDone)} פתוחות`, meter: ['התקדמות אספקה', delivery], rings: [[delivery, 'var(--st-supplied)', 'אספקות הושלמו'], [s.total ? s.delayed / s.total : 0, '#FF9B6A', 'בעיכוב']] })}
      ${kpiCards(ordersKpis(s), s.total)}
      <div class="dash-grid">
        <section class="card panel span2"><header class="ph"><h2>מצב ההזמנות</h2>${newDaysSeg()}</header>${statusBar(s)}</section>
        <section class="card panel span2"><header class="ph"><h2>לפי פרויקט</h2></header>${compareTable()}</section>
        ${lateAndSoon(rows)}
        <section class="card panel span2"><header class="ph"><h2>הזמנות פתוחות לפי ספק</h2></header>${supplierBars(rows)}</section>
      </div>`;
    bindKpiToOrders(v, 'main'); bindCommon(v);
  }

  /* ================= דשבורד BOM (כללי) ================= */
  function renderBomDash(v) {
    const bp = D.bomProgressAll();
    if (!bp.count) { v.innerHTML = onboard(); return bindOnboard(v); }
    const asmCount = bp.groups.reduce((a, g) => a + g.assemblies.length, 0);
    const c = bp.cnt;
    const orderedShare = bp.count ? (c.done + c.ordered + c.late) / bp.count : 0;
    const tiles = [
      ['lines', 'שורות BOM', bp.count, `ב-${bp.groups.length} פרויקטים`],
      ['asm', 'מכלולים', asmCount, `${fmtN(bp.groups.reduce((a, g) => a + g.assemblies.filter((x) => x.pct >= 1).length, 0))} הושלמו`],
      ['done', 'מק"טים סופקו', c.done, pct(c.done / bp.count)],
      ['ordered', 'הוזמנו ובדרך', c.ordered, pct(c.ordered / bp.count)],
      ['late', 'בעיכוב', c.late, pct(c.late / bp.count)],
      ['missing', 'לא הוזמנו', c.missing, pct(c.missing / bp.count)],
    ];
    const bm = D.bomMapping();
    const missing = [];
    for (const gr of bp.groups) for (const a of gr.assemblies) for (const i of a.items) if (i.state === 'missing') missing.push([gr, a, i]);
    v.innerHTML = `
      ${hero({ color: '#27A86E', headline: `${pct(bp.overall)} מה-BOM הושלם`, meta: `${fmtN(bp.count)} מק"טים · ${fmtN(asmCount)} מכלולים · ${fmtN(c.missing)} מק"טים עוד לא הוזמנו`, meter: ['מק"טים שהוזמנו', orderedShare], rings: [[bp.overall, 'var(--st-supplied)', 'השלמת BOM'], [orderedShare, '#8FB3FF', 'הוזמנו']] })}
      ${kpiCards(tiles, bp.count)}
      <div class="dash-grid">
        <section class="card panel span2"><header class="ph"><h2>השלמה לפי פרויקט</h2></header>
          <div class="bars proj-bars">${bp.groups.sort((a, b) => a.overall - b.overall).map((g, i) => `<div class="bar-row" ${g.project ? `data-p="${g.project.id}"` : ''} style="--bi:${i}"><span class="bar-l">${g.project ? `<i class="pdot" style="--pc:${g.project.color}"></i> ` : ''}${esc(g.name)}</span>
            <div class="bar-t"><div class="bar-f" style="width:${Math.max(1, g.overall * 100)}%"><span class="c-supplied" style="flex:1" data-tip="${esc(g.name)} · ${pct(g.overall)} · ${g.count} מק&quot;טים"></span></div></div><b class="bar-v">${pct(g.overall)}</b></div>`).join('')}</div>
        </section>
        ${bp.groups.map((g) => `<section class="card panel span2"><header class="ph"><h2>${g.project ? `<i class="pdot" style="--pc:${g.project.color}"></i> ` : ''}מכלולים · ${esc(g.name)}</h2>${g.project ? `<button class="btn btn-ghost sm" data-p="${g.project.id}">${icon('chart', 15)}<span>לדשבורד הפרויקט</span></button>` : ''}</header>${bomOverview(g, g.key)}</section>`).join('')}
        <section class="card panel span2"><header class="ph"><h2>מק"טים שעוד לא הוזמנו</h2><span class="muted">${fmtN(missing.length)}</span></header>
          ${missing.length ? `<div class="table-wrap"><table class="mini-table"><thead><tr><th>פרויקט</th><th>מכלול</th><th>מק"ט</th><th>תיאור</th><th>נדרש</th></tr></thead><tbody>${missing.slice(0, 30).map(([gr, a, i]) => `<tr><td>${esc(gr.name)}</td><td>${esc(a.name)}</td><td dir="ltr" class="mono">${esc(i.part ?? '')}</td><td>${esc(i.line.c[bm.desc] ?? '')}</td><td>${fmtN(i.req)}</td></tr>`).join('')}</tbody></table></div>${missing.length > 30 ? `<p class="muted pad">ועוד ${fmtN(missing.length - 30)} — כל הרשימה בטבלת ה-BOM בסינון "לא הוזמן".</p>` : ''}` : '<p class="muted pad">כל המק"טים הוזמנו.</p>'}
        </section>
      </div>`;
    v.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => {
      const lab = { done: 'סופק', ordered: 'הוזמן', late: 'בעיכוב', missing: 'לא הוזמן' }[b.dataset.cf];
      S.bomFilter = lab || null; go('bom', 'bomtable');
    }));
    v.querySelectorAll('[data-asm]').forEach((b) => (b.onclick = () => asmDialog(bp, b.dataset.asm, b.dataset.g)));
    bindCommon(v);
  }

  /* ================= דשבורד משולב — כל הפרויקטים ================= */
  function renderHome(v) {
    const ps = Store.projects();
    const orders = Store.rows('orders');
    if (!orders.length && !Store.rows('bom').length) {
      v.innerHTML = `<div class="home-empty">${fanSvg(84)}<h2>מתחילים משני קבצים</h2><p>הזמנות ו-BOM נטענים בנפרד, וכל אחד מקבל לשונית ודשבורד משלו. הדשבורד הזה מחבר בין שניהם לכל פרויקט.</p>${onboard()}</div>`;
      return bindOnboard(v);
    }
    const s = D.stats(orders, S.newDays);
    const bpa = D.bomProgressAll();
    const done = s.supplied + s.closed; const active = s.total - s.cancelled;
    const delivery = active ? done / active : 0;
    v.innerHTML = `
      ${hero({ color: '#7E57B0', headline: `${ps.length} פרויקטים · ${fmtN(s.notDone)} הזמנות פתוחות`, meta: `${fmtN(s.total)} הזמנות · ${fmtN(bpa.count)} מק"טים ב-BOM · ${fmtN(s.delayed)} דורשות טיפול`, meter: ['התקדמות אספקה', delivery], rings: [[delivery, 'var(--st-supplied)', 'אספקות הושלמו'], [bpa.overall, '#8FB3FF', bpa.count ? 'השלמת BOM' : 'אין BOM עדיין']] })}
      ${!orders.length || !Store.rows('bom').length ? onboard() : ''}
      ${kpiCards(ordersKpis(s), s.total)}
      <div class="pgrid">${ps.map((p, i) => projectCard(p, i)).join('')}</div>`;
    bindKpiToOrders(v, 'main'); bindOnboard(v); bindCommon(v);
  }
  function projectCard(p, i) {
    const s = D.stats(D.projectRows(p), S.newDays);
    const bp = D.bomProgress(p);
    const done = s.supplied + s.closed; const active = s.total - s.cancelled;
    const delivery = active ? done / active : 0;
    const worst = [...bp.assemblies].sort((a, b) => a.pct - b.pct).slice(0, 3);
    const locked = !Store.isUnlocked(p.id);
    const st = [['קיימות', s.total, ''], ['פתוחות', s.notDone, 'open'], ['סופקו', s.supplied, 'supplied'], ['סגורות', s.closed, 'closed'], ['בעיכוב', s.delayed, 'delayed'], ['חדשות', s.newer, '']];
    return `<button class="pcard" type="button" data-p="${p.id}" style="--pc:${p.color};--d:${i}">
      <header><i class="pdot lg"></i><b>${esc(p.name)}</b>${locked ? `<span class="lock">${icon('lock', 13)}</span>` : ''}<span class="pc-go">${icon('chevron', 16)}</span></header>
      <div class="pc-body">
        <div class="pc-ring">${ring(bp.overall, 104, 'var(--st-supplied)', bp.count ? 'BOM' : 'אין BOM', true)}</div>
        <ul class="pc-stats">${st.map(([l, n, c]) => `<li>${c ? `<i class="sw c-${c}"></i>` : ''}<span>${l}</span><b class="${c === 'delayed' && n ? 't-late' : ''}">${fmtN(n)}</b></li>`).join('')}</ul>
      </div>
      <div class="pc-del"><span>אספקות</span><div class="hm-bar"><i style="--w:${delivery * 100}%"></i></div><b>${pct(delivery)}</b></div>
      ${worst.length ? `<div class="pc-asm"><span class="pc-asm-t">מכלולים שהכי רחוקים מהשלמה</span>${worst.map((a) => `<div class="pc-a"><span>${esc(a.name)}</span><div class="pbar"><div style="width:${pct(a.pct)}"></div></div><b>${pct(a.pct)}</b></div>`).join('')}</div>` : '<div class="pc-asm muted">עוד אין BOM לפרויקט</div>'}
    </button>`;
  }

  /* ================= מחיקת טבלה ================= */
  function clearTableDialog(ds, p) {
    const isBom = ds === 'bom';
    const rows = p ? (isBom ? D.bomLines(p) : D.projectRows(p)) : Store.rows(ds);
    const what = `${isBom ? 'טבלת ה-BOM' : 'טבלת ההזמנות'}${p ? ' של ' + p.name : ''}`;
    if (!rows.length) return UI.toast(`${what} כבר ריקה.`, 'info');
    const word = 'מחיקה';
    const body = document.createElement('div');
    body.innerHTML = `<div class="danger-box">${icon('alert', 20)}<div><b>${fmtN(rows.length)} שורות יימחקו מ${what}</b><span>המחיקה תעבור לכל המשתמשים ולכל המכשירים.</span></div></div>
      <label class="chk"><input type="checkbox" data-backup checked><span>להוריד קובץ אקסל עם כל השורות לפני המחיקה</span></label>
      ${!p ? `<label class="chk"><input type="checkbox" data-cols><span>למחוק גם את העמודות${isBom ? ' הנוספות' : ''} (כדי לייבא קובץ במבנה אחר)</span></label>` : ''}
      <label class="field"><span>כדי לאשר, הקלד <b>${word}</b></span><input type="text" data-confirm autocomplete="off"></label>`;
    UI.modal({
      title: `מחיקת ${what}`, body,
      actions: [{ label: 'ביטול' }, { label: 'מחיקת הטבלה', danger: true, icon: 'trash', action: async () => {
        if (body.querySelector('[data-confirm]').value.trim() !== word) throw new Error(`כדי לאשר צריך להקליד "${word}".`);
        if (body.querySelector('[data-backup]').checked) {
          const cols = Store.columns(ds);
          const blob = XlsxLite.writeXlsx([{ name: isBom ? 'BOM' : 'הזמנות', header: cols.map((c) => c.name), rows: rows.map((r) => cols.map((c) => { const v = r.c[c.id]; return c.type === 'date' ? Grid.util.fmtDate(String(v ?? '')) : v ?? ''; })), widths: cols.map((c) => c.width) }]);
          download(blob, `גיבוי ${what} ${D.today()}.xlsx`);
        }
        // לשוניות שלא יישאר להן כלום (לא הזמנות ולא BOM) יורדות
        if (!p) for (const pr of Store.projects()) {
          const other = isBom ? D.projectRows(pr).length : D.bomLines(pr).length;
          if (!other) { pr.deleted = true; Store.touch(pr); }
        }
        for (const r of rows) { r.deleted = true; Store.touch(r); }
        const dropCols = !p && body.querySelector('[data-cols]')?.checked;
        if (dropCols) {
          const keep = isBom ? new Set(Object.values(D.bomMapping())) : new Set();
          for (const c of Store.db.datasets[ds].columns) if (!c.deleted && !keep.has(c.id)) { c.deleted = true; Store.touch(c); }
          if (!isBom) { Store.db.settings.mapping = {}; Store.db.settings.updatedAt = Store.now(); }
        }
        Store.commit();
        S.catFilter = null;
        D.syncProjects();
        await Store.flush();
        renderTabs(); renderMain();
        UI.toast(`${what} נמחקה (${fmtN(rows.length)} שורות)${dropCols ? ', כולל העמודות' : ''}.`, 'ok', 5000);
      } }],
    });
  }

  /* ================= תצוגת טבלה: זום וגלישת טקסט ================= */
  function viewControls(i = 1) {
    return `<div class="tb-group view-ctl mt-i" style="--i:${i}" role="group" aria-label="תצוגת הטבלה">
      <button class="icon-btn" data-zoom="-" title="הקטנת הטבלה (Ctrl + −)" aria-label="הקטנה">${icon('zoomOut', 17)}</button>
      <button class="zoom-val" data-zoom="0" title="חזרה ל-100% (Ctrl + 0)">${Math.round(S.zoom * 100)}%</button>
      <button class="icon-btn" data-zoom="+" title="הגדלת הטבלה (Ctrl + +)" aria-label="הגדלה">${icon('zoomIn', 17)}</button>
      <button class="icon-btn${S.wrap ? ' on' : ''}" id="wrapBtn" aria-pressed="${S.wrap}" title="גלישת טקסט בתאים">${icon('wrap', 17)}</button>
    </div>
    <div class="tb-group mt-i" style="--i:${i + 1}"><button class="btn btn-ghost" id="viewBtn" title="גופן, גודל טקסט ויישור">${icon('font', 16)}<span>גופן ויישור</span></button></div>`;
  }
  function moreButton() {
    return `<button class="more-btn${S.moreOpen ? ' open' : ''}" id="moreBtn" type="button" aria-expanded="${!!S.moreOpen}" aria-controls="moreTools" title="כלים נוספים">${icon('more', 18)}<span>${S.moreOpen ? 'פחות' : 'כלים נוספים'}</span></button>`;
  }
  /** פתיחה/סגירה של סרגל הכלים הנוספים, עם אנימציה */
  function bindMore() {
    const btn = $('#moreBtn'), box = $('#moreTools'); if (!btn || !box) return;
    // מסתירים קבוצות שכל הכפתורים בהן מוסתרים (לפי הרשאות)
    box.querySelectorAll('.mt-i').forEach((gr) => { if (![...gr.children].some((c) => !c.hidden)) gr.hidden = true; });
    btn.onclick = () => {
      S.moreOpen = !S.moreOpen; sessionStorage.setItem('pt.more', S.moreOpen ? '1' : '');
      btn.classList.toggle('open', S.moreOpen); btn.setAttribute('aria-expanded', S.moreOpen);
      btn.querySelector('span').textContent = S.moreOpen ? 'פחות' : 'כלים נוספים';
      if (S.moreOpen) { box.hidden = false; box.classList.remove('closing'); box.classList.remove('opening'); void box.offsetWidth; box.classList.add('opening'); }
      else { box.classList.add('closing'); setTimeout(() => { if (!S.moreOpen) { box.hidden = true; box.classList.remove('closing'); } }, 220); }
    };
  }
  /* ---------- גופן, גודל ויישור לטבלה ---------- */
  const FONTS = [
    ['Rubik', 'Rubik — מודרני ועגול'], ['Heebo', 'Heebo — נקי וחד'], ['Assistant', 'Assistant — צר וקריא'],
    ['Noto Sans Hebrew', 'Noto Sans — ניטרלי'], ['Varela Round', 'Varela Round — רך'], ['Secular One', 'Secular One — מודגש'],
    ['Frank Ruhl Libre', 'Frank Ruhl — סריף קלאסי'], ['Arial', 'Arial — מערכת'],
  ];
  const loadedFonts = new Set(['Rubik', 'Arial']);
  function loadFont(f) {
    if (loadedFonts.has(f)) return; loadedFonts.add(f);
    const l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700&display=swap`;
    document.head.appendChild(l);
  }
  function applyView(g) {
    const v = S.view;
    loadFont(v.font);
    const host = g && g.host.querySelector('.grid-host');
    if (host) { host.style.setProperty('--cell-font', v.size + 'px'); host.style.setProperty('--cell-family', `"${v.font}", "Rubik", system-ui, sans-serif`); host.dataset.align = v.align; }
    if (!g) return;
    const sig = v.font + v.size + v.align;
    const changed = applyView.sig !== undefined && applyView.sig !== sig; applyView.sig = sig;
    if (changed) { g.hCache.clear(); g.refresh(true); }
    // גופן שעוד לא נטען: מחשבים גבהים מחדש פעם אחת אחרי שהוא מגיע
    if (document.fonts && !document.fonts.check(`14px "${v.font}"`)) document.fonts.load(`14px "${v.font}"`).then(() => { if (S.grid === g || g.host.isConnected) { g.hCache.clear(); g.refresh(true); } }).catch(() => {});
  }
  function viewDialog(g) {
    const v = S.view;
    const body = document.createElement('div');
    body.className = 'view-dlg';
    body.innerHTML = `
      <label class="field"><span>גופן</span><select data-font>${FONTS.map(([f, l]) => `<option value="${f}" ${v.font === f ? 'selected' : ''} style="font-family:'${f}'">${l}</option>`).join('')}</select></label>
      <label class="field"><span>גודל טקסט · <b data-sizev>${v.size}px</b></span><input type="range" min="11" max="22" step="1" value="${v.size}" data-size></label>
      <div class="field"><span>יישור הטקסט בתאים</span><div class="seg align-seg">${[['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל']].map(([k, l]) => `<button type="button" data-al="${k}" class="${v.align === k ? 'on' : ''}">${icon('align-' + k, 15)}<span>${l}</span></button>`).join('')}</div></div>
      <div class="view-preview" data-prev>מס׳ הזמנה 4500123 · <span class="chip c-delayed">בעיכוב</span> · הספק עדכן שהמשלוח יגיע בעוד שבועיים</div>
      <p class="muted sm-note">ההגדרות נשמרות במכשיר הזה בלבד. יישור לעמודה מסוימת: קליק ימני על הכותרת שלה.</p>`;
    const prev = body.querySelector('[data-prev]');
    const draw = () => { loadFont(v.font); prev.style.fontFamily = `"${v.font}", Rubik, sans-serif`; prev.style.fontSize = v.size + 'px'; prev.style.textAlign = v.align; body.querySelector('[data-sizev]').textContent = v.size + 'px'; };
    const save = () => { localStorage.setItem('pt.view', JSON.stringify(v)); applyView(g); draw(); };
    body.querySelector('[data-font]').onchange = (e) => { v.font = e.target.value; save(); };
    body.querySelector('[data-size]').oninput = (e) => { v.size = +e.target.value; save(); };
    body.querySelectorAll('[data-al]').forEach((b) => (b.onclick = () => { v.align = b.dataset.al; body.querySelectorAll('[data-al]').forEach((x) => x.classList.toggle('on', x === b)); save(); }));
    draw();
    UI.modal({ title: 'גופן, גודל ויישור בטבלה', body, actions: [
      { label: 'ברירת מחדל', action: () => { Object.assign(v, { font: 'Rubik', size: 14, align: 'center' }); save(); } },
      { label: 'סגירה', primary: true },
    ] });
  }
  function bindViewControls(g) {
    g.setZoom(S.zoom);
    applyView(g);
    bindMore();
    const vb = $('#viewBtn'); if (vb) vb.onclick = () => viewDialog(g);
    document.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => {
      const d = b.dataset.zoom;
      g.setZoom(d === '0' ? 1 : g.z + (d === '+' ? 0.1 : -0.1));
    }));
    const w = $('#wrapBtn');
    if (w) w.onclick = () => {
      S.wrap = !S.wrap; localStorage.setItem('pt.wrap', S.wrap ? '1' : '0');
      w.classList.toggle('on', S.wrap); w.setAttribute('aria-pressed', S.wrap);
      g.hCache.clear(); g.refresh(true);
      UI.toast(S.wrap ? 'גלישת טקסט פעילה — שורות ארוכות מתרחבות לגובה' : 'גלישת טקסט כבויה', 'info', 2500);
    };
  }
  function zoomChanged(z) {
    S.zoom = z; localStorage.setItem('pt.zoom', String(z));
    const v = document.querySelector('.zoom-val'); if (v) v.textContent = Math.round(z * 100) + '%';
  }

  /* ================= עזרים ================= */
  /** מסתיר כפתורים שהתפקיד הנוכחי לא מורשה להם */
  function applyCaps(map) { for (const [id, cap] of Object.entries(map)) { const el = document.getElementById(id); if (el && !D.can(cap)) el.hidden = true; } }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** מונים שעולים מ-0 לערך — רק בכניסה לתצוגה */
  function countUp(root, anim) {
    const els = root.querySelectorAll('[data-count]');
    if (!anim || reduceMotion()) return;
    els.forEach((el, i) => {
      const to = +el.dataset.count; const suf = el.dataset.suffix || '';
      if (!to) return;
      const dur = 900, delay = 120 + i * 25, t0 = performance.now() + delay;
      el.textContent = '0' + suf;
      const tick = (t) => {
        const k = Math.min(1, Math.max(0, (t - t0) / dur));
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmtN(Math.round(to * e)) + suf;
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  /** גל לחיצה על כפתורים וכרטיסים */
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.btn, .kpi[data-cf], .tab, .asm, .seg button, .user-btn, .menu-item');
    if (!t || reduceMotion()) return;
    const r = t.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const sp = document.createElement('span');
    sp.className = 'ripple';
    sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    t.appendChild(sp);
    setTimeout(() => sp.remove(), 650);
  });
  /** גרירת קובץ אקסל לכל מקום במסך */
  let dropBound = false;
  function bindDrop() {
    if (dropBound) return; dropBound = true;
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const zone = () => $('#dropZone');
    const canImport = () => { const p = currentProject(); return Store.currentUser() && D.can('import') && $('#main') && (!p || Store.isUnlocked(p.id)); };
    document.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !canImport()) return; depth++; const z = zone(); if (z) { z.hidden = false; requestAnimationFrame(() => z.classList.add('in')); } });
    document.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) { const z = zone(); z && (z.classList.remove('in'), (z.hidden = true)); } });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0;
      const z = zone(); z && (z.classList.remove('in'), (z.hidden = true));
      const f = e.dataTransfer.files[0];
      if (!f || !canImport()) return;
      const p = currentProject();
      importFile(S.route.tab === 'bom' || S.route.sub === 'bom' ? 'bom' : 'orders', p, f);
    });
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  let tipEl = null;
  function bindTips(root) {
    root.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { if (tipEl) tipEl.hidden = true; return; }
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
      tipEl.hidden = false; tipEl.textContent = t.dataset.tip;
      const w = tipEl.offsetWidth;
      tipEl.style.left = Math.min(innerWidth - w - 8, Math.max(8, e.clientX - w / 2)) + 'px';
      tipEl.style.top = e.clientY - 40 + 'px';
    });
    root.addEventListener('mouseleave', () => { if (tipEl) tipEl.hidden = true; });
  }
  /** סמל המערכת: מאוורר מנוע בקו טכני */
  function fanSvg(size, big) {
    const blades = big ? 22 : 12; let b = '';
    for (let i = 0; i < blades; i++) {
      const a = (i * 360) / blades;
      b += `<path d="M50 50 C ${big ? '58 38, 62 22, 57 9' : '58 40, 61 26, 56 12'}" transform="rotate(${a} 50 50)"/>`;
    }
    return `<svg class="logo-fan${big ? ' big' : ''}" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="${big ? 0.7 : 4}" stroke-linecap="round" aria-hidden="true">
      <circle cx="50" cy="50" r="${big ? 47 : 44}"/>${big ? '<circle cx="50" cy="50" r="41" stroke-dasharray="1 2.2"/>' : ''}${b}<circle cx="50" cy="50" r="${big ? 9 : 11}" fill="currentColor" stroke="none"/></svg>`;
  }

  window.addEventListener('beforeunload', (e) => {
    if (Store.cfg && Store.cfg.mode === 'github' && (Store.status.status === 'saving')) { e.preventDefault(); e.returnValue = ''; }
  });
  start();
})();
