// Vista: Mi cuenta (cambiar contraseña) y encargados con acceso al panel
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siglas = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  async function enviar(url, metodo, cuerpo) {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensaje || 'No se pudo completar.');
    return j;
  }

  function avisar(texto, error) {
    const el = $('#avisoCuenta');
    el.textContent = texto;
    el.className = 'aviso aviso--flotante ' + (error ? 'aviso--error' : 'aviso--ok');
    el.hidden = false;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ---------- Cambiar mi contraseña ----------
  $('#formClave').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const aviso = $('#avisoClave');
    aviso.hidden = true;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await enviar('/admin/api/cuenta/clave', 'POST', Object.fromEntries(new FormData(form)));
      form.reset();
      // Si era una contraseña temporal, ya puede entrar al panel
      if (document.querySelector('.aviso-dia--clave')) { location.href = '/'; return; }
      aviso.className = 'aviso aviso--ok';
      aviso.textContent = 'Contraseña actualizada.';
      aviso.hidden = false;
    } catch (err) {
      aviso.className = 'aviso aviso--error';
      aviso.textContent = err.message;
      aviso.hidden = false;
    }
    btn.disabled = false;
  });

  // ---------- Encargados ----------
  const lista = $('#encargados');
  if (!lista) return;   // con contraseña temporal no se muestra esta sección

  async function cargar() {
    const r = await fetch('/admin/api/encargados', { cache: 'no-store' });
    const datos = await r.json();
    lista.innerHTML = datos.map((u) => {
      const ultimo = u.ultimo_ingreso
        ? 'Último ingreso: ' + new Date(u.ultimo_ingreso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
        : 'Aún no ha ingresado';
      return `<li class="encargado">
        <span class="sigla">${esc(siglas(u.nombre_completo))}</span>
        <div class="encargado__datos">
          <strong>${esc(u.nombre_completo)}${u.soy_yo ? ' <span class="encargado__yo">Usted</span>' : ''}</strong>
          <small>${u.rol === 'directivo' ? esc(u.cargo || 'Directivo') + ' · ' : ''}${esc(u.correo)} · ${ultimo}${u.debe_cambiar_clave ? ' · <b class="encargado__temporal">Contraseña temporal</b>' : ''}</small>
        </div>
        ${u.soy_yo ? '' : `<div class="encargado__acciones">
          <button type="button" class="btn btn--chico" data-restablecer="${u.id_personal}" data-nombre="${esc(u.nombre_completo)}">Restablecer contraseña</button>
          <button type="button" class="btn btn--chico btn--peligro" data-quitar="${u.id_personal}" data-nombre="${esc(u.nombre_completo)}">Quitar acceso</button>
        </div>`}
      </li>`;
    }).join('');
  }

  const campoClave = (etiqueta) => `
    <label>${etiqueta}<input name="clave" type="text" minlength="8" required autocomplete="off" placeholder="Mínimo 8 caracteres"></label>
    <p class="ayuda">Désela a la persona. Al ingresar, el sistema le pedirá cambiarla por una propia.</p>`;

  $('#btnNuevoEncargado').addEventListener('click', async () => {
    const ok = await window.VentanaFormulario({
      titulo: 'Dar acceso al panel',
      subtitulo: 'Para la persona encargada de la asistencia.',
      boton: 'Dar acceso',
      cuerpo: `
        <label>Nombre completo<input name="nombre" maxlength="150" required autocomplete="off"></label>
        <div class="dos">
          <label>Cédula<input name="cedula" maxlength="15" inputmode="numeric" required autocomplete="off"></label>
          <label>Correo<input name="correo" type="email" maxlength="120" required autocomplete="off" placeholder="nombre@savio.edu.co"></label>
        </div>
        ${campoClave('Contraseña temporal')}`,
      guardar: (d) => enviar('/admin/api/encargados', 'POST', d)
    });
    if (ok) { avisar('Acceso creado.'); cargar(); }
  });

  $('#btnDirectivo').addEventListener('click', async () => {
    let directivos = [];
    try { directivos = await (await fetch('/admin/api/encargados/directivos', { cache: 'no-store' })).json(); } catch (e) { /* sin lista */ }
    if (!directivos.length) { avisar('Todos los directivos activos ya tienen acceso.'); return; }
    const ok = await window.VentanaFormulario({
      titulo: 'Dar acceso a un directivo',
      subtitulo: 'Sigue registrado como directivo y además podrá entrar al panel.',
      boton: 'Dar acceso',
      cuerpo: `
        <label>Directivo
          <select name="id_personal" required>
            ${directivos.map((d) => `<option value="${d.id_personal}">${esc(d.nombre_completo)}${d.cargo ? ' · ' + esc(d.cargo) : ''}</option>`).join('')}
          </select>
        </label>
        <p class="ayuda">Entrará con el correo que tiene registrado en su ficha.</p>
        ${campoClave('Contraseña temporal')}`,
      guardar: (d) => enviar('/admin/api/encargados/directivo', 'POST', d)
    });
    if (ok) { avisar('Acceso dado.'); cargar(); }
  });

  lista.addEventListener('click', async (e) => {
    const rest = e.target.closest('[data-restablecer]');
    const quitar = e.target.closest('[data-quitar]');
    if (rest) {
      const ok = await window.VentanaFormulario({
        titulo: 'Restablecer contraseña',
        subtitulo: esc(rest.dataset.nombre),
        boton: 'Restablecer',
        cuerpo: campoClave('Nueva contraseña temporal'),
        guardar: (d) => enviar(`/admin/api/encargados/${rest.dataset.restablecer}/clave`, 'POST', d)
      });
      if (ok) { avisar('Contraseña restablecida.'); cargar(); }
    }
    if (quitar) {
      const ok = await window.Confirmar({
        titulo: '¿Quitar el acceso?',
        mensaje: `${quitar.dataset.nombre} ya no podrá entrar al panel. Se puede volver a dar acceso más adelante.`,
        aceptar: 'Sí, quitar acceso', peligro: true
      });
      if (!ok) return;
      try { await enviar(`/admin/api/encargados/${quitar.dataset.quitar}`, 'DELETE'); avisar('Acceso quitado.'); cargar(); }
      catch (err) { avisar(err.message, true); }
    }
  });

  cargar();
})();
