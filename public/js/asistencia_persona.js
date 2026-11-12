// Vista: historial de asistencia de UNA persona, mes por mes y día por día
(() => {
  const $ = (s) => document.querySelector(s);
  const raiz = $('#historial');
  const ID = raiz.dataset.id;
  let mes = raiz.dataset.mes;          // "AAAA-MM"
  let datos = null;

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fecha = (t) => new Date(t + 'T12:00:00');
  const hora = (f) => new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  const duracion = (min) => min == null ? '—' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
  const metodo = (m) => (m === 'huella' ? 'Huella' : m === 'manual' ? 'Manual' : 'Tarjeta');
  const etiquetaMetodo = (m, obs) => m === 'manual'
    ? `<small class="manual" title="${esc(obs || 'Registro manual')}">Manual</small>` : `<small>${metodo(m)}</small>`;
  const nombre = () => document.querySelector('.miembro--grande strong').textContent;
  const nombreMes = (m) => mayus(fecha(m + '-01').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }));
  const diaSemana = (t) => mayus(fecha(t).toLocaleDateString('es-CO', { weekday: 'long' }));
  const diaMes = (t) => fecha(t).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });

  function moverMes(delta) {
    const [a, m] = mes.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    cargar();
  }

  async function cargar() {
    $('#mesTitulo').textContent = nombreMes(mes);
    try {
      const r = await fetch(`/admin/api/asistencias/persona/${ID}?mes=${mes}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      datos = await r.json();
      pintar();
    } catch (e) {
      $('#dias').innerHTML = `<p class="vacio">No se pudo cargar el historial: ${esc(e.message)}</p>`;
    }
  }

  // Cada día del mes con su estado
  function construirDias() {
    const [a, m] = mes.split('-').map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    const porDia = {};
    datos.registros.forEach((r) => { if (!porDia[r.dia]) porDia[r.dia] = r; });   // el primero del día
    const dias = [];
    for (let n = 1; n <= ultimo; n++) {
      const t = iso(new Date(a, m - 1, n));
      const sem = fecha(t).getDay();
      const finde = sem === 0 || sem === 6;
      const reg = porDia[t];
      const sinClase = datos.sinClase.find((s) => s.desde <= t && s.hasta >= t) || null;
      const novedad = datos.novedades.find((x) => x.desde <= t && x.hasta >= t) || null;
      let estado;
      if (reg) estado = reg.estado_puntualidad;                  // puntual | retardo
      else if (finde) estado = 'finde';
      else if (sinClase) estado = 'sinclase';                     // festivo, vacaciones...
      else if (novedad) estado = 'justificado';                   // permiso, incapacidad...
      else if (t > datos.hoy) estado = 'futuro';
      else if (t < datos.cuentaDesde) estado = 'antes';           // aún no estaba en el sistema
      else if (t === datos.hoy) estado = 'pendiente';             // hoy, todavía no llega
      else estado = 'falta';
      dias.push({ t, n, sem, finde, reg, estado, sinClase, novedad });
    }
    return dias;
  }

  function pintar() {
    const dias = construirDias();
    $('#mesSiguiente').disabled = mes >= datos.hoy.slice(0, 7);
    pintarResumen(dias);
    pintarCalendario(dias);
    pintarLista(dias);

    // PDF del mes (hasta hoy si es el mes actual)
    const fin = dias[dias.length - 1].t < datos.hoy ? dias[dias.length - 1].t : datos.hoy;
    const p = new URLSearchParams({ desde: mes + '-01', hasta: fin < mes + '-01' ? mes + '-01' : fin, persona: ID });
    $('#btnPdfMes').href = '/admin/reportes/asistencia.pdf?' + p;
  }

  function pintarResumen(dias) {
    const contados = dias.filter((d) => ['puntual', 'retardo', 'falta', 'justificado'].includes(d.estado) && d.t <= datos.hoy);
    const asistio = dias.filter((d) => d.reg).length;
    const faltas = dias.filter((d) => d.estado === 'falta').length;
    const justificadas = dias.filter((d) => d.estado === 'justificado' && d.t <= datos.hoy).length;
    const retardos = dias.filter((d) => d.estado === 'retardo').length;
    const llegadas = dias.filter((d) => d.reg).map((d) => { const f = new Date(d.reg.fecha_hora_entrada); return f.getHours() * 60 + f.getMinutes(); });
    const prom = llegadas.length ? Math.round(llegadas.reduce((s, x) => s + x, 0) / llegadas.length) : null;
    const celda = (v, t, cls = '') => `<div class="franja__dato ${cls}"><b>${v}</b><span>${t}</span></div>`;
    $('#resumenMes').innerHTML =
      `<div class="franja__titulo"><span>Mes</span><strong>${nombreMes(mes)}</strong></div>` +
      celda(`${asistio}<small> de ${contados.length}</small>`, 'días asistió') +
      celda(faltas, (faltas === 1 ? 'falta' : 'faltas') + (justificadas ? ` · ${justificadas} justificada${justificadas === 1 ? '' : 's'}` : ''),
        faltas ? 'franja__dato--rojo' : '') +
      celda(retardos, retardos === 1 ? 'retardo' : 'retardos', retardos ? 'franja__dato--ambar' : '') +
      celda(prom == null ? '—' : `${String(Math.floor(prom / 60)).padStart(2, '0')}:${String(prom % 60).padStart(2, '0')}`, 'llegada promedio');
  }

  function pintarCalendario(dias) {
    const vacios = (dias[0].sem + 6) % 7;        // la semana empieza el lunes
    const etiqueta = { puntual: 'Puntual', retardo: 'Retardo', falta: 'No asistió', pendiente: 'Aún no llega', finde: 'Fin de semana',
      futuro: '', antes: 'Aún no estaba registrado', justificado: 'Justificado', sinclase: 'Sin clase' };
    $('#calendario').innerHTML = '<span></span>'.repeat(vacios) + dias.map((d) => {
      const clic = d.reg || ['falta', 'pendiente', 'justificado', 'sinclase'].includes(d.estado) && d.t <= datos.hoy;
      const cls = `dia dia--${d.estado}${d.t === datos.hoy ? ' dia--hoy' : ''}`;
      return clic
        ? `<button type="button" class="${cls}" data-ir="${d.t}" title="${diaMes(d.t)}: ${etiqueta[d.estado]}">${d.n}</button>`
        : `<span class="${cls}" title="${etiqueta[d.estado] ? diaMes(d.t) + ': ' + etiqueta[d.estado] : ''}">${d.n}</span>`;
    }).join('');
  }

  const miniatura = (ruta, texto) => ruta
    ? `<img src="${esc(ruta)}" alt="${texto}" loading="lazy">`
    : `<span class="foto-vacia" title="${texto}: sin foto"></span>`;

  function filaDia(d) {
    const cabeza = `<div class="dia-fila__fecha"><b>${d.n}</b><span>${diaSemana(d.t)}</span></div>`;
    if (!d.reg) {
      let txt = '';
      let botones = '';
      if (d.estado === 'sinclase') {
        txt = `<span class="tipo-dia tipo-dia--${d.sinClase.tipo}">${esc(d.sinClase.tipo_texto)}</span><span class="dia-fila__nota">${esc(d.sinClase.motivo)}</span>`;
      } else if (d.estado === 'justificado') {
        txt = `<span class="tipo-novedad tipo-novedad--${d.novedad.tipo}">Justificado · ${esc(d.novedad.tipo_texto)}</span>` +
          (d.novedad.observacion ? `<span class="dia-fila__nota">${esc(d.novedad.observacion)}</span>` : '');
      } else {
        txt = d.estado === 'pendiente' ? '<span class="estado estado--dentro">Aún no ha llegado</span>'
          : '<span class="estado estado--baja">No asistió</span>';
        botones = `<div class="dia-fila__acciones">
            <button type="button" class="btn btn--chico" data-manual="${d.t}">Registro manual</button>
            ${d.estado === 'falta' ? `<button type="button" class="btn btn--chico" data-justificar="${d.t}">Justificar</button>` : ''}
          </div>`;
      }
      return `<article class="dia-fila dia-fila--${d.estado}" id="d-${d.t}">${cabeza}<div class="dia-fila__nada">${txt}</div>${botones}</article>`;
    }
    const r = d.reg;
    const salida = r.fecha_hora_salida
      ? `<strong class="num">${hora(r.fecha_hora_salida)}</strong>${etiquetaMetodo(r.metodo_salida, r.observacion)}`
      : (d.t === datos.hoy ? '<span class="estado estado--dentro">En el colegio</span>'
        : `<span class="estado estado--sin-salida">Sin salida</span><button type="button" class="enlace-chico" data-corregir="${r.id_asistencia}">Agregar salida</button>`);
    return `
      <article class="dia-fila" id="d-${d.t}">
        ${cabeza}
        <div><span class="dia-fila__rotulo">Llegada</span><strong class="num">${hora(r.fecha_hora_entrada)}</strong>${etiquetaMetodo(r.metodo_ingreso, r.observacion)}</div>
        <div><span class="dia-fila__rotulo">Salida</span>${salida}</div>
        <div><span class="dia-fila__rotulo">Tiempo</span><span class="num">${duracion(r.minutos)}</span></div>
        <div><span class="estado ${r.estado_puntualidad === 'puntual' ? 'estado--activo' : 'estado--retardo'}">${r.estado_puntualidad === 'puntual' ? 'Puntual' : 'Retardo'}</span></div>
        <div class="dia-fila__fotos"><button type="button" class="fotos" data-ver="${r.id_asistencia}" aria-label="Ver fotos del ${diaMes(d.t)}">
          ${miniatura(r.ruta_fotografia, 'Llegada')}${miniatura(r.ruta_foto_salida, 'Salida')}</button>
          <button type="button" class="btn btn--chico dia-fila__corregir" data-corregir="${r.id_asistencia}">Corregir</button></div>
        ${r.observacion ? `<p class="dia-fila__obs"><b>Nota:</b> ${esc(r.observacion)}</p>` : ''}
      </article>`;
  }

  // Lista agrupada por semanas (lunes a viernes), en orden: 1, 2, 3...
  function pintarLista(dias) {
    const visibles = dias.filter((d) => d.reg || ['falta', 'pendiente', 'justificado', 'sinclase'].includes(d.estado));
    if (!visibles.length) {
      $('#dias').innerHTML = `<p class="vacio">${mes > datos.hoy.slice(0, 7) ? 'Este mes todavía no empieza.' : 'No hay registros en este mes.'}</p>`;
      return;
    }
    const semanas = [];
    visibles.forEach((d) => {
      const lunes = new Date(fecha(d.t)); lunes.setDate(lunes.getDate() - ((d.sem + 6) % 7));
      const clave = iso(lunes);
      let s = semanas.find((x) => x.clave === clave);
      if (!s) { s = { clave, dias: [] }; semanas.push(s); }
      s.dias.push(d);
    });
    $('#dias').innerHTML = semanas.map((s) => {
      const a = s.dias[0].t, b = s.dias[s.dias.length - 1].t;
      const titulo = a === b ? diaMes(a) : `${fecha(a).getDate()} al ${diaMes(b)}`;
      const asistio = s.dias.filter((d) => d.reg).length;
      const debia = s.dias.filter((d) => d.reg || ['falta', 'pendiente'].includes(d.estado)).length;
      return `<div class="semana">
        <h3 class="semana__titulo">Semana del ${titulo}<span>${debia ? `${asistio} de ${debia} día${debia === 1 ? '' : 's'}` : 'Sin días de clase'}</span></h3>
        ${s.dias.map(filaDia).join('')}
      </div>`;
    }).join('');
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
    $('#visorNombre').textContent = document.querySelector('.miembro--grande strong').textContent;
    $('#visorFecha').textContent = `${diaSemana(r.dia)}, ${diaMes(r.dia)}`;
    $('#visorFotos').innerHTML = foto(r.ruta_fotografia, 'Llegada', r.fecha_hora_entrada, r.metodo_ingreso) +
      foto(r.ruta_foto_salida, 'Salida', r.fecha_hora_salida, r.metodo_salida);
    $('#visor').showModal();
  }
  $('#visorCerrar').addEventListener('click', () => $('#visor').close());
  $('#visor').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // ---------- Eventos ----------
  $('#btnNovedad').addEventListener('click', async () => {
    if (await window.VentanaNovedad.abrir({ id_personal: ID, nombre: nombre() })) cargar();
  });
  $('#mesAnterior').addEventListener('click', () => moverMes(-1));
  $('#mesSiguiente').addEventListener('click', () => moverMes(1));
  const horaCampo = (f) => (f ? hora(f) : '');
  $('#dias').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ver]');
    if (b) { verFotos(b.dataset.ver); return; }
    const base = { id_personal: ID, nombre: nombre() };
    let ok = false;
    const corregir = e.target.closest('[data-corregir]');
    const manual = e.target.closest('[data-manual]');
    const justificar = e.target.closest('[data-justificar]');
    if (corregir) {
      const r = datos.registros.find((x) => String(x.id_asistencia) === corregir.dataset.corregir);
      ok = await window.VentanaRegistro.abrir({ ...base, id_asistencia: r.id_asistencia, dia: r.dia,
        entrada: horaCampo(r.fecha_hora_entrada), salida: horaCampo(r.fecha_hora_salida), observacion: r.observacion });
    } else if (manual) {
      ok = await window.VentanaRegistro.abrir({ ...base, dia: manual.dataset.manual });
    } else if (justificar) {
      ok = await window.VentanaNovedad.abrir({ ...base, desde: justificar.dataset.justificar, hasta: justificar.dataset.justificar });
    } else return;
    if (ok) cargar();
  });
  // Clic en un día del calendario: baja hasta ese día y lo resalta
  $('#calendario').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]'); if (!b) return;
    const fila = document.getElementById('d-' + b.dataset.ir);
    if (!fila) return;
    fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fila.classList.remove('dia-fila--resaltar');
    void fila.offsetWidth;
    fila.classList.add('dia-fila--resaltar');
  });

  cargar();
})();
