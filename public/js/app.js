// La app instalable: registra el service worker y maneja el botón "Instalar app" del menú
(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  const instalada = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let aviso = null;   // el permiso del navegador para instalar con un clic (Chrome, Edge, Android)

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); aviso = e; });
  window.addEventListener('appinstalled', () => {
    aviso = null;
    const b = document.getElementById('btnInstalar');
    if (b) b.hidden = true;
  });

  // Dentro de la app ya instalada el botón no se muestra
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btnInstalar');
    if (b && !instalada()) b.hidden = false;
  });

  function pasos() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
      return ['En iPhone o iPad', [
        'Abra esta página en Safari.',
        'Toque el botón Compartir (el cuadro con la flecha hacia arriba).',
        'Elija "Agregar a pantalla de inicio" y luego "Agregar".'
      ]];
    }
    if (/Android/.test(ua)) {
      return ['En Android', [
        'Abra esta página en Chrome.',
        'Toque el menú ⋮ (arriba a la derecha).',
        'Elija "Instalar aplicación" o "Agregar a pantalla principal".'
      ]];
    }
    return ['En el computador', [
      'Use Chrome, Edge o Brave.',
      'En la barra de direcciones, a la derecha, haga clic en el icono de instalar (una pantalla con una flecha).',
      'Si no aparece, abra el menú del navegador y busque "Instalar Asistencia Savio" o "Aplicaciones → Instalar este sitio como aplicación".'
    ]];
  }

  let dlg = null;
  function mostrarPasos() {
    const [titulo, lista] = pasos();
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'confirmar';
      dlg.innerHTML = `
        <form method="dialog" class="confirmar__caja">
          <h2 class="confirmar__titulo">Instalar la app</h2>
          <p class="confirmar__mensaje"></p>
          <ul class="instalar__pasos"></ul>
          <div class="confirmar__botones"><button value="ok" class="btn btn--primario">Entendido</button></div>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }
    dlg.querySelector('.confirmar__mensaje').textContent = titulo + ':';
    const lista2 = dlg.querySelector('.instalar__pasos');
    lista2.replaceChildren(...lista.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
    dlg.showModal();
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#btnInstalar')) return;
    if (aviso) {
      aviso.prompt();
      const r = await aviso.userChoice;
      aviso = null;
      if (r.outcome === 'accepted') document.getElementById('btnInstalar').hidden = true;
    } else {
      mostrarPasos();
    }
  });
})();
