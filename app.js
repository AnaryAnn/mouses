const API_URL = 'https://script.google.com/macros/s/AKfycbzibdFoJJFpPAGdGtav5XOShS4_NKVUt9f8tYbSqYYkxDi5tFcRbZHBJy0IW2dRYJQj/exec';

// ВАЖНО: для GitHub Pages это только простой экранный пароль.
// Настоящая защита должна проверяться на сервере (Apps Script).
// Перед публикацией замените пароль ниже.
const SITE_PASSWORD = "mouse2026";

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y,m,d] = String(iso).slice(0,10).split("-");
  return `${d}.${m}.${y}`;
}

function currentWeek() {
  const d = new Date();
  d.setHours(0,0,0,0);
  const diff = (d.getDay() - 2 + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const iso = x => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
  return {start: iso(start), end: iso(end)};
}

function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  init();
}

$("#loginForm").addEventListener("submit", e => {
  e.preventDefault();
  if ($("#password").value === SITE_PASSWORD) {
    sessionStorage.setItem("owl_auth","1");
    $("#loginError").textContent = "";
    showApp();
  } else {
    $("#loginError").textContent = "Неверный пароль";
  }
});

$("#logout").addEventListener("click", () => {
  sessionStorage.removeItem("owl_auth");
  location.reload();
});

if (sessionStorage.getItem("owl_auth") === "1") showApp();

$$(".tab").forEach(btn => btn.addEventListener("click", async () => {
  $$(".tab").forEach(x => x.classList.remove("active"));
  $$(".panel").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  $("#" + btn.dataset.tab).classList.add("active");
  if (btn.dataset.tab === "stats") await loadStats();
}));

async function apiGet(params={}) {
  const u = new URL(API_URL);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,v));
  const r = await fetch(u);
  if (!r.ok) throw new Error("Ошибка соединения");
  return r.json();
}

async function init() {
  const w = currentWeek();
  $("#weekLabel").textContent = `${fmtDate(w.start)} - ${fmtDate(w.end)}`;
  try {
    const data = await apiGet({action:"people"});
    if (!data.success) throw new Error(data.error || "Ошибка");
    $("#name").innerHTML = '<option value="">Выберите имя</option>' +
      data.people.map(n => `<option>${esc(n)}</option>`).join("");
  } catch(e) {
    showMessage("Не удалось загрузить список: " + e.message, true);
  }
}

$("#name").addEventListener("change", async () => {
  $("#plan").value = "";
  $("#fact").value = "";
  $("#loadHint").textContent = "";
  if (!$("#name").value) return;
  $("#loadHint").textContent = "Загружаю текущие данные...";
  try {
    const data = await apiGet({action:"current", name:$("#name").value});
    if (!data.success) throw new Error(data.error || "Ошибка");
    if (data.record) {
      $("#plan").value = data.record.plan ?? "";
      $("#fact").value = data.record.fact ?? "";
      $("#loadHint").textContent = "Найдена запись за эту неделю. Сохранение обновит ее.";
    } else {
      $("#loadHint").textContent = "За эту неделю записи пока нет.";
    }
  } catch(e) {
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
      body:JSON.stringify({name, plan:Number(plan), fact:Number(fact)})
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.error || "Ошибка");
    showMessage("✓ Данные сохранены");
    $("#loadHint").textContent = "Актуальная запись за неделю обновлена.";
  } catch(e) {
    showMessage("Не удалось сохранить: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Сохранить";
  }
});

function showMessage(text, error=false) {
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
  } catch(e) {
    $("#statsContent").innerHTML = `<div class="card error">Не удалось загрузить статистику: ${esc(e.message)}</div>`;
  }
}

function renderStats(records) {
  const sorted = [...records].sort((a,b) =>
    String(b.weekStart).localeCompare(String(a.weekStart)) || String(a.name).localeCompare(String(b.name), "ru")
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
          ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.plan}</td><td>${r.fact}</td><td>${Number(r.plan) ? Math.round(Number(r.fact)/Number(r.plan)*100) : 0}%</td></tr>`).join("")}
          <tr class="total"><td>Итого</td><td>${totalP}</td><td>${totalF}</td><td>${totalP ? Math.round(totalF/totalP*100) : 0}%</td></tr>
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
    (data.records||[]).forEach(r => rows.push([r.weekStart,r.weekEnd,r.name,r.plan,r.fact,r.updated]));
    const csv = "\uFEFF" + rows.map(row => row.map(v => `"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sychnaya-ohota-statistika.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(e) {
    alert("Не удалось выгрузить: " + e.message);
  }
});
