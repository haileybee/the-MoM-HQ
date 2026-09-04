(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.mount(root);
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  const WEB_APP_URL = 'https://haileybee.github.io/the-MoM-HQ/app.html';

  function googleOAuthOptions(){
    return {
      redirectTo: WEB_APP_URL,
      skipBrowserRedirect: true,
    };
  }

  function readAuthError(win){
    const hash = new URLSearchParams((win.location.hash || '').replace(/^#/, ''));
    const query = new URLSearchParams(win.location.search || '');
    return hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error') || '';
  }

  function mount(win){
    const doc = win.document;
    const button = doc.getElementById('googleLogin');
    const status = doc.getElementById('authStatus');
    if (!button) return;

    const initialError = readAuthError(win);
    if (initialError && status) status.textContent = initialError;

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const cfg = win.MOMHQ_CONFIG || {};
      if (!win.supabase || !cfg.supabaseUrl || !cfg.supabaseKey) {
        if (status) status.textContent = 'MoM HQ login configuration is unavailable.';
        return;
      }

      button.disabled = true;
      if (status) status.textContent = 'Opening Google sign-in…';

      try {
        const client = win.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        const { data, error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: googleOAuthOptions(),
        });
        if (error) throw error;
        if (!data?.url) throw new Error('Google sign-in did not return a login URL.');
        win.location.assign(data.url);
      } catch (error) {
        console.error('MoM HQ web login', error);
        if (status) status.textContent = error?.message || 'Google sign-in could not start.';
        button.disabled = false;
      }
    }, true);
  }

  return { WEB_APP_URL, googleOAuthOptions, readAuthError, mount };
});
