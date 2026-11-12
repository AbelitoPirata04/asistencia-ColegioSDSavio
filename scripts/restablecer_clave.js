// Restablece la contraseña de un encargado desde la terminal (por si nadie puede entrar al panel).
//
//   node scripts/restablecer_clave.js correo@savio.edu.co ClaveTemporal123
//
// La contraseña queda como temporal: al ingresar, el panel pide cambiarla.
const bcrypt = require('bcryptjs');
const { pool } = require('../config/conexion_bd');

(async () => {
  const [correo, clave] = process.argv.slice(2);
  try {
    if (!correo || !clave) {
      console.log('Uso: node scripts/restablecer_clave.js correo@savio.edu.co ClaveTemporal123');
      return;
    }
    if (clave.length < 8) { console.log('La contraseña debe tener al menos 8 caracteres.'); return; }
    const hash = await bcrypt.hash(clave, 10);
    const [r] = await pool.query(
      `UPDATE personal SET contrasena = ?, debe_cambiar_clave = 1, activo = 1
        WHERE correo = ? AND rol = 'administrador'`, [hash, correo.trim().toLowerCase()]);
    console.log(r.affectedRows
      ? `Listo. ${correo} ya puede ingresar con la contraseña temporal (el panel le pedirá cambiarla).`
      : `No hay ningún encargado con el correo ${correo}.`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();
