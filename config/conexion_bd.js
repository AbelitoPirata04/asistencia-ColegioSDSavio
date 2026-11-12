const path = require('path');
const mysql = require('mysql2/promise');

// La configuración vive en el archivo .env (no se sube a GitHub). Ver .env.ejemplo
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (e) { /* sin .env: se usan los valores por defecto */ }

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USUARIO || 'root',     // En XAMPP el usuario por defecto es 'root'
  password: process.env.DB_CLAVE || '',       // vacío si MySQL no tiene clave
  database: process.env.DB_NOMBRE || 'bd_asistencia_savio',
  port: Number(process.env.DB_PUERTO) || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

async function probarConexion() {
  try {
    const conexion = await pool.getConnection();
    console.log(`¡ÉXITO! Conectado a MySQL -> ${process.env.DB_NOMBRE || 'bd_asistencia_savio'}`);
    conexion.release();
  } catch (error) {
    console.error('Error al conectar con MySQL:', error.message);
  }
}

module.exports = { pool, probarConexion };
