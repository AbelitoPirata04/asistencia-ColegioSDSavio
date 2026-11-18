// La app instalable: registra el service worker y muestra "Instalar app" cuando el navegador lo permite
(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  let aviso = null;
  const boton = () => document.getElementById('btnInstalar');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    aviso = e;
    const b = boton();
    if (b) b.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    aviso = null;
    const b = boton();
    if (b) b.hidden = true;
  });

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#btnInstalar') || !aviso) return;
    aviso.prompt();
    await aviso.userChoice;
    aviso = null;
    boton().hidden = true;
  });
})();
