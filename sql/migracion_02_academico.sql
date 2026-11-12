-- Migración 02: niveles, grados y asignaturas del colegio + teléfono y dirección del personal.
--   Preescolar y Primaria: el docente tiene un GRADO a cargo (ej. Jardín, Grado Primero).
--   Bachillerato: el docente dicta una ASIGNATURA (ej. Matemáticas).
--   Directivos: no llevan nivel, grado ni asignatura; solo su cargo.
USE bd_asistencia_savio;
SET NAMES utf8mb4;

CREATE TABLE niveles (
  id_nivel INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(40) NOT NULL UNIQUE,
  orden INT NOT NULL,
  por_asignatura TINYINT(1) NOT NULL DEFAULT 0   -- 1 = se elige asignatura en vez de grado
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO niveles (id_nivel, nombre, orden, por_asignatura) VALUES
  (1, 'Preescolar', 1, 0),
  (2, 'Primaria', 2, 0),
  (3, 'Bachillerato', 3, 1);

CREATE TABLE grados (
  id_grado INT AUTO_INCREMENT PRIMARY KEY,
  id_nivel INT NOT NULL,
  nombre VARCHAR(40) NOT NULL,
  orden INT NOT NULL,
  UNIQUE KEY nivel_nombre (id_nivel, nombre),
  CONSTRAINT grados_nivel_fk FOREIGN KEY (id_nivel) REFERENCES niveles (id_nivel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO grados (id_nivel, nombre, orden) VALUES
  (1, 'Párvulo', 1), (1, 'Prejardín', 2), (1, 'Jardín', 3), (1, 'Transición', 4),
  (2, 'Grado Primero', 5), (2, 'Grado Segundo', 6), (2, 'Grado Tercero', 7), (2, 'Grado Cuarto', 8), (2, 'Grado Quinto', 9);

CREATE TABLE asignaturas (
  id_asignatura INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO asignaturas (nombre) VALUES
  ('Ciencias Naturales'), ('Matemáticas'), ('Lengua Castellana'), ('Inglés'),
  ('Ciencias Sociales'), ('Religión'), ('Ética');

ALTER TABLE personal
  ADD COLUMN telefono VARCHAR(20) NULL AFTER correo,
  ADD COLUMN direccion VARCHAR(150) NULL AFTER telefono,
  ADD COLUMN id_nivel INT NULL AFTER cargo_asignatura,
  ADD COLUMN id_grado INT NULL AFTER id_nivel,
  ADD COLUMN id_asignatura INT NULL AFTER id_grado,
  ADD CONSTRAINT personal_nivel_fk FOREIGN KEY (id_nivel) REFERENCES niveles (id_nivel) ON DELETE SET NULL,
  ADD CONSTRAINT personal_grado_fk FOREIGN KEY (id_grado) REFERENCES grados (id_grado) ON DELETE SET NULL,
  ADD CONSTRAINT personal_asignatura_fk FOREIGN KEY (id_asignatura) REFERENCES asignaturas (id_asignatura) ON DELETE SET NULL;

-- El docente de prueba ("Docente Matemáticas") pasa a Bachillerato · Matemáticas
UPDATE personal
   SET id_nivel = 3,
       id_asignatura = (SELECT id_asignatura FROM asignaturas WHERE nombre = 'Matemáticas'),
       cargo_asignatura = NULL
 WHERE rol = 'docente' AND cargo_asignatura LIKE '%Matem%';
