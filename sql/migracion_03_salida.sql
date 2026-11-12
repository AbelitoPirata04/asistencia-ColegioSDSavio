-- Migración 03: cada registro del día guarda la LLEGADA y la SALIDA (con su foto y su método).
--   1.er pase del día            -> llegada
--   2.º pase (3 min o más después) -> salida
--   2.º pase antes de 3 min      -> el equipo pide confirmación (pasar otra vez)
--   3.er pase                    -> se ignora
USE bd_asistencia_savio;

ALTER TABLE registros_asistencia
  ADD COLUMN fecha_hora_salida DATETIME NULL AFTER fecha_hora_entrada,
  ADD COLUMN metodo_salida ENUM('huella','rfid') NULL AFTER metodo_ingreso,
  ADD COLUMN ruta_foto_salida VARCHAR(255) NULL AFTER ruta_fotografia,
  ADD INDEX persona_fecha (id_personal, fecha_hora_entrada);
