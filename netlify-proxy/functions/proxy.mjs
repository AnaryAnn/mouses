// Только фиксированные API Робосычика. Адрес назначения не задаётся пользователем.
const UPSTREAM = 'https://owlet-vk-bot.onrender.com';
const SITE = 'https://anaryann.github.io';
const ROUTES = new Set(['login', 'participants', 'current', 'settings', 'stats',
  'history', 'records', 'preflight'].map(name => '/api/website/' + name));

export const config = {path: ['/health', '/api/website/*', '/api/treasury']};

export default async function proxy(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const headers = new Headers({'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8'});
  if (origin === SITE) {
    headers.set('Access-Control-Allow-Origin', SITE);
    headers.set('Access-Control-Allow-Headers', 'X-Website-Password, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  const error = (status, message) => new Response(JSON.stringify({success:false, error:message}), {status, headers});
  if (origin && origin !== SITE) return error(403, 'Источник запроса не разрешён');
  if (!ROUTES.has(url.pathname) && !['/health', '/api/treasury'].includes(url.pathname)) return error(404, 'Маршрут не найден');
  if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) return error(405, 'Метод не разрешён');
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (url.pathname === '/health' && request.method !== 'GET') return error(405, 'Метод не разрешён');
  const forwarded = new Headers({'Accept': 'application/json'});
  for (const name of ['X-Website-Password', 'Content-Type']) {
    if (request.headers.has(name)) forwarded.set(name, request.headers.get(name));
  }
  if (origin) forwarded.set('Origin', origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > 65536) return error(413, 'Слишком большой запрос');
    const destination = url.pathname === '/health' ? UPSTREAM + '/' : UPSTREAM + url.pathname + url.search;
    const response = await fetch(destination, {method:request.method, headers:forwarded,
      body, signal:controller.signal, redirect:'error', cache:'no-store'});
    const data = await response.arrayBuffer();
    headers.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
    return new Response(data, {status:response.status, headers});
  } catch {
    // Пароли, тело запроса и детали соединения не попадают в журнал или ответ.
    return error(controller.signal.aborted ? 504 : 502, 'Сервер временно недоступен. Попробуйте ещё раз');
  } finally { clearTimeout(timer); }
}
