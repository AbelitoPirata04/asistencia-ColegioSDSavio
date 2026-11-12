-- Migración 06: inicio de sesión del panel (solo administradores / encargados de asistencia).
USE bd_asistencia_savio;

ALTER TABLE personal
  ADD COLUMN debe_cambiar_clave TINYINT(1) NOT NULL DEFAULT 0 AFTER contrasena,
  ADD COLUMN ultimo_ingreso DATETIME NULL AFTER debe_cambiar_clave;

-- Los administradores con contraseña sin cifrar (datos iniciales) deben cambiarla al entrar
UPDATE personal SET debe_cambiar_clave = 1 WHERE rol = 'administrador' AND contrasena NOT LIKE '$2%';
