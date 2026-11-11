// Пересылает Callback API VK на фиксированный адрес бота без раннего «ok».
export const config = {path: '/vk-callback'};

export default async function vkCallback(request) {
  const headers = {'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store'};
  if (request.method !== 'POST') return new Response('Method not allowed', {
    status:405, headers:{...headers, Allow:'POST'}});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 1048576) return new Response('Payload too large', {status:413,headers});
    const response = await fetch('https://owlet-vk-bot.onrender.com/vk', {
      method:'POST', headers:{'Content-Type':'application/json'}, body,
      signal:controller.signal, redirect:'error', cache:'no-store'});
    const reply = await response.arrayBuffer();
    return new Response(reply, {status:response.status, headers:{...headers,
      'Content-Type':response.headers.get('Content-Type') || headers['Content-Type']}});
  } catch {
    // Ошибка должна дойти до VK, чтобы он повторил доставку. Тело события не журналируем.
    return new Response('Callback upstream unavailable', {
      status:controller.signal.aborted ? 504 : 502, headers});
  } finally {clearTimeout(timer);}
}
