// Запуск: node tests/statistics.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
let now = Date.parse('2026-11-10T12:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const elements = new Map();
const values = new Map();
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, String(value)); storage[key] = String(value); },
  removeItem: key => { values.delete(key); delete storage[key]; }
};
let calls = [];
let response;
let reloads = 0;
const ctx = vm.createContext({
  Date: Clock, Intl, URL, TextEncoder, AbortController, setTimeout, clearTimeout,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  localStorage: storage, location: {reload() { reloads++; }}, console,
  document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        textContent: '', innerHTML: '', disabled: false,
        classList: {add() {}, remove() {}, toggle() {}},
        addEventListener(event, fn) { this[event] = fn; }
      });
      return elements.get(selector);
    },
    querySelectorAll: () => [], addEventListener() {}
  },
  fetch: async (url, options) => {
    calls.push({url, options});
    if (response instanceof Error) throw response;
    return response;
  }
});
vm.runInContext(source.replace(/restoreSession\(\);\s*$/, ''), ctx);
const run = code => vm.runInContext(code, ctx);
const key = 'owl_site_cache_v1_stats_python_v1';
let rendered;
ctx.capture = data => { rendered = data; };
run('renderStats = capture');
const data = {success: true, currentWeek: {start: '2026-11-10', end: '2026-11-16'},
  currentRecords: [], weeks: []};
function reset() {
  for (const key of values.keys()) delete storage[key];
  values.clear(); calls = []; rendered = null; reloads = 0;
  now = Date.parse('2026-11-10T12:00:00Z');
  run('saveSession("пароль🦉"); statsRequest = null');
  response = {ok: true, status: 200, json: async () => data};
}
function cache(age = 0, payload = data) {
  storage.setItem(key, JSON.stringify({time: now - age, data: payload}));
}
(async () => {
  reset();
  await run('loadStats()');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://owlet-vk-bot.onrender.com/api/website/stats');
  assert.equal(Buffer.from(calls[0].options.headers['X-Website-Password'], 'base64').toString(), 'пароль🦉');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.ok(values.has(key));
  await run('loadStats()');
  assert.equal(calls.length, 1, 'Свежий кеш не вызывает сеть');
  now += 300000;
  await run('loadStats()');
  assert.equal(calls.length, 2, 'Через 5 минут нужен запрос');
  await run('loadStats(true)');
  assert.equal(calls.length, 3, 'Ручное обновление обходит браузерный кеш');

  reset(); cache(300000); response = new Error('offline');
  await run('loadStats()');
  assert.equal(rendered.success, true);
  assert.match(elements.get('#statsCacheStatus').textContent, /Ошибка обновления/);

  reset(); cache(300000, {...data, currentWeek: {start: '2026-11-03'}});
  response = new Error('offline'); await run('loadStats()');
  assert.equal(rendered, null, 'Кеш прошлой недели не показывается');

  reset(); cache(300000); response = {ok: false, status: 401};
  await run('loadStats()');
  assert.equal(rendered, null, 'После 401 кеш не показывается');
  assert.equal(storage.getItem('owl_password'), null);
  assert.equal(storage.getItem(key), null);
  assert.equal(reloads, 1);

  reset(); await run('Promise.all([fetchStats(), fetchStats()])');
  assert.equal(calls.length, 1, 'Параллельные чтения объединяются');
  reset(); cache(); await run('getStatsForExport()');
  assert.equal(calls.length, 0, 'CSV использует свежий кеш');
  now += 300000; await run('getStatsForExport()');
  assert.equal(calls.length, 1, 'CSV обновляет просроченный кеш');

  reset(); cache();
  run('selectedName = "Тест"; apiPost = async () => ({success: true}); submitWebsiteReport = async () => ({success: true})');
  run('$("#plan").value = "30"; $("#fact").value = "17"');
  await elements.get('#save').click();
  assert.equal(storage.getItem(key), null, 'Сохранение записи сбрасывает кеш статистики');
  cache(); storage.setItem('owl_is_admin', '1');
  run('$("#teamGoal").value = "100"');
  await elements.get('#saveGoal').click();
  assert.equal(storage.getItem(key), null, 'Сохранение цели сбрасывает кеш статистики');

  reset(); cache(300000); response = {ok: true, status: 200, json: async () => ({success: false})};
  const before = storage.getItem(key); await run('loadStats()');
  assert.equal(storage.getItem(key), before, 'Ошибка API не заменяет кеш');

  reset(); now = Date.parse('2026-11-09T20:59:00Z');
  assert.equal(run('statsWeekStart()'), '2026-11-03');
  now = Date.parse('2026-11-09T21:00:00Z');
  assert.equal(run('statsWeekStart()'), '2026-11-10', 'Смена недели по Москве');
  console.log('Проверки статистики пройдены: API, UTF-8, TTL, обновление, ошибки, 401, смена недели, CSV и параллельные запросы.');
})().catch(error => { console.error(error); process.exitCode = 1; });
