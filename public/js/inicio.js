// Vista: Inicio (portada con fotos del colegio + resumen del día en vivo)
(() => {
  const $ = (s) => document.querySelector(s);
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siglas = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const hora = (f) => new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  const corta = (t) => new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
  const metodo = (m) => (m === 'huella' ? 'huella' : m === 'manual' ? 'registro manual' : 'tarjeta');

  // ================= Portada (carrusel) =================
  const DURACION = 6500;
  const slides = JSON.parse($('#datosPortada').textContent);
  const fotos = [...document.querySelectorAll('.portada__foto')];
  const puntos = [...document.querySelectorAll('#portadaPuntos button')];
  let actual = 0;
  let reloj = null;
  let pausado = false;

  function mostrar(i) {
    actual = (i + slides.length) % slides.length;
    fotos.forEach((f, k) => { f.classList.toggle('activa', k === actual); f.setAttribute('aria-hidden', String(k !== actual)); });
    puntos.forEach((p, k) => p.classList.toggle('on', k === actual));
    const texto = document.querySelector('.portada__texto');
    texto.classList.remove('entra'); void texto.offsetWidth; texto.classList.add('entra');
    $('#portadaTitulo').textContent = slides[actual].titulo;
    $('#portadaTexto').textContent = slides[actual].texto;
    reiniciar();
  }

  function reiniciar() {
    clearTimeout(reloj);
    const barra = $('#portadaProgreso');
    barra.classList.remove('corre'); void barra.offsetWidth;
    if (pausado) return;
    barra.style.animationDuration = DURACION + 'ms';
    barra.classList.add('corre');
    reloj = setTimeout(() => mostrar(actual + 1), DURACION);
  }

  function pausar(si) { pausado = si; $('#portada').classList.toggle('pausada', si); reiniciar(); }

  $('#portadaAntes').addEventListener('click', () => mostrar(actual - 1));
  $('#portadaDespues').addEventListener('click', () => mostrar(actual + 1));
  puntos.forEach((p) => p.addEventListener('click', () => mostrar(Number(p.dataset.ir))));
  const portada = $('#portada');
  portada.addEventListener('mouseenter', () => pausar(true));
  portada.addEventListener('mouseleave', () => pausar(false));
  portada.addEventListener('focusin', () => pausar(true));
  portada.addEventListener('focusout', () => pausar(false));
  portada.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') mostrar(actual - 1);
    if (e.key === 'ArrowRight') mostrar(actual + 1);
  });
  // Deslizar con el dedo en celular / tablet
  let inicioX = null;
  portada.addEventListener('touchstart', (e) => { inicioX = e.touches[0].clientX; }, { passive: true });
  portada.addEventListener('touchend', (e) => {
    if (inicioX == null) return;
    const dx = e.changedTouches[0].clientX - inicioX;
    if (Math.abs(dx) > 40) mostrar(actual + (dx < 0 ? 1 : -1));
    inicioX = null;
  });
  // Si la pestaña no se ve, no tiene sentido seguir pasando fotos
  document.addEventListener('visibilitychange', () => pausar(document.hidden));
  if (quieto) pausado = true;
  reiniciar();


  // ================= Tradiciones (fotos verticales que pasan solas) =================
  const trad = [...document.querySelectorAll('.tradiciones__foto')];
  const tradPuntos = [...document.querySelectorAll('.tradiciones__puntos i')];
  let t = 0;
  if (!quieto && trad.length > 1) {
    setInterval(() => {
      if (document.hidden) return;
      trad[t].classList.remove('activa'); tradPuntos[t].classList.remove('on');
      t = (t + 1) % trad.length;
      trad[t].classList.add('activa'); tradPuntos[t].classList.add('on');
    }, 5200);
  }

  // ================= Resumen del día (se actualiza solo) =================
  let temporizador = null;
  async function cargar() {
    clearTimeout(temporizador);
    try {
      const r = await fetch('/admin/api/inicio', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      pintar(await r.json());
    } catch (e) {
      $('#pases').innerHTML = '<li class="vacio">No se pudo cargar la asistencia de hoy.</li>';
    }
    temporizador = setTimeout(cargar, 15000);
  }
  // Un pase nuevo en el equipo: se actualiza al instante (y otra vez a los 3 s, cuando ya llegó la foto)
  document.addEventListener('pase', () => { cargar(); setTimeout(cargar, 3000); });

  // ================= Equipo ESP32 =================
  document.addEventListener('equipo', (ev) => {
    const d = ev.detail;
    const espera = d.modo !== 'asistencia';
    $('#eqLuz').className = 'equipo-tarjeta__luz ' + (espera ? 'luz--espera' : d.enLinea ? 'luz--linea' : 'luz--fuera');
    $('#eqEstado').textContent = espera ? 'Registrando credencial' : d.enLinea ? 'En línea' : 'Sin conexión';
    $('#eqModo').textContent = d.modo === 'registro' ? 'Registro de huella' : d.modo === 'tarjeta' ? 'Asignar tarjeta' : 'Asistencia';
    const s = d.seg_conexion;
    $('#eqSenal').textContent = s == null ? 'Nunca' : s < 60 ? `Hace ${s} s` : s < 3600 ? `Hace ${Math.floor(s / 60)} min` : `Hace ${Math.floor(s / 3600)} h`;
  });

  window.Equipo.consultar();   // pide el estado ya, sin esperar el siguiente ciclo

  // ================= Accesos rápidos =================
  $('#accManual').addEventListener('click', async () => { if (await window.VentanaRegistro.abrir()) cargar(); });
  $('#accNovedad').addEventListener('click', async () => { if (await window.VentanaNovedad.abrir()) cargar(); });

  function pintar(d) {
    $('#accPdf').href = `/admin/reportes/asistencia.pdf?desde=${d.hoy}&hasta=${d.hoy}`;
    const r = d.resumen;
    const celda = (v, txt, cls = '') => `<div class="franja__dato ${cls}"><b>${v}</b><span>${txt}</span></div>`;
    const hoyTxt = new Date(d.hoy + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#resumenHoy').innerHTML =
      `<div class="franja__titulo"><span>Hoy</span><strong>${hoyTxt.charAt(0).toUpperCase() + hoyTxt.slice(1)}</strong></div>` +
      (d.diaSinClase
        ? celda('—', `Sin clase · ${esc(d.diaSinClase.motivo)}`) + celda(r.llegaron, 'vinieron') + celda(r.retardos, 'retardos') + celda(r.enColegio, 'en el colegio')
        : celda(`${r.llegaron}<small> de ${d.activos}</small>`, 'llegaron') +
          celda(r.ausentes, 'no han llegado' + (r.justificados ? ` · ${r.justificados} con permiso` : ''), r.ausentes ? 'franja__dato--rojo' : '') +
          celda(r.retardos, r.retardos === 1 ? 'retardo' : 'retardos', r.retardos ? 'franja__dato--ambar' : '') +
          celda(r.enColegio, 'en el colegio ahora'));

    // Llegadas y salidas de hoy, de la más reciente a la más antigua
    const eventos = [];
    d.registros.forEach((x) => {
      eventos.push({ x, tipo: 'llegada', f: x.fecha_hora_entrada, m: x.metodo_ingreso, foto: x.ruta_fotografia });
      if (x.fecha_hora_salida) eventos.push({ x, tipo: 'salida', f: x.fecha_hora_salida, m: x.metodo_salida, foto: x.ruta_foto_salida });
    });
    eventos.sort((a, b) => new Date(b.f) - new Date(a.f));
    $('#pases').innerHTML = eventos.length ? eventos.slice(0, 8).map((e) => `
      <li class="pase">
        ${e.foto ? `<img src="${esc(e.foto)}" alt="" loading="lazy">` : `<span class="sigla">${esc(siglas(e.x.nombre_completo))}</span>`}
        <div class="pase__quien">
          <a href="/asistencias/persona/${e.x.id_personal}">${esc(e.x.nombre_completo)}</a>
          <small>${e.tipo === 'llegada' ? 'Llegó' : 'Salió'} con ${metodo(e.m)}</small>
        </div>
        <span class="pase__tipo pase__tipo--${e.tipo}">${e.tipo === 'llegada' ? 'Llegada' : 'Salida'}</span>
        ${e.tipo === 'llegada' && e.x.estado_puntualidad === 'retardo' ? '<span class="estado estado--retardo">Retardo</span>' : ''}
        <b class="pase__hora num">${hora(e.f)}</b>
      </li>`).join('')
      : `<li class="vacio">${d.diaSinClase ? 'Hoy no hay clase.' : 'Todavía nadie ha pasado por el equipo hoy.'}</li>`;

    // Permisos de hoy y próximos días sin clase
    const items = [];
    d.permisos.forEach((p) => items.push(`<li><span class="tipo-novedad tipo-novedad--${p.tipo}">${esc(p.tipo_texto)}</span>
      <a href="/asistencias/persona/${p.id_personal}">${esc(p.nombre_completo)}</a><small>hasta ${corta(p.hasta)}</small></li>`));
    d.proximos.forEach((p) => items.push(`<li><span class="tipo-dia tipo-dia--${p.tipo}">${esc(p.tipo_texto)}</span>
      <span>${esc(p.motivo)}</span><small>${corta(p.desde)}${p.hasta !== p.desde ? ' a ' + corta(p.hasta) : ''}</small></li>`));
    $('#calendarioCerca').innerHTML = items.length ? items.join('')
      : '<li class="ayuda">No hay permisos vigentes ni días sin clase próximos. <a href="/novedades">Ir a Novedades</a></li>';
  }

  cargar();
})();
