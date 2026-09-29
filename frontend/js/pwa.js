(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });

  window.__pwaPrompt = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    window.__pwaPrompt = ev;
  });

  function estado(online) {
    if (window.App && window.App.setOnline) window.App.setOnline(online);
  }
  window.addEventListener('online', function () { estado(true); });
  window.addEventListener('offline', function () { estado(false); });

  estado(navigator.onLine);
})();