/* Сокровищница: отдельный интерфейс. Не вмешивается в регистрацию мышей и пароли. */
(() => {
  'use strict';
  const CLOUDINARY_PREFIX = 'https://res.cloudinary.com/jlcfrihy/image/upload/';
  const MAX_CARDS = 200;
  const COLORS = {'обычный':'#b6aaa0','необычный':'#5caa73','редкий':'#619bd7','эпический':'#a77cce','легендарный':'#e5b64d'};
  const $t = id => document.getElementById(id);
  const state = {started:false, people:[], selectedId:'', selectedLabel:'', mode:'mine', rarity:'all', all:[], mine:[], total:MAX_CARDS, globalLoaded:false, myLoaded:false, searchOpened:false, requestId:0};

  const TREASURY_CACHE = 'owl_treasury_global_v1';
  function globalCache() {
    try { return JSON.parse(localStorage.getItem(TREASURY_CACHE) || 'null'); }
    catch { return null; }
  }
  async function treasuryGet(action, params = {}) {
    const query = new URLSearchParams({action, ...params});
    return websiteRequest('/treasury?' + query.toString());
  }

  function setNotice(message) { $t('treasuryNotice').textContent = message; }
  function setBusy(busy) { $t('treasuryRefresh').disabled = busy; }
  function setMode(mode) {
    state.mode = mode;
    state.rarity = 'all';
    document.querySelectorAll('#owlTreasury [data-tmode]').forEach(btn => {
      const active = btn.dataset.tmode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('#owlTreasury [data-trarity]').forEach(btn => btn.classList.toggle('selected', btn.dataset.trarity === 'all'));
    $t('treasuryPersonBox').hidden = mode !== 'mine';
    render();
    if (mode === 'all' && !state.globalLoaded) loadGlobal();
  }

  function filterPeople(query) {
    const q = query.trim().toLocaleLowerCase('ru-RU');
    return state.people.filter(p => p.label.toLocaleLowerCase('ru-RU').includes(q));
  }
  function showPeople() {
    const results = filterPeople($t('treasuryPersonSearch').value);
    const list = $t('treasuryPersonList');
    list.replaceChildren();
    if (!results.length) {
      const p = document.createElement('div');
      p.className = 'treasury-no-results';
      p.textContent = 'Участники не найдены';
      list.append(p);
    } else {
      results.forEach(person => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'treasury-person-option';
        btn.setAttribute('role','option');
        btn.textContent = person.label;
        btn.addEventListener('click', () => choosePerson(person));
        list.append(btn);
      });
    }
    list.hidden = false;
    $t('treasuryPersonSearch').setAttribute('aria-expanded', 'true');
    state.searchOpened = true;
  }
  function hidePeople() {
    $t('treasuryPersonList').hidden = true;
    $t('treasuryPersonSearch').setAttribute('aria-expanded', 'false');
    state.searchOpened = false;
  }
  function choosePerson(person) {
    state.selectedId = person.vkId;
    state.selectedLabel = person.label;
    state.mine = [];
    state.myLoaded = false;
    $t('treasuryPersonSearch').value = person.label;
    $t('treasuryPersonHint').textContent = `Коллекция: ${person.label}`;
    hidePeople();
    setMode('mine');
    loadPersonal(person.vkId);
  }
  async function loadPeople() {
    const response = await treasuryGet('participants');
    if (!response || response.ok !== true || !Array.isArray(response.participants)) {
      throw new Error('API ещё не обновлён для списка участников');
    }
    const byId = new Map();
    response.participants.forEach(p => {
      const vkId = String(p.vkId ?? '').trim();
      const name = String(p.name ?? '').trim();
      if (/^\d{1,20}$/.test(vkId) && name && !byId.has(vkId)) byId.set(vkId,{vkId,name});
    });
    const people = [...byId.values()].sort((a,b) => a.name.localeCompare(b.name,'ru-RU'));
    const counts = new Map();
    people.forEach(p => counts.set(p.name, (counts.get(p.name) || 0) + 1));
    state.people = people.map(p => ({...p,label:counts.get(p.name)>1 ? `${p.name} (VK ${p.vkId})` : p.name}));
    if (state.selectedId) {
      const found = state.people.find(p => p.vkId === state.selectedId);
      if (found) {state.selectedLabel = found.label;$t('treasuryPersonSearch').value = found.label;}
      else {state.selectedId='';state.selectedLabel='';state.mine=[];state.myLoaded=false;$t('treasuryPersonSearch').value='';}
    }
    $t('treasuryPersonHint').textContent = state.people.length
      ? (state.selectedLabel ? `Коллекция: ${state.selectedLabel}` : `Участников с артефактами: ${state.people.length}. Найдите нужное имя.`)
      : 'Пока нет участников с найденными артефактами.';
  }

  function placeholder(node) {
    const sign = document.createElement('div'); sign.className='treasury-symbol';sign.textContent='✦';
    const caption = document.createElement('div');caption.className='treasury-art-name';caption.textContent='Изображение скоро появится';
    node.append(sign,caption);
  }
  function visual(item, big = false) {
    const node=document.createElement('div');node.className='treasury-art';
    node.style.setProperty('--accent',COLORS[String(item.rarity||'').toLowerCase()]||'#b6aaa0');
    const imageUrl = String(item.imageUrl||'');
    if (imageUrl.startsWith(CLOUDINARY_PREFIX)) {
      const img=document.createElement('img');
      img.src=imageUrl;img.alt=`Карточка «${item.name}», №${item.id}`;
      img.loading=big?'eager':'lazy';img.decoding='async';
      node.style.padding='0';
      img.addEventListener('error',()=>{img.remove();node.style.padding='';placeholder(node);},{once:true});
      node.append(img);
    } else placeholder(node);
    return node;
  }
  function showCard(item) {
    $t('treasuryBigCard').replaceChildren(visual(item,true));
    const count=Number(item.count||1);
    $t('treasuryQuantity').textContent=state.mode==='mine'?`Экземпляров: ${count}`:'';
    $t('treasuryDialog').showModal();
  }
  function render() {
    const items=state.mode==='mine'?state.mine:state.all;
    const ready=state.mode==='mine'?state.myLoaded:state.globalLoaded;
    const count=ready?items.length:0;
    const percent=state.total ? count/state.total*100 : 0;
    $t('treasuryCounter').textContent=`${count} из ${state.total}`;
    $t('treasuryPercent').textContent=`${percent.toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
    $t('treasuryProgress').style.width=`${Math.min(100,percent)}%`;
    const shelf=$t('treasuryShelf');shelf.replaceChildren();
    const filtered=items.filter(item=>state.rarity==='all'||String(item.rarity||'').toLowerCase()===state.rarity);
    const empty=$t('treasuryEmpty');
    let message='';
    if(state.mode==='mine'&&!state.selectedId) message='Выберите участника в списке выше, чтобы открыть его коллекцию.';
    else if(ready&&!filtered.length) message=items.length?'В этой категории пока нет артефактов.': 'Пока ни одного артефакта. Продолжайте вышивать!';
    empty.textContent=message;empty.hidden=!message;
    shelf.hidden=!!message || !ready;
    filtered.slice().sort((a,b)=>Number(a.id)-Number(b.id)).forEach(item=>{
      const button=document.createElement('button');button.type='button';button.className='treasury-artifact';
      button.setAttribute('aria-label',`Артефакт №${item.id}: ${item.name}`);
      button.append(visual(item));
      const quantity=Number(item.count||1);
      if(state.mode==='mine'&&quantity>1){const badge=document.createElement('span');badge.className='treasury-count';badge.textContent=`×${quantity}`;button.append(badge);}
      const number=document.createElement('div');number.className='treasury-number';number.textContent=`№ ${String(item.id).padStart(3,'0')}`;button.append(number);
      button.addEventListener('click',()=>showCard(item));shelf.append(button);
    });
  }
  async function loadGlobal(force=false) {
    const saved = globalCache();
    if (!force && saved?.data?.ok === true && Array.isArray(saved.data?.common?.cards)) {
      state.total=Number(saved.data.total)||MAX_CARDS;
      state.all=saved.data.common.cards;state.globalLoaded=true;
      setNotice(`Сохранённая коллекция от ${new Date(saved.time).toLocaleString('ru-RU')}. Для обновления нажмите ↻`);
      render();return;
    }
    const request=++state.requestId;
    setBusy(true);setNotice('Загружаем общую сокровищницу...');
    try {
      const data=await treasuryGet('collection',{vkId:'0'});
      if(request!==state.requestId) return;
      if(!data||data.ok!==true||!data.common||!Array.isArray(data.common.cards)) throw new Error('Неверный ответ API');
      state.total=Number(data.total)||MAX_CARDS;state.all=data.common.cards;state.globalLoaded=true;
      try {localStorage.setItem(TREASURY_CACHE,JSON.stringify({time:Date.now(),data}));}catch(e){console.warn('Кэш сокровищницы:',e);}
      setNotice('Общая сокровищница обновлена.');render();
    }catch(err){if(request===state.requestId)setNotice(`Не удалось загрузить общую коллекцию: ${err.message}`);}
    finally {if(request===state.requestId)setBusy(false);}
  }
  async function loadPersonal(vkId) {
    const request=++state.requestId;
    setBusy(true);setNotice(`Загружаем коллекцию: ${state.selectedLabel}...`);
    try {
      const data=await treasuryGet('collection',{vkId});
      if(request!==state.requestId||vkId!==state.selectedId) return;
      if(!data||data.ok!==true||!data.personal||!Array.isArray(data.personal.cards)) throw new Error('Неверный ответ API');
      state.total=Number(data.total)||MAX_CARDS;state.mine=data.personal.cards;state.myLoaded=true;
      if(data.common&&Array.isArray(data.common.cards)){state.all=data.common.cards;state.globalLoaded=true;}
      setNotice('Коллекция обновлена.');render();
    }catch(err){if(request===state.requestId)setNotice(`Не удалось загрузить коллекцию: ${err.message}`);}
    finally {if(request===state.requestId)setBusy(false);}
  }
  async function reload() {
    setBusy(true);setNotice('Обновляем список участников...');
    try {await loadPeople();}catch(err){setNotice(`Не удалось загрузить участников: ${err.message}`);}
    finally {setBusy(false);}
    if(state.mode==='mine') {if(state.selectedId)await loadPersonal(state.selectedId);else render();}
    else await loadGlobal(true);
  }
  async function start() {
    if(!document.getElementById('owlTreasury')) return;
    if(state.started) return;
    // Не показываем сокровищницу до успешного входа на сайте.
    if(document.getElementById('app').classList.contains('hidden')) return;
    state.started=true;
    await reload();
  }
  document.querySelectorAll('#owlTreasury [data-tmode]').forEach(button=>{
    button.addEventListener('click',()=>setMode(button.dataset.tmode));
  });
  document.querySelectorAll('#owlTreasury [data-trarity]').forEach(button=>{
    button.addEventListener('click',()=>{
      state.rarity=button.dataset.trarity;
      document.querySelectorAll('#owlTreasury [data-trarity]').forEach(b=>b.classList.toggle('selected',b===button));
      render();
    });
  });
  $t('treasuryPersonSearch').addEventListener('focus',showPeople);
  $t('treasuryPersonSearch').addEventListener('input',e=>{
    // Ввод нового текста снимает текущий выбор, до явного клика по участнику.
    if(state.selectedId){state.selectedId='';state.selectedLabel='';state.mine=[];state.myLoaded=false;render();}
    showPeople();
  });
  $t('treasuryPersonSearch').addEventListener('keydown',e=>{
    if(e.key==='Escape') hidePeople();
    if(e.key==='Enter'&&!$t('treasuryPersonList').hidden){
      e.preventDefault();
      const first=$t('treasuryPersonList').querySelector('.treasury-person-option');
      if(first) first.click();
    }
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.treasury-person-combo'))hidePeople();});
  $t('treasuryRefresh').addEventListener('click',reload);
  $t('treasuryClose').addEventListener('click',()=>$t('treasuryDialog').close());
  $t('treasuryDialog').addEventListener('click',e=>{if(e.target===$t('treasuryDialog'))$t('treasuryDialog').close();});
  // Функцию вызывает исходный app.js при переключении на четвёртую вкладку.
  window.owlsOpenTreasury=start;
  render();
})();

