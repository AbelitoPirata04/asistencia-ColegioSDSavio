// Sesión del panel con una cookie firmada (sin guardar nada en el servidor).
//
// La cookie lleva: id del usuario + vencimiento, firmados con HMAC-SHA256.
// La firma usa la clave secreta del .env MÁS un pedazo del hash de la contraseña del usuario:
// si alguien cambia su contraseña, todas sus sesiones abiertas dejan de servir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../config/conexion_bd');   // carga el .env

const COOKIE = 'savio_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000;             // 12 horas

// Clave secreta para firmar. Si no existe, se crea una vez y se guarda en el .env
function claveSecreta() {
  if (process.env.SESION_SECRETO && process.env.SESION_SECRETO.length >= 32) return process.env.SESION_SECRETO;
  const nueva = crypto.randomBytes(48).toString('hex');
  try {
    fs.appendFileSync(path.join(__dirname, '..', '.env'),
      `\n# Clave para firmar las sesiones del panel (no compartir)\nSESION_SECRETO=${nueva}\n`);
  } catch (e) { console.warn('No se pudo guardar SESION_SECRETO en .env; las sesiones se cerrarán al reiniciar.'); }
  process.env.SESION_SECRETO = nueva;
  return nueva;
}
const SECRETO = claveSecreta();

const b64 = (s) => Buffer.from(s).toString('base64url');
const firmar = (datos, hashClave) =>
  crypto.createHmac('sha256', SECRETO + String(hashClave).slice(-16)).update(datos).digest('base64url');

function leerCookies(req) {
  const salida = {};
  String(req.headers.cookie || '').split(';').forEach((par) => {
    const i = par.indexOf('=');
    if (i > 0) salida[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  });
  return salida;
}

function crear(res, usuario) {
  const datos = b64(JSON.stringify({ u: usuario.id_personal, e: Date.now() + DURACION_MS }));
  const token = `${datos}.${firmar(datos, usuario.contrasena)}`;
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: DURACION_MS, path: '/' });
}

function cerrar(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Lee la cookie y deja en req.usuario al administrador (o null)
async function leerUsuario(req, res, next) {
  req.usuario = null;
  const token = leerCookies(req)[COOKIE];
  if (token && token.includes('.')) {
    try {
      const [datos, firma] = token.split('.');
      const { u, e } = JSON.parse(Buffer.from(datos, 'base64url').toString());
      if (e > Date.now()) {
        const [[usr]] = await pool.query(
          `SELECT id_personal, nombre_completo, correo, contrasena, debe_cambiar_clave
             FROM personal WHERE id_personal = ? AND rol = 'administrador' AND activo = 1`, [u]);
        const esperada = usr && firmar(datos, usr.contrasena);
        if (esperada && esperada.length === firma.length &&
            crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) {
          delete usr.contrasena;
          req.usuario = usr;
        }
      }
    } catch (err) { /* cookie dañada o vencida: queda sin sesión */ }
  }
  res.locals.usuario = req.usuario;
  next();
}

// Rutas que no piden sesión: el equipo ESP32 (/api) y la página de ingreso
const LIBRES = [/^\/api\//, /^\/login(\/|$)/];
// Con contraseña temporal solo se puede ir a "Mi cuenta" (para cambiarla) o salir
const CON_CLAVE_TEMPORAL = [/^\/cuenta$/, /^\/admin\/api\/cuenta\/clave$/, /^\/salir$/];

function exigir(req, res, next) {
  if (LIBRES.some((r) => r.test(req.path))) return next();
  const esApi = req.path.startsWith('/admin/') || req.path.startsWith('/uploads/');
  if (!req.usuario) {
    if (esApi) return res.status(401).json({ mensaje: 'La sesión terminó. Vuelva a ingresar.' });
    return res.redirect('/login?volver=' + encodeURIComponent(req.originalUrl));
  }
  if (req.usuario.debe_cambiar_clave && !CON_CLAVE_TEMPORAL.some((r) => r.test(req.path))) {
    if (esApi) return res.status(403).json({ mensaje: 'Primero cambie su contraseña en "Mi cuenta".' });
    return res.redirect('/cuenta');
  }
  next();
}

module.exports = { crear, cerrar, leerUsuario, exigir };
