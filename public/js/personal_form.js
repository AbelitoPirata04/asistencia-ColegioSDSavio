// Vista: crear / editar miembro
(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#formMiembro');
  const id = form.dataset.id;
  const error = $('#error');
  const { grados, seleccionado } = JSON.parse($('#datosGrados').textContent);
  let gradoElegido = seleccionado;

  // ---- Docente: el nivel decide si se pide grado (preescolar/primaria) o asignatura (secundaria) ----
  function pintarNivel() {
    const op = $('#selNivel').selectedOptions[0];
    const idNivel = op ? op.value : '';
    const porAsignatura = op && op.dataset.porAsignatura === '1';
    $('#campoAsignatura').hidden = !idNivel || !porAsignatura;
    $('#campoGrado').hidden = !idNivel || porAsignatura;

    const delNivel = grados.filter((g) => String(g.id_nivel) === idNivel);
    $('#selGrado').innerHTML = '<option value="">Seleccione…</option>' + delNivel.map((g) =>
      `<option value="${g.id_grado}" ${String(g.id_grado) === String(gradoElegido) ? 'selected' : ''}>${g.nombre.replace(/</g, '&lt;')}</option>`
    ).join('');
  }

  function pintarRol() {
    const directivo = form.elements.rol.value === 'directivo';
    $('#camposDocente').hidden = directivo;
    $('#camposDirectivo').hidden = !directivo;
    $('#campoJornada').hidden = directivo;   // los directivos son de toda la institución
  }

  $('#selNivel').addEventListener('change', () => { gradoElegido = null; pintarNivel(); });
  $('#selGrado').addEventListener('change', (e) => { gradoElegido = e.target.value; });
  form.querySelectorAll('input[name="rol"]').forEach((r) => r.addEventListener('change', pintarRol));
  pintarNivel();
  pintarRol();

  // ---- Foto para el carnet (se prepara aquí y se sube después de guardar los datos) ----
  let fotoNueva = null;      // Blob listo para subir
  let quitarFoto = false;
  $('#fotoElegir').addEventListener('click', () => $('#fotoArchivo').click());
  $('#fotoArchivo').addEventListener('change', async (e) => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      fotoNueva = await window.PrepararFoto(archivo);
      quitarFoto = false;
      const vista = $('#fotoVista');
      if (vista.dataset.url) URL.revokeObjectURL(vista.dataset.url);
      vista.dataset.url = URL.createObjectURL(fotoNueva);
      vista.src = vista.dataset.url;
      vista.hidden = false;
      $('#fotoVacia').hidden = true;
      $('#fotoQuitar').hidden = false;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  $('#fotoQuitar').addEventListener('click', () => {
    fotoNueva = null;
    quitarFoto = true;
    $('#fotoVista').hidden = true;
    $('#fotoVacia').hidden = false;
    $('#fotoQuitar').hidden = true;
  });

  // ---- Guardar ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    // Enter en un campo = botón principal (ir a la ficha)
    const destino = (e.submitter && e.submitter.dataset.destino) || 'ficha';
    const botones = form.querySelectorAll('[type="submit"]');
    botones.forEach((b) => { b.disabled = true; });

    const cuerpo = Object.fromEntries(new FormData(form));
    // Solo se envía lo que corresponde al rol y nivel elegidos
    if (cuerpo.rol === 'directivo') { cuerpo.id_nivel = cuerpo.id_grado = cuerpo.id_asignatura = cuerpo.id_horario = null; }
    else {
      cuerpo.cargo_asignatura = null;
      if ($('#campoGrado').hidden) cuerpo.id_grado = null;
      if ($('#campoAsignatura').hidden) cuerpo.id_asignatura = null;
    }

    try {
      const r = await fetch(id ? `/admin/api/personal/${id}` : '/admin/api/personal', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.mensaje || 'No se pudo guardar.');
      const idGuardado = id || j.id_personal;
      // Los datos ya quedaron guardados; si la foto falla, se avisa pero no se pierde nada
      try {
        if (fotoNueva) await window.SubirFoto(idGuardado, fotoNueva);
        else if (quitarFoto && id) await fetch(`/admin/api/personal/${id}/foto`, { method: 'DELETE' });
      } catch (errFoto) {
        await window.Confirmar({
          titulo: 'La foto no se pudo subir',
          mensaje: `Los datos sí se guardaron. ${errFoto.message} Puede agregar la foto desde la ficha.`,
          aceptar: 'Entendido', cancelar: 'Cerrar'
        });
      }
      if (destino === 'lista') location.href = '/personal?guardado=1';
      else location.href = id ? `/personal/${id}?guardado=1` : `/personal/${j.id_personal}?nuevo=1`;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      error.scrollIntoView({ behavior: 'smooth', block: 'center' });
      botones.forEach((b) => { b.disabled = false; });
    }
  });

  if (!id) form.elements.nombre_completo.focus();
})();
