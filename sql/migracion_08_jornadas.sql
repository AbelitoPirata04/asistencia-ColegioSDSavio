-- Migración 08: jornadas oficiales del colegio (una por nivel).
--   Primaria   07:00 a 12:00
--   Secundaria 07:00 a 13:00 (bachillerato)
--   Preescolar 13:30 a 17:30
USE bd_asistencia_savio;

UPDATE horarios SET nombre_jornada = 'Primaria',   hora_entrada = '07:00', hora_salida = '12:00' WHERE id_horario = 1;
UPDATE horarios SET nombre_jornada = 'Preescolar', hora_entrada = '13:30', hora_salida = '17:30' WHERE id_horario = 2;
INSERT INTO horarios (nombre_jornada, hora_entrada, hora_salida, minutos_tolerancia)
SELECT 'Secundaria', '07:00', '13:00', 10 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM horarios WHERE nombre_jornada = 'Secundaria');
