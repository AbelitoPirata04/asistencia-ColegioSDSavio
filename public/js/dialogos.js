// Ventanas compartidas por varias vistas:
//   VentanaRegistro.abrir({...})     -> registro manual o corrección de llegada / salida
//   VentanaNovedad.abrir({...})      -> permiso, incapacidad, calamidad... (ausencia justificada)
//   VentanaDiaSinClase.abrir({...})  -> festivo, vacaciones, jornada pedagógica
// Cada una devuelve una promesa: true si se guardó, false si se canceló.
(() => {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const diaLargo = (t) => { const s = new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };

  let miembros = null;
  async function listaMiembros() {
    if (!miembros) {
      const r = await fetch('/admin/api/miembros-activos');
      miembros = r.ok ? await r.json() : [];
    }
    return miembros;
  }
  async function selectorPersona(id) {
    const lista = await listaMiembros();
    return `<label>Docente o directivo
      <select name="id_personal" required>
        <option value="">Seleccione…</option>
        ${lista.map((m) => `<option value="${m.id_personal}" ${String(m.id_personal) === String(id) ? 'selected' : ''}>${esc(m.nombre_completo)}${m.rol === 'directivo' ? ' (directivo)' : m.nivel ? ' · ' + esc(m.nivel) : ''}</option>`).join('')}
      </select></label>`;
  }

  // Crea la ventana, la muestra y resuelve cuando se guarda o se cierra
  function ventana({ titulo, subtitulo, cuerpo, boton, guardar, alAbrir }) {
    return new Promise((resolver) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'ventana';
      dlg.innerHTML = `
        <form class="ventana__caja" novalidate>
          <header><h2>${esc(titulo)}</h2>${subtitulo ? `<p class="ayuda">${subtitulo}</p>` : ''}</header>
          <div class="ventana__cuerpo">${cuerpo}</div>
          <p class="aviso aviso--error" hidden></p>
          <div class="ventana__botones">
            <button type="button" class="btn" data-cerrar>Cancelar</button>
            <button type="submit" class="btn btn--primario">${esc(boton)}</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      const form = dlg.querySelector('form');
      const error = dlg.querySelector('.aviso--error');
      let guardado = false;

      dlg.querySelector('[data-cerrar]').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener('close', () => { dlg.remove(); resolver(guardado); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.hidden = true;
        const btn = form.querySelector('[type="submit"]');
        btn.disabled = true;
        try {
          await guardar(Object.fromEntries(new FormData(form)), form);
          guardado = true;
          dlg.close();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          btn.disabled = false;
        }
      });
      if (alAbrir) alAbrir(form);
      dlg.showModal();
      const primero = form.querySelector('select:not([disabled]), input:not([type="hidden"]):not([type="radio"])');
      if (primero) primero.focus();
    });
  }

  // Disponible para otras vistas (ej. "Mi cuenta"): VentanaFormulario({ titulo, subtitulo, cuerpo, boton, guardar })
  window.VentanaFormulario = ventana;

  async function enviar(url, metodo, cuerpo) {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensaje || 'No se pudo guardar.');
    return j;
  }

  // ---------- Registro manual / corrección ----------
  window.VentanaRegistro = {
    async abrir(o = {}) {
      const corregir = !!o.id_asistencia;
      const persona = o.id_personal
        ? `<input type="hidden" name="id_personal" value="${o.id_personal}">`
        : await selectorPersona('');
      const subtitulo = corregir || o.id_personal
        ? `${esc(o.nombre || '')} · ${diaLargo(o.dia)}`
        : 'Para cuando el equipo falló o la persona olvidó marcar.';
      return ventana({
        titulo: corregir ? 'Corregir registro' : 'Registro manual',
        subtitulo,
        boton: corregir ? 'Guardar corrección' : 'Guardar registro',
        cuerpo: `
          ${persona}
          ${corregir || o.id_personal ? `<input type="hidden" name="dia" value="${o.dia}">`
            : `<label>Día<input type="date" name="dia" value="${o.dia || hoy()}" max="${hoy()}" required></label>`}
          <div class="dos">
            <label>Hora de llegada<input type="time" name="entrada" value="${o.entrada || ''}" required></label>
            <label><span>Hora de salida <small class="ayuda">(opcional)</small></span><input type="time" name="salida" value="${o.salida || ''}"></label>
          </div>
          <label>Motivo
            <textarea name="observacion" rows="2" maxlength="255" required placeholder="Ej. El equipo no tenía conexión; se verificó con coordinación.">${esc(o.observacion || '')}</textarea>
          </label>
          <p class="ayuda">Queda marcado como <b>manual</b> en los registros y en los reportes.</p>`,
        guardar: (d) => corregir
          ? enviar(`/admin/api/asistencias/${o.id_asistencia}`, 'PUT', d)
          : enviar('/admin/api/asistencias/manual', 'POST', d)
      });
    }
  };

  // ---------- Novedad / permiso ----------
  const TIPOS = [
    ['incapacidad', 'Incapacidad', 'Médica, con soporte'],
    ['permiso', 'Permiso', 'Autorizado por rectoría'],
    ['calamidad', 'Calamidad', 'Calamidad doméstica'],
    ['licencia', 'Licencia', 'Maternidad, luto…'],
    ['comision', 'Comisión', 'Salida oficial del colegio'],
    ['otro', 'Otro', 'Explíquelo abajo']
  ];
  window.VentanaNovedad = {
    async abrir(o = {}) {
      const persona = o.id_personal
        ? `<input type="hidden" name="id_personal" value="${o.id_personal}">`
        : await selectorPersona('');
      return ventana({
        titulo: 'Registrar novedad',
        subtitulo: o.id_personal ? `${esc(o.nombre || '')} · los días que cubra no cuentan como falta` : 'Los días que cubra no cuentan como falta.',
        boton: 'Guardar novedad',
        cuerpo: `
          ${persona}
          <div class="tipos" role="radiogroup" aria-label="Tipo de novedad">
            ${TIPOS.map(([v, t, s], i) => `<label class="opcion"><input type="radio" name="tipo" value="${v}" ${i === 0 ? 'checked' : ''}>
              <span><strong>${t}</strong><small>${s}</small></span></label>`).join('')}
          </div>
          <div class="dos">
            <label>Desde<input type="date" name="desde" value="${o.desde || hoy()}" required></label>
            <label>Hasta<input type="date" name="hasta" value="${o.hasta || o.desde || hoy()}" required></label>
          </div>
          <label><span>Observación <small class="ayuda">(opcional)</small></span>
            <textarea name="observacion" rows="2" maxlength="255" placeholder="Ej. Incapacidad EPS número 12345"></textarea>
          </label>`,
        alAbrir: (form) => {
          // Si cambia "desde" y queda después de "hasta", se ajusta "hasta"
          form.elements.desde.addEventListener('change', () => {
            if (form.elements.hasta.value < form.elements.desde.value) form.elements.hasta.value = form.elements.desde.value;
          });
        },
        guardar: (d) => enviar('/admin/api/novedades', 'POST', d)
      });
    }
  };

  // ---------- Foto de perfil ----------
  // Recorta la foto al centro en proporción 5:6 (la del marco del carnet) y la deja en JPEG de 500×600.
  window.PrepararFoto = (archivo) => new Promise((resolver, rechazar) => {
    if (!archivo || !/^image\//.test(archivo.type)) { rechazar(new Error('Elija un archivo de imagen (JPG o PNG).')); return; }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const ancho = 500, alto = 600, proporcion = ancho / alto;
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (sw / sh > proporcion) { const n = sh * proporcion; sx = (sw - n) / 2; sw = n; }      // sobra ancho
      else { const n = sw / proporcion; sy = Math.max(0, (sh - n) * 0.35); sh = n; }         // sobra alto: deja más arriba (la cara)
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho; lienzo.height = alto;
      const g = lienzo.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, ancho, alto);
      g.drawImage(img, sx, sy, sw, sh, 0, 0, ancho, alto);
      URL.revokeObjectURL(url);
      lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No se pudo abrir esa imagen.')); };
    img.src = url;
  });

  window.SubirFoto = async (idPersonal, blob) => {
    const r = await fetch(`/admin/api/personal/${idPersonal}/foto`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensaje || 'No se pudo subir la foto.');
    return j.foto_perfil;
  };

  // ---------- Día sin clase ----------
  window.VentanaDiaSinClase = {
    abrir(o = {}) {
      return ventana({
        titulo: 'Agregar día sin clase',
        subtitulo: 'Esos días nadie aparece como ausente.',
        boton: 'Guardar',
        cuerpo: `
          <div class="tipos tipos--4" role="radiogroup" aria-label="Tipo">
            ${[['festivo', 'Festivo'], ['vacaciones', 'Vacaciones'], ['jornada', 'Jornada pedagógica'], ['otro', 'Otro']]
              .map(([v, t], i) => `<label class="opcion"><input type="radio" name="tipo" value="${v}" ${i === 0 ? 'checked' : ''}><span><strong>${t}</strong></span></label>`).join('')}
          </div>
          <div class="dos">
            <label>Desde<input type="date" name="desde" value="${o.desde || hoy()}" required></label>
            <label><span>Hasta <small class="ayuda">(si es más de un día)</small></span><input type="date" name="hasta" value="${o.desde || hoy()}"></label>
          </div>
          <label>Motivo<input name="motivo" maxlength="150" required placeholder="Ej. Semana de receso escolar"></label>`,
        alAbrir: (form) => {
          form.elements.desde.addEventListener('change', () => {
            if (form.elements.hasta.value < form.elements.desde.value) form.elements.hasta.value = form.elements.desde.value;
          });
        },
        guardar: (d) => enviar('/admin/api/dias-sin-clase', 'POST', d)
      });
    }
  };
})();
