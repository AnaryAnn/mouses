import {test} from 'node:test';
import assert from 'node:assert/strict';
import callback from '../netlify-proxy/functions/vk-callback.mjs';
const req = body => new Request('https://test.netlify.app/vk-callback', {method:'POST',body:JSON.stringify(body)});
test('VK: тело события, код подтверждения и ошибки пересылаются без раннего ok', async () => {
  const original = globalThis.fetch;
  try {
    let calls=0;
    const event={type:'confirmation',group_id:123,secret:'test-only'};
    globalThis.fetch=async (url,opts)=>{
      calls++;
      assert.equal(url,'https://owlet-vk-bot.onrender.com/vk');
      assert.deepEqual(JSON.parse(new TextDecoder().decode(opts.body)),event);
      assert.equal(opts.redirect,'error');
      return new Response('test-confirm-code',{headers:{'Content-Type':'text/plain'}});
    };
    const response=await callback(req(event));
    assert.equal(response.status,200);assert.equal(await response.text(),'test-confirm-code');
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal((await callback(new Request('https://test.netlify.app/vk-callback'))).status,405);
    assert.equal(calls,1);
    globalThis.fetch=async()=>new Response('failure',{status:503});
    const failure=await callback(req({type:'message_new'}));
    assert.equal(failure.status,503);assert.equal(await failure.text(),'failure');
    globalThis.fetch=async()=>{throw Error('private-detail')};
    const network=await callback(req({type:'message_new'}));
    assert.equal(network.status,502);assert.doesNotMatch(await network.text(),/private-detail|^ok$/);
  } finally {globalThis.fetch=original;}
});
