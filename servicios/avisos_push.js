// Notificaciones push: avisan al teléfono (o al PC) del encargado cuando alguien llega o sale,
// aunque la app esté cerrada. Cada dispositivo que activa los avisos queda guardado en "suscripciones_push".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const { pool } = require('../config/conexion_bd');   // carga el .env

// Claves VAPID (identifican a este servidor ante Google, Apple y Mozilla).
// Si no existen, se crean una vez y se guardan en el .env
function claves() {
  if (process.env.PUSH_PUBLICA && process.env.PUSH_PRIVADA) {
    return { publicKey: process.env.PUSH_PUBLICA, privateKey: process.env.PUSH_PRIVADA };
  }
  const nuevas = webpush.generateVAPIDKeys();
  try {
    fs.appendFileSync(path.join(__dirname, '..', '.env'),
      `\n# Claves de las notificaciones push (no compartir la privada)\nPUSH_PUBLICA=${nuevas.publicKey}\nPUSH_PRIVADA=${nuevas.privateKey}\n`);
  } catch (e) { console.warn('No se pudieron guardar las claves push en .env; los avisos se perderán al reiniciar.'); }
  process.env.PUSH_PUBLICA = nuevas.publicKey;
  process.env.PUSH_PRIVADA = nuevas.privateKey;
  return nuevas;
}
const CLAVES = claves();
webpush.setVapidDetails('mailto:asistencia@savio.edu.co', CLAVES.publicKey, CLAVES.privateKey);

// La tabla se crea sola la primera vez (también está en sql/migracion_07_push.sql)
const listo = pool.query(`
  CREATE TABLE IF NOT EXISTS suscripciones_push (
    id_suscripcion INT AUTO_INCREMENT PRIMARY KEY,
    id_personal INT NOT NULL,
    huella_endpoint CHAR(64) NOT NULL UNIQUE,
    endpoint TEXT NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    dispositivo VARCHAR(160) NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT suscripciones_personal_fk FOREIGN KEY (id_personal) REFERENCES personal (id_personal) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((e) => console.error('Tabla de avisos push:', e.message));

const huella = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex');

async function guardar(idPersonal, sub, agente) {
  await listo;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw new Error('Suscripción incompleta');
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('Suscripción no válida');
  await pool.query(
    `INSERT INTO suscripciones_push (id_personal, huella_endpoint, endpoint, p256dh, auth, dispositivo)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id_personal = VALUES(id_personal), p256dh = VALUES(p256dh), auth = VALUES(auth), dispositivo = VALUES(dispositivo)`,
    [idPersonal, huella(sub.endpoint), sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(agente || '').slice(0, 160)]
  );
}

async function quitar(endpoint) {
  await listo;
  await pool.query('DELETE FROM suscripciones_push WHERE huella_endpoint = ?', [huella(endpoint)]);
}

// Envía a todos los encargados activos (o solo a uno, con soloPersona).
// Los dispositivos que ya no existen se borran solos.
async function enviar(aviso, soloPersona) {
  await listo;
  const [subs] = await pool.query(
    `SELECT s.id_suscripcion, s.endpoint, s.p256dh, s.auth
       FROM suscripciones_push s JOIN personal p ON p.id_personal = s.id_personal
      WHERE p.activo = 1 AND p.rol = 'administrador' ${soloPersona ? 'AND p.id_personal = ?' : ''}`, soloPersona ? [soloPersona] : []);
  const datos = JSON.stringify(aviso);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, datos,
        { TTL: 60 * 60, urgency: 'high', topic: aviso.tema });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await pool.query('DELETE FROM suscripciones_push WHERE id_suscripcion = ?', [s.id_suscripcion]);
      } else {
        console.warn('Aviso push no enviado:', e.statusCode || e.message);
      }
    }
  }));
}

const METODO = { huella: 'huella', rfid: 'tarjeta', manual: 'registro manual' };
const horaCorta = (f) => new Date(f).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' });

// Llegada o salida marcada en el equipo
function pase({ tipo, idPersonal, nombre, idAsistencia, fecha, metodo, estado }) {
  const llegada = tipo === 'entrada';
  return enviar({
    titulo: `${llegada ? 'Llegó' : 'Salió'} ${nombre}`,
    cuerpo: `${horaCorta(fecha)} · ${llegada ? (estado === 'retardo' ? 'Con retardo' : 'A tiempo') + ' · ' : ''}con ${METODO[metodo] || metodo}`,
    url: `/asistencias/persona/${idPersonal}`,
    tema: `pase-${idAsistencia}-${llegada ? 'e' : 's'}`
  }).catch((e) => console.warn('Avisos push:', e.message));
}

// Aviso de prueba para el encargado que acaba de activar los avisos
function prueba(idPersonal) {
  return enviar({ titulo: 'Avisos activados', cuerpo: 'Así le llegará cada llegada y salida del equipo.', url: '/', tema: 'prueba' }, idPersonal);
}

module.exports = { clavePublica: CLAVES.publicKey, guardar, quitar, enviar, pase, prueba };
