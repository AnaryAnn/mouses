
const STATS_API_URL = "https://owlet-vk-bot.onrender.com/api/website/stats";
const WEBSITE_API_BASE = "https://owlet-vk-bot.onrender.com/api/website";
const PENDING_REPORT_KEY = 'owl_pending_report_v1';
const STATS_CACHE_KEY = 'stats_python_v1';
const STATS_CACHE_TTL = 5 * 60 * 1000;
const PARTICIPANTS_CACHE_TTL = 5 * 60 * 1000;
let statsRequest = null;

let PEOPLE = [];

const SESSION_DAYS = 7;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
let selectedName = "";

// Кэш только для чтения. Запись плана и факта всегда идёт напрямую в API.
const CACHE_PREFIX = 'owl_site_cache_v1_';
function readCache(key) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null'); }
  catch { return null; }
}
function writeCache(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({time: Date.now(), data})); }
  catch (e) { console.warn('Кэш не сохранился:', e); }
}
function clearSiteCache() {
  Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
}
function cacheTime(time) {
  return new Date(time).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
}


function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function fmtDate(value) {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;

  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("ru-RU", {
      day:"2-digit", month:"2-digit", year:"numeric"
    }).format(d);
  }
  return String(value);
}

function currentWeek() {
  const d = new Date();
  d.setHours(0,0,0,0);
  const diff = (d.getDay() - 2 + 7) % 7;

  const start = new Date(d);
  start.setDate(d.getDate() - diff);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {start, end};
}

function saveSession(p, isAdmin=false) {
  localStorage.setItem("owl_password", p);
  localStorage.setItem("owl_is_admin", isAdmin ? "1" : "0");
  localStorage.setItem(
    "owl_expires",
    String(Date.now() + SESSION_DAYS * 86400000)
  );
}

function clearSession() {
  localStorage.removeItem("owl_password");
  localStorage.removeItem("owl_is_admin");
  localStorage.removeItem("owl_expires");
}

function isAdminSession() {
  return localStorage.getItem("owl_is_admin") === "1";
}

function applyRoleVisibility() {
  const admin = isAdminSession();
  const settingsTab = document.querySelector('.tab[data-tab="settings"]');
  const settingsPanel = document.querySelector('#settings');

  if (settingsTab) settingsTab.classList.toggle("hidden", !admin);
  if (settingsPanel && !admin) settingsPanel.classList.remove("active");

  if (!admin && settingsTab?.classList.contains("active")) {
    settingsTab.classList.remove("active");
    const fallbackTab = document.querySelector('.tab:not([data-tab="settings"])');
    if (fallbackTab) {
      fallbackTab.classList.add("active");
      const panel = document.querySelector('#' + fallbackTab.dataset.tab);
      if (panel) panel.classList.add("active");
    }
  }
}

function getPassword() {
  const p = localStorage.getItem("owl_password") || "";
  const expires = Number(localStorage.getItem("owl_expires") || 0);

  if (!p || !expires || Date.now() >= expires) {
    clearSession();
    return "";
  }
  return p;
}

function openApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  applyRoleVisibility();

  const w = currentWeek();
  const label = `${fmtDate(w.start)} - ${fmtDate(w.end)}`;
  $("#weekLabel").textContent = label;
  $("#settingsWeek").textContent = label;
}

function logout() {
  localStorage.removeItem(PENDING_REPORT_KEY);
  clearSiteCache();
  clearSession();
  location.reload();
}

async function rawGet(params={}, password=getPassword()) {
  const {action, ...query} = params;
  const paths = {login:'/login', participants:'/participants', current:'/current',
                 settings:'/settings', stats:'/stats'};
  if (!paths[action]) throw new Error("Неизвестное действие");
  const suffix = new URLSearchParams(query).toString();
  return websiteRequest(paths[action] + (suffix ? '?' + suffix : ''), undefined, password);
}

async function apiGet(params={}) {
  const data = await rawGet(params);

  if (data.unauthorized) {
    clearSession();
    location.reload();
    throw new Error("Сессия завершена");
  }

  return data;
}

async function apiPost(payload) {
  if (payload.action !== 'saveGoal') throw new Error("Неизвестное действие");
  return websiteRequest('/settings', {goal:payload.goal});
}

async function websiteRequest(path, payload, password=getPassword()) {
  const isLogin = path === "/login";
  if (!password) throw new Error("Сессия завершена");
  const bytes = new TextEncoder().encode(password);
  const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(WEBSITE_API_BASE + path, {
      method: payload ? 'POST' : 'GET',
      headers: payload
        ? {'X-Website-Password': encoded, 'Content-Type': 'application/json'}
        : {'X-Website-Password': encoded},
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store', signal: controller.signal
    });
    if (!isLogin && getPassword() !== password) throw new Error("Сессия завершена");
    if (response.status === 401 && !isLogin) {
      clearSiteCache(); clearSession(); location.reload();
      throw new Error("Сессия завершена");
    }
    const data = await response.json();
    if (!response.ok || !(data.success || data.ok)) throw new Error(data.error || "Не удалось подтвердить операцию");
    return data;
  } finally { clearTimeout(timer); }
}

async function submitWebsiteReport(payload) {
  let pending;
  try { pending = JSON.parse(localStorage.getItem(PENDING_REPORT_KEY) || 'null'); }
  catch { pending = null; }
  if (!pending || typeof pending.requestId !== 'string'
      || !/^[a-zA-Z0-9_-]{16,100}$/.test(pending.requestId)
      || pending.name !== payload.name || pending.plan !== payload.plan || pending.fact !== payload.fact) {
    pending = {...payload, requestId: crypto.randomUUID()};
    // Без сохранённого идентификатора нельзя безопасно повторить потерянный ответ.
    localStorage.setItem(PENDING_REPORT_KEY, JSON.stringify(pending));
  }
  const data = await websiteRequest('/records', pending);
  if (!data.warning && data.artifactStatus !== 'pending' && data.notificationStatus !== 'pending') {
    // Другой вкладке мог уже понадобиться собственный повтор запроса.
    if (localStorage.getItem(PENDING_REPORT_KEY) === JSON.stringify(pending)) {
      localStorage.removeItem(PENDING_REPORT_KEY);
    }
  }
  return data;
}

async function loadParticipants() {
  try {
    const saved = readCache('participants');
    if (saved?.data?.success && Array.isArray(saved.data.people)
        && Number.isFinite(saved.time) && saved.time <= Date.now()
        && Date.now() - saved.time < PARTICIPANTS_CACHE_TTL) {
      PEOPLE = saved.data.people;
      return;
    }
    const data = await websiteRequest('/participants');
    PEOPLE = data.success && Array.isArray(data.people) ? data.people : [];
    if (data.success && Array.isArray(data.people)) writeCache('participants', data);
  } catch (e) {
    console.error("Не удалось загрузить список участников", e);
    PEOPLE = [];
  }
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const password = $("#password").value;
  const btn = e.currentTarget.querySelector("button");

  btn.disabled = true;
  btn.textContent = "Вхожу...";
  $("#loginError").textContent = "";

  try {
    const data = await rawGet({action:"login"}, password);

    if (!data.success || data.unauthorized) {
      throw new Error("Неверный пароль");
    }

    if (getPassword() !== password) clearSiteCache();
    saveSession(password, Boolean(data.isAdmin));
    openApp();
    await loadParticipants();
  } catch(err) {
    $("#loginError").textContent =
      err.message === "Неверный пароль"
        ? "Неверный пароль"
        : "Не удалось войти";
  } finally {
    btn.disabled = false;
    btn.textContent = "Войти";
  }
});

$("#logout").addEventListener("click", logout);

function renderPeople(query="") {
  const q = query.trim().toLocaleLowerCase("ru-RU");

  const found = PEOPLE.filter(name =>
    name.toLocaleLowerCase("ru-RU").includes(q)
  );

  $("#personList").innerHTML = found.length
    ? found.map(name =>
        `<button type="button" class="person-option"
          data-name="${esc(name)}">${esc(name)}</button>`
      ).join("")
    : '<div class="no-results">Ничего не найдено</div>';

  $("#personList").classList.remove("hidden");

  $$(".person-option").forEach(btn => {
    btn.addEventListener("click", () => selectPerson(btn.dataset.name));
  });
}

$("#personSearch").addEventListener("focus", async e => {
  renderPeople(e.target.value);
  await loadParticipants();
  if (document.activeElement === e.target) renderPeople(e.target.value);
});

$("#personSearch").addEventListener("input", e => {
  selectedName = "";
  $("#selectedPerson").classList.add("hidden");
  $("#plan").value = "";
  $("#fact").value = "";
  $("#loadHint").textContent = "";
  renderPeople(e.target.value);
});

document.addEventListener("click", e => {
  if (!e.target.closest(".combo")) {
    $("#personList").classList.add("hidden");
  }
});

async function selectPerson(name) {
  selectedName = name;
  $("#personSearch").value = name;
  $("#personList").classList.add("hidden");

  $("#selectedPerson").textContent = "✓ " + name;
  $("#selectedPerson").classList.remove("hidden");

  $("#plan").value = "";
  $("#fact").value = "";
  $("#loadHint").textContent = "Загружаю текущие данные...";

  try {
    const data = await websiteRequest('/current?name=' + encodeURIComponent(name));

    if (!data.success) throw new Error(data.error || "Ошибка");

    if (data.record) {
      $("#plan").value = data.record.plan;
      $("#fact").value = data.record.fact;
      $("#loadHint").textContent =
        "Найдена запись за эту неделю. Сохранение обновит ее.";
    } else {
      $("#loadHint").textContent =
        "За эту неделю записи пока нет.";
    }
  } catch {
    $("#loadHint").textContent =
      "Не удалось загрузить данные.";
  }
}

$("#save").addEventListener("click", async () => {
  const plan = $("#plan").value;
  const fact = $("#fact").value;

  if (!selectedName)
    return showMessage("#message","Выберите участника.",true);

  if (plan === "" || fact === "")
    return showMessage("#message","Заполните план и факт.",true);

  if (+plan < 0 || +fact < 0)
    return showMessage("#message","Значения не могут быть отрицательными.",true);

  const btn = $("#save");
  btn.disabled = true;
  btn.textContent = "Сохраняю...";

  try {
    const data = await submitWebsiteReport({
      name:selectedName,
      plan:Number(plan),
      fact:Number(fact)
    });

    if (!data.success) throw new Error(data.error || "Ошибка");

    localStorage.removeItem(CACHE_PREFIX + STATS_CACHE_KEY);
    let savedMessage = "✓ Данные сохранены";
    if (data.warning) savedMessage += ". " + data.warning;
    else if (data.artifact?.dropped) savedMessage += ". ✨ Выпал артефакт: " + data.artifact.artifact.name;
    showMessage("#message", savedMessage);
    $("#loadHint").textContent =
      "Актуальная запись за неделю обновлена.";
  } catch(err) {
    showMessage("#message","Не удалось сохранить: " + err.message,true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить";
  }
});

$$(".tab").forEach(btn => {
  btn.addEventListener("click", async () => {
    $$(".tab").forEach(x => x.classList.remove("active"));
    $$(".panel").forEach(x => x.classList.remove("active"));

    btn.classList.add("active");
    $("#" + btn.dataset.tab).classList.add("active");

    if (btn.dataset.tab === "stats") await loadStats();
    if (btn.dataset.tab === "treasury" && window.owlsOpenTreasury) await window.owlsOpenTreasury();
    if (btn.dataset.tab === "settings") {
      if (!isAdminSession()) return;
      await loadSettings();
    }
  });
});

async function loadSettings() {
  if (!isAdminSession()) return;
  $("#settingsMessage").classList.add("hidden");

  try {
    const data = await apiGet({action:"settings"});
    if (!data.success) throw new Error(data.error || "Ошибка");

    $("#teamGoal").value = data.teamGoal ?? "";
  } catch(err) {
    showMessage(
      "#settingsMessage",
      "Не удалось загрузить цель: " + err.message,
      true
    );
  }
}

$("#saveGoal").addEventListener("click", async () => {
  if (!isAdminSession()) return;
  const goal = $("#teamGoal").value;

  if (goal === "" || +goal < 0) {
    return showMessage(
      "#settingsMessage",
      "Введите корректную цель.",
      true
    );
  }

  const btn = $("#saveGoal");
  btn.disabled = true;
  btn.textContent = "Сохраняю...";

  try {
    const data = await apiPost({
      action:"saveGoal",
      goal:Number(goal)
    });

    if (!data.success) throw new Error(data.error || "Ошибка");

    localStorage.removeItem(CACHE_PREFIX + STATS_CACHE_KEY);
    showMessage(
      "#settingsMessage",
      "✓ Командная цель сохранена"
    );
  } catch(err) {
    showMessage(
      "#settingsMessage",
      "Не удалось сохранить: " + err.message,
      true
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить цель";
  }
});

function showMessage(selector,text,error=false) {
  const el = $(selector);
  el.textContent = text;
  el.classList.remove("hidden","bad");

  if (error) el.classList.add("bad");
}


function statsWeekStart() {
  // Неделя API начинается во вторник по московскому времени.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  const date = new Date(Date.UTC(+part('year'), +part('month') - 1, +part('day')));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - 2 + 7) % 7);
  return date.toISOString().slice(0, 10);
}

function currentStatsCache() {
  if (!getPassword()) return null;
  const saved = readCache(STATS_CACHE_KEY);
  return saved?.data?.success && Number.isFinite(saved.time)
    && saved.time <= Date.now()
    && saved.data.currentWeek?.start === statsWeekStart() ? saved : null;
}

async function fetchStats() {
  const password = getPassword();
  if (!password) {
    const error = new Error("Сессия завершена");
    error.unauthorized = true;
    throw error;
  }
  if (statsRequest?.password === password) return statsRequest.promise;
  const pending = {password};
  pending.promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const bytes = new TextEncoder().encode(password);
      const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
      const response = await fetch(STATS_API_URL, {
        headers: {"X-Website-Password": encoded},
        cache: "no-store",
        signal: controller.signal
      });
      if (getPassword() !== password) {
        const error = new Error("Сессия завершена");
        error.unauthorized = true;
        throw error;
      }
      if (response.status === 401) {
        clearSiteCache();
        clearSession();
        const error = new Error("Сессия завершена");
        error.unauthorized = true;
        location.reload();
        throw error;
      }
      if (!response.ok) throw new Error("Ошибка соединения");
      const data = await response.json();
      if (!data.success || !data.currentWeek?.start
          || !Array.isArray(data.currentRecords) || !Array.isArray(data.weeks)) {
        throw new Error("Некорректный ответ статистики");
      }
      if (getPassword() !== password) {
        const error = new Error("Сессия завершена");
        error.unauthorized = true;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  })();
  statsRequest = pending;
  try { return await pending.promise; }
  finally { if (statsRequest === pending) statsRequest = null; }
}

async function getStatsForExport() {
  const cached = currentStatsCache();
  if (cached && Date.now() - cached.time < STATS_CACHE_TTL) return cached.data;
  const data = await fetchStats();
  writeCache(STATS_CACHE_KEY, data);
  return data;
}

async function loadStats(force = false) {
  const btn = $("#statsRefresh");
  const status = $("#statsCacheStatus");
  const cached = currentStatsCache();
  if (!force && cached && Date.now() - cached.time < STATS_CACHE_TTL) {
    renderStats(cached.data);
    status.textContent = `Сохранённые данные от ${cacheTime(cached.time)}`;
    return;
  }
  if (!cached) {
    $("#currentStats").innerHTML = '<div class="card">Загружаю...</div>';
    $("#statsContent").innerHTML = "";
  }
  btn.disabled = true;
  status.textContent = 'Обновляем данные...';
  try {
    const data = await fetchStats();
    if (!data.success) throw new Error(data.error || "Ошибка");
    writeCache(STATS_CACHE_KEY, data);
    renderStats(data);
    status.textContent = `Обновлено ${cacheTime(Date.now())}`;
  } catch(err) {
    if (err.unauthorized) {
      $("#currentStats").innerHTML = "";
      $("#statsContent").innerHTML = "";
      status.textContent = 'Сессия завершена';
    } else if (cached?.data?.success) {
      renderStats(cached.data);
      status.textContent = `Ошибка обновления. Показаны данные от ${cacheTime(cached.time)}`;
    } else {
      $("#currentStats").innerHTML = '<div class="card error-box">Не удалось загрузить статистику</div>';
      status.textContent = 'Ошибка загрузки';
    }
  } finally { btn.disabled = false; }
}
$("#statsRefresh").addEventListener('click', () => loadStats(true));

function renderStats(data) {
  loadStatsHistory();
  const currentRecords = data.currentRecords || [];

  const plan = currentRecords.reduce(
    (s,r) => s + Number(r.plan || 0), 0
  );

  const fact = currentRecords.reduce(
    (s,r) => s + Number(r.fact || 0), 0
  );

  const goal =
    data.teamGoal == null ? null : Number(data.teamGoal);

  const shortage =
    goal == null ? null : Math.max(0, goal - fact);

  const addPerPerson =
    shortage == null
      ? null
      : shortage === 0
        ? 0
        : Math.ceil(shortage / Math.max(1, Number(data.activePeopleCount || data.peopleCount || PEOPLE.length)));

  let catchup;

  if (goal == null) {
    catchup =
      '<strong>Цель не задана</strong><small>Укажите ее в настройках</small>';
  } else if (shortage === 0) {
    catchup =
      '<strong>✓ Цель достигнута</strong><small>Добавлять к плану не нужно</small>';
  } else {
    catchup =
      `<strong>+${addPerPerson} на человека</strong>` +
      `<small>Не хватает ${shortage} мышей до цели по факту</small>`;
  }

  $("#currentStats").innerHTML = `
    <div class="current-title">
      <h3>Текущая неделя</h3>
      <span>${fmtDate(data.currentWeek.start)} - ${fmtDate(data.currentWeek.end)}</span>
    </div>

    <div class="summary4">
      <div class="metric">
        <span>Цель команды</span>
        <strong>${goal ?? "—"}</strong>
      </div>

      <div class="metric">
        <span>Суммарный план</span>
        <strong>${plan}</strong>
      </div>

      <div class="metric">
        <span>Суммарный факт</span>
        <strong>${fact}</strong>
      </div>

      <div class="metric catchup">${catchup}</div>
    </div>
  `;

  const weeks = (data.weeks || []).filter(w => {
    const start = String(w.weekStart || "").slice(0,10);
    const end = String(w.weekEnd || "").slice(0,10);
    return start === String(data.currentWeek?.start || "").slice(0,10)
      && end === String(data.currentWeek?.end || "").slice(0,10);
  });

  if (!weeks.length) {
    $("#statsContent").innerHTML =
      '<div class="card muted">Данных пока нет.</div>';
    return;
  }

  $("#statsContent").innerHTML = weeks.map(w => {
    const p = w.records.reduce(
      (s,r) => s + Number(r.plan || 0), 0
    );

    const f = w.records.reduce(
      (s,r) => s + Number(r.fact || 0), 0
    );

    return `
      <div class="card week-card">
        <h3>${fmtDate(w.weekStart)} - ${fmtDate(w.weekEnd)}</h3>
        <div class="week-goal">Цель: <strong>${w.goal ?? "—"}</strong></div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>План</th>
                <th>Факт</th>
                <th>%</th>
              </tr>
            </thead>

            <tbody>
              ${w.records.map(r => `
                <tr>
                  <td>${esc(r.name)}</td>
                  <td>${r.plan}</td>
                  <td>${r.fact}</td>
                  <td>${r.plan ? Math.round(r.fact/r.plan*100) : 0}%</td>
                </tr>
              `).join("")}

              <tr class="total">
                <td>Итого</td>
                <td>${p}</td>
                <td>${f}</td>
                <td>${p ? Math.round(f/p*100) : 0}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

$("#download").addEventListener("click", async () => {
  try {
    const data = await getStatsForExport();

    const rows = [[
      "Неделя с","Неделя по","Цель",
      "Имя","План","Факт","Последнее изменение"
    ]];

    (data.weeks || []).filter(w => {
      const start = String(w.weekStart || "").slice(0,10);
      const end = String(w.weekEnd || "").slice(0,10);
      return start === String(data.currentWeek?.start || "").slice(0,10)
        && end === String(data.currentWeek?.end || "").slice(0,10);
    }).forEach(w => {
      w.records.forEach(r => {
        rows.push([
          fmtDate(w.weekStart),
          fmtDate(w.weekEnd),
          w.goal ?? "",
          r.name,
          r.plan,
          r.fact,
          r.updated
        ]);
      });
    });

    const csv = "\uFEFF" + rows.map(row =>
      row.map(v =>
        `"${String(v ?? "").replaceAll('"','""')}"`
      ).join(";")
    ).join("\n");

    const blob = new Blob(
      [csv],
      {type:"text/csv;charset=utf-8"}
    );

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sychnaya-ohota-statistika.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch(err) {
    alert("Не удалось выгрузить статистику");
  }
});

async function restoreSession() {
  const password = getPassword();
  if (!password) return;

  try {
    const data = await rawGet({action:"login"}, password);
    if (!data.success || data.unauthorized) {
      clearSession();
      return;
    }

    saveSession(password, Boolean(data.isAdmin));
    openApp();
    await loadParticipants();
  } catch (err) {
    console.error("Не удалось восстановить сессию", err);
    clearSession();
  }
}

restoreSession();



let historyData = null;
let historyPending = null;
let historySelection = '';
const HISTORY_CACHE_KEY = 'stats_history_v1';

async function loadStatsHistory(force = false) {
  let host = $('#statsHistory');
  if (!host) {
    host = document.createElement('div');
    host.id = 'statsHistory';
    $('#statsContent').after(host);
  }
  if (historyPending) return historyPending;
  const password = getPassword();
  const cached = readCache(HISTORY_CACHE_KEY);
  if (!force && cached?.data?.success && cached.data.currentWeek?.start === statsWeekStart()
      && Date.now() >= cached.time && Date.now() - cached.time < STATS_CACHE_TTL) {
    historyData = cached.data;
    renderStatsHistory(host);
    return;
  }
  host.innerHTML = '<div class="card">Загружаю историю недель…</div>';
  historyPending = (async () => {
    try {
      const data = await websiteRequest('/history');
      if (password !== getPassword()) return;
      if (!Array.isArray(data.weeks)) throw new Error('Некорректная история');
      historyData = data;
      writeCache(HISTORY_CACHE_KEY, data);
      renderStatsHistory(host);
    } catch (error) {
      if (password !== getPassword()) return;
      host.innerHTML = '<div class="card">Не удалось загрузить историю. <button type="button" id="historyRetry">Повторить</button></div>';
      $('#historyRetry').addEventListener('click', () => loadStatsHistory(true));
    } finally { historyPending = null; }
  })();
  return historyPending;
}

function historyChart(weeks, field, title, color) {
  const width = Math.max(320, weeks.length * 64);
  const max = Math.max(1, ...weeks.map(w => Number(w[field] || 0)));
  const bars = weeks.map((w, i) => {
    const value = Number(w[field] || 0);
    const h = value / max * 110;
    const x = 22 + i * 64;
    return `<g><title>${esc(fmtDate(w.weekStart))}: ${value}</title>
      <rect x="${x}" y="${140-h}" width="36" height="${h}" rx="3" fill="${color}"/>
      <text x="${x+18}" y="${132-h}" text-anchor="middle" font-size="12" fill="currentColor">${value}</text>
      <text x="${x+18}" y="160" text-anchor="middle" font-size="11" fill="currentColor">${esc(fmtDate(w.weekStart).slice(0,5))}</text></g>`;
  }).join('');
  return `<h4>${title}</h4><div style="overflow-x:auto"><svg role="img" aria-label="${title}. Точные значения приведены в таблице ниже" width="${width}" height="180" viewBox="0 0 ${width} 180">${bars}</svg></div>`;
}

function renderStatsHistory(host) {
  const weeks = [...historyData.weeks].sort((a,b) => a.weekStart.localeCompare(b.weekStart));
  if (!weeks.length) { host.innerHTML = '<div class="card">Истории пока нет.</div>'; return; }
  if (!weeks.some(w => w.weekStart === historySelection)) historySelection = weeks.at(-1).weekStart;
  const selected = weeks.find(w => w.weekStart === historySelection);
  const label = w => `${fmtDate(w.weekStart)} – ${fmtDate(w.weekEnd)}${w.weekStart === historyData.currentWeek.start ? ' (идёт сейчас)' : ''}`;
  host.innerHTML = `<div class="card"><h3>История по неделям</h3>
    <p class="muted">Активный сычик — факт больше нуля за неделю. Текущая неделя ещё не завершена.</p>
    <label for="historyWeek">Выберите неделю</label>
    <select id="historyWeek" style="width:100%;padding:12px;font:inherit">${[...weeks].reverse().map(w =>
      `<option value="${esc(w.weekStart)}" ${w.weekStart === historySelection ? 'selected' : ''}>${esc(label(w))}</option>`).join('')}</select>
    <h4>${esc(label(selected))}</h4><p>Цель: ${selected.goal ?? '—'} · Мышей: ${selected.totalMice} · Активных сычиков: ${selected.activeOwlets}</p>
    <div class="table-wrap"><table><thead><tr><th>Имя</th><th>План</th><th>Факт</th><th>%</th></tr></thead><tbody>
    ${selected.records.map(r => `<tr><td>${esc(r.name)}</td><td>${Number(r.plan)}</td><td>${Number(r.fact)}</td><td>${r.plan ? Math.round(r.fact/r.plan*100) : '—'}%</td></tr>`).join('')}
    </tbody></table></div></div><div class="card"><h3>Динамика по неделям</h3>
    ${historyChart(weeks, 'totalMice', 'Сумма мышей (факт)', '#b15a38')}
    ${historyChart(weeks, 'activeOwlets', 'Активные сычики', '#47786c')}
    <details><summary>Значения по неделям</summary><div class="table-wrap"><table><thead><tr><th>Неделя</th><th>Мыши</th><th>Активные сычики</th></tr></thead><tbody>
      ${weeks.map(w => `<tr><td>${esc(label(w))}</td><td>${w.totalMice}</td><td>${w.activeOwlets}</td></tr>`).join('')}
    </tbody></table></div></details><button type="button" id="historyRefresh">Обновить историю</button></div>`;
  $('#historyWeek').addEventListener('change', e => { historySelection = e.target.value; renderStatsHistory(host); });
  $('#historyRefresh').addEventListener('click', () => loadStatsHistory(true));
}
