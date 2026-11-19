-- Migración 09: los directivos pueden tener acceso al panel sin crear otra cuenta.
-- acceso_panel = 1: además de marcar asistencia, entra al panel con su correo.
USE bd_asistencia_savio;

ALTER TABLE personal
  ADD COLUMN acceso_panel TINYINT(1) NOT NULL DEFAULT 0 AFTER rol;
