const API_URL = "https://script.google.com/macros/s/AKfycbzibdFoJJFpPAGdGtav5XOShS4_NKVUt9f8tYbSqYYkxDi5tFcRbZHBJy0IW2dRYJQj/exec";

const PEOPLE = [
  "Ксения Иликаева",
  "Ульяна Чумакова",
  "Нелли Сидоренко",
  "Ольга Дмитриева",
  "Анна Платонова",
  "Татьяна Демиденко",
  "Анастасия Жумаева",
  "Eileen White",
  "Евгения Емелина",
  "Ксения Медведева",
  "Анастасия Мшвелидзе",
  "Екатерина Севостьянова"
];

const SESSION_DAYS = 7;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function fmtDate(value) {
  if (!value) return "";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;

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

function saveSession(password) {
  localStorage.setItem("owl_password", password);
  localStorage.setItem(
    "owl_expires",
    String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  );
}

function clearSession() {
  localStorage.removeItem("owl_password");
  localStorage.removeItem("owl_expires");
}

function getPassword() {
  const password = localStorage.getItem("owl_password") || "";
  const expires = Number(localStorage.getItem("owl_expires") || 0);

  if (!password || !expires || Date.now() >= expires) {
    clearSession();
    return "";
  }
  return password;
}

function hasSession() {
  return Boolean(getPassword());
}

function openApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  renderLocalInterface();
}

function renderLocalInterface() {
  const w = currentWeek();
  $("#weekLabel").textContent = `${fmtDate(w.start)} - ${fmtDate(w.end)}`;

  $("#name").innerHTML =
    '<option value="">Выберите имя</option>' +
    PEOPLE.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
}

function logout() {
  clearSession();
  location.reload();
}

async function rawGet(params = {}, password = getPassword()) {
  const u = new URL(API_URL);
  Object.entries({...params, password}).forEach(([k,v]) => u.searchParams.set(k,v));

  const r = await fetch(u, {cache:"no-store"});
  if (!r.ok) throw new Error("Ошибка соединения");
  return r.json();
}

async function apiGet(params = {}) {
  const data = await rawGet(params);

  if (data.unauthorized) {
    clearSession();
    location.reload();
    throw new Error("Сессия завершена");
  }
  return data;
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const password = $("#password").value;
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  $("#loginError").textContent = "";
  btn.disabled = true;
  btn.textContent = "Вхожу...";

  try {
    const data = await rawGet({action:"login"}, password);

    if (!data.success || data.unauthorized) {
      throw new Error("Неверный пароль");
    }

    saveSession(password);
    openApp();
  } catch (err) {
    $("#loginError").textContent =
      err.message === "Неверный пароль"
        ? "Неверный пароль"
        : "Не удалось войти. Попробуйте еще раз.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Войти";
  }
});

$("#logout").addEventListener("click", logout);

$$(".tab").forEach(btn => btn.addEventListener("click", async () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  $$(".panel").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  $("#" + btn.dataset.tab).classList.add("active");

  if (btn.dataset.tab === "stats") await loadStats();
}));

$("#name").addEventListener("change", async () => {
  $("#plan").value = "";
  $("#fact").value = "";
  $("#loadHint").textContent = "";

  const name = $("#name").value;
  if (!name) return;

  $("#loadHint").textContent = "Загружаю текущие данные...";

  try {
    const data = await apiGet({action:"current", name});

    if (!data.success) throw new Error(data.error || "Ошибка");

    if (data.record) {
      $("#plan").value = data.record.plan ?? "";
      $("#fact").value = data.record.fact ?? "";
      $("#loadHint").textContent =
        "Найдена запись за эту неделю. Сохранение обновит ее.";
    } else {
      $("#loadHint").textContent = "За эту неделю записи пока нет.";
    }
  } catch (err) {
    $("#loadHint").textContent = "Не удалось загрузить данные.";
  }
});

$("#save").addEventListener("click", async () => {
  const name = $("#name").value;
  const plan = $("#plan").value;
  const fact = $("#fact").value;

  if (!name) return showMessage("Выберите участника.", true);
  if (plan === "" || fact === "") return showMessage("Заполните план и факт.", true);
  if (+plan < 0 || +fact < 0) return showMessage("Значения не могут быть отрицательными.", true);

  const btn = $("#save");
  btn.disabled = true;
  btn.textContent = "Сохраняю...";

  try {
    const r = await fetch(API_URL, {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({
        password:getPassword(),
        name,
        plan:Number(plan),
        fact:Number(fact)
      })
    });

    if (!r.ok) throw new Error("Ошибка соединения");

    const data = await r.json();

    if (data.unauthorized) {
      clearSession();
      location.reload();
      return;
    }

    if (!data.success) throw new Error(data.error || "Ошибка");

    showMessage("✓ Данные сохранены");
    $("#loadHint").textContent = "Актуальная запись за неделю обновлена.";
  } catch (err) {
    showMessage("Не удалось сохранить: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить";
  }
});

function showMessage(text, error = false) {
  const el = $("#message");
  el.textContent = text;
  el.classList.remove("hidden","bad");
  if (error) el.classList.add("bad");
}

async function loadStats() {
  $("#statsContent").innerHTML = '<div class="card">Загружаю...</div>';
  $("#summary").innerHTML = "";

  try {
    const data = await apiGet({action:"stats"});
    if (!data.success) throw new Error(data.error || "Ошибка");
    renderStats(data.records || []);
  } catch (err) {
    $("#statsContent").innerHTML =
      `<div class="card error">Не удалось загрузить статистику: ${esc(err.message)}</div>`;
  }
}

function renderStats(records) {
  const sorted = [...records].sort((a,b) =>
    String(b.weekStart).localeCompare(String(a.weekStart)) ||
    String(a.name).localeCompare(String(b.name),"ru")
  );

  if (!sorted.length) {
    $("#statsContent").innerHTML = '<div class="card muted">Данных пока нет.</div>';
    return;
  }

  const latestWeek = sorted[0].weekStart;
  const latest = sorted.filter(r => r.weekStart === latestWeek);
  const p = latest.reduce((s,r)=>s+Number(r.plan||0),0);
  const f = latest.reduce((s,r)=>s+Number(r.fact||0),0);
  const pct = p ? Math.round(f/p*100) : 0;

  $("#summary").innerHTML = `
    <div class="metric"><span>План</span><strong>${p}</strong></div>
    <div class="metric"><span>Факт</span><strong>${f}</strong></div>
    <div class="metric"><span>Выполнение</span><strong>${pct}%</strong></div>`;

  const groups = {};
  sorted.forEach(r => (groups[r.weekStart] ||= []).push(r));

  $("#statsContent").innerHTML = Object.entries(groups).map(([week, rows]) => {
    const totalP = rows.reduce((s,r)=>s+Number(r.plan||0),0);
    const totalF = rows.reduce((s,r)=>s+Number(r.fact||0),0);

    return `<div class="card week-card">
      <h3>${fmtDate(week)} - ${fmtDate(rows[0].weekEnd)}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Имя</th><th>План</th><th>Факт</th><th>%</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${esc(r.name)}</td>
            <td>${Number(r.plan||0)}</td>
            <td>${Number(r.fact||0)}</td>
            <td>${Number(r.plan) ? Math.round(Number(r.fact)/Number(r.plan)*100) : 0}%</td>
          </tr>`).join("")}
          <tr class="total">
            <td>Итого</td><td>${totalP}</td><td>${totalF}</td>
            <td>${totalP ? Math.round(totalF/totalP*100) : 0}%</td>
          </tr>
        </tbody>
      </table></div>
    </div>`;
  }).join("");
}

$("#download").addEventListener("click", async () => {
  try {
    const data = await apiGet({action:"stats"});
    if (!data.success) throw new Error(data.error || "Ошибка");

    const rows = [["Неделя с","Неделя по","Имя","План","Факт","Последнее изменение"]];
    (data.records||[]).forEach(r =>
      rows.push([fmtDate(r.weekStart),fmtDate(r.weekEnd),r.name,r.plan,r.fact,r.updated])
    );

    const csv = "\uFEFF" + rows.map(row =>
      row.map(v => `"${String(v??"").replaceAll('"','""')}"`).join(";")
    ).join("\n");

    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sychnaya-ohota-statistika.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert("Не удалось выгрузить: " + err.message);
  }
});

// Главное ускорение: если действующая 7-дневная сессия есть,
// интерфейс открывается сразу, без запроса к Apps Script.
if (hasSession()) {
  openApp();
}
