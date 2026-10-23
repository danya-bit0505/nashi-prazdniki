/* Общая логика дат и напоминаний.
   Подключается в трёх местах: страница (<script>), sw.js (importScripts)
   и GitHub Actions (scripts/remind.mjs через vm). Поэтому — классический скрипт без import/export. */
(function (g) {
  'use strict';

  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  const TYPES = {
    birthday: { icon: '🎂', name: 'День рождения', color: '#d35400' },
    wedding:  { icon: '💍', name: 'Годовщина свадьбы', color: '#8e44ad' },
    nameday:  { icon: '😇', name: 'Именины', color: '#2471a3' },
    memorial: { icon: '🕯️', name: 'День памяти', color: '#707b7c' },
    other:    { icon: '⭐', name: 'Другое', color: '#1e8449' },
  };
  const TYPE_ORDER = Object.keys(TYPES);

  const WEDDINGS = {
    1: 'ситцевая', 2: 'бумажная', 3: 'кожаная', 4: 'льняная', 5: 'деревянная', 6: 'чугунная',
    7: 'медная', 8: 'жестяная', 9: 'фаянсовая', 10: 'оловянная', 11: 'стальная', 12: 'никелевая',
    13: 'кружевная', 14: 'агатовая', 15: 'хрустальная', 20: 'фарфоровая', 25: 'серебряная',
    30: 'жемчужная', 35: 'коралловая', 40: 'рубиновая', 45: 'сапфировая', 50: 'золотая',
    55: 'изумрудная', 60: 'бриллиантовая', 65: 'железная', 70: 'благодатная', 75: 'коронная',
  };

  const pad = n => String(n).padStart(2, '0');

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }
  const years = n => `${n} ${plural(n, 'год', 'года', 'лет')}`;
  const days = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

  // m — 1..12
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  // 29 февраля в невисокосный год празднуем 28-го
  const dayIn = (ev, y) => Math.min(ev.day, daysInMonth(y, ev.month));
  const type = ev => TYPES[ev.type] || TYPES.other;
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function eventsOn(events, y, m, d) {
    return sortEvents(events.filter(e => e.month === m && dayIn(e, y) === d), y);
  }

  function eventsInMonth(events, y, m) {
    return sortEvents(events.filter(e => e.month === m), y);
  }

  function sortEvents(list, y) {
    return list.slice().sort((a, b) =>
      dayIn(a, y) - dayIn(b, y) ||
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      String(a.name).localeCompare(String(b.name), 'ru'));
  }

  // «65 лет», «50 лет — золотая свадьба»; пусто, если год неизвестен
  function describe(ev, y) {
    if (!ev.year) return '';
    const n = y - ev.year;
    if (n <= 0) return '';
    if (ev.type === 'wedding') return years(n) + (WEDDINGS[n] ? `, ${WEDDINGS[n]} свадьба` : '');
    return years(n);
  }

  // Ближайшие праздники: [{ev, date, inDays}]
  function upcoming(events, today, count) {
    const t0 = startOfDay(today), res = [];
    for (let i = 0; i < count; i++) {
      const t = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i);
      for (const ev of eventsOn(events, t.getFullYear(), t.getMonth() + 1, t.getDate())) {
        res.push({ ev, date: t, inDays: i });
      }
    }
    return res;
  }

  // Какие напоминания положены на этот день. key одинаковый у страницы, SW и сервера —
  // по нему отсекаются повторы (и он же tag уведомления).
  function dueReminders(events, today) {
    const t0 = startOfDay(today), out = [];
    for (const ev of events) {
      for (const off of ev.remind || []) {
        const t = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + off);
        const y = t.getFullYear();
        if (ev.month !== t.getMonth() + 1 || dayIn(ev, y) !== t.getDate()) continue;
        const when = off === 0 ? 'Сегодня' : off === 1 ? 'Завтра' : `Через ${days(off)}`;
        const T = type(ev), d = describe(ev, y);
        out.push({
          key: `${ev.id}|${ymd(t)}|${off}`,
          title: `${T.icon} ${when}: ${ev.name}`,
          body: `${T.name}${d ? ' — ' + d : ''}, ${t.getDate()} ${MONTHS_GEN[t.getMonth()]}`,
          offset: off,
        });
      }
    }
    return out;
  }

  // ---- Общее хранилище для страницы и SW (localStorage в SW недоступен) ----
  const DATA_CACHE = 'prazdniki-data';
  const DATA_URL = './__data.json';
  const SHOWN_URL = './__shown.json';

  async function cacheGet(url) {
    try {
      const c = await caches.open(DATA_CACHE);
      const r = await c.match(url);
      return r ? await r.json() : null;
    } catch (e) { return null; }
  }
  async function cachePut(url, obj) {
    try {
      const c = await caches.open(DATA_CACHE);
      await c.put(url, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) { /* ignore */ }
  }
  async function markShown(key) {
    const shown = (await cacheGet(SHOWN_URL)) || {};
    shown[key] = Date.now();
    await cachePut(SHOWN_URL, shown);
  }

  const NOTIF_OPTS = { icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' } };

  // Показать положенные напоминания, которые ещё не показывались. Ночью не беспокоим.
  async function notifyDue(reg, events, now) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0;
    if (now.getHours() < 8 || now.getHours() >= 22) return 0;
    const due = dueReminders(events || [], now);
    if (!due.length) return 0;
    const shown = (await cacheGet(SHOWN_URL)) || {};
    let n = 0;
    for (const r of due) {
      if (shown[r.key]) continue;
      try {
        await reg.showNotification(r.title, { ...NOTIF_OPTS, body: r.body, tag: r.key });
        shown[r.key] = now.getTime();
        n++;
      } catch (e) { /* ignore */ }
    }
    const limit = now.getTime() - 40 * 864e5;
    for (const k of Object.keys(shown)) if (shown[k] < limit) delete shown[k];
    await cachePut(SHOWN_URL, shown);
    return n;
  }

  g.Core = {
    MONTHS, MONTHS_GEN, MONTHS_PREP, MONTHS_SHORT, WEEKDAYS, WEEKDAYS_FULL, TYPES, WEDDINGS,
    plural, years, days, daysInMonth, dayIn, type, ymd, startOfDay,
    eventsOn, eventsInMonth, describe, upcoming, dueReminders,
    DATA_URL, SHOWN_URL, NOTIF_OPTS, cacheGet, cachePut, markShown, notifyDue,
  };
})(typeof self !== 'undefined' ? self : globalThis);
