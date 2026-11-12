// Reportes descargables de asistencia: PDF (para imprimir / firmar) y Excel (para trabajar los datos).
const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { resumen, porPersona } = require('./asistencias');

const LOGO = path.join(__dirname, '..', 'public', 'img', 'logo_pequeno.png');
const COLEGIO = 'Colegio Santo Domingo Savio';
const ROJO = '#C40000', TINTA = '#1D1B1A', GRIS = '#625E5A', LINEA = '#DCDCD6';
const VERDE = '#2B6A3A', AMBAR = '#8A5A00';

// ---------- Formatos ----------
const hora = (f) => (f ? new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const diaCorto = (t) => new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const diaLargo = (t) => {
  const s = new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fechaTexto = (t) => new Date(t + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const periodoTexto = (d) => (d.desde === d.hasta ? diaLargo(d.desde) : `${fechaTexto(d.desde)} al ${fechaTexto(d.hasta)}`);
const duracion = (min) => (min == null ? '' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);
const metodo = (m) => (m === 'huella' ? 'Huella' : m === 'rfid' ? 'Tarjeta' : m === 'manual' ? 'Manual' : '');
const horaMin = (min) => (min == null ? '—' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
const cargo = (p) => [p.rol === 'directivo' ? 'Directivo' : p.nivel, p.detalle].filter(Boolean).join(' · ');
const generado = () => new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
const nombreArchivo = (d, ext) => `asistencia_${d.desde}${d.desde === d.hasta ? '' : '_a_' + d.hasta}.${ext}`;

function textoFiltros(f, niveles) {
  const partes = [];
  if (f.personaNombre) partes.push(f.personaNombre);
  if (f.nivel === 'directivos') partes.push('Solo directivos');
  else if (f.nivel) partes.push('Nivel ' + ((niveles.find((n) => String(n.id_nivel) === String(f.nivel)) || {}).nombre || ''));
  if (f.estado === 'puntual') partes.push('Solo puntuales');
  if (f.estado === 'retardo') partes.push('Solo retardos');
  if (f.estado === 'sin_salida') partes.push('Solo sin salida');
  if (f.q) partes.push(`Búsqueda "${f.q}"`);
  return partes.join(' · ');
}

// ======================= PDF =======================
function pdf(res, datos, filtros, niveles) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36, bufferPages: true,
    info: { Title: 'Reporte de asistencia', Author: COLEGIO } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(datos, 'pdf')}"`);
  doc.pipe(res);

  const izq = 36, ancho = doc.page.width - 72, abajo = doc.page.height - 50;
  const r = resumen(datos);

  // ---- Encabezado ----
  try { doc.image(LOGO, izq, 30, { height: 46 }); } catch (e) { /* sin logo */ }
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(17).text('Reporte de asistencia', izq + 56, 34);
  doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(COLEGIO, izq + 56, 56);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TINTA)
    .text(periodoTexto(datos), izq, 36, { width: ancho, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS)
    .text('Generado el ' + generado(), izq, 52, { width: ancho, align: 'right' });
  doc.rect(izq, 84, ancho, 2.5).fill(ROJO);
  doc.rect(izq, 86.5, ancho, 1.5).fill('#FFE23D');

  // ---- Resumen ----
  let y = 100;
  const personas = porPersona(datos);
  const faltasTotal = personas.reduce((s, p) => s + p.faltas, 0);
  const justTotal = personas.reduce((s, p) => s + p.justificadas, 0);
  const cajas = datos.desde === datos.hasta
    ? (datos.diaSinClase
      ? [['Vinieron', r.llegaron], ['Día sin clase', datos.diaSinClase.tipo_texto], ['Retardos', r.retardos], ['Sin salida', r.sinSalida + r.enColegio]]
      : [['Llegaron', `${r.llegaron} de ${datos.activos}`], ['No llegaron', r.ausentes], ['Con permiso', r.justificados], ['Retardos', r.retardos]])
    : [['Registros', r.registros], ['Faltas', faltasTotal], ['Justificadas', justTotal], ['Retardos', r.retardos]];
  const anchoCaja = (ancho - 30) / cajas.length;
  cajas.forEach(([t, v], i) => {
    const x = izq + i * (anchoCaja + 10);
    doc.roundedRect(x, y, anchoCaja, 40, 5).lineWidth(0.8).strokeColor(LINEA).stroke();
    doc.font('Helvetica-Bold').fontSize(15).fillColor(t === 'Retardos' && v ? AMBAR : (t === 'No llegaron' || t === 'Faltas') && v ? ROJO : TINTA)
      .text(String(v), x + 12, y + 8, { width: anchoCaja - 24 });
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(t, x + 12, y + 26, { width: anchoCaja - 24 });
  });
  y += 52;
  const filtroTxt = textoFiltros(filtros, niveles);
  if (filtroTxt) {
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('Filtros aplicados: ' + filtroTxt, izq, y);
    y += 16;
  }

  // ---- Tabla ----
  const cols = [
    ['Fecha', 78], ['Miembro', 170], ['Nivel / cargo', 158], ['Llegada', 52], ['Salida', 62],
    ['Tiempo', 62], ['Método', 78], ['Estado', 60]
  ];
  const alto = 19;
  const encabezado = () => {
    doc.rect(izq, y, ancho, alto + 2).fill(ROJO);
    let x = izq;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
    cols.forEach(([t, w]) => { doc.text(t, x + 6, y + 6.5, { width: w - 10, lineBreak: false }); x += w; });
    y += alto + 2;
  };
  const saltoSiHaceFalta = (h) => {
    if (y + h > abajo) { doc.addPage(); y = 40; encabezado(); }
  };

  encabezado();
  const ordenados = [...datos.registros].sort((a, b) => new Date(a.fecha_hora_entrada) - new Date(b.fecha_hora_entrada));
  let diaActual = '', zebra = false;
  if (!ordenados.length) {
    doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('No hay registros en este periodo.', izq, y + 10);
    y += 30;
  }
  ordenados.forEach((reg) => {
    // Separador por día cuando el reporte abarca varios días
    if (datos.desde !== datos.hasta && reg.dia !== diaActual) {
      diaActual = reg.dia;
      saltoSiHaceFalta(alto * 2);
      const n = ordenados.filter((x) => x.dia === reg.dia).length;
      doc.rect(izq, y, ancho, alto).fill('#EFEFEA');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TINTA)
        .text(`${diaLargo(reg.dia)}  ·  ${n} registro${n === 1 ? '' : 's'}`, izq + 6, y + 6, { lineBreak: false });
      y += alto;
      zebra = false;
    }
    saltoSiHaceFalta(alto);
    if (zebra) doc.rect(izq, y, ancho, alto).fill('#F8F8F6');
    zebra = !zebra;

    const celdas = [
      [diaCorto(reg.dia), TINTA, 'Helvetica'],
      [reg.nombre_completo, TINTA, 'Helvetica-Bold'],
      [cargo(reg), GRIS, 'Helvetica'],
      [hora(reg.fecha_hora_entrada), TINTA, 'Helvetica-Bold'],
      reg.fecha_hora_salida ? [hora(reg.fecha_hora_salida), TINTA, 'Helvetica-Bold']
        : [reg.dia === datos.hoy ? 'En el colegio' : 'Sin salida', AMBAR, 'Helvetica-Oblique'],
      [duracion(reg.minutos), TINTA, 'Helvetica'],
      [[metodo(reg.metodo_ingreso), metodo(reg.metodo_salida)].filter(Boolean).join(' / '), GRIS, 'Helvetica'],
      reg.estado_puntualidad === 'retardo' ? ['Retardo', AMBAR, 'Helvetica-Bold'] : ['Puntual', VERDE, 'Helvetica-Bold']
    ];
    let x = izq;
    celdas.forEach(([t, color, fuente], i) => {
      doc.font(fuente).fontSize(8.5).fillColor(color)
        .text(t, x + 6, y + 5.5, { width: cols[i][1] - 10, height: alto - 4, ellipsis: true, lineBreak: false });
      x += cols[i][1];
    });
    y += alto;
  });
  doc.moveTo(izq, y).lineTo(izq + ancho, y).lineWidth(0.6).strokeColor(LINEA).stroke();

  // Lista simple de personas (sección con título de color)
  const seccion = (tituloTxt, color, lista, extra) => {
    if (!lista.length) return;
    y += 20;
    if (y + 60 > abajo) { doc.addPage(); y = 40; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(color).text(tituloTxt, izq, y);
    y += 18;
    lista.forEach((p, i) => {
      if (y + alto > abajo) { doc.addPage(); y = 40; }
      if (i % 2 === 0) doc.rect(izq, y, ancho, alto).fill('#F8F8F6');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TINTA).text(p.nombre_completo, izq + 6, y + 5.5, { width: 220, lineBreak: false });
      doc.font('Helvetica').fillColor(GRIS).text(cargo(p), izq + 230, y + 5.5, { width: 220, lineBreak: false, ellipsis: true });
      doc.text(extra(p), izq + 460, y + 5.5, { width: ancho - 466, lineBreak: false, ellipsis: true });
      y += alto;
    });
  };

  // ---- Un día: quién no llegó y quién tenía permiso ----
  if (datos.desde === datos.hasta) {
    if (datos.diaSinClase) {
      y += 20;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA)
        .text(`Día sin clase · ${datos.diaSinClase.tipo_texto}: ${datos.diaSinClase.motivo}. Nadie cuenta como ausente.`, izq, y);
    }
    seccion(`No llegaron (${r.ausentes})`, ROJO, datos.ausentes.filter((p) => !p.novedad), (p) => 'C.C. ' + p.cedula);
    seccion(`Ausencias justificadas (${r.justificados})`, TINTA, datos.ausentes.filter((p) => p.novedad),
      (p) => p.novedad.tipo_texto + (p.novedad.observacion ? ' — ' + p.novedad.observacion : ''));
  } else {
    // ---- Varios días: resumen por persona (faltas, justificadas, retardos) ----
    y += 24;
    if (y + 80 > abajo) { doc.addPage(); y = 40; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text('Resumen por persona', izq, y);
    if (datos.sinClase.length) {
      const txt = 'Días sin clase en el periodo (no cuentan): ' +
        datos.sinClase.map((s) => `${fechaTexto(s.desde)}${s.hasta !== s.desde ? ' a ' + fechaTexto(s.hasta) : ''} (${s.motivo})`).join('; ');
      doc.font('Helvetica').fontSize(8.5).fillColor(GRIS);
      doc.text(txt, izq, y + 16, { width: ancho });
      y += doc.heightOfString(txt, { width: ancho }) + 4;
    }
    y += 20;
    const cols2 = [['Miembro', 200], ['Nivel / cargo', 190], ['Días de clase', 70], ['Asistió', 60], ['Faltas', 55], ['Justificadas', 70], ['Retardos', 60], ['Llegada prom.', 15]];
    cols2[cols2.length - 1][1] = ancho - cols2.slice(0, -1).reduce((s, c) => s + c[1], 0);
    const enc2 = () => {
      doc.rect(izq, y, ancho, alto + 2).fill(TINTA);
      let x = izq;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
      cols2.forEach(([t, w]) => { doc.text(t, x + 6, y + 6.5, { width: w - 10, lineBreak: false }); x += w; });
      y += alto + 2;
    };
    enc2();
    personas.forEach((p, i) => {
      if (y + alto > abajo) { doc.addPage(); y = 40; enc2(); }
      if (i % 2 === 1) doc.rect(izq, y, ancho, alto).fill('#F8F8F6');
      const celdas = [
        [p.nombre_completo, TINTA, 'Helvetica-Bold'], [cargo(p), GRIS, 'Helvetica'],
        [String(p.laborables), TINTA, 'Helvetica'], [String(p.asistio), TINTA, 'Helvetica'],
        [String(p.faltas), p.faltas ? ROJO : TINTA, 'Helvetica-Bold'], [String(p.justificadas), TINTA, 'Helvetica'],
        [String(p.retardos), p.retardos ? AMBAR : TINTA, 'Helvetica-Bold'], [horaMin(p.llegadaPromedio), TINTA, 'Helvetica']
      ];
      let x = izq;
      celdas.forEach(([t, color, fuente], k) => {
        doc.font(fuente).fontSize(8.5).fillColor(color).text(t, x + 6, y + 5.5, { width: cols2[k][1] - 10, lineBreak: false, ellipsis: true });
        x += cols2[k][1];
      });
      y += alto;
    });
  }

  // ---- Pie de página con número de página ----
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;   // el pie va debajo del margen: sin esto se crearían páginas en blanco
    doc.font('Helvetica').fontSize(8).fillColor(GRIS)
      .text(`${COLEGIO} · Reporte de asistencia`, izq, doc.page.height - 32, { lineBreak: false })
      .text(`Página ${i + 1} de ${paginas.count}`, izq, doc.page.height - 32, { width: ancho, align: 'right', lineBreak: false });
  }
  doc.end();
}

// ======================= EXCEL =======================
async function excel(res, datos, filtros, niveles) {
  const libro = new ExcelJS.Workbook();
  libro.creator = COLEGIO;
  libro.created = new Date();

  const estiloEncabezado = (fila) => {
    fila.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC40000' } };
      c.alignment = { vertical: 'middle' };
    });
    fila.height = 20;
  };
  const titulo = (hoja, texto, columnas) => {
    hoja.mergeCells(1, 1, 1, columnas);
    hoja.getCell(1, 1).value = `${texto} — ${COLEGIO}`;
    hoja.getCell(1, 1).font = { bold: true, size: 14 };
    hoja.mergeCells(2, 1, 2, columnas);
    const f = textoFiltros(filtros, niveles);
    hoja.getCell(2, 1).value = `Periodo: ${periodoTexto(datos)}${f ? '   ·   Filtros: ' + f : ''}   ·   Generado: ${generado()}`;
    hoja.getCell(2, 1).font = { color: { argb: 'FF625E5A' } };
  };

  // ---- Hoja 1: registros ----
  const h1 = libro.addWorksheet('Asistencia', { views: [{ state: 'frozen', ySplit: 4 }] });
  const columnas = [
    ['Fecha', 13], ['Miembro', 30], ['Cédula', 13], ['Rol', 11], ['Nivel', 14], ['Grado / asignatura / cargo', 26],
    ['Llegada', 10], ['Método llegada', 15], ['Salida', 10], ['Método salida', 15], ['Tiempo (min)', 13], ['Estado', 12],
    ['Observación (registro manual)', 40]
  ];
  titulo(h1, 'Reporte de asistencia', columnas.length);
  columnas.forEach(([, w], i) => { h1.getColumn(i + 1).width = w; });
  h1.getRow(4).values = columnas.map(([t]) => t);
  estiloEncabezado(h1.getRow(4));

  const ordenados = [...datos.registros].sort((a, b) => new Date(a.fecha_hora_entrada) - new Date(b.fecha_hora_entrada));
  ordenados.forEach((r) => {
    const fila = h1.addRow([
      new Date(r.dia + 'T12:00:00'), r.nombre_completo, r.cedula, r.rol === 'directivo' ? 'Directivo' : 'Docente',
      r.nivel || '', r.detalle || '', hora(r.fecha_hora_entrada), metodo(r.metodo_ingreso),
      r.fecha_hora_salida ? hora(r.fecha_hora_salida) : (r.dia === datos.hoy ? 'En el colegio' : 'Sin salida'),
      metodo(r.metodo_salida), r.minutos == null ? null : r.minutos,
      r.estado_puntualidad === 'retardo' ? 'Retardo' : 'Puntual', r.observacion || ''
    ]);
    fila.getCell(1).numFmt = 'dd/mm/yyyy';
    fila.getCell(12).font = { bold: true, color: { argb: r.estado_puntualidad === 'retardo' ? 'FF8A5A00' : 'FF2B6A3A' } };
    if (!r.fecha_hora_salida) fila.getCell(9).font = { italic: true, color: { argb: 'FF8A5A00' } };
  });
  h1.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columnas.length } };

  // ---- Hoja 2: resumen por persona ----
  const h2 = libro.addWorksheet('Resumen por persona', { views: [{ state: 'frozen', ySplit: 4 }] });
  const cols2 = [['Miembro', 30], ['Cédula', 13], ['Nivel / cargo', 32], ['Días de clase', 14], ['Asistió', 10], ['Faltas', 10],
    ['Justificadas', 13], ['Retardos', 11], ['Sin salida', 11], ['Llegada promedio', 17], ['Días que faltó', 40]];
  titulo(h2, 'Resumen por persona', cols2.length);
  cols2.forEach(([, w], i) => { h2.getColumn(i + 1).width = w; });
  h2.getRow(4).values = cols2.map(([t]) => t);
  estiloEncabezado(h2.getRow(4));
  porPersona(datos).forEach((p) => {
    const fila = h2.addRow([p.nombre_completo, p.cedula, cargo(p), p.laborables, p.asistio, p.faltas, p.justificadas,
      p.retardos, p.sinSalida, horaMin(p.llegadaPromedio), p.detalleFaltas.map(fechaTexto).join(', ')]);
    if (p.faltas) fila.getCell(6).font = { bold: true, color: { argb: 'FFC40000' } };
    if (p.retardos) fila.getCell(8).font = { bold: true, color: { argb: 'FF8A5A00' } };
  });

  // ---- Hoja 3: quién no llegó (solo un día) ----
  if (datos.ausentes.length) {
    const h3 = libro.addWorksheet('No llegaron');
    const cols3 = [['Miembro', 30], ['Cédula', 13], ['Rol', 11], ['Nivel / cargo', 34], ['Justificación', 40]];
    titulo(h3, 'No llegaron', cols3.length);
    cols3.forEach(([, w], i) => { h3.getColumn(i + 1).width = w; });
    h3.getRow(4).values = cols3.map(([t]) => t);
    estiloEncabezado(h3.getRow(4));
    datos.ausentes.forEach((p) => h3.addRow([p.nombre_completo, p.cedula, p.rol === 'directivo' ? 'Directivo' : 'Docente', cargo(p),
      p.novedad ? p.novedad.tipo_texto + (p.novedad.observacion ? ' — ' + p.novedad.observacion : '') : 'Sin justificar']));
  }

  // ---- Hoja 4: novedades y días sin clase del periodo ----
  if (datos.novedades.length || datos.sinClase.length) {
    const h4 = libro.addWorksheet('Novedades del periodo');
    const cols4 = [['Tipo', 22], ['Persona / motivo', 34], ['Desde', 14], ['Hasta', 14], ['Observación', 40]];
    titulo(h4, 'Novedades y días sin clase', cols4.length);
    cols4.forEach(([, w], i) => { h4.getColumn(i + 1).width = w; });
    h4.getRow(4).values = cols4.map(([t]) => t);
    estiloEncabezado(h4.getRow(4));
    datos.sinClase.forEach((s) => h4.addRow([`Sin clase · ${s.tipo_texto}`, s.motivo, fechaTexto(s.desde), fechaTexto(s.hasta), '']));
    datos.novedades
      .filter((n) => datos.personas.some((p) => p.id_personal === n.id_personal))
      .forEach((n) => h4.addRow([n.tipo_texto, n.nombre_completo, fechaTexto(n.desde), fechaTexto(n.hasta), n.observacion || '']));
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(datos, 'xlsx')}"`);
  await libro.xlsx.write(res);
  res.end();
}

module.exports = { pdf, excel };
