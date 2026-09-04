(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MOMHQ_MOM_PROFILE = api;
  if (root && root.document) api.mount(root);
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  const esc = (value='') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function renderProfileEditor(profile={}){
    return `<section id="momProfilePanel" class="panel">
      <h2>🌻 Mom Profile</h2>
      <p class="muted">Edit how you appear in the MoM HQ community.</p>
      <div class="field"><label for="momProfileDisplayName">Display name</label><input id="momProfileDisplayName" maxlength="80" value="${esc(profile.display_name || '')}" placeholder="Your name"></div>
      <div class="field"><label for="momProfileUsername">Username</label><input id="momProfileUsername" maxlength="40" value="${esc(profile.username || '')}" placeholder="sunflowermom"></div>
      <div class="field"><label for="momProfileBio">Bio</label><textarea id="momProfileBio" maxlength="500" rows="4" placeholder="Tell the MoM HQ community a little about you…">${esc(profile.bio || '')}</textarea></div>
      <button id="saveMomProfile" class="primary" type="button">Save Profile</button>
      <p id="momProfileStatus" class="fine" role="status" aria-live="polite"></p>
    </section>`;
  }

  async function persistProfile(client, userId, profile){
    if (!client || !userId) throw new Error('Sign in before saving your Mom Profile.');
    const displayName = String(profile?.display_name || '').trim();
    if (!displayName) throw new Error('Please enter a display name.');
    const payload = {
      user_id: userId,
      display_name: displayName.slice(0,80),
      username: String(profile?.username || '').trim().slice(0,40) || null,
      bio: String(profile?.bio || '').trim().slice(0,500),
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from('mom_social_profiles').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
    return payload;
  }

  function mount(win){
    const CFG = win.MOMHQ_CONFIG || {};
    if (!win.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) return;

    const client = win.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
    });
    const state = { user:null, profile:null, loading:false };

    const defaultProfile = user => ({
      display_name: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'MoM HQ Mom',
      username: '',
      bio: ''
    });

    async function loadProfile(){
      if (state.loading) return;
      state.loading = true;
      try{
        const { data:sessionData } = await client.auth.getSession();
        state.user = sessionData?.session?.user || null;
        if (!state.user) return;
        const { data, error } = await client.from('mom_social_profiles')
          .select('display_name,username,bio')
          .eq('user_id', state.user.id)
          .maybeSingle();
        if (error) throw error;
        state.profile = data || defaultProfile(state.user);
      }catch(err){
        console.warn('Mom Profile could not load', err);
        if (state.user) state.profile = defaultProfile(state.user);
      }finally{
        state.loading = false;
        maybeInject(true);
      }
    }

    async function saveFromEditor(){
      const button = win.document.getElementById('saveMomProfile');
      const status = win.document.getElementById('momProfileStatus');
      if (!button || !status) return;
      button.disabled = true;
      status.textContent = 'Saving profile…';
      try{
        const saved = await persistProfile(client, state.user?.id, {
          display_name: win.document.getElementById('momProfileDisplayName')?.value,
          username: win.document.getElementById('momProfileUsername')?.value,
          bio: win.document.getElementById('momProfileBio')?.value
        });
        state.profile = saved;
        status.textContent = 'Profile saved 🌻';
      }catch(err){
        status.textContent = err?.message || 'Profile could not be saved. Please try again.';
      }finally{
        button.disabled = false;
      }
    }

    function maybeInject(force=false){
      const view = win.document.getElementById('view');
      if (!view) return;
      const title = view.querySelector('.hero h1, h1')?.textContent || '';
      if (!title.includes('Settings')) return;
      const existing = win.document.getElementById('momProfilePanel');
      if (existing && !force) return;
      if (!state.user || !state.profile){
        if (!state.loading) loadProfile();
        if (!existing){
          const hero = view.querySelector('.hero');
          hero?.insertAdjacentHTML('afterend', '<section id="momProfilePanel" class="panel"><h2>🌻 Mom Profile</h2><p class="fine">Loading profile…</p></section>');
        }
        return;
      }
      if (existing) existing.outerHTML = renderProfileEditor(state.profile);
      else {
        const hero = view.querySelector('.hero');
        hero?.insertAdjacentHTML('afterend', renderProfileEditor(state.profile));
      }
      const saveButton = win.document.getElementById('saveMomProfile');
      if (saveButton) saveButton.onclick = saveFromEditor;
    }

    const observer = new MutationObserver(() => maybeInject());
    observer.observe(win.document.body, { childList:true, subtree:true });
    client.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      state.profile = null;
      if (state.user) loadProfile();
    });
    loadProfile();
    setTimeout(maybeInject, 0);
  }

  return { renderProfileEditor, persistProfile, mount };
});
