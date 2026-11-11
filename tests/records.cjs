const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const values = new Map();
const storage = {
  getItem: k => values.get(k) ?? null,
  setItem(k, v) { values.set(k, String(v)); this[k] = String(v); },
  removeItem(k) { values.delete(k); delete this[k]; }
};
let calls = [], response, reloads = 0;
const ctx = vm.createContext({
  Date, Intl, URL, URLSearchParams, crypto, TextEncoder, AbortController, setTimeout, clearTimeout, console,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  localStorage: storage, location: {reload() { reloads++; }},
  document: {querySelector: () => ({addEventListener() {}}),
    querySelectorAll: () => [], addEventListener() {}},
  async fetch(url, options) {
    calls.push({url, options});
    if (response instanceof Error) throw response;
    return response;
  }
});
vm.runInContext(source.replace(/restoreSession\(\);\s*$/, ''), ctx);
const run = code => vm.runInContext(code, ctx);
const payload = {name: 'Тест', plan: 30, fact: 17};
ctx.payload = payload;
const key = 'owl_pending_report_v1';
function reply(data, status = 200) {
  response = {ok: status < 400, status, json: async () => data};
}
(async () => {
  run('saveSession("пароль🦉")');
  response = new Error('Ответ потерян');
  await assert.rejects(run('submitWebsiteReport(payload)'));
  const pending = JSON.parse(storage.getItem(key));
  assert.equal(pending.name, 'Тест'); assert.ok(pending.requestId);
  assert.equal(calls[0].url, 'https://dynamic-cactus-a79224.netlify.app/api/website/records');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(Buffer.from(calls[0].options.headers['X-Website-Password'], 'base64').toString(), 'пароль🦉');

  reply({success: true, warning: 'Уведомление ожидается', notificationStatus: 'pending'});
  await run('submitWebsiteReport(payload)');
  assert.equal(JSON.parse(calls[1].options.body).requestId, pending.requestId);
  assert.ok(storage.getItem(key), 'Незавершённое уведомление сохраняет requestId');
  reply({success: true, artifactStatus: 'done', notificationStatus: 'sent'});
  await run('submitWebsiteReport(payload)');
  assert.equal(JSON.parse(calls[2].options.body).requestId, pending.requestId);
  assert.equal(storage.getItem(key), null, 'Завершённый запрос можно удалить');

  response = new Error('offline');
  await assert.rejects(run('submitWebsiteReport(payload)'));
  const previous = JSON.parse(storage.getItem(key)).requestId;
  ctx.payload = {...payload, fact: 18};
  await assert.rejects(run('submitWebsiteReport(payload)'));
  assert.notEqual(JSON.parse(storage.getItem(key)).requestId, previous, 'Другие данные получают новый requestId');

  reply({success: true, people: ['Тест']});
  await run('loadParticipants()');
  assert.ok(calls.at(-1).url.endsWith('/participants'));
  assert.equal(run('PEOPLE[0]'), 'Тест');
  reply({success: true, record: null});
  await run('websiteRequest("/current?name=" + encodeURIComponent("Тест"))');
  assert.ok(calls.at(-1).url.includes('/current?name='));

  reply({success: false, error: 'Внесение через Python ещё не включено'}, 503);
  await assert.rejects(run('submitWebsiteReport(payload)'), /ещё не включено/);
  assert.ok(storage.getItem(key));
  reply({success: false, unauthorized: true}, 401);
  await assert.rejects(run('websiteRequest("/participants")'), /Сессия завершена/);
  assert.equal(storage.getItem('owl_password'), null); assert.equal(reloads, 1);
  assert.ok(calls.every(c => c.url.startsWith('https://dynamic-cactus-a79224.netlify.app/')),
    'Внесение и чтение формы не обращаются к Apps Script');
  reply({success: true, isAdmin: true});
  const login = await run('rawGet({action:"login"}, "админ")');
  assert.equal(login.isAdmin, true);
  assert.equal(calls.at(-1).url, 'https://dynamic-cactus-a79224.netlify.app/api/website/login');
  assert.ok(!calls.at(-1).url.includes('админ'));
  reply({success:false, unauthorized:true, error:'Неверный пароль'},401);
  const before = reloads;
  await assert.rejects(run('rawGet({action:"login"}, "ошибка")'), /Неверный пароль/);
  assert.equal(reloads,before,'Неверный пароль входа не перезагружает форму');
  console.log('Запись сайта: прямой API, UTF-8, потерянный ответ, повтор requestId, предупреждения и 401 — OK');
})().catch(e => {console.error(e); process.exitCode = 1;});
