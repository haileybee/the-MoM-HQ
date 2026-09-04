(() => {
  'use strict';
  const CFG = window.MOMHQ_CONFIG || {};
  const $ = (q) => document.querySelector(q);
  const authEl = $('#auth'), appEl = $('#app'), viewEl = $('#view'), topTabsEl = $('#topTabs'), bottomNavEl = $('#bottomNav');
  const authStatus = $('#authStatus'), syncStatus = $('#syncStatus'), toastEl = $('#toast');
  const tabs = [
    ['sunny','☀️','Sunny'],['home','🏠','Home'],['clean','🧹','Cleaning'],['meals','🍽️','Meals'],['pantry','🥫','Pantry'],['grocery','🛒','Grocery'],
    ['kids','🪙','Kids'],['laundry','🧺','Laundry'],['schedule','📅','Schedule'],['pets','🐾','Pets'],['meds','💊','Medications'],['community','💬','Community'],['settings','⚙️','Settings']
  ];
  const quick = new Set(['sunny','home','clean','meals','kids','community','settings']);
  const app = { sb:null, user:null, household:null, state:{}, tab:'sunny', syncTimer:null, syncing:false, conversation:null, sunnyMessages:[], pendingSunnyAction:null, attachment:null, communityMode:'chat' };
  const esc = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const arr = (v) => Array.isArray(v) ? v : [];
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const labelOf = (x, fallback='Item') => typeof x === 'string' ? x : (x?.name || x?.title || x?.label || x?.item || fallback);
  function toast(message){ toastEl.textContent=message; toastEl.classList.add('show'); clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.classList.remove('show'),2400); }
  function setSync(text, ok=true){ syncStatus.textContent=text; syncStatus.className=`fine ${ok?'status-good':'status-bad'}`; }
  function saveLocal(){ if(app.household?.household_id) localStorage.setItem(`momhq_web_${app.household.household_id}`, JSON.stringify(app.state)); }
  function markChanged(){ saveLocal(); setSync('Saving…'); clearTimeout(app.syncTimer); app.syncTimer=setTimeout(syncState,650); }
  async function syncState(){
    if(!app.sb || !app.user || !app.household?.household_id || app.syncing) return;
    app.syncing=true;
    try{
      const payload=JSON.parse(JSON.stringify(app.state));
      const {error}=await app.sb.from('household_state').upsert({household_id:app.household.household_id,state_json:payload,updated_at:new Date().toISOString()},{onConflict:'household_id'});
      if(error) throw error;
      setSync('Synced with household');
    }catch(e){ console.error(e); setSync('Sync problem. Your changes are still on this device.',false); }
    finally{ app.syncing=false; }
  }
  async function loadState(){
    const hid=app.household.household_id;
    const {data,error}=await app.sb.from('household_state').select('state_json,updated_at').eq('household_id',hid).maybeSingle();
    if(error) throw error;
    if(data?.state_json && typeof data.state_json==='object') app.state=data.state_json;
    else { try{ app.state=JSON.parse(localStorage.getItem(`momhq_web_${hid}`)||'{}'); }catch{ app.state={}; } }
    if(!app.state.webUi174) app.state.webUi174={};
    saveLocal();
  }
  async function establishHousehold(){
    let {data,error}=await app.sb.rpc('ensure_user_household');
    if(error) throw error;
    const row=Array.isArray(data)?data[0]:data;
    let summary=await app.sb.rpc('get_my_household_summary');
    if(summary.error) throw summary.error;
    app.household=summary.data || {household_id:row?.household_id,code:row?.household_code,members:[]};
    await loadState();
  }
  async function onSignedIn(user){
    app.user=user;
    authEl.classList.add('hidden'); appEl.classList.remove('hidden'); setSync('Connecting household…');
    try{ await establishHousehold(); await loadSunnyHistory(); renderNav(); render(); setSync('Synced with household'); }
    catch(e){ console.error(e); viewEl.innerHTML=errorPanel('MoM HQ could not load your household yet.',e.message); setSync('Household connection failed',false); }
  }
  async function init(){
    if(!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey){ authStatus.textContent='MoM HQ login configuration is unavailable.'; return; }
    app.sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    $('#googleLogin').addEventListener('click', loginGoogle);
    $('#profileButton').addEventListener('click',()=>setTab('settings'));
    const {data}=await app.sb.auth.getSession();
    if(data?.session?.user) await onSignedIn(data.session.user);
    app.sb.auth.onAuthStateChange(async(event,session)=>{
      if(session?.user && (!app.user || app.user.id!==session.user.id)) await onSignedIn(session.user);
      if(event==='SIGNED_OUT'){ app.user=null; app.household=null; app.state={}; appEl.classList.add('hidden'); authEl.classList.remove('hidden'); }
    });
  }
  async function loginGoogle(){
    authStatus.textContent='Opening Google sign-in…';
    const redirectTo=new URL('app.html',location.href).href.split('#')[0];
    const {error}=await app.sb.auth.signInWithOAuth({provider: 'google',options:{redirectTo}});
    if(error) authStatus.textContent=error.message;
  }
  async function logout(){ await app.sb.auth.signOut(); }
  function renderNav(){
    topTabsEl.innerHTML=tabs.map(([k,e,l])=>`<button class="chip-btn ${app.tab===k?'active':''}" data-tab="${k}">${e} ${l}</button>`).join('');
    bottomNavEl.innerHTML=tabs.filter(([k])=>quick.has(k)).map(([k,e,l])=>`<button class="${app.tab===k?'active':''}" data-tab="${k}"><span class="nav-emoji">${e}</span>${l}</button>`).join('');
    document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  }
  function setTab(tab){ app.tab=tab; app.state.webUi174={...obj(app.state.webUi174),tab}; saveLocal(); renderNav(); render(); window.scrollTo({top:0,behavior:'smooth'}); }
  function render(){
    const fn={sunny:renderSunny,home:renderHome,clean:renderCleaning,meals:renderMeals,pantry:renderPantry,grocery:renderGrocery,kids:renderKids,laundry:renderLaundry,schedule:renderSchedule,pets:renderPets,meds:renderMeds,community:renderCommunity,settings:renderSettings}[app.tab]||renderHome;
    viewEl.innerHTML=fn(); bindView(); viewEl.focus({preventScroll:true});
  }
  function bindView(){
    viewEl.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>setTab(b.dataset.go));
    const bind=(id,fn)=>{const el=$(`#${id}`);if(el)el.onclick=fn};
    bind('addGrocery',addGrocery); bind('addMeal',addMeal); bind('addRoom',addRoom); bind('addKid',addKid); bind('addPet',addPet); bind('addMed',addMed); bind('addSchedule',addSchedule); bind('addLaundry',addLaundry);
    bind('sendSunny',sendSunny); bind('chooseSunnyFile',()=>$('#sunnyFile')?.click()); bind('applySunnyAction',applySunnyAction);
    const sf=$('#sunnyFile'); if(sf) sf.onchange=e=>prepareSunnyAttachment(e.target.files?.[0]);
    bind('sendCommunity',sendCommunityMessage); bind('refreshCommunity',()=>renderCommunityRemote());
    bind('communityChat',()=>{app.communityMode='chat';render()}); bind('communityRecipes',()=>{app.communityMode='recipes';render()});
    bind('joinHousehold',joinHousehold); bind('logout',logout); bind('donateSettings',openDonation);
    viewEl.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removeItem(b.dataset.remove,b.dataset.id));
    if(app.tab==='community') renderCommunityRemote();
  }
  function hero(title,text){return `<section class="hero"><h1>${title}</h1><p class="muted">${text}</p></section>`}
  function empty(icon,text){return `<div class="empty"><span class="big">${icon}</span>${esc(text)}</div>`}
  function errorPanel(title,text){return `${hero('🌻 MoM HQ',title)}<section class="panel"><p class="status-bad">${esc(text||'Please try again.')}</p></section>`}
  function renderHome(){
    const today=arr(obj(app.state.familySchedule).events).length, groceries=arr(app.state.grocery).filter(x=>!x?.done).length, kids=arr(app.state.kids).length, pets=arr(app.state.pets).length;
    return `${hero('Hi, love 🌻','Everything in this web dashboard belongs to the same MoM HQ household used by your signed-in account.')}
    <section class="grid">
      ${[['☀️','Sunny','sunny'],['🧹','Smart Cleaning','clean'],['🍽️','Tonight’s Meals','meals'],['🛒',`${groceries} Grocery Items`,'grocery'],['🪙',`${kids} Kids`,'kids'],['🧺','Laundry','laundry'],['📅',`${today} Schedule Items`,'schedule'],['🐾',`${pets} Pets`,'pets']].map(([e,l,k])=>`<button class="quick-card" data-go="${k}"><span class="emoji">${e}</span><b>${esc(l)}</b><span class="fine">Open</span></button>`).join('')}
    </section>
    <section class="panel"><h2>Household sync</h2><p class="muted">Household code</p><div class="household-code">${esc(app.household?.code||'')}</div><p class="fine">Share this code only with adults you want inside your MoM HQ household.</p></section>`;
  }
  function renderSunny(){
    const messages=app.sunnyMessages.length?app.sunnyMessages.map(m=>`<div class="bubble ${m.role==='user'?'user':''}">${esc(m.text)}</div>`).join(''):empty('☀️','Start a chat with Sunny.');
    const pending=app.pendingSunnyAction?`<section class="panel"><h3>Sunny has an action ready</h3><p>${esc(app.pendingSunnyAction.reason||'Add this to MoM HQ?')}</p><button id="applySunnyAction" class="primary">Add to MoM HQ</button></section>`:'';
    return `${hero('☀️ Sunny','Sunny can answer household questions and route helpful actions into cleaning, groceries, pantry, meals, laundry and recipes.')}
      <section class="chat-card panel"><div id="sunnyLog" class="chat-log">${messages}</div>
      <input id="sunnyFile" class="file-picker" type="file" accept="image/*,video/*,application/pdf,text/plain">
      <div class="actions"><button id="chooseSunnyFile" class="secondary">📎 Add photo, video or file</button></div>
      <div id="attachmentPreview" class="attachment-preview">${app.attachment?esc(app.attachment.name):''}</div>
      <div class="chat-compose"><textarea id="sunnyInput" placeholder="Message Sunny…" maxlength="1800"></textarea><button id="sendSunny" class="primary">Send</button></div><p class="fine">Videos must be 60 seconds or shorter. Smaller files work best on the web.</p></section>${pending}`;
  }
  async function loadSunnyHistory(){
    try{
      let {data:convs}=await app.sb.from('sunny_conversations_133').select('*').eq('user_id',app.user.id).order('updated_at',{ascending:false}).limit(1);
      if(!convs?.length){ const ins=await app.sb.from('sunny_conversations_133').insert({user_id:app.user.id,title:'Sunny Web Chat'}).select().single(); if(ins.error) throw ins.error; app.conversation=ins.data; }
      else app.conversation=convs[0];
      const {data:msgs}=await app.sb.from('sunny_messages_133').select('*').eq('conversation_id',app.conversation.id).order('created_at',{ascending:true}).limit(80);
      app.sunnyMessages=msgs||[];
    }catch(e){ console.warn('Sunny history',e); }
  }
  async function prepareSunnyAttachment(file){
    if(!file) return;
    if(file.type.startsWith('video/')){
      const duration=await videoDuration(file).catch(()=>Infinity);
      if(duration>60){ toast('Please choose a video that is 60 seconds or shorter.'); return; }
    }
    if(file.size>6_500_000){ toast('Please choose a file smaller than about 6 MB for web chat.'); return; }
    const data=await readData(file);
    app.attachment={id:id(),name:file.name,mimeType:file.type||'application/octet-stream',data}; render();
  }
  function readData(file){ return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||'').split(',').pop());r.onerror=rej;r.readAsDataURL(file)}); }
  function videoDuration(file){ return new Promise((res,rej)=>{const v=document.createElement('video');v.preload='metadata';v.onloadedmetadata=()=>{URL.revokeObjectURL(v.src);res(v.duration)};v.onerror=rej;v.src=URL.createObjectURL(file)}); }
  async function sendSunny(){
    const input=$('#sunnyInput'), text=input?.value.trim()||''; if(!text && !app.attachment) return;
    const userMsg={conversation_id:app.conversation.id,user_id:app.user.id,role:'user',text:text||`Attached ${app.attachment.name}`,attachments:app.attachment?[app.attachment]:[]};
    app.sunnyMessages.push({...userMsg,id:id()}); render();
    try{
      await app.sb.from('sunny_messages_133').insert(userMsg);
      const history=app.sunnyMessages.slice(-12).map(m=>({role:m.role,text:m.text}));
      const context={householdId:app.household.household_id,householdCode:app.household.code,counts:{kids:arr(app.state.kids).length,pets:arr(app.state.pets).length,grocery:arr(app.state.grocery).length},tonight:obj(app.state.tonight67).items||[]};
      const {data,error}=await app.sb.functions.invoke('sunny-chat',{body:{message:text,attachments:app.attachment?[app.attachment]:[],history,context}});
      if(error) throw error;
      const reply=data?.reply||'I’m here, love 🌻'; app.pendingSunnyAction=data?.proposedAction||null;
      const sunnyMsg={conversation_id:app.conversation.id,user_id:app.user.id,role:'assistant',text:reply,attachments:[],proposed_action:app.pendingSunnyAction};
      await app.sb.from('sunny_messages_133').insert(sunnyMsg); app.sunnyMessages.push({...sunnyMsg,id:id()}); app.attachment=null; render();
      setTimeout(()=>{const log=$('#sunnyLog');if(log)log.scrollTop=log.scrollHeight},20);
    }catch(e){ console.error(e); app.sunnyMessages.push({role:'assistant',text:'Sunny could not answer just now. Your message is still saved in your chat history.'}); render(); }
  }
  function applySunnyAction(){
    const a=app.pendingSunnyAction;if(!a)return;const p=a.payload||{};
    if(a.type==='grocery.add'){ app.state.grocery=[...arr(app.state.grocery),{id:id(),name:p.name||p.item||'Grocery item',done:false,source:'Sunny'}]; }
    else if(a.type==='pantry.add'){ app.state.foods=[...arr(app.state.foods),{id:id(),name:p.name||p.item||'Pantry item',location:'pantry',source:'Sunny'}]; }
    else if(a.type==='meal.add'){ const t=obj(app.state.tonight67); app.state.tonight67={...t,day:new Date().toISOString().slice(0,10),items:[...arr(t.items),p]}; }
    else if(a.type==='laundry.start'){ const l=obj(app.state.laundry); app.state.laundry={...l,loads:[...arr(l.loads),{id:id(),status:'washer',startedAt:new Date().toISOString(),...p}]}; }
    else if(a.type==='recipe.add'){ app.state.recipeBook=[...arr(app.state.recipeBook),{id:id(),...p,source:'Sunny'}]; }
    else if(a.type==='smartCleaning.addTasks' || a.type==='chore.add'){ app.state.cleanDashboardTasks=[...arr(app.state.cleanDashboardTasks),...(a.type==='smartCleaning.addTasks'?arr(p.tasks):[p])]; }
    app.pendingSunnyAction=null; markChanged(); toast('Added to MoM HQ 🌻'); render();
  }
  function renderCleaning(){
    const rooms=arr(app.state.savedRooms), tasks=arr(app.state.cleanDashboardTasks);
    return `${hero('🧹 Smart Cleaning','Saved spaces and cleaning tasks from your household live here.')}
    <section class="panel"><h2>Saved spaces</h2><div class="list">${rooms.length?rooms.map((r,i)=>`<div class="item-card"><div class="item-row"><div><b>${esc(labelOf(r,`Space ${i+1}`))}</b></div><span class="tag">Saved</span></div></div>`).join(''):empty('🏠','No saved spaces yet.')}</div><div class="field"><label>Add a room or space</label><input id="roomName" placeholder="Kitchen"></div><button id="addRoom" class="primary">Add space</button></section>
    <section class="panel"><h2>Current cleaning tasks</h2>${tasks.length?`<div class="list">${tasks.slice(0,30).map(t=>`<div class="item-card"><b>${esc(labelOf(t,'Cleaning task'))}</b><div class="fine">${esc(t.destination||t.room||'')}</div></div>`).join('')}</div>`:empty('✨','No current cleaning tasks.')}</section>`;
  }
  function addRoom(){const name=$('#roomName')?.value.trim();if(!name)return;app.state.savedRooms=[...arr(app.state.savedRooms),{id:id(),name,createdAt:new Date().toISOString()}];markChanged();render()}
  function renderMeals(){
    const tonight=obj(app.state.tonight67), items=arr(tonight.items), plans=arr(app.state.mealPlan);
    return `${hero('🍽️ Meals','Tonight first, with the rest of your meal planning one scroll away.')}
    <section class="panel"><h2>Tonight’s meals</h2>${items.length?`<div class="list">${items.map(x=>`<div class="item-card"><b>${esc(labelOf(x,'Meal'))}</b></div>`).join('')}</div>`:empty('🍲','Nothing planned for tonight yet.')}<div class="field"><label>Add tonight’s meal</label><input id="mealName" placeholder="Tacos"></div><button id="addMeal" class="primary">Add meal</button></section>
    <section class="panel"><h2>Meal planner</h2>${plans.length?`<div class="list">${plans.slice(0,21).map(x=>`<div class="item-card"><b>${esc(labelOf(x,'Planned meal'))}</b><div class="fine">${esc(x.day||x.date||'')}</div></div>`).join('')}</div>`:empty('🗓️','Your meal planner is empty.')}</section>`;
  }
  function addMeal(){const name=$('#mealName')?.value.trim();if(!name)return;const t=obj(app.state.tonight67);app.state.tonight67={...t,day:new Date().toISOString().slice(0,10),items:[...arr(t.items),{id:id(),name}]};markChanged();render()}
  function renderPantry(){
    const foods=arr(app.state.foods), staples=arr(app.state.staples);
    return `${hero('🥫 Pantry + Inventory','Food lives here, with pantry, fridge and freezer items staying in your household state.')}
    <section class="panel"><h2>Food inventory</h2>${foods.length?`<div class="list">${foods.slice(0,80).map(f=>`<div class="item-card"><div class="item-row"><div><b>${esc(labelOf(f,'Food'))}</b><div class="fine">${esc(f.location||f.category||'')}</div></div><button class="danger" data-remove="foods" data-id="${esc(f.id||labelOf(f))}">Remove</button></div></div>`).join('')}</div>`:empty('🥫','No food items found in the household inventory.')}<div class="field"><label>Add food</label><input id="pantryName" placeholder="Rice"></div><div class="field"><label>Location</label><select id="pantryLocation"><option>pantry</option><option>fridge</option><option>freezer</option><option>dairy</option></select></div><button class="primary" onclick="window.MOMHQ_WEB.addPantry()">Add food</button></section>
    <section class="panel"><h2>Staples</h2><p class="muted">${staples.length?staples.map(labelOf).map(esc).join(' • '):'No staples saved yet.'}</p></section>`;
  }
  function addPantry(){const name=$('#pantryName')?.value.trim();if(!name)return;app.state.foods=[...arr(app.state.foods),{id:id(),name,location:$('#pantryLocation')?.value||'pantry',quantity:'full',createdAt:new Date().toISOString()}];markChanged();render()}
  function renderGrocery(){const items=arr(app.state.grocery);return `${hero('🛒 Grocery','Your household grocery list stays synced with the same state used by MoM HQ.')}
    <section class="panel"><div class="field"><label>Add grocery item</label><input id="groceryName" placeholder="Milk"></div><button id="addGrocery" class="primary">Add item</button></section>
    <section class="panel"><h2>Current list</h2>${items.length?`<div class="list">${items.map((x,i)=>`<div class="item-card"><div class="item-row"><div><b>${esc(labelOf(x,`Item ${i+1}`))}</b><div class="fine">${esc(x.store||x.list||'')}</div></div><button class="danger" data-remove="grocery" data-id="${esc(x.id||labelOf(x))}">Remove</button></div></div>`).join('')}</div>`:empty('🛒','Your grocery list is empty.')}</section>`}
  function addGrocery(){const name=$('#groceryName')?.value.trim();if(!name)return;app.state.grocery=[...arr(app.state.grocery),{id:id(),name,done:false,createdAt:new Date().toISOString(),source:'web'}];markChanged();render()}
  function renderKids(){const kids=arr(app.state.kids);return `${hero('🪙 Kids + ChoreCoins','Child profiles stay in the shared household so parents can manage them from phone or browser.')}
    <section class="panel"><h2>Child profiles</h2>${kids.length?`<div class="list">${kids.map(k=>`<div class="item-card"><div class="item-row"><div><b>${esc(labelOf(k,'Child'))}</b><div class="fine">${k.age!=null?`Age ${esc(k.age)}`:''}</div></div><span class="tag">🪙 ${esc(k.coins??k.balance??'0')}</span></div></div>`).join('')}</div>`:empty('🌻','No child profiles found.')}<div class="field"><label>Name</label><input id="kidName" placeholder="Child name"></div><div class="field"><label>Age</label><input id="kidAge" type="number" min="0" max="18"></div><button id="addKid" class="primary">Add child</button></section>`}
  function addKid(){const name=$('#kidName')?.value.trim();if(!name)return;app.state.kids=[...arr(app.state.kids),{id:id(),name,age:Number($('#kidAge')?.value||0),coins:0,chores:[],rewards:[]}];markChanged();render()}
  function renderLaundry(){const l=obj(app.state.laundry),loads=arr(l.loads);return `${hero('🧺 Laundry','Washer, dryer and dishwasher activity can be managed from the web household too.')}
    <section class="grid">${[['Washer',l.washerTimer?'Running':'Ready'],['Dryer',l.dryerTimer?'Running':'Ready'],['Dishwasher',l.dishwasher?'Running':'Ready'],['Loads',String(loads.length)]].map(([a,b])=>`<div class="quick-card"><span class="emoji">🧺</span><b>${esc(a)}</b><span class="fine">${esc(b)}</span></div>`).join('')}</section>
    <section class="panel"><h2>Log a load</h2><div class="field"><label>Appliance</label><select id="laundryType"><option>washer</option><option>dryer</option><option>dishwasher</option></select></div><button id="addLaundry" class="primary">Start / log load</button>${loads.length?`<div class="list" style="margin-top:12px">${loads.slice(-20).reverse().map(x=>`<div class="item-card"><b>${esc(x.appliance||x.status||'Laundry')}</b><div class="fine">${esc(x.startedAt||x.date||'')}</div></div>`).join('')}</div>`:''}</section>`}
  function addLaundry(){const appliance=$('#laundryType')?.value||'washer',l=obj(app.state.laundry);app.state.laundry={...l,loads:[...arr(l.loads),{id:id(),appliance,status:'running',startedAt:new Date().toISOString()}]};markChanged();render()}
  function renderSchedule(){const fs=obj(app.state.familySchedule),events=arr(fs.events);return `${hero('📅 Family Schedule','Open to today’s agenda first, with household events kept in the shared schedule.')}
    <section class="panel"><h2>Agenda</h2>${events.length?`<div class="list">${events.slice().sort((a,b)=>String(a.date||a.start||'').localeCompare(String(b.date||b.start||''))).slice(0,50).map(e=>`<div class="item-card"><b>${esc(labelOf(e,'Event'))}</b><div class="fine">${esc(e.date||e.start||e.time||'')}</div></div>`).join('')}</div>`:empty('📅','No family events yet.')}<div class="field"><label>Event</label><input id="scheduleTitle" placeholder="School pickup"></div><div class="field"><label>Date</label><input id="scheduleDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><button id="addSchedule" class="primary">Add event</button></section>`}
  function addSchedule(){const title=$('#scheduleTitle')?.value.trim();if(!title)return;const fs=obj(app.state.familySchedule);app.state.familySchedule={...fs,events:[...arr(fs.events),{id:id(),title,date:$('#scheduleDate')?.value||new Date().toISOString().slice(0,10),source:'web'}]};markChanged();render()}
  function renderPets(){const pets=arr(app.state.pets);return `${hero('🐾 Pets','Pet profiles and care stay alongside the rest of the household.')}
    <section class="panel"><h2>Pets</h2>${pets.length?`<div class="list">${pets.map(p=>`<div class="item-card"><div class="item-row"><div><b>${esc(labelOf(p,'Pet'))}</b><div class="fine">${esc(p.type||p.species||'')}</div></div><span class="tag">🐾</span></div></div>`).join('')}</div>`:empty('🐾','No pets added yet.')}<div class="field"><label>Pet name</label><input id="petName" placeholder="Pantera"></div><div class="field"><label>Type</label><input id="petType" placeholder="Cat"></div><button id="addPet" class="primary">Add pet</button></section>`}
  function addPet(){const name=$('#petName')?.value.trim();if(!name)return;app.state.pets=[...arr(app.state.pets),{id:id(),name,type:$('#petType')?.value.trim()||'Pet',careHistory:[]}];markChanged();render()}
  function renderMeds(){const meds=arr(app.state.medications);return `${hero('💊 Medications','See your household medication list and add schedule details from the browser.')}
    <section class="panel"><h2>Medications</h2>${meds.length?`<div class="list">${meds.map(m=>`<div class="item-card"><b>${esc(labelOf(m,'Medication'))}</b><div class="fine">${esc(m.frequency||m.schedule||'')}</div></div>`).join('')}</div>`:empty('💊','No medications saved.')}<div class="field"><label>Medication name</label><input id="medName" placeholder="Medication"></div><div class="field"><label>Frequency</label><select id="medFreq"><option>daily</option><option>weekly</option><option>monthly</option><option>as needed</option></select></div><button id="addMed" class="primary">Add medication</button></section>`}
  function addMed(){const name=$('#medName')?.value.trim();if(!name)return;app.state.medications=[...arr(app.state.medications),{id:id(),name,frequency:$('#medFreq')?.value||'daily',createdAt:new Date().toISOString()}];markChanged();render()}
  function renderCommunity(){return `${hero('💬 Community','Community chat and recipes connect to the existing MoM HQ community backend.')}
    <section class="panel"><div class="actions"><button id="communityRecipes" class="${app.communityMode==='recipes'?'primary':'secondary'}">🍲 Community Recipes</button><button id="communityChat" class="${app.communityMode==='chat'?'primary':'secondary'}">💬 Mom Chat</button><button id="refreshCommunity" class="secondary">Refresh</button></div><div id="communityRemote" style="margin-top:14px">${empty('🌻','Loading community…')}</div></section>`}
  async function renderCommunityRemote(){
    const host=$('#communityRemote');if(!host)return;
    try{
      if(app.communityMode==='chat'){
        const {data,error}=await app.sb.from('mom_chat_messages_148').select('id,author_name,text,created_at').eq('room','global').order('created_at',{ascending:false}).limit(60); if(error)throw error;
        host.innerHTML=`<div class="message-list">${(data||[]).reverse().map(m=>`<div class="community-message"><b>${esc(m.author_name||'MoM HQ Mom')}</b>${esc(m.text)}</div>`).join('')||empty('💬','Be the first to say hi.')}</div><div class="chat-compose"><textarea id="communityInput" maxlength="1000" placeholder="Message the MoM HQ community…"></textarea><button id="sendCommunity" class="primary">Send</button></div>`; $('#sendCommunity').onclick=sendCommunityMessage;
      }else{
        const {data,error}=await app.sb.from('community_recipe_posts').select('id,display_name,recipe_name,caption,category,ingredients,steps,created_at').order('created_at',{ascending:false}).limit(50);if(error)throw error;
        host.innerHTML=(data||[]).map(r=>`<div class="item-card"><span class="tag">${esc(r.category||'Recipe')}</span><h3>${esc(r.recipe_name)}</h3><div class="fine">by ${esc(r.display_name)}</div><p>${esc(r.caption||'')}</p></div>`).join('')||empty('🍲','No community recipes yet.');
      }
    }catch(e){host.innerHTML=`<p class="status-bad">Community could not load: ${esc(e.message)}</p>`}
  }
  async function sendCommunityMessage(){const input=$('#communityInput'),text=input?.value.trim();if(!text)return;const name=app.user.user_metadata?.full_name||app.user.user_metadata?.name||app.user.email?.split('@')[0]||'MoM HQ Mom';const {error}=await app.sb.from('mom_chat_messages_148').insert({room:'global',user_id:app.user.id,author_name:name,text});if(error){toast(error.message);return}input.value='';renderCommunityRemote()}
  function renderSettings(){const members=arr(app.household?.members);return `${hero('⚙️ Settings','Account, household sync and MoM HQ support options.')}
    <section class="panel"><h2>Google account</h2><p><b>${esc(app.user?.user_metadata?.full_name||app.user?.email||'Signed in')}</b></p><p class="fine">${esc(app.user?.email||'')}</p><button id="logout" class="secondary">Log out</button></section>
    <section class="panel"><h2>Household</h2><div class="household-code">${esc(app.household?.code||'')}</div><p class="fine">${members.length} of 4 adult household members</p>${members.map(m=>`<div class="item-card"><b>${esc(m.display_name||m.adult_role||m.role||'Adult')}</b>${m.is_you?' <span class="tag">You</span>':''}</div>`).join('')}<div class="field"><label>Join another household by code</label><input id="householdJoinCode" autocomplete="off" placeholder="Enter code"></div><button id="joinHousehold" class="primary">Join household</button></section>
    <section class="panel donation"><h2>💛 Support MoM HQ Development</h2><p>Optional PayPal donations support development, testing, hosting and new features. Donations are separate from Premium.</p><button id="donateSettings" class="primary">Donate with PayPal</button></section>
    <section class="panel"><h2>Premium</h2><p><b>7 days free, then $3/month</b></p><p class="fine">Premium and development donations are separate.</p></section>`}
  async function joinHousehold(){const code=$('#householdJoinCode')?.value.trim();if(!code)return;try{const {error}=await app.sb.rpc('join_household_by_code',{p_code:code});if(error)throw error;await establishHousehold();toast('Household joined 🌻');renderNav();render();setSync('Synced with household')}catch(e){toast(e.message)}}
  function openDonation(){location.href='donate.html'}
  function removeItem(key,removeId){const current=arr(app.state[key]);app.state[key]=current.filter(x=>String(x?.id||labelOf(x))!==String(removeId));markChanged();render()}
  window.MOMHQ_WEB={addPantry};
  init().catch(e=>{console.error(e);authStatus.textContent='MoM HQ could not start. Please refresh and try again.'});
})();
