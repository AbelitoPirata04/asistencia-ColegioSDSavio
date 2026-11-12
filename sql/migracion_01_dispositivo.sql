-- Migración 01: el equipo ahora tiene 3 modos y recuerda el resultado del último enrolamiento.
--   asistencia : lectura normal (huella o tarjeta marcan asistencia)
--   registro   : guardar una huella nueva en el sensor R307
--   tarjeta    : la próxima tarjeta que se pase se asigna a la persona elegida en el panel
USE bd_asistencia_savio;

ALTER TABLE estado_dispositivo
  MODIFY modo_actual ENUM('asistencia','registro','tarjeta') DEFAULT 'asistencia',
  ADD COLUMN modo_desde DATETIME NULL AFTER id_huella_asignar,
  ADD COLUMN resultado_enrolamiento VARCHAR(160) NULL AFTER modo_desde,
  ADD COLUMN resultado_ok TINYINT(1) NULL AFTER resultado_enrolamiento;
