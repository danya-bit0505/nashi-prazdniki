// Ежедневная рассылка push-напоминаний. Запускается GitHub Actions в ПРИВАТНОМ репозитории с данными.
// Читает events.json и subscriptions.json из корня репозитория, логику дат берёт из js/core.js приложения
// (скачивает с GitHub Pages — одна логика на страницу, SW и сервер).
//
// env: APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), TZ=Europe/Moscow
import fs from 'node:fs';
import vm from 'node:vm';
import webpush from 'web-push';

const { APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
if (!APP_URL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Нужны APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY');
  process.exit(1);
}

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };

const coreUrl = new URL('js/core.js', APP_URL.endsWith('/') ? APP_URL : APP_URL + '/');
const res = await fetch(coreUrl, { cache: 'no-store' });
if (!res.ok) { console.error(`Не удалось скачать ${coreUrl}: ${res.status}`); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(await res.text(), ctx);
const Core = ctx.Core;

const events = readJson('events.json', []).filter(e => e && !e.deleted);
const subs = readJson('subscriptions.json', []);
const now = new Date();
const due = Core.dueReminders(events, now).map(({ key, title, body }) => ({ key, title, body }));

console.log(`${Core.ymd(now)}: праздников ${events.length}, напоминаний сегодня ${due.length}, устройств ${subs.length}`);
due.forEach(d => console.log(' •', d.title, '—', d.body));

if (due.length && subs.length) {
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:noreply@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const payload = JSON.stringify(due);
  const alive = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, payload, { TTL: 20 * 3600, urgency: 'high' });
      alive.push(s);
      console.log('  ✓', s.device || s.endpoint.slice(0, 60));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        console.log('  ✗ подписка устарела, удаляю:', s.device || s.endpoint.slice(0, 60));
      } else {
        alive.push(s);
        console.log('  ! ошибка', e.statusCode || '', e.body || e.message);
      }
    }
  }
  if (alive.length !== subs.length) fs.writeFileSync('subscriptions.json', JSON.stringify(alive, null, 1));
}

// Раз в месяц — отметка, чтобы GitHub не выключил расписание из-за «неактивного» репозитория
if (now.getDate() === 1) fs.writeFileSync('last-run.txt', now.toISOString() + '\n');
