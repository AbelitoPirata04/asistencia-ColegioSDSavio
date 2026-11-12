// Vista: Hardware ESP32 (estado en vivo, cifras y diagrama de conexiones interactivo)
(() => {
  const $ = (s) => document.querySelector(s);

  // ---------- Estado en vivo (llega desde panel.js) ----------
  document.addEventListener('equipo', (ev) => {
    const d = ev.detail;
    const espera = d.modo !== 'asistencia';
    $('#hwLuz').className = 'equipo-tarjeta__luz ' + (espera ? 'luz--espera' : d.enLinea ? 'luz--linea' : 'luz--fuera');
    $('#hwEstado').textContent = espera ? 'Registrando' : d.enLinea ? 'En línea' : 'Sin conexión';
    $('#hwModo').textContent = d.modo === 'registro' ? 'Registro de huella' : d.modo === 'tarjeta' ? 'Asignar tarjeta' : 'Asistencia';
    const s = d.seg_conexion;
    $('#hwSenal').textContent = s == null ? 'Nunca' : s < 60 ? `Hace ${s} s` : s < 3600 ? `Hace ${Math.floor(s / 60)} min` : `Hace ${Math.floor(s / 3600)} h`;
  });
  window.Equipo.consultar();

  // ---------- Cifras ----------
  async function cifras() {
    try {
      const r = await fetch('/admin/api/hardware', { cache: 'no-store' });
      const c = await r.json();
      $('#hwHuellas').textContent = c.huellas;
      $('#hwTarjetas').textContent = c.tarjetas;
      $('#hwPases').textContent = c.pases_hoy;
      $('#hwFotos').textContent = c.fotos;
    } catch (e) { /* se queda con "—" */ }
  }
  cifras();
  document.addEventListener('pase', () => setTimeout(cifras, 2500));

  // ---------- Diagrama: resaltar los cables de un componente ----------
  const diagrama = $('#diagrama');
  function resaltar(mod) {
    diagrama.classList.toggle('enfocado', !!mod);
    diagrama.querySelectorAll('[data-mod]').forEach((g) => {
      const suyos = g.dataset.mod.split(' ');
      // El ESP32 está conectado a todo: al enfocarlo se ve todo
      const activo = mod && (mod === 'esp32' || suyos.includes(mod) || (g.dataset.mod === 'esp32'));
      g.classList.toggle('activo', !!activo);
    });
    document.querySelectorAll('.pieza').forEach((p) => p.classList.toggle('activa', p.dataset.mod === mod));
  }
  document.querySelectorAll('.pieza, #diagrama .modulo').forEach((el) => {
    el.addEventListener('mouseenter', () => resaltar(el.dataset.mod));
    el.addEventListener('mouseleave', () => resaltar(null));
    el.addEventListener('focus', () => resaltar(el.dataset.mod));
    el.addEventListener('blur', () => resaltar(null));
  });
  // Clic en un módulo del diagrama: baja hasta su ficha
  diagrama.querySelectorAll('.modulo').forEach((m) => m.addEventListener('click', () => {
    const ficha = document.querySelector(`.pieza[data-mod="${m.dataset.mod}"]`);
    if (ficha) { ficha.scrollIntoView({ behavior: 'smooth', block: 'center' }); ficha.focus({ preventScroll: true }); }
  }));
})();
