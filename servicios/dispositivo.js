// Estado del ESP32-S3: lo usan la API del equipo (servidor.js) y el panel (routes/panel.js).
const { pool } = require('../config/conexion_bd');

const LIMITE_MODO_SEG = 120;   // si nadie completa el registro en 2 min, el equipo vuelve a asistencia
const EN_LINEA_SEG = 20;       // el ESP32 pregunta el modo cada 3 s

async function volverAsistencia(resultado = null, ok = null) {
  await pool.query(
    `UPDATE estado_dispositivo
        SET modo_actual = 'asistencia', id_personal_enrolando = NULL, id_huella_asignar = NULL,
            modo_desde = NULL, resultado_enrolamiento = ?, resultado_ok = ?
      WHERE id_dispositivo = 1`,
    [resultado, ok === null ? null : (ok ? 1 : 0)]
  );
}

async function ponerModo(modo, idPersonal, idHuella = null) {
  await pool.query(
    `UPDATE estado_dispositivo
        SET modo_actual = ?, id_personal_enrolando = ?, id_huella_asignar = ?,
            modo_desde = NOW(), resultado_enrolamiento = NULL, resultado_ok = NULL
      WHERE id_dispositivo = 1`,
    [modo, idPersonal, idHuella]
  );
}

async function estado() {
  const [f] = await pool.query(`
    SELECT e.modo_actual AS modo, e.id_personal_enrolando, e.id_huella_asignar,
           e.resultado_enrolamiento AS resultado, e.resultado_ok,
           TIMESTAMPDIFF(SECOND, e.ultima_conexion, NOW()) AS seg_conexion,
           TIMESTAMPDIFF(SECOND, e.modo_desde, NOW()) AS seg_modo,
           (e.ultima_conexion >= e.modo_desde) AS equipo_enterado,
           p.nombre_completo AS nombre_enrolando
      FROM estado_dispositivo e
      LEFT JOIN personal p ON p.id_personal = e.id_personal_enrolando
     WHERE e.id_dispositivo = 1`);
  const e = f[0];
  if (!e) return null;

  if (e.modo !== 'asistencia' && (e.seg_modo === null || e.seg_modo > LIMITE_MODO_SEG)) {
    await volverAsistencia('Se acabó el tiempo de espera y el equipo volvió a modo asistencia.', false);
    return estado();
  }

  return {
    enLinea: e.seg_conexion !== null && e.seg_conexion < EN_LINEA_SEG,
    seg_conexion: e.seg_conexion,            // segundos desde la última señal del equipo
    modo: e.modo,
    id_personal: e.id_personal_enrolando,
    nombre: e.nombre_enrolando,
    id_huella: e.id_huella_asignar,
    equipo_enterado: !!e.equipo_enterado,
    seg_restantes: e.modo === 'asistencia' ? null : Math.max(0, LIMITE_MODO_SEG - e.seg_modo),
    resultado: e.resultado,
    resultado_ok: e.resultado_ok === null ? null : !!e.resultado_ok
  };
}

// El equipo está en modo "tarjeta" y alguien pasó una tarjeta por el lector
async function asignarTarjeta(uidCrudo) {
  const uid = String(uidCrudo || '').trim().toUpperCase();
  const e = await estado();
  if (!e || e.modo !== 'tarjeta' || !e.id_personal) {
    return { codigo: 409, mensaje: 'El equipo no está esperando una tarjeta.' };
  }
  if (!/^[0-9A-F]{4,20}$/.test(uid)) return { codigo: 400, mensaje: 'Código de tarjeta inválido.' };

  const [otra] = await pool.query(
    `SELECT p.nombre_completo FROM credenciales_biometricas c
       JOIN personal p ON p.id_personal = c.id_personal
      WHERE c.codigo_tarjeta_rfid = ? AND c.id_personal <> ?`,
    [uid, e.id_personal]
  );
  if (otra.length) {
    // Se queda esperando: el operador puede pasar otra tarjeta
    await pool.query(
      'UPDATE estado_dispositivo SET resultado_enrolamiento = ?, resultado_ok = 0 WHERE id_dispositivo = 1',
      [`La tarjeta ${uid} ya pertenece a ${otra[0].nombre_completo}. Pase otra tarjeta.`]
    );
    return { codigo: 409, mensaje: 'Tarjeta de otra persona' };
  }

  await pool.query(
    `INSERT INTO credenciales_biometricas (id_personal, codigo_tarjeta_rfid, tarjeta_activa) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE codigo_tarjeta_rfid = VALUES(codigo_tarjeta_rfid), tarjeta_activa = 1`,
    [e.id_personal, uid]
  );
  await volverAsistencia(`Tarjeta ${uid} asignada a ${e.nombre}.`, true);
  return { codigo: 200, mensaje: 'Tarjeta asignada', uid, nombre_lcd: nombreLcd(e.nombre) };
}

// La pantalla 16x2 no muestra tildes ni ñ: "Carlos Andrés Mendoza" -> "Carlos Andres"
function nombreLcd(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
    .slice(0, 16);
}

module.exports = { estado, ponerModo, volverAsistencia, asignarTarjeta, nombreLcd };
