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
  const fmtN = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const pct = (x) => Math.round(x * 100) + '%';

  const S = {
    route: { tab: 'main', sub: 'orders' },
    grid: null,
    catFilter: null,
    newDays: 7,
    density: localStorage.getItem('pt.density') || 'normal',
    expanded: null,
    newTabs: new Set(),
  };
  const rowHeight = () => DENSITY[S.density] || 36;

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
            <li>תחת Repository access בחר <b>רק</b> את מאגר הנתונים.</li>
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
    mode = mode || (hasUsers ? 'login' : 'register');
    app.innerHTML = `
    <div class="gate">
      <section class="gate-art" aria-hidden="true">${fanSvg(340, true)}
        <div class="gate-caption"><b>מעקב הזמנות רכש</b><span>${Store.cfg.mode === 'github' ? 'מחובר ל-' + esc(Store.cfg.owner + '/' + Store.cfg.repo) : 'מצב ניסיון מקומי'}</span></div>
      </section>
      <section class="gate-form">
        <form class="card form-card" id="authForm" autocomplete="on">
          <div class="seg" role="tablist">
            <button type="button" role="tab" data-m="login" class="${mode === 'login' ? 'on' : ''}">כניסה</button>
            <button type="button" role="tab" data-m="register" class="${mode === 'register' ? 'on' : ''}">הרשמה ראשונית</button>
          </div>
          <h1>${mode === 'login' ? 'כניסת עורכים' : 'יצירת משתמש עורך'}</h1>
          <p class="muted">${mode === 'login' ? 'היכנס עם השם והסיסמה שקבעת בהרשמה.' : 'פעם אחת בלבד: שם, שם משפחה וסיסמה. אחרי זה נכנסים מכל מכשיר מחובר.'}</p>
          <div class="grid2">
            <label class="field"><span>שם פרטי</span><input name="first" required autocomplete="given-name"></label>
            <label class="field"><span>שם משפחה</span><input name="last" required autocomplete="family-name"></label>
          </div>
          <label class="field"><span>סיסמה</span><input name="pw" type="password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
          ${mode === 'register' ? '<label class="field"><span>אימות סיסמה</span><input name="pw2" type="password" required autocomplete="new-password"></label>' : '<label class="chk"><input type="checkbox" name="remember" checked><span>להישאר מחובר במכשיר הזה</span></label>'}
          <div class="form-actions"><button class="btn btn-primary" type="submit">${icon(mode === 'login' ? 'user' : 'plus', 16)}<span>${mode === 'login' ? 'כניסה' : 'הרשמה וכניסה'}</span></button></div>
          <p class="form-msg err" role="alert"></p>
          <button type="button" class="link-btn" id="toSetup">${icon('settings', 14)} הגדרות חיבור</button>
        </form>
      </section>
    </div>`;
    app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.m)));
    $('#toSetup').addEventListener('click', () => renderSetup());
    const f = $('#authForm');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      const msg = $('.form-msg', f);
      try {
        await Store.syncNow();
        if (mode === 'register') {
          if (fd.pw !== fd.pw2) throw new Error('הסיסמאות אינן תואמות.');
          Store.register(fd.first, fd.last, fd.pw);
          await Store.syncNow();
          Store.login(fd.first, fd.last, fd.pw, true);
        } else Store.login(fd.first, fd.last, fd.pw, !!fd.remember);
        renderShell();
      } catch (err) { msg.textContent = err.message; }
    });
  }

  /* ================= מעטפת ================= */
  function renderShell() {
    const u = Store.currentUser();
    try { const saved = JSON.parse(sessionStorage.getItem('pt.route')); if (saved) S.route = saved; } catch { }
    app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">${fanSvg(26)}<div><b>מעקב הזמנות</b><span>רכש · ${Store.cfg.mode === 'github' ? esc(Store.cfg.repo) : 'מקומי'}</span></div></div>
        <nav class="tabs" id="tabs" role="tablist" aria-label="לשוניות"></nav>
        <div class="top-actions">
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
    D.syncProjects();
    renderTabs();
    renderMain();
    updateSync();
    bindDrop();
  }
  function go(tab, sub) {
    S.route = { tab, sub: sub || (tab === 'main' ? 'orders' : (S.route.tab === tab ? S.route.sub : 'dashboard')) };
    S.catFilter = null;
    sessionStorage.setItem('pt.route', JSON.stringify(S.route));
    renderTabs(); renderMain();
  }
  function currentProject() { return S.route.tab === 'main' ? null : Store.projects().find((p) => p.id === S.route.tab); }

  function renderTabs() {
    const el = $('#tabs'); if (!el) return;
    const projects = Store.projects();
    const all = Store.rows('orders').length;
    let h = `<button class="tab ${S.route.tab === 'main' ? 'on' : ''}" data-tab="main" role="tab">${icon('table', 15)}<span>טבלה מרכזית</span><em>${all}</em></button>`;
    for (const p of projects) {
      const n = D.projectRows(p).length;
      const locked = !Store.isUnlocked(p.id);
      h += `<button class="tab ${S.route.tab === p.id ? 'on' : ''}${S.newTabs.has(p.id) ? ' pop' : ''}" data-tab="${p.id}" role="tab" style="--pc:${p.color}"><i class="pdot"></i><span>${esc(p.name)}</span>${locked ? `<span class="lock" title="נעול">${icon('lock', 12)}</span>` : `<em>${n}</em>`}</button>`;
    }
    h += `<button class="tab tab-add" id="addProject" title="פרויקט חדש" aria-label="פרויקט חדש">${icon('plus', 16)}</button>`;
    el.innerHTML = h;
    el.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => go(b.dataset.tab));
      if (b.dataset.tab !== 'main') b.addEventListener('contextmenu', (e) => { e.preventDefault(); projectMenu(b.dataset.tab, e.clientX, e.clientY); });
    });
    $('#addProject').addEventListener('click', addProjectFlow);
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
    const p = Store.projects().find((q) => q.id === pid); if (!p) return;
    UI.menu(x, y, [
      { title: p.name },
      { label: 'שינוי שם…', icon: 'edit', action: () => renameProject(p) },
      { label: 'החלפת צבע', icon: 'layers', action: () => { const i = D.PROJECT_COLORS.indexOf(p.color); p.color = D.PROJECT_COLORS[(i + 1) % D.PROJECT_COLORS.length]; Store.touch(p); Store.commit(); renderTabs(); } },
      { label: 'הזזה ימינה', icon: 'chevron', action: () => moveProject(p, -1) },
      { label: 'הזזה שמאלה', icon: 'chevron', action: () => moveProject(p, 1) },
      { sep: true },
      { label: D.projectRows(p).length ? 'הלשונית יורדת לבד כשאין לה הזמנות' : 'הסרת הלשונית', icon: 'trash', danger: true, disabled: D.projectRows(p).length > 0, action: () => { p.deleted = true; Store.touch(p); Store.commit(); go('main'); } },
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
    const name = await UI.prompt('שינוי שם פרויקט', 'שם חדש ללשונית. השם יתעדכן גם בכל ההזמנות של הפרויקט, והוא גם הסיסמה של הלשונית.', p.name);
    if (!name || name === p.name) return;
    if (Store.projects().some((q) => q !== p && D.norm(q.name) === D.norm(name))) return UI.toast('כבר קיים פרויקט בשם הזה.', 'error');
    const n = D.renameProject(p, name);
    renderTabs(); renderMain();
    UI.toast(`שם הפרויקט עודכן${n ? ` ב-${n} הזמנות` : ''}. הסיסמה של הלשונית היא עכשיו השם החדש.`, 'ok', 4500);
  }
  /** אחרי כל שינוי בהזמנות: יישור הלשוניות לעמודת הפרויקט */
  function afterOrdersChange() {
    const before = currentProject();
    const r = D.syncProjects();
    r.created.forEach((x) => S.newTabs.add(x.id));
    if (r.created.length) UI.toast(`נפתחה לשונית חדשה: ${r.created.map((x) => x.name).join(', ')}`, 'ok');
    renderTabs();
    if (!r.changed) return;
    if (S.route.tab !== 'main' && !currentProject()) { UI.toast('הפרויקט כבר לא מופיע בטבלה, לכן הלשונית שלו הוסרה.', 'info', 5000); return go('main'); }
    if (before) { const h = $('.vh-title h1'); if (h) h.textContent = before.name; }
    S.grid && S.grid.refresh(true);
  }

  function userMenu(btn) {
    const r = btn.getBoundingClientRect();
    const u = Store.currentUser();
    UI.menu(r.right, r.bottom + 6, [
      { title: `${u.first} ${u.last}` },
      Store.cfg.mode === 'github' ? { label: 'קישור חיבור למכשיר נוסף', icon: 'link', action: shareLink } : { label: 'חיבור לגיטהאב (סנכרון בין מכשירים)', icon: 'cloud', action: () => renderSetup() },
      { label: 'עורכים רשומים', icon: 'user', action: usersDialog },
      { label: 'גיבוי נתונים (JSON)', icon: 'download', action: () => download(new Blob([Store.exportJson()], { type: 'application/json' }), `procurement-backup-${D.today()}.json`) },
      { label: 'שחזור ממגיבוי…', icon: 'upload', action: () => pickFile('.json', async (f) => { Store.importJson(await f.text()); renderTabs(); renderMain(); UI.toast('הגיבוי מוזג לנתונים', 'ok'); }) },
      Store.cfg.mode === 'github' ? { label: 'הגדרות חיבור', icon: 'settings', action: () => renderSetup() } : null,
      { sep: true },
      { label: 'יציאה', icon: 'logout', action: () => { Store.logout(); renderAuth('login'); } },
    ]);
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
  function usersDialog() {
    const users = Store.db.users.filter((u) => !u.deleted);
    UI.modal({
      title: 'עורכים רשומים',
      body: `<table class="mini-table"><thead><tr><th>שם</th><th>נרשם</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.first + ' ' + u.last)}</td><td>${new Date(u.createdAt).toLocaleDateString('he-IL')}</td></tr>`).join('')}</tbody></table>`,
      actions: [{ label: 'סגירה' }],
    });
  }

  /* ================= סנכרון ================= */
  function updateSync() {
    const el = $('#syncPill'); if (!el) return;
    const s = Store.status;
    const map = { synced: ['cloud', 'מסונכרן'], saving: ['refresh', 'שומר…'], offline: ['cloudOff', 'לא מקוון'], error: ['alert', 'שגיאת סנכרון'], local: ['box', 'שמירה מקומית'], idle: ['cloud', ''] };
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
    if (S.route.tab !== 'main' && !currentProject()) return go('main');
    if (S.grid && S.route.sub !== 'dashboard') { S.grid.refresh(true, true); if (S.route.sub === 'bom') renderBomSummary(); }
    else renderMain(false);
  }

  /* ================= אזור ראשי ================= */
  function renderMain(anim = true) {
    const main = $('#main'); if (!main) return;
    if (S.grid) { S.grid.destroy(); S.grid = null; }
    const p = currentProject();
    if (S.route.tab !== 'main' && !p) { S.route = { tab: 'main', sub: 'orders' }; return renderMain(); }
    if (p && !Store.isUnlocked(p.id)) return renderLock(main, p);
    const subs = p
      ? [['dashboard', 'chart', 'דשבורד'], ['orders', 'table', 'הזמנות'], ['bom', 'layers', 'BOM ומכלולים']]
      : [['orders', 'table', 'כל ההזמנות'], ['overview', 'chart', 'סקירת פרויקטים']];
    if (!subs.some((s) => s[0] === S.route.sub)) S.route.sub = subs[0][0];
    main.innerHTML = `
      <div class="view-head">
        <div class="vh-title">${p ? `<i class="pdot lg" style="--pc:${p.color}"></i><h1>${esc(p.name)}</h1>` : '<h1>טבלה מרכזית</h1>'}</div>
        <div class="seg sub" role="tablist">${subs.map(([k, ic, l]) => `<button type="button" role="tab" data-sub="${k}" class="${S.route.sub === k ? 'on' : ''}">${icon(ic, 15)}<span>${l}</span></button>`).join('')}</div>
      </div>
      <div class="view${anim ? ' enter' : ' static'}" id="view"></div>`;
    main.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => go(S.route.tab, b.dataset.sub)));
    const v = $('#view');
    if (S.route.sub === 'orders') renderOrders(v, p);
    else if (S.route.sub === 'dashboard') renderDashboard(v, p);
    else if (S.route.sub === 'bom') renderBom(v, p);
    else if (S.route.sub === 'overview') renderOverview(v);
    if (S.route.sub !== 'orders' && S.route.sub !== 'bom') setStatus('');
    countUp(v, anim);
  }

  function renderLock(main, p) {
    main.innerHTML = `<div class="lock-screen"><form class="card form-card narrow" id="lockForm">
      <div class="lock-ic" style="--pc:${p.color}">${icon('lock', 26)}</div>
      <h1>${esc(p.name)}</h1><p class="muted">הלשונית מוגנת. הסיסמה היא שם הפרויקט.</p>
      <label class="field"><span>סיסמת הלשונית</span><input type="password" name="pw" required autocomplete="off"></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('lock', 16)}<span>פתיחת הלשונית</span></button></div>
      <p class="form-msg err" role="alert"></p></form></div>`;
    const f = $('#lockForm');
    setTimeout(() => f.pw.focus(), 50);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (D.norm(f.pw.value) === D.norm(p.name)) { Store.unlock(p.id); renderTabs(); renderMain(); }
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
          <button class="icon-btn" id="bulk" title="הזנת ערך לכל המסומנים (Ctrl+Enter)" aria-label="הזנה מרובה">${icon('wand', 17)}</button>
          <button class="icon-btn" id="del" title="מחיקת שורות מסומנות" aria-label="מחיקה">${icon('trash', 17)}</button>
        </div>
        <div class="tb-group">
          <button class="btn btn-ghost" id="colsBtn">${icon('columns', 16)}<span>עמודות</span></button>
          <button class="btn btn-ghost" id="statusBtn">${icon('check', 16)}<span>סטטוסים</span></button>
          <button class="icon-btn" id="density" title="צפיפות שורות" aria-label="צפיפות">${icon('height', 17)}</button>
        </div>
        <div class="chips" id="chips"></div>
      </div>
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
      rowHeight,
      filter: (row) => (!p || D.inProject(row, p)) && (!S.catFilter || catMatch(row, S.catFilter)),
      defaults: () => (p && m.project ? { [m.project]: p.name } : {}),
      colRole: (id) => D.roleOf(id),
      decorate: decorateOrder(p),
      onStats: (s) => setStatus(statsText(s)),
      onChange: afterOrdersChange,
      onFilter: () => renderChips(),
      columnMenuExtra: (col) => [{ label: 'תפקיד העמודה…', icon: 'link', action: () => columnsDialog(col.id) }],
      emptyHtml: p
        ? `<div><b>אין עדיין הזמנות בפרויקט ${esc(p.name)}</b><p>${m.project ? `שורות שבעמודת "${esc(colName(m.project))}" כתוב בהן "${esc(p.name)}" יופיעו כאן אוטומטית. אפשר גם להוסיף שורה חדשה.` : 'עוד לא הוגדרה עמודת פרויקט. פתח "עמודות" וסמן איזו עמודה מציינת את הפרויקט.'}</p></div>`
        : '<div><b>אין הזמנות</b><p>הוסף שורה או ייבא קובץ אקסל.</p></div>',
    });
    S.grid = g;
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
      if (col.id === m.due && D.isOverdue(row)) return { cls: 'overdue' };
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
  function renderChips() {
    const el = $('#chips'); if (!el || !S.grid) return;
    const g = S.grid; let h = '';
    if (S.catFilter) h += `<button class="fchip" data-cf>${esc(CF_LABEL[S.catFilter])} ${icon('x', 12)}</button>`;
    for (const cid of Object.keys(g.filters)) { const c = g.allCols.find((x) => x.id === cid); if (c) h += `<button class="fchip" data-f="${cid}">${icon('filter', 12)} ${esc(c.name)} ${icon('x', 12)}</button>`; }
    if (g.sort) { const c = g.allCols.find((x) => x.id === g.sort.colId); if (c) h += `<button class="fchip" data-s>${icon(g.sort.dir > 0 ? 'sortAsc' : 'sortDesc', 12)} ${esc(c.name)} ${icon('x', 12)}</button>`; }
    el.innerHTML = h;
    el.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => { S.catFilter = null; g.refresh(); renderChips(); }));
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
  function columnsDialog(focusId) {
    const cols = Store.columns('orders');
    const m = D.mapping();
    const roleSel = (cid) => `<select data-role="${cid}"><option value="">—</option>${D.ROLES.map((r) => `<option value="${r.key}" ${m[r.key] === cid ? 'selected' : ''}>${r.label}</option>`).join('')}</select>`;
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
      title: 'עמודות הטבלה', body, wide: true,
      actions: [{ label: 'ביטול' }, { label: 'שמירה', primary: true, icon: 'check', action: () => {
        const rows = [...list.querySelectorAll('.col-row')];
        const mapping = {};
        rows.forEach((el, i) => {
          const id = el.dataset.id;
          let c = Store.db.datasets.orders.columns.find((x) => x.id === id);
          if (!c) { c = { id, width: 140 }; Store.db.datasets.orders.columns.push(c); }
          const name = $('[data-name]', el).value.trim() || 'עמודה';
          const type = $('[data-type]', el).value;
          const hidden = !$('[data-vis]', el).checked;
          if (c.name !== name || c.type !== type || !!c.hidden !== hidden || c.order !== i) { Object.assign(c, { name, type, hidden, order: i }); Store.touch(c); }
          const role = $('[data-role]', el).value; if (role) mapping[role] = id;
        });
        Store.db.settings.mapping = mapping; Store.db.settings.updatedAt = Store.now();
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
    const busy = UI.busy('קורא את ' + file.name + '…');
    let sheets;
    try { sheets = await XlsxLite.readFile(file); }
    catch (e) { busy(); console.error(e); return UI.toast(e.message || 'לא הצלחתי לקרוא את הקובץ.', 'error', 9000); }
    busy();
    sheets = sheets.filter((s) => s.rows.some((r) => r && r.some((v) => v !== '' && v != null)));
    if (!sheets.length) return UI.toast('לא נמצאו נתונים בקובץ.', 'error');
    importDialog(ds, p, file.name, sheets);
  }
  function detectHeader(rows) {
    let best = 0, bestN = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i] || [];
      const n = r.filter((v) => typeof v === 'string' && v.trim()).length;
      if (n > bestN) { bestN = n; best = i; }
    }
    return best;
  }
  function importDialog(ds, p, fname, sheets) {
    const isBom = ds === 'bom';
    let si = 0;
    const body = document.createElement('div');
    body.className = 'import-dlg';
    const existing = Store.rows('orders').length;
    const draw = () => {
      const sh = sheets[si];
      const hr = +($('[data-hr]', body)?.value ?? detectHeader(sh.rows));
      const headers = (sh.rows[hr] || []).map((h, i) => String(h ?? '').trim() || `עמודה ${i + 1}`);
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
        ${isBom ? `<div class="grid4">${D.BOM_ROLES.map((r) => `<label class="field"><span>${r.label}</span><select data-bom="${r.key}"><option value="">—</option>${headers.map((h, i) => `<option value="${i}" ${bomGuess[r.key] === String(i) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>
          <label class="chk"><input type="checkbox" data-replacebom checked><span>להחליף את ה-BOM הקיים של ${esc(p.name)}</span></label>` : ''}
        ${!isBom && newHeaders.length && cols.length ? `<p class="note">${icon('plus', 14)} עמודות חדשות שיתווספו לטבלה: ${newHeaders.map(esc).join(', ')}</p>` : ''}
        <div class="preview"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${prev.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $('[data-sheet]', body).onchange = (e) => { si = +e.target.value; body.innerHTML = ''; draw(); };
      $('[data-hr]', body).onchange = () => draw();
      const ms = $('[data-mode]', body); const kw = $('[data-keywrap]', body);
      if (ms && kw) { const t = () => (kw.hidden = ms.value !== 'upsert'); ms.onchange = t; t(); }
    };
    draw();
    UI.modal({
      title: isBom ? `ייבוא BOM · ${p.name}` : 'ייבוא קובץ אקסל', body, wide: true,
      actions: [{ label: 'ביטול' }, { label: 'ייבוא', primary: true, icon: 'upload', action: async () => {
        const sh = sheets[si]; const hr = +$('[data-hr]', body).value;
        const headers = (sh.rows[hr] || []).map((h, i) => String(h ?? '').trim() || `עמודה ${i + 1}`);
        const data = sh.rows.slice(hr + 1).filter((r) => r && r.some((v) => v !== '' && v != null));
        if (isBom) {
          const map = {}; body.querySelectorAll('[data-bom]').forEach((s) => (map[s.dataset.bom] = s.value));
          if (map.assembly === '' || map.part === '') throw new Error('צריך לבחור לפחות את עמודות המכלול והמק"ט.');
          importBom(p, data, map, $('[data-replacebom]', body).checked);
        } else {
          const mode = $('[data-mode]', body).value;
          const keys = [...($('[data-key]', body)?.selectedOptions || [])].map((o) => +o.value);
          if (mode === 'upsert' && !keys.length) throw new Error('בחר לפחות עמודת מפתח אחת.');
          setTimeout(() => importOrders(headers, data, mode, keys, p).catch((e) => UI.toast(e.message, 'error', 6000)), 0);
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
  async function importOrders(headers, data, mode, keyIdx, p) {
    const dsObj = Store.db.datasets.orders;
    const cols = Store.columns('orders');
    const byName = new Map(cols.map((c) => [D.norm(c.name), c]));
    const firstImport = !Store.rows('orders').length;
    let order = cols.length;
    const colFor = headers.map((h, i) => {
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
    const keyOf = (vals) => keyIdx.map((i) => D.norm(vals(i))).join('¦');
    const index = new Map();
    if (mode === 'upsert') for (const r of Store.rows('orders')) { const k = keyOf((i) => r.c[colFor[i].id]); if (k.replace(/¦/g, '')) index.set(k, r); }
    for (const line of data) {
      let row = mode === 'upsert' ? index.get(keyOf((i) => line[i])) : null;
      if (row) {
        let changed = false;
        colFor.forEach((c, i) => { const v = convert(c, line[i]); if ((row.c[c.id] ?? '') !== v) { row.c[c.id] = v; changed = true; } });
        if (changed) { Store.touch(row); updated++; }
      } else {
        row = { id: Store.uid(), c: {}, o: ++maxO, createdAt: Store.now() };
        if (firstImport || mode === 'replace') row.imp = 1;
        colFor.forEach((c, i) => { row.c[c.id] = convert(c, line[i]); });
        if (p && m.project && !row.c[m.project]) row.c[m.project] = p.name;
        Store.touch(row); dsObj.rows.push(row); created++;
      }
    }
    Store.commit();
    UI.toast(`ייבוא הושלם: ${created} שורות חדשות${updated ? `, ${updated} עודכנו` : ''}`, 'ok', 4500);
    // לשוניות הפרויקט נבנות אוטומטית מעמודת הפרויקט
    const r = D.syncProjects();
    r.created.forEach((x) => S.newTabs.add(x.id));
    if (r.created.length) setTimeout(() => UI.toast(`נפתחו ${r.created.length} לשוניות פרויקט: ${r.created.map((x) => x.name).join(', ')}`, 'ok', 5000), 400);
    else if (!m.project) setTimeout(() => UI.toast('כדי לפתוח לשוניות פרויקט, סמן ב"עמודות" איזו עמודה מציינת את הפרויקט.', 'info', 6000), 400);
    renderTabs(); renderMain();
  }
  function importBom(p, data, map, replace) {
    const ds = Store.db.datasets.bom;
    const bm = D.bomMapping();
    if (replace) for (const r of D.bomLines(p)) { r.deleted = true; Store.touch(r); }
    let o = D.bomLines(p).reduce((a, r) => Math.max(a, r.o || 0), 0);
    let n = 0;
    for (const line of data) {
      const get = (k) => (map[k] === '' || map[k] == null ? '' : line[+map[k]] ?? '');
      if (!String(get('part')).trim() && !String(get('assembly')).trim()) continue;
      const row = { id: Store.uid(), p: p.id, o: ++o, createdAt: Store.now(), c: {} };
      row.c[bm.assembly] = get('assembly'); row.c[bm.part] = get('part'); row.c[bm.desc] = get('desc');
      const q = get('qty'); row.c[bm.qty] = q === '' ? '' : (+q || q);
      Store.touch(row); ds.rows.push(row); n++;
    }
    Store.commit();
    UI.toast(`נקלטו ${n} שורות BOM`, 'ok');
    renderMain();
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
  const KPI_IC = { all: 'box', notDone: 'cloud', supplied: 'check', closed: 'lock', delayed: 'alert', new: 'plus' };
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
  function ring(pctVal, size, color, label) {
    const r = size / 2 - 9;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-val${Math.round(pctVal * 100) ? '' : ' zero'}" pathLength="100" style="--v:${Math.round(pctVal * 100)};stroke:${color}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg><span class="ring-c"><b data-count="${Math.round(pctVal * 100)}" data-suffix="%">${Math.round(pctVal * 100)}%</b><em>${label}</em></span>`;
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
    v.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => { S.route.sub = 'orders'; sessionStorage.setItem('pt.route', JSON.stringify(S.route)); renderMain(); S.catFilter = b.dataset.cf === 'all' ? null : b.dataset.cf; S.grid && (S.grid.refresh(), renderChips()); }));
    v.querySelectorAll('[data-nd]').forEach((b) => (b.onclick = () => { S.newDays = +b.dataset.nd; renderMain(false); }));
    v.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(p.id, b.dataset.go)));
    v.querySelectorAll('[data-asm]').forEach((b) => (b.onclick = () => asmDialog(p, b.dataset.asm)));
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
    if (!m.supplier) return '<p class="muted pad">הגדר עמודת "ספק" כדי לראות פילוח לפי ספק.</p>';
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
  function bomOverview(bp) {
    const asms = [...bp.assemblies].sort((a, b) => a.pct - b.pct);
    const tot = { done: 0, ordered: 0, late: 0, missing: 0 };
    asms.forEach((a) => Object.keys(tot).forEach((k) => (tot[k] += a.cnt[k])));
    return `<div class="bom-head"><div class="bom-overall"><b data-count="${Math.round(bp.overall * 100)}" data-suffix="%">${pct(bp.overall)}</b><span>השלמה כוללת · ${fmtN(bp.count)} מק"טים ב-${asms.length} מכלולים</span></div>
      <ul class="legend inline">${Object.entries(D.LINE_STATE).map(([k, s]) => `<li><i class="sw ${k === 'missing' ? 'c-missing' : 'c-' + s.cls}"></i><span>${s.label}</span><b>${tot[k]}</b></li>`).join('')}</ul></div>
      <div class="asm-grid">${asms.map((a, i) => `
        <button class="asm" type="button" data-asm="${esc(a.name)}" style="--d:${i}">
          <div class="asm-g">${fanGauge(a)}<b class="asm-p" data-count="${Math.round(a.pct * 100)}" data-suffix="%">${pct(a.pct)}</b></div>
          <div class="asm-t"><b>${esc(a.name)}</b><span>${a.cnt.done}/${a.items.length} מק"טים סופקו${a.cnt.late ? ` · <em class="t-late">${a.cnt.late} בעיכוב</em>` : ''}${a.cnt.missing ? ` · ${a.cnt.missing} לא הוזמנו` : ''}</span></div>
        </button>`).join('')}</div>`;
  }
  function asmDialog(p, name) {
    const bp = D.bomProgress(p);
    const a = bp.assemblies.find((x) => x.name === name); if (!a) return;
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

  /* ================= BOM ================= */
  function renderBom(v, p) {
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
          <button class="icon-btn" id="undo" title="ביטול">${icon('undo', 17)}</button>
          <button class="icon-btn" id="redo" title="חזרה">${icon('redo', 17)}</button>
          <button class="icon-btn" id="del" title="מחיקת שורות">${icon('trash', 17)}</button>
        </div>
        <div class="chips"><span class="muted sm-note">ההשלמה מחושבת לפי התאמת מק"ט להזמנות של ${esc(p.name)}</span></div>
      </div>
      <div class="grid-area" id="gridArea"></div>`;
    let cache = null;
    const prog = () => (cache ||= D.bomProgress(p));
    const virt = [
      { id: '_st', name: 'מצב אספקה', width: 120, type: 'text', virtual: true, get: (r) => { const i = prog().lines.get(r.id); return i ? D.LINE_STATE[i.state].label : ''; } },
      { id: '_got', name: 'סופק', width: 80, type: 'number', virtual: true, get: (r) => { const i = prog().lines.get(r.id); return i && isFinite(i.got) ? i.got : i ? i.req : ''; } },
      { id: '_ord', name: 'הזמנות מקושרות', width: 180, type: 'text', virtual: true, get: (r) => { const i = prog().lines.get(r.id); const m = D.mapping(); return i ? i.orders.map((o) => o.c[m.order]).filter(Boolean).join(', ') : ''; } },
    ];
    const g = new Grid($('#gridArea'), {
      dataset: 'bom', label: 'BOM ' + p.name, rowHeight,
      filter: (r) => r.p === p.id,
      rowProps: () => ({ p: p.id }),
      virtualCols: () => { cache = null; return virt; },
      decorate: (row, col, v, txt) => {
        if (col.id === '_st' && txt) { const i = prog().lines.get(row.id); return { cls: 'has-chip', html: `<span class="chip ${i.state === 'missing' ? 'c-missing' : 'c-' + D.LINE_STATE[i.state].cls}">${esc(txt)}</span>` }; }
        if (col.virtual) return { cls: 'virtual' };
        return null;
      },
      onStats: (s) => setStatus(statsText(s)),
      onChange: () => { cache = null; renderBomSummary(); },
      emptyHtml: `<div><b>אין עדיין BOM לפרויקט</b><p>ייבא קובץ BOM עם עמודות מכלול, מק"ט וכמות — או הוסף שורות ידנית.</p></div>`,
    });
    S.grid = g; S.bomProject = p;
    $('#q').addEventListener('input', debounce((e) => g.setSearch(e.target.value), 180));
    $('#addRow').onclick = () => { g.appendRows(1); g.focus(); };
    $('#imp').onclick = () => importFlow('bom', p);
    $('#exp').onclick = () => exportGrid(g, 'BOM ' + p.name);
    $('#undo').onclick = () => g.undo(); $('#redo').onclick = () => g.redo(); $('#del').onclick = () => g.deleteSelectedRows();
    renderBomSummary();
  }
  function renderBomSummary() {
    const el = $('#bomSummary'); const p = currentProject(); if (!el || !p) return;
    const bp = D.bomProgress(p);
    el.innerHTML = bp.count ? `<section class="card panel">${bomOverview(bp)}</section>` : '';
    countUp(el, true);
    el.querySelectorAll('[data-asm]').forEach((b) => (b.onclick = () => asmDialog(p, b.dataset.asm)));
  }

  /* ================= סקירת פרויקטים ================= */
  function renderOverview(v) {
    const ps = Store.projects();
    const all = D.stats(Store.rows('orders'), S.newDays);
    v.innerHTML = `
      ${kpiCards([['all', 'כל ההזמנות', all.total, `ב-${ps.length} פרויקטים`], ['notDone', 'פתוחות', all.notDone, ''], ['supplied', 'סופקו', all.supplied, ''], ['closed', 'סגורות', all.closed, ''], ['delayed', 'בעיכוב', all.delayed, ''], ['new', 'חדשות', all.newer, `ב-${S.newDays} הימים האחרונים`]], all.total, false)}
      <section class="card panel">
        <header class="ph"><h2>השוואת פרויקטים</h2></header>
        ${ps.length ? `<div class="table-wrap"><table class="ov-table"><thead><tr><th>פרויקט</th><th>הזמנות</th><th>פתוחות</th><th>סופקו</th><th>סגורות</th><th>בעיכוב</th><th>חדשות</th><th class="w-bar">התפלגות</th><th>השלמת BOM</th></tr></thead><tbody>
        ${ps.map((p) => {
          const s = D.stats(D.projectRows(p), S.newDays); const bp = D.bomProgress(p);
          const parts = D.CAT_ORDER.filter((k) => s[k]);
          return `<tr data-p="${p.id}" style="--d:${ps.indexOf(p)}"><td><span class="ptag" style="--pc:${p.color}"><i class="pdot"></i>${esc(p.name)}</span>${Store.isUnlocked(p.id) ? '' : ` <span class="lock">${icon('lock', 12)}</span>`}</td>
          <td>${s.total}</td><td>${s.notDone}</td><td>${s.supplied}</td><td>${s.closed}</td><td class="${s.delayed ? 't-late' : ''}">${s.delayed}</td><td>${s.newer}</td>
          <td class="w-bar"><div class="stack thin">${parts.map((k) => `<span class="seg-b c-${k}" style="flex:${s[k]}" data-tip="${D.CATS[k].label}: ${s[k]}"></span>`).join('') || '<span class="seg-b c-missing" style="flex:1"></span>'}</div></td>
          <td>${bp.count ? `<div class="pbar"><div style="width:${pct(bp.overall)}"></div></div><b class="pnum">${pct(bp.overall)}</b>` : '<span class="muted">—</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>` : `<div class="empty-mini">${icon('layers', 22)}<p>עוד אין לשוניות פרויקט. אחרי ייבוא הקובץ המערכת תציע לפתוח לשונית לכל פרויקט, או הוסף ידנית עם הכפתור +.</p></div>`}
      </section>`;
    v.querySelectorAll('[data-p]').forEach((tr) => (tr.onclick = () => go(tr.dataset.p, 'dashboard')));
    bindTips(v);
  }

  /* ================= עזרים ================= */
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
    const canImport = () => { const p = currentProject(); return Store.currentUser() && $('#main') && (!p || Store.isUnlocked(p.id)); };
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
      importFile(p && S.route.sub === 'bom' ? 'bom' : 'orders', p, f);
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
