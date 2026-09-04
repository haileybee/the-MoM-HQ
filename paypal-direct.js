(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MOMHQ_PAYPAL = api;
  if (root && root.document) api.mount(root);
})(typeof window !== 'undefined' ? window : null, function(){
  'use strict';

  function isPayPalDonationUrl(value){
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.toLowerCase();
      return url.protocol === 'https:' && (host === 'paypal.me' || host === 'www.paypal.com' || host === 'paypal.com');
    } catch {
      return false;
    }
  }

  function getDonationUrl(win){
    const value = win?.MOMHQ_CONFIG?.paypalDonationUrl || '';
    return isPayPalDonationUrl(value) ? value : '';
  }

  function explainMissing(win){
    const message = 'The MoM HQ PayPal donation link has not been connected yet.';
    const toast = win.document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      win.setTimeout(() => toast.classList.remove('show'), 2600);
      return;
    }
    win.alert(message);
  }

  function openPayPal(win){
    const url = getDonationUrl(win);
    if (!url) {
      explainMissing(win);
      return false;
    }
    win.location.assign(url);
    return true;
  }

  function mount(win){
    win.document.addEventListener('click', function(event){
      const target = event.target?.closest?.('[data-paypal-donate], #donateSettings');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openPayPal(win);
    }, true);

    const syncLinks = () => {
      const url = getDonationUrl(win);
      win.document.querySelectorAll('[data-paypal-donate]').forEach(link => {
        if (url) link.setAttribute('href', url);
        else link.setAttribute('href', '#support');
      });
    };
    syncLinks();
    if (win.MutationObserver) new win.MutationObserver(syncLinks).observe(win.document.body, {childList:true, subtree:true});
  }

  return { isPayPalDonationUrl, getDonationUrl, openPayPal, mount };
});
