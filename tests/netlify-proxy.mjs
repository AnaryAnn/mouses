import {test} from 'node:test';
import assert from 'node:assert/strict';
import proxy from '../netlify-proxy/functions/proxy.mjs';
const SITE = 'https://anaryann.github.io';
const request = (path, options={}) => new Request('https://test.netlify.app'+path, options);

test('прокси: CORS, фиксированный адрес, пароль, запись и ошибки', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url,options});
    return new Response('{"success":true}', {status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    let r = await proxy(request('/api/website/login', {method:'OPTIONS',headers:{Origin:SITE}}));
    assert.equal(r.status,204);assert.equal(calls.length,0);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'),SITE);
    r = await proxy(request('/api/website/records',{method:'POST',headers:{Origin:SITE,'X-Website-Password':'test-only','Content-Type':'application/json'},body:'{"requestId":"same-id"}'}));
    assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
    assert.equal(calls[0].url,'https://owlet-vk-bot.onrender.com/api/website/records');
    assert.equal(calls[0].options.headers.get('X-Website-Password'),'test-only');
    assert.equal(new TextDecoder().decode(calls[0].options.body),'{"requestId":"same-id"}');
    await proxy(request('/api/treasury?action=collection&vkId=0'));
    assert.equal(calls.at(-1).url,'https://owlet-vk-bot.onrender.com/api/treasury?action=collection&vkId=0');
    await proxy(request('/api/website/treasury?action=collection'));
    assert.equal(calls.at(-1).url,'https://owlet-vk-bot.onrender.com/api/website/treasury?action=collection');
    await proxy(request('/health'));
    assert.equal(calls.at(-1).url,'https://owlet-vk-bot.onrender.com/');
    const count = calls.length;
    assert.equal((await proxy(request('/native-schedule'))).status,404);
    assert.equal((await proxy(request('/api/website/login',{headers:{Origin:'https://untrusted.example'}}))).status,403);
    assert.equal((await proxy(request('/api/website/login',{method:'DELETE'}))).status,405);
    assert.equal(calls.length,count);
    globalThis.fetch = async () => new Response('{"unauthorized":true}',{status:401});
    assert.equal((await proxy(request('/api/website/login'))).status,401);
    globalThis.fetch = async () => { throw new Error('internal secret detail'); };
    r = await proxy(request('/health'));
    assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/internal secret/);
  } finally {globalThis.fetch = original;}
});
