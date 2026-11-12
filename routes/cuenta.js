// Ingreso al panel, "Mi cuenta" y encargados con acceso (solo rol administrador).
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/conexion_bd');
const sesion = require('../servicios/sesion');
const dispositivo = require('../servicios/dispositivo');

const router = express.Router();
const CLAVE_MINIMA = 8;

// Solo deja volver a direcciones del propio panel (evita redirecciones a otros sitios)
const destinoSeguro = (v) => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/');

// Compara la contraseña; acepta las antiguas sin cifrar y las cifra en el momento
async function claveCorrecta(usuario, clave) {
  const guardada = String(usuario.contrasena || '');
  if (guardada.startsWith('$2')) return bcrypt.compare(clave, guardada);
  if (guardada && guardada === clave) {
    const hash = await bcrypt.hash(clave, 10);
    await pool.query('UPDATE personal SET contrasena = ?, debe_cambiar_clave = 1 WHERE id_personal = ?', [hash, usuario.id_personal]);
    usuario.contrasena = hash;
    return true;
  }
  return false;
}

function validarClaveNueva(nueva, confirmar) {
  if (String(nueva || '').length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (nueva !== confirmar) return 'Las dos contraseñas no coinciden.';
  return null;
}

// ---------- Ingreso ----------
router.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/');
  res.render('login', { volver: destinoSeguro(req.query.volver) });
});

router.post('/login', async (req, res) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const clave = String(req.body.clave || '');
  if (!correo || !clave) return res.status(400).json({ mensaje: 'Escriba su correo y su contraseña.' });
  try {
    const [[usr]] = await pool.query(
      `SELECT id_personal, nombre_completo, contrasena, debe_cambiar_clave
         FROM personal WHERE correo = ? AND rol = 'administrador' AND activo = 1`, [correo]);
    // Mismo mensaje si el correo no existe o la clave está mal: no se revela cuál de los dos falló
    if (!usr || !(await claveCorrecta(usr, clave))) {
      return res.status(401).json({ mensaje: 'El correo o la contraseña no son correctos.' });
    }
    await pool.query('UPDATE personal SET ultimo_ingreso = NOW() WHERE id_personal = ?', [usr.id_personal]);
    sesion.crear(res, usr);
    const [[f]] = await pool.query('SELECT debe_cambiar_clave FROM personal WHERE id_personal = ?', [usr.id_personal]);
    res.json({ ok: true, destino: f.debe_cambiar_clave ? '/cuenta' : destinoSeguro(req.body.volver) });
  } catch (e) {
    res.status(500).json({ mensaje: 'No se pudo ingresar: ' + e.message });
  }
});

router.post('/salir', (req, res) => {
  sesion.cerrar(res);
  res.redirect('/login');
});

// ---------- Mi cuenta ----------
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

router.get('/cuenta', comunes, async (req, res) => {
  const [[u]] = await pool.query(
    'SELECT id_personal, nombre_completo, correo, ultimo_ingreso, debe_cambiar_clave FROM personal WHERE id_personal = ?',
    [req.usuario.id_personal]);
  res.render('cuenta', { titulo: 'Mi cuenta', activo: 'cuenta', yo: u });
});

router.post('/admin/api/cuenta/clave', async (req, res) => {
  const { actual, nueva, confirmar } = req.body;
  const error = validarClaveNueva(nueva, confirmar);
  if (error) return res.status(400).json({ mensaje: error });
  try {
    const [[usr]] = await pool.query('SELECT id_personal, contrasena FROM personal WHERE id_personal = ?', [req.usuario.id_personal]);
    if (!(await claveCorrecta(usr, String(actual || '')))) return res.status(400).json({ mensaje: 'La contraseña actual no es correcta.' });
    if (await bcrypt.compare(nueva, usr.contrasena)) return res.status(400).json({ mensaje: 'La nueva contraseña debe ser distinta a la actual.' });
    const hash = await bcrypt.hash(nueva, 10);
    await pool.query('UPDATE personal SET contrasena = ?, debe_cambiar_clave = 0 WHERE id_personal = ?', [hash, usr.id_personal]);
    sesion.crear(res, { id_personal: usr.id_personal, contrasena: hash });   // la sesión actual sigue abierta
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ mensaje: e.message }); }
});

// ---------- Encargados con acceso al panel ----------
router.get('/admin/api/encargados', async (req, res) => {
  try {
    const [f] = await pool.query(`
      SELECT id_personal, nombre_completo, correo, ultimo_ingreso, debe_cambiar_clave
        FROM personal WHERE rol = 'administrador' AND activo = 1 ORDER BY nombre_completo`);
    res.json(f.map((x) => ({ ...x, soy_yo: x.id_personal === req.usuario.id_personal })));
  } catch (e) { res.status(500).json({ mensaje: e.message }); }
});

router.post('/admin/api/encargados', async (req, res) => {
  const nombre = String(req.body.nombre || '').trim().replace(/\s+/g, ' ');
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const cedula = String(req.body.cedula || '').trim();
  const clave = String(req.body.clave || '');
  if (!nombre || !correo || !cedula) return res.status(400).json({ mensaje: 'Nombre, cédula y correo son obligatorios.' });
  if (!/^\d{5,15}$/.test(cedula)) return res.status(400).json({ mensaje: 'La cédula debe tener solo números (entre 5 y 15).' });
  if (!/^\S+@\S+\.\S+$/.test(correo)) return res.status(400).json({ mensaje: 'El correo no tiene un formato válido.' });
  if (clave.length < CLAVE_MINIMA) return res.status(400).json({ mensaje: `La contraseña temporal debe tener al menos ${CLAVE_MINIMA} caracteres.` });
  try {
    const hash = await bcrypt.hash(clave, 10);
    await pool.query(
      `INSERT INTO personal (cedula, nombre_completo, correo, contrasena, debe_cambiar_clave, rol)
       VALUES (?, ?, ?, ?, 1, 'administrador')`, [cedula, nombre, correo, hash]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ mensaje: 'Ya existe una persona con esa cédula o ese correo.' });
    res.status(500).json({ mensaje: e.message });
  }
});

// Restablecer la contraseña de otro encargado (le queda temporal: debe cambiarla al entrar)
router.post('/admin/api/encargados/:id/clave', async (req, res) => {
  const clave = String(req.body.clave || '');
  if (clave.length < CLAVE_MINIMA) return res.status(400).json({ mensaje: `La contraseña temporal debe tener al menos ${CLAVE_MINIMA} caracteres.` });
  if (Number(req.params.id) === req.usuario.id_personal) return res.status(400).json({ mensaje: 'Para su propia contraseña use "Cambiar contraseña".' });
  try {
    const hash = await bcrypt.hash(clave, 10);
    const [r] = await pool.query(
      "UPDATE personal SET contrasena = ?, debe_cambiar_clave = 1 WHERE id_personal = ? AND rol = 'administrador'", [hash, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ mensaje: 'Encargado no encontrado.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ mensaje: e.message }); }
});

// Quitar el acceso (no se borra: se desactiva, por si hay que reactivarlo)
router.delete('/admin/api/encargados/:id', async (req, res) => {
  if (Number(req.params.id) === req.usuario.id_personal) return res.status(400).json({ mensaje: 'No puede quitarse el acceso a sí mismo.' });
  try {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM personal WHERE rol = 'administrador' AND activo = 1");
    if (n <= 1) return res.status(400).json({ mensaje: 'Debe quedar al menos un encargado con acceso.' });
    await pool.query("UPDATE personal SET activo = 0 WHERE id_personal = ? AND rol = 'administrador'", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ mensaje: e.message }); }
});

module.exports = router;
