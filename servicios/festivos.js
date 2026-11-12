// Festivos de Colombia para cualquier año (Ley 51 de 1983, "Ley Emiliani").
// Algunos se corren al lunes siguiente; los de Semana Santa dependen de la fecha de Pascua.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const alLunes = (d) => { const s = d.getDay(); return s === 1 ? d : sumar(d, (8 - s) % 7); };

// Domingo de Pascua (algoritmo anónimo gregoriano)
function pascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia, 12);
}

function festivosColombia(anio) {
  const f = (m, d) => new Date(anio, m - 1, d, 12);
  const P = pascua(anio);
  const lista = [
    [f(1, 1), 'Año Nuevo'],
    [alLunes(f(1, 6)), 'Día de los Reyes Magos'],
    [alLunes(f(3, 19)), 'Día de San José'],
    [sumar(P, -3), 'Jueves Santo'],
    [sumar(P, -2), 'Viernes Santo'],
    [f(5, 1), 'Día del Trabajo'],
    [sumar(P, 43), 'Ascensión del Señor'],
    [sumar(P, 64), 'Corpus Christi'],
    [sumar(P, 71), 'Sagrado Corazón de Jesús'],
    [alLunes(f(6, 29)), 'San Pedro y San Pablo'],
    [f(7, 20), 'Día de la Independencia'],
    [f(8, 7), 'Batalla de Boyacá'],
    [alLunes(f(8, 15)), 'Asunción de la Virgen'],
    [alLunes(f(10, 12)), 'Día de la Raza'],
    [alLunes(f(11, 1)), 'Todos los Santos'],
    [alLunes(f(11, 11)), 'Independencia de Cartagena'],
    [f(12, 8), 'Inmaculada Concepción'],
    [f(12, 25), 'Navidad']
  ];
  return lista.map(([d, motivo]) => ({ fecha: iso(d), motivo })).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

module.exports = { festivosColombia };
