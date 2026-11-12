// Consulta de asistencias compartida por la vista, el historial, el PDF y el Excel
// (así todos cuentan faltas, permisos y días sin clase de la misma forma).
const { pool } = require('../config/conexion_bd');

const TIPOS_NOVEDAD = {
  incapacidad: 'Incapacidad', permiso: 'Permiso', calamidad: 'Calamidad',
  licencia: 'Licencia', comision: 'Comisión de servicio', otro: 'Otro'
};
const TIPOS_DIA = { festivo: 'Festivo', vacaciones: 'Vacaciones', jornada: 'Jornada pedagógica', otro: 'Sin clase' };

// Fecha local (Colombia) en formato AAAA-MM-DD
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoyLocal = () => iso(new Date());

function periodo(q) {
  const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
  const desde = esFecha(q.desde) ? q.desde : hoyLocal();
  let hasta = esFecha(q.hasta) ? q.hasta : desde;
  if (hasta < desde) hasta = desde;
  return { desde, hasta };
}

// Todos los días (AAAA-MM-DD) entre dos fechas
function diasEntre(desde, hasta) {
  const lista = [];
  const d = new Date(desde + 'T12:00:00');
  const fin = new Date(hasta + 'T12:00:00');
  while (d <= fin) { lista.push(iso(d)); d.setDate(d.getDate() + 1); }
  return lista;
}
const esFinDeSemana = (t) => { const s = new Date(t + 'T12:00:00').getDay(); return s === 0 || s === 6; };

const DETALLE = `CASE WHEN p.rol = 'directivo' THEN p.cargo_asignatura ELSE COALESCE(a.nombre, g.nombre) END`;
const UNIONES = `
  LEFT JOIN niveles n ON n.id_nivel = p.id_nivel
  LEFT JOIN grados g ON g.id_grado = p.id_grado
  LEFT JOIN asignaturas a ON a.id_asignatura = p.id_asignatura`;

// Novedades y días sin clase que tocan un periodo
async function calendario(desde, hasta, idPersonal) {
  const [novedades] = await pool.query(`
    SELECT nv.id_novedad, nv.id_personal, nv.tipo, nv.observacion, p.nombre_completo,
           DATE_FORMAT(nv.fecha_inicio, '%Y-%m-%d') AS desde, DATE_FORMAT(nv.fecha_fin, '%Y-%m-%d') AS hasta
      FROM novedades nv JOIN personal p ON p.id_personal = nv.id_personal
     WHERE nv.fecha_inicio <= ? AND nv.fecha_fin >= ? ${idPersonal ? 'AND nv.id_personal = ?' : ''}
     ORDER BY nv.fecha_inicio`, idPersonal ? [hasta, desde, idPersonal] : [hasta, desde]);
  const [sinClase] = await pool.query(`
    SELECT id_dia, tipo, motivo,
           DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS hasta
      FROM dias_sin_clase WHERE fecha_inicio <= ? AND fecha_fin >= ? ORDER BY fecha_inicio`, [hasta, desde]);
  novedades.forEach((x) => { x.tipo_texto = TIPOS_NOVEDAD[x.tipo]; });
  sinClase.forEach((x) => { x.tipo_texto = TIPOS_DIA[x.tipo]; });
  return { novedades, sinClase };
}

const diaSinClase = (sinClase, t) => sinClase.find((s) => s.desde <= t && s.hasta >= t) || null;
const novedadDe = (novedades, idPersonal, t) =>
  novedades.find((n) => n.id_personal === idPersonal && n.desde <= t && n.hasta >= t) || null;

// Registros del periodo + personas activas + novedades + días sin clase
async function obtener(desde, hasta) {
  const [registros] = await pool.query(`
    SELECT r.id_asistencia, r.id_personal, r.fecha_hora_entrada, r.fecha_hora_salida,
           r.metodo_ingreso, r.metodo_salida, r.estado_puntualidad, r.observacion,
           r.ruta_fotografia, r.ruta_foto_salida,
           TIMESTAMPDIFF(MINUTE, r.fecha_hora_entrada, r.fecha_hora_salida) AS minutos,
           DATE_FORMAT(r.fecha_hora_entrada, '%Y-%m-%d') AS dia,
           p.nombre_completo, p.cedula, p.rol, p.id_nivel, n.nombre AS nivel, ${DETALLE} AS detalle
      FROM registros_asistencia r
      JOIN personal p ON p.id_personal = r.id_personal
      ${UNIONES}
     WHERE r.fecha_hora_entrada >= ? AND r.fecha_hora_entrada < ? + INTERVAL 1 DAY
     ORDER BY r.fecha_hora_entrada DESC`, [desde, hasta]);

  // Personas activas y desde cuándo se les cuentan faltas (desde que entraron al sistema o su primer registro)
  const [personas] = await pool.query(`
    SELECT p.id_personal, p.nombre_completo, p.cedula, p.rol, p.id_nivel, n.nombre AS nivel, ${DETALLE} AS detalle,
           DATE_FORMAT(LEAST(DATE(p.fecha_creacion),
             COALESCE((SELECT DATE(MIN(r.fecha_hora_entrada)) FROM registros_asistencia r WHERE r.id_personal = p.id_personal),
                      DATE(p.fecha_creacion))), '%Y-%m-%d') AS cuenta_desde
      FROM personal p
      ${UNIONES}
     WHERE p.activo = 1 AND p.rol IN ('docente','directivo')
     ORDER BY p.nombre_completo`);

  const { novedades, sinClase } = await calendario(desde, hasta);
  const hoy = hoyLocal();
  const datos = { desde, hasta, hoy, registros, personas, novedades, sinClase, activos: personas.length };

  // Un solo día: quién no llegó (y si tiene permiso) o si fue día sin clase
  datos.diaSinClase = desde === hasta ? diaSinClase(sinClase, desde) : null;
  datos.ausentes = [];
  if (desde === hasta && !datos.diaSinClase) {
    const llegaron = new Set(registros.map((r) => r.id_personal));
    datos.ausentes = personas
      .filter((p) => !llegaron.has(p.id_personal) && p.cuenta_desde <= desde)
      .map((p) => ({ ...p, novedad: novedadDe(novedades, p.id_personal, desde) }));
  }
  return datos;
}

// Mismos filtros que la vista: búsqueda, nivel ("directivos" o id), estado y persona
function filtrar(datos, { q = '', nivel = '', estado = '', persona = '' }) {
  const texto = String(q).trim().toLowerCase();
  const pasa = (p) => {
    if (persona && String(p.id_personal) !== String(persona)) return false;
    if (nivel === 'directivos' && p.rol !== 'directivo') return false;
    if (nivel && nivel !== 'directivos' && String(p.id_nivel) !== String(nivel)) return false;
    return !texto || p.nombre_completo.toLowerCase().includes(texto) || p.cedula.includes(texto) ||
      String(p.detalle || '').toLowerCase().includes(texto);
  };
  const registros = datos.registros.filter(pasa).filter((r) =>
    !estado || (estado === 'sin_salida' ? !r.fecha_hora_salida : r.estado_puntualidad === estado));
  // Con un filtro de estado activo, los ausentes no aplican
  const ausentes = estado ? [] : datos.ausentes.filter(pasa);
  return { ...datos, registros, ausentes, personas: datos.personas.filter(pasa) };
}

// Resumen por persona en el periodo: días que debía venir, asistió, faltas, justificadas, retardos
function porPersona(datos) {
  const ultimoContable = datos.hasta < datos.hoy ? datos.hasta : datos.hoy;   // hoy cuenta solo si ya marcó
  const dias = diasEntre(datos.desde, ultimoContable).filter((t) => !esFinDeSemana(t) && !diaSinClase(datos.sinClase, t));
  const vino = new Map();
  datos.registros.forEach((r) => {
    if (!vino.has(r.id_personal)) vino.set(r.id_personal, new Map());
    if (!vino.get(r.id_personal).has(r.dia)) vino.get(r.id_personal).set(r.dia, r);
  });
  return datos.personas.map((p) => {
    const suyos = vino.get(p.id_personal) || new Map();
    let faltas = 0, justificadas = 0, laborables = 0;
    const detalleFaltas = [];
    dias.forEach((t) => {
      if (t < p.cuenta_desde) return;
      if (t === datos.hoy && !suyos.has(t)) return;                     // hoy todavía puede llegar
      laborables++;
      if (suyos.has(t)) return;
      const nov = novedadDe(datos.novedades, p.id_personal, t);
      if (nov) justificadas++; else { faltas++; detalleFaltas.push(t); }
    });
    const regs = [...suyos.values()];
    const llegadas = regs.map((r) => { const f = new Date(r.fecha_hora_entrada); return f.getHours() * 60 + f.getMinutes(); });
    return {
      ...p, laborables, asistio: regs.length, faltas, justificadas, detalleFaltas,
      retardos: regs.filter((r) => r.estado_puntualidad === 'retardo').length,
      sinSalida: regs.filter((r) => !r.fecha_hora_salida && r.dia !== datos.hoy).length,
      llegadaPromedio: llegadas.length ? Math.round(llegadas.reduce((s, x) => s + x, 0) / llegadas.length) : null
    };
  });
}

function resumen(datos) {
  const r = datos.registros;
  const justificados = datos.ausentes.filter((a) => a.novedad).length;
  return {
    registros: r.length,
    llegaron: new Set(r.map((x) => x.id_personal)).size,
    retardos: r.filter((x) => x.estado_puntualidad === 'retardo').length,
    sinSalida: r.filter((x) => !x.fecha_hora_salida && x.dia !== datos.hoy).length,
    enColegio: r.filter((x) => !x.fecha_hora_salida && x.dia === datos.hoy).length,
    ausentes: datos.ausentes.length - justificados,
    justificados
  };
}

module.exports = {
  TIPOS_NOVEDAD, TIPOS_DIA, hoyLocal, periodo, diasEntre, esFinDeSemana,
  calendario, diaSinClase, novedadDe, obtener, filtrar, porPersona, resumen
};
