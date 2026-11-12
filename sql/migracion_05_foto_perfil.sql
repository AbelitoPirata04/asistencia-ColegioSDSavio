-- Migración 05: foto de perfil de cada docente / directivo (se usa en el carnet y en la lista).
USE bd_asistencia_savio;
ALTER TABLE personal ADD COLUMN foto_perfil VARCHAR(255) NULL AFTER direccion;
