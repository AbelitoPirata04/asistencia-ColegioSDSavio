// Vista: ficha de un miembro (credenciales, registro en vivo con el equipo y últimos registros)
(() => {
  const $ = (s) => document.querySelector(s);
  const ID = $('#ficha').dataset.id;
  let m = null;          // datos del miembro + registros
  let proceso = null;    // { tipo: 'registro'|'tarjeta', idHuella, inicio, terminado }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const primerNombre = (n) => n.split(' ')[0];

  async function api(url, metodo, cuerpo) {
    const r = await fetch(url, {
      method: metodo || 'GET',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensaje || 'Ocurrió un error inesperado (' + r.status + ').');
    return j;
  }

  function aviso(texto, tipo) {
    const el = $('#fAviso');
    el.textContent = texto || '';
    el.className = 'aviso aviso--' + (tipo || 'ok');
    el.hidden = !texto;
  }

  async function recargar() {
    m = await api(`/admin/api/personal/${ID}`);
    pintar();
  }

  // Limpia ?nuevo=1 / ?guardado=1 de la barra de direcciones para que al recargar no se repita el aviso
  if (location.search) history.replaceState(null, '', location.pathname);

  // ======================= Pintar =======================
  function pintar() {
    const ocupado = !!proceso && !proceso.terminado;

    // Carnet y datos
    $('#carnet [data-k="tarjeta"]').textContent = m.codigo_tarjeta_rfid || 'sin asignar';
    $('#dEstado').innerHTML = m.activo
      ? '<span class="estado estado--activo">Activo</span>'
      : '<span class="estado estado--baja">Dado de baja</span>';
    $('#fEstado').textContent = m.activo ? 'Dar de baja' : 'Reactivar';
    $('#fEstado').classList.toggle('btn--peligro', !!m.activo);

    // Huella
    const tieneH = m.id_huella_sensor != null;
    $('#hMarca').className = 'marca' + (tieneH ? ' ok' : '');
    $('#hMarca').textContent = tieneH ? `ID ${m.id_huella_sensor} en el sensor` : 'Sin registrar';
    $('#hTexto').textContent = !m.activo
      ? 'Reactive al miembro para registrar credenciales.'
      : tieneH
        ? 'Índice derecho registrado. Si el equipo no lo reconoce bien, regístrelo de nuevo: se guarda en el mismo ID.'
        : `${primerNombre(m.nombre_completo)} debe estar junto al equipo. Se registra siempre el índice derecho: lo pondrá dos veces en el lector, retirándolo cuando la pantalla lo pida.`;
    $('#hEnrolar').textContent = tieneH ? 'Registrar de nuevo' : 'Registrar huella';
    $('#hQuitar').hidden = !tieneH;
    $('#hBotones').hidden = ocupado || !m.activo;

    // Tarjeta
    const tieneT = !!m.codigo_tarjeta_rfid;
    $('#tMarca').className = 'marca' + (tieneT ? (m.tarjeta_activa ? ' ok mono' : ' bloq mono') : '');
    $('#tMarca').textContent = tieneT ? m.codigo_tarjeta_rfid + (m.tarjeta_activa ? '' : ' · bloqueada') : 'Sin tarjeta';
    $('#tTexto').textContent = !m.activo
      ? 'Reactive al miembro para registrar credenciales.'
      : !tieneT
        ? 'Pulse “Leer con el lector” y pase la tarjeta por el equipo. Cada tarjeta trae de fábrica un código único; el sistema lo guarda y lo une a esta persona.'
        : m.tarjeta_activa
          ? 'Si la tarjeta se pierde, bloquéela para que nadie más marque con ella.'
          : 'Esta tarjeta está bloqueada: el equipo la rechazará hasta que la desbloquee.';
    $('#tLeer').textContent = tieneT ? 'Cambiar tarjeta' : 'Leer con el lector';
    $('#tBloquear').hidden = !tieneT;
    $('#tBloquear').textContent = m.tarjeta_activa ? 'Bloquear tarjeta' : 'Desbloquear tarjeta';
    $('#tQuitar').hidden = !tieneT;
    $('#tBotones').hidden = ocupado || !m.activo;

    // Registros
    const regs = m.registros || [];
    $('#fRegistros').innerHTML = regs.length ? regs.map((r) => {
      const f = new Date(r.fecha_hora_entrada);
      const hora = f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dia = f.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });
      return `<li>
        <span class="registros__hora num">${hora}</span>
        <span class="registros__dia">${esc(dia)}<small>${r.fecha_hora_salida
          ? 'Salida ' + new Date(r.fecha_hora_salida).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
          : 'Sin salida marcada'}</small></span>
        <span class="punt punt--${r.estado_puntualidad}">${r.estado_puntualidad === 'puntual' ? 'Puntual' : 'Retardo'}</span>
        ${r.ruta_fotografia
          ? `<a class="registros__foto" href="${esc(r.ruta_fotografia)}" target="_blank" rel="noopener"><img src="${esc(r.ruta_fotografia)}" alt="Foto del registro"></a>`
          : '<span class="registros__foto registros__foto--vacia">sin foto</span>'}
      </li>`;
    }).join('') : '<li class="registros__vacio">Todavía no tiene registros de asistencia.</li>';
  }

  // ======================= Acciones =======================
  async function accion(fn, okTexto) {
    try { await fn(); await recargar(); aviso(okTexto); }
    catch (err) { aviso(err.message, 'error'); }
  }

  $('#fEstado').addEventListener('click', async () => {
    const baja = !!m.activo;
    const ok = await window.Confirmar(baja ? {
      titulo: `¿Dar de baja a ${m.nombre_completo}?`,
      mensaje: 'Ya no podrá marcar asistencia con su huella ni con su tarjeta. Su historial de registros se conserva y puede reactivarlo cuando quiera.',
      aceptar: 'Sí, dar de baja', peligro: true
    } : {
      titulo: `¿Reactivar a ${m.nombre_completo}?`,
      mensaje: 'Podrá volver a marcar asistencia con la huella y la tarjeta que tenía asignadas.',
      aceptar: 'Sí, reactivar'
    });
    if (!ok) return;
    accion(() => api(`/admin/api/personal/${ID}/estado`, 'PATCH', { activo: !baja }),
      baja ? 'Miembro dado de baja.' : 'Miembro reactivado.');
  });

  $('#hQuitar').addEventListener('click', async () => {
    const ok = await window.Confirmar({
      titulo: '¿Quitar la huella?',
      mensaje: `${m.nombre_completo} ya no podrá marcar asistencia con el dedo hasta que se le registre de nuevo.`,
      aceptar: 'Sí, quitar huella', peligro: true
    });
    if (!ok) return;
    accion(() => api(`/admin/api/personal/${ID}/huella`, 'DELETE'), 'Huella quitada.');
  });

  $('#tBloquear').addEventListener('click', async () => {
    const activa = !m.tarjeta_activa;
    if (!activa) {
      const ok = await window.Confirmar({
        titulo: '¿Bloquear la tarjeta?',
        mensaje: `El equipo rechazará la tarjeta ${m.codigo_tarjeta_rfid}. Úselo si se perdió o se la robaron; puede desbloquearla después.`,
        aceptar: 'Sí, bloquear', peligro: true
      });
      if (!ok) return;
    }
    accion(() => api(`/admin/api/personal/${ID}/tarjeta/estado`, 'PATCH', { activa }),
      activa ? 'Tarjeta desbloqueada.' : 'Tarjeta bloqueada. El equipo la rechazará.');
  });

  $('#tQuitar').addEventListener('click', async () => {
    const ok = await window.Confirmar({
      titulo: '¿Quitar la tarjeta?',
      mensaje: `La tarjeta ${m.codigo_tarjeta_rfid} queda libre y ${m.nombre_completo} ya no podrá marcar con ella. Esa misma tarjeta se puede asignar luego a otra persona.`,
      aceptar: 'Sí, quitar tarjeta', peligro: true
    });
    if (!ok) return;
    accion(() => api(`/admin/api/personal/${ID}/tarjeta`, 'PUT', { codigo: '' }), 'Tarjeta quitada.');
  });

  // Foto de perfil desde el carnet: clic en "Agregar / Cambiar foto"
  $('#btnFotoCarnet').addEventListener('click', () => $('#archivoFoto').click());
  $('#archivoFoto').addEventListener('change', async (e) => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    const btn = $('#btnFotoCarnet');
    btn.textContent = 'Subiendo…';
    try {
      const ruta = await window.SubirFoto(ID, await window.PrepararFoto(archivo));
      const img = $('#carnet [data-k="foto"]');
      img.src = ruta; img.hidden = false;
      $('#carnet [data-k="sigla"]').hidden = true;
      aviso('Foto actualizada.');
    } catch (err) { aviso(err.message, 'error'); }
    btn.textContent = $('#carnet [data-k="foto"]').hidden ? 'Agregar foto' : 'Cambiar foto';
  });

  // Imprimir carnet (tamaño tarjeta CR80: 85,6 × 54 mm)
  $('#fImprimir').addEventListener('click', () => {
    const zona = document.createElement('div');
    zona.id = 'zonaImpresion';
    // La copia necesita sus propios nombres internos: si no, el degradado rojo apunta al carnet
    // de la página (que se oculta al imprimir) y el rojo no sale en el PDF.
    const copia = $('#carnet').cloneNode(true);
    copia.querySelectorAll('[id]').forEach((el) => { el.id += '-imp'; });
    copia.querySelectorAll('[fill^="url(#"]').forEach((el) => el.setAttribute('fill', el.getAttribute('fill').replace(')', '-imp)')));
    copia.querySelectorAll('.carnet__cambiar').forEach((b) => b.remove());
    zona.appendChild(copia);
    document.body.appendChild(zona);
    const limpiar = () => { zona.remove(); window.removeEventListener('afterprint', limpiar); };
    window.addEventListener('afterprint', limpiar);
    // Espera a que carguen todas las imágenes visibles (escudo, marca de agua y foto)
    const imgs = [...zona.querySelectorAll('img:not([hidden])')];
    Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; }))))
      .then(() => window.print());
  });

  // ======================= Registro en vivo con el equipo =======================
  const PASOS = {
    registro: ['Orden enviada al equipo', 'El equipo cambió a modo registro', 'Poner el índice derecho dos veces', 'Huella guardada'],
    tarjeta: ['Orden enviada al equipo', 'El equipo quedó esperando la tarjeta', 'Acercar la tarjeta al lector', 'Tarjeta asignada']
  };

  function lcd(l1, l2) {
    const celdas = (t) => {
      const s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').padEnd(16).slice(0, 16);
      return [...s].map((c) => `<span>${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    };
    $('#lcd').innerHTML = celdas(l1) + celdas(l2);
  }

  function pintarPasos(nivel, error) {
    $('#pasos').innerHTML = PASOS[proceso.tipo].map((t, i) => {
      const cls = i < nivel ? 'hecho' : i === nivel ? (error ? 'fallo' : 'actual') : '';
      return `<li class="${cls}">${esc(t)}</li>`;
    }).join('');
  }

  function horaLcd() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ASISTENCIA`;
  }

  async function iniciar(tipo) {
    if (proceso && !proceso.terminado) return;
    try {
      const url = tipo === 'registro' ? `/admin/api/personal/${ID}/huella` : `/admin/api/personal/${ID}/tarjeta/leer`;
      const r = await api(url, 'POST');
      proceso = { tipo, idHuella: r.id_huella, inicio: Date.now(), terminado: false };
    } catch (err) { aviso(err.message, 'error'); return; }

    aviso('');
    $(tipo === 'registro' ? '#ranuraHuella' : '#ranuraTarjeta').appendChild($('#proceso'));
    $('#proceso').hidden = false;
    $('#proceso').classList.remove('proceso--fin');
    $('#pCancelar').hidden = false;
    $('#pTiempo').textContent = '';
    pintarPasos(1);
    lcd(horaLcd(), 'Pase ID o Dedo..');
    pintar();
    window.Equipo.rapido(true);
  }

  $('#hEnrolar').addEventListener('click', () => iniciar('registro'));
  $('#tLeer').addEventListener('click', () => iniciar('tarjeta'));

  function enCurso(d) {
    const enterado = d.equipo_enterado;
    pintarPasos(enterado ? 2 : 1);
    if (!enterado) lcd(horaLcd(), 'Pase ID o Dedo..');
    else if (proceso.tipo === 'registro') lcd('REGISTRO ID:' + proceso.idHuella, 'Indice derecho');
    else lcd('MODO: TARJETA', 'Acerque tarjeta');
    const s = d.seg_restantes || 0;
    const tiempo = `Se cancela solo en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('#pTiempo').textContent = !d.enLinea && !enterado ? 'El equipo está sin conexión · ' + tiempo : tiempo;
    if (d.resultado && d.resultado_ok === false) aviso(d.resultado, 'alerta');   // tarjeta de otra persona
  }

  async function terminar(d) {
    proceso.terminado = true;
    window.Equipo.rapido(false);
    const ok = d.resultado_ok === true;
    const tipo = proceso.tipo;
    pintarPasos(ok ? 4 : 3, !ok);
    if (ok) lcd(tipo === 'registro' ? 'EXITO GUARDADO' : 'TARJETA LEIDA', tipo === 'registro' ? 'ID ASIGNADO: ' + proceso.idHuella : 'Asignada OK');
    else lcd('REGISTRO', 'CANCELADO');
    $('#pCancelar').hidden = true;
    $('#pTiempo').textContent = '';
    $('#proceso').classList.add('proceso--fin');
    try { await recargar(); } catch (e) { /* se ve al recargar la página */ }
    aviso(d.resultado || (ok ? 'Listo.' : 'El equipo volvió a modo asistencia sin completar el registro.'), ok ? 'ok' : 'error');
    setTimeout(() => {
      if (proceso && proceso.terminado) { $('#proceso').hidden = true; proceso = null; pintar(); }
    }, ok ? 2600 : 4000);
  }

  document.addEventListener('equipo', (ev) => {
    const d = ev.detail;
    if (!proceso || proceso.terminado || d._desde < proceso.inicio) return;
    const esMio = d.modo === proceso.tipo && String(d.id_personal) === String(ID);
    if (esMio) enCurso(d);
    else if (d.modo !== 'asistencia') terminar({ resultado: `Otro registro (${d.nombre || 'otra persona'}) reemplazó a este.`, resultado_ok: false });
    else terminar(d);
  });

  $('#pCancelar').addEventListener('click', async () => {
    $('#pCancelar').disabled = true;
    try { await api('/admin/api/dispositivo/registro', 'DELETE'); } catch (e) { /* el siguiente sondeo lo resuelve */ }
    $('#pCancelar').disabled = false;
    window.Equipo.consultar();
  });

  // Si sale de la página a mitad de un registro, el equipo vuelve a modo asistencia
  window.addEventListener('pagehide', () => {
    if (proceso && !proceso.terminado) fetch('/admin/api/dispositivo/registro', { method: 'DELETE', keepalive: true });
  });

  recargar().catch((e) => aviso(e.message, 'error'));
})();
