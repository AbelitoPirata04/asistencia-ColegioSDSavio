-- Migración 07: notificaciones push al teléfono del encargado (llegadas y salidas).
-- El servidor también crea esta tabla solo al arrancar si no existe.
USE bd_asistencia_savio;

CREATE TABLE IF NOT EXISTS suscripciones_push (
  id_suscripcion INT AUTO_INCREMENT PRIMARY KEY,
  id_personal INT NOT NULL,
  huella_endpoint CHAR(64) NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  dispositivo VARCHAR(160) NULL,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT suscripciones_personal_fk FOREIGN KEY (id_personal) REFERENCES personal (id_personal) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
