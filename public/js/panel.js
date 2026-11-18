// Comportamiento común de todas las páginas: menú lateral y estado del ESP32 en la barra superior.
(() => {
  // Si la sesión vence mientras la página está abierta, cualquier petición devuelve 401: se vuelve al ingreso
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const r = await fetchOriginal(...args);
    if (r.status === 401) location.href = '/login?volver=' + encodeURIComponent(location.pathname + location.search);
    return r;
  };

  const raiz = document.documentElement;
  const $ = (s) => document.querySelector(s);

  // ---------- Menú lateral ----------
  // Escritorio: riel de iconos que se despliega al pasar el mouse; "Mantener abierto" lo deja fijo.
  // Celular: se abre con el botón de la barra y se cierra tocando fuera.
  const LLAVE = 'savio.menuFijo';
  const btnFijar = $('#btnFijar');
  const pintarFijar = () => {
    const fijo = raiz.classList.contains('menu-fijo');
    btnFijar.setAttribute('aria-pressed', String(fijo));
    btnFijar.querySelector('span').textContent = fijo ? 'Contraer menú' : 'Mantener abierto';
  };
  btnFijar.addEventListener('click', () => {
    const fijo = raiz.classList.toggle('menu-fijo');
    try { localStorage.setItem(LLAVE, fijo ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    pintarFijar();
    btnFijar.blur();   // sin esto, :focus-within lo mantendría abierto al contraer
  });
  pintarFijar();

  const btnMenu = $('#btnMenu');
  const velo = $('#velo');
  const menuMovil = (abrir) => {
    raiz.classList.toggle('menu-movil', abrir);
    btnMenu.setAttribute('aria-expanded', String(abrir));
    velo.hidden = !abrir;
  };
  btnMenu.addEventListener('click', () => menuMovil(!raiz.classList.contains('menu-movil')));
  const btnMas = $('#btnMas');   // "Más" de la barra inferior en teléfonos
  if (btnMas) btnMas.addEventListener('click', () => menuMovil(!raiz.classList.contains('menu-movil')));
  velo.addEventListener('click', () => menuMovil(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menuMovil(false); });

  // ---------- Estado del equipo ----------
  // Las páginas escuchan el evento "equipo" (ej. la ficha de personal durante un enrolamiento).
  const caja = $('#equipo');
  const texto = $('#equipoTexto');
  const btnDetener = $('#equipoDetener');
  let temporizador = null;
  let rapido = false;

  function pintar(d) {
    const espera = d.modo !== 'asistencia';
    caja.className = 'equipo ' + (espera ? 'equipo--espera' : d.enLinea ? 'equipo--linea' : 'equipo--fuera');
    const quien = d.nombre ? ' · ' + d.nombre.split(' ')[0] : '';
    texto.textContent = espera
      ? (d.modo === 'registro' ? 'Registrando huella' : 'Esperando tarjeta') + quien
      : d.enLinea ? 'Equipo en línea · Asistencia' : 'Equipo sin conexión';
    btnDetener.hidden = !espera;
  }

  async function consultar() {
    clearTimeout(temporizador);
    const desde = Date.now();
    try {
      const r = await fetch('/admin/api/dispositivo', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        d._desde = desde;   // permite descartar respuestas pedidas antes de iniciar un proceso
        pintar(d);
        document.dispatchEvent(new CustomEvent('equipo', { detail: d }));
      }
    } catch (e) { /* se reintenta */ }
    clearTimeout(temporizador);   // evita dos cadenas de sondeo si se llamó dos veces seguidas
    temporizador = setTimeout(consultar, rapido ? 1500 : document.hidden ? 15000 : 5000);
  }

  btnDetener.addEventListener('click', async () => {
    btnDetener.disabled = true;
    try { await fetch('/admin/api/dispositivo/registro', { method: 'DELETE' }); } catch (e) { /* nada */ }
    btnDetener.disabled = false;
    consultar();
  });

  // ---------- Ventana de confirmación (reemplaza el confirm() del navegador) ----------
  // Uso: if (await Confirmar({ titulo, mensaje, aceptar: 'Sí, quitar', peligro: true })) { ... }
  let dlg = null;
  window.Confirmar = ({ titulo, mensaje, aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false }) =>
    new Promise((resolver) => {
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.className = 'confirmar';
        dlg.innerHTML = `
          <form method="dialog" class="confirmar__caja">
            <h2 class="confirmar__titulo"></h2>
            <p class="confirmar__mensaje"></p>
            <div class="confirmar__botones">
              <button value="no" class="btn confirmar__no"></button>
              <button value="si" class="btn confirmar__si"></button>
            </div>
          </form>`;
        document.body.appendChild(dlg);
        // Clic fuera de la caja = cancelar
        dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('no'); });
      }
      dlg.querySelector('.confirmar__titulo').textContent = titulo;
      dlg.querySelector('.confirmar__mensaje').textContent = mensaje || '';
      dlg.querySelector('.confirmar__no').textContent = cancelar;
      const si = dlg.querySelector('.confirmar__si');
      si.textContent = aceptar;
      si.className = 'btn confirmar__si ' + (peligro ? 'btn--rojo' : 'btn--primario');
      dlg.classList.toggle('confirmar--peligro', peligro);
      dlg.returnValue = 'no';
      dlg.addEventListener('close', () => resolver(dlg.returnValue === 'si'), { once: true });
      dlg.showModal();
      dlg.querySelector('.confirmar__no').focus();   // por seguridad, el foco empieza en "Cancelar"
    });

  // ---------- Avisos de llegada / salida (notificación + voz) ----------
  // El panel pregunta cada 4 s por pases nuevos del equipo. Los que ya estaban al abrir la página no se anuncian.
  const LLAVE_VOZ = 'savio.voz';
  let vozActiva = false;
  try { vozActiva = localStorage.getItem(LLAVE_VOZ) === '1'; } catch (e) { /* sin almacenamiento */ }
  const btnVoz = $('#btnVoz');
  const pintarVoz = () => {
    btnVoz.setAttribute('aria-pressed', String(vozActiva));
    btnVoz.classList.toggle('voz--activa', vozActiva);
    $('#vozTexto').textContent = vozActiva ? 'Voz activada' : 'Voz apagada';
  };
  pintarVoz();

  // Elige la mejor voz en ESPAÑOL que tenga el navegador. Si no se elige una, el navegador usa su voz
  // por defecto (que suele ser en inglés). Orden de preferencia:
  //   1. Voces "naturales" de Colombia (Edge: Salomé / Gonzalo) — las más fluidas
  //   2. Cualquier voz natural u online en español latino
  //   3. Google español (Chrome)
  //   4. Cualquier voz en español del sistema
  let vozEs = null;
  function puntaje(v) {
    const lang = (v.lang || '').toLowerCase().replace('_', '-');
    if (!lang.startsWith('es')) return -1;
    const nombre = v.name.toLowerCase();
    let p = 1;
    if (/natural|online|neural/.test(nombre)) p += 50;              // voces neuronales: suenan humanas
    if (lang === 'es-co') p += 30;                                   // acento colombiano
    else if (/es-(mx|us|419|ve|pe|ec|ar|cl)/.test(lang)) p += 20;    // otro acento latino
    else if (lang === 'es-es') p += 5;
    if (/google/.test(nombre)) p += 15;                              // Google español (Chrome) es fluida
    if (/salom|gonzalo|dalia|jorge|paloma|elena/.test(nombre)) p += 5;
    return p;
  }
  function elegirVoz() {
    const voces = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const candidatas = voces.filter((v) => puntaje(v) > 0).sort((a, b) => puntaje(b) - puntaje(a));
    vozEs = candidatas[0] || null;
    if (vozEs) console.info('[Voz] Usando:', vozEs.name, vozEs.lang);
  }
  if (window.speechSynthesis) { elegirVoz(); speechSynthesis.addEventListener('voiceschanged', elegirVoz); }

  let avisadoSinVoz = false;
  function hablar(texto) {
    if (!vozActiva || !window.speechSynthesis) return;
    if (!vozEs) elegirVoz();   // a veces las voces cargan tarde
    if (!vozEs) {
      // Sin voz en español es mejor callar que hablar en inglés
      if (!avisadoSinVoz) {
        avisadoSinVoz = true;
        window.Confirmar({ titulo: 'No hay voz en español',
          mensaje: 'Este navegador no tiene una voz en español instalada. Use Microsoft Edge (trae voces naturales de Colombia) o Google Chrome con internet.',
          aceptar: 'Entendido', cancelar: 'Cerrar' });
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(texto);
    u.voice = vozEs;
    u.lang = vozEs.lang;
    u.rate = 1.02;
    u.pitch = 1;
    speechSynthesis.speak(u);   // si llegan varios seguidos, se anuncian en orden
  }

  btnVoz.addEventListener('click', () => {
    vozActiva = !vozActiva;
    try { localStorage.setItem(LLAVE_VOZ, vozActiva ? '1' : '0'); } catch (e) { /* nada */ }
    pintarVoz();
    // El navegador solo deja hablar después de un clic: se aprovecha este para confirmar
    if (vozActiva) hablar('Avisos de voz activados.');
    else if (window.speechSynthesis) speechSynthesis.cancel();
    // Si se permite, también avisa con notificación del sistema cuando la pestaña no está a la vista
    if (vozActiva && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });

  const pila = document.createElement('div');
  pila.className = 'avisos';
  pila.setAttribute('aria-live', 'polite');
  document.body.appendChild(pila);

  const escapar = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siglasDe = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  function anunciar(ev) {
    const entrada = ev.tipo === 'entrada';
    const rol = ev.rol === 'directivo' ? 'Directivo' : 'Docente';
    const hora = new Date(ev.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
    const metodo = ev.metodo === 'huella' ? 'huella' : 'tarjeta';
    const titulo = entrada ? 'Llegada registrada' : 'Salida registrada';
    const detalle = `${hora} · con ${metodo}${entrada ? (ev.retardo ? ' · con retardo' : ' · a tiempo') : ''}`;

    const aviso = document.createElement('a');
    aviso.href = `/asistencias/persona/${ev.id_personal}`;
    aviso.className = `aviso-pase aviso-pase--${entrada ? (ev.retardo ? 'retardo' : 'entrada') : 'salida'}`;
    aviso.innerHTML = `
      ${(ev.foto || ev.foto_perfil) ? `<img src="${escapar(ev.foto || ev.foto_perfil)}" alt="">` : `<span class="sigla">${escapar(siglasDe(ev.nombre))}</span>`}
      <span class="aviso-pase__texto">
        <small>${titulo} · ${rol}</small>
        <strong>${escapar(ev.nombre)}</strong>
        <span>${detalle}</span>
      </span>
      <button type="button" class="aviso-pase__cerrar" aria-label="Cerrar aviso">×</button>`;
    pila.prepend(aviso);
    const quitar = () => { aviso.classList.add('sale'); setTimeout(() => aviso.remove(), 300); };
    aviso.querySelector('.aviso-pase__cerrar').addEventListener('click', (e) => { e.preventDefault(); quitar(); });
    setTimeout(quitar, 8000);
    while (pila.children.length > 4) pila.lastElementChild.remove();

    // Frase con pausas por comas para que suene natural (sin adivinar si es "el docente" o "la docente")
    hablar(entrada
      ? `Llegada registrada. ${rol}, ${ev.nombre}${ev.retardo ? ', con retardo' : ''}.`
      : `Salida registrada. ${rol}, ${ev.nombre}. Hasta luego.`);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`${titulo}: ${ev.nombre}`, { body: detalle, icon: '/img/logo_pequeno.png', tag: `${ev.tipo}-${ev.id_asistencia}` });
    }
  }

  const vistos = new Set();
  let primeraVez = true;
  async function buscarPases() {
    try {
      const r = await fetch('/admin/api/eventos-recientes', { cache: 'no-store' });
      if (r.ok) {
        const eventos = await r.json();
        eventos.forEach((ev) => {
          const clave = `${ev.tipo}-${ev.id_asistencia}`;
          if (vistos.has(clave)) return;
          vistos.add(clave);
          if (!primeraVez) {
            anunciar(ev);
            document.dispatchEvent(new CustomEvent('pase', { detail: ev }));   // las vistas pueden refrescarse al instante
          }
        });
        primeraVez = false;
      }
    } catch (e) { /* se reintenta */ }
    setTimeout(buscarPases, 4000);
  }
  buscarPases();

  window.Equipo = {
    consultar,
    rapido(si) { rapido = si; consultar(); }
  };
  consultar();
})();
