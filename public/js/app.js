// La app instalable: service worker, botón "Instalar app" del menú y avisos push (campana de la barra)
(() => {
  const $ = (s) => document.querySelector(s);
  const ua = navigator.userAgent;
  const esIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const instalada = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const registro = 'serviceWorker' in navigator
    ? navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
    : Promise.resolve(null);

  // ---------- Ventana de mensaje (un solo botón) ----------
  let dlg = null;
  function mensaje(titulo, texto, lista) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'confirmar';
      dlg.innerHTML = `
        <form method="dialog" class="confirmar__caja">
          <h2 class="confirmar__titulo"></h2>
          <p class="confirmar__mensaje"></p>
          <ul class="instalar__pasos"></ul>
          <div class="confirmar__botones"><button value="ok" class="btn btn--primario">Entendido</button></div>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }
    dlg.querySelector('.confirmar__titulo').textContent = titulo;
    dlg.querySelector('.confirmar__mensaje').textContent = texto;
    const ul = dlg.querySelector('.instalar__pasos');
    ul.hidden = !lista;
    ul.replaceChildren(...(lista || []).map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
    dlg.showModal();
  }

  // ---------- Instalar app ----------
  let aviso = null;   // permiso del navegador para instalar con un clic (Chrome, Edge, Android)
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); aviso = e; });
  window.addEventListener('appinstalled', () => { aviso = null; const b = $('#btnInstalar'); if (b) b.hidden = true; });

  function pasosInstalar() {
    if (esIOS) {
      return ['En iPhone o iPad:', ['Abra esta página en Safari.',
        'Toque el botón Compartir (el cuadro con la flecha hacia arriba).',
        'Elija "Agregar a pantalla de inicio" y luego "Agregar".']];
    }
    if (/Android/.test(ua)) {
      return ['En Android:', ['Abra esta página en Chrome.', 'Toque el menú ⋮ (arriba a la derecha).',
        'Elija "Instalar aplicación" o "Agregar a pantalla principal".']];
    }
    return ['En el computador:', ['Use Chrome, Edge o Brave.',
      'En la barra de direcciones, a la derecha, haga clic en el icono de instalar (una pantalla con una flecha).',
      'Si no aparece, abra el menú del navegador y busque "Instalar Asistencia Savio" o "Aplicaciones → Instalar este sitio como aplicación".']];
  }

  async function instalar() {
    if (aviso) {
      aviso.prompt();
      const r = await aviso.userChoice;
      aviso = null;
      if (r.outcome === 'accepted') $('#btnInstalar').hidden = true;
      return;
    }
    const [texto, lista] = pasosInstalar();
    mensaje('Instalar la app', texto, lista);
  }

  // ---------- Avisos push (llegadas y salidas en este dispositivo) ----------
  const soportaPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function base64AUint8(b64) {
    const relleno = '='.repeat((4 - (b64.length % 4)) % 4);
    const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
  }

  function pintarAvisos(activos) {
    const b = $('#btnAvisos');
    if (!b) return;
    b.classList.toggle('voz--activa', activos);
    b.setAttribute('aria-pressed', String(activos));
    $('#avisosTexto').textContent = activos ? 'Avisos activos' : 'Avisos apagados';
    b.title = activos ? 'Este dispositivo recibe un aviso cuando alguien llega o sale. Toque para apagarlos.'
      : 'Recibir en este dispositivo un aviso cuando alguien llegue o salga';
  }

  async function suscripcionActual() {
    const reg = await registro;
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function enviarSuscripcion(sub, silencioso) {
    const r = await fetch('/admin/api/push/suscripcion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suscripcion: sub.toJSON(), silencioso })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensaje || 'No se pudo guardar');
  }

  async function activarAvisos() {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      mensaje('Avisos bloqueados', 'El navegador no dio permiso para mostrar avisos. Para activarlos:', [
        'Toque el candado o el icono a la izquierda de la dirección (o vaya a Ajustes del navegador → Configuración de sitios).',
        'En "Notificaciones", elija "Permitir".',
        'Vuelva a tocar la campana.'
      ]);
      return;
    }
    const reg = await registro;
    const { clave } = await (await fetch('/admin/api/push/clave')).json();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(clave) });
    await enviarSuscripcion(sub, false);
    pintarAvisos(true);
  }

  async function apagarAvisos() {
    const sub = await suscripcionActual();
    if (sub) {
      await fetch('/admin/api/push/suscripcion', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    pintarAvisos(false);
  }

  async function tocarCampana() {
    const b = $('#btnAvisos');
    if (!soportaPush) {
      if (esIOS && !instalada()) {
        mensaje('Primero instale la app', 'En iPhone los avisos solo funcionan con la app instalada.', [
          'En Safari toque Compartir y elija "Agregar a pantalla de inicio".',
          'Abra la app desde el ícono del escudo.',
          'Toque la campana y permita las notificaciones.'
        ]);
      } else {
        mensaje('Avisos no disponibles', 'Este navegador no permite avisos. Use Chrome o Edge (o la app instalada en iPhone).');
      }
      return;
    }
    b.disabled = true;
    try {
      if (await suscripcionActual()) {
        const ok = window.Confirmar ? await window.Confirmar({
          titulo: '¿Apagar los avisos?', mensaje: 'Este dispositivo dejará de recibir un aviso cuando alguien llegue o salga.',
          aceptar: 'Sí, apagar', cancelar: 'Dejarlos activos'
        }) : true;
        if (ok) await apagarAvisos();
      } else {
        await activarAvisos();
      }
    } catch (e) {
      mensaje('No se pudieron activar los avisos', 'Revise la conexión a internet e intente de nuevo. (' + e.message + ')');
    } finally {
      b.disabled = false;
    }
  }

  async function iniciarAvisos() {
    const b = $('#btnAvisos');
    if (!b) return;
    if (!soportaPush && !esIOS) return;            // navegador sin avisos: no se muestra la campana
    b.hidden = false;
    if (!soportaPush) { pintarAvisos(false); return; }
    const sub = await suscripcionActual();
    const activos = !!sub && Notification.permission === 'granted';
    pintarAvisos(activos);
    if (activos) enviarSuscripcion(sub, true).catch(() => {});   // por si el servidor la había olvidado
  }

  // ---------- Arranque ----------
  document.addEventListener('DOMContentLoaded', () => {
    const b = $('#btnInstalar');
    if (b && !instalada()) b.hidden = false;
    iniciarAvisos();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnInstalar')) instalar();
    else if (e.target.closest('#btnAvisos')) tocarCampana();
  });
})();
