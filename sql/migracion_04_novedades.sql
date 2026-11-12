-- Migración 04: registro manual, novedades (permisos / ausencias justificadas) y días sin clase.
USE bd_asistencia_savio;
SET NAMES utf8mb4;

-- Registro manual: el administrador agrega o corrige una llegada / salida (con motivo)
ALTER TABLE registros_asistencia
  MODIFY metodo_ingreso ENUM('huella','rfid','manual') NOT NULL,
  MODIFY metodo_salida ENUM('huella','rfid','manual') NULL,
  ADD COLUMN observacion VARCHAR(255) NULL AFTER estado_puntualidad;

-- Novedades: los días que cubren no cuentan como falta
CREATE TABLE novedades (
  id_novedad INT AUTO_INCREMENT PRIMARY KEY,
  id_personal INT NOT NULL,
  tipo ENUM('incapacidad','permiso','calamidad','licencia','comision','otro') NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  observacion VARCHAR(255) NULL,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX persona_fechas (id_personal, fecha_inicio, fecha_fin),
  CONSTRAINT novedades_personal_fk FOREIGN KEY (id_personal) REFERENCES personal (id_personal) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Días sin clase: festivos, vacaciones, jornadas pedagógicas... nadie cuenta como ausente
CREATE TABLE dias_sin_clase (
  id_dia INT AUTO_INCREMENT PRIMARY KEY,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  tipo ENUM('festivo','vacaciones','jornada','otro') NOT NULL DEFAULT 'festivo',
  motivo VARCHAR(150) NOT NULL,
  INDEX fechas (fecha_inicio, fecha_fin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
