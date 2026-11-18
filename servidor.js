const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { pool, probarConexion } = require('./config/conexion_bd');
const dispositivo = require('./servicios/dispositivo');
const sesion = require('./servicios/sesion');
const avisosPush = require('./servicios/avisos_push');

const app = express();
// Un 2.º pase antes de este tiempo se toma como error y el equipo pide pasar otra vez para salir
const SALIDA_MINIMA_SEG = 3 * 60;
const PUERTO = process.env.PORT || 3000;

const carpetaFotos = path.join(__dirname, 'uploads');
if (!fs.existsSync(carpetaFotos)) {
  fs.mkdirSync(carpetaFotos);
}

app.use('/api', cors());                     // solo la API del equipo ESP32; el panel no necesita CORS
app.use(express.json({ limit: '10mb' }));
app.use('/api/fotos', express.raw({ type: 'image/jpeg', limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));   // CSS, JS, imágenes (sin sesión)
// La app Android (.apk) comprueba aquí que esta página es suya, para abrirse sin barra de dirección
app.use('/.well-known', express.static(path.join(__dirname, 'public', 'well-known')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ----- Inicio de sesión: todo lo que sigue pide sesión, menos /api (equipo) y /login -----
app.use((req, res, next) => (req.path.startsWith('/api/') ? next() : sesion.leerUsuario(req, res, next)));
app.use(sesion.exigir);
app.use('/uploads', express.static(carpetaFotos));       // fotos de personas: solo con sesión
app.use('/', require('./routes/cuenta'));
app.use('/', require('./routes/panel'));

// 1. Ruta para que el ESP32 pregunte el modo (asistencia, registro o tarjeta)
app.get('/api/modo', async (req, res) => {
  try {
    await pool.query('UPDATE estado_dispositivo SET ultima_conexion = NOW() WHERE id_dispositivo = 1');
    const e = await dispositivo.estado();
    res.status(200).json({ modo: e.modo, id: e.id_huella, nombre_lcd: dispositivo.nombreLcd(e.nombre) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1b. El ESP32 (en modo tarjeta) envía el UID que acaba de leer: { "uid": "A1B2C3D4" }
app.post('/api/tarjeta-leida', async (req, res) => {
  try {
    const r = await dispositivo.asignarTarjeta(req.body.uid);
    res.status(r.codigo).json(r);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1c. Durante un registro, el sensor encontró el dedo ya guardado en otro ID: ¿ese ID es de alguien?
//     Si no es de nadie, el equipo lo borra del sensor y sigue con el registro.
app.get('/api/huella-estado', async (req, res) => {
  try {
    const [c] = await pool.query(
      `SELECT p.nombre_completo FROM credenciales_biometricas c JOIN personal p ON p.id_personal = c.id_personal
        WHERE c.id_huella_sensor = ?`, [req.query.id]);
    res.json({ asignada: c.length > 0, nombre_lcd: c.length ? dispositivo.nombreLcd(c[0].nombre_completo) : '' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Ruta para registrar asistencia desde Huella o RFID
app.post('/api/asistencias', async (req, res) => {
  try {
    const { tipo, identificador, timestamp } = req.body;
    console.log(`📡 Lectura desde ESP32 -> Método: ${tipo} | ID: ${identificador}`);

    // Compatibilidad con el firmware actual: si el panel pidió "leer tarjeta",
    // la tarjeta que llegue aquí se asigna en vez de marcar asistencia.
    if (tipo === 'rfid') {
      const e = await dispositivo.estado();
      if (e && e.modo === 'tarjeta') {
        const r = await dispositivo.asignarTarjeta(identificador);
        return res.status(r.codigo).json(r);
      }
    }

    let sql = `
      SELECT p.*, h.hora_entrada, h.minutos_tolerancia 
      FROM personal p
      INNER JOIN credenciales_biometricas c ON p.id_personal = c.id_personal
      LEFT JOIN horarios h ON p.id_horario = h.id_horario
      WHERE p.activo = 1 AND 
    `;
    sql += (tipo === 'huella') 
      ? 'c.id_huella_sensor = ?' 
      : 'c.codigo_tarjeta_rfid = ? AND c.tarjeta_activa = 1';

    const [docentes] = await pool.query(sql, [identificador]);

    if (docentes.length === 0) {
      // Huella "huérfana": está guardada en el sensor pero no pertenece a nadie en la base de datos
      // (pruebas viejas o una huella que se quitó desde el panel). El equipo la borra del sensor.
      let huerfana = false;
      if (tipo === 'huella') {
        const [c] = await pool.query('SELECT 1 FROM credenciales_biometricas WHERE id_huella_sensor = ?', [identificador]);
        huerfana = c.length === 0;
      }
      return res.status(403).json({ mensaje: 'No autorizado', huerfana });
    }

    const docente = docentes[0];
    const ahora = timestamp ? new Date(timestamp) : new Date();
    const base = { docente: docente.nombre_completo, nombre_lcd: dispositivo.nombreLcd(docente.nombre_completo) };

    // ¿Ya tiene registro hoy? (el más reciente del día)
    const [hoy] = await pool.query(
      `SELECT id_asistencia, fecha_hora_salida, TIMESTAMPDIFF(SECOND, fecha_hora_entrada, ?) AS seg
         FROM registros_asistencia
        WHERE id_personal = ? AND fecha_hora_entrada >= CURDATE() AND fecha_hora_entrada < CURDATE() + INTERVAL 1 DAY
        ORDER BY id_asistencia DESC LIMIT 1`,
      [ahora, docente.id_personal]
    );

    // ---- 1.er pase del día: LLEGADA ----
    if (!hoy.length) {
      let puntualidad = 'puntual';
      if (docente.hora_entrada) {
        const [h, m] = docente.hora_entrada.split(':').map(Number);
        const horaLimite = new Date(ahora);
        horaLimite.setHours(h, m + (docente.minutos_tolerancia || 0), 0, 0);
        if (ahora > horaLimite) puntualidad = 'retardo';
      }
      const [ins] = await pool.query(
        `INSERT INTO registros_asistencia (id_personal, fecha_hora_entrada, metodo_ingreso, estado_puntualidad)
         VALUES (?, ?, ?, ?)`,
        [docente.id_personal, ahora, tipo, puntualidad]
      );
      console.log(`✅ Llegada: ${docente.nombre_completo} (${puntualidad})`);
      // id_asistencia: el equipo lo manda con la foto para pegarla a este registro
      res.status(201).json({ ...base, accion: 'entrada', id_asistencia: ins.insertId, estado: puntualidad });
      // Aviso al teléfono del encargado (después de responder: el equipo no espera)
      avisosPush.pase({ tipo: 'entrada', idPersonal: docente.id_personal, nombre: docente.nombre_completo,
        idAsistencia: ins.insertId, fecha: ahora, metodo: tipo, estado: puntualidad });
      return;
    }

    const reg = hoy[0];

    // ---- 3.er pase: ya tiene llegada y salida ----
    if (reg.fecha_hora_salida) {
      return res.status(200).json({ ...base, accion: 'ya_salio', id_asistencia: reg.id_asistencia });
    }

    // ---- 2.º pase antes de 3 min sin confirmar: el equipo pide pasar otra vez ----
    if (reg.seg < SALIDA_MINIMA_SEG && !req.body.confirmar) {
      return res.status(200).json({ ...base, accion: 'confirmar_salida', id_asistencia: reg.id_asistencia });
    }

    // ---- 2.º pase: SALIDA ----
    await pool.query(
      'UPDATE registros_asistencia SET fecha_hora_salida = ?, metodo_salida = ? WHERE id_asistencia = ?',
      [ahora, tipo, reg.id_asistencia]
    );
    console.log(`👋 Salida: ${docente.nombre_completo}`);
    res.status(201).json({ ...base, accion: 'salida', id_asistencia: reg.id_asistencia });
    avisosPush.pase({ tipo: 'salida', idPersonal: docente.id_personal, nombre: docente.nombre_completo,
      idAsistencia: reg.id_asistencia, fecha: ahora, metodo: tipo });
    return;
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Ruta para recibir la foto de la cámara del ESP32-S3
app.post('/api/fotos', async (req, res) => {
  try {
    const { tipo, identificador } = req.query;
    const idAsistencia = Number(req.query.id_asistencia) || 0;
    const columnaFoto = req.query.momento === 'salida' ? 'ruta_foto_salida' : 'ruta_fotografia';
    if (!req.body || !req.body.length) return res.status(400).send('Sin foto');

    const seguro = (t) => String(t || '').replace(/[^0-9A-Za-z_-]/g, '');   // nombre de archivo sin caracteres raros
    const nombreFoto = `foto_${seguro(tipo)}_${seguro(identificador)}_${Date.now()}.jpg`;
    fs.writeFileSync(path.join(carpetaFotos, nombreFoto), req.body);
    console.log(`📷 Foto recibida (${req.body.length} bytes) -> registro ${idAsistencia || 'último'}`);

    // Firmware nuevo: manda el número exacto del registro
    if (idAsistencia) {
      await pool.query(`UPDATE registros_asistencia SET ${columnaFoto} = ? WHERE id_asistencia = ?`,
        [`/uploads/${nombreFoto}`, idAsistencia]);
      return res.status(200).json({ ok: true });
    }

    // Firmware viejo: se pega al último registro de esa persona
    const columna = (tipo === 'huella') ? 'id_huella_sensor' : 'codigo_tarjeta_rfid';
    const [cred] = await pool.query(`SELECT id_personal FROM credenciales_biometricas WHERE ${columna} = ?`, [identificador]);

    if (cred.length > 0) {
      await pool.query(
        `UPDATE registros_asistencia SET ruta_fotografia = ? WHERE id_personal = ? ORDER BY id_asistencia DESC LIMIT 1`,
        [`/uploads/${nombreFoto}`, cred[0].id_personal]
      );
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Ruta cuando el ESP32 termina de guardar una huella nueva
app.get('/api/registro-exitoso', async (req, res) => {
  try {
    const [estados] = await pool.query('SELECT * FROM estado_dispositivo WHERE id_dispositivo = 1');
    const est = estados[0];

    if (est && est.modo_actual === 'registro' && est.id_personal_enrolando && est.id_huella_asignar) {
      await pool.query(
        `INSERT INTO credenciales_biometricas (id_personal, id_huella_sensor) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id_huella_sensor = VALUES(id_huella_sensor)`,
        [est.id_personal_enrolando, est.id_huella_asignar]
      );
      await dispositivo.volverAsistencia(`Huella guardada en el sensor con el ID ${est.id_huella_asignar}.`, true);
    } else {
      await dispositivo.volverAsistencia();
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PUERTO, '0.0.0.0', async () => {
  console.log('====================================================');
  console.log(`Servidor listo en: http://localhost:${PUERTO}`);
  await probarConexion();
  console.log('====================================================');
});