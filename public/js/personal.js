// Vista: lista de Docentes y Directivos
(() => {
  const $ = (s) => document.querySelector(s);
  let datos = [];
  let filtroRol = '';
  let filtroCred = '';      // '' | 'huella' | 'tarjeta'  (miembros a los que les falta)

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siglas = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  async function cargar() {
    try {
      const r = await fetch('/admin/api/personal');
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      datos = await r.json();
      pintar();
    } catch (e) {
      $('#filas').innerHTML = `<tr><td colspan="8" class="vacio">No se pudo cargar la lista: ${esc(e.message)}</td></tr>`;
    }
  }

  const huella = (p) => p.id_huella_sensor != null
    ? `<span class="marca ok">ID ${p.id_huella_sensor}</span>` : '<span class="marca">Sin huella</span>';
  const tarjeta = (p) => !p.codigo_tarjeta_rfid ? '<span class="marca">Sin tarjeta</span>'
    : p.tarjeta_activa ? `<span class="marca ok mono">${esc(p.codigo_tarjeta_rfid)}</span>`
    : `<span class="marca bloq mono">${esc(p.codigo_tarjeta_rfid)}</span><small>Bloqueada</small>`;

  const fila = (p) => `
    <tr class="${p.activo ? '' : 'baja'}" data-id="${p.id_personal}">
      <td><div class="miembro">${p.foto_perfil
        ? `<img class="sigla sigla--foto" src="${esc(p.foto_perfil)}" alt="" loading="lazy">`
        : `<span class="sigla">${esc(siglas(p.nombre_completo))}</span>`}
        <div><a class="miembro__nombre" href="/personal/${p.id_personal}">${esc(p.nombre_completo)}</a><small>${esc(p.correo)}</small></div></div></td>
      <td class="num">${esc(p.cedula)}</td>
      <td>${p.rol === 'directivo' ? 'Directivo' : 'Docente' + (p.nivel ? ' · ' + esc(p.nivel) : '')}<small>${esc(p.detalle || 'Sin cargo definido')}</small></td>
      <td>${esc(p.nombre_jornada || 'Sin jornada')}${p.hora_entrada ? `<small class="num">${p.hora_entrada} – ${p.hora_salida}</small>` : ''}</td>
      <td>${huella(p)}</td>
      <td>${tarjeta(p)}</td>
      <td>${p.activo ? '<span class="estado estado--activo">Activo</span>' : '<span class="estado estado--baja">De baja</span>'}</td>
      <td class="acciones"><a class="btn btn--chico" href="/personal/${p.id_personal}/editar">Editar</a><a class="btn btn--chico" href="/personal/${p.id_personal}">Ver ficha</a></td>
    </tr>`;

  function pintar() {
    const q = $('#q').value.trim().toLowerCase();
    const bajas = $('#verInactivos').checked;
    const nivel = $('#filtroNivel').value;
    const lista = datos.filter((p) =>
      (bajas || p.activo) && (!filtroRol || p.rol === filtroRol) &&
      (!nivel || String(p.id_nivel) === nivel) &&
      (filtroCred !== 'huella' || p.id_huella_sensor == null) &&
      (filtroCred !== 'tarjeta' || !p.codigo_tarjeta_rfid) &&
      (!q || p.nombre_completo.toLowerCase().includes(q) || p.cedula.includes(q) ||
        (p.detalle || '').toLowerCase().includes(q) ||
        (p.codigo_tarjeta_rfid || '').toLowerCase().includes(q)));
    $('#filas').innerHTML = lista.length
      ? lista.map(fila).join('')
      : '<tr><td colspan="8" class="vacio">No hay miembros con esos filtros.</td></tr>';
    $('#resumen').textContent = `Mostrando ${lista.length} de ${datos.length} registros`;
    pintarPendientes();
  }

  // Avisa a quién le faltan credenciales; cada número filtra la tabla
  function pintarPendientes() {
    const activos = datos.filter((p) => p.activo);
    const sinH = activos.filter((p) => p.id_huella_sensor == null).length;
    const sinT = activos.filter((p) => !p.codigo_tarjeta_rfid).length;
    const el = $('#pendientes');
    el.hidden = !activos.length;
    if (!sinH && !sinT) {
      el.innerHTML = '<span>Todos los miembros activos tienen huella y tarjeta.</span>';
      return;
    }
    const op = (tipo, n, txt) => n
      ? `<button type="button" data-cred="${tipo}" aria-pressed="${filtroCred === tipo}"><b>${n}</b> ${txt}</button>` : '';
    el.innerHTML = `<span>Credenciales pendientes</span>${op('huella', sinH, 'sin huella')}${op('tarjeta', sinT, 'sin tarjeta')}` +
      (filtroCred ? '<button type="button" data-cred="" class="pendientes__quitar">Ver todos</button>' : '');
  }

  $('#q').addEventListener('input', pintar);
  $('#verInactivos').addEventListener('change', pintar);
  $('#filtroNivel').addEventListener('change', pintar);
  $('#filtroRol').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    filtroRol = b.dataset.rol;
    document.querySelectorAll('#filtroRol button').forEach((x) => x.classList.toggle('on', x === b));
    pintar();
  });
  $('#pendientes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cred]'); if (!b) return;
    filtroCred = filtroCred === b.dataset.cred ? '' : b.dataset.cred;
    pintar();
  });
  // Toda la fila lleva a la ficha (los enlaces internos funcionan por sí solos)
  $('#filas').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.href = '/personal/' + tr.dataset.id;
  });

  // Aviso al volver de guardar (y se limpia la dirección para que no se repita al recargar)
  const parametros = new URLSearchParams(location.search);
  if (parametros.get('guardado') === '1' || parametros.get('eliminado')) {
    if (parametros.get('eliminado')) $('#avisoLista').textContent = `${parametros.get('eliminado')} fue eliminado del sistema.`;
    $('#avisoLista').hidden = false;
    history.replaceState(null, '', location.pathname);
    setTimeout(() => { $('#avisoLista').hidden = true; }, 5000);
  }

  cargar();
})();
