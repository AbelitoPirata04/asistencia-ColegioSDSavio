const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/conexion_bd');
const dispositivo = require('../servicios/dispositivo');
const asistencias = require('../servicios/asistencias');
const reportes = require('../servicios/reportes');
const { festivosColombia } = require('../servicios/festivos');
const avisosPush = require('../servicios/avisos_push');

const router = express.Router();
const ROLES = ['docente', 'directivo'];

// ---------- Datos comunes de las páginas (fecha y estado del ESP32) ----------
async function comunes(req, res, next) {
  try {
    res.locals.dispositivo = (await dispositivo.estado()) || { enLinea: false, modo: 'asistencia' };
  } catch (e) {
    res.locals.dispositivo = { enLinea: false, modo: 'asistencia' };
  }
  res.locals.fecha = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota'
  });
  next();
}

// ---------- Páginas ----------
// ----- Inicio: fotos del colegio + resumen del día -----
// Carrusel principal (fotos horizontales). Texto corto y fiel a lo que se ve en cada foto.
const PORTADA = [
  ['estudiantes-semana-cultural', 'Formando con Ciencia, Valores y Autonomía', 'Jornada cultural, pedagógica y recreativa del Instituto Mixto Santo Domingo Savio.'],
  ['equipo-docente', 'Nuestro equipo', 'Docentes y directivos que acompañan cada día a nuestros estudiantes.'],
  ['clausura-2025', 'Clausura 2025', 'Celebramos el cierre del año con los graduandos de preescolar.'],
  ['aula-de-sistemas', 'Aprender con tecnología', 'Nuestros estudiantes se preparan en el aula de sistemas.'],
  ['club-de-lectura', 'Leer para crecer', 'Socialización de la obra «Nemesio, el anacoreta» con nuestros estudiantes.'],
  ['feria-de-culturas', 'Conocer el mundo', 'Feria de culturas: Francia, México y Colombia en preescolar.'],
  ['dia-del-idioma', 'Día del Idioma', 'Celebramos la lengua y la literatura con toda la comunidad educativa.'],
  ['feria-de-proyectos', 'Proyectos que transforman', 'Nuestros estudiantes presentan sus proyectos a la comunidad.'],
  ['equipo-sexto', 'Deporte y compañerismo', 'El equipo de grado sexto, listo para la cancha.'],
  ['navidad-preescolar', 'Navidad en el Savio', 'Los niños de preescolar celebran la Navidad.']
].map(([foto, titulo, texto]) => ({ foto: `/img/institucion/${foto}.jpg`, titulo, texto }));

// Recuadro lateral (fotos verticales)
const TRADICIONES = [
  ['desfile-danzas', 'Danza y folclor', 'Nuestro grupo de danzas en desfile.'],
  ['pareja-cumbia', 'Orgullo caribe', 'Cumbia con el traje típico de nuestra región.'],
  ['traje-tipico', 'Sombrero vueltiao', 'Tradición que se lleva con orgullo.'],
  ['educacion-fisica-baile', 'Educación física', 'Movimiento, ritmo y trabajo en equipo.'],
  ['educacion-fisica', 'Cuerpo sano', 'Clase de educación física en la cancha.']
].map(([foto, titulo, texto]) => ({ foto: `/img/institucion/${foto}.jpg`, titulo, texto }));

router.get('/', comunes, (req, res) =>
  res.render('inicio', { titulo: 'Inicio', activo: 'inicio', portada: PORTADA, tradiciones: TRADICIONES }));

// ---------- Reiniciar el equipo ESP32 a distancia ----------
router.post('/admin/api/equipo/reiniciar', async (req, res) => {
  try {
    dispositivo.pedirReinicio();
    const e = await dispositivo.estado();
    res.json({ ok: true, enLinea: Boolean(e && e.enLinea) });
  } catch (err) {
    res.status(500).json({ mensaje: err.message });
  }
});

// ---------- Avisos push en el teléfono o PC del encargado ----------
router.get('/admin/api/push/clave', (req, res) => res.json({ clave: avisosPush.clavePublica }));

router.post('/admin/api/push/suscripcion', async (req, res) => {
  try {
    await avisosPush.guardar(req.usuario.id_personal, req.body && req.body.suscripcion, req.get('user-agent'));
    res.json({ ok: true });
    // Un aviso de prueba para que vea que llegan (no cuando solo se está sincronizando al abrir la app)
    if (!req.body.silencioso) avisosPush.prueba(req.usuario.id_personal);
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
});

router.delete('/admin/api/push/suscripcion', async (req, res) => {
  try {
    await avisosPush.quitar(req.body && req.body.endpoint);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
});

// Pases de los últimos minutos (llegadas y salidas hechas en el equipo, no las manuales).
// El panel pregunta seguido y anuncia con notificación y voz los que no ha visto.
router.get('/admin/api/eventos-recientes', async (req, res) => {
  try {
    const [f] = await pool.query(`
      SELECT r.id_asistencia, r.id_personal, r.estado_puntualidad,
             r.fecha_hora_entrada, r.metodo_ingreso, r.ruta_fotografia,
             r.fecha_hora_salida, r.metodo_salida, r.ruta_foto_salida,
             p.nombre_completo, p.rol, p.foto_perfil
        FROM registros_asistencia r JOIN personal p ON p.id_personal = r.id_personal
       WHERE r.fecha_hora_entrada >= NOW() - INTERVAL 10 MINUTE
          OR r.fecha_hora_salida >= NOW() - INTERVAL 10 MINUTE`);
    const eventos = [];
    const haceRato = Date.now() - 10 * 60 * 1000;
    f.forEach((r) => {
      const base = { id_asistencia: r.id_asistencia, id_personal: r.id_personal, nombre: r.nombre_completo, rol: r.rol, foto_perfil: r.foto_perfil };
      if (r.metodo_ingreso !== 'manual' && new Date(r.fecha_hora_entrada).getTime() >= haceRato) {
        eventos.push({ ...base, tipo: 'entrada', fecha: r.fecha_hora_entrada, metodo: r.metodo_ingreso,
          foto: r.ruta_fotografia, retardo: r.estado_puntualidad === 'retardo' });
      }
      if (r.fecha_hora_salida && r.metodo_salida !== 'manual' && new Date(r.fecha_hora_salida).getTime() >= haceRato) {
        eventos.push({ ...base, tipo: 'salida', fecha: r.fecha_hora_salida, metodo: r.metodo_salida, foto: r.ruta_foto_salida });
      }
    });
    eventos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    res.json(eventos);
  } catch (e) { responderError(res, e); }
});

// Datos del día para Inicio: asistencia de hoy, permisos vigentes y próximos días sin clase
router.get('/admin/api/inicio', async (req, res) => {
  try {
    const hoy = asistencias.hoyLocal();
    const dia = await asistencias.obtener(hoy, hoy);
    const [proximos] = await pool.query(`
      SELECT tipo, motivo, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS hasta
        FROM dias_sin_clase WHERE fecha_fin >= ? ORDER BY fecha_inicio LIMIT 3`, [hoy]);
    proximos.forEach((p) => { p.tipo_texto = asistencias.TIPOS_DIA[p.tipo]; });
    res.json({
      hoy,
      resumen: asistencias.resumen(dia),
      activos: dia.activos,
      diaSinClase: dia.diaSinClase,
      registros: dia.registros,
      permisos: dia.novedades.filter((n) => n.desde <= hoy && n.hasta >= hoy),
      proximos
    });
  } catch (e) { responderError(res, e); }
});

// ----- Hardware ESP32: componentes y conexiones (los pines son los de arduino/asistencia_savio.ino) -----
// bus: i2c | uart | spi | gpio | interno  (define el color de las líneas en el diagrama)
const COMPONENTES = [
  { id: 'esp32', nombre: 'ESP32-S3 WROOM-1 N16R8', apodo: 'El cerebro', foto: 'esp32-s3-cam.jpg', bus: 'interno',
    funcion: 'Lee los sensores, toma la foto, maneja la pantalla y se conecta por WiFi al servidor. Tiene dos núcleos: uno atiende los sensores y otro la red, por eso nunca se queda esperando.',
    datos: ['16 MB de memoria flash', '8 MB de PSRAM (para las fotos)', 'WiFi 2,4 GHz'],
    pines: [['Cámara · reloj', '15'], ['Cámara · control', '4 y 5'], ['Cámara · datos', '11, 9, 8, 10, 12, 18, 17, 16'], ['Cámara · sincronía', '6, 7 y 13']] },
  { id: 'huella', nombre: 'Sensor de huella R307', apodo: 'Identifica el dedo', foto: 'huella-r307.jpg', bus: 'uart',
    funcion: 'Guarda las huellas en su propia memoria (hasta 1000) y compara el dedo en menos de un segundo. El ESP32 solo recibe el número de la huella encontrada.',
    datos: ['Comunicación serial a 57 600 baudios', 'Se registra el índice derecho, dos veces'],
    pines: [['TX del sensor → RX', '41'], ['RX del sensor ← TX', '42']] },
  { id: 'rfid', nombre: 'Lector RFID RC522', apodo: 'Lee la tarjeta', foto: 'rfid-rc522.jpg', bus: 'spi',
    funcion: 'Lee tarjetas y llaveros de 13,56 MHz. Cada tarjeta trae de fábrica un código único que el sistema une a una persona.',
    datos: ['Bus SPI', 'Ganancia de antena al máximo'],
    pines: [['SDA (SS)', '21'], ['SCK', '39'], ['MOSI', '38'], ['MISO', '40'], ['RST', '14']] },
  { id: 'lcd', nombre: 'Pantalla LCD 16x2 con I2C', apodo: 'Habla con la persona', foto: 'lcd-16x2.jpg', bus: 'i2c',
    funcion: 'Muestra la hora, "Bienvenido(a)" con el nombre, la llegada o salida, y los mensajes del modo registro.',
    datos: ['Dirección I2C 0x27', 'Se refresca cada 30 s para evitar basura en pantalla'],
    pines: [['SDA', '1'], ['SCL', '2']] },
  { id: 'rtc', nombre: 'Reloj RTC DS3231', apodo: 'Guarda la hora', foto: 'rtc-ds3231.jpg', bus: 'i2c',
    funcion: 'Reloj de alta precisión con pila propia: mantiene la hora aunque se vaya la luz. Al encender, se pone en hora por internet.',
    datos: ['Comparte el bus I2C con la pantalla', 'Hora de Colombia (UTC-5)'],
    pines: [['SDA (compartido)', '1'], ['SCL (compartido)', '2']] },
  { id: 'buzzer', nombre: 'Buzzer pasivo', apodo: 'Avisa con sonido', foto: 'buzzer.jpg', bus: 'gpio',
    funcion: 'Un tono distinto para cada caso: acceso correcto, acceso denegado, error de conexión y cambio a modo registro.',
    datos: ['Tonos generados por el ESP32'],
    pines: [['Señal', '47']] }
];
router.get('/hardware', comunes, (req, res) =>
  res.render('hardware', { titulo: 'Hardware ESP32-S3', activo: 'hardware', componentes: COMPONENTES }));

// Estadísticas del equipo para la vista Hardware
router.get('/admin/api/hardware', async (req, res) => {
  try {
    const [[c]] = await pool.query(`
      SELECT (SELECT COUNT(*) FROM credenciales_biometricas WHERE id_huella_sensor IS NOT NULL) AS huellas,
             (SELECT COUNT(*) FROM credenciales_biometricas WHERE codigo_tarjeta_rfid IS NOT NULL) AS tarjetas,
             (SELECT COUNT(*) FROM registros_asistencia WHERE fecha_hora_entrada >= CURDATE()) AS pases_hoy,
             (SELECT COUNT(*) FROM registros_asistencia WHERE ruta_fotografia IS NOT NULL) AS fotos`);
    res.json(c);
  } catch (e) { responderError(res, e); }
});

// ----- Vistas de Docentes y Directivos (cada acción es su propia página) -----
const PERSONAL = { titulo: 'Docentes y Directivos', activo: 'personal' };
// Opciones de los combos del formulario
async function catalogos() {
  const [[horarios], [niveles], [grados], [asignaturas]] = await Promise.all([
    pool.query('SELECT id_horario, nombre_jornada, TIME_FORMAT(hora_entrada, "%H:%i") AS entrada FROM horarios ORDER BY hora_entrada'),
    pool.query('SELECT id_nivel, nombre, por_asignatura FROM niveles ORDER BY orden'),
    pool.query('SELECT id_grado, id_nivel, nombre FROM grados ORDER BY orden'),
    pool.query('SELECT id_asignatura, nombre FROM asignaturas ORDER BY nombre')
  ]);
  return { horarios, niveles, grados, asignaturas };
}

async function obtenerMiembro(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const [f] = await pool.query(SQL_LISTA + ' AND p.id_personal = ?', [id]);
  return f[0] || null;
}

function paginaError(res, e) {
  res.status(500).send('No se pudo cargar la página: ' + e.message);
}

router.get('/personal', comunes, async (req, res) => {
  try {
    const [niveles] = await pool.query('SELECT id_nivel, nombre FROM niveles ORDER BY orden');
    res.render('personal', { ...PERSONAL, niveles });
  } catch (e) { paginaError(res, e); }
});

router.get('/personal/nuevo', comunes, async (req, res) => {
  try {
    res.render('personal_form', {
      ...PERSONAL, migas: 'Nuevo miembro', m: null, ...(await catalogos()),
      volver: { url: '/personal', texto: 'Volver' }
    });
  } catch (e) { paginaError(res, e); }
});

router.get('/personal/:id', comunes, async (req, res, next) => {
  try {
    const m = await obtenerMiembro(req.params.id);
    if (!m) return next();
    res.render('personal_ficha', {
      ...PERSONAL, migas: m.nombre_completo, m, nuevo: req.query.nuevo === '1', guardado: req.query.guardado === '1',
      volver: { url: '/personal', texto: 'Volver' }
    });
  } catch (e) { paginaError(res, e); }
});

router.get('/personal/:id/editar', comunes, async (req, res, next) => {
  try {
    const m = await obtenerMiembro(req.params.id);
    if (!m) return next();
    // Vuelve a donde vino: la ficha (si entró desde ahí) o la lista
    const origen = req.query.desde === 'ficha' ? 'ficha' : 'lista';
    res.render('personal_form', {
      ...PERSONAL, migas: 'Editar datos', m, origen, ...(await catalogos()),
      volver: { url: origen === 'ficha' ? '/personal/' + m.id_personal : '/personal', texto: 'Volver' }
    });
  } catch (e) { paginaError(res, e); }
});

// ----- Vista de Asistencias -----
router.get('/asistencias', comunes, async (req, res) => {
  try {
    const [niveles] = await pool.query('SELECT id_nivel, nombre FROM niveles ORDER BY orden');
    res.render('asistencias', { titulo: 'Asistencias', activo: 'asistencias', niveles });
  } catch (e) { paginaError(res, e); }
});

// Historial de una persona, día por día (se abre al hacer clic en su fila de Asistencias)
router.get('/asistencias/persona/:id', comunes, async (req, res, next) => {
  try {
    const m = await obtenerMiembro(req.params.id);
    if (!m) return next();
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(req.query.dia || '') ? req.query.dia : '';
    res.render('asistencia_persona', {
      titulo: 'Asistencias', activo: 'asistencias', migas: m.nombre_completo, m,
      mesInicial: dia ? dia.slice(0, 7) : asistencias.hoyLocal().slice(0, 7),
      volver: { url: '/asistencias' + (dia ? '?dia=' + dia : ''), texto: 'Volver' }
    });
  } catch (e) { paginaError(res, e); }
});

router.get('/admin/api/asistencias/persona/:id', async (req, res) => {
  try {
    const hoy = asistencias.hoyLocal();
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoy.slice(0, 7);
    const inicio = mes + '-01';
    const [registros] = await pool.query(`
      SELECT id_asistencia, fecha_hora_entrada, fecha_hora_salida, metodo_ingreso, metodo_salida,
             estado_puntualidad, observacion, ruta_fotografia, ruta_foto_salida,
             TIMESTAMPDIFF(MINUTE, fecha_hora_entrada, fecha_hora_salida) AS minutos,
             DATE_FORMAT(fecha_hora_entrada, '%Y-%m-%d') AS dia
        FROM registros_asistencia
       WHERE id_personal = ? AND fecha_hora_entrada >= ? AND fecha_hora_entrada < ? + INTERVAL 1 MONTH
       ORDER BY fecha_hora_entrada`, [req.params.id, inicio, inicio]);
    // Desde cuándo cuentan las faltas: desde que se registró en el sistema (o su primer registro, si es anterior)
    const [[p]] = await pool.query(`
      SELECT DATE_FORMAT(LEAST(DATE(p.fecha_creacion),
               COALESCE((SELECT DATE(MIN(r.fecha_hora_entrada)) FROM registros_asistencia r WHERE r.id_personal = p.id_personal),
                        DATE(p.fecha_creacion))), '%Y-%m-%d') AS cuenta_desde
        FROM personal p WHERE p.id_personal = ?`, [req.params.id]);
    if (!p) return res.status(404).json({ mensaje: 'Miembro no encontrado.' });
    const [a, m] = mes.split('-').map(Number);
    const finMes = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
    const { novedades, sinClase } = await asistencias.calendario(inicio, finMes, Number(req.params.id));
    res.json({ mes, hoy, cuentaDesde: p.cuenta_desde, registros, novedades, sinClase });
  } catch (e) { responderError(res, e); }
});

// Registros entre dos fechas. Si es un solo día, también devuelve quién no ha llegado.
router.get('/admin/api/asistencias', async (req, res) => {
  try {
    const { desde, hasta } = asistencias.periodo(req.query);
    res.json(await asistencias.obtener(desde, hasta));
  } catch (e) { responderError(res, e); }
});

// Descargas: mismo periodo y filtros que se ven en pantalla
router.get('/admin/reportes/asistencia.:formato', async (req, res) => {
  const formato = req.params.formato;
  if (!['pdf', 'xlsx'].includes(formato)) return res.status(404).send('Formato no disponible');
  try {
    const { desde, hasta } = asistencias.periodo(req.query);
    const filtros = { q: req.query.q || '', nivel: req.query.nivel || '', estado: req.query.estado || '', persona: req.query.persona || '' };
    if (filtros.persona) {
      const m = await obtenerMiembro(filtros.persona);
      filtros.personaNombre = m ? m.nombre_completo : '';
    }
    const datos = asistencias.filtrar(await asistencias.obtener(desde, hasta), filtros);
    const [niveles] = await pool.query('SELECT id_nivel, nombre FROM niveles');
    if (formato === 'pdf') reportes.pdf(res, datos, filtros, niveles);
    else await reportes.excel(res, datos, filtros, niveles);
  } catch (e) {
    if (!res.headersSent) res.status(500).send('No se pudo generar el reporte: ' + e.message);
  }
});

// Borra un registro de asistencia y sus fotos (llegada y salida)
router.delete('/admin/api/asistencias/:id', async (req, res) => {
  try {
    const [f] = await pool.query(
      'SELECT ruta_fotografia, ruta_foto_salida FROM registros_asistencia WHERE id_asistencia = ?', [req.params.id]);
    if (!f.length) return res.status(404).json({ mensaje: 'El registro ya no existe.' });
    await pool.query('DELETE FROM registros_asistencia WHERE id_asistencia = ?', [req.params.id]);

    const carpeta = path.join(__dirname, '..', 'uploads');
    [f[0].ruta_fotografia, f[0].ruta_foto_salida].forEach((ruta) => {
      if (!ruta) return;
      const archivo = path.join(carpeta, path.basename(ruta));   // solo archivos dentro de /uploads
      fs.unlink(archivo, () => {});                                // si ya no está, no pasa nada
    });
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// ---------- API del panel (el ESP32 usa /api, el panel usa /admin/api) ----------
// "detalle" = lo que se muestra como cargo: asignatura o grado (docentes) / cargo escrito (directivos)
const SQL_LISTA = `
  SELECT p.id_personal, p.cedula, p.nombre_completo, p.correo, p.telefono, p.direccion, p.foto_perfil, p.rol, p.cargo_asignatura,
         p.id_nivel, p.id_grado, p.id_asignatura, n.nombre AS nivel, g.nombre AS grado, a.nombre AS asignatura,
         CASE WHEN p.rol = 'directivo' THEN p.cargo_asignatura ELSE COALESCE(a.nombre, g.nombre) END AS detalle,
         p.id_horario, p.activo, p.fecha_creacion, h.nombre_jornada,
         TIME_FORMAT(h.hora_entrada, '%H:%i') AS hora_entrada, TIME_FORMAT(h.hora_salida, '%H:%i') AS hora_salida,
         c.id_huella_sensor, c.codigo_tarjeta_rfid, c.tarjeta_activa
  FROM personal p
  LEFT JOIN niveles n ON n.id_nivel = p.id_nivel
  LEFT JOIN grados g ON g.id_grado = p.id_grado
  LEFT JOIN asignaturas a ON a.id_asignatura = p.id_asignatura
  LEFT JOIN horarios h ON h.id_horario = p.id_horario
  LEFT JOIN credenciales_biometricas c ON c.id_personal = p.id_personal
  WHERE p.rol IN ('docente', 'directivo')`;

const limpiar = (t) => String(t || '').trim().replace(/\s+/g, ' ');
const numero = (x) => (x === '' || x == null ? null : Number(x));

async function validar(b) {
  const nombre = limpiar(b.nombre_completo);
  const cedula = limpiar(b.cedula);
  const correo = limpiar(b.correo).toLowerCase();
  const telefono = limpiar(b.telefono);
  const direccion = limpiar(b.direccion);
  if (!nombre || !cedula || !correo || !telefono || !direccion) {
    return { error: 'Nombre, cédula, correo, teléfono y dirección son obligatorios.' };
  }
  if (!/^\d{5,15}$/.test(cedula)) return { error: 'La cédula debe tener solo números (entre 5 y 15 dígitos).' };
  if (!/^\S+@\S+\.\S+$/.test(correo)) return { error: 'El correo no tiene un formato válido.' };
  if (!/^\+?[\d\s-]{7,20}$/.test(telefono) || telefono.replace(/\D/g, '').length < 7) {
    return { error: 'El teléfono debe tener al menos 7 números.' };
  }
  if (!ROLES.includes(b.rol)) return { error: 'Seleccione un rol válido.' };

  const v = {
    nombre, cedula, correo, telefono, direccion, rol: b.rol,
    cargo: null, nivel: null, grado: null, asignatura: null,
    horario: numero(b.id_horario)
  };

  if (b.rol === 'directivo') {
    v.cargo = limpiar(b.cargo_asignatura) || null;
    if (!v.cargo) return { error: 'Escriba el cargo del directivo (ej. Rector, Coordinador).' };
    return { v };
  }

  // Docente: nivel obligatorio; grado (preescolar/primaria) o asignatura (bachillerato)
  const [niv] = await pool.query('SELECT por_asignatura FROM niveles WHERE id_nivel = ?', [numero(b.id_nivel)]);
  if (!niv.length) return { error: 'Seleccione el nivel en el que enseña el docente.' };
  v.nivel = numero(b.id_nivel);
  if (niv[0].por_asignatura) {
    const [a] = await pool.query('SELECT 1 FROM asignaturas WHERE id_asignatura = ?', [numero(b.id_asignatura)]);
    if (!a.length) return { error: 'Seleccione la asignatura que dicta.' };
    v.asignatura = numero(b.id_asignatura);
  } else {
    const [g] = await pool.query('SELECT 1 FROM grados WHERE id_grado = ? AND id_nivel = ?', [numero(b.id_grado), v.nivel]);
    if (!g.length) return { error: 'Seleccione el grado que tiene a cargo.' };
    v.grado = numero(b.id_grado);
  }
  return { v };
}

function responderError(res, e) {
  if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ mensaje: 'Ya existe un miembro con esa cédula o ese correo.' });
  res.status(500).json({ mensaje: e.message });
}

async function miembroActivo(id) {
  const [p] = await pool.query(
    "SELECT activo FROM personal WHERE id_personal = ? AND rol IN ('docente','directivo')", [id]
  );
  return p.length && p[0].activo;
}

// ----- Lista y ficha -----
router.get('/admin/api/personal', async (req, res) => {
  try {
    const [filas] = await pool.query(SQL_LISTA + ' ORDER BY p.activo DESC, p.nombre_completo');
    res.json(filas);
  } catch (e) { responderError(res, e); }
});

router.get('/admin/api/personal/:id', async (req, res) => {
  try {
    const [p] = await pool.query(SQL_LISTA + ' AND p.id_personal = ?', [req.params.id]);
    if (!p.length) return res.status(404).json({ mensaje: 'Miembro no encontrado.' });
    const [registros] = await pool.query(
      `SELECT id_asistencia, fecha_hora_entrada, fecha_hora_salida, metodo_ingreso, estado_puntualidad,
              ruta_fotografia, ruta_foto_salida
         FROM registros_asistencia WHERE id_personal = ? ORDER BY fecha_hora_entrada DESC LIMIT 6`,
      [req.params.id]
    );
    res.json({ ...p[0], registros });
  } catch (e) { responderError(res, e); }
});

// ----- Crear / editar / baja -----
router.post('/admin/api/personal', async (req, res) => {
  try {
    const { v, error } = await validar(req.body);
    if (error) return res.status(400).json({ mensaje: error });
    const clave = await bcrypt.hash(v.cedula, 10); // contraseña inicial = cédula
    const [r] = await pool.query(
      `INSERT INTO personal (cedula, nombre_completo, correo, telefono, direccion, contrasena, rol,
                             cargo_asignatura, id_nivel, id_grado, id_asignatura, id_horario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.cedula, v.nombre, v.correo, v.telefono, v.direccion, clave, v.rol,
       v.cargo, v.nivel, v.grado, v.asignatura, v.horario]
    );
    res.status(201).json({ ok: true, id_personal: r.insertId });
  } catch (e) { responderError(res, e); }
});

router.put('/admin/api/personal/:id', async (req, res) => {
  try {
    const { v, error } = await validar(req.body);
    if (error) return res.status(400).json({ mensaje: error });
    await pool.query(
      `UPDATE personal SET cedula=?, nombre_completo=?, correo=?, telefono=?, direccion=?, rol=?,
              cargo_asignatura=?, id_nivel=?, id_grado=?, id_asignatura=?, id_horario=?
       WHERE id_personal=? AND rol IN ('docente','directivo')`,
      [v.cedula, v.nombre, v.correo, v.telefono, v.direccion, v.rol,
       v.cargo, v.nivel, v.grado, v.asignatura, v.horario, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// ----- Foto de perfil (para el carnet). El navegador ya la manda recortada y en JPEG pequeño. -----
const CARPETA_PERFILES = path.join(__dirname, '..', 'uploads', 'perfiles');
if (!fs.existsSync(CARPETA_PERFILES)) fs.mkdirSync(CARPETA_PERFILES, { recursive: true });

function borrarArchivoPerfil(ruta) {
  if (!ruta) return;
  fs.unlink(path.join(CARPETA_PERFILES, path.basename(ruta)), () => {});   // solo dentro de uploads/perfiles
}

router.post('/admin/api/personal/:id/foto',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ mensaje: 'No llegó ninguna imagen.' });
    try {
      const [[p]] = await pool.query("SELECT foto_perfil FROM personal WHERE id_personal = ? AND rol IN ('docente','directivo')", [req.params.id]);
      if (!p) return res.status(404).json({ mensaje: 'Miembro no encontrado.' });
      const ext = req.headers['content-type'] === 'image/png' ? 'png' : req.headers['content-type'] === 'image/webp' ? 'webp' : 'jpg';
      const nombre = `perfil_${Number(req.params.id)}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(CARPETA_PERFILES, nombre), req.body);
      const ruta = `/uploads/perfiles/${nombre}`;
      await pool.query('UPDATE personal SET foto_perfil = ? WHERE id_personal = ?', [ruta, req.params.id]);
      borrarArchivoPerfil(p.foto_perfil);   // la anterior ya no se usa
      res.json({ ok: true, foto_perfil: ruta });
    } catch (e) { responderError(res, e); }
  });

router.delete('/admin/api/personal/:id/foto', async (req, res) => {
  try {
    const [[p]] = await pool.query('SELECT foto_perfil FROM personal WHERE id_personal = ?', [req.params.id]);
    if (!p) return res.status(404).json({ mensaje: 'Miembro no encontrado.' });
    await pool.query('UPDATE personal SET foto_perfil = NULL WHERE id_personal = ?', [req.params.id]);
    borrarArchivoPerfil(p.foto_perfil);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// Baja lógica: nunca se borra, para conservar el historial de asistencias
router.patch('/admin/api/personal/:id/estado', async (req, res) => {
  try {
    await pool.query(
      "UPDATE personal SET activo = ? WHERE id_personal = ? AND rol IN ('docente','directivo')",
      [req.body.activo ? 1 : 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// ----- Tarjeta RFID -----
// Escribir el código a mano (o dejarlo vacío para quitar la tarjeta)
router.put('/admin/api/personal/:id/tarjeta', async (req, res) => {
  const codigo = (req.body.codigo || '').trim().toUpperCase();
  if (codigo && !/^[0-9A-F]{4,20}$/.test(codigo)) {
    return res.status(400).json({ mensaje: 'El código solo lleva números y letras de la A a la F.' });
  }
  try {
    if (codigo) {
      const [otra] = await pool.query(
        `SELECT p.nombre_completo FROM credenciales_biometricas c JOIN personal p ON p.id_personal = c.id_personal
          WHERE c.codigo_tarjeta_rfid = ? AND c.id_personal <> ?`,
        [codigo, req.params.id]
      );
      if (otra.length) return res.status(409).json({ mensaje: `Esa tarjeta ya pertenece a ${otra[0].nombre_completo}.` });
    }
    await pool.query(
      `INSERT INTO credenciales_biometricas (id_personal, codigo_tarjeta_rfid, tarjeta_activa) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE codigo_tarjeta_rfid = VALUES(codigo_tarjeta_rfid), tarjeta_activa = 1`,
      [req.params.id, codigo || null]
    );
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// Bloquear / desbloquear (tarjeta perdida) sin perder el código
router.patch('/admin/api/personal/:id/tarjeta/estado', async (req, res) => {
  try {
    await pool.query('UPDATE credenciales_biometricas SET tarjeta_activa = ? WHERE id_personal = ?',
      [req.body.activa ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// Pone el ESP32 en modo "tarjeta": la próxima tarjeta que se pase queda asignada a esta persona
router.post('/admin/api/personal/:id/tarjeta/leer', async (req, res) => {
  try {
    if (!(await miembroActivo(req.params.id))) return res.status(400).json({ mensaje: 'El miembro no existe o está dado de baja.' });
    await dispositivo.ponerModo('tarjeta', req.params.id);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// ----- Huella -----
// Pone el ESP32 en modo registro; el equipo guarda la huella y llama a /api/registro-exitoso
router.post('/admin/api/personal/:id/huella', async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await miembroActivo(id))) return res.status(400).json({ mensaje: 'El miembro no existe o está dado de baja.' });

    const [c] = await pool.query('SELECT id_huella_sensor FROM credenciales_biometricas WHERE id_personal = ?', [id]);
    let idHuella = c.length ? c[0].id_huella_sensor : null;
    if (idHuella === null) {
      // El R307 guarda hasta 1000 plantillas (IDs 1..1000): se toma el primer ID libre
      const [usados] = await pool.query('SELECT id_huella_sensor AS n FROM credenciales_biometricas WHERE id_huella_sensor IS NOT NULL');
      const ocupados = new Set(usados.map((u) => u.n));
      idHuella = 1;
      while (ocupados.has(idHuella)) idHuella++;
      if (idHuella > 1000) return res.status(409).json({ mensaje: 'El sensor de huellas está lleno (1000 huellas).' });
    }
    await dispositivo.ponerModo('registro', id, idHuella);
    res.json({ ok: true, id_huella: idHuella });
  } catch (e) { responderError(res, e); }
});

// Desvincula la huella del miembro (la plantilla se sobrescribe cuando el ID se reutilice)
router.delete('/admin/api/personal/:id/huella', async (req, res) => {
  try {
    await pool.query('UPDATE credenciales_biometricas SET id_huella_sensor = NULL WHERE id_personal = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// ----- Equipo -----
router.get('/admin/api/dispositivo', async (req, res) => {
  try { res.json(await dispositivo.estado()); } catch (e) { responderError(res, e); }
});

router.delete('/admin/api/dispositivo/registro', async (req, res) => {
  try {
    await dispositivo.volverAsistencia('Registro cancelado desde el panel.', false);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// =====================================================================
//  REGISTRO MANUAL (corregir errores del equipo u olvidos)
// =====================================================================
const esHora = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
const esDia = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');

// Puntual o retardo según la jornada de la persona (igual que hace el equipo)
async function puntualidad(idPersonal, horaEntrada) {
  const [[h]] = await pool.query(
    `SELECT TIME_FORMAT(h.hora_entrada, '%H:%i') AS entrada, h.minutos_tolerancia AS tol
       FROM personal p LEFT JOIN horarios h ON h.id_horario = p.id_horario WHERE p.id_personal = ?`, [idPersonal]);
  if (!h || !h.entrada) return 'puntual';
  const min = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  return min(horaEntrada) > min(h.entrada) + (h.tol || 0) ? 'retardo' : 'puntual';
}

function validarManual(b) {
  if (!esHora(b.entrada)) return 'Escriba la hora de llegada.';
  if (b.salida && !esHora(b.salida)) return 'La hora de salida no es válida.';
  if (b.salida && b.salida <= b.entrada) return 'La salida debe ser después de la llegada.';
  if (String(b.observacion || '').trim().length < 4) return 'Escriba el motivo del registro manual (mínimo 4 letras).';
  return null;
}

router.post('/admin/api/asistencias/manual', async (req, res) => {
  const b = req.body;
  if (!esDia(b.dia)) return res.status(400).json({ mensaje: 'Elija el día.' });
  if (b.dia > asistencias.hoyLocal()) return res.status(400).json({ mensaje: 'No se puede registrar un día que todavía no llega.' });
  const error = validarManual(b);
  if (error) return res.status(400).json({ mensaje: error });
  try {
    if (!(await miembroActivo(b.id_personal))) return res.status(400).json({ mensaje: 'Elija un miembro activo.' });
    const [ya] = await pool.query(
      `SELECT id_asistencia FROM registros_asistencia
        WHERE id_personal = ? AND fecha_hora_entrada >= ? AND fecha_hora_entrada < ? + INTERVAL 1 DAY LIMIT 1`,
      [b.id_personal, b.dia, b.dia]);
    if (ya.length) {
      return res.status(409).json({ mensaje: 'Esa persona ya tiene registro ese día. Use "Corregir" en ese registro.', id_asistencia: ya[0].id_asistencia });
    }
    const [r] = await pool.query(
      `INSERT INTO registros_asistencia (id_personal, fecha_hora_entrada, fecha_hora_salida, metodo_ingreso, metodo_salida,
                                         estado_puntualidad, observacion)
       VALUES (?, ?, ?, 'manual', ?, ?, ?)`,
      [b.id_personal, `${b.dia} ${b.entrada}:00`, b.salida ? `${b.dia} ${b.salida}:00` : null, b.salida ? 'manual' : null,
       await puntualidad(b.id_personal, b.entrada), String(b.observacion).trim().slice(0, 255)]);
    res.status(201).json({ ok: true, id_asistencia: r.insertId });
  } catch (e) { responderError(res, e); }
});

// Corregir la hora de llegada o de salida de un registro existente
router.put('/admin/api/asistencias/:id', async (req, res) => {
  const b = req.body;
  const error = validarManual(b);
  if (error) return res.status(400).json({ mensaje: error });
  try {
    const [[r]] = await pool.query(
      `SELECT id_personal, DATE_FORMAT(fecha_hora_entrada, '%Y-%m-%d') AS dia,
              DATE_FORMAT(fecha_hora_entrada, '%H:%i') AS entrada, DATE_FORMAT(fecha_hora_salida, '%H:%i') AS salida,
              metodo_ingreso, metodo_salida, estado_puntualidad
         FROM registros_asistencia WHERE id_asistencia = ?`, [req.params.id]);
    if (!r) return res.status(404).json({ mensaje: 'El registro ya no existe.' });
    const cambiaEntrada = b.entrada !== r.entrada;
    const cambiaSalida = (b.salida || null) !== (r.salida || null);
    await pool.query(
      `UPDATE registros_asistencia
          SET fecha_hora_entrada = ?, metodo_ingreso = ?, estado_puntualidad = ?,
              fecha_hora_salida = ?, metodo_salida = ?, observacion = ?
        WHERE id_asistencia = ?`,
      [`${r.dia} ${b.entrada}:00`, cambiaEntrada ? 'manual' : r.metodo_ingreso,
       cambiaEntrada ? await puntualidad(r.id_personal, b.entrada) : r.estado_puntualidad,
       b.salida ? `${r.dia} ${b.salida}:00` : null, b.salida ? (cambiaSalida ? 'manual' : r.metodo_salida) : null,
       String(b.observacion).trim().slice(0, 255), req.params.id]);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// =====================================================================
//  NOVEDADES (permisos, incapacidades...) Y DÍAS SIN CLASE
// =====================================================================
router.get('/novedades', comunes, (req, res) =>
  res.render('novedades', { titulo: 'Novedades y calendario', activo: 'novedades',
    tiposNovedad: asistencias.TIPOS_NOVEDAD, tiposDia: asistencias.TIPOS_DIA }));

router.get('/admin/api/novedades', async (req, res) => {
  try {
    const [novedades] = await pool.query(`
      SELECT nv.id_novedad, nv.id_personal, nv.tipo, nv.observacion, p.nombre_completo, p.rol, p.foto_perfil,
             DATE_FORMAT(nv.fecha_inicio, '%Y-%m-%d') AS desde, DATE_FORMAT(nv.fecha_fin, '%Y-%m-%d') AS hasta
        FROM novedades nv JOIN personal p ON p.id_personal = nv.id_personal
       ORDER BY nv.fecha_inicio DESC`);
    const [dias] = await pool.query(`
      SELECT id_dia, tipo, motivo, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS hasta
        FROM dias_sin_clase ORDER BY fecha_inicio`);
    res.json({ hoy: asistencias.hoyLocal(), novedades, dias });
  } catch (e) { responderError(res, e); }
});

router.post('/admin/api/novedades', async (req, res) => {
  const b = req.body;
  if (!Object.keys(asistencias.TIPOS_NOVEDAD).includes(b.tipo)) return res.status(400).json({ mensaje: 'Elija el tipo de novedad.' });
  if (!esDia(b.desde) || !esDia(b.hasta)) return res.status(400).json({ mensaje: 'Elija las fechas.' });
  if (b.hasta < b.desde) return res.status(400).json({ mensaje: 'La fecha final no puede ser antes de la inicial.' });
  try {
    if (!(await miembroActivo(b.id_personal))) return res.status(400).json({ mensaje: 'Elija un miembro activo.' });
    const [r] = await pool.query(
      'INSERT INTO novedades (id_personal, tipo, fecha_inicio, fecha_fin, observacion) VALUES (?, ?, ?, ?, ?)',
      [b.id_personal, b.tipo, b.desde, b.hasta, String(b.observacion || '').trim().slice(0, 255) || null]);
    res.status(201).json({ ok: true, id_novedad: r.insertId });
  } catch (e) { responderError(res, e); }
});

router.delete('/admin/api/novedades/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM novedades WHERE id_novedad = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

router.post('/admin/api/dias-sin-clase', async (req, res) => {
  const b = req.body;
  if (!Object.keys(asistencias.TIPOS_DIA).includes(b.tipo)) return res.status(400).json({ mensaje: 'Elija el tipo.' });
  if (!esDia(b.desde) || !esDia(b.hasta || b.desde)) return res.status(400).json({ mensaje: 'Elija la fecha.' });
  const hasta = b.hasta || b.desde;
  if (hasta < b.desde) return res.status(400).json({ mensaje: 'La fecha final no puede ser antes de la inicial.' });
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 3) return res.status(400).json({ mensaje: 'Escriba el motivo (ej. Semana de receso).' });
  try {
    await pool.query('INSERT INTO dias_sin_clase (fecha_inicio, fecha_fin, tipo, motivo) VALUES (?, ?, ?, ?)',
      [b.desde, hasta, b.tipo, motivo.slice(0, 150)]);
    res.status(201).json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// Carga los festivos de Colombia de un año (no repite los que ya estén)
router.post('/admin/api/dias-sin-clase/festivos', async (req, res) => {
  const anio = Number(req.body.anio) || new Date().getFullYear();
  try {
    let nuevos = 0;
    for (const f of festivosColombia(anio)) {
      const [ya] = await pool.query("SELECT 1 FROM dias_sin_clase WHERE tipo = 'festivo' AND fecha_inicio = ?", [f.fecha]);
      if (ya.length) continue;
      await pool.query("INSERT INTO dias_sin_clase (fecha_inicio, fecha_fin, tipo, motivo) VALUES (?, ?, 'festivo', ?)",
        [f.fecha, f.fecha, f.motivo]);
      nuevos++;
    }
    res.json({ ok: true, nuevos, anio });
  } catch (e) { responderError(res, e); }
});

router.delete('/admin/api/dias-sin-clase/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM dias_sin_clase WHERE id_dia = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { responderError(res, e); }
});

// Lista corta de miembros activos para los selectores de las ventanas
router.get('/admin/api/miembros-activos', async (req, res) => {
  try {
    const [f] = await pool.query(`
      SELECT p.id_personal, p.nombre_completo, p.rol, n.nombre AS nivel
        FROM personal p LEFT JOIN niveles n ON n.id_nivel = p.id_nivel
       WHERE p.activo = 1 AND p.rol IN ('docente','directivo') ORDER BY p.nombre_completo`);
    res.json(f);
  } catch (e) { responderError(res, e); }
});

module.exports = router;
