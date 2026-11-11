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
        setAttribute(name, value) { this[name] = value; },
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
vm.runInContext(source.replace('restoreSession();', ''), ctx);
const run = code => vm.runInContext(code, ctx);
const weeks = [
 {weekStart:'2026-11-03',weekEnd:'2026-11-09',goal:100,totalMice:20,activeOwlets:1,records:[{name:'<Сыч>',plan:10,fact:20}]},
 {weekStart:'2026-11-10',weekEnd:'2026-11-16',goal:200,totalMice:40,activeOwlets:2,records:[]}
];
ctx.fixture = {success:true,currentWeek:{start:'2026-11-10'},weeks};
run('historyData = fixture; renderStatsHistory(document.querySelector("#statsHistory"))');
assert.equal((elements.get('#statsHistory').innerHTML.match(/<svg /g)||[]).length, 1);
assert.match(elements.get('#statsHistory').innerHTML, /<polyline /);
assert.match(elements.get('#statsHistory').innerHTML, /id="historyPanel" hidden/);
assert.doesNotMatch(elements.get('#statsHistory').innerHTML, /<option value="2026-11-10"/);
assert.match(elements.get('#statsHistory').innerHTML, /<option value="2026-11-03"/);
elements.get('#historyToggle').click();
assert.equal(elements.get('#historyPanel').hidden, false);
assert.equal(elements.get('#historyToggle')['aria-expanded'], 'true');
elements.get('#historyToggle').click();
assert.equal(elements.get('#historyPanel').hidden, true);
assert.match(elements.get('#statsHistory').innerHTML, /Активные сычики — левая шкала/);
assert.match(elements.get('#statsHistory').innerHTML, /Активные сычики/);
elements.get('#historyWeek').change({target:{value:'2026-11-03'}});
assert.match(elements.get('#statsHistory').innerHTML, /&lt;Сыч&gt;/);
assert.match(elements.get('#statsHistory').innerHTML, /Мышей: 20/);
run("saveSession('тест', false)");
response = {ok:true,status:200,json:async()=>ctx.fixture};
(async () => {
 await run('loadStatsHistory()');
 assert.equal(calls.length, 1);
 await run('loadStatsHistory()');
 assert.equal(calls.length, 1);
 await run('loadStatsHistory(true)');
 assert.equal(calls.length, 2);
 now += 300001;
 await run('loadStatsHistory()');
 assert.equal(calls.length, 3);
 run('historyData = {...fixture, weeks:[fixture.weeks[1]]}; renderStatsHistory(document.querySelector("#statsHistory"))');
 assert.match(elements.get('#statsHistory').innerHTML, /Прошедших недель пока нет/);
 console.log('История: выбор недели, экранирование, графики, кеш 5 минут и обновление — OK');
})().catch(e => {console.error(e);process.exitCode=1;});
