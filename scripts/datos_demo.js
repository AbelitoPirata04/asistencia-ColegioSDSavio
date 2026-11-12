// Datos de DEMOSTRACIÓN para ver cómo se ven varios días de asistencia.
//
//   node scripts/datos_demo.js            -> crea docentes de prueba + ~2 semanas de registros
//   node scripts/datos_demo.js --borrar   -> borra TODO lo de prueba (miembros, registros, tarjetas y fotos)
//
// Todo lo de prueba se reconoce por el correo "@demo.savio" y las fotos "uploads/demo_*.jpg".
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/conexion_bd');

const DOMINIO = '@demo.savio';
const UPLOADS = path.join(__dirname, '..', 'uploads');
const DIAS_HABILES = 10;

// nombre, nivel (1 preescolar, 2 primaria, 3 bachillerato), grado o asignatura, jornada (1 mañana, 2 tarde)
const DOCENTES = [
  ['Elkin Monterrosa Bravo', 3, 'Ciencias Naturales', 1],
  ['Cristian Suárez Coavas', 3, 'Matemáticas', 1],
  ['Elizabeth Benítez', 3, 'Lengua Castellana', 1],
  ['Rosa Olaya Pestana', 3, 'Inglés', 1],
  ['Adalberto Doria', 3, 'Ciencias Sociales', 1],
  ['Patricia Castro Sayas', 3, 'Religión', 1],
  ['Viky Arrieta Rico', 3, 'Ética', 1],
  ['Olga Llorente', 2, 'Grado Segundo', 1],
  ['Katerin Serpa', 2, 'Grado Primero', 1],
  ['Karen Lemus', 2, 'Grado Primero', 2],
  ['Sandra Coavas', 1, 'Transición', 1],
  ['Mayerlis Díaz', 1, 'Jardín', 2],
  ['Gladis López', 1, 'Prejardín', 1],
  ['Karoll Conde', 1, 'Párvulo', 1]
];

// Números aleatorios repetibles (siempre sale el mismo set)
let semilla = 20261111;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const normal = () => (azar() + azar() + azar() - 1.5) * 2;   // aprox. campana entre -3 y 3

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function borrar() {
  const [r] = await pool.query(`DELETE FROM personal WHERE correo LIKE ?`, ['%' + DOMINIO]);
  let fotos = 0;
  if (fs.existsSync(UPLOADS)) {
    for (const f of fs.readdirSync(UPLOADS)) {
      if (f.startsWith('demo_')) { fs.unlinkSync(path.join(UPLOADS, f)); fotos++; }
    }
  }
  console.log(`Borrados ${r.affectedRows} miembros de prueba (con sus registros y tarjetas) y ${fotos} fotos.`);
}

async function crear(salidaJson) {
  const [ya] = await pool.query('SELECT COUNT(*) AS n FROM personal WHERE correo LIKE ?', ['%' + DOMINIO]);
  if (ya[0].n) { console.log('Ya hay datos de prueba. Bórrelos primero con --borrar.'); return; }

  const [grados] = await pool.query('SELECT id_grado, nombre FROM grados');
  const [asignaturas] = await pool.query('SELECT id_asignatura, nombre FROM asignaturas');
  const [horarios] = await pool.query('SELECT id_horario, hora_entrada, hora_salida, minutos_tolerancia FROM horarios');

  // Días hábiles hacia atrás, incluyendo hoy
  const dias = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  while (dias.length < DIAS_HABILES) {
    if (d.getDay() !== 0 && d.getDay() !== 6) dias.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  const ahora = new Date();
  const fotos = [];
  let nRegistros = 0;

  for (let i = 0; i < DOCENTES.length; i++) {
    const [nombre, nivel, cargo, jornada] = DOCENTES[i];
    const partes = sinTildes(nombre).split(' ');
    const g = grados.find((x) => x.nombre === cargo);
    const a = asignaturas.find((x) => x.nombre === cargo);
    const [p] = await pool.query(
      `INSERT INTO personal (cedula, nombre_completo, correo, telefono, direccion, contrasena, rol,
                             id_nivel, id_grado, id_asignatura, id_horario)
       VALUES (?, ?, ?, ?, ?, 'demo', 'docente', ?, ?, ?, ?)`,
      [String(91000001 + i), nombre, `${partes[0]}.${partes[1]}${DOMINIO}`, `300 000 ${String(1000 + i)}`,
       'Dirección de prueba', nivel, g ? g.id_grado : null, a ? a.id_asignatura : null, jornada]
    );
    const id = p.insertId;
    const uid = 'DE' + String(i + 1).padStart(6, '0');
    await pool.query(
      'INSERT INTO credenciales_biometricas (id_personal, id_huella_sensor, codigo_tarjeta_rfid) VALUES (?, ?, ?)',
      [id, 900 + i, uid]
    );

    // Personalidad: unos llegan temprano, otros suelen llegar tarde, uno falta más
    const tardanza = [4, -6, -2, 0, 14, -4, 2, -8, 1, 10, -3, 0, 6, -5][i];
    const faltas = i === 4 ? 0.2 : 0.06;
    const usaHuella = azar() < 0.45;
    const h = horarios.find((x) => x.id_horario === jornada);
    const [he, me] = h.hora_entrada.split(':').map(Number);
    const [hs, ms] = h.hora_salida.split(':').map(Number);

    for (const dia of dias) {
      if (azar() < faltas) continue;                                   // no vino
      const entrada = new Date(dia);
      const malDia = azar() < 0.06 ? 18 : 0;                           // trancón, lluvia...
      entrada.setHours(he, me + Math.round(-6 + tardanza + malDia + normal() * 6), Math.floor(azar() * 60));
      if (entrada > ahora) continue;                                   // todavía no ha llegado hoy
      const limite = new Date(dia); limite.setHours(he, me + h.minutos_tolerancia, 0);
      const estado = entrada > limite ? 'retardo' : 'puntual';

      let salida = new Date(dia);
      salida.setHours(hs, ms + Math.round(azar() * 25), Math.floor(azar() * 60));
      if (salida > ahora) salida = null;                               // sigue en el colegio
      else if (azar() < 0.06) salida = null;                           // olvidó marcar salida
      const metodo = () => (azar() < (usaHuella ? 0.8 : 0.2) ? 'huella' : 'rfid');
      const mEntrada = metodo();
      const mSalida = salida ? metodo() : null;

      const [r] = await pool.query(
        `INSERT INTO registros_asistencia (id_personal, fecha_hora_entrada, fecha_hora_salida,
                                           metodo_ingreso, metodo_salida, estado_puntualidad)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, entrada, salida, mEntrada, mSalida, estado]
      );
      nRegistros++;
      const hhmm = (f) => `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
      const iniciales = nombre.split(' ').slice(0, 2).map((x) => x[0]).join('');
      const fotoE = azar() < 0.93 ? `demo_${r.insertId}_e.jpg` : null;    // a veces falla la cámara
      const fotoS = salida && azar() < 0.93 ? `demo_${r.insertId}_s.jpg` : null;
      if (fotoE) fotos.push({ archivo: fotoE, iniciales, texto: 'LLEGADA ' + hhmm(entrada), tono: i });
      if (fotoS) fotos.push({ archivo: fotoS, iniciales, texto: 'SALIDA ' + hhmm(salida), tono: i });
      await pool.query('UPDATE registros_asistencia SET ruta_fotografia = ?, ruta_foto_salida = ? WHERE id_asistencia = ?',
        [fotoE && '/uploads/' + fotoE, fotoS && '/uploads/' + fotoS, r.insertId]);
    }
  }
  if (salidaJson) fs.writeFileSync(salidaJson, JSON.stringify(fotos));
  console.log(`Creados ${DOCENTES.length} docentes de prueba y ${nRegistros} registros en ${DIAS_HABILES} días hábiles (${fotos.length} fotos por generar).`);
}

(async () => {
  try {
    if (process.argv.includes('--borrar')) await borrar();
    else await crear(process.argv[2]);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();
