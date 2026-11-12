// Vista: Novedades (permisos / ausencias justificadas) y días sin clase
(() => {
  const $ = (s) => document.querySelector(s);
  let datos = { novedades: [], dias: [], hoy: '' };
  let ver = 'actuales';

  const TIPOS = { incapacidad: 'Incapacidad', permiso: 'Permiso', calamidad: 'Calamidad', licencia: 'Licencia', comision: 'Comisión', otro: 'Otro' };
  const TIPOS_DIA = { festivo: 'Festivo', vacaciones: 'Vacaciones', jornada: 'Jornada pedagógica', otro: 'Sin clase' };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siglas = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const corta = (t) => new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  const semana = (t) => mayus(new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long' }));
  const diaMes = (t) => new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });

  // Días hábiles (lunes a viernes) entre dos fechas
  function habiles(a, b) {
    let n = 0;
    const d = new Date(a + 'T12:00:00'), fin = new Date(b + 'T12:00:00');
    while (d <= fin) { if (d.getDay() % 6 !== 0) n++; d.setDate(d.getDate() + 1); }
    return n;
  }

  function avisar(texto, error) {
    const el = $('#avisoNov');
    el.textContent = texto;
    el.className = 'aviso aviso--flotante ' + (error ? 'aviso--error' : 'aviso--ok');
    el.hidden = false;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  async function cargar() {
    const r = await fetch('/admin/api/novedades', { cache: 'no-store' });
    datos = await r.json();
    pintarNovedades();
    pintarAnios();
    pintarDias();
  }

  // ---------- Novedades ----------
  function estadoNovedad(n) {
    if (n.hasta < datos.hoy) return ['Terminada', 'estado--gris'];
    if (n.desde > datos.hoy) return ['Próxima', 'estado--dentro'];
    return ['Vigente', 'estado--activo'];
  }

  function pintarNovedades() {
    const q = $('#qNov').value.trim().toLowerCase();
    const lista = datos.novedades.filter((n) =>
      (ver === 'todas' || (ver === 'pasadas' ? n.hasta < datos.hoy : n.hasta >= datos.hoy)) &&
      (!q || n.nombre_completo.toLowerCase().includes(q) || TIPOS[n.tipo].toLowerCase().includes(q)));
    if (ver === 'actuales') lista.sort((a, b) => a.desde.localeCompare(b.desde));
    $('#filasNov').innerHTML = lista.length ? lista.map((n) => {
      const [txt, cls] = estadoNovedad(n);
      const dias = habiles(n.desde, n.hasta);
      return `<tr>
        <td><div class="miembro">${n.foto_perfil ? `<img class="sigla sigla--foto" src="${esc(n.foto_perfil)}" alt="" loading="lazy">` : `<span class="sigla">${esc(siglas(n.nombre_completo))}</span>`}
          <div><a class="miembro__nombre" href="/asistencias/persona/${n.id_personal}?dia=${n.desde}">${esc(n.nombre_completo)}</a>
          <small>${n.rol === 'directivo' ? 'Directivo' : 'Docente'}</small></div></div></td>
        <td><span class="tipo-novedad tipo-novedad--${n.tipo}">${TIPOS[n.tipo]}</span></td>
        <td><strong>${n.desde === n.hasta ? corta(n.desde) : `${corta(n.desde)} – ${corta(n.hasta)}`}</strong>
          <small>${dias} día${dias === 1 ? '' : 's'} hábil${dias === 1 ? '' : 'es'}</small></td>
        <td class="celda-texto">${esc(n.observacion || '—')}</td>
        <td><span class="estado ${cls}">${txt}</span></td>
        <td class="acciones"><button type="button" class="btn btn--chico btn--peligro borrar" data-borrar-nov="${n.id_novedad}">Quitar</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="vacio">${ver === 'actuales' ? 'No hay permisos vigentes ni próximos.' : 'No hay novedades para mostrar.'}</td></tr>`;
  }

  // ---------- Días sin clase ----------
  function pintarAnios() {
    const actual = Number(datos.hoy.slice(0, 4));
    const anios = new Set([actual, actual + 1, ...datos.dias.map((d) => Number(d.desde.slice(0, 4)))]);
    const elegido = $('#anio').value || String(actual);
    $('#anio').innerHTML = [...anios].sort().map((a) => `<option ${String(a) === elegido ? 'selected' : ''}>${a}</option>`).join('');
    $('#btnFestivos').textContent = `Cargar festivos de Colombia ${$('#anio').value}`;
  }

  function pintarDias() {
    const anio = $('#anio').value;
    const lista = datos.dias.filter((d) => d.desde.startsWith(anio) || d.hasta.startsWith(anio));
    $('#listaDias').innerHTML = lista.length ? lista.map((d) => {
      const pasado = d.hasta < datos.hoy;
      const rango = d.desde === d.hasta
        ? `<b>${new Date(d.desde + 'T12:00:00').getDate()}</b><span>${semana(d.desde)}<small>${diaMes(d.desde)}</small></span>`
        : `<b>${habiles(d.desde, d.hasta)}</b><span>días hábiles<small>${diaMes(d.desde)} – ${diaMes(d.hasta)}</small></span>`;
      return `<div class="dia-sc${pasado ? ' dia-sc--pasado' : ''}">
        <div class="dia-sc__fecha">${rango}</div>
        <div class="dia-sc__motivo"><strong>${esc(d.motivo)}</strong><span class="tipo-dia tipo-dia--${d.tipo}">${TIPOS_DIA[d.tipo]}</span></div>
        <button type="button" class="btn btn--chico btn--peligro borrar" data-borrar-dia="${d.id_dia}">Quitar</button>
      </div>`;
    }).join('') : `<p class="vacio">No hay días sin clase en ${anio}. Puede cargar los festivos de Colombia con el botón de arriba.</p>`;
  }

  // ---------- Acciones ----------
  $('#btnNovedad').addEventListener('click', async () => {
    if (await window.VentanaNovedad.abrir()) { avisar('Novedad registrada.'); cargar(); }
  });
  $('#btnDia').addEventListener('click', async () => {
    if (await window.VentanaDiaSinClase.abrir()) { avisar('Día sin clase agregado.'); cargar(); }
  });
  $('#btnFestivos').addEventListener('click', async () => {
    const anio = $('#anio').value;
    const ok = await window.Confirmar({
      titulo: `¿Cargar los festivos de ${anio}?`,
      mensaje: 'Se agregan los 18 festivos de Colombia de ese año (los que ya estén no se repiten). Después puede quitar cualquiera.',
      aceptar: 'Sí, cargar festivos'
    });
    if (!ok) return;
    const r = await fetch('/admin/api/dias-sin-clase/festivos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anio })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(j.mensaje || 'No se pudieron cargar.', true);
    avisar(j.nuevos ? `Se agregaron ${j.nuevos} festivos de ${anio}.` : `Los festivos de ${anio} ya estaban cargados.`);
    cargar();
  });

  async function quitar(url, confirmar, ok) {
    if (!(await window.Confirmar(confirmar))) return;
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) return avisar('No se pudo quitar.', true);
    avisar(ok);
    cargar();
  }
  $('#filasNov').addEventListener('click', (e) => {
    const b = e.target.closest('[data-borrar-nov]'); if (!b) return;
    const n = datos.novedades.find((x) => String(x.id_novedad) === b.dataset.borrarNov);
    quitar(`/admin/api/novedades/${n.id_novedad}`, {
      titulo: '¿Quitar esta novedad?',
      mensaje: `${TIPOS[n.tipo]} de ${n.nombre_completo}. Los días que cubría volverán a contar como falta si no hay registro.`,
      aceptar: 'Sí, quitar', peligro: true
    }, 'Novedad quitada.');
  });
  $('#listaDias').addEventListener('click', (e) => {
    const b = e.target.closest('[data-borrar-dia]'); if (!b) return;
    const d = datos.dias.find((x) => String(x.id_dia) === b.dataset.borrarDia);
    quitar(`/admin/api/dias-sin-clase/${d.id_dia}`, {
      titulo: '¿Quitar este día sin clase?',
      mensaje: `"${d.motivo}". Ese día volverá a contar como día de clase.`,
      aceptar: 'Sí, quitar', peligro: true
    }, 'Día sin clase quitado.');
  });

  $('#filtroNov').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ver = b.dataset.ver;
    document.querySelectorAll('#filtroNov button').forEach((x) => x.classList.toggle('on', x === b));
    pintarNovedades();
  });
  $('#qNov').addEventListener('input', pintarNovedades);
  $('#anio').addEventListener('change', () => { pintarAnios(); pintarDias(); });

  cargar();
})();
