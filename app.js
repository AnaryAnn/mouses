const API_URL = "https://script.google.com/macros/s/AKfycbzibdFoJJFpPAGdGtav5XOShS4_NKVUt9f8tYbSqYYkxDi5tFcRbZHBJy0IW2dRYJQj/exec";

let PEOPLE = [];

const SESSION_DAYS = 7;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
let selectedName = "";

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

function saveSession(p) {
  localStorage.setItem("owl_password", p);
  localStorage.setItem(
    "owl_expires",
    String(Date.now() + SESSION_DAYS * 86400000)
  );
}

function clearSession() {
  localStorage.removeItem("owl_password");
  localStorage.removeItem("owl_expires");
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

  const w = currentWeek();
  const label = `${fmtDate(w.start)} - ${fmtDate(w.end)}`;
  $("#weekLabel").textContent = label;
  $("#settingsWeek").textContent = label;
}

function logout() {
  clearSession();
  location.reload();
}

async function rawGet(params={}, password=getPassword()) {
  const u = new URL(API_URL);

  Object.entries({...params, password})
    .forEach(([k,v]) => u.searchParams.set(k,v));

  const r = await fetch(u, {cache:"no-store"});
  if (!r.ok) throw new Error("Ошибка соединения");

  return r.json();
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
  const r = await fetch(API_URL, {
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({
      ...payload,
      password:getPassword()
    })
  });

  if (!r.ok) throw new Error("Ошибка соединения");

  const data = await r.json();

  if (data.unauthorized) {
    clearSession();
    location.reload();
    throw new Error("Сессия завершена");
  }

  return data;
}

async function loadParticipants() {
  try {
    const data = await apiGet({action:"participants"});
    PEOPLE = data.success && Array.isArray(data.people) ? data.people : [];
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

    saveSession(password);
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

$("#personSearch").addEventListener("focus", e => {
  renderPeople(e.target.value);
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
    const data = await apiGet({action:"current", name});

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
    const data = await apiPost({
      action:"saveRecord",
      name:selectedName,
      plan:Number(plan),
      fact:Number(fact)
    });

    if (!data.success) throw new Error(data.error || "Ошибка");

    showMessage("#message","✓ Данные сохранены");
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
    if (btn.dataset.tab === "settings") await loadSettings();
  });
});

async function loadSettings() {
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

async function loadStats() {
  $("#currentStats").innerHTML =
    '<div class="card">Загружаю...</div>';
  $("#statsContent").innerHTML = "";

  try {
    const data = await apiGet({action:"stats"});

    if (!data.success) throw new Error(data.error || "Ошибка");

    renderStats(data);
  } catch(err) {
    $("#currentStats").innerHTML =
      '<div class="card error-box">Не удалось загрузить статистику</div>';
  }
}

function renderStats(data) {
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
    const data = await apiGet({action:"stats"});

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

if (getPassword()) {
  openApp();
  loadParticipants();
}

