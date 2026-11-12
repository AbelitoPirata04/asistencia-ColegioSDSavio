// Vista: Asistencias (llegadas, salidas, retardos, quién no llegó, fotos y descargas)
(() => {
  const $ = (s) => document.querySelector(s);
  let datos = { registros: [], ausentes: [], activos: 0, hoy: '', desde: '', hasta: '' };
  let filtroEstado = '';
  let temporizador = null;

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siglas = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const hora = (f) => new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const diaCorto = (t) => mayus(new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }));
  const diaLargo = (t) => mayus(new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }));
  const duracion = (min) => min == null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
  const metodo = (m) => (m === 'huella' ? 'Huella' : m === 'manual' ? 'Manual' : 'Tarjeta');
  const horaCampo = (f) => (f ? hora(f) : '');   // "07:02" para los campos de hora de la ventana
  // "Manual" se resalta y al pasar el mouse muestra el motivo
  const etiquetaMetodo = (m, obs) => m === 'manual'
    ? `<small class="manual" title="${esc(obs || 'Registro manual')}">Manual</small>` : `<small>${metodo(m)}</small>`;
  const cargo = (p) => [p.rol === 'directivo' ? 'Directivo' : p.nivel, p.detalle].filter(Boolean).join(' · ');
  // La vista siempre muestra UN día; los periodos largos se eligen al descargar
  const unDia = () => true;

  // ---------- Día ----------
  function elegirDia(tipo) {
    const d = new Date();
    if (tipo === 'ayer') d.setDate(d.getDate() - 1);
    $('#dia').value = iso(d);
  }
  const marcarRapido = (tipo) =>
    document.querySelectorAll('#rapidos button').forEach((b) => b.classList.toggle('on', b.dataset.rango === tipo));

  // ---------- Datos ----------
  async function cargar() {
    clearTimeout(temporizador);
    try {
      const dia = $('#dia').value;
      const r = await fetch(`/admin/api/asistencias?desde=${dia}&hasta=${dia}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      datos = await r.json();
      pintar();
    } catch (e) {
      $('#filas').innerHTML = `<tr><td colspan="8" class="vacio">No se pudieron cargar los registros: ${esc(e.message)}</td></tr>`;
    }
    // Si se está viendo hoy, se refresca solo cada 15 s
    const vivo = datos.hoy && $('#dia').value === datos.hoy;
    $('#enVivo').hidden = !vivo;
    if (vivo) temporizador = setTimeout(cargar, 15000);
  }

  function pasaFiltros(p) {
    const q = $('#q').value.trim().toLowerCase();
    const nivel = $('#filtroNivel').value;
    if (nivel === 'directivos' && p.rol !== 'directivo') return false;
    if (nivel && nivel !== 'directivos' && String(p.id_nivel) !== nivel) return false;
    return !q || p.nombre_completo.toLowerCase().includes(q) || p.cedula.includes(q) ||
      (p.detalle || '').toLowerCase().includes(q);
  }

  // ---------- Pintar ----------
  function celdaSalida(r) {
    if (r.fecha_hora_salida) return `<strong class="num">${hora(r.fecha_hora_salida)}</strong>${etiquetaMetodo(r.metodo_salida, r.observacion)}`;
    return r.dia === datos.hoy
      ? '<span class="estado estado--dentro">En el colegio</span>'
      : '<span class="estado estado--sin-salida">Sin salida</span>';
  }

  const miniatura = (ruta, texto) => ruta
    ? `<img src="${esc(ruta)}" alt="${texto}" loading="lazy">`
    : `<span class="foto-vacia" title="${texto}: sin foto"></span>`;

  const filaRegistro = (r) => `
    <tr class="fila-clic" data-persona="${r.id_personal}" title="Ver el historial de ${esc(r.nombre_completo)}">
      <td><div class="miembro"><span class="sigla">${esc(siglas(r.nombre_completo))}</span>
        <div><a class="miembro__nombre" href="/asistencias/persona/${r.id_personal}?dia=${datos.desde}">${esc(r.nombre_completo)}</a>
        <small>${esc(cargo(r))}</small></div></div></td>
      <td class="col-fecha">${diaCorto(r.dia)}</td>
      <td><strong class="num">${hora(r.fecha_hora_entrada)}</strong>${etiquetaMetodo(r.metodo_ingreso, r.observacion)}</td>
      <td>${celdaSalida(r)}</td>
      <td class="num">${duracion(r.minutos)}</td>
      <td><span class="estado ${r.estado_puntualidad === 'puntual' ? 'estado--activo' : 'estado--retardo'}">${r.estado_puntualidad === 'puntual' ? 'Puntual' : 'Retardo'}</span></td>
      <td><button type="button" class="fotos" data-ver="${r.id_asistencia}" aria-label="Ver fotos de ${esc(r.nombre_completo)}">
        ${miniatura(r.ruta_fotografia, 'Llegada')}${miniatura(r.ruta_foto_salida, 'Salida')}</button></td>
      <td class="acciones">
        <button type="button" class="btn btn--chico borrar" data-corregir="${r.id_asistencia}">Corregir</button>
        <button type="button" class="btn btn--chico btn--peligro borrar" data-borrar="${r.id_asistencia}">Borrar</button></td>
    </tr>`;

  function pintar() {
    const lista = datos.registros.filter(pasaFiltros).filter((r) =>
      !filtroEstado || (filtroEstado === 'sin_salida' ? !r.fecha_hora_salida : r.estado_puntualidad === filtroEstado));
    $('#tabla').classList.toggle('tabla--un-dia', unDia());

    let vacio = 'No hay registros con esos filtros en este periodo.';
    if (!datos.registros.length) vacio = unDia() && datos.desde === datos.hoy
      ? 'Todavía no ha llegado nadie hoy.' : 'No hay registros en este periodo.';
    $('#filas').innerHTML = lista.length ? lista.map(filaRegistro).join('')
      : `<tr><td colspan="8" class="vacio">${vacio}</td></tr>`;
    $('#cuenta').textContent = `${lista.length} registro${lista.length === 1 ? '' : 's'}`;

    pintarAusentes();
    pintarResumen();
  }

  function pintarAusentes() {
    // Día sin clase: aviso en lugar de la lista de ausentes
    const sc = datos.diaSinClase;
    $('#sinClase').hidden = !sc;
    if (sc) $('#sinClase').innerHTML = `<strong>Día sin clase · ${esc(sc.tipo_texto)}</strong><span>${esc(sc.motivo)}. Nadie cuenta como ausente este día.</span>`;

    const aus = datos.ausentes.filter(pasaFiltros);
    const sinPermiso = aus.filter((p) => !p.novedad);
    const conPermiso = aus.filter((p) => p.novedad);
    $('#cajaAusentes').hidden = !datos.ausentes.length;
    $('#tituloAusentes').innerHTML = `${datos.desde === datos.hoy ? 'No han llegado' : 'No llegaron'} <b>${sinPermiso.length}</b>` +
      (conPermiso.length ? ` <span class="titulo-extra">· ${conPermiso.length} con permiso</span>` : '');
    const tarjeta = (p) => `
      <div class="ausente${p.novedad ? ' ausente--justificado' : ''}">
        <a class="ausente__persona" href="/asistencias/persona/${p.id_personal}?dia=${datos.desde}">
          <span class="sigla">${esc(siglas(p.nombre_completo))}</span>
          <span><strong>${esc(p.nombre_completo)}</strong><small>${esc(cargo(p))}</small></span>
        </a>
        ${p.novedad
          ? `<span class="tipo-novedad tipo-novedad--${p.novedad.tipo}" title="${esc(p.novedad.observacion || '')}">${esc(p.novedad.tipo_texto)}</span>`
          : `<div class="ausente__acciones">
               <button type="button" class="btn btn--chico" data-manual="${p.id_personal}">Registro manual</button>
               <button type="button" class="btn btn--chico" data-justificar="${p.id_personal}">Justificar</button>
             </div>`}
      </div>`;
    $('#ausentes').innerHTML = aus.length ? sinPermiso.concat(conPermiso).map(tarjeta).join('')
      : '<p class="ayuda">Nadie con esos filtros.</p>';
  }

  function pintarResumen() {
    const r = datos.registros;
    const retardos = r.filter((x) => x.estado_puntualidad === 'retardo').length;
    const sinSalida = r.filter((x) => !x.fecha_hora_salida && x.dia !== datos.hoy).length;
    const dentro = r.filter((x) => !x.fecha_hora_salida && x.dia === datos.hoy).length;
    const celda = (valor, texto, cls = '') => `<div class="franja__dato ${cls}"><b>${valor}</b><span>${texto}</span></div>`;
    let html = `<div class="franja__titulo"><span>${unDia() ? 'Día' : 'Periodo'}</span>
      <strong>${unDia() ? diaLargo(datos.desde) : `${diaCorto(datos.desde)} — ${diaCorto(datos.hasta)}`}</strong></div>`;
    if (datos.diaSinClase) {
      html += celda(new Set(r.map((x) => x.id_personal)).size, 'vinieron (día sin clase)');
      html += celda('—', esc(datos.diaSinClase.tipo_texto));
    } else if (unDia()) {
      const llegaron = new Set(r.map((x) => x.id_personal)).size;
      const sinPermiso = datos.ausentes.filter((a) => !a.novedad).length;
      const conPermiso = datos.ausentes.length - sinPermiso;
      html += celda(`${llegaron}<small> de ${datos.activos}</small>`, 'llegaron');
      html += celda(sinPermiso, (datos.desde === datos.hoy ? 'no han llegado' : 'no llegaron') +
        (conPermiso ? ` · ${conPermiso} con permiso` : ''), sinPermiso ? 'franja__dato--rojo' : '');
    } else {
      html += celda(r.length, 'registros');
      html += celda(new Set(r.map((x) => x.id_personal)).size, 'personas');
    }
    html += celda(retardos, retardos === 1 ? 'retardo' : 'retardos', retardos ? 'franja__dato--ambar' : '');
    html += dentro
      ? celda(dentro, 'en el colegio ahora')
      : celda(sinSalida, 'sin marcar salida', sinSalida ? 'franja__dato--ambar' : '');
    $('#resumen').innerHTML = html;
  }

  // ---------- Visor de fotos ----------
  function verFotos(id) {
    const r = datos.registros.find((x) => String(x.id_asistencia) === String(id));
    if (!r) return;
    const foto = (ruta, titulo, f, m) => `
      <figure>
        ${ruta ? `<a href="${esc(ruta)}" target="_blank" rel="noopener"><img src="${esc(ruta)}" alt="Foto de ${titulo.toLowerCase()}"></a>`
               : '<div class="visor__vacia">Sin foto</div>'}
        <figcaption><b>${titulo}</b> ${f ? `${hora(f)} · ${metodo(m)}` : 'sin registrar'}</figcaption>
      </figure>`;
    $('#visorNombre').textContent = r.nombre_completo + (r.observacion ? ` — ${r.observacion}` : '');
    $('#visorFecha').textContent = `${diaLargo(r.dia)} · ${cargo(r)}`;
    $('#visorFotos').innerHTML =
      foto(r.ruta_fotografia, 'Llegada', r.fecha_hora_entrada, r.metodo_ingreso) +
      foto(r.ruta_foto_salida, 'Salida', r.fecha_hora_salida, r.metodo_salida);
    $('#visor').showModal();
  }
  $('#visorCerrar').addEventListener('click', () => $('#visor').close());
  $('#visor').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // ---------- Borrar un registro ----------
  function avisar(texto, error) {
    const el = $('#avisoAsis');
    el.textContent = texto;
    el.className = 'aviso aviso--flotante ' + (error ? 'aviso--error' : 'aviso--ok');
    el.hidden = false;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  async function borrarRegistro(id, boton) {
    const r = datos.registros.find((x) => String(x.id_asistencia) === String(id));
    if (!r) return;
    const salida = r.fecha_hora_salida ? ` y salida ${hora(r.fecha_hora_salida)}` : '';
    const ok = await window.Confirmar({
      titulo: '¿Borrar este registro?',
      mensaje: `Se borra la llegada ${hora(r.fecha_hora_entrada)}${salida} de ${r.nombre_completo} (${diaCorto(r.dia)}), junto con sus fotos. No se puede deshacer.`,
      aceptar: 'Sí, borrar registro', peligro: true
    });
    if (!ok) return;
    boton.disabled = true;
    try {
      const res = await fetch(`/admin/api/asistencias/${id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.mensaje || 'No se pudo borrar.');
      avisar('Registro borrado.');
      await cargar();
    } catch (err) {
      avisar(err.message, true);
      boton.disabled = false;
    }
  }

  // ---------- Eventos ----------
  $('#rapidos').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    elegirDia(b.dataset.rango);
    marcarRapido(b.dataset.rango);
    cargar();
  });
  $('#dia').addEventListener('change', () => {
    if (!$('#dia').value) return;
    const hoy = iso(new Date());
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    marcarRapido($('#dia').value === hoy ? 'hoy' : $('#dia').value === iso(ayer) ? 'ayer' : '');
    cargar();
  });
  $('#q').addEventListener('input', pintar);
  $('#filtroNivel').addEventListener('change', pintar);
  $('#filtroEstado').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filtroEstado = b.dataset.estado;
    document.querySelectorAll('#filtroEstado button').forEach((x) => x.classList.toggle('on', x === b));
    pintar();
  });
  $('#filas').addEventListener('click', (e) => {
    const ver = e.target.closest('[data-ver]');
    if (ver) { verFotos(ver.dataset.ver); return; }
    const borrar = e.target.closest('[data-borrar]');
    if (borrar) { borrarRegistro(borrar.dataset.borrar, borrar); return; }
    const corregir = e.target.closest('[data-corregir]');
    if (corregir) {
      const r = datos.registros.find((x) => String(x.id_asistencia) === corregir.dataset.corregir);
      window.VentanaRegistro.abrir({
        id_asistencia: r.id_asistencia, id_personal: r.id_personal, nombre: r.nombre_completo, dia: r.dia,
        entrada: horaCampo(r.fecha_hora_entrada), salida: horaCampo(r.fecha_hora_salida), observacion: r.observacion
      }).then((ok) => { if (ok) { avisar('Registro corregido.'); cargar(); } });
      return;
    }
    if (e.target.closest('a')) return;                       // el nombre ya es un enlace
    // Clic en cualquier otra parte de la fila: abre el historial de esa persona
    const fila = e.target.closest('tr[data-persona]');
    if (fila) location.href = `/asistencias/persona/${fila.dataset.persona}?dia=${datos.desde}`;
  });

  // Un pase nuevo en el equipo: si se está viendo hoy, la tabla se actualiza al instante
  document.addEventListener('pase', () => {
    if (datos.hoy && $('#dia').value === datos.hoy) { cargar(); setTimeout(cargar, 3000); }
  });

  // ---------- Registro manual y justificar desde "No llegaron" ----------
  $('#btnManual').addEventListener('click', async () => {
    if (await window.VentanaRegistro.abrir({ dia: $('#dia').value })) { avisar('Registro manual guardado.'); cargar(); }
  });
  $('#ausentes').addEventListener('click', async (e) => {
    const m = e.target.closest('[data-manual]');
    const j = e.target.closest('[data-justificar]');
    if (!m && !j) return;
    const p = datos.ausentes.find((x) => String(x.id_personal) === (m || j).dataset[m ? 'manual' : 'justificar']);
    const base = { id_personal: p.id_personal, nombre: p.nombre_completo, dia: datos.desde };
    const ok = m
      ? await window.VentanaRegistro.abrir(base)
      : await window.VentanaNovedad.abrir({ ...base, desde: datos.desde, hasta: datos.desde });
    if (ok) { avisar(m ? 'Registro manual guardado.' : 'Ausencia justificada.'); cargar(); }
  });

  // ---------- Descargar PDF / Excel: aquí se elige el periodo ----------
  let formatoDescarga = 'pdf';
  const inicioSemana = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };   // lunes
  const periodosDescarga = () => {
    const hoy = new Date();
    return {
      dia: [$('#dia').value, $('#dia').value],
      semana: [iso(inicioSemana()), iso(hoy)],
      mes: [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)],
      rango: [$('#rDesde').value, $('#rHasta').value]
    };
  };

  function textoFiltrosActivos() {
    const partes = [];
    const nivel = $('#filtroNivel');
    if (nivel.value) partes.push(nivel.selectedOptions[0].textContent);
    if (filtroEstado) partes.push(document.querySelector(`#filtroEstado [data-estado="${filtroEstado}"]`).textContent);
    if ($('#q').value.trim()) partes.push(`"${$('#q').value.trim()}"`);
    return partes.join(' · ');
  }

  function abrirDescarga(formato) {
    formatoDescarga = formato;
    const p = periodosDescarga();
    $('#descargaTitulo').textContent = formato === 'pdf' ? 'Descargar PDF' : 'Descargar Excel';
    $('#btnBajar').textContent = formato === 'pdf' ? 'Descargar PDF' : 'Descargar Excel';
    $('#txtDia').textContent = diaLargo($('#dia').value);
    $('#txtSemana').textContent = `${diaCorto(p.semana[0])} a ${diaCorto(p.semana[1])}`;
    $('#txtMes').textContent = `${diaCorto(p.mes[0])} a ${diaCorto(p.mes[1])}`;
    if (!$('#rDesde').value) { $('#rDesde').value = p.mes[0]; $('#rHasta').value = p.mes[1]; }
    const filtros = textoFiltrosActivos();
    $('#usarFiltros').hidden = !filtros;
    $('#txtFiltros').textContent = filtros;
    $('#errDescarga').hidden = true;
    $('#dlgDescarga').showModal();
  }

  document.querySelectorAll('[data-descargar]').forEach((b) =>
    b.addEventListener('click', () => abrirDescarga(b.dataset.descargar)));
  $('#formDescarga').addEventListener('change', () => {
    $('#rangoFechas').hidden = $('#formDescarga').elements.periodo.value !== 'rango';
  });
  $('#dlgDescarga').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  $('#btnBajar').addEventListener('click', () => {
    const elegido = $('#formDescarga').elements.periodo.value;
    const [desde, hasta] = periodosDescarga()[elegido];
    if (!desde || !hasta) { $('#errDescarga').textContent = 'Elija las dos fechas.'; $('#errDescarga').hidden = false; return; }
    if (hasta < desde) { $('#errDescarga').textContent = 'La fecha "hasta" no puede ser antes de "desde".'; $('#errDescarga').hidden = false; return; }
    const p = new URLSearchParams({ desde, hasta });
    if (!$('#usarFiltros').hidden && $('#chkFiltros').checked) {
      p.set('q', $('#q').value.trim());
      p.set('nivel', $('#filtroNivel').value);
      p.set('estado', filtroEstado);
    }
    // Un enlace temporal dispara la descarga sin salir de la página
    const a = document.createElement('a');
    a.href = `/admin/reportes/asistencia.${formatoDescarga}?${p}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    $('#dlgDescarga').close();
    avisar(formatoDescarga === 'pdf' ? 'Generando el PDF…' : 'Generando el Excel…');
  });

  // ---------- Inicio: se puede abrir en un día: /asistencias?dia=2026-11-10 o ?rango=ayer ----------
  const url = new URLSearchParams(location.search);
  if (/^\d{4}-\d{2}-\d{2}$/.test(url.get('dia') || '')) {
    $('#dia').value = url.get('dia');
    $('#dia').dispatchEvent(new Event('change'));
  } else {
    const inicial = url.get('rango') === 'ayer' ? 'ayer' : 'hoy';
    elegirDia(inicial);
    marcarRapido(inicial);
    cargar();
  }
})();
