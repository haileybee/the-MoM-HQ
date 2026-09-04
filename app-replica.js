(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.mount(root);
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  const PRIMARY_TABS = [
    { key:'home', icon:'🏠', label:'Home' },
    { key:'kids', icon:'⭐', label:'Kids' },
    { key:'meals', icon:'🍽️', label:'Meals' },
    { key:'schedule', icon:'📅', label:'Schedule' },
    { key:'hub', icon:'✨', label:'Hub' },
  ];

  const HUB_ITEMS = [
    { title:'Mom Badges', emoji:'🏆', sub:'Progress & milestones', target:'badges' },
    { title:'Smart Clean', emoji:'🧹', sub:'AI tidy-up', target:'clean' },
    { title:'Pets', emoji:'🐾', sub:'Pet care', target:'pets' },
    { title:'Medications', emoji:'💊', sub:'Today’s meds', target:'meds' },
    { title:'Family Chat', emoji:'🗨️', sub:'Household only', target:'familyChat' },
    { title:'Community', emoji:'💬', sub:'Mom feed', target:'communityReplica' },
    { title:'Ask Sunny', emoji:'🌻', sub:'AI helper', target:'sunny' },
    { title:'Settings', emoji:'⚙️', sub:'Household & more', target:'settings' },
    { title:'Weekly Recap', emoji:'📊', sub:'Family wins', target:'recap' },
    { title:'Refer & Earn', emoji:'🎁', sub:'Referral rewards', target:'refer' },
  ];

  const esc = (value='') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const arr = v => Array.isArray(v) ? v : [];
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const labelOf = (v, fallback='Item') => typeof v === 'string' ? v : (v?.name || v?.title || v?.label || v?.item || fallback);

  function openPayPal(url, locationObj){
    try{
      const parsed = new URL(String(url || ''));
      const host = parsed.hostname.toLowerCase();
      const isPayPal = parsed.protocol === 'https:' && (host === 'paypal.me' || host === 'paypal.com' || host.endsWith('.paypal.com'));
      if (!isPayPal) return false;
      locationObj.assign(parsed.toString());
      return true;
    } catch { return false; }
  }

  function mount(win){
    const doc = win.document;
    const CFG = win.MOMHQ_CONFIG || {};
    const view = doc.getElementById('view');
    const bottom = doc.getElementById('bottomNav');
    const top = doc.getElementById('topTabs');
    let active = 'home';
    let custom = null;
    let replicaClient = null;
    let household = null;
    let user = null;
    let state = {};
    let communityMode = 'feed';
    let applyingChrome = false;

    function toast(message){
      const t = doc.getElementById('toast');
      if (!t) return win.alert(message);
      t.textContent = message;
      t.classList.add('show');
      clearTimeout(t._replicaTimer);
      t._replicaTimer = setTimeout(() => t.classList.remove('show'), 2600);
    }

    function bindPayPal(){
      doc.querySelectorAll('[data-paypal-donate], #donateSettings').forEach(el => {
        if (el.dataset.replicaPaypalBound === '1') return;
        el.dataset.replicaPaypalBound = '1';
        el.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          if (!openPayPal(CFG.paypalDonationUrl, win.location)) {
            toast('PayPal donation link is not configured yet. Add the hosted PayPal donation URL, not API credentials.');
          }
        }, true);
      });
    }

    async function ensureClient(){
      if (replicaClient) return replicaClient;
      if (!win.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) return null;
      replicaClient = win.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }
      });
      return replicaClient;
    }

    async function refreshContext(){
      const sb = await ensureClient();
      if (!sb) return;
      const { data:{ user: current } } = await sb.auth.getUser();
      user = current || null;
      if (!user) return;
      const summary = await sb.rpc('get_my_household_summary');
      if (!summary.error) household = summary.data;
      const hid = household?.household_id;
      if (hid) {
        const row = await sb.from('household_state').select('state_json').eq('household_id', hid).maybeSingle();
        if (!row.error && row.data?.state_json) state = row.data.state_json;
      }
    }

    function currentName(){
      return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Mom';
    }

    function renderBottom(){
      if (!bottom || applyingChrome) return;
      const html = PRIMARY_TABS.map(t => `<button type="button" class="${active===t.key?'active':''}" data-replica-tab="${t.key}"><span class="nav-emoji">${t.icon}</span>${t.label}</button>`).join('');
      if (bottom.dataset.replicaHtml !== html) {
        applyingChrome = true;
        bottom.innerHTML = html;
        bottom.dataset.replicaHtml = html;
        bottom.classList.add('replica-bottom');
        bottom.querySelectorAll('[data-replica-tab]').forEach(btn => btn.onclick = () => navigate(btn.dataset.replicaTab));
        applyingChrome = false;
      }
    }

    function hideLegacyTop(){ if (top) top.classList.add('replica-hidden-top'); }

    function clickExisting(key){
      if (!top) return false;
      const button = top.querySelector(`[data-tab="${key}"]`);
      if (!button) return false;
      custom = null;
      button.click();
      return true;
    }

    function hero(title, sub=''){
      return `<section class="hero replica-hero"><h1>${title}</h1>${sub?`<p class="muted">${sub}</p>`:''}</section>`;
    }

    async function renderHomeReplica(){
      await refreshContext();
      if (!view) return;
      const kids = arr(state.kids);
      const meds = arr(state.medications);
      const badges = arr(state.badges || state.badges111 || state.momBadges);
      const events = arr(state.events).length ? arr(state.events) : arr(obj(state.familySchedule).events);
      const coins = kids.reduce((sum,k) => sum + Number(k.coins || k.balance || 0), 0);
      const chores = kids.reduce((sum,k) => sum + arr(k.chores).filter(ch => !ch.done && !ch.completed).length, 0);
      const requests = kids.reduce((sum,k) => sum + arr(k.rewardRequests || k.requestedRewards).filter(r => !r.status || r.status === 'pending').length, 0);
      const today = new Date().toISOString().slice(0,10);
      const upcoming = events.filter(e => String(e.date || e.start || '') >= today).length;
      const badgeNames = badges.slice(-5).reverse().map(b => esc(labelOf(b,'Badge')));
      view.innerHTML = `${hero(`Hi, ${esc(currentName())} 🌻`,'Your MoM HQ home, matched to the current app layout.')}
        <button class="replica-sunny-hero" data-replica-target="sunny"><span class="sunny-face">🌻</span><span><b>Ask Sunny</b><small>Tips, meal ideas & a little cheer</small></span><span>💬</span></button>
        ${meds.length ? `<section class="panel"><h2>💊 Today’s doses</h2>${meds.slice(0,4).map(m=>`<div class="item-card"><b>${esc(labelOf(m,'Medication'))}</b><div class="fine">${esc(m.person||m.frequency||'')}</div></div>`).join('')}</section>` : ''}
        ${badgeNames.length ? `<section class="panel"><div class="item-row"><h2>🏆 Newest badges</h2><button class="secondary" data-replica-target="badges">View all</button></div><div class="replica-badge-row">${badgeNames.map(n=>`<div class="mini-badge"><span>🌻</span><small>${n}</small></div>`).join('')}</div></section>` : ''}
        <h2 class="replica-section-title">Today’s Glance</h2>
        <section class="replica-stat-grid"><div class="replica-stat"><b>${coins}</b><span>ChoreCoins</span></div><div class="replica-stat"><b>${chores}</b><span>Chores left</span></div><div class="replica-stat"><b>${requests}</b><span>Requests</span></div></section>
        <h2 class="replica-section-title">Quick Hubs</h2>
        <section class="replica-hub-grid replica-home-hubs">
          ${[
            ['🧹','Smart Clean','AI photo tidy-up','clean'],['🍽️','Meals','Plan the week','meals'],['🧺','Laundry','Loads & timer','laundry'],['📅','Schedule',`${upcoming} upcoming`,'schedule'],['🪙','Kids','ChoreCoins','kids'],['💬','Community','Mom feed','communityReplica']
          ].map(([e,t,s,target])=>`<button class="replica-hub-card" data-replica-target="${target}"><span>${e}</span><div><b>${t}</b><small>${esc(s)}</small></div></button>`).join('')}
        </section>`;
      bindCustomTargets();
    }

    function renderHub(){
      if (!view) return;
      view.innerHTML = `${hero('✨ Hub','Everything else in MoM HQ')}
        <section class="replica-hub-grid">${HUB_ITEMS.map(it=>`<button class="replica-hub-card" data-replica-target="${it.target}"><span>${it.emoji}</span><div><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></div></button>`).join('')}</section>`;
      bindCustomTargets();
    }

    async function renderBadges(){
      await refreshContext();
      const earned = arr(state.badges || state.badges111 || state.momBadges);
      const rows = earned.length ? earned : [];
      view.innerHTML = `${hero('🏆 Mom Badges','Tap a badge to see what you’ve earned. The web layout mirrors the app’s four-across badge shelf.')}
        <section class="replica-badge-summary"><div><span>🔓</span><b>${rows.length}</b><small>Unlocked</small></div><div><span>🔒</span><b>•</b><small>Keep going</small></div></section>
        <section class="panel"><div class="replica-badge-grid">${rows.length ? rows.map((b,i)=>`<button class="replica-badge" data-badge-name="${esc(labelOf(b,`Badge ${i+1}`))}"><span class="replica-patch">🌻</span><small>${esc(labelOf(b,`Badge ${i+1}`))}</small></button>`).join('') : `<div class="empty" style="grid-column:1/-1"><span class="big">🌻</span>Your first badge is waiting!</div>`}</div></section>`;
      view.querySelectorAll('.replica-badge').forEach(b => b.onclick = () => toast(`${b.dataset.badgeName} 🌻`));
    }

    async function renderFamilyChat(){
      await refreshContext();
      const sb = await ensureClient();
      if (!sb || !household?.household_id) return;
      const q = await sb.from('household_chat_messages').select('id,sender_name,sender_type,message_text,created_at').eq('household_id',household.household_id).is('deleted_at',null).order('created_at',{ascending:true}).limit(100);
      const messages = q.error ? [] : (q.data || []);
      view.innerHTML = `${hero('🗨️ Family Chat','Household-only conversation, like the app.')}
        <section class="panel replica-chat-panel"><div class="replica-chat-log">${messages.length ? messages.map(m=>`<div class="community-message"><b>${esc(m.sender_name||'Family')}</b>${esc(m.message_text||'')}</div>`).join('') : `<div class="empty"><span class="big">🗨️</span>No family messages yet.</div>`}</div>
        <div class="chat-compose"><textarea id="replicaFamilyInput" maxlength="1000" placeholder="Message your household…"></textarea><button id="replicaFamilySend" class="primary">Send</button></div></section>`;
      const send = doc.getElementById('replicaFamilySend');
      if (send) send.onclick = async () => {
        const input = doc.getElementById('replicaFamilyInput');
        const text = input?.value.trim(); if (!text) return;
        const payload = { id:(win.crypto?.randomUUID?.() || `${Date.now()}`), household_id:household.household_id, sender_user_id:user.id, sender_name:currentName(), sender_type:'adult', message_text:text };
        const r = await sb.from('household_chat_messages').insert(payload);
        if (r.error) return toast(r.error.message);
        renderFamilyChat();
      };
    }

    async function renderCommunity(){
      await refreshContext();
      view.innerHTML = `${hero('🌻 Community','Mom Feed, Community Recipes, and Community Chat in one place.')}
        <section class="panel"><div class="replica-community-tabs"><button data-community-mode="feed" class="${communityMode==='feed'?'primary':'secondary'}">Feed</button><button data-community-mode="recipes" class="${communityMode==='recipes'?'primary':'secondary'}">Recipes 🍲</button><button data-community-mode="chat" class="${communityMode==='chat'?'primary':'secondary'}">Chat 💬</button></div><div id="replicaCommunityBody" class="replica-community-body">Loading…</div></section>`;
      view.querySelectorAll('[data-community-mode]').forEach(b => b.onclick = () => { communityMode=b.dataset.communityMode; renderCommunity(); });
      await renderCommunityBody();
    }

    async function renderCommunityBody(){
      const host = doc.getElementById('replicaCommunityBody'); if (!host) return;
      const sb = await ensureClient(); if (!sb) return;
      if (communityMode === 'feed') {
        const q = await sb.from('mom_chat_posts').select('id,display_name,post_text,images,created_at').order('created_at',{ascending:false}).limit(50);
        const posts = q.error ? [] : (q.data || []);
        host.innerHTML = `<div class="chat-compose"><textarea id="replicaPostInput" maxlength="1200" placeholder="What’s on your mind, mama?"></textarea><button id="replicaPostSend" class="primary">Post</button></div>${posts.map(p=>`<article class="replica-feed-card"><b>${esc(p.display_name||'MoM HQ Mom')}</b><div class="fine">${new Date(p.created_at).toLocaleString()}</div><p>${esc(p.post_text||'')}</p></article>`).join('') || `<div class="empty"><span class="big">💬</span>Be the first mom to share something!</div>`}`;
        doc.getElementById('replicaPostSend').onclick = async () => {
          const text = doc.getElementById('replicaPostInput')?.value.trim(); if (!text) return;
          const r = await sb.from('mom_chat_posts').insert({ user_id:user.id, display_name:currentName(), post_text:text, images:[] });
          if (r.error) return toast(r.error.message); renderCommunityBody();
        };
      } else if (communityMode === 'recipes') {
        const q = await sb.from('community_recipe_posts').select('id,display_name,recipe_name,caption,category,ingredients,steps,created_at').order('created_at',{ascending:false}).limit(50);
        const recipes = q.error ? [] : (q.data || []);
        host.innerHTML = recipes.map(r=>`<article class="replica-feed-card"><span class="tag">${esc(r.category||'Recipe')}</span><h3>${esc(r.recipe_name)}</h3><div class="fine">by ${esc(r.display_name||'MoM HQ Mom')}</div><p>${esc(r.caption||'')}</p><details><summary>${arr(r.ingredients).length} ingredients • ${arr(r.steps).length} steps</summary><h4>Ingredients</h4>${arr(r.ingredients).map(i=>`<div>• ${esc(i)}</div>`).join('')}<h4>Directions</h4>${arr(r.steps).map((s,i)=>`<div>${i+1}. ${esc(s)}</div>`).join('')}</details></article>`).join('') || `<div class="empty"><span class="big">🍲</span>No community recipes yet.</div>`;
      } else {
        const q = await sb.from('mom_chat_messages_148').select('id,author_name,text,created_at').eq('room','global').order('created_at',{ascending:true}).limit(80);
        const messages = q.error ? [] : (q.data || []);
        host.innerHTML = `<div class="replica-chat-log">${messages.map(m=>`<div class="community-message"><b>${esc(m.author_name||'MoM HQ Mom')}</b>${esc(m.text||'')}</div>`).join('') || `<div class="empty"><span class="big">💬</span>Be the first to say hi.</div>`}</div><div class="chat-compose"><textarea id="replicaCommunityInput" maxlength="1000" placeholder="Message the MoM HQ community…"></textarea><button id="replicaCommunitySend" class="primary">Send</button></div>`;
        doc.getElementById('replicaCommunitySend').onclick = async () => {
          const text = doc.getElementById('replicaCommunityInput')?.value.trim(); if (!text) return;
          const r = await sb.from('mom_chat_messages_148').insert({ room:'global', user_id:user.id, author_name:currentName(), text });
          if (r.error) return toast(r.error.message); renderCommunityBody();
        };
      }
    }

    async function renderRecap(){
      await refreshContext();
      const kids = arr(state.kids);
      const allChores = kids.flatMap(k => arr(k.chores));
      const completed = allChores.filter(c => c.done || c.completed).length;
      const loads = arr(obj(state.laundry).loads).length;
      const meals = arr(state.mealPlan).length + arr(obj(state.tonight67).items).length;
      const events = arr(state.events).length || arr(obj(state.familySchedule).events).length;
      view.innerHTML = `${hero('📊 Weekly Recap','A quick look at your family wins.')}
        <section class="replica-stat-grid replica-recap-grid"><div class="replica-stat"><b>${completed}</b><span>Chores done</span></div><div class="replica-stat"><b>${loads}</b><span>Laundry loads</span></div><div class="replica-stat"><b>${meals}</b><span>Meals planned</span></div><div class="replica-stat"><b>${events}</b><span>Events</span></div></section>
        <section class="panel"><h2>🌻 Family wins</h2><p class="muted">Everything here comes from the same household state used by MoM HQ. Keep stacking small wins.</p></section>`;
    }

    async function renderRefer(){
      await refreshContext();
      const sb = await ensureClient();
      let summary = null;
      if (sb) {
        const r = await sb.rpc('momhq_referral_summary147');
        if (!r.error) summary = r.data;
      }
      const clicks = Number(summary?.clicks || 0), downloads = Number(summary?.downloads || 0), subscriptions = Number(summary?.subscriptions || 0);
      view.innerHTML = `${hero('🎁 Refer & Earn','Invite friends and track MoM HQ referral rewards.')}
        <section class="panel"><h2>🌻 Your referral progress</h2><p class="muted">20 link clicks, 5 downloads, or 3 subscriptions can create claimable referral rewards in the current backend.</p>
        <section class="replica-stat-grid replica-recap-grid"><div class="replica-stat"><b>${clicks}</b><span>Clicks</span></div><div class="replica-stat"><b>${downloads}</b><span>Downloads</span></div><div class="replica-stat"><b>${subscriptions}</b><span>Subscriptions</span></div><div class="replica-stat"><b>${Number(summary?.total_claimed||0)}</b><span>Claimed</span></div></section></section>
        <section class="panel donation"><h2>💛 Support MoM HQ Development</h2><p>Donations are optional and separate from Premium.</p><button id="replicaDonatePayPal" class="primary" data-paypal-donate>Donate with PayPal</button></section>`;
      bindPayPal();
    }

    function bindCustomTargets(){
      view?.querySelectorAll('[data-replica-target]').forEach(b => b.onclick = () => navigate(b.dataset.replicaTarget));
    }

    async function navigate(target){
      if (!target) return;
      if (['home','hub'].includes(target) || ['badges','familyChat','communityReplica','recap','refer'].includes(target)) {
        custom = target;
        active = target === 'hub' ? 'hub' : (target === 'home' ? 'home' : 'hub');
        renderBottom();
        if (target === 'home') await renderHomeReplica();
        else if (target === 'hub') renderHub();
        else if (target === 'badges') await renderBadges();
        else if (target === 'familyChat') await renderFamilyChat();
        else if (target === 'communityReplica') await renderCommunity();
        else if (target === 'recap') await renderRecap();
        else if (target === 'refer') await renderRefer();
        win.scrollTo({top:0,behavior:'smooth'});
        return;
      }
      active = ['kids','meals','schedule'].includes(target) ? target : 'hub';
      renderBottom();
      clickExisting(target);
    }

    function detectActiveFromView(){
      if (custom) return;
      const title = view?.querySelector('h1')?.textContent || '';
      if (/Kids/i.test(title)) active='kids';
      else if (/Meals/i.test(title)) active='meals';
      else if (/Schedule/i.test(title)) active='schedule';
      else if (/Hi,|Home/i.test(title)) active='home';
      else active='hub';
    }

    function applyChrome(){
      if (!bottom) { bindPayPal(); return; }
      hideLegacyTop();
      detectActiveFromView();
      renderBottom();
      bindPayPal();
    }

    if (bottom && view) {
      const observer = new MutationObserver(() => setTimeout(applyChrome,0));
      observer.observe(bottom,{childList:true,subtree:true});
      observer.observe(view,{childList:true,subtree:true});
      setTimeout(() => navigate('home'), 50);
    } else {
      bindPayPal();
    }
  }

  return { PRIMARY_TABS, HUB_ITEMS, openPayPal, mount };
});
