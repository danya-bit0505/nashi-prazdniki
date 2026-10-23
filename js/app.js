/* Наши праздники — основная логика страницы */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const LS_EVENTS = 'prazdniki.events';
  const LS_SETTINGS = 'prazdniki.settings';
  const LS_BANNER = 'prazdniki.bannerHidden';
  const C = window.Core;
  const $ = s => document.querySelector(s);

  // ---------- состояние ----------
  let events = load(LS_EVENTS, []);        // включая «удалённые» (deleted: true) — для синхронизации
  let settings = Object.assign({ scale: 1, repo: '', token: '', vapid: '' }, load(LS_SETTINGS, {}));
  const now = new Date();
  let view = { y: now.getFullYear(), m: now.getMonth() + 1 };
  let selectedDay = null;
  let editingId = null;
  let editType = 'birthday';

  const live = () => events.filter(e => !e.deleted);

  function load(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('Не удалось сохранить: память переполнена'); }
  }
  function saveEvents(fromSync) {
    store(LS_EVENTS, events);
    C.cachePut(C.DATA_URL, live()); // копия для service worker
    if (!fromSync) scheduleSync();
  }
  function saveSettings() { store(LS_SETTINGS, settings); }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms) {
    const t = $('#toast');
    const host = document.querySelector('dialog[open]') || document.body; // поверх открытого окна
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  function applyScale() {
    document.documentElement.style.setProperty('--scale', settings.scale);
    document.querySelectorAll('#fontSeg button').forEach(b =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.scale) === Number(settings.scale))));
  }

  // ---------- отрисовка ----------
  function render(anim) {
    renderSoon();
    renderGrid(anim);
    renderList();
    updateFab();
  }

  function whenLabel(inDays, date) {
    if (inDays === 0) return 'Сегодня';
    if (inDays === 1) return 'Завтра';
    if (inDays === 2) return 'Послезавтра';
    const wd = C.WEEKDAYS[(date.getDay() + 6) % 7];
    return `${wd}, ${date.getDate()} ${C.MONTHS_SHORT[date.getMonth()]}`;
  }

  function renderSoon() {
    const box = $('#soon');
    const items = C.upcoming(live(), new Date(), 8);
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<h2>Скоро</h2>' + items.map(({ ev, date, inDays }) => {
      const d = C.describe(ev, date.getFullYear());
      return `<div class="soon-item${inDays === 0 ? ' is-today' : ''}">
        <span class="when">${whenLabel(inDays, date)}</span>
        <span>${C.type(ev).icon} ${esc(ev.name)}${d ? ` <span class="muted">· ${esc(d)}</span>` : ''}</span>
      </div>`;
    }).join('');
  }

  function renderGrid(anim) {
    const { y, m } = view;
    const t = new Date();
    const isCur = y === t.getFullYear() && m === t.getMonth() + 1;
    $('#monthName').textContent = C.MONTHS[m - 1];
    $('#yearName').textContent = y;
    $('#btnToday').hidden = isCur;

    const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const n = C.daysInMonth(y, m);
    const evs = live();
    let html = '';
    for (let i = 0; i < first; i++) html += '<div class="cell empty"></div>';
    for (let d = 1; d <= n; d++) {
      const list = C.eventsOn(evs, y, m, d);
      const wd = (first + d - 1) % 7;
      const cls = ['cell'];
      if (wd >= 5) cls.push('weekend');
      if (list.length) cls.push('has');
      if (isCur && d === t.getDate()) cls.push('today');
      if (d === selectedDay) cls.push('selected');
      const icons = list.slice(0, 2).map(e => C.type(e).icon).join('');
      const more = list.length > 2 ? `<span class="more">+${list.length - 2}</span>` : '';
      const aria = `${d} ${C.MONTHS_GEN[m - 1]}${list.length ? ': ' + list.map(e => e.name).join(', ') : ''}`;
      html += `<button class="${cls.join(' ')}" data-day="${d}" aria-label="${esc(aria)}">
        <span class="num">${d}</span><span class="marks">${icons}${more}</span></button>`;
    }
    const grid = $('#grid');
    grid.innerHTML = html;
    grid.classList.remove('anim-next', 'anim-prev');
    if (anim) { void grid.offsetWidth; grid.classList.add(anim); }
  }

  function renderList() {
    const { y, m } = view;
    const list = C.eventsInMonth(live(), y, m);
    $('#listTitle').textContent = `Праздники в ${C.MONTHS_PREP[m - 1]}`;
    const box = $('#list');
    if (!list.length) {
      box.innerHTML = `<div class="empty-note">${events.length
        ? `В ${C.MONTHS_PREP[m - 1]} праздников нет`
        : 'Пока ничего не записано.<br>Нажмите «＋ Добавить» внизу экрана.'}</div>`;
      return;
    }
    const today = C.startOfDay(new Date());
    box.innerHTML = list.map(ev => {
      const day = C.dayIn(ev, y);
      const date = new Date(y, m - 1, day);
      const diff = Math.round((date - today) / 864e5);
      const T = C.type(ev);
      const d = C.describe(ev, y);
      let badge = '';
      if (diff === 0) badge = '<span class="badge now">Сегодня!</span>';
      else if (diff === 1) badge = '<span class="badge">Завтра</span>';
      else if (diff > 1 && diff <= 60) badge = `<span class="badge">через ${C.days(diff)}</span>`;
      return `<button class="ev${diff < 0 ? ' past' : ''}" data-id="${esc(ev.id)}" data-day="${day}" style="--c:${T.color}">
        <span class="date"><b>${day}</b><small>${C.WEEKDAYS[(date.getDay() + 6) % 7]}</small></span>
        <span class="icon">${T.icon}</span>
        <span class="body">
          <span class="name">${esc(ev.name)}</span>
          <span class="desc">${esc(T.name)}${d ? ' · ' + esc(d) : ''}</span>
          ${ev.note ? `<span class="note">${esc(ev.note)}</span>` : ''}
          ${badge}
        </span>
      </button>`;
    }).join('');
  }

  function updateFab() {
    $('#btnAdd').textContent = selectedDay
      ? `＋ Добавить на ${selectedDay} ${C.MONTHS_GEN[view.m - 1]}`
      : '＋ Добавить';
  }

  function go(delta) {
    let { y, m } = view;
    m += delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    view = { y, m };
    selectedDay = null;
    render(delta > 0 ? 'anim-next' : 'anim-prev');
  }

  function goToday() {
    const t = new Date();
    const delta = (t.getFullYear() - view.y) * 12 + (t.getMonth() + 1 - view.m);
    view = { y: t.getFullYear(), m: t.getMonth() + 1 };
    selectedDay = null;
    render(delta > 0 ? 'anim-next' : delta < 0 ? 'anim-prev' : null);
  }

  function onDayTap(d) {
    selectedDay = selectedDay === d ? null : d;
    renderGrid();
    updateFab();
    if (!selectedDay) return;
    const card = document.querySelector(`.ev[data-day="${d}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.querySelectorAll(`.ev[data-day="${d}"]`).forEach(c => {
        c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
      });
    } else {
      toast(`${d} ${C.MONTHS_GEN[view.m - 1]} праздников нет`);
    }
  }

  // ---------- форма ----------
  const YEAR_LABEL = {
    birthday: 'Год рождения', wedding: 'Год свадьбы', nameday: 'Год', memorial: 'Год', other: 'Год',
  };

  function buildForm() {
    $('#fTypes').innerHTML = Object.entries(C.TYPES).map(([k, t]) =>
      `<button type="button" data-type="${k}"><span class="ti">${t.icon}</span>${esc(t.name)}</button>`).join('');
    $('#fMonth').innerHTML = C.MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
    fillDays(1);
  }

  function fillDays(month, keep) {
    const sel = $('#fDay');
    const max = C.daysInMonth(2024, month); // 2024 високосный — 29 февраля можно выбрать
    const cur = keep || Number(sel.value) || 1;
    sel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    sel.value = String(Math.min(cur, max));
  }

  function setType(t) {
    editType = t;
    document.querySelectorAll('#fTypes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
    $('#fYearLabel').innerHTML = `${YEAR_LABEL[t] || 'Год'} <small>(необязательно — чтобы считать, сколько лет)</small>`;
  }

  function openEdit(ev) {
    editingId = ev ? ev.id : null;
    $('#editTitle').textContent = ev ? 'Изменить' : 'Новый праздник';
    $('#btnDelete').hidden = !ev;
    $('#fName').value = ev ? ev.name : '';
    setType(ev ? ev.type : 'birthday');
    const month = ev ? ev.month : view.m;
    $('#fMonth').value = String(month);
    fillDays(month, ev ? ev.day : (selectedDay || (isCurrentView() ? new Date().getDate() : 1)));
    $('#fYear').value = ev && ev.year ? ev.year : '';
    const rem = ev ? (ev.remind || []) : [0, 1];
    document.querySelectorAll('#fRemind input').forEach(cb => cb.checked = rem.includes(Number(cb.value)));
    $('#fNote').value = ev ? (ev.note || '') : '';
    $('#editDlg').showModal();
    if (!ev) setTimeout(() => $('#fName').focus(), 50);
  }

  const isCurrentView = () => view.y === new Date().getFullYear() && view.m === new Date().getMonth() + 1;

  function submitEdit(e) {
    e.preventDefault();
    const name = $('#fName').value.trim();
    if (!name) { toast('Напишите, чей праздник'); $('#fName').focus(); return; }
    const yRaw = $('#fYear').value.trim();
    const year = yRaw ? Number(yRaw) : null;
    if (year && (year < 1850 || year > 2100)) { toast('Проверьте год'); return; }
    const data = {
      name,
      type: editType,
      day: Number($('#fDay').value),
      month: Number($('#fMonth').value),
      year,
      remind: [...document.querySelectorAll('#fRemind input:checked')].map(cb => Number(cb.value)).sort((a, b) => a - b),
      note: $('#fNote').value.trim(),
      updatedAt: Date.now(),
    };
    if (editingId) {
      const i = events.findIndex(x => x.id === editingId);
      if (i >= 0) events[i] = Object.assign({}, events[i], data);
    } else {
      events.push(Object.assign({ id: uid() }, data));
    }
    saveEvents();
    $('#editDlg').close();
    // Показать месяц, где праздник
    if (data.month !== view.m) { view = { y: view.y, m: data.month }; }
    selectedDay = null;
    render();
    toast('Сохранено ✓');
    maybeAskNotifications();
  }

  function deleteEdit() {
    const ev = events.find(x => x.id === editingId);
    if (!ev) return;
    if (!confirm(`Удалить «${ev.name}»?`)) return;
    Object.keys(ev).forEach(k => { if (k !== 'id') delete ev[k]; });
    ev.deleted = true;
    ev.updatedAt = Date.now();
    saveEvents();
    $('#editDlg').close();
    render();
    toast('Удалено');
  }

  // ---------- уведомления ----------
  const hasNotif = () => 'Notification' in window && 'serviceWorker' in navigator;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function updateNotifUI() {
    const st = $('#notifStatus');
    const en = $('#btnNotifEnable'), test = $('#btnNotifTest');
    const banner = $('#notifBanner');
    banner.hidden = true;
    if (!hasNotif()) {
      st.textContent = isIOS() && !isStandalone()
        ? 'На iPhone сначала нажмите «Поделиться» → «На экран „Домой“» и откройте приложение оттуда.'
        : 'Этот браузер не умеет показывать уведомления.';
      en.hidden = true; test.hidden = true;
      return;
    }
    const p = Notification.permission;
    en.hidden = p === 'granted';
    test.hidden = p !== 'granted';
    if (p === 'granted') {
      st.textContent = settings.pushOn
        ? 'Включены. Напоминания приходят каждое утро, даже если приложение закрыто.'
        : 'Включены. Напоминания приходят, когда приложение открывают, и время от времени в фоне.';
    } else if (p === 'denied') {
      st.textContent = 'Уведомления запрещены. Разрешите их в настройках телефона для этого приложения.';
      en.hidden = true;
    } else {
      st.textContent = 'Выключены.';
      if (live().length && !load(LS_BANNER, false)) banner.hidden = false;
    }
  }

  function maybeAskNotifications() {
    if (hasNotif() && Notification.permission === 'default') updateNotifUI();
  }

  async function enableNotifications() {
    if (!hasNotif()) return updateNotifUI();
    const p = await Notification.requestPermission();
    store(LS_BANNER, true);
    if (p === 'granted') {
      await registerPeriodic();
      if (settings.vapid && settings.repo && settings.token) pushSubscribe(true);
      toast('Напоминания включены ✓');
      checkNow();
    } else {
      toast('Без разрешения напоминаний не будет');
    }
    updateNotifUI();
  }

  async function registerPeriodic() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return;
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state === 'granted') await reg.periodicSync.register('reminders', { minInterval: 12 * 3600 * 1000 });
    } catch (e) { /* не поддерживается — не страшно */ }
  }

  async function checkNow() {
    if (!hasNotif() || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await C.notifyDue(reg, live(), new Date());
    } catch (e) { /* ignore */ }
  }

  async function testNotification() {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('🎂 Проверка', { ...C.NOTIF_OPTS, body: 'Так будут выглядеть напоминания о праздниках', tag: 'test' });
    } catch (e) { toast('Не получилось показать уведомление'); }
  }

  // ---------- GitHub: синхронизация и push-подписка ----------
  const syncReady = () => settings.repo && settings.token;
  const b64enc = s => { let bin = ''; new TextEncoder().encode(s).forEach(x => bin += String.fromCharCode(x)); return btoa(bin); };
  const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));

  async function gh(method, path, body) {
    const r = await fetch(`https://api.github.com/repos/${settings.repo}/contents/${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (method === 'GET' && r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    return r.json();
  }
  async function ghRead(path) {
    const f = await gh('GET', path);
    return f ? { data: JSON.parse(b64dec(f.content)), sha: f.sha } : { data: null, sha: undefined };
  }
  const ghWrite = (path, data, sha, message) =>
    gh('PUT', path, { message, content: b64enc(JSON.stringify(data, null, 1)), sha });

  function merge(a, b) {
    const map = new Map();
    for (const e of [...(a || []), ...(b || [])]) {
      if (!e || !e.id) continue;
      const cur = map.get(e.id);
      if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) map.set(e.id, e);
    }
    const limit = Date.now() - 400 * 864e5; // старые отметки об удалении больше не нужны
    return [...map.values()].filter(e => !(e.deleted && (e.updatedAt || 0) < limit))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
  }
  const same = (a, b) => JSON.stringify(merge(a, [])) === JSON.stringify(merge(b, []));

  let syncTimer = null, syncing = false;
  function scheduleSync() {
    if (!syncReady()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 2000);
  }

  async function syncNow(manual) {
    if (!syncReady() || syncing || !navigator.onLine) {
      if (manual) toast(syncReady() ? 'Нет интернета' : 'Заполните репозиторий и токен');
      return;
    }
    syncing = true;
    const st = $('#syncStatus');
    try {
      const remote = await ghRead('events.json');
      const merged = merge(events, remote.data);
      if (!same(merged, events)) { events = merged; saveEvents(true); render(); }
      if (!remote.data || !same(merged, remote.data)) {
        await ghWrite('events.json', merged, remote.sha, 'Обновление праздников');
      }
      settings.lastSync = Date.now(); saveSettings();
      st.textContent = 'Синхронизировано: ' + new Date().toLocaleString('ru-RU');
      if (manual) toast('Синхронизировано ✓');
    } catch (e) {
      st.textContent = 'Ошибка синхронизации: ' + e.message;
      if (manual) toast('Ошибка: ' + e.message);
    } finally { syncing = false; }
  }

  function urlB64ToUint8Array(s) {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function pushSubscribe(silent) {
    try {
      if (!settings.vapid) throw new Error('нет VAPID public key');
      if (!syncReady()) throw new Error('нет репозитория/токена');
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
        throw new Error('нет разрешения на уведомления');
      }
      const reg = await navigator.serviceWorker.ready;
      if (!('pushManager' in reg)) throw new Error('push не поддерживается');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(settings.vapid) });
      }
      const json = sub.toJSON();
      const remote = await ghRead('subscriptions.json');
      const list = (remote.data || []).filter(s => s.endpoint !== json.endpoint);
      list.push(Object.assign(json, { device: navigator.userAgent.slice(0, 120), addedAt: new Date().toISOString() }));
      await ghWrite('subscriptions.json', list, remote.sha, 'Подписка на push');
      settings.pushOn = true; saveSettings();
      updateNotifUI();
      if (!silent) toast('Push-подписка сохранена ✓');
      $('#syncStatus').textContent = `Push: подписано устройств — ${list.length}`;
    } catch (e) {
      if (!silent) toast('Push: ' + e.message);
      $('#syncStatus').textContent = 'Push: ' + e.message;
    }
  }

  // ---------- резервная копия ----------
  function exportFile() {
    const data = { app: 'nashi-prazdniki', version: 1, exportedAt: new Date().toISOString(), events: live() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prazdniki-${C.ymd(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Файл сохранён в «Загрузки»');
  }

  async function importFile(file) {
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.events;
      if (!Array.isArray(list)) throw new Error('bad');
      const clean = list.filter(e => e && e.name && e.day >= 1 && e.day <= 31 && e.month >= 1 && e.month <= 12)
        .map(e => ({
          id: e.id || uid(), name: String(e.name).slice(0, 80), type: C.TYPES[e.type] ? e.type : 'other',
          day: Number(e.day), month: Number(e.month), year: e.year ? Number(e.year) : null,
          remind: Array.isArray(e.remind) ? e.remind.map(Number) : [0, 1], note: e.note ? String(e.note).slice(0, 300) : '',
          updatedAt: e.updatedAt || Date.now(),
        }));
      const before = live().length;
      events = merge(events, clean);
      saveEvents();
      render();
      toast(`Загружено. Было ${before}, стало ${live().length}`);
    } catch (e) {
      toast('Не удалось прочитать файл');
    }
  }

  // ---------- обработчики ----------
  function bind() {
    $('#btnPrev').onclick = () => go(-1);
    $('#btnNext').onclick = () => go(1);
    $('#btnTitle').onclick = goToday;
    $('#btnToday').onclick = goToday;
    $('#grid').onclick = e => { const c = e.target.closest('.cell[data-day]'); if (c) onDayTap(Number(c.dataset.day)); };
    $('#list').onclick = e => { const c = e.target.closest('.ev'); if (c) openEdit(events.find(x => x.id === c.dataset.id)); };
    $('#btnAdd').onclick = () => openEdit(null);

    // свайп по календарю
    const cal = document.querySelector('.calendar');
    let sx = 0, sy = 0, st = 0;
    cal.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    cal.addEventListener('touchend', e => {
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st < 700 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    });

    // форма
    $('#fTypes').onclick = e => { const b = e.target.closest('button[data-type]'); if (b) setType(b.dataset.type); };
    $('#fMonth').onchange = () => fillDays(Number($('#fMonth').value));
    $('#editForm').onsubmit = submitEdit;
    $('#btnDelete').onclick = deleteEdit;
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

    // настройки
    $('#btnSettings').onclick = () => {
      $('#gRepo').value = settings.repo; $('#gToken').value = settings.token; $('#gVapid').value = settings.vapid;
      $('#syncStatus').textContent = settings.lastSync ? 'Последняя синхронизация: ' + new Date(settings.lastSync).toLocaleString('ru-RU') : '';
      updateNotifUI();
      $('#setDlg').showModal();
    };
    $('#fontSeg').onclick = e => {
      const b = e.target.closest('button[data-scale]');
      if (!b) return;
      settings.scale = Number(b.dataset.scale); saveSettings(); applyScale();
    };
    $('#btnNotifEnable').onclick = enableNotifications;
    $('#btnBannerEnable').onclick = enableNotifications;
    $('#btnNotifTest').onclick = testNotification;
    $('#btnExport').onclick = exportFile;
    $('#btnImport').onclick = () => $('#importFile').click();
    $('#importFile').onchange = e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; };
    $('#btnSaveSync').onclick = () => {
      settings.repo = $('#gRepo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
      settings.token = $('#gToken').value.trim();
      settings.vapid = $('#gVapid').value.trim();
      saveSettings();
      toast('Сохранено');
      syncNow(true);
    };
    $('#btnSyncNow').onclick = () => syncNow(true);
    $('#btnPush').onclick = () => pushSubscribe(false);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      render(); // дата могла смениться
      checkNow();
      scheduleSync();
    });
    window.addEventListener('online', () => scheduleSync());
  }

  // ---------- service worker ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return; // первая установка — без перезагрузки
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      setTimeout(() => reg.update().catch(() => {}), 3000); // фоновая проверка обновлений
    }).catch(() => {});
  }

  // ---------- старт ----------
  function init() {
    $('#weekdays').innerHTML = C.WEEKDAYS.map(d => `<div>${d}</div>`).join('');
    $('#ver').textContent = 'версия ' + APP_VERSION;
    buildForm();
    applyScale();
    bind();
    render();
    updateNotifUI();
    registerSW();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    C.cachePut(C.DATA_URL, live());
    if (hasNotif() && Notification.permission === 'granted') { registerPeriodic(); checkNow(); }
    scheduleSync();
  }

  init();
})();
